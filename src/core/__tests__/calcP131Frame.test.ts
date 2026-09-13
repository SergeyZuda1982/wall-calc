import { describe, it, expect } from 'vitest'
import { calcP131FrameGeometry, selectP131ProfileConfig } from '../calcP131Frame'
import { calcFrameRowPositions } from '../calcP112Frame'
import { P131_MAX_SPAN_MM } from '../../data/ceilingData'

describe('selectP131ProfileConfig — подбор минимально достаточного сечения (офиц. таблица Кнауф)', () => {
  it('layers=1: пролёт 2500мм -> ПС50 одинарный (ровно на пределе)', () => {
    const sel = selectP131ProfileConfig(2500, 1)
    expect(sel).toEqual({ widthMm: 50, paired: false, maxSpanMm: 2500 })
  })

  it('layers=1: пролёт 2501мм -> ПС50 спаренный (чуть больше предела одинарного)', () => {
    const sel = selectP131ProfileConfig(2501, 1)
    expect(sel).toEqual({ widthMm: 50, paired: true, maxSpanMm: 3000 })
  })

  it('layers=1: пролёт 4000мм -> ПС100 спаренный (одинарного 3750мм уже не хватает)', () => {
    const sel = selectP131ProfileConfig(4000, 1)
    expect(sel).toEqual({ widthMm: 100, paired: true, maxSpanMm: 4250 })
  })

  it('layers=1: пролёт 3750мм -> ПС75 спаренный (перебор идёт по возрастанию сечения, 75 раньше 100)', () => {
    const sel = selectP131ProfileConfig(3750, 1)
    expect(sel).toEqual({ widthMm: 75, paired: true, maxSpanMm: 3750 })
  })

  it('layers=1: пролёт 4250мм -> ПС100 спаренный (максимум системы)', () => {
    const sel = selectP131ProfileConfig(4250, 1)
    expect(sel).toEqual({ widthMm: 100, paired: true, maxSpanMm: 4250 })
  })

  it('layers=1: пролёт 4251мм -> null (превышает максимум даже для ПС100 спаренного)', () => {
    expect(selectP131ProfileConfig(4251, 1)).toBeNull()
  })

  it('layers=2: те же сечения дают МЕНЬШИЙ предел, чем layers=1 (тяжелее обшивка)', () => {
    for (const widthMm of [50, 75, 100] as const) {
      for (const paired of ['single', 'paired'] as const) {
        expect(P131_MAX_SPAN_MM[2][widthMm][paired]).toBeLessThan(P131_MAX_SPAN_MM[1][widthMm][paired])
      }
    }
  })

  it('layers=2: пролёт 3750мм -> null (максимум системы при 2 слоях — 3750, ПС100 спаренный)', () => {
    const sel = selectP131ProfileConfig(3750, 2)
    expect(sel).toEqual({ widthMm: 100, paired: true, maxSpanMm: 3750 })
    expect(selectP131ProfileConfig(3751, 2)).toBeNull()
  })

  it('очень маленький пролёт -> всегда ПС50 одинарный, для любого layers', () => {
    expect(selectP131ProfileConfig(500, 1)).toEqual({ widthMm: 50, paired: false, maxSpanMm: 2500 })
    expect(selectP131ProfileConfig(500, 2)).toEqual({ widthMm: 50, paired: false, maxSpanMm: 2250 })
  })
})

