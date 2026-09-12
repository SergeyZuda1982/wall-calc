import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { slantedTopBoxGeometry } from '../slantedTopBoxGeometry'

function bbox(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  return {
    x: [b.min.x, b.max.x] as [number, number],
    y: [b.min.y, b.max.y] as [number, number],
    z: [b.min.z, b.max.z] as [number, number],
  }
}

/** Нормаль первого треугольника грани face (0-индексная, 6 граней по 2 треугольника/6 вершин). */
function faceNormal(geo: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const base = faceIndex * 6 // 6 вершин (2 треугольника) на грань, см. slantedTopBoxGeometry
  const a = new THREE.Vector3().fromBufferAttribute(pos, base)
  const b = new THREE.Vector3().fromBufferAttribute(pos, base + 1)
  const c = new THREE.Vector3().fromBufferAttribute(pos, base + 2)
  return new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
}

describe('slantedTopBoxGeometry (12.09.2026, стены под наклонным потолком в 3D)', () => {
  it('hLeft === hRight — вырождается в обычный центрированный box(sx, h, sz)', () => {
    const geo = slantedTopBoxGeometry(2.0, 0.1, 2.7, 2.7)
    const b = bbox(geo)
    expect(b.x[0]).toBeCloseTo(-1.0, 5); expect(b.x[1]).toBeCloseTo(1.0, 5)
    expect(b.y[0]).toBeCloseTo(-1.35, 5); expect(b.y[1]).toBeCloseTo(1.35, 5)
    expect(b.z[0]).toBeCloseTo(-0.05, 5); expect(b.z[1]).toBeCloseTo(0.05, 5)
  })

  it('hLeft ≠ hRight — низ плоский на -max/2, верх линейно от hLeft (x=-sx/2) до hRight (x=+sx/2)', () => {
    const sx = 4.0, sz = 0.075, hLeft = 4.413, hRight = 4.520
    const geo = slantedTopBoxGeometry(sx, sz, hLeft, hRight)
    const b = bbox(geo)
    const maxH = Math.max(hLeft, hRight)
    expect(b.y[0]).toBeCloseTo(-maxH / 2, 5)      // низ короба
    expect(b.y[1]).toBeCloseTo(hRight - maxH / 2, 5) // самая высокая точка — сторона hRight

    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    let minYAtLeft = Infinity, maxYAtRight = -Infinity
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i)
      if (Math.abs(x - (-sx / 2)) < 1e-9) minYAtLeft = Math.max(minYAtLeft === Infinity ? -Infinity : minYAtLeft, y)
      if (Math.abs(x - (sx / 2)) < 1e-9) maxYAtRight = Math.max(maxYAtRight, y)
    }
    expect(minYAtLeft).toBeCloseTo(hLeft - maxH / 2, 5)
    expect(maxYAtRight).toBeCloseTo(hRight - maxH / 2, 5)
  })

  it('все 6 граней смотрят наружу короба (нормали в ожидаемую сторону)', () => {
    const geo = slantedTopBoxGeometry(2.0, 0.3, 2.5, 3.1)
    // Порядок граней в slantedTopBoxGeometry: перед(+Z), зад(-Z), право(+X), лево(-X), низ(-Y), верх(+Y-преим.)
    expect(faceNormal(geo, 0).z).toBeGreaterThan(0.9)   // перед
    expect(faceNormal(geo, 1).z).toBeLessThan(-0.9)     // зад
    expect(faceNormal(geo, 2).x).toBeGreaterThan(0.9)   // право
    expect(faceNormal(geo, 3).x).toBeLessThan(-0.9)     // лево
    expect(faceNormal(geo, 4).y).toBeLessThan(-0.9)     // низ
    expect(faceNormal(geo, 5).y).toBeGreaterThan(0.5)   // верх (наклонная — не строго 1, но явно вверх)
  })

  it('короче/длиннее по sx/sz масштабируется линейно (нет хардкода размеров)', () => {
    const geo = slantedTopBoxGeometry(6.4, 0.2, 5.0, 5.2)
    const b = bbox(geo)
    expect(b.x[1] - b.x[0]).toBeCloseTo(6.4, 5)
    expect(b.z[1] - b.z[0]).toBeCloseTo(0.2, 5)
  })
})
