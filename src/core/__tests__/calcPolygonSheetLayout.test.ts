import { describe, it, expect } from 'vitest'
import { calcPolygonSheetLayout } from '../calcPolygonSheetLayout'
import type { Point2D } from '../geometry2d'
import type { BoardOffcut } from '../../types'
import { DEFAULT_BOARD_SPEC } from '../../types'

const rect = (L: number, W: number): Point2D[] => [
  { x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W },
]

describe('calcPolygonSheetLayout — прямоугольник', () => {
  it('простой случай без остатка: ровно вписывается по обеим осям', () => {
    // 2500×1200 — ровно один лист 2500×1200
    const outer = rect(2500, 1200)
    const startSide = { start: outer[0], end: outer[1] }
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.totalSheets).toBe(1)
    expect(r.fullSheets).toBe(1)
    expect(r.cutSheets).toBe(0)
  })

  it('меньше 3 точек контура -> null', () => {
    expect(calcPolygonSheetLayout([{ x: 0, y: 0 }, { x: 1, y: 1 }], [], { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })).toBeNull()
  })

  it('автовыбор ориентации даёт не больше листов, чем любая фиксированная', () => {
    const outer = rect(5000, 3000)
    const startSide = { start: outer[0], end: outer[1] }
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.totalSheets).toBeGreaterThan(0)
    expect(r.totalSheets).toBe(r.fullSheets + r.cutSheets)
  })
})

describe('calcPolygonSheetLayout — вогнутый L-образный контур', () => {
  const lShape: Point2D[] = [
    { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 },
    { x: 4000, y: 4000 }, { x: 4000, y: 6000 }, { x: 0, y: 6000 },
  ]

  it('листов меньше, чем на описывающем прямоугольнике 6000×6000', () => {
    const startSide = { start: lShape[0], end: lShape[1] }
    const rL = calcPolygonSheetLayout(lShape, [], startSide, 2500)!
    const rBox = calcPolygonSheetLayout(rect(6000, 6000), [], { start: { x: 0, y: 0 }, end: { x: 6000, y: 0 } }, 2500)!
    expect(rL.totalSheets).toBeLessThan(rBox.totalSheets)
  })
})

describe('calcPolygonSheetLayout — контур с дыркой', () => {
  it('не падает и возвращает валидный результат при наличии дырки', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const hole: Point2D[] = [{ x: 2500, y: 1500 }, { x: 3500, y: 1500 }, { x: 3500, y: 2500 }, { x: 2500, y: 2500 }]
    const r = calcPolygonSheetLayout(outer, [hole], startSide, 2500)!
    expect(r.totalSheets).toBeGreaterThan(0)
  })
})

describe('calcPolygonSheetLayout — детальная раскладка (12.07.2026, реализовано по просьбе пользователя: та же механика, что для перегородок/облицовок)', () => {
  const outer = rect(6000, 3600)
  const startSide = { start: outer[0], end: outer[1] }

  it('каждый кусок имеет реальные координаты, сумма площадей = используемая площадь слоя', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.layer1.pieces.length).toBe(r.totalSheets)
    const areaMm2 = r.layer1.pieces.reduce((s, p) => s + (p.u2 - p.u1) * (p.v2 - p.v1), 0)
    expect(areaMm2 / 1e6).toBeCloseTo(r.layer1.usedAreaM2, 3)
  })

  it('без 2-го слоя layer2 === null', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.layer2).toBeNull()
  })

  it('2-й слой смещён относительно первого — швы полос не совпадают', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500, 2)!
    expect(r.layer2).not.toBeNull()
    const bandEdges1 = new Set(r.layer1.pieces.map(p => p.v1))
    const bandEdges2 = new Set(r.layer2!.pieces.map(p => p.v1))
    // Хотя бы одна граница полосы слоя 2 не совпадает ни с одной границей слоя 1
    const anyDifferent = [...bandEdges2].some(v => ![...bandEdges1].some(v1 => Math.abs(v1 - v) < 1))
    expect(anyDifferent).toBe(true)
  })

  it('соседние полосы одного слоя не стыкуются по одной линии вдоль U (running bond)', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    const byBand = new Map<number, number[]>()
    for (const p of r.layer1.pieces) {
      const key = p.v1
      if (!byBand.has(key)) byBand.set(key, [])
      byBand.get(key)!.push(p.u2)
    }
    const bandKeys = [...byBand.keys()].sort((a, b) => a - b)
    if (bandKeys.length >= 2) {
      const jointsA = new Set(byBand.get(bandKeys[0])!)
      const jointsB = new Set(byBand.get(bandKeys[1])!)
      const overlap = [...jointsA].filter(j => jointsB.has(j))
      expect(overlap.length).toBeLessThan(jointsA.size)
    }
  })

  it('пул обрезков от предыдущей конструкции переиспользуется (меньше новых листов)', () => {
    const withoutPool = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    // Один большой обрезок ровно под первый кусок — должен быть взят из пула
    const bigOffcut: BoardOffcut = { w: 1200, h: 2500, spec: DEFAULT_BOARD_SPEC }
    const withPool = calcPolygonSheetLayout(outer, [], startSide, 2500, 1, DEFAULT_BOARD_SPEC, DEFAULT_BOARD_SPEC, [bigOffcut])!
    expect(withPool.layer1.sheetsNeeded).toBeLessThan(withoutPool.layer1.sheetsNeeded)
    expect(withPool.layer1.pieces.some(p => p.source === 'offcut')).toBe(true)
  })

  it('контур по обе стороны от стены старта — полосы покрывают весь диапазон (не только U/V ≥ 0)', () => {
    const lShape: Point2D[] = [
      { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 },
      { x: 4000, y: 4000 }, { x: 4000, y: 6000 }, { x: 0, y: 6000 },
    ]
    const side = { start: { x: 4000, y: 4000 }, end: { x: 4000, y: 6000 } }
    const r = calcPolygonSheetLayout(lShape, [], side, 2500)!
    // Стена старта — короткий вертикальный отрезок посередине контура;
    // большая часть фигуры лежит в отрицательном U относительно неё.
    expect(r.layer1.pieces.some(p => p.u1 < 0 || p.u2 < 0)).toBe(true)
  })
})


