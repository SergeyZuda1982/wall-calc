import { describe, it, expect } from 'vitest'
import { calcCeiling } from '../calcCeiling'
import { boardSpecFromCeilingSpec } from '../calcProjectSheetLayout'
import type { CeilingSpecFull } from '../../data/ceilingData'

// Помещение 4000×5000мм = 20м², периметр 18м
const BASE: CeilingSpecFull = {
  type: 'p112',
  layers: 1,
  material: 'sapphire',
  thickness: 12.5,
  stepC: 600,
  areaSqm: 20,
  perimeterM: 18,
  roomLengthMm: 5000,
  roomWidthMm: 4000,
  sheetLengthMm: 2500,
}

describe('calcCeiling — Сапфир', () => {
  const res = calcCeiling(BASE)

  it('лист подписан как "Сапфир", не "ГСП"', () => {
    const item = res.materials.find(m => m.name.startsWith('Сапфир'))
    expect(item).toBeDefined()
    expect(item!.name).toBe('Сапфир 12.5мм')
  })

  it('саморезы — XTN, не TN', () => {
    const item = res.materials.find(m => m.name.includes('Шуруп') && m.name.includes('25мм'))
    expect(item).toBeDefined()
    expect(item!.name).toBe('Шуруп XTN 25мм (1й слой)')
  })
})

describe('boardSpecFromCeilingSpec — Сапфир', () => {
  it('маппится в material=sapphire (не в gkl), фиксированный сортамент 12.5/1200/2500', () => {
    const spec = boardSpecFromCeilingSpec(BASE)
    expect(spec.material).toBe('sapphire')
    expect(spec.thickness).toBe(12.5)
    expect(spec.sheetWidth).toBe(1200)
    expect(spec.sheetLength).toBe(2500)
  })
})
