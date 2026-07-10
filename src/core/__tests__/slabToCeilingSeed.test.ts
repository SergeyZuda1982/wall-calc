import { describe, it, expect } from 'vitest'
import { slabToCeilingSeed } from '../slabToCeilingSeed'
import type { Slab } from '../../types'

function rectSlab(wPx: number, hPx: number, holes: { x: number; y: number }[][] = []): Slab {
  return {
    id: 's1',
    label: 'Тест',
    outer: [
      { x: 0, y: 0 },
      { x: wPx, y: 0 },
      { x: wPx, y: hPx },
      { x: 0, y: hPx },
    ],
    holes,
  }
}

describe('slabToCeilingSeed', () => {
  it('прямоугольник 4000×3000мм даёт верные площадь и периметр', () => {
    // scale 10 мм/px -> 400×300 px
    const slab = rectSlab(400, 300)
    const seed = slabToCeilingSeed(slab, 10)
    expect(seed).not.toBeNull()
    expect(seed!.areaSqm).toBeCloseTo(12, 5)       // 4м×3м
    expect(seed!.perimeterM).toBeCloseTo(14, 5)     // 2*(4+3)
    expect(seed!.holesCount).toBe(0)
  })

  it('вычитает площадь выреза (дырки), не трогая периметр', () => {
    const hole = [
      { x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 150 }, { x: 100, y: 150 },
    ]
    const slab = rectSlab(400, 300, [hole])
    const seed = slabToCeilingSeed(slab, 10)!
    // дырка 500x500мм = 0.25 м²
    expect(seed.areaSqm).toBeCloseTo(12 - 0.25, 5)
    expect(seed.perimeterM).toBeCloseTo(14, 5)
    expect(seed.holesCount).toBe(1)
  })

  it('игнорирует вырожденные дырки (<3 точек)', () => {
    const slab = rectSlab(400, 300, [[{ x: 0, y: 0 }, { x: 10, y: 10 }]])
    const seed = slabToCeilingSeed(slab, 10)!
    expect(seed.areaSqm).toBeCloseTo(12, 5)
    expect(seed.holesCount).toBe(0)
  })

  it('непрямоугольный (треугольный) контур считается по формуле шнурков', () => {
    // прямоугольный треугольник с катетами 4м и 3м (в px при scale=10: 400 и 300)
    const slab: Slab = {
      id: 's2', label: 'Треугольник',
      outer: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 300 }],
      holes: [],
    }
    const seed = slabToCeilingSeed(slab, 10)!
    expect(seed.areaSqm).toBeCloseTo(6, 5)          // 0.5*4*3
    expect(seed.perimeterM).toBeCloseTo(4 + 3 + 5, 5) // 3-4-5
  })

  it('возвращает null для вырожденного контура (<3 точек)', () => {
    const slab: Slab = { id: 's3', label: 'X', outer: [{ x: 0, y: 0 }, { x: 1, y: 1 }], holes: [] }
    expect(slabToCeilingSeed(slab, 10)).toBeNull()
  })

  it('площадь не уходит в минус, если дырки больше внешнего контура (защита от кривых данных)', () => {
    const bigHole = [
      { x: -1000, y: -1000 }, { x: 2000, y: -1000 }, { x: 2000, y: 2000 }, { x: -1000, y: 2000 },
    ]
    const slab = rectSlab(400, 300, [bigHole])
    const seed = slabToCeilingSeed(slab, 10)!
    expect(seed.areaSqm).toBe(0)
  })

  it('outerMm — контур в мм (после масштабирования), для превью в CeilingCalc', () => {
    const slab = rectSlab(400, 300) // 400×300 px, scale 10 мм/px
    const seed = slabToCeilingSeed(slab, 10)!
    expect(seed.outerMm).toEqual([
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 },
    ])
  })

  it('holesMm — вырезы в мм, вырожденные (<3 точек) дырки не попадают', () => {
    const hole = [{ x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 150 }, { x: 100, y: 150 }]
    const degenerate = [{ x: 0, y: 0 }, { x: 10, y: 10 }]
    const slab = rectSlab(400, 300, [hole, degenerate])
    const seed = slabToCeilingSeed(slab, 10)!
    expect(seed.holesMm).toEqual([
      [{ x: 1000, y: 1000 }, { x: 1500, y: 1000 }, { x: 1500, y: 1500 }, { x: 1000, y: 1500 }],
    ])
  })
})
