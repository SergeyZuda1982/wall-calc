import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  noniusPlateGeometry,
  noniusStripGeometry,
  noniusCotterPinGeometry,
  noniusCrossClampGeometry,
  hangerClampGeometry,
} from '../CeilingGridMesh'

// 19.07.2026 — нониус-подвес П112, пункт 5 (последний) списка сверки
// крепежа потолка по фото реальной детали. Добавлен как ОТДЕЛЬНЫЙ тип
// подвеса (альтернатива Hanger), см. комментарий над NoniusHanger в
// CeilingGridMesh.tsx. Деталь из трёх частей: верхняя пластина-носик у
// плиты, перфолента, шплинт-фиксатор, крестовый зажим на профиле —
// пользователь подтвердил, что для сцены достаточно целого (собранного)
// вида, без раздельных подвижных частей/телескопа.

describe('noniusPlateGeometry (пластина-носик у плиты)', () => {
  it('строится без ошибок и возвращает BufferGeometry', () => {
    expect(() => noniusPlateGeometry()).not.toThrow()
    expect(noniusPlateGeometry()).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('кэшируется — повторный вызов возвращает тот же объект (без параметров, фиксированный размер)', () => {
    expect(noniusPlateGeometry()).toBe(noniusPlateGeometry())
  })
})

describe('noniusStripGeometry (перфолента)', () => {
  it('строится без ошибок и возвращает BufferGeometry', () => {
    expect(() => noniusStripGeometry(300)).not.toThrow()
    expect(noniusStripGeometry(300)).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('длина ленты (по Y) растёт вместе с переданной длиной — не фиксированный размер', () => {
    const short = noniusStripGeometry(150)
    const long = noniusStripGeometry(450)
    short.computeBoundingBox()
    long.computeBoundingBox()
    const hShort = short.boundingBox!.max.y - short.boundingBox!.min.y
    const hLong = long.boundingBox!.max.y - long.boundingBox!.min.y
    expect(hLong).toBeGreaterThan(hShort)
  })

  it('не кэшируется — разные длины не возвращают один и тот же объект (кэш по одному значению вернул бы устаревшую геометрию)', () => {
    expect(noniusStripGeometry(200)).not.toBe(noniusStripGeometry(400))
  })

  it('уходит вниз от y=0 (верх ленты у пластины-носика, низ — к зажиму)', () => {
    const geo = noniusStripGeometry(300)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.y).toBeLessThanOrEqual(0.001)
    expect(bb.min.y).toBeLessThan(-0.2)
  })
})

describe('noniusCotterPinGeometry (шплинт-фиксатор)', () => {
  it('строится без ошибок и возвращает BufferGeometry', () => {
    expect(() => noniusCotterPinGeometry()).not.toThrow()
    expect(noniusCotterPinGeometry()).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('кэшируется — повторный вызов возвращает тот же объект (без параметров, форма фиксирована)', () => {
    expect(noniusCotterPinGeometry()).toBe(noniusCotterPinGeometry())
  })

  it('гнутая форма — заметный габарит и по X, и по Y (не прямой отрезок)', () => {
    const geo = noniusCotterPinGeometry()
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.x - bb.min.x).toBeGreaterThan(0.005)
    expect(bb.max.y - bb.min.y).toBeGreaterThan(0.005)
  })
})

describe('noniusCrossClampGeometry (крестовый зажим на профиле)', () => {
  it('строится без ошибок и возвращает BufferGeometry', () => {
    expect(() => noniusCrossClampGeometry()).not.toThrow()
    expect(noniusCrossClampGeometry()).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('план по X примерно равен ширине профиля (60мм) — лапки охватывают профиль по бокам', () => {
    const geo = noniusCrossClampGeometry(60, 27)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const widthM = bb.max.x - bb.min.x
    expect(widthM).toBeGreaterThan(0.058)
    expect(widthM).toBeLessThan(0.075)
  })

  it('не кэшируется — принимает параметры профиля, как hangerClampGeometry', () => {
    expect(noniusCrossClampGeometry(60, 27)).not.toBe(noniusCrossClampGeometry(60, 27))
  })

  it('уже, чем зубчатая струбцина hangerClampGeometry (гладкий отгиб без зубцов, флажок не расширяет план по X)', () => {
    const clamp = noniusCrossClampGeometry()
    const toothedClamp = hangerClampGeometry()
    clamp.computeBoundingBox()
    toothedClamp.computeBoundingBox()
    const widthClamp = clamp.boundingBox!.max.x - clamp.boundingBox!.min.x
    const widthToothed = toothedClamp.boundingBox!.max.x - toothedClamp.boundingBox!.min.x
    expect(widthClamp).toBeLessThanOrEqual(widthToothed + 0.001)
  })

  it('флажок-ушко поднимает деталь выше плоскости пластины (max.y заметно больше толщины пластины)', () => {
    const geo = noniusCrossClampGeometry(60, 27, 1.4)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.y).toBeGreaterThan(0.005)
  })
})
