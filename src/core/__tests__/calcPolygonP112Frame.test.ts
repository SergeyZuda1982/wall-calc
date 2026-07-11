import { describe, it, expect } from 'vitest'
import { calcPolygonP112Frame, buildLocalFrame, toLocal, toWorld } from '../calcPolygonP112Frame'
import { calcP112FrameGeometry } from '../calcP112Frame'
import type { Point2D } from '../geometry2d'

const rect = (L: number, W: number): Point2D[] => [
  { x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W },
]

describe('buildLocalFrame / toLocal / toWorld', () => {
  it('орты единичной длины и перпендикулярны друг другу', () => {
    const f = buildLocalFrame({ start: { x: 0, y: 0 }, end: { x: 3000, y: 4000 } }, rect(6000, 6000))
    expect(f.ux * f.ux + f.uy * f.uy).toBeCloseTo(1, 6)
    expect(f.vx * f.vx + f.vy * f.vy).toBeCloseTo(1, 6)
    expect(f.ux * f.vx + f.uy * f.vy).toBeCloseTo(0, 6)
  })

  it('toLocal/toWorld — взаимно обратные преобразования', () => {
    const f = buildLocalFrame({ start: { x: 100, y: 200 }, end: { x: 100, y: 3200 } }, rect(6000, 4000))
    const p: Point2D = { x: 1234, y: 567 }
    const back = toWorld(toLocal(p, f), f)
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  })

  it('V-ось направлена внутрь контура (к центроиду), не наружу', () => {
    const f = buildLocalFrame({ start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } }, rect(4000, 3000))
    const centerLocal = toLocal({ x: 2000, y: 1500 }, f)
    expect(centerLocal.y).toBeGreaterThan(0)
  })
})

describe('calcPolygonP112Frame — прямоугольник совпадает с calcP112FrameGeometry', () => {
  it('итоги по длине профиля и крабам совпадают с прямоугольным расчётом', () => {
    const L = 6000, W = 4000
    const stepC = 1000, stepB = 500, slabGapMm = 80
    const outer = rect(L, W)
    const startSide = { start: outer[0], end: outer[1] } // нижняя стена, вдоль L

    const poly = calcPolygonP112Frame(outer, [], startSide, stepC, stepB, slabGapMm, 'user')
    // U вдоль L (нижняя стена), V вдоль W → несущий (bearing) тянется вдоль V,
    // расставлен вдоль U на шаге b => bearingAlongLength=false в терминах
    // прямоугольного расчёта (bearingLengthEachMm = W = roomWidthMm)
    const rectGeo = calcP112FrameGeometry(L, W, stepC, stepB, slabGapMm, false, 'user')

    expect(poly.bearingTotalLm).toBeCloseTo(rectGeo.bearingTotalLm, 6)
    expect(poly.mainTotalLm).toBeCloseTo(rectGeo.mainTotalLm, 6)
    expect(poly.connectorsTotal).toBe(rectGeo.connectorsTotal)
    expect(poly.hangersTotal).toBe(rectGeo.hangersTotal)
    expect(poly.bearingExtenders).toBe(rectGeo.bearingExtenders)
    expect(poly.mainExtenders).toBe(rectGeo.mainExtenders)
    expect(poly.warnings).toEqual([])
  })

  it('каждый ряд прямоугольника — один сплошной отрезок (без разрывов)', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const poly = calcPolygonP112Frame(outer, [], startSide, 1000, 500, 80, 'user')
    for (const row of [...poly.mainRows, ...poly.bearingRows]) {
      expect(row.segments).toHaveLength(1)
    }
  })
})

