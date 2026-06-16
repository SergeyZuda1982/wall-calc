import { describe, it, expect } from 'vitest'
import { calcStudMaterial, STUD_LENGTH } from '../calcStudMaterial'

describe('calcStudMaterial', () => {
  // ─── h ≤ 3000: нахлёст не нужен ─────────────────────────────────────────

  it('h=2700: длина = h, нет зоны нахлёста', () => {
    const { length, overlapZone } = calcStudMaterial(2700, 'middle', 500, 'up')
    expect(length).toBe(2700)
    expect(overlapZone).toBeNull()
  })

  it('h=3000 (ровно): нахлёст не нужен', () => {
    const { length, overlapZone } = calcStudMaterial(3000, 'middle', 500, 'up')
    expect(length).toBe(3000)
    expect(overlapZone).toBeNull()
  })

  // ─── h > 3000, kind=middle ────────────────────────────────────────────────

  it('h=3200, overlap=500: длина = 3200+500 = 3700', () => {
    const { length } = calcStudMaterial(3200, 'middle', 500, 'up')
    expect(length).toBe(3700)
  })

  it('ориентация up: стык на 3000, зона нахлёста выше стыка', () => {
    const { overlapZone } = calcStudMaterial(3500, 'middle', 500, 'up')
    expect(overlapZone).toEqual({ from: 3000, to: 3500 })
  })

  it('ориентация down: стык на h−3000, зона нахлёста ниже стыка', () => {
    // h=3500, jointH = 3500−3000 = 500
    const { overlapZone } = calcStudMaterial(3500, 'middle', 500, 'down')
    expect(overlapZone).toEqual({ from: 0, to: 500 })
  })

  it('overlap=750: зона правильная', () => {
    const { overlapZone, length } = calcStudMaterial(3800, 'middle', 750, 'up')
    expect(length).toBe(3800 + 750)
    expect(overlapZone).toEqual({ from: 3000, to: 3750 })
  })

  // ─── kind=wall: всегда h без нахлёста ────────────────────────────────────

  it('wall h>3000: длина = h, нет зоны (примыкание к конструкции)', () => {
    const { length, overlapZone } = calcStudMaterial(3500, 'wall', 500, 'down')
    expect(length).toBe(3500)
    expect(overlapZone).toBeNull()
  })

  // ─── kind=door: как middle ────────────────────────────────────────────────

  it('door h>3000: длина = h + overlap', () => {
    const { length } = calcStudMaterial(3200, 'door', 500, 'up')
    expect(length).toBe(3700)
  })

  // ─── STUD_LENGTH константа ───────────────────────────────────────────────

  it('STUD_LENGTH = 3000', () => {
    expect(STUD_LENGTH).toBe(3000)
  })
})
