import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { crabGeometry } from '../CeilingGridMesh'

// 18.07.2026 — краб доработан по фото реальной детали: плоская крестовина
// без объёма плюс 4 отогнутые вниз лапки по концам лучей (см. комментарий
// у crabGeometry в CeilingGridMesh.tsx).

describe('crabGeometry (одноуровневый краб с лапками)', () => {
  it('bounding box шире по вертикали (Y), чем у чисто плоской пластины — лапки уходят вниз за толщину пластины', () => {
    const sizeMm = 22, thickMm = 1.4, legDropMm = 8
    const geo = crabGeometry(sizeMm, thickMm, legDropMm)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const heightM = bb.max.y - bb.min.y
    // Геометрия уже в метрах (scale 0.001 применён внутри). Толщина одной
    // пластины без лапок была бы ~thickMm/1000 — с лапками высота должна
    // быть заметно больше (пластина + вылет лапки вниз).
    expect(heightM).toBeGreaterThan((thickMm + legDropMm * 0.5) / 1000)
  })

  it('план (X-Z) остаётся в пределах исходного размера крестовины sizeMm — лапки не торчат ЗА пределы плана, только вниз', () => {
    const sizeMm = 22
    const geo = crabGeometry(sizeMm, 1.4, 8)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const halfSizeM = sizeMm / 1000
    // Небольшой допуск на толщину самой лапки (legThicknessMm=1.4 в реализации).
    const tolM = 0.002
    expect(Math.abs(bb.min.x)).toBeLessThanOrEqual(halfSizeM + tolM)
    expect(Math.abs(bb.max.x)).toBeLessThanOrEqual(halfSizeM + tolM)
    expect(Math.abs(bb.min.z)).toBeLessThanOrEqual(halfSizeM + tolM)
    expect(Math.abs(bb.max.z)).toBeLessThanOrEqual(halfSizeM + tolM)
  })

  it('вершин заметно больше, чем у плоской крестовины без лапок (4 добавленных box) — геометрия действительно объединена, не просто одна пластина', () => {
    const geo = crabGeometry(22, 1.4, 8)
    // Плоская crestовина (12-точечный контур, экструдированная) даёт
    // заметно меньше вершин, чем 4 дополнительных BoxGeometry (24 верш.
    // каждый до merge, но после mergeGeometries считаем позиции атрибута).
    expect(geo.attributes.position.count).toBeGreaterThan(24 * 4)
  })

  it('сохраняет дефолтные параметры (обратная совместимость вызова без аргументов)', () => {
    expect(() => crabGeometry()).not.toThrow()
    const geo = crabGeometry()
    expect(geo).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('legDropMm=0 вырождает лапки в нулевую длину, но не ломает построение', () => {
    expect(() => crabGeometry(22, 1.4, 0)).not.toThrow()
  })
})
