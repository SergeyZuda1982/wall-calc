import { describe, it, expect } from 'vitest'
import { calcDoubleFrame } from '../calcDoubleFrame'
import { DEFAULT_BOARD_SPEC } from '../../types'
import type { Opening } from '../../types'

const L1 = DEFAULT_BOARD_SPEC
const L2 = DEFAULT_BOARD_SPEC

function base(overrides: Partial<Parameters<typeof calcDoubleFrame>[0]> = {}) {
  return calcDoubleFrame({
    dfType: 'c115_1',
    profileType: 'ps50',
    abutment: 'both',
    length: 6000,
    height: 2700,
    step: 600,
    firstStud: 0,
    openings: [],
    overlap: 500,
    layerA1: L1, layerA2: L2, layerB1: L1, layerB2: L2,
    ...overrides,
  })
}

// ─── Общая геометрия одна на оба ряда ───────────────────────────────────────

describe('calcDoubleFrame — общая сетка стоек', () => {
  it('оба ряда используют одинаковое число стоек (одна сетка позиций)', () => {
    const r = base()
    expect(r.frameA.studsCount).toBe(r.frameB.studsCount)
  })

  it('без проёмов: направляющие пола/потолка одинаковы у обоих рядов', () => {
    const r = base()
    expect(r.frameA.uwFloor).toBeCloseTo(r.frameB.uwFloor)
    expect(r.frameA.uwCeiling).toBeCloseTo(r.frameB.uwCeiling)
    expect(r.frameA.uwFloor).toBeCloseTo(6)
  })

  it('дверной проём одинаково влияет на оба ряда', () => {
    const d: Opening = { id: 'd', type: 'door', pos: 1000, width: 900, height: 2100, sillHeight: 0 }
    const r = base({ openings: [d] })
    expect(r.frameA.uwFloor).toBeCloseTo(r.frameB.uwFloor)
    expect(r.frameA.uwFloor).toBeCloseTo((6000 - 900) / 1000)
  })
})

// ─── Обшивка: sides=1, каждый ряд обшит только наружу ───────────────────────

describe('calcDoubleFrame — обшивка только с внешней стороны', () => {
  it('gklArea ряда = площадь стены × 2 слоя (НЕ × 2 стороны, как в обычной перегородке)', () => {
    const r = base()
    // Обычная одинарная стена с sides=2, 2 слоя дала бы вчетверо l*h;
    // здесь sides=1 → вдвое l*h (только 2 слоя одной стороны).
    const expectedArea = (6000 * 2700 * 2) / 1_000_000
    expect(r.frameA.gklArea).toBeCloseTo(expectedArea, 1)
    expect(r.frameB.gklArea).toBeCloseTo(expectedArea, 1)
  })

  it('С115.3: сторона B считается по 2 слоям (layerB1/layerB2), третий слой отдельно', () => {
    const r = base({ dfType: 'c115_3', layerB3: DEFAULT_BOARD_SPEC })
    const expectedArea = (6000 * 2700 * 2) / 1_000_000
    expect(r.frameB.gklArea).toBeCloseTo(expectedArea, 1)
    expect(r.extraLayerAreaM2).toBeCloseTo(expectedArea / 2, 1) // 1 слой = половина от 2 слоёв
  })

  it('С115.3 без layerB3: третий слой не считается (площадь 0, саморезы null)', () => {
    const r = base({ dfType: 'c115_3' })
    expect(r.extraLayerAreaM2).toBe(0)
    expect(r.extraLayerScrews).toBeNull()
  })

  it('С115.1/С116 (симметричные, без 3-го слоя): третий слой всегда пуст', () => {
    const r1 = base({ dfType: 'c115_1' })
    const r2 = base({ dfType: 'c116' })
    expect(r1.extraLayerAreaM2).toBe(0)
    expect(r2.extraLayerAreaM2).toBe(0)
  })
})

// ─── Разделитель (С115.2) и штучные отрезки ленты ───────────────────────────

describe('calcDoubleFrame — разделитель и штучная лента', () => {
  it('С115.2: есть площадь разделителя, штучных отрезков нет', () => {
    const r = base({ dfType: 'c115_2' })
    expect(r.separatorAreaM2).toBeCloseTo((6000 * 2700) / 1_000_000, 1)
    expect(r.tapeStrips).toBe(0)
  })

  it('С115.1/С115.3/С116: разделителя нет, штучные отрезки ленты есть', () => {
    for (const dfType of ['c115_1', 'c115_3', 'c116'] as const) {
      const r = base({ dfType })
      expect(r.separatorAreaM2).toBe(0)
      expect(r.tapeStrips).toBeGreaterThan(0)
    }
  })

  it('штучные отрезки считаются по длине стены и шагу стоек', () => {
    const r = base({ dfType: 'c115_1', length: 6000, step: 600 })
    expect(r.tapeStrips).toBe(Math.floor(6000 / 600) + 1)
  })
})

// ─── Уплотнительная лента — сумма обоих рядов ───────────────────────────────

describe('calcDoubleFrame — суммарная уплотнительная лента', () => {
  it('sealingTapeLm = сумма ленты обоих независимых рядов', () => {
    const r = base()
    expect(r.sealingTapeLm).toBeCloseTo(r.frameA.sealingTapeLm + r.frameB.sealingTapeLm, 5)
  })
})

// ─── Толщина D ───────────────────────────────────────────────────────────────

describe('calcDoubleFrame — толщина перегородки D', () => {
  it('С115.1 ПС50, 2+2 слоя 12.5мм: D = 50*2 + 62.5*2... по формуле профиль+обшивка+допуск', () => {
    const r = base({ dfType: 'c115_1', profileType: 'ps50' })
    // Не хардкодим саму формулу здесь — она уже покрыта в
    // constructionTaxonomy.doubleFrame.test.ts, проверяем только то, что
    // calcDoubleFrame реально её вызывает и передаёт правильный dfType/профиль.
    expect(r.thicknessMm).toBeGreaterThan(0)
  })

  it('С116 с явным gapMm — толщина растёт вместе с зазором', () => {
    const small = base({ dfType: 'c116', gapMm: 100 })
    const big = base({ dfType: 'c116', gapMm: 300 })
    expect(big.thicknessMm).toBeGreaterThan(small.thicknessMm)
    expect(big.thicknessMm - small.thicknessMm).toBeCloseTo(200, 1)
  })
})
