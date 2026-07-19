import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { profileExtenderGeometry, EXTENDER_LENGTH_MM, ppProfileShape, extrudeProfileM } from '../CeilingGridMesh'

// 19.07.2026 — удлинитель ПП60×27 (пункт 4 списка сверки крепежа потолка).
// По официальному фото knauf.ru + уточнению пользователя: деталь вставляется
// ВНУТРЬ канала двух соединяемых профилей (сечение МЕНЬШЕ 60×27, не больше
// — первая версия плана предполагала внешнюю муфту и была неверна).

describe('profileExtenderGeometry', () => {
  it('строится без ошибок и возвращает BufferGeometry', () => {
    expect(() => profileExtenderGeometry()).not.toThrow()
    expect(profileExtenderGeometry()).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('сечение меньше стандартного профиля ПП60×27 — заходит внутрь канала, не надевается снаружи', () => {
    const extGeo = profileExtenderGeometry()
    const stdGeo = extrudeProfileM(ppProfileShape(), EXTENDER_LENGTH_MM)
    extGeo.computeBoundingBox()
    stdGeo.computeBoundingBox()
    const extWidth = extGeo.boundingBox!.max.x - extGeo.boundingBox!.min.x
    const stdWidth = stdGeo.boundingBox!.max.x - stdGeo.boundingBox!.min.x
    const extHeight = extGeo.boundingBox!.max.y - extGeo.boundingBox!.min.y
    const stdHeight = stdGeo.boundingBox!.max.y - stdGeo.boundingBox!.min.y
    expect(extWidth).toBeLessThan(stdWidth)
    expect(extHeight).toBeLessThan(stdHeight)
  })

  it('длина растёт вместе с переданным параметром lengthMm', () => {
    const short = profileExtenderGeometry(100)
    const long = profileExtenderGeometry(200)
    short.computeBoundingBox()
    long.computeBoundingBox()
    const shortLen = short.boundingBox!.max.z - short.boundingBox!.min.z
    const longLen = long.boundingBox!.max.z - long.boundingBox!.min.z
    expect(longLen).toBeGreaterThan(shortLen)
  })

  it('дефолтная длина равна EXTENDER_LENGTH_MM (в метрах)', () => {
    const geo = profileExtenderGeometry()
    geo.computeBoundingBox()
    const lenM = geo.boundingBox!.max.z - geo.boundingBox!.min.z
    expect(lenM).toBeCloseTo(EXTENDER_LENGTH_MM / 1000, 4)
  })
})
