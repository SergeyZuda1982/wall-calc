import { describe, it, expect } from 'vitest'
import { getWallThicknessMm, getLineVisual } from '../constructionTaxonomy'

// Сергей, 05.09.2026: толщина перегородки = профиль + обшивка слоями с
// каждой стороны. Пример: ПС75 + 2 слоя ГКЛ 12.5мм с каждой стороны ->
// 75 + 2×2×12.5 = 125мм. Раньше была фиксированная таблица
// "профиль -> толщина", молча предполагавшая всегда 1 слой.
describe('getWallThicknessMm — толщина ГКЛ-перегородки учитывает число слоёв', () => {
  it('без layers (по умолчанию 1 слой) — как раньше, профиль + 2×12.5', () => {
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps50')).toBe(75)
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps75')).toBe(100)
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps100')).toBe(125)
  })

  it('явно 1 слой — то же самое', () => {
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps50', undefined, 1)).toBe(75)
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps75', undefined, 1)).toBe(100)
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps100', undefined, 1)).toBe(125)
  })

  it("2 слоя (С112) — пример Сергея: ПС75 + 2 слоя с каждой стороны = 125мм", () => {
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps75', undefined, 2)).toBe(125)
  })

  it('2 слоя — то же самое правило для ПС50 и ПС100', () => {
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps50', undefined, 2)).toBe(100)  // 50 + 2×2×12.5
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps100', undefined, 2)).toBe(150) // 100 + 2×2×12.5
  })

  it('generic "double" (общий двойной каркас без деталей) — фиксированная оценка 200, слои не влияют', () => {
    expect(getWallThicknessMm('wall_new', 'gkl', 'double', undefined, 1)).toBe(200)
    expect(getWallThicknessMm('wall_new', 'gkl', 'double', undefined, 2)).toBe(200)
  })

  it('конкретный двойной каркас (С115/С116) — считается отдельной формулой (getDoubleFrameThicknessMm), параметр layers сюда не идёт', () => {
    // 2 профиля ПС75 (75×2) + 4 листа (sideA2+sideB2) × 12.5 + допуск 3мм
    expect(getWallThicknessMm('wall_new', 'gkl', 'c115_1_ps75')).toBe(75 * 2 + 4 * 12.5 + 3)
  })
})

describe('getLineVisual — пробрасывает layers в толщину для отрисовки на плане', () => {
  it('2 слоя даёт бОльшую thicknessMm, чем 1 слой, для одного и того же профиля', () => {
    const vis1 = getLineVisual('wall_new', 'gkl', 'ps75', undefined, 1)
    const vis2 = getLineVisual('wall_new', 'gkl', 'ps75', undefined, 2)
    expect(vis1.thicknessMm).toBe(100)
    expect(vis2.thicknessMm).toBe(125)
  })
})
