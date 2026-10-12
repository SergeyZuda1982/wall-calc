import { describe, it, expect } from 'vitest'
import { boardLabel, screwCode, migrateBoard, BOARD_LABEL, type BoardSpec } from '../../types'
import { resolveMaxHeightGroup } from '../../data/maxHeight'
import { calcSheetLayout } from '../calcSheetLayout'
import { flatProfile } from '../profileGeometry'

const fireboard: BoardSpec = { material: 'fireboard', subtype: null, thickness: 12.5, sheetWidth: 1200, sheetLength: 2500 }

describe('Файерборд как материал обшивки (12.10.2026)', () => {
  it('подпись и справочник', () => {
    expect(boardLabel(fireboard)).toBe('Файерборд')
    expect(BOARD_LABEL.fireboard).toBe('Файерборд')
  })
  it('саморез TN (как у ГКЛ), не XTN', () => {
    expect(screwCode(fireboard)).toBe('TN')
  })
  it('таблица максимальных высот — консервативная группа standard', () => {
    expect(resolveMaxHeightGroup('fireboard')).toBe('standard')
  })
  it('migrateBoard не ломает сохранённую спеку Файерборда', () => {
    expect(migrateBoard(fireboard)).toEqual(fireboard)
  })
  it('раскрой работает: стена 3000×2500 считается листами 1200×2500', () => {
    const r = calcSheetLayout(3000, flatProfile(3000, 2500), flatProfile(3000, 0), 600, 600, 1, [], fireboard, fireboard, 1)
    expect(r.layer1.sheetsNeeded).toBeGreaterThan(0)
    expect(r.layer1.spec.material).toBe('fireboard')
    expect(r.totalUsedAreaM2).toBeCloseTo(7.5, 1)
  })
})
