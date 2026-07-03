import { describe, it, expect } from 'vitest'
import { clipRectBySlopedTop, polygonArea } from '../geometry2d'

describe('polygonArea', () => {
  it('площадь прямоугольника', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(50)
  })

  it('площадь треугольника', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }])).toBe(25)
  })

  it('меньше 3 точек — площадь 0', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0)
  })
})

describe('clipRectBySlopedTop', () => {
  it('линия целиком выше прямоугольника — реза нет, прямоугольник как есть', () => {
    const poly = clipRectBySlopedTop(0, 100, 0, 50, 200, 200)
    expect(polygonArea(poly)).toBeCloseTo(100 * 50, 6)
  })

  it('линия целиком ниже прямоугольника — материала нет', () => {
    const poly = clipRectBySlopedTop(0, 100, 50, 100, 10, 10)
    expect(poly.length).toBe(0)
  })

  it('линия ровно совпадает с верхней гранью — прямоугольник без изменений', () => {
    const poly = clipRectBySlopedTop(0, 100, 0, 50, 50, 50)
    expect(polygonArea(poly)).toBeCloseTo(100 * 50, 6)
  })

  it('трапеция — линия входит слева, выходит через верхнюю грань справа', () => {
    // Прямоугольник 100×50, линия идёт от y=30 (x=0) до y=70 (x=100).
    // Пересекает верхнюю грань (y=50) при x=50 (лин. интерполяция 30→70).
    // Слева от x=50 материал ограничен линией (трапеция высотой 30..50),
    // справа от x=50 линия уже выше прямоугольника — доступна полная высота 50.
    const poly = clipRectBySlopedTop(0, 100, 0, 50, 30, 70)
    const leftPart = ((30 + 50) / 2) * 50   // трапеция 0..50 по x, высота 30→50
    const rightPart = 50 * 50               // прямоугольник 50..100 по x, высота 50
    expect(polygonArea(poly)).toBeCloseTo(leftPart + rightPart, 3)
  })

  it('треугольник — линия входит в левый нижний угол', () => {
    // topAtX1=0 (линия ровно на уровне низа слева), topAtX2=50 (поднимается
    // к верху справа, ровно совпадая с верхом прямоугольника y2=50).
    const poly = clipRectBySlopedTop(0, 100, 0, 50, 0, 50)
    // Это прямой треугольник: (0,0)-(100,0)-(100,50)
    const expectedArea = (100 * 50) / 2
    expect(polygonArea(poly)).toBeCloseTo(expectedArea, 3)
  })

  it('площадь монотонно растёт по мере роста высоты линии', () => {
    const areas = [0, 20, 40, 60, 80, 100].map(topH => {
      const poly = clipRectBySlopedTop(0, 100, 0, 50, topH, topH)
      return polygonArea(poly)
    })
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i]).toBeGreaterThanOrEqual(areas[i - 1])
    }
  })

  it('вырожденный случай x2<=x1 — пустой массив, не падает', () => {
    expect(clipRectBySlopedTop(10, 10, 0, 50, 30, 70)).toEqual([])
    expect(clipRectBySlopedTop(20, 10, 0, 50, 30, 70)).toEqual([])
  })
})
