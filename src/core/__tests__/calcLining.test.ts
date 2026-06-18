import { describe, it, expect } from 'vitest'
import { calcLining } from '../calcLining'
import type { LiningInput } from '../../types'

const base: LiningInput = {
  liningType: 'c625',
  profileType: 'ps75',
  profileThickness: '06',
  gklLayers: 1,
  length: 6160,
  height: 3600,
  step: 600,
  hangerStep: 1000,
  abutment: 'both',
  openings: [],
}

// Те же 12 позиций, что и в сценарии перегородки 6160×3600 (buildPositions),
// чтобы можно было сверять числа с уже проверенным кейсом партиций.
const positions12 = [0, 600, 1200, 1800, 2400, 3000, 3600, 4200, 4800, 5400, 6000, 6160]

describe('calcLining — wall/middle краевых стоек (С625/С626)', () => {
  it('abutment=both: оба края wall (без нахлёста) — 2×3600 + 10×4350 = 50.70м', () => {
    const res = calcLining(base, positions12)
    expect(res.stud).toBeCloseTo(50.70, 2)
  })

  it('abutment=none: оба края остаются как обычная стойка (с нахлёстом) — 12×4350 = 52.20м', () => {
    const res = calcLining({ ...base, abutment: 'none' }, positions12)
    expect(res.stud).toBeCloseTo(52.20, 2)
  })

  it('abutment=left: левый край wall, правый — обычная стойка с нахлёстом', () => {
    const res = calcLining({ ...base, abutment: 'left' }, positions12)
    // 1×3600(wall) + 10×4350(middle) + 1×4350(правый край как middle) = 3600 + 11×4350 = 51450
    expect(res.stud).toBeCloseTo(51.45, 2)
  })

  it('С623 — нахлёст и wall/middle не применяются (другая система), длина = h', () => {
    const res = calcLining({ ...base, liningType: 'c623', profileType: 'ps75' }, positions12)
    // countablePositions исключает 0 и l для С623 → 10 стоек по h=3600
    expect(res.studsCount).toBe(10)
    expect(res.stud).toBeCloseTo(36.00, 2)
  })

  it('раскрой ПС: сумма кусков studPcs совпадает с заявленным метражом stud', () => {
    const res = calcLining(base, positions12)
    const sumMm = res.rawPieces.stud.reduce((s, p) => s + p.length, 0)
    expect(sumMm).toBe(Math.round(res.stud * 1000))
  })

  it('никакой кусок в раскрое стоек не длиннее прутка 3000мм', () => {
    const res = calcLining(base, positions12)
    expect(res.rawPieces.stud.every(p => p.length <= 3000)).toBe(true)
    expect(res.cutList.stud.totalBars).toBeGreaterThan(0)
  })

  it('h<=3000: и wall, и middle — один кусок без нахлёста', () => {
    const res = calcLining({ ...base, height: 2700 }, positions12)
    expect(res.stud).toBeCloseTo((2700 * 12) / 1000, 2)
  })
})
