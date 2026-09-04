import { describe, it, expect } from 'vitest'
import {
  flatEdgeProfile, areaByPriceTier, columnRunByPriceTier, sumTierSplits, tierSplitCost,
  PRICE_TIER_THRESHOLD_MM,
} from '../laborPriceTiers'

const approx = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('areaByPriceTier — flat wall, no slope', () => {
  it('height below 3000mm: all area at lower tier', () => {
    const profile = flatEdgeProfile(4000, 2700)
    const s = areaByPriceTier(profile)
    approx(s.belowM2, 4 * 2.7)
    approx(s.aboveM2, 0)
  })

  it('height above 3000mm: split into a 3000mm strip + the remainder', () => {
    const profile = flatEdgeProfile(4000, 3500)
    const s = areaByPriceTier(profile)
    approx(s.belowM2, 4 * 3)     // полоса до порога по всей длине
    approx(s.aboveM2, 4 * 0.5)   // остаток выше порога
  })

  it('height exactly at threshold: all below, nothing above', () => {
    const profile = flatEdgeProfile(4000, PRICE_TIER_THRESHOLD_MM)
    const s = areaByPriceTier(profile)
    approx(s.belowM2, 4 * 3)
    approx(s.aboveM2, 0)
  })
})

describe("areaByPriceTier — Сергей's example: 6400mm, 4500→5200mm, никогда не ниже порога", () => {
  it('below tier = full 3000mm strip, above tier = the sloped remainder', () => {
    const profile: import('../../types').EdgeProfile = [{ x: 0, y: 4500 }, { x: 6400, y: 5200 }]
    const s = areaByPriceTier(profile)
    approx(s.belowM2, 6.4 * 3)                  // 19.2 м²
    approx(s.aboveM2, 6.4 * ((1500 + 2200) / 2 / 1000)) // 11.84 м² (трапеция остатка)
    approx(s.belowM2 + s.aboveM2, 6.4 * ((4500 + 5200) / 2 / 1000)) // сходится с полной площадью
  })
})

describe('areaByPriceTier — profile crosses the threshold mid-run', () => {
  it('rising through the threshold', () => {
    // 10000мм, высота линейно 2000 -> 4000, порог 3000 ровно на середине (x=5000)
    const profile: import('../../types').EdgeProfile = [{ x: 0, y: 2000 }, { x: 10000, y: 4000 }]
    const s = areaByPriceTier(profile)
    // низ: треугольник 0..5000 (2000..3000) + прямоугольник 5000..10000 на 3000
    const belowExpected = (5 * (2 + 3) / 2) + (5 * 3)
    // верх: треугольник 5000..10000 (0..1000)
    const aboveExpected = 5 * 1 / 2
    approx(s.belowM2, belowExpected)
    approx(s.aboveM2, aboveExpected)
  })

  it('falling through the threshold (mirror of rising)', () => {
    const profile: import('../../types').EdgeProfile = [{ x: 0, y: 4000 }, { x: 10000, y: 2000 }]
    const s = areaByPriceTier(profile)
    const belowExpected = (5 * 3) + (5 * (3 + 2) / 2)
    const aboveExpected = 5 * 1 / 2
    approx(s.belowM2, belowExpected)
    approx(s.aboveM2, aboveExpected)
  })
})

describe('areaByPriceTier — multi-segment profile (piecewise slope) and steps', () => {
  it('sums segment by segment', () => {
    const profile: import('../../types').EdgeProfile = [
      { x: 0, y: 2500 }, { x: 3000, y: 2500 }, { x: 3000, y: 3500 }, { x: 8000, y: 3500 },
    ]
    const s = areaByPriceTier(profile)
    // сегмент 1: 3м x 2.5м ровный, весь ниже порога
    // сегмент-ступень (0 ширины) — площадь 0, игнорируется
    // сегмент 2: 5м x 3.5м ровный -> 3м ниже, 0.5м выше
    approx(s.belowM2, 3 * 2.5 + 5 * 3)
    approx(s.aboveM2, 5 * 0.5)
  })
})

describe('columnRunByPriceTier', () => {
  it("Сергей's example: column 4200mm -> 3m below + 1.2m above", () => {
    const s = columnRunByPriceTier(4200)
    approx(s.belowM, 3)
    approx(s.aboveM, 1.2)
    expect(s.belowM2).toBe(0)
    expect(s.aboveM2).toBe(0)
  })

  it('column below threshold entirely', () => {
    const s = columnRunByPriceTier(2700)
    approx(s.belowM, 2.7)
    approx(s.aboveM, 0)
  })
})

describe('sumTierSplits + tierSplitCost', () => {
  it('combines area (partitions) and run (columns) under the same two rates', () => {
    const wall = areaByPriceTier(flatEdgeProfile(4000, 3500))       // 12 below, 2 above
    const column = columnRunByPriceTier(4200)                       // 3 below, 1.2 above
    const total = sumTierSplits([wall, column])
    approx(total.belowM2, 12)
    approx(total.aboveM2, 2)
    approx(total.belowM, 3)
    approx(total.aboveM, 1.2)
    const cost = tierSplitCost(total, 1200, 1400)
    approx(cost, (12 + 3) * 1200 + (2 + 1.2) * 1400)
  })
})
