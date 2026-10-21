import { describe, it, expect } from 'vitest'
import {
  snapPoint, isCCW, setEdgeBulge, isBulgeInward, flipEdgeBulge, setEdgeChord, splitEdge, removeVertex,
  moveVertex, distanceToEdge, sagittaFromChordRadius, sketchExample,
} from '../contourEdit'
import { contourAreaMm2, validateContour, contourPerimeterMm, calcContourLayout, type ContourVertex } from '../calcContourLayout'

const sq = (): ContourVertex[] => [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { x: 0, y: 4000 }]

describe('привязка', () => {
  const base = { grid: 100, ortho: false, prev: null, vertices: [], vertexTol: 50 }
  it('к сетке', () => expect(snapPoint({ x: 1234, y: 4980 }, base)).toMatchObject({ x: 1200, y: 5000, kind: 'grid' }))
  it('без сетки — как есть', () => expect(snapPoint({ x: 1234, y: 4980 }, { ...base, grid: 0 })).toMatchObject({ x: 1234, y: 4980, kind: 'free' }))
  it('к существующей вершине приоритетнее сетки', () => {
    const r = snapPoint({ x: 1010, y: 1020 }, { ...base, vertices: [{ x: 1000, y: 1000 }] })
    expect(r).toMatchObject({ x: 1000, y: 1000, kind: 'vertex', vertexIndex: 0 })
  })
  it('прямые углы: фиксируем ближайшую ось от предыдущей вершины', () => {
    const r = snapPoint({ x: 2100, y: 330 }, { ...base, ortho: true, prev: { x: 0, y: 0 } })
    expect(r.y).toBe(0); expect(r.x).toBe(2100)
  })
})

describe('операции с рёбрами', () => {
  it('направление обхода', () => {
    expect(isCCW(sq())).toBe(true)
    expect(isCCW([...sq()].reverse())).toBe(false)
  })
  it('внутрь/наружу не зависят от направления обхода', () => {
    const a = setEdgeBulge(sq(), 0, 500, true)
    const b = setEdgeBulge([...sq()].reverse().map(v => ({ x: v.x, y: v.y })), 2, 500, true) // то же ребро снизу, обход по часовой
    expect(isBulgeInward(a, 0)).toBe(true)
    expect(isBulgeInward(b, 2)).toBe(true)
    expect(contourAreaMm2(a)).toBeCloseTo(contourAreaMm2(b), 3)
    expect(contourAreaMm2(a)).toBeLessThan(16e6)
    expect(contourAreaMm2(setEdgeBulge(sq(), 0, 500, false))).toBeGreaterThan(16e6)
  })
  it('переворот выгиба меняет площадь симметрично', () => {
    const a = setEdgeBulge(sq(), 0, 500, true)
    const f = flipEdgeBulge(a, 0)
    expect(contourAreaMm2(a) + contourAreaMm2(f)).toBeCloseTo(32e6, 3)
  })
  it('длина стороны: двигает конец вдоль ребра', () => {
    const r = setEdgeChord(sq(), 0, 6000)
    expect(r[1]).toMatchObject({ x: 6000, y: 0 })
    expect(r[2]).toMatchObject({ x: 4000, y: 4000 })
  })
  it('стрела по радиусу', () => {
    expect(sagittaFromChordRadius(20800, 29413.16)).toBeCloseTo(1900, 1)
    expect(sagittaFromChordRadius(20800, 5000)).toBeNull()
  })
  it('разделение прямого ребра не меняет форму', () => {
    const r = splitEdge(sq(), 0)
    expect(r).toHaveLength(5)
    expect(r[1]).toMatchObject({ x: 2000, y: 0 })
    expect(contourAreaMm2(r)).toBeCloseTo(16e6, 6)
  })
  it('разделение дуги сохраняет окружность: площадь и длина те же', () => {
    const arc = setEdgeBulge(sq(), 0, 700, true)
    const r = splitEdge(arc, 0)
    expect(r).toHaveLength(5)
    expect(contourAreaMm2(r)).toBeCloseTo(contourAreaMm2(arc), 0)
    expect(contourPerimeterMm(r)).toBeCloseTo(contourPerimeterMm(arc), 1)
    expect(validateContour(r)).toBeNull()
  })
  it('удаление вершины: ребро становится прямым', () => {
    const r = removeVertex(setEdgeBulge(sq(), 3, 300, true), 0)
    expect(r).toHaveLength(3)
    expect(r[2].sag).toBe(0)
  })
  it('перемещение вершины', () => {
    expect(moveVertex(sq(), 2, { x: 5000, y: 5000 })[2]).toMatchObject({ x: 5000, y: 5000 })
  })
  it('расстояние до дуги учитывает выгиб', () => {
    const arc = setEdgeBulge(sq(), 0, 700, true) // выгиб внутрь = вверх
    expect(distanceToEdge(arc, 0, { x: 2000, y: 700 })).toBeLessThan(5)
    expect(distanceToEdge(sq(), 0, { x: 2000, y: 700 })).toBeCloseTo(700, 6)
  })
})

describe('пример с эскиза', () => {
  it('валиден и раскладывается', () => {
    const ex = sketchExample()
    expect(validateContour(ex)).toBeNull()
    expect(isCCW(ex)).toBe(true)
    expect(isBulgeInward(ex, 7)).toBe(true)
    const r = calcContourLayout({
      vertices: ex, refEdge: 7, sheetWidth: 1200, sheetLength: 2500, orientation: 'across',
      shiftU: 0, shiftV: 0, stagger: 0, step: 250,
    })
    expect(r.error).toBeNull()
    expect(r.areaM2).toBeGreaterThan(60)
    expect(r.areaM2).toBeLessThan(118)
    expect(r.sheetAreaM2 - r.wasteM2).toBeCloseTo(r.areaM2, 1)
  })
})
