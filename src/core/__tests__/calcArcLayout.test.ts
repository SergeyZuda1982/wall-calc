import { describe, it, expect } from 'vitest'
import {
  arcRadius, arcV, calcArcLayout, geometryFromChordRadius, geometryFromChordSagitta,
  type ArcLayoutInput,
} from '../calcArcLayout'

const g = geometryFromChordSagitta(20800, 1900, [0, 200])
const gOne = geometryFromChordSagitta(20800, 1900)

function input(p: Partial<ArcLayoutInput> = {}): ArcLayoutInput {
  return {
    geometry: g, sheetWidth: 1200, sheetLength: 2500, orientation: 'across',
    shiftU: 0, shiftV: 0, stagger: 0, step: 300, ...p,
  }
}

describe('геометрия дуги', () => {
  it('хорда 20800 + стрела 1900 даёт радиус ≈ 29413', () => {
    expect(g.radius).toBeCloseTo(29413.16, 1)
    expect(arcRadius(g, 1)).toBeCloseTo(29613.16, 1)
  })
  it('хорда + радиус возвращает стрелу 1900', () => {
    const g2 = geometryFromChordRadius(20800, 29413.16)
    expect(g2.sagitta).toBeCloseTo(1900, 1)
  })
  it('вершина 1900/2100, на концах хорды внутренняя дуга = 0', () => {
    expect(arcV(g, 0, 10400)).toBeCloseTo(1900, 3)
    expect(arcV(g, 1, 10400)).toBeCloseTo(2100, 3)
    expect(arcV(g, 0, 0)).toBeCloseTo(0, 3)
    expect(arcV(g, 0, 20800)).toBeCloseTo(0, 3)
  })
})

describe('раскладка поперёк хорды', () => {
  const r = calcArcLayout(input())
  it('столбцы по 1200 от левого конца, лист 1 и лист 9 совпадают с ручным расчётом', () => {
    const s1 = r.sheets.find(s => s.u0 === 0 && s.v0 === 0)!
    expect(s1.cuts[0].marks.map(m => m.dv)).toEqual([0, 112, 219, 324, 424])
    expect(s1.cuts[1].marks.map(m => m.dv)).toEqual([214, 324, 431, 535, 635])
    const s9 = r.sheets.find(s => s.u0 === 9600)!
    expect(s9.cuts[0].marks.map(m => m.dv)).toEqual([1889, 1896, 1899, 1900, 1897])
    expect(s9.cuts[1].marks.map(m => m.dv)).toEqual([2089, 2096, 2099, 2100, 2097])
  })
  it('наружная дуга требует листов за пределами хорды (±10953)', () => {
    const minU = Math.min(...r.sheets.map(s => s.u0))
    const maxU = Math.max(...r.sheets.map(s => s.u1))
    expect(minU).toBeLessThan(0)
    expect(maxU).toBeGreaterThan(20800)
  })
  it('первая дуга не выходит за лист 2500 — один ряд', () => {
    expect(new Set(r.sheets.map(s => s.row)).size).toBe(1)
  })
})

describe('шаг 50 мм и сдвиг', () => {
  it('шаг 50: 25 точек на лист 1200 (0…1200)', () => {
    const r = calcArcLayout(input({ step: 50 }))
    const s = r.sheets.find(x => x.u0 === 9600)!
    expect(s.cuts[0].marks.length).toBe(25)
    expect(s.cuts[0].marks[24].du).toBe(1200)
  })
  it('сдвиг по хорде меняет стыки, ординаты считаются заново', () => {
    const r = calcArcLayout(input({ shiftU: 600 }))
    expect(r.sheets.some(s => s.u0 === 10200)).toBe(true)
    const s = r.sheets.find(x => x.u0 === 9000)!
    // лист 9000–10200 накрывает вершину: в точке u=10200 дуга на 0,7 мм ниже вершины → 1899
    expect(s.cuts[0].marks[s.cuts[0].marks.length - 1].dv).toBe(1899)
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
    const full = r.sheets.filter(s => s.cuts[0].status === 'full')
    expect(full.length).toBeGreaterThan(0)
    expect(r.sheets.every(s => s.cuts[1].status !== 'none')).toBe(true)
  })
  it('сдвиг по v: нижний ряд обрезается по хорде', () => {
    const r2 = calcArcLayout(input({ orientation: 'along', shiftV: 500 }))
    const bottom = r2.sheets.find(s => s.v0 === 0)!
    expect(bottom.h).toBe(500)
    expect(bottom.clippedByChord).toBe(true)
  })
})

describe('необязательные дуги', () => {
  it('одна дуга: листы только в пределах хорды, один рез на лист', () => {
    const r = calcArcLayout(input({ geometry: gOne }))
    expect(r.sheets.every(s => s.cuts.length === 1)).toBe(true)
    expect(Math.min(...r.sheets.map(s => s.u0))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...r.sheets.map(s => s.u0))).toBeLessThan(20800)
    expect(r.sheets).toHaveLength(18)
    expect(r.halfs).toHaveLength(1)
  })
  it('первая дуга не зависит от наличия остальных', () => {
    const one = calcArcLayout(input({ geometry: gOne }))
    const two = calcArcLayout(input())
    const a = one.sheets.find(s => s.u0 === 9600)!
    const b = two.sheets.find(s => s.u0 === 9600)!
    expect(a.cuts[0].marks).toEqual(b.cuts[0].marks)
  })
  it('три дуги: по три реза на лист, радиусы со смещением от первой', () => {
    const g3 = geometryFromChordSagitta(20800, 1900, [0, 200, 500])
    expect(arcRadius(g3, 2)).toBeCloseTo(g3.radius + 500, 6)
    const r = calcArcLayout(input({ geometry: g3 }))
    expect(r.sheets.every(s => s.cuts.length === 3)).toBe(true)
    const s9 = r.sheets.find(s => s.u0 === 9600)!
    expect(s9.cuts[2].marks[3].dv).toBe(2400) // вершина: 1900 + 500
    expect(r.vTop).toBeCloseTo(2400, 6)
  })
})
