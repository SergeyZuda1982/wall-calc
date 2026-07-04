import { describe, it, expect } from 'vitest'
import {
  mmToPx, rectColumnCornersPx, angleTo, snapAngleToStep, rectPerimeterMm, rectAreaM2,
} from '../columnStamp'

describe('mmToPx', () => {
  it('переводит мм в px по масштабу', () => {
    expect(mmToPx(1000, 10)).toBeCloseTo(100) // 1000мм / 10мм-на-px = 100px
  })
  it('scaleMmPx = 0 — защита от деления на 0', () => {
    expect(mmToPx(1000, 0)).toBe(0)
  })
})

describe('rectColumnCornersPx', () => {
  it('угол 0 — прямоугольник осеосимметричен, ширина вдоль X, глубина вдоль Y', () => {
    // центр (0,0), ширина 400мм, глубина 600мм, масштаб 10мм/px → hw=20px, hd=30px
    const corners = rectColumnCornersPx(0, 0, 400, 600, 0, 10)
    expect(corners[0]).toEqual({ x: -20, y: -30 })
    expect(corners[1]).toEqual({ x: 20, y: -30 })
    expect(corners[2]).toEqual({ x: 20, y: 30 })
    expect(corners[3]).toEqual({ x: -20, y: 30 })
  })

  it('поворот на 90° — ширина и глубина меняются местами по осям', () => {
    const corners = rectColumnCornersPx(0, 0, 400, 600, Math.PI / 2, 10)
    // при повороте на 90° локальный (-hw,-hd) уходит в (hd, -hw)
    expect(corners[0].x).toBeCloseTo(30)
    expect(corners[0].y).toBeCloseTo(-20)
  })

  it('центр смещается корректно вместе с прямоугольником', () => {
    const corners = rectColumnCornersPx(100, 200, 400, 600, 0, 10)
    expect(corners[0]).toEqual({ x: 80, y: 170 })
    expect(corners[2]).toEqual({ x: 120, y: 230 })
  })

  it('возвращает ровно 4 угла, обход замкнут в квадрат равных сторон при width=depth', () => {
    const corners = rectColumnCornersPx(0, 0, 400, 400, 0, 10)
    expect(corners).toHaveLength(4)
    const side = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y)
    expect(side).toBeCloseTo(40) // 400мм / 10 = 40px
  })
})

describe('angleTo', () => {
  it('точка справа от центра — угол 0', () => {
    expect(angleTo(0, 0, 10, 0)).toBeCloseTo(0)
  })
  it('точка снизу (Y вниз) — угол +90°', () => {
    expect(angleTo(0, 0, 0, 10)).toBeCloseTo(Math.PI / 2)
  })
  it('точка слева — угол 180°', () => {
    expect(angleTo(0, 0, -10, 0)).toBeCloseTo(Math.PI)
  })
})

describe('snapAngleToStep', () => {
  it('привязывает произвольный угол к ближайшим 15°', () => {
    const deg7 = (7 * Math.PI) / 180
    const snapped = snapAngleToStep(deg7)
    expect(snapped).toBeCloseTo(0)
  })
  it('угол ровно между шагами (7.5°) округляется к ближайшему четному шагу вверх', () => {
    const deg22 = (22 * Math.PI) / 180
    const snapped = snapAngleToStep(deg22)
    expect(snapped).toBeCloseTo((15 * Math.PI) / 180)
  })
  it('угол 40° привязывается к 45°', () => {
    const deg40 = (40 * Math.PI) / 180
    const snapped = snapAngleToStep(deg40)
    expect(snapped).toBeCloseTo((45 * Math.PI) / 180)
  })
  it('поддерживает произвольный шаг', () => {
    const deg44 = (44 * Math.PI) / 180
    const snapped = snapAngleToStep(deg44, 90)
    expect(snapped).toBeCloseTo(0)
  })
})

describe('rectPerimeterMm / rectAreaM2', () => {
  it('периметр прямоугольника 400×600 = 2000мм', () => {
    expect(rectPerimeterMm(400, 600)).toBe(2000)
  })
  it('площадь прямоугольника 400×600мм = 0.24 м²', () => {
    expect(rectAreaM2(400, 600)).toBeCloseTo(0.24)
  })
})
