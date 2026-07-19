import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { hangerHookGeometry, hangerClampGeometry, hangerLeverGeometry, crabGeometry } from '../CeilingGridMesh'

// 19.07.2026 — анкерный подвес П112 по фото реальной детали: крюк-петля
// наверху (гнутый пруток, цепляется за анкер в плите), стержень, и зажим
// внизу — плоская пластина сверху профиля + 2 зубчатые боковые лапки-
// струбцины + отдельный поворотный рычаг-эксцентрик. Раньше зажим рисовался
// одной гнутой трубкой (TubeGeometry по CatmullRomCurve3) без струбцины и
// рычага — см. комментарий у Hanger в CeilingGridMesh.tsx.

describe('hangerHookGeometry (крюк-петля наверху анкерного подвеса)', () => {
  it('строится без ошибок и возвращает BufferGeometry', () => {
    expect(() => hangerHookGeometry()).not.toThrow()
    expect(hangerHookGeometry()).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('начинается у y=0 (точка присоединения стержня) и уходит вверх — крюк выше уровня плиты', () => {
    const geo = hangerHookGeometry()
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.min.y).toBeLessThanOrEqual(0.001)
    expect(bb.max.y).toBeGreaterThan(0.005)
  })

  it('отклоняется в сторону по X (не прямой стержень) — это загнутый крюк, а не отрезок', () => {
    const geo = hangerHookGeometry()
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.x - bb.min.x).toBeGreaterThan(0.005)
  })
})

describe('hangerClampGeometry (зажим-струбцина на профиле)', () => {
  it('строится без ошибок и возвращает BufferGeometry', () => {
    expect(() => hangerClampGeometry()).not.toThrow()
    expect(hangerClampGeometry()).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('план по X примерно равен ширине профиля (60мм) — лапки охватывают профиль по бокам, не уже и не сильно шире', () => {
    const geo = hangerClampGeometry(60, 27)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const widthM = bb.max.x - bb.min.x
    expect(widthM).toBeGreaterThan(0.058)
    expect(widthM).toBeLessThan(0.075)
  })

  it('лапки уходят вниз примерно на высоту профиля (27мм) — обхватывают его по высоте, не просто плоская пластина', () => {
    const geo = hangerClampGeometry(60, 27)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const heightM = bb.max.y - bb.min.y
    expect(heightM).toBeGreaterThan(0.02)
  })

  it('шире, чем узкая скоба двухуровневого соединителя (crabGeometry для сравнения масштаба)', () => {
    const clamp = hangerClampGeometry()
    const crab = crabGeometry()
    clamp.computeBoundingBox()
    crab.computeBoundingBox()
    const widthClamp = clamp.boundingBox!.max.x - clamp.boundingBox!.min.x
    const widthCrab = crab.boundingBox!.max.x - crab.boundingBox!.min.x
    // зажим охватывает профиль 60мм, крестовина краба — заметно уже
    expect(widthClamp).toBeGreaterThan(widthCrab)
  })

  it('toothCount не ломает построение при других значениях (2 и 5 зубцов)', () => {
    expect(() => hangerClampGeometry(60, 27, 1.4, 2)).not.toThrow()
    expect(() => hangerClampGeometry(60, 27, 1.4, 5)).not.toThrow()
  })
})

describe('hangerLeverGeometry (рычаг-эксцентрик зажима)', () => {
  it('строится без ошибок и возвращает BufferGeometry', () => {
    expect(() => hangerLeverGeometry()).not.toThrow()
    expect(hangerLeverGeometry()).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('пивот на одном конце — деталь целиком лежит по одну сторону от x=0 (ось поворота у стержня)', () => {
    const geo = hangerLeverGeometry()
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.x).toBeLessThanOrEqual(0.0005)
  })

  it('длина рычага растёт вместе с шириной профиля (пропорционален profileWidthMm)', () => {
    const narrow = hangerLeverGeometry(40)
    const wide = hangerLeverGeometry(80)
    narrow.computeBoundingBox()
    wide.computeBoundingBox()
    const lenNarrow = narrow.boundingBox!.max.x - narrow.boundingBox!.min.x
    const lenWide = wide.boundingBox!.max.x - wide.boundingBox!.min.x
    expect(lenWide).toBeGreaterThan(lenNarrow)
  })
})
