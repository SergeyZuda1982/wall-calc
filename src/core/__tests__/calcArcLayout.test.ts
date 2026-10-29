import { describe, it, expect } from 'vitest'
import {
  arcRadius, arcV, bandGeometry, calcArcLayout, crossingNotes, dragColumnOffset, findCrossings, geometryFromChordRadius, geometryFromChordSagitta, ordinateOffsets,
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

describe('ordinateOffsets: отступы от крайней линии', () => {
  // ординаты листа из скриншота пользователя, отметки 750…1200 через 50 мм
  const shot = [1798, 1802, 1806, 1810, 1814, 1818, 1821, 1825, 1828, 1832]
  it('от верхней: 1832 → 0, 1828 → 4, 1825 → 7, 1821 → 11, 1818 → 14 (пример пользователя)', () => {
    const r = ordinateOffsets(shot, 'top')
    expect(r.top).toBe(1832)
    expect(r.bottom).toBe(1798)
    expect(r.span).toBe(34)
    expect(r.offsets.slice(-5).reverse()).toEqual([0, 4, 7, 11, 14])
    expect(r.offsets[0]).toBe(34)
  })
  it('от нижней: наименьшая получает 0', () => {
    const r = ordinateOffsets(shot, 'bottom')
    expect(r.offsets[0]).toBe(0)
    expect(r.offsets[9]).toBe(34)
  })
  it('краевые отметки (null) в границы не входят и дают null', () => {
    const r = ordinateOffsets([0, 112, 219, null, 424], 'top')
    expect(r.top).toBe(424)
    expect(r.bottom).toBe(0)
    expect(r.offsets).toEqual([424, 312, 205, null, 0])
  })
  it('пустой набор и одни null', () => {
    expect(ordinateOffsets([], 'top')).toEqual({ offsets: [], top: null, bottom: null, span: 0 })
    expect(ordinateOffsets([null, null], 'top').offsets).toEqual([null, null])
  })
  it('сходится с настоящей раскладкой: у листа 9 дуга почти горизонтальна, разброс малый', () => {
    const lay = calcArcLayout(input({ geometry: gOne, step: 50 }))
    const s9 = lay.sheets.find(s => s.id === 9)!
    const r = ordinateOffsets(s9.cuts[0].marks.map(m => (m.clipped ? null : m.dv)), 'top')
    expect(r.top).toBe(1900)
    expect(r.span).toBeLessThan(15)
  })
})



describe('выход линии реза на кромку листа', () => {
  it('находит точку, где дуга уходит в 0 на нижней кромке (крайний лист)', () => {
    const lay = calcArcLayout(input({ geometry: gOne }))
    // Крайний левый лист нижнего ряда: дуга выходит из нуля где-то внутри листа.
    const sheet = lay.sheets.find(s => s.row === 0 && s.cuts[0].crossings.length > 0)
    expect(sheet).toBeTruthy()
    const c = sheet!.cuts[0].crossings.find(x => x.edge === 'bottom')!
    expect(c.du + c.duRight).toBe(sheet!.w)
    // В найденной точке высота дуги над нижней кромкой листа ≈ 0.
    const dv = arcV(gOne, 0, sheet!.u0 + c.du) - sheet!.v0
    expect(Math.abs(dv)).toBeLessThan(1)
  })
  it('точка лежит между отметками: до неё отметка 0, после — больше нуля', () => {
    const lay = calcArcLayout(input({ geometry: gOne, step: 300 }))
    const sheet = lay.sheets.find(s => s.row === 0 && s.cuts[0].crossings.some(x => x.edge === 'bottom'))!
    const c = sheet.cuts[0].crossings.find(x => x.edge === 'bottom')!
    const before = sheet.cuts[0].marks.filter(m => m.du < c.du).pop()
    const after = sheet.cuts[0].marks.find(m => m.du > c.du)
    const lo = c.rising ? before : after
    const hi = c.rising ? after : before
    expect(lo?.dv).toBe(0)
    expect(hi!.dv).toBeGreaterThan(0)
  })
  it('верхняя кромка: дуга пересекает верх листа в найденной точке', () => {
    const w = 1200, h = 2500
    const list = findCrossings(gOne, 0, 0, w, 0, h)
    for (const c of list) {
      const dv = arcV(gOne, 0, c.du) - 0
      expect(Math.abs(dv - (c.edge === 'bottom' ? 0 : h))).toBeLessThan(2)
    }
  })
  it('лист целиком под дугой или за ней — пересечений нет', () => {
    const lay = calcArcLayout(input({ geometry: gOne }))
    for (const s of lay.sheets) {
      if (s.cuts[0].status !== 'cut') expect(s.cuts[0].crossings).toEqual([])
    }
  })
  it('текст для разметчика называет расстояние от левой и от правой кромки', () => {
    const lay = calcArcLayout(input({ geometry: gOne }))
    const sheet = lay.sheets.find(s => s.cuts[0].crossings.some(x => x.edge === 'bottom'))!
    const txt = crossingNotes(sheet.cuts[0]).join(' ')
    expect(txt).toContain('от левой кромки')
    expect(txt).toContain('от правой')
  })
})

describe('разбежка стыков между колонками', () => {
  const base = () => input({ geometry: bandGeometry(geometryFromChordSagitta(20708, 1823), 3544), orientation: 'across' })
  const joints = (lay: ReturnType<typeof calcArcLayout>, col: number) =>
    lay.sheets.filter(s => s.col === col).map(s => Math.round(s.v0)).sort((x, y) => x - y)

  it('выключена: поведение прежнее (стыки колонок на одной высоте, нумерация та же)', () => {
    const a = calcArcLayout(base())
    const b = calcArcLayout({ ...base(), colStaggerV: 0, colOffsets: {} })
    expect(b.sheets.map(s => [s.id, s.row, s.col, s.v0])).toEqual(a.sheets.map(s => [s.id, s.row, s.col, s.v0]))
  })
  it('0–500–0–500: нечётные колонки сдвинуты по высоте на 500, чётные нет', () => {
    const lay = calcArcLayout({ ...base(), colStaggerV: 500 })
    const cols = [...new Set(lay.sheets.map(s => s.col))]
    for (const c of cols) {
      const js = lay.sheets.filter(s => s.col === c && s.v0 > 0).map(s => Math.round(s.v0 % 2500))
      const expected = (((c % 2) + 2) % 2) === 1 ? 500 : 0
      for (const j of js) expect(j).toBe(expected)
    }
  })
  it('соседние колонки: стыки по высоте различаются на 500 (по модулю листа)', () => {
    const lay = calcArcLayout({ ...base(), colStaggerV: 500 })
    const cols = [...new Set(lay.sheets.map(s => s.col))].sort((p, q) => p - q)
    const j = (c: number) => Math.round(lay.sheets.find(s => s.col === c && s.v0 > 0)!.v0 % 2500)
    for (let k = 1; k < cols.length; k++) expect(Math.abs(j(cols[k]) - j(cols[k - 1]))).toBe(500)
  })
  it('ручной сдвиг колонки заменяет автоматический', () => {
    const auto = calcArcLayout({ ...base(), colStaggerV: 500 })
    const mid = [...new Set(auto.sheets.map(s => s.col))].sort((p, q) => p - q)[3]
    const lay = calcArcLayout({ ...base(), colStaggerV: 500, colOffsets: { [mid]: 1500 } })
    const js = lay.sheets.filter(s => s.col === mid && s.v0 > 0).map(s => Math.round(s.v0 % 2500))
    expect(js.length).toBeGreaterThan(0)
    for (const x of js) expect(x).toBe(1500)
    // остальные колонки не тронуты
    const other = [...new Set(auto.sheets.map(s => s.col))].find(c => c !== mid)!
    expect(joints(lay, other)).toEqual(joints(auto, other))
  })
  it('ручной сдвиг работает и при выключенной авторазбежке', () => {
    const lay0 = calcArcLayout(base())
    const col = [...new Set(lay0.sheets.map(s => s.col))][2]
    const lay = calcArcLayout({ ...base(), colStaggerV: 0, colOffsets: { [col]: 1000 } })
    const js = lay.sheets.filter(s => s.col === col && s.v0 > 0).map(s => Math.round(s.v0 % 2500))
    for (const x of js) expect(x).toBe(1000)
  })
  it('площадь листов не теряется: каждая колонка закрывает полосу целиком', () => {
    const lay = calcArcLayout({ ...base(), colStaggerV: 500 })
    // Суммарная площадь, оставленная под нижней кромкой минус под верхней = площадь полосы — не зависит от раскладки.
    const band = lay.sheets.reduce((s, sh) => s + sh.cuts[1].keptAreaM2 - sh.cuts[0].keptAreaM2, 0)
    const lay0 = calcArcLayout(base())
    const band0 = lay0.sheets.reduce((s, sh) => s + sh.cuts[1].keptAreaM2 - sh.cuts[0].keptAreaM2, 0)
    expect(band).toBeCloseTo(band0, 2)
  })
})

describe('разбежка колонок только поперёк хорды', () => {
  it('вдоль хорды colStaggerV игнорируется, остаётся смещение рядов', () => {
    const p = { orientation: 'along' as const, stagger: 600 }
    const a = calcArcLayout(input(p))
    const b = calcArcLayout(input({ ...p, colStaggerV: 500, colOffsets: { 1: 700 } }))
    expect(b.sheets.map(s => [s.id, s.u0, s.v0])).toEqual(a.sheets.map(s => [s.id, s.u0, s.v0]))
  })
})

describe('перетаскивание колонки', () => {
  it('смещение округляется до шага', () => {
    expect(dragColumnOffset(0, 240, 500, 2500)).toBe(0)
    expect(dragColumnOffset(0, 260, 500, 2500)).toBe(500)
    expect(dragColumnOffset(500, 1010, 500, 2500)).toBe(1500)
    expect(dragColumnOffset(0, 130, 250, 2500)).toBe(250)
  })
  it('вниз — в минус, по кругу в пределах листа', () => {
    expect(dragColumnOffset(500, -500, 500, 2500)).toBe(0)
    expect(dragColumnOffset(0, -500, 500, 2500)).toBe(2000)
    expect(dragColumnOffset(2000, 1000, 500, 2500)).toBe(500)
  })
  it('шаг ≤ 0 не ломает расчёт', () => {
    expect(Number.isFinite(dragColumnOffset(0, 10, 0, 2500))).toBe(true)
  })
})
