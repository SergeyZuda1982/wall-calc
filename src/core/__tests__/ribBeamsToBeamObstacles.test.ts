import { describe, it, expect } from 'vitest'
import { ribBeamsToBeamObstacles } from '../ribBeamsToBeamObstacles'
import type { PlanLine } from '../../types'
import type { Point2D } from '../geometry2d'

function ribBeam(partial: Partial<PlanLine> & { x1: number; y1: number; x2: number; y2: number }): PlanLine {
  return {
    id: partial.id ?? `rb-${Math.random()}`,
    type: 'rib_beam',
    lengthMm: 0,
    label: '',
    ...partial,
  } as PlanLine
}

describe('ribBeamsToBeamObstacles', () => {
  // Прямоугольная комната 8000×5000мм (масштаб 10 px/мм — т.е. 1мм = 0.1px
  // для простоты арифметики, scaleMmPerPx=10 значит 1px=10мм).
  const scaleMmPerPx = 10
  // Контур в px: 800×500px -> 8000×5000мм
  const outerMm: Point2D[] = [
    { x: 0, y: 0 },
    { x: 8000, y: 0 },
    { x: 8000, y: 5000 },
    { x: 0, y: 5000 },
  ]
  // Раскладка стартует от нижней стены (0,0)->(8000,0): U вдоль длины (8000),
  // V вглубь комнаты (к 5000).
  const startSide = { start: { x: 0, y: 0 }, end: { x: 8000, y: 0 } }

  it('ригель поперёк комнаты (вдоль V, т.е. короткой стороны) -> axis length', () => {
    // Линия идёт от (2000мм, 0) до (2000мм, 5000мм) по факту, в px это
    // (200,0)-(200,500)
    const lines: PlanLine[] = [
      ribBeam({ x1: 200, y1: 0, x2: 200, y2: 500, sectionWidthMm: 300, label: 'Р1' }),
    ]
    const obstacles = ribBeamsToBeamObstacles(lines, outerMm, startSide, scaleMmPerPx)
    expect(obstacles).toHaveLength(1)
    expect(obstacles[0].axis).toBe('length')
    expect(obstacles[0].posMm).toBeCloseTo(2000, 0)
    expect(obstacles[0].widthMm).toBe(300)
    expect(obstacles[0].label).toBe('Р1')
  })

  it('ригель вдоль длинной стороны (вдоль U) -> axis width', () => {
    // от (0, 1500мм) до (8000мм, 1500мм) -> px (0,150)-(800,150)
    const lines: PlanLine[] = [
      ribBeam({ x1: 0, y1: 150, x2: 800, y2: 150, sectionWidthMm: 250 }),
    ]
    const obstacles = ribBeamsToBeamObstacles(lines, outerMm, startSide, scaleMmPerPx)
    expect(obstacles).toHaveLength(1)
    expect(obstacles[0].axis).toBe('width')
    expect(obstacles[0].posMm).toBeCloseTo(1500, 0)
    expect(obstacles[0].widthMm).toBe(250)
  })

  it('несколько ригелей поперёк — все находятся, с автоподписью при пустом label', () => {
    const lines: PlanLine[] = [
      ribBeam({ x1: 70, y1: 0, x2: 70, y2: 500, sectionWidthMm: 300 }),
      ribBeam({ x1: 212, y1: 0, x2: 212, y2: 500, sectionWidthMm: 300 }),
      ribBeam({ x1: 351, y1: 0, x2: 351, y2: 500, sectionWidthMm: 300 }),
    ]
    const obstacles = ribBeamsToBeamObstacles(lines, outerMm, startSide, scaleMmPerPx)
    expect(obstacles).toHaveLength(3)
    expect(obstacles.map(o => o.posMm)).toEqual([700, 2120, 3510])
    expect(obstacles[0].label).toBe('Ригель 1')
    expect(obstacles[1].label).toBe('Ригель 2')
  })

  it('дефолтная ширина сечения, если sectionWidthMm не задан', () => {
    const lines: PlanLine[] = [ribBeam({ x1: 200, y1: 0, x2: 200, y2: 500 })]
    const obstacles = ribBeamsToBeamObstacles(lines, outerMm, startSide, scaleMmPerPx)
    expect(obstacles[0].widthMm).toBe(300) // DEFAULT_RIB_SECTION_MM
  })

  it('ригель-дуга (sagittaMm задан) пропускается', () => {
    const lines: PlanLine[] = [
      ribBeam({ x1: 200, y1: 0, x2: 200, y2: 500, sagittaMm: 150 }),
    ]
    expect(ribBeamsToBeamObstacles(lines, outerMm, startSide, scaleMmPerPx)).toHaveLength(0)
  })

  it('линии других типов (не rib_beam) игнорируются', () => {
    const lines: PlanLine[] = [
      { ...ribBeam({ x1: 200, y1: 0, x2: 200, y2: 500 }), type: 'wall_existing' },
    ]
    expect(ribBeamsToBeamObstacles(lines, outerMm, startSide, scaleMmPerPx)).toHaveLength(0)
  })

  it('ригель далеко за пределами контура (с запасом) отбрасывается', () => {
    // Полностью снаружи по V: от -2000мм до -1000мм (выше запаса 200мм)
    const lines: PlanLine[] = [
      ribBeam({ x1: 200, y1: -200, x2: 200, y2: -100, sectionWidthMm: 300 }),
    ]
    expect(ribBeamsToBeamObstacles(lines, outerMm, startSide, scaleMmPerPx)).toHaveLength(0)
  })

  it('ригель, чуть выступающий за периметр (в пределах overlapMarginMm), учитывается', () => {
    // От -100мм до 5100мм по V (контур 0..5000) — превышение 100мм, в пределах дефолтного запаса 200мм
    const lines: PlanLine[] = [
      ribBeam({ x1: 200, y1: -10, x2: 200, y2: 510, sectionWidthMm: 300 }),
    ]
    const obstacles = ribBeamsToBeamObstacles(lines, outerMm, startSide, scaleMmPerPx)
    expect(obstacles).toHaveLength(1)
  })

  it('вырожденный контур (< 3 точек) -> пусто', () => {
    const lines: PlanLine[] = [ribBeam({ x1: 200, y1: 0, x2: 200, y2: 500 })]
    expect(ribBeamsToBeamObstacles(lines, [{ x: 0, y: 0 }], startSide, scaleMmPerPx)).toHaveLength(0)
  })
})
