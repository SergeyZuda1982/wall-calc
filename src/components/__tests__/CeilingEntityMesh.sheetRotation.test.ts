import { describe, it, expect } from 'vitest'
import { yRotationForDirection } from '../CeilingEntityMesh'

/**
 * 16.07.2026 — регресс: пользователь прислал скриншоты 3D, где куски листов
 * ГКЛ по контуру с плана были развёрнуты и торчали за пределы каркаса, хотя
 * сам расчёт раскроя (calcPolygonSheetLayout) был верным — проверено
 * отдельно на нескольких Г/Z/Т-образных контурах, ни одного некорректного
 * куска. Причина оказалась в 3D-рендере (CeilingEntityMesh.tsx,
 * SheetPieceMesh): формула угла поворота меша brala направление оси листа
 * неверно (перепутаны/не тем знаком аргументы atan2), из-за чего каждый
 * лист поворачивался на 90° от направления оси U каркаса.
 *
 * Здесь проверяется геометрический факт: если меш повернуть вокруг Y на
 * yRotationForDirection(dx,dz), то его локальная ось X (до поворота — вектор
 * (1,0,0)) после поворота матрицей THREE.js (rotationY) должна совпадать по
 * направлению с мировым вектором (dx,dz).
 */

// Та же матрица поворота Y, что использует Three.js (rotation.y = θ):
// x' = x·cosθ + z·sinθ ;  z' = -x·sinθ + z·cosθ
function rotateY(x: number, z: number, theta: number): [number, number] {
  const c = Math.cos(theta), s = Math.sin(theta)
  return [x * c + z * s, -x * s + z * c]
}

describe('yRotationForDirection — угол поворота меша листа ГКЛ', () => {
  it('поворот локальной оси X (1,0) совпадает по направлению с (dx,dz) — вдоль мировой +X', () => {
    const [dx, dz] = [1, 0]
    const angle = yRotationForDirection(dx, dz)
    const [rx, rz] = rotateY(1, 0, angle)
    expect(rx).toBeCloseTo(dx, 6)
    expect(rz).toBeCloseTo(dz, 6)
  })

  it('вдоль мировой +Z (РЕГРЕСС: старая формула atan2(dx,dz) давала здесь угол 0 — без поворота вовсе)', () => {
    const [dx, dz] = [0, 1]
    const angle = yRotationForDirection(dx, dz)
    const [rx, rz] = rotateY(1, 0, angle)
    expect(rx).toBeCloseTo(dx, 6)
    expect(rz).toBeCloseTo(dz, 6)
  })

  it('вдоль мировой -X', () => {
    const [dx, dz] = [-1, 0]
    const angle = yRotationForDirection(dx, dz)
    const [rx, rz] = rotateY(1, 0, angle)
    expect(rx).toBeCloseTo(dx, 6)
    expect(rz).toBeCloseTo(dz, 6)
  })

  it('произвольное направление (кадр контура повёрнут не по осям мира)', () => {
    for (const [dx, dz] of [[3, 4], [-2, 5], [-7, -1], [0.3, -0.9]] as [number, number][]) {
      const r = Math.hypot(dx, dz)
      const [ux, uz] = [dx / r, dz / r]
      const angle = yRotationForDirection(dx, dz)
      const [rx, rz] = rotateY(1, 0, angle)
      expect(rx).toBeCloseTo(ux, 6)
      expect(rz).toBeCloseTo(uz, 6)
    }
  })
})