describe('calcP131FrameGeometry — базовая геометрия', () => {
  it('ПС расставлены вдоль A с шагом stepMm — та же формула, что и calcFrameRowPositions', () => {
    const geo = calcP131FrameGeometry(5000, 3000, 500, true, 1)
    const expected = calcFrameRowPositions(5000, 500, { mode: 'user' })
    expect(geo.psPositions).toEqual(expected)
    expect(geo.psCount).toBe(expected.length)
  })

  it('длина каждого ПС = пролёт B (между двумя длинными стенами)', () => {
    const geo = calcP131FrameGeometry(5000, 3000, 500, true, 1)
    expect(geo.psLengthEachMm).toBe(3000)
  })

  it('pnAlongLength=false — A и B меняются местами (ПН вдоль ширины, ПС перекрывает длину)', () => {
    const alongLength = calcP131FrameGeometry(5000, 3000, 500, true, 1)
    const alongWidth = calcP131FrameGeometry(5000, 3000, 500, false, 1)
    expect(alongLength.psLengthEachMm).toBe(3000) // B = roomWidthMm
    expect(alongWidth.psLengthEachMm).toBe(5000)  // B = roomLengthMm
  })

  it('ПН — ровно 2 рейки по длине A (только 2 длинные стены, не весь периметр)', () => {
    const geo = calcP131FrameGeometry(5000, 3000, 500, true, 1)
    expect(geo.pnTotalLm).toBeCloseTo((2 * 5000) / 1000)
  })

  it('profileSelection совпадает с selectP131ProfileConfig(B, layers)', () => {
    const geo = calcP131FrameGeometry(5000, 3000, 500, true, 1)
    expect(geo.profileSelection).toEqual(selectP131ProfileConfig(3000, 1))
  })

  it('psTotalLm = psCount × psLengthEachMm / 1000 при одинарном ПС (пролёт 2500мм влезает в ПС50 одинарный)', () => {
    const geo = calcP131FrameGeometry(5000, 2500, 500, true, 1)
    expect(geo.profileSelection?.paired).toBe(false)
    expect(geo.psTotalLm).toBeCloseTo((geo.psCount * geo.psLengthEachMm) / 1000)
  })

  it('psTotalLm вдвое больше при спаренном ПС (пролёт 3000мм требует ПС50 спаренный)', () => {
    const geo = calcP131FrameGeometry(5000, 3000, 500, true, 1)
    expect(geo.profileSelection?.paired).toBe(true)
    expect(geo.psTotalLm).toBeCloseTo((geo.psCount * geo.psLengthEachMm * 2) / 1000)
  })
})

describe('calcP131FrameGeometry — предупреждение о превышении предела (пролёт вне таблицы даже для ПС100 спаренного)', () => {
  it('пролёт в пределах таблицы (4250мм, layers=1) — без предупреждения, profileSelection не null', () => {
    const geo = calcP131FrameGeometry(5000, 4250, 500, true, 1)
    expect(geo.spanWarning).toBeUndefined()
    expect(geo.profileSelection).not.toBeNull()
  })

  it('пролёт превышает таблицу (4300мм, layers=1) — предупреждение, profileSelection=null, но материалы считаются (ПС100 спаренный)', () => {
    const geo = calcP131FrameGeometry(5000, 4300, 500, true, 1)
    expect(geo.spanWarning).toBeDefined()
    expect(geo.profileSelection).toBeNull()
    expect(geo.psTotalLm).toBeCloseTo((geo.psCount * geo.psLengthEachMm * 2) / 1000) // fallback: спаренный
  })

  it('тот же пролёт при layers=2 тоже превышает (лимит там ещё ниже)', () => {
    const geo = calcP131FrameGeometry(5000, 3800, 500, true, 2)
    expect(geo.spanWarning).toBeDefined()
    expect(geo.profileSelection).toBeNull()
  })
})

describe('calcP131FrameGeometry — удлинители (пролёт B длиннее стандартного хлыста 3000мм)', () => {
  it('psExtenders > 0, когда B > 3000мм', () => {
    const geo = calcP131FrameGeometry(5000, 3500, 500, true, 1)
    expect(geo.psExtenders).toBeGreaterThan(0)
  })

  it('psExtenders = 0, когда B ≤ 3000мм', () => {
    const geo = calcP131FrameGeometry(5000, 2800, 500, true, 1)
    expect(geo.psExtenders).toBe(0)
  })

  it('спаренный ПС — удлинители считаются на КАЖДЫЙ из двух профилей пары', () => {
    // 2500мм -> одинарный ПС50 (без удлинителей, короче хлыста)
    // 3500мм -> спаренный (одно из возможных сечений) — считаем на оба профиля пары
    const paired = calcP131FrameGeometry(5000, 3500, 500, true, 1)
    expect(paired.profileSelection?.paired).toBe(true)
    const perPieceExtenders = Math.ceil(3500 / 3000) - 1 // =1
    expect(paired.psExtenders).toBe(paired.psCount * 2 * perPieceExtenders)
  })

  it('pnExtenders > 0, когда A > 3000мм', () => {
    const geo = calcP131FrameGeometry(5000, 3000, 500, true, 1)
    expect(geo.pnExtenders).toBeGreaterThan(0)
    expect(geo.pnExtenders).toBe(2) // 2 рейки, по 1 удлинителю каждая (5000мм)
  })
})

describe('calcP131FrameGeometry — вырожденные случаи', () => {
  it('нулевой пролёт -> нулевые счётчики, не падает', () => {
    const geo = calcP131FrameGeometry(0, 0, 500, true, 1)
    expect(geo.psCount).toBe(0)
    expect(geo.psTotalLm).toBe(0)
    expect(geo.pnTotalLm).toBe(0)
  })
})
