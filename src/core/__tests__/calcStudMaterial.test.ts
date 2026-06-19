import { describe, it, expect } from 'vitest'
import { calcStudMaterial, middleStudPieceCount, middleStudTotalLength, STUD_LENGTH } from '../calcStudMaterial'

describe('calcStudMaterial', () => {

  // ─── Вспомогательные функции ─────────────────────────────────────────────

  it('middleStudPieceCount: h≤3000 → 1 кусок', () => {
    expect(middleStudPieceCount(2700, 750)).toBe(1)
    expect(middleStudPieceCount(3000, 750)).toBe(1)
  })

  it('middleStudPieceCount: n=2 для типичных h=3001..5250, ПС75', () => {
    expect(middleStudPieceCount(3600, 750)).toBe(2)  // step=2250, (600/2250)→1
    expect(middleStudPieceCount(5250, 750)).toBe(2)  // (2250/2250)=1→1+1=2
  })

  it('middleStudPieceCount: n=3 при h>5250, ПС75', () => {
    expect(middleStudPieceCount(5251, 750)).toBe(3)
    expect(middleStudPieceCount(6000, 750)).toBe(3)  // (3000/2250)→2→1+2=3
  })

  it('middleStudPieceCount: n=3 при h=5100, ПС100', () => {
    // step=2000, (2100/2000)=1.05→ceil=2→n=3
    expect(middleStudPieceCount(5100, 1000)).toBe(3)
  })

  it('middleStudPieceCount: n=2 при h=5000, ПС100', () => {
    // step=2000, (2000/2000)=1→ceil=1→n=2
    expect(middleStudPieceCount(5000, 1000)).toBe(2)
  })

  it('middleStudTotalLength: h + (n-1)*overlap', () => {
    expect(middleStudTotalLength(3600, 750)).toBe(3600 + 750)          // n=2
    expect(middleStudTotalLength(5100, 1000)).toBe(5100 + 2 * 1000)   // n=3 → 7100
    expect(middleStudTotalLength(2700, 500)).toBe(2700)                // n=1
  })

  // ─── h ≤ 3000: нахлёст не нужен ─────────────────────────────────────────

  it('h=2700: длина = h, нет зон нахлёста', () => {
    const { length, overlapZones } = calcStudMaterial(2700, 'middle', 500, 'up')
    expect(length).toBe(2700)
    expect(overlapZones).toHaveLength(0)
  })

  it('h=3000 (ровно): нахлёст не нужен', () => {
    const { length, overlapZones } = calcStudMaterial(3000, 'middle', 500, 'up')
    expect(length).toBe(3000)
    expect(overlapZones).toHaveLength(0)
  })

  // ─── h > 3000, n=2 ───────────────────────────────────────────────────────

  it('h=3200, overlap=500: длина = 3700, 1 зона', () => {
    const { length, overlapZones } = calcStudMaterial(3200, 'middle', 500, 'up')
    expect(length).toBe(3700)
    expect(overlapZones).toHaveLength(1)
  })

  it('up, n=2: зона физически внутри стойки [step, step+overlap]', () => {
    // step=2250, зона [2250, 3000]
    const { overlapZones } = calcStudMaterial(3600, 'middle', 750, 'up')
    expect(overlapZones).toHaveLength(1)
    expect(overlapZones[0].from).toBe(2250)
    expect(overlapZones[0].to).toBe(3000)
  })

  it('down, n=2: зона симметрично — [h-3000, h-3000+overlap]', () => {
    // h=3600: h-3000=600, зона [600, min(1350, 3600)]=[600,1350]
    const { overlapZones } = calcStudMaterial(3600, 'middle', 750, 'down')
    expect(overlapZones).toHaveLength(1)
    expect(overlapZones[0].from).toBe(600)
    expect(overlapZones[0].to).toBe(1350)
  })

  // ─── h > 3000, n=3 (ключевой кейс из баг-репорта) ───────────────────────

  it('h=5100, ПС100: n=3, длина=7100, 2 зоны', () => {
    const { length, overlapZones } = calcStudMaterial(5100, 'middle', 1000, 'up')
    expect(length).toBe(7100)
    expect(overlapZones).toHaveLength(2)
  })

  it('h=5100 up: зоны физически внутри [0, h]', () => {
    // step=2000; зона0=[2000,3000], зона1=[4000,5000]
    const { overlapZones } = calcStudMaterial(5100, 'middle', 1000, 'up')
    expect(overlapZones[0]).toEqual({ from: 2000, to: 3000 })
    expect(overlapZones[1]).toEqual({ from: 4000, to: 5000 })
    // Обе зоны строго внутри [0, 5100]
    overlapZones.forEach(z => {
      expect(z.from).toBeGreaterThanOrEqual(0)
      expect(z.to).toBeLessThanOrEqual(5100)
    })
  })

  it('h=5100 down: зоны симметричны', () => {
    // зона0=[2100,3100], зона1=[100,1100]
    const { overlapZones } = calcStudMaterial(5100, 'middle', 1000, 'down')
    expect(overlapZones[0]).toEqual({ from: 2100, to: 3100 })
    expect(overlapZones[1]).toEqual({ from: 100,  to: 1100 })
    overlapZones.forEach(z => {
      expect(z.from).toBeGreaterThanOrEqual(0)
      expect(z.to).toBeLessThanOrEqual(5100)
    })
  })

  // ─── kind=wall: всегда h без нахлёста ────────────────────────────────────

  it('wall h>3000: длина = h, нет зон', () => {
    const { length, overlapZones } = calcStudMaterial(3500, 'wall', 500, 'down')
    expect(length).toBe(3500)
    expect(overlapZones).toHaveLength(0)
  })

  it('wall h=5100: длина = h, нет зон', () => {
    const { length, overlapZones } = calcStudMaterial(5100, 'wall', 1000, 'up')
    expect(length).toBe(5100)
    expect(overlapZones).toHaveLength(0)
  })

  // ─── kind=door/window: как middle ────────────────────────────────────────

  it('door h>3000: длина = h + overlap', () => {
    const { length } = calcStudMaterial(3200, 'door', 500, 'up')
    expect(length).toBe(3700)
  })

  // ─── Инварианты: зоны всегда в [0, h] ────────────────────────────────────

  it('инвариант: все зоны нахлёста строго внутри [0, h] для разных h/overlap/orientation', () => {
    const cases: [number, number, 'up' | 'down'][] = [
      [3600, 750,  'up'],   [3600, 750,  'down'],
      [5100, 1000, 'up'],   [5100, 1000, 'down'],
      [5251, 750,  'up'],   [6000, 1000, 'up'],
      [4500, 500,  'down'],
    ]
    for (const [h, ov, ori] of cases) {
      const { overlapZones } = calcStudMaterial(h, 'middle', ov, ori)
      for (const z of overlapZones) {
        expect(z.from).toBeGreaterThanOrEqual(0)
        expect(z.to).toBeLessThanOrEqual(h)
        expect(z.to).toBeGreaterThan(z.from)
      }
    }
  })

  // ─── STUD_LENGTH константа ───────────────────────────────────────────────

  it('STUD_LENGTH = 3000', () => {
    expect(STUD_LENGTH).toBe(3000)
  })
})
