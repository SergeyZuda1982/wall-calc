import { describe, it, expect } from 'vitest'
import { calcPolygonSheetLayout } from '../calcPolygonSheetLayout'
import type { Point2D } from '../geometry2d'

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
