import { describe, it, expect } from 'vitest'
import { calcPolygonP113Frame, toLocal } from '../calcPolygonP113Frame'
import { calcP113FrameGeometry } from '../calcP113Frame'
import type { Point2D } from '../geometry2d'
import { pointInPolygon } from '../geometry2d'

const rect = (L: number, W: number): Point2D[] => [
  { x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W },
]

describe('calcPolygonP113Frame — прямоугольник совпадает с calcP113FrameGeometry', () => {
  it('итоги по длине профиля/крабам/подвесам совпадают с прямоугольным расчётом', () => {
    const L = 6000, W = 4000
    const stepC = 1000, stepB = 500, slabGapMm = 80
    const outer = rect(L, W)
    const startSide = { start: outer[0], end: outer[1] } // нижняя стена, вдоль L

    const poly = calcPolygonP113Frame(outer, [], startSide, stepC, stepB, slabGapMm, 'user')
    // U вдоль L, V вдоль W → mainAlongLength=true (основной идёт вдоль L)
    const rectGeo = calcP113FrameGeometry(L, W, stepC, stepB, slabGapMm, true, 'user')

    expect(poly.bearingTotalLm).toBeCloseTo(rectGeo.bearingTotalLm, 6)
    expect(poly.mainTotalLm).toBeCloseTo(rectGeo.mainTotalLm, 6)
    expect(poly.connectorsTotal).toBe(rectGeo.connectorsTotal)
    expect(poly.hangersTotal).toBe(rectGeo.hangersTotal)
    expect(poly.bearingExtenders).toBe(rectGeo.bearingExtenders)
    expect(poly.mainExtenders).toBe(rectGeo.mainExtenders)
    expect(poly.warnings).toEqual([])
  })

  it('основной профиль в прямоугольнике — один сплошной отрезок на ряд', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const poly = calcPolygonP113Frame(outer, [], startSide, 1000, 500, 80, 'user')
    for (const row of poly.mainRows) {
      expect(row.segments).toHaveLength(1)
    }
  })

  it('несущий профиль в прямоугольнике режется на mainCount+1 вставок на ряд', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const poly = calcPolygonP113Frame(outer, [], startSide, 1000, 500, 80, 'user')
    for (const row of poly.bearingRows) {
      expect(row.segments).toHaveLength(poly.mainRows.length + 1)
    }
  })

  it('сумма длин вставок несущего профиля в одном ряду = полному пролёту (V)', () => {
    const L = 6000, W = 4000
    const outer = rect(L, W)
    const startSide = { start: outer[0], end: outer[1] }
    const poly = calcPolygonP113Frame(outer, [], startSide, 1000, 500, 80, 'user')
    for (const row of poly.bearingRows) {
      expect(row.lengthMm).toBeCloseTo(W, 6)
    }
  })
})

describe('calcPolygonP113Frame — вогнутый L-образный контур', () => {
  const lShape: Point2D[] = [
    { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 },
    { x: 4000, y: 4000 }, { x: 4000, y: 6000 }, { x: 0, y: 6000 },
  ]

  it('несущие вставки в узкой дальней части контура короче, чем в широкой', () => {
    const startSide = { start: lShape[0], end: lShape[1] } // вдоль 6000
    const poly = calcPolygonP113Frame(lShape, [], startSide, 1000, 500, 80, 'user')
    // ряд несущего в узкой части (U>4000, доступен только V∈[4000,6000])
    // должен иметь меньшую суммарную длину, чем ряд в широкой части
    const narrowRow = poly.bearingRows.find(r => r.pos > 4000)
    const wideRow = poly.bearingRows.find(r => r.pos < 4000)
    expect(narrowRow).toBeDefined()
    expect(wideRow).toBeDefined()
    expect(narrowRow!.lengthMm).toBeLessThan(wideRow!.lengthMm)
  })

  it('суммарная длина профиля меньше, чем для описывающего прямоугольника 6000×6000', () => {
    const startSide = { start: lShape[0], end: lShape[1] }
    const poly = calcPolygonP113Frame(lShape, [], startSide, 1000, 500, 80, 'user')
    const boundingRect = calcP113FrameGeometry(6000, 6000, 1000, 500, 80, true, 'user')
    expect(poly.mainTotalLm).toBeLessThan(boundingRect.mainTotalLm)
    expect(poly.bearingTotalLm).toBeLessThan(boundingRect.bearingTotalLm)
  })

  it('соединители не расставляются в вырезанном углу (за пределами контура)', () => {
    const startSide = { start: lShape[0], end: lShape[1] }
    const poly = calcPolygonP113Frame(lShape, [], startSide, 1000, 500, 80, 'user')
    const boundingRect = calcP113FrameGeometry(6000, 6000, 1000, 500, 80, true, 'user')
    expect(poly.connectorsTotal).toBeLessThan(boundingRect.connectorsTotal)
  })

  it('все отрезки несущего профиля лежат внутри вставленного диапазона своего ряда (нет "перепрыжки" через вырез)', () => {
    const startSide = { start: lShape[0], end: lShape[1] }
    const poly = calcPolygonP113Frame(lShape, [], startSide, 1000, 500, 80, 'user')
    const loopsLocal = [lShape.map(p => toLocal(p, poly.frame))]
    for (const row of poly.bearingRows) {
      for (const [a, b] of row.segments) {
        const mid = { x: row.pos, y: (a + b) / 2 }
        expect(pointInPolygon(mid, loopsLocal)).toBe(true)
      }
    }
  })
})

