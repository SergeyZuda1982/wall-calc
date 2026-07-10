import { describe, it, expect } from 'vitest'
import { combineCeilingSeeds } from '../combineCeilingSeeds'
import type { CeilingSeedZone } from '../../store/useCeilingSeedStore'

function zone(label: string, areaSqm: number, perimeterM: number, holesMm: CeilingSeedZone['holesMm'] = []): CeilingSeedZone {
  return {
    label,
    areaSqm,
    perimeterM,
    outerMm: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }],
    holesMm,
  }
}

describe('combineCeilingSeeds', () => {
  it('одна зона — итог совпадает с самой зоной, label без " + "', () => {
    const result = combineCeilingSeeds([zone('Помещение 1', 12.5, 14.2)])
    expect(result.label).toBe('Помещение 1')
    expect(result.areaSqm).toBe(12.5)
    expect(result.perimeterM).toBe(14.2)
    expect(result.holesCount).toBe(0)
    expect(result.zones).toHaveLength(1)
  })

  it('несколько зон — площадь и периметр складываются, label объединяется через " + "', () => {
    const result = combineCeilingSeeds([
      zone('Помещение 1', 12.5, 14.2),
      zone('Помещение 2', 8.3, 11.6),
      zone('Помещение 3', 5.1, 9.0),
    ])
    expect(result.label).toBe('Помещение 1 + Помещение 2 + Помещение 3')
    expect(result.areaSqm).toBe(25.9)
    expect(result.perimeterM).toBe(34.8)
    expect(result.zones).toHaveLength(3)
  })

  it('периметр — сумма периметров зон по отдельности (не внешний контур объединения)', () => {
    // Две зоны 1×1 м (периметр 4 м каждая) якобы соседствуют без зазора —
    // объединённый внешний контур дал бы периметр меньше 8, но мы намеренно
    // считаем 4+4=8 (см. комментарий в самом модуле).
    const result = combineCeilingSeeds([zone('A', 1, 4), zone('B', 1, 4)])
    expect(result.perimeterM).toBe(8)
  })

  it('holesCount — сумма количества вырезов по всем зонам', () => {
    const hole = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }]
    const result = combineCeilingSeeds([
      zone('A', 10, 12, [hole]),
      zone('B', 8, 10, [hole, hole]),
    ])
    expect(result.holesCount).toBe(3)
  })

  it('округление до сотых при суммировании (защита от плавающей точки)', () => {
    const result = combineCeilingSeeds([zone('A', 0.1, 0.1), zone('B', 0.2, 0.2)])
    expect(result.areaSqm).toBe(0.3)
    expect(result.perimeterM).toBe(0.3)
  })

  it('бросает ошибку на пустом массиве зон', () => {
    expect(() => combineCeilingSeeds([])).toThrow()
  })
})
