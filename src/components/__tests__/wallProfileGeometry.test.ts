import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { wallProfileGeometryM, csFlangeDepthShape, csDepthFlangeShape } from '../wallProfileGeometry'

function bbox(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  return {
    x: [b.min.x, b.max.x] as [number, number],
    y: [b.min.y, b.max.y] as [number, number],
    z: [b.min.z, b.max.z] as [number, number],
  }
}

function closeRange(range: [number, number], expected: number, eps = 1e-6) {
  expect(range[0]).toBeCloseTo(-expected / 2, 5)
  expect(range[1]).toBeCloseTo(expected / 2, 5)
  void eps
}

describe('wallProfileGeometryM (14.07.2026) — bounding box подтверждает ориентацию осей', () => {
  it('axis="y" (стойка ПС): X=полка, Y=длина, Z=глубина — все центрированы на 0', () => {
    const geo = wallProfileGeometryM(2500, 75, 50, 'y')
    const b = bbox(geo)
    closeRange(b.x, 0.05)   // полка 50мм -> 0.05м
    closeRange(b.y, 2.5)    // длина 2500мм -> 2.5м
    closeRange(b.z, 0.075)  // глубина 75мм -> 0.075м
  })

  it('axis="x" (направляющая ПН): X=длина, Y=полка, Z=глубина — все центрированы на 0', () => {
    const geo = wallProfileGeometryM(1200, 100, 40, 'x')
    const b = bbox(geo)
    closeRange(b.x, 1.2)    // длина 1200мм -> 1.2м
    closeRange(b.y, 0.04)   // полка 40мм -> 0.04м
    closeRange(b.z, 0.1)    // глубина 100мм -> 0.1м
  })

  it('масштаб корректен и для другого набора размеров (ПС100)', () => {
    const geo = wallProfileGeometryM(3000, 100, 50, 'y')
    const b = bbox(geo)
    closeRange(b.x, 0.05)
    closeRange(b.y, 3.0)
    closeRange(b.z, 0.1)
  })

  it('С-профиль (csFlangeDepthShape) — реальное сечение с открытой стороной, не прямоугольник: площадь меньше bbox', () => {
    const shape = csFlangeDepthShape(50, 75)
    const pts = shape.getPoints()
    const geo2d = new THREE.ShapeGeometry(shape)
    geo2d.computeBoundingBox()
    const area = (() => {
      // площадь простого многоугольника по формуле шнурования
      let a = 0
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i], p2 = pts[(i + 1) % pts.length]
        a += p1.x * p2.y - p2.x * p1.y
      }
      return Math.abs(a / 2)
    })()
    const bboxArea = 50 * 75 // полка × глубина, мм²
    expect(area).toBeGreaterThan(0)
    expect(area).toBeLessThan(bboxArea) // открытый канал занимает меньше, чем сплошной прямоугольник
  })

  it('csDepthFlangeShape — транспонированная версия csFlangeDepthShape (оси x/y просто поменяны местами)', () => {
    const a = csFlangeDepthShape(50, 75).getPoints().map(p => [p.x, p.y])
    const b = csDepthFlangeShape(50, 75).getPoints().map(p => [p.x, p.y])
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      expect(b[i][0]).toBeCloseTo(a[i][1], 6)
      expect(b[i][1]).toBeCloseTo(a[i][0], 6)
    }
  })
})
