import { describe, it, expect } from 'vitest'
import { ceilingToCeilingSeed } from '../ceilingToCeilingSeed'
import type { Ceiling } from '../../types'

function rectCeiling(wPx: number, hPx: number): Ceiling {
  return {
    id: 'c1',
    label: 'Тест',
    outer: [
      { x: 0, y: 0 },
      { x: wPx, y: 0 },
      { x: wPx, y: hPx },
      { x: 0, y: hPx },
    ],
  }
}

describe('ceilingToCeilingSeed', () => {
  it('прямоугольник 4000×3000мм даёт верные площадь и периметр', () => {
    // scale 10 мм/px -> 400×300 px
    const ceiling = rectCeiling(400, 300)
    const seed = ceilingToCeilingSeed(ceiling, 10)
    expect(seed).not.toBeNull()
    expect(seed!.areaSqm).toBeCloseTo(12, 5)     // 4м×3м
    expect(seed!.perimeterM).toBeCloseTo(14, 5)  // 2*(4+3)
    expect(seed!.holesCount).toBe(0)
  })

  it('объединённый неправильный многоугольник (несколько бывших комнат в один потолок) считается по формуле шнурков', () => {
    // Г-образный контур (две прямоугольные зоны, слитые в одну) —
    // ровно тот кейс из фото пользователя: несколько помещений экспликации
    // под одним физическим потолком без капитальной перегородки между ними.
    const ceiling: Ceiling = {
      id: 'c2',
      label: 'Потолок 1',
      outer: [
        { x: 0, y: 0 },
        { x: 600, y: 0 },
        { x: 600, y: 300 },
        { x: 300, y: 300 },
        { x: 300, y: 500 },
        { x: 0, y: 500 },
      ],
    }
    // scale 10 мм/px: площадь = (6×3) + (3×2) = 18+6 = 24 м² (в метрах: 6м×3м блок + 3м×2м блок)
    const seed = ceilingToCeilingSeed(ceiling, 10)!
    expect(seed.areaSqm).toBeCloseTo(24, 5)
    expect(seed.holesCount).toBe(0)
  })

  it('меньше 3 точек контура — возвращает null', () => {
    const ceiling: Ceiling = { id: 'c3', label: 'X', outer: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
    expect(ceilingToCeilingSeed(ceiling, 10)).toBeNull()
  })

  it('без вырезов — holesCount всегда 0 (Ceiling пока без holes)', () => {
    const ceiling = rectCeiling(100, 100)
    const seed = ceilingToCeilingSeed(ceiling, 10)!
    expect(seed.holesCount).toBe(0)
  })
})
