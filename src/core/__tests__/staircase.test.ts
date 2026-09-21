import { describe, it, expect } from 'vitest'
import {
  resolveStaircaseSteps,
  spiralStepAngles,
  spiralStepSectorPx,
  mmToPx,
} from '../staircase'

describe('resolveStaircaseSteps', () => {
  it('делит перепад высоты на целое число ступеней ближайшее к целевому подступёнку', () => {
    // 3000мм при целевом 170мм → 17.6 → округление до 18 ступеней, факт. подступёнок 166.67
    const r = resolveStaircaseSteps(3000, 170)
    expect(r.stepCount).toBe(18)
    expect(r.actualRiserMm).toBeCloseTo(3000 / 18, 6)
  })

  it('ровно делится без остатка', () => {
    const r = resolveStaircaseSteps(3400, 170)
    expect(r.stepCount).toBe(20)
    expect(r.actualRiserMm).toBeCloseTo(170, 6)
  })

  it('минимум одна ступень даже при огромном целевом подступёнке', () => {
    const r = resolveStaircaseSteps(500, 10000)
    expect(r.stepCount).toBe(1)
    expect(r.actualRiserMm).toBeCloseTo(500, 6)
  })

  it('вырожденный случай — нулевая/отрицательная высота или подступёнок', () => {
    expect(resolveStaircaseSteps(0, 170)).toEqual({ stepCount: 0, actualRiserMm: 0 })
    expect(resolveStaircaseSteps(-100, 170)).toEqual({ stepCount: 0, actualRiserMm: 0 })
    expect(resolveStaircaseSteps(3000, 0)).toEqual({ stepCount: 0, actualRiserMm: 0 })
    expect(resolveStaircaseSteps(3000, -170)).toEqual({ stepCount: 0, actualRiserMm: 0 })
  })
})

describe('spiralStepAngles', () => {
  it('равномерно делит угловой диапазон на N шагов подряд без разрывов', () => {
    const ranges = spiralStepAngles(0, Math.PI * 2, 4)
    expect(ranges).toHaveLength(4)
    expect(ranges[0].angleFromRad).toBeCloseTo(0, 9)
    expect(ranges[0].angleToRad).toBeCloseTo(Math.PI / 2, 9)
    expect(ranges[3].angleToRad).toBeCloseTo(Math.PI * 2, 9)
    // Конец каждого шага стыкуется с началом следующего — без зазора/нахлёста
    for (let i = 0; i < ranges.length - 1; i++) {
      expect(ranges[i].angleToRad).toBeCloseTo(ranges[i + 1].angleFromRad, 9)
    }
  })

  it('поддерживает отрицательный (обратный) общий угол — обход против часовой', () => {
    const ranges = spiralStepAngles(0, -Math.PI, 2)
    expect(ranges[0].angleFromRad).toBeCloseTo(0, 9)
    expect(ranges[0].angleToRad).toBeCloseTo(-Math.PI / 2, 9)
    expect(ranges[1].angleToRad).toBeCloseTo(-Math.PI, 9)
  })

  it('stepCount 0 или отрицательный — пустой массив', () => {
    expect(spiralStepAngles(0, Math.PI, 0)).toEqual([])
    expect(spiralStepAngles(0, Math.PI, -3)).toEqual([])
  })
})

describe('spiralStepSectorPx', () => {
  it('кольцевой сектор: все внешние точки на outerRadius, все внутренние — на innerRadius', () => {
    const cx = 100, cy = 100, inner = 20, outer = 80
    const pts = spiralStepSectorPx(cx, cy, inner, outer, 0, Math.PI / 6, 4)
    // 5 точек внешней дуги + 5 точек внутренней дуги (arcSegments=4 → 5 узлов на дугу)
    expect(pts).toHaveLength(10)
    const distFromCenter = (p: { x: number; y: number }) => Math.hypot(p.x - cx, p.y - cy)
    for (let i = 0; i <= 4; i++) expect(distFromCenter(pts[i])).toBeCloseTo(outer, 6)
    for (let i = 5; i <= 9; i++) expect(distFromCenter(pts[i])).toBeCloseTo(inner, 6)
  })

  it('внутренняя дуга сходится в одну точку при innerRadius=0 (клин без центральной стойки)', () => {
    const pts = spiralStepSectorPx(0, 0, 0, 50, 0, Math.PI / 4, 4)
    // 5 точек внешней дуги + 1 точка центра
    expect(pts).toHaveLength(6)
    expect(pts[5]).toEqual({ x: 0, y: 0 })
  })

  it('первая и последняя точка внешней дуги соответствуют угловым границам', () => {
    const pts = spiralStepSectorPx(0, 0, 10, 100, Math.PI / 3, Math.PI / 2, 4)
    expect(pts[0].x).toBeCloseTo(100 * Math.cos(Math.PI / 3), 6)
    expect(pts[0].y).toBeCloseTo(100 * Math.sin(Math.PI / 3), 6)
    expect(pts[4].x).toBeCloseTo(100 * Math.cos(Math.PI / 2), 6)
    expect(pts[4].y).toBeCloseTo(100 * Math.sin(Math.PI / 2), 6)
  })
})

describe('mmToPx', () => {
  it('делит на масштаб мм/px, 0 при нулевом масштабе (защита от деления на 0)', () => {
    expect(mmToPx(1000, 10)).toBe(100)
    expect(mmToPx(1000, 0)).toBe(0)
  })
})
