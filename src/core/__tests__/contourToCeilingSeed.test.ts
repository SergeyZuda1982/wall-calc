import { describe, it, expect } from 'vitest'
import { contourToCeilingSeed } from '../contourToCeilingSeed'
import { sketchExample, setEdgeBulge } from '../contourEdit'
import { contourAreaMm2, type ContourVertex } from '../calcContourLayout'
import { polygonArea, polygonSides } from '../geometry2d'
import { calcCeiling } from '../calcCeiling'
import type { CeilingSpecFull } from '../../data/ceilingData'

const rect: ContourVertex[] = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }]

describe('contourToCeilingSeed', () => {
  it('прямоугольник: площадь, периметр, одна зона из 4 точек', () => {
    const s = contourToCeilingSeed(rect)!
    expect(s.areaSqm).toBe(20)
    expect(s.perimeterM).toBe(18)
    expect(s.holesCount).toBe(0)
    expect(s.zones).toHaveLength(1)
    expect(s.zones[0].outerMm).toHaveLength(4)
    expect(s.label).toBe('Контур потолка')
    expect(s.source).toBe('contour')
  })
  it('Y отражается под систему плана (вниз)', () => {
    const s = contourToCeilingSeed(rect)!
    expect(s.zones[0].outerMm[2]).toEqual({ x: 5000, y: -4000 })
  })
  it('невалидный контур даёт null', () => {
    expect(contourToCeilingSeed([{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }])).toBeNull()
    expect(contourToCeilingSeed(rect.slice(0, 2))).toBeNull()
  })
  it('пример с дугой: площадь точная, ломаная даёт ту же площадь с допуском 1 мм', () => {
    const ex = sketchExample()
    const s = contourToCeilingSeed(ex)!
    expect(s.areaSqm).toBeCloseTo(contourAreaMm2(ex) / 1e6, 2)
    const polyArea = polygonArea(s.zones[0].outerMm) / 1e6
    expect(Math.abs(polyArea - s.areaSqm)).toBeLessThan(0.05)
    expect(s.zones[0].outerMm.length).toBeGreaterThan(30)
  })
  it('ни одной стороны короче 1 мм (polygonSides их бы пропустил и сбил нумерацию)', () => {
    const s = contourToCeilingSeed(sketchExample())!
    expect(polygonSides(s.zones[0].outerMm)).toHaveLength(s.zones[0].outerMm.length)
  })
  it('прямая опорная сторона → startSideIndex указывает на неё', () => {
    const ex = sketchExample()
    const s = contourToCeilingSeed(ex, { refEdge: 4 })!   // ребро 5→6 (вертикаль справа)
    const side = polygonSides(s.zones[0].outerMm)[s.startSideIndex!]
    expect(side.start).toEqual({ x: ex[4].x, y: -ex[4].y })
    expect(side.end).toEqual({ x: ex[5].x, y: -ex[5].y })
  })
  it('дуговая опорная сторона → подсказки нет', () => {
    expect(contourToCeilingSeed(sketchExample(), { refEdge: 7 })!.startSideIndex).toBeUndefined()
  })
  it('своё название', () => {
    expect(contourToCeilingSeed(rect, { label: '  Зал  ' })!.label).toBe('Зал')
  })
  it('калькулятор потолков принимает контур с дугой и даёт точный расчёт без предупреждения про «средний расход»', () => {
    const arcRect = setEdgeBulge(rect, 1, 600, true)
    const seed = contourToCeilingSeed(arcRect, { refEdge: 0 })!
    const outer = seed.zones[0].outerMm
    const side = polygonSides(outer)[seed.startSideIndex!]
    const spec: CeilingSpecFull = {
      type: 'p112', layers: 1, material: 'gsp', thickness: 12.5, stepC: 600,
      areaSqm: seed.areaSqm, perimeterM: seed.perimeterM, slabGapMm: 80, sheetLengthMm: 2500,
      roomLengthMm: 0, roomWidthMm: 0,
    }
    const res = calcCeiling(spec, { outerMm: outer, holesMm: [], startSide: { start: side.start, end: side.end } })
    expect(res.warnings.some(w => w.includes('среднему расходу'))).toBe(false)
    expect(res.materials.length).toBeGreaterThan(0)
  })
})
