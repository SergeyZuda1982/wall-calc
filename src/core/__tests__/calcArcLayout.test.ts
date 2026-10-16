import { describe, it, expect } from 'vitest'
import {
  arcV, calcArcLayout, geometryFromChordRadius, geometryFromChordSagitta,
  type ArcLayoutInput,
} from '../calcArcLayout'

const g = geometryFromChordSagitta(20800, 1900, 200)

function input(p: Partial<ArcLayoutInput> = {}): ArcLayoutInput {
  return {
    geometry: g, sheetWidth: 1200, sheetLength: 2500, orientation: 'across',
    shiftU: 0, shiftV: 0, stagger: 0, step: 300, ...p,
  }
}

describe('геометрия дуги', () => {
  it('хорда 20800 + стрела 1900 даёт радиус ≈ 29413', () => {
    expect(g.radiusInner).toBeCloseTo(29413.16, 1)
    expect(g.radiusOuter).toBeCloseTo(29613.16, 1)
  })
  it('хорда + радиус возвращает стрелу 1900', () => {
    const g2 = geometryFromChordRadius(20800, 29413.16, 200)
    expect(g2.sagitta).toBeCloseTo(1900, 1)
  })
  it('вершина 1900/2100, на концах хорды внутренняя дуга = 0', () => {
    expect(arcV(g, 'inner', 10400)).toBeCloseTo(1900, 3)
    expect(arcV(g, 'outer', 10400)).toBeCloseTo(2100, 3)
    expect(arcV(g, 'inner', 0)).toBeCloseTo(0, 3)
    expect(arcV(g, 'inner', 20800)).toBeCloseTo(0, 3)
  })
})

describe('раскладка поперёк хорды', () => {
  const r = calcArcLayout(input())
  it('столбцы по 1200 от левого конца, лист 1 и лист 9 совпадают с ручным расчётом', () => {
    const s1 = r.sheets.find(s => s.u0 === 0 && s.v0 === 0)!
    expect(s1.inner.marks.map(m => m.dv)).toEqual([0, 112, 219, 324, 424])
    expect(s1.outer.marks.map(m => m.dv)).toEqual([214, 324, 431, 535, 635])
    const s9 = r.sheets.find(s => s.u0 === 9600)!
    expect(s9.inner.marks.map(m => m.dv)).toEqual([1889, 1896, 1899, 1900, 1897])
    expect(s9.outer.marks.map(m => m.dv)).toEqual([2089, 2096, 2099, 2100, 2097])
  })
  it('наружная дуга требует листов за пределами хорды (±10953)', () => {
    const minU = Math.min(...r.sheets.map(s => s.u0))
    const maxU = Math.max(...r.sheets.map(s => s.u1))
    expect(minU).toBeLessThan(0)
    expect(maxU).toBeGreaterThan(20800)
  })
  it('внутренняя дуга не выходит за лист 2500 — один ряд', () => {
    expect(new Set(r.sheets.map(s => s.row)).size).toBe(1)
  })
})

describe('шаг 50 мм и сдвиг', () => {
  it('шаг 50: 25 точек на лист 1200 (0…1200)', () => {
    const r = calcArcLayout(input({ step: 50 }))
    const s = r.sheets.find(x => x.u0 === 9600)!
    expect(s.inner.marks.length).toBe(25)
    expect(s.inner.marks[24].du).toBe(1200)
  })
  it('сдвиг по хорде меняет стыки, ординаты считаются заново', () => {
    const r = calcArcLayout(input({ shiftU: 600 }))
    expect(r.sheets.some(s => s.u0 === 10200)).toBe(true)
    const s = r.sheets.find(x => x.u0 === 9000)!
    // лист 9000–10200 накрывает вершину: в точке u=10200 дуга на 0,7 мм ниже вершины → 1899
    expect(s.inner.marks[s.inner.marks.length - 1].dv).toBe(1899)
  })
})

describe('раскладка вдоль хорды', () => {
  const r = calcArcLayout(input({ orientation: 'along', stagger: 1250 }))
  it('листы 2500 × 1200, несколько рядов', () => {
    expect(r.sheets[0].w).toBe(2500)
    expect(new Set(r.sheets.map(s => s.row)).size).toBeGreaterThanOrEqual(2)
  })
  it('ряды сдвинуты вразбежку', () => {
    const rows = [...new Set(r.sheets.map(s => s.row))]
    const u0Row0 = r.sheets.find(s => s.row === rows[0])!.u0 % 2500
    const u0Row1 = r.sheets.find(s => s.row === rows[1])!.u0 % 2500
    expect(Math.abs(u0Row0 - u0Row1) % 2500).not.toBe(0)
  })
  it('листы под внутренней дугой целиком помечены full, за дугой не попадают', () => {
    const full = r.sheets.filter(s => s.inner.status === 'full')
    expect(full.length).toBeGreaterThan(0)
    expect(r.sheets.every(s => s.outer.status !== 'none')).toBe(true)
  })
  it('сдвиг по v: нижний ряд обрезается по хорде', () => {
    const r2 = calcArcLayout(input({ orientation: 'along', shiftV: 500 }))
    const bottom = r2.sheets.find(s => s.v0 === 0)!
    expect(bottom.h).toBe(500)
    expect(bottom.clippedByChord).toBe(true)
  })
})
