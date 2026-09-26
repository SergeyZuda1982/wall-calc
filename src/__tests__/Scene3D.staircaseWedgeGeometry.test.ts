import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { spiralStaircaseWedgeGeometry } from '../Scene3D'
import { spiralStepSectorPointsWithAngle } from '../core/staircase'

// 23.09.2026 — монолитная модель винтовой лестницы (по фото реального
// объекта в Ростове): каждая ступень — сплошной клин с плоским верхом и
// гладко изменяющимся низом (bottomYAtPoint на каждую точку контура), а
// не тонкая плита постоянной толщины + отдельная центральная стойка.
// Ориентация граней проверяется не построчно (какая грань куда смотрит),
// а через знаковый объём тела по формуле дивергенции — если хотя бы одна
// грань вывернута наизнанку, сумма разъедет знак/величину далеко от
// геометрически верного объёма.

/** Знаковый объём индексированной треугольной сетки: Σ v0·(v1×v2)/6 —
 * корректен (положителен и точен) только если ВСЕ треугольники ориентированы
 * наружу последовательно (стандартная формула объёма многогранника по
 * теореме о дивергенции для триангулированной замкнутой поверхности). */
function signedMeshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position')
  const idx = geo.getIndex()!
  let vol = 0
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2)
    const v0 = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a))
    const v1 = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b))
    const v2 = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c))
    vol += v0.dot(new THREE.Vector3().crossVectors(v1, v2)) / 6
  }
  return vol
}

/** Площадь плоского полигона (x,z) через шнуровку (Гаусса) — для сверки
 * объёма клина постоянной толщины: area × thickness. */
function polygonAreaXZ(pts: { x: number; z: number }[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length]
    a += p.x * q.z - q.x * p.z
  }
  return Math.abs(a) / 2
}

describe('spiralStaircaseWedgeGeometry', () => {
  const sectorPts = spiralStepSectorPointsWithAngle(0, 0, 100, 300, 0, Math.PI / 6, 4)
  const topPoints = sectorPts.map(p => ({ x: p.x, z: p.y }))

  it('постоянная толщина (bottomYAtPoint = topY-thickness всюду) — объём клина совпадает с площадью×толщина (шнуровка)', () => {
    const topY = 50, thickness = 10
    const bottomYAtPoint = topPoints.map(() => topY - thickness)
    const geo = spiralStaircaseWedgeGeometry(topPoints, topY, bottomYAtPoint)
    const vol = signedMeshVolume(geo)
    const expected = polygonAreaXZ(topPoints) * thickness
    expect(vol).toBeCloseTo(expected, 3)
  })

  it('объём положителен (грани ориентированы наружу) даже при переменной (наклонной) нижней грани', () => {
    const topY = 50
    // Линейно растущая глубина по индексу точки — грубая имитация уклона по θ
    const bottomYAtPoint = topPoints.map((_, i) => topY - 5 - i * 2)
    const geo = spiralStaircaseWedgeGeometry(topPoints, topY, bottomYAtPoint)
    expect(signedMeshVolume(geo)).toBeGreaterThan(0)
  })

  it('вырожденный внутренний радиус (клин сходится в центр) — не падает, объём всё равно положителен', () => {
    const wedgePts = spiralStepSectorPointsWithAngle(0, 0, 0, 300, 0, Math.PI / 6, 4)
    const pts = wedgePts.map(p => ({ x: p.x, z: p.y }))
    const topY = 50
    const bottomYAtPoint = pts.map(() => topY - 10)
    const geo = spiralStaircaseWedgeGeometry(pts, topY, bottomYAtPoint)
    expect(signedMeshVolume(geo)).toBeGreaterThan(0)
  })

  it('bounding box по Y — от минимального bottomYAtPoint до topY, ничего не торчит выше верха/ниже низа', () => {
    const topY = 50
    const bottomYAtPoint = topPoints.map((_, i) => topY - 5 - i * 2)
    const geo = spiralStaircaseWedgeGeometry(topPoints, topY, bottomYAtPoint)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.y).toBeCloseTo(topY, 6)
    expect(bb.min.y).toBeCloseTo(Math.min(...bottomYAtPoint), 6)
  })

  it('число треугольников = 2×(n-2) крышки + 2×n боковых граней', () => {
    const topY = 50
    const bottomYAtPoint = topPoints.map(() => topY - 10)
    const geo = spiralStaircaseWedgeGeometry(topPoints, topY, bottomYAtPoint)
    const n = topPoints.length
    const expectedTriangles = 2 * (n - 2) + 2 * n
    expect(geo.getIndex()!.count / 3).toBe(expectedTriangles)
  })
})
