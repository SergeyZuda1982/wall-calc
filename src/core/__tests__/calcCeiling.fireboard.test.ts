import { describe, it, expect } from 'vitest'
import { calcCeiling } from '../calcCeiling'
import { boardSpecFromCeilingSpec } from '../calcProjectSheetLayout'
import type { CeilingSpecFull } from '../../data/ceilingData'

// Потолок П112.2 из ГСП-ПНКФ (Файерборд) — как в ведомости отделки кинотеатра «Ростов»
const BASE: CeilingSpecFull = {
  type: 'p112', layers: 2, material: 'fireboard', thickness: 12.5, stepC: 600,
  areaSqm: 20, perimeterM: 18, roomLengthMm: 5000, roomWidthMm: 4000, sheetLengthMm: 2500,
}

describe('calcCeiling — Файерборд (ГСП-ПНКФ)', () => {
  const res = calcCeiling(BASE)

  it('лист подписан «Файерборд», не «ГСП»', () => {
    expect(res.materials.some(m => m.name === 'Файерборд 12.5мм')).toBe(true)
    expect(res.materials.some(m => m.name.startsWith('ГСП '))).toBe(false)
  })

  it('саморезы XTN (как у Сапфира), не TN', () => {
    const item = res.materials.find(m => m.name.includes('Шуруп') && m.name.includes('25мм'))
    expect(item!.name).toBe('Шуруп XTN 25мм (1й слой)')
  })

  it('boardSpecFromCeilingSpec → material=fireboard, 12.5/1200/2500', () => {
    const spec = boardSpecFromCeilingSpec(BASE)
    expect(spec).toMatchObject({ material: 'fireboard', thickness: 12.5, sheetWidth: 1200, sheetLength: 2500 })
  })
})
