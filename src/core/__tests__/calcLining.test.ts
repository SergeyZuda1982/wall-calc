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

  it('С623 h<=3000: один кусок на стойку, без нахлёста и удлинителей в раскрое', () => {
    const positions5 = [0, 600, 1200, 1800, 2400, 3000]
    const res = calcLining({ ...base, liningType: 'c623', profileType: 'ps75', length: 3000, height: 2700 }, positions5)
    expect(res.studsCount).toBe(4) // исключает 0 и 3000
    expect(res.stud).toBeCloseTo(10.80, 2) // 4×2700
    expect(res.rawPieces.stud.every(p => p.length <= 3000)).toBe(true)
  })

  it('С623 h>3000: стойки режутся торец в торец (3000+остаток), раскрой не пустой', () => {
    const positions5 = [0, 600, 1200, 1800, 2400, 3000]
    const res = calcLining({ ...base, liningType: 'c623', profileType: 'ps75', length: 3000, height: 3500 }, positions5)
    expect(res.studsCount).toBe(4)
    expect(res.stud).toBeCloseTo(14.00, 2) // 4×3500
    // 4 стойки → 4×(3000+500) = 8 кусков, все ≤ 3000
    expect(res.rawPieces.stud.length).toBe(8)
    expect(res.rawPieces.stud.every(p => p.length <= 3000)).toBe(true)
    expect(res.cutList.stud.totalBars).toBeGreaterThan(0)
  })

  it('раскрой ПС: сумма кусков studPcs совпадает с заявленным метражом stud', () => {
    const res = calcLining(base, positions12)
    const sumMm = res.rawPieces.stud.reduce((s, p) => s + p.length, 0)
    expect(sumMm).toBe(Math.round(res.stud * 1000))
  })

  it('никакой кусок в раскрое стоек не длиннее профиля 3000мм', () => {
    const res = calcLining(base, positions12)
    expect(res.rawPieces.stud.every(p => p.length <= 3000)).toBe(true)
    expect(res.cutList.stud.totalBars).toBeGreaterThan(0)
  })

  it('h<=3000: и wall, и middle — один кусок без нахлёста', () => {
    const res = calcLining({ ...base, height: 2700 }, positions12)
    expect(res.stud).toBeCloseTo((2700 * 12) / 1000, 2)
  })
})

// ─── Переменная геометрия: мансардный скос потолка (облицовка) ──────────────

describe('calcLining — переменная геометрия (ceilingProfile/floorProfile)', () => {
  it('плоский профиль через flatProfile даёт тот же результат, что и старая модель с h', () => {
    const ceilingProfile = [{ x: 0, y: 3600 }, { x: 6160, y: 3600 }]
    const floorProfile = [{ x: 0, y: 0 }, { x: 6160, y: 0 }]
    const res = calcLining({ ...base, ceilingProfile, floorProfile }, positions12)
    expect(res.stud).toBeCloseTo(50.70, 2) // тот же эталон, что и в плоской регрессии выше
  })

  it('скошенный потолок: крайние стойки (wall) имеют разную длину по высоте в своей точке', () => {
    const ceilingProfile = [{ x: 0, y: 2500 }, { x: 6160, y: 3600 }]
    const floorProfile = [{ x: 0, y: 0 }, { x: 6160, y: 0 }]
    const res = calcLining({ ...base, ceilingProfile, floorProfile }, positions12)
    // Левый край (h=2500, ≤3000) — один кусок 2500мм, правый (h=3600) — наращивается
    expect(res.rawPieces.stud[0].length).toBe(2500)
    const lastPieces = res.rawPieces.stud.filter(p => p.length === 3000 || p.length > 0)
    expect(lastPieces.length).toBeGreaterThan(0)
  })

  it('needsOverlap учитывает максимум по геометрии, а не высоту в x=0', () => {
    const ceilingProfile = [{ x: 0, y: 2000 }, { x: 6160, y: 3600 }]
    const floorProfile = [{ x: 0, y: 0 }, { x: 6160, y: 0 }]
    const res = calcLining({ ...base, ceilingProfile, floorProfile }, positions12)
    expect(res.needsOverlap).toBe(true) // правый край > 3000, хотя в x=0 высота всего 2000
  })

  it('С623: боковая направляющая считается по локальной высоте в своей точке (0 и l)', () => {
    const ceilingProfile = [{ x: 0, y: 2000 }, { x: 3000, y: 3000 }]
    const floorProfile = [{ x: 0, y: 0 }, { x: 3000, y: 0 }]
    const positions5 = [0, 600, 1200, 1800, 2400, 3000]
    const res = calcLining({
      ...base, liningType: 'c623', profileType: 'ps75', length: 3000, height: 2500,
      ceilingProfile, floorProfile,
    }, positions5)
    // Боковые: heightAt(0)=2000 (1 кусок) + heightAt(3000)=3000 (1 кусок) = 2 куска по 1 стороне каждый
    const sideRailPieces = res.rawPieces.pn.filter(p => p.label.startsWith('Боковая'))
    expect(sideRailPieces.map(p => p.length).sort((a, b) => a - b)).toEqual([2000, 3000])
  })

  it('гклArea для скошенного потолка считается интегралом (трапеция), не l×h', () => {
    const ceilingProfile = [{ x: 0, y: 2000 }, { x: 4000, y: 3000 }]
    const floorProfile = [{ x: 0, y: 0 }, { x: 4000, y: 0 }]
    const res = calcLining({ ...base, length: 4000, ceilingProfile, floorProfile }, [0, 2000, 4000])
    const expected = ((2000 + 3000) / 2 * 4000) / 1_000_000 // без ×2 — облицовка однослойная по площади (не считает обе стороны)
    expect(res.gklArea).toBeCloseTo(expected, 2)
  })
})
