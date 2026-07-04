import { describe, it, expect } from 'vitest'
import { getMaxHeight, resolveMaxHeightGroup } from '../maxHeight'

describe('resolveMaxHeightGroup', () => {
  it('sapphire -> premium', () => {
    expect(resolveMaxHeightGroup('sapphire')).toBe('premium')
  })
  it('gkl/gvl/aquamarine -> standard (консервативный дефолт)', () => {
    expect(resolveMaxHeightGroup('gkl')).toBe('standard')
    expect(resolveMaxHeightGroup('gvl')).toBe('standard')
    expect(resolveMaxHeightGroup('aquamarine')).toBe('standard')
  })
  it('неизвестный материал -> standard', () => {
    expect(resolveMaxHeightGroup('unknown')).toBe('standard')
  })
})

describe('getMaxHeight — обратная совместимость (старые значения standard)', () => {
  it('без group по умолчанию standard, совпадает со старой таблицей', () => {
    expect(getMaxHeight('c111', 'ps50', 600, '06')).toBe(3000)
    expect(getMaxHeight('c112', 'ps100', 300, '07')).toBe(9500)
  })
})

describe('getMaxHeight — С111, сверено с таблицей 13 Кнауф', () => {
  it('ПС50, все шаги и толщины, standard и premium', () => {
    expect(getMaxHeight('c111', 'ps50', 600, '06', 'standard')).toBe(3000)
    expect(getMaxHeight('c111', 'ps50', 600, '06', 'premium')).toBe(3200)
    expect(getMaxHeight('c111', 'ps50', 600, '07', 'standard')).toBe(3500)
    expect(getMaxHeight('c111', 'ps50', 600, '07', 'premium')).toBe(4000)
    expect(getMaxHeight('c111', 'ps50', 400, '06', 'standard')).toBe(3850)
    expect(getMaxHeight('c111', 'ps50', 300, '07', 'premium')).toBe(5250)
  })
  it('ПС100, standard совпадает со старым значением, premium выше', () => {
    expect(getMaxHeight('c111', 'ps100', 300, '07', 'standard')).toBe(8000)
    expect(getMaxHeight('c111', 'ps100', 300, '07', 'premium')).toBe(8500)
  })
})

describe('getMaxHeight — С112, сверено с таблицей 13 Кнауф', () => {
  it('ПС75 премиум выше стандарта при том же шаге/толщине', () => {
    const std = getMaxHeight('c112', 'ps75', 600, '06', 'standard')
    const premium = getMaxHeight('c112', 'ps75', 600, '06', 'premium')
    expect(std).toBe(5000)
    expect(premium).toBe(5500)
    expect(premium).toBeGreaterThan(std)
  })
  it('ПС100 крайние значения', () => {
    expect(getMaxHeight('c112', 'ps100', 300, '07', 'premium')).toBe(10000)
  })
})

describe('getMaxHeight — С115.1/.2/.3 и С116 (данные из файлов 013/014/015, сессия 04.07.2026)', () => {
  it('С115.1/.2/.3 дают одинаковую высоту при одном профиле (различается только D, не высота)', () => {
    for (const wallType of ['c115_1', 'c115_2', 'c115_3']) {
      expect(getMaxHeight(wallType, 'ps50', 600, '06', 'standard')).toBe(4000)
      expect(getMaxHeight(wallType, 'ps75', 600, '07', 'premium')).toBe(6500)
      expect(getMaxHeight(wallType, 'ps100', 600, '06', 'premium')).toBe(6500)
    }
  })
  it('С116 (зазор под коммуникации) — свои значения, выше чем 115-серия на том же профиле', () => {
    expect(getMaxHeight('c116', 'ps50', 600, '06', 'standard')).toBe(4500)
    expect(getMaxHeight('c116', 'ps75', 600, '07', 'premium')).toBe(7500)
    expect(getMaxHeight('c116', 'ps100', 600, '07', 'standard')).toBe(7500)
  })
})

describe('getMaxHeight — неизвестная комбинация', () => {
  it('возвращает 0, если ключ не найден (например, шаг вне таблицы)', () => {
    expect(getMaxHeight('c111', 'ps50', 999, '06', 'standard')).toBe(0)
    expect(getMaxHeight('c999', 'ps50', 600, '06', 'standard')).toBe(0)
  })
})
