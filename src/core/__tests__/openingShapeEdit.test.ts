import { describe, it, expect } from 'vitest'
import {
  defaultOpeningShape,
  updateOpeningShapePoint,
  setOpeningShapeEdgeSagitta,
  insertOpeningShapeVertexAfter,
  removeOpeningShapeVertex,
  MIN_OPENING_SHAPE_VERTICES,
} from '../openingShapeEdit'
import { openingShapePolygon } from '../geometry2d'

describe('defaultOpeningShape', () => {
  it('returns the 4 rectangle corners, no edges', () => {
    const s = defaultOpeningShape(900, 2100)
    expect(s.points).toEqual([
      { x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 2100 }, { x: 0, y: 2100 },
    ])
    expect(s.edges).toBeUndefined()
    // разворачивается в тот же прямоугольник, что и без shape
    expect(openingShapePolygon(s)).toEqual(s.points)
  })
})

describe('updateOpeningShapePoint', () => {
  it('moves only the targeted vertex, leaves edges untouched', () => {
    const s = defaultOpeningShape(900, 2100)
    const withSagitta = setOpeningShapeEdgeSagitta(s, 0, 50)
    const moved = updateOpeningShapePoint(withSagitta, 2, { x: 1000 })
    expect(moved.points[2]).toEqual({ x: 1000, y: 2100 })
    expect(moved.points[0]).toEqual({ x: 0, y: 0 }) // прочие вершины не тронуты
    expect(moved.edges?.[0]?.sagitta).toBe(50) // стрела дуги сохранилась
  })

  it('ignores an out-of-range index', () => {
    const s = defaultOpeningShape(900, 2100)
    expect(updateOpeningShapePoint(s, 99, { x: 1 })).toBe(s)
  })
})

describe('setOpeningShapeEdgeSagitta', () => {
  it('sets sagitta on the requested edge only, defaults other edges to straight', () => {
    const s = defaultOpeningShape(900, 2100)
    const withArc = setOpeningShapeEdgeSagitta(s, 1, 40)
    expect(withArc.edges).toHaveLength(4)
    expect(withArc.edges?.[1]?.sagitta).toBe(40)
    expect(withArc.edges?.[0]?.sagitta).toBeUndefined()
  })

  it('0 or falsy clears sagitta back to straight (stored as undefined)', () => {
    const s = setOpeningShapeEdgeSagitta(defaultOpeningShape(900, 2100), 0, 40)
    const cleared = setOpeningShapeEdgeSagitta(s, 0, 0)
    expect(cleared.edges?.[0]?.sagitta).toBeUndefined()
  })

  it('supports the closing edge (last vertex -> first vertex)', () => {
    const s = defaultOpeningShape(900, 2100)
    const withArc = setOpeningShapeEdgeSagitta(s, 3, 30)
    const poly = openingShapePolygon(withArc)
    // дуга на замыкающем ребре добавляет промежуточные точки -> длиннее прямоугольника
    expect(poly.length).toBeGreaterThan(4)
  })
})

describe('insertOpeningShapeVertexAfter', () => {
  it('inserts the midpoint of the given edge and resets edges to straight', () => {
    const s = setOpeningShapeEdgeSagitta(defaultOpeningShape(900, 2100), 0, 40)
    const withVertex = insertOpeningShapeVertexAfter(s, 0)
    expect(withVertex.points).toHaveLength(5)
    expect(withVertex.points[1]).toEqual({ x: 450, y: 0 }) // середина ребра (0,0)->(900,0)
    expect(withVertex.edges).toBeUndefined() // стрелы сброшены (см. пояснение в openingShapeEdit.ts)
  })

  it('supports inserting on the closing edge (wraps around)', () => {
    const s = defaultOpeningShape(900, 2100)
    const withVertex = insertOpeningShapeVertexAfter(s, 3) // ребро (0,2100)->(0,0)
    expect(withVertex.points).toHaveLength(5)
    expect(withVertex.points[4]).toEqual({ x: 0, y: 1050 })
  })

  it('ignores an out-of-range index', () => {
    const s = defaultOpeningShape(900, 2100)
    expect(insertOpeningShapeVertexAfter(s, 10)).toBe(s)
  })
})

describe('removeOpeningShapeVertex', () => {
  it('removes the vertex at the given index and resets edges', () => {
    const s = setOpeningShapeEdgeSagitta(defaultOpeningShape(900, 2100), 2, 40)
    const removed = removeOpeningShapeVertex(s, 1)
    expect(removed.points).toEqual([{ x: 0, y: 0 }, { x: 900, y: 2100 }, { x: 0, y: 2100 }])
    expect(removed.edges).toBeUndefined()
  })

  it('refuses to go below MIN_OPENING_SHAPE_VERTICES', () => {
    const triangle = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }
    expect(triangle.points.length).toBe(MIN_OPENING_SHAPE_VERTICES)
    expect(removeOpeningShapeVertex(triangle, 0)).toBe(triangle)
  })

  it('ignores an out-of-range index', () => {
    const s = defaultOpeningShape(900, 2100)
    expect(removeOpeningShapeVertex(s, 99)).toBe(s)
  })
})