describe('calcPolygonP112Frame — вогнутый L-образный контур', () => {
  // Большая комната 6000×4000 + примыкающая узкая 2000×2000 в углу
  // (объединение двух зон без перегородки, ровно тот кейс, ради которого
  // всё затевалось — см. Ceiling-сущность).
  const lShape: Point2D[] = [
    { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 },
    { x: 4000, y: 4000 }, { x: 4000, y: 6000 }, { x: 0, y: 6000 },
  ]

  it('дальние ряды основного профиля распадаются на один короткий отрезок (только узкая часть)', () => {
    const startSide = { start: lShape[0], end: lShape[1] } // нижняя стена, длина 6000
    const poly = calcPolygonP112Frame(lShape, [], startSide, 1000, 500, 80, 'user')
    // V=5000 (глубоко в узкой части, выше y=4000) — должен быть только один
    // отрезок и он должен укладываться в [0,4000] (узкая часть контура)
    const deepRow = poly.mainRows.find(r => r.pos > 4000)
    expect(deepRow).toBeDefined()
    expect(deepRow!.segments).toHaveLength(1)
    expect(deepRow!.segments[0][1]).toBeLessThanOrEqual(4000)
  })

  it('суммарная длина профиля меньше, чем для описывающего прямоугольника 6000×6000', () => {
    const startSide = { start: lShape[0], end: lShape[1] }
    const poly = calcPolygonP112Frame(lShape, [], startSide, 1000, 500, 80, 'user')
    const boundingRect = calcP112FrameGeometry(6000, 6000, 1000, 500, 80, false, 'user')
    expect(poly.mainTotalLm).toBeLessThan(boundingRect.mainTotalLm)
    expect(poly.bearingTotalLm).toBeLessThan(boundingRect.bearingTotalLm)
  })

  it('краб-соединители не расставляются в вырезанном углу (за пределами контура)', () => {
    const startSide = { start: lShape[0], end: lShape[1] }
    const poly = calcPolygonP112Frame(lShape, [], startSide, 1000, 500, 80, 'user')
    const boundingRect = calcP112FrameGeometry(6000, 6000, 1000, 500, 80, false, 'user')
    // в квадрате 6000×6000 крабов было бы больше, чем в L-контуре с вырезом
    expect(poly.connectorsTotal).toBeLessThan(boundingRect.connectorsTotal)
  })
})

describe('calcPolygonP112Frame — стена не в крайнем углу → warning', () => {
  it('если контур выходит "позади" выбранной стены — есть предупреждение', () => {
    // L-контур: короткая сторона (0,4000)->(0,6000) не в самом широком углу,
    // но и не "позади" себя самой — возьмём заведомо плохой случай: стену,
    // которая НЕ начинается в экстремальной точке контура по U.
    const lShape: Point2D[] = [
      { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 },
      { x: 4000, y: 4000 }, { x: 4000, y: 6000 }, { x: 0, y: 6000 },
    ]
    // сторона (4000,4000)->(4000,6000): вдоль неё V направлен вправо (к
    // центроиду), а слева от неё (U<0) остаётся вся большая комната
    const startSide = { start: { x: 4000, y: 4000 }, end: { x: 4000, y: 6000 } }
    const poly = calcPolygonP112Frame(lShape, [], startSide, 1000, 500, 80, 'user')
    expect(poly.warnings.some(w => w.includes('выходит за пределы'))).toBe(true)
  })
})

describe('calcPolygonP112Frame — контур с дыркой (шахта)', () => {
  it('дырка уменьшает суммарную длину профиля относительно контура без дырки', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const hole: Point2D[] = [{ x: 2500, y: 1500 }, { x: 3500, y: 1500 }, { x: 3500, y: 2500 }, { x: 2500, y: 2500 }]
    const withHole = calcPolygonP112Frame(outer, [hole], startSide, 1000, 500, 80, 'user')
    const noHole = calcPolygonP112Frame(outer, [], startSide, 1000, 500, 80, 'user')
    expect(withHole.mainTotalLm).toBeLessThan(noHole.mainTotalLm)
    expect(withHole.bearingTotalLm).toBeLessThan(noHole.bearingTotalLm)
  })
})