describe('calcPolygonP113Frame — контур с дыркой (шахта)', () => {
  it('дырка уменьшает суммарную длину профиля относительно контура без дырки', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const hole: Point2D[] = [{ x: 2500, y: 1500 }, { x: 3500, y: 1500 }, { x: 3500, y: 2500 }, { x: 2500, y: 2500 }]
    const withHole = calcPolygonP113Frame(outer, [hole], startSide, 1000, 500, 80, 'user')
    const noHole = calcPolygonP113Frame(outer, [], startSide, 1000, 500, 80, 'user')
    expect(withHole.mainTotalLm).toBeLessThan(noHole.mainTotalLm)
    expect(withHole.bearingTotalLm).toBeLessThan(noHole.bearingTotalLm)
  })

  it('дырка разбивает как минимум один ряд несущего профиля на бОльшее число вставок', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    // x:2600..3400 (не совпадает с шагом 500, ряд несущего на u=3000 проходит
    // строго через дырку); y:2300..2600 — в промежутке между рядами
    // основного профиля (1000/2000/~3750 при stepC=1000, W=4000), чтобы
    // дырка не "поглощала" уже существующую точку разреза (иначе кол-во
    // кусков может случайно совпасть — см. историю правки этого теста).
    const hole: Point2D[] = [{ x: 2600, y: 2300 }, { x: 3400, y: 2300 }, { x: 3400, y: 2600 }, { x: 2600, y: 2600 }]
    const withHole = calcPolygonP113Frame(outer, [hole], startSide, 1000, 500, 80, 'user')
    const noHole = calcPolygonP113Frame(outer, [], startSide, 1000, 500, 80, 'user')
    const totalSegsWithHole = withHole.bearingRows.reduce((s, r) => s + r.segments.length, 0)
    const totalSegsNoHole = noHole.bearingRows.reduce((s, r) => s + r.segments.length, 0)
    expect(totalSegsWithHole).toBeGreaterThan(totalSegsNoHole)
  })
})

describe('calcPolygonP113Frame — crabPoints/hangerPoints (для 3D)', () => {
  it('длина массивов совпадает со счётчиками', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const poly = calcPolygonP113Frame(outer, [], startSide, 1000, 500, 80, 'user')
    expect(poly.crabPoints).toHaveLength(poly.connectorsTotal)
    expect(poly.hangerPoints).toHaveLength(poly.hangersTotal)
  })

  it('все точки соединителей и подвесов лежат внутри контура', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const poly = calcPolygonP113Frame(outer, [], startSide, 1000, 500, 80, 'user')
    const loopsLocal = [outer.map(p => toLocal(p, poly.frame))]
    for (const p of [...poly.crabPoints, ...poly.hangerPoints]) {
      expect(pointInPolygon(p, loopsLocal)).toBe(true)
    }
  })

  it('подвесы — подмножество соединителей', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const poly = calcPolygonP113Frame(outer, [], startSide, 1000, 500, 80, 'user')
    for (const h of poly.hangerPoints) {
      expect(poly.crabPoints.some(c => c.x === h.x && c.y === h.y)).toBe(true)
    }
  })
})

describe('calcPolygonP113Frame — стена не в крайнем углу → warning (симметрично П112)', () => {
  it('если контур выходит "позади" выбранной стены — есть предупреждение', () => {
    const lShape: Point2D[] = [
      { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 },
      { x: 4000, y: 4000 }, { x: 4000, y: 6000 }, { x: 0, y: 6000 },
    ]
    const startSide = { start: { x: 4000, y: 4000 }, end: { x: 4000, y: 6000 } }
    const poly = calcPolygonP113Frame(lShape, [], startSide, 1000, 500, 80, 'user')
    expect(poly.warnings.some(w => w.includes('выходит за пределы'))).toBe(true)
  })
})
