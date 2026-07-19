import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { twoLevelConnectorGeometry, crabGeometry } from '../CeilingGridMesh'

// 19.07.2026 — двухуровневый соединитель П112 по фото реальной детали:
// гнутая скоба (верхняя пластина + 2 вертикальные лапы + загнутые внутрь
// крюки снизу), НЕ плоская крестовина crabGeometry (см. комментарий у
// twoLevelConnectorGeometry в CeilingGridMesh.tsx). Раньше на этом месте
// стояла crabGeometry() между mainY/bearingY — форма была неверной.

describe('twoLevelConnectorGeometry (двухуровневый соединитель П112)', () => {
  it('по высоте (Y) занимает примерно весь зазор между уровнями (gapMm), а не толщину одной пластины', () => {
    const gapMm = 30
    const geo = twoLevelConnectorGeometry(gapMm)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const heightM = bb.max.y - bb.min.y
    // Высота должна быть заметно больше, чем просто толщина металла —
    // деталь реально "прошивает" зазор между main и bearing уровнями.
    expect(heightM).toBeGreaterThan((gapMm * 0.7) / 1000)
  })

  it('при увеличении gapMm высота детали растёт пропорционально (лапы тянутся через весь зазор)', () => {
    const small = twoLevelConnectorGeometry(20)
    const large = twoLevelConnectorGeometry(40)
    small.computeBoundingBox()
    large.computeBoundingBox()
    const hSmall = small.boundingBox!.max.y - small.boundingBox!.min.y
    const hLarge = large.boundingBox!.max.y - large.boundingBox!.min.y
    expect(hLarge).toBeGreaterThan(hSmall)
  })

  it('план (X) заметно уже, чем у плоской крестовины crabGeometry — это узкая скоба, не широкая пластина', () => {
    const connector = twoLevelConnectorGeometry(30)
    const crab = crabGeometry()
    connector.computeBoundingBox()
    crab.computeBoundingBox()
    const widthConnector = connector.boundingBox!.max.x - connector.boundingBox!.min.x
    const widthCrab = crab.boundingBox!.max.x - crab.boundingBox!.min.x
    expect(widthConnector).toBeLessThan(widthCrab)
  })

  it('низ детали (загнутые внутрь крюки) уже по X, чем верхняя пластина — крюки идут внутрь, не наружу', () => {
    const geo = twoLevelConnectorGeometry(30)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    // Верхняя пластина — самая широкая часть детали (plateMm по умолчанию
    // 20мм => половина 0.01м в метрах после scale 0.001).
    const halfPlateM = 0.01
    expect(bb.max.x).toBeLessThanOrEqual(halfPlateM + 0.001)
  })

  it('сохраняет дефолтные параметры (обратная совместимость вызова без аргументов)', () => {
    expect(() => twoLevelConnectorGeometry()).not.toThrow()
    const geo = twoLevelConnectorGeometry()
    expect(geo).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('gapMm=0 не ломает построение (вырожденный случай, схлопнувшиеся уровни)', () => {
    expect(() => twoLevelConnectorGeometry(0)).not.toThrow()
  })
})
