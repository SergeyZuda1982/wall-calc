import { describe, it, expect } from 'vitest'
import {
  calcContourLayout, contourAreaMm2, contourPerimeterMm, validateContour, tessellate, defaultRefEdge,
  type ContourVertex, type ContourLayoutInput,
} from '../calcContourLayout'
import { calcArcLayout, geometryFromChordSagitta } from '../calcArcLayout'

const rect = (w: number, h: number): ContourVertex[] => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
]
const baseInput = (vertices: ContourVertex[], over: Partial<ContourLayoutInput> = {}): ContourLayoutInput => ({
  vertices, refEdge: 0, sheetWidth: 1200, sheetLength: 2500, orientation: 'across',
  shiftU: 0, shiftV: 0, stagger: 0, step: 300, ...over,
})

describe('площадь и периметр', () => {
  it('прямоугольник 4×5 м = 20 м², периметр 18 м', () => {
    expect(contourAreaMm2(rect(4000, 5000)) / 1e6).toBeCloseTo(20, 6)
    expect(contourPerimeterMm(rect(4000, 5000))).toBeCloseTo(18000, 6)
  })
  it('дуга наружу прибавляет сегмент, внутрь — вычитает (обход против часовой)', () => {
    const base = contourAreaMm2(rect(4000, 4000))
    const out = rect(4000, 4000); out[0].sag = -500   // ребро снизу, выгиб вправо от обхода = наружу
    const inn = rect(4000, 4000); inn[0].sag = 500
    expect(contourAreaMm2(out)).toBeGreaterThan(base)
    expect(contourAreaMm2(inn)).toBeLessThan(base)
    expect(contourAreaMm2(out) - base).toBeCloseTo(base - contourAreaMm2(inn), 3)
  })
  it('точная площадь совпадает с численной по разбиению', () => {
    const v = rect(20800, 6000); v[3].sag = 1900 // левая сторона: выгиб влево от обхода (вниз по оси) = внутрь
    const pts = tessellate(v, 0.02)
    let s = 0
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y }
    expect(Math.abs(Math.abs(s / 2) - contourAreaMm2(v)) / contourAreaMm2(v)).toBeLessThan(1e-5)
  })
  it('дуга: периметр — длина дуги, а не хорды', () => {
    const v = rect(4000, 4000); v[0].sag = 500
    expect(contourPerimeterMm(v)).toBeGreaterThan(16000)
  })
})

describe('проверка контура', () => {
  it('меньше трёх вершин', () => expect(validateContour(rect(1, 1).slice(0, 2))).not.toBeNull())
  it('«бабочка» — самопересечение', () => {
    expect(validateContour([{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }])).toMatch(/пересека/)
  })
  it('стрела больше половины хорды', () => {
    const v = rect(1000, 1000); v[0].sag = 600
    expect(validateContour(v)).toMatch(/стрела/i)
  })
  it('нормальный контур — без ошибок', () => expect(validateContour(rect(3000, 2000))).toBeNull())
})

describe('раскладка по прямоугольнику', () => {
  it('3600×5000, лист 1200×2500 поперёк: 6 целых листов, площадь и отходы ноль', () => {
    const r = calcContourLayout(baseInput(rect(3600, 5000)))
    expect(r.error).toBeNull()
    expect(r.sheetCount).toBe(6)
    expect(r.fullCount).toBe(6)
    expect(r.areaM2).toBeCloseTo(18, 6)
    expect(r.wasteM2).toBeCloseTo(0, 6)
  })
  it('4000×4000: листы режутся, отходы = листы − площадь', () => {
    const r = calcContourLayout(baseInput(rect(4000, 4000)))
    expect(r.cutCount).toBeGreaterThan(0)
    expect(r.sheetAreaM2 - r.wasteM2).toBeCloseTo(16, 3)
  })
  it('угол среза: у обрезанного листа 4 угла в мм от угла листа', () => {
    const r = calcContourLayout(baseInput(rect(4000, 4000)))
    const s = r.sheets.find(x => x.status === 'cut')!
    expect(s.corners.length).toBe(4)
    expect(s.arcs.length).toBe(0)
  })
  it('вдоль и поперёк дают одну и ту же площадь контура', () => {
    const a = calcContourLayout(baseInput(rect(4000, 4000), { orientation: 'along' }))
    expect(a.areaM2).toBeCloseTo(16, 6)
  })
})

describe('сверка с вкладкой «Разметка дуги»', () => {
  const ch = 20800, sg = 1900
  // Линза: хорда A→B (с промежуточной вершиной, чтобы вершин было 3) и дуга обратно, выгиб вверх.
  const lensC: ContourVertex[] = [{ x: 0, y: 0 }, { x: ch / 2, y: 0 }, { x: ch, y: 0, sag: -sg }]

  it('число листов то же, что в «Разметке дуги» (18)', () => {
    const r = calcContourLayout(baseInput(lensC))
    const arcSheets = calcArcLayout({
      geometry: geometryFromChordSagitta(ch, sg), sheetWidth: 1200, sheetLength: 2500,
      orientation: 'across', shiftU: 0, shiftV: 0, stagger: 0, step: 300,
    }).sheets
    expect(r.error).toBeNull()
    expect(r.sheetCount).toBe(arcSheets.length)
    expect(r.sheetCount).toBe(18)
  })

  it('отметки листа 1: 0 / 112 / 219 / 324 / 424 (ручной расчёт)', () => {
    const r = calcContourLayout(baseInput(lensC))
    const mk = r.sheets[0].arcs.find(a => a.axis === 'u')!
    expect(mk.rows.map(x => x.pos)).toEqual([0, 300, 600, 900, 1200])
    expect(mk.rows.map(x => x.vals[0])).toEqual([0, 112, 219, 324, 424])
  })

  it('площадь линзы = площадь сегмента круга', () => {
    const R = ch * ch / (8 * sg) + sg / 2
    const th = 2 * Math.asin(ch / 2 / R)
    const seg = (R * R / 2) * (th - Math.sin(th))
    expect(contourAreaMm2(lensC)).toBeCloseTo(seg, 3)
  })

  it('те же отметки при шаге 50: точек больше, значения сходятся с «Разметкой дуги»', () => {
    const r = calcContourLayout(baseInput(lensC, { step: 50 }))
    const arc = calcArcLayout({
      geometry: geometryFromChordSagitta(ch, sg), sheetWidth: 1200, sheetLength: 2500,
      orientation: 'across', shiftU: 0, shiftV: 0, stagger: 0, step: 50,
    }).sheets[0].cuts[0].marks
    const mine = r.sheets[0].arcs[0].rows
    for (const m of arc) {
      const row = mine.find(x => Math.abs(x.pos - m.du) < 1e-6)
      expect(row, `du=${m.du}`).toBeTruthy()
      expect(row!.vals[0]).toBe(m.dv)
    }
  })
})

describe('дуга сбоку: отметки по другой оси', () => {
  it('крутая дуга слева у прямоугольника — отметки считаются по оси v', () => {
    // прямоугольник 3000 × 20800, левая сторона (ребро 3) — дуга внутрь, ребро 0 снизу — опорное
    const v: ContourVertex[] = [
      { x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 20800 }, { x: 0, y: 20800, sag: 0 },
    ]
    v[3].sag = 1900   // сторона сверху вниз, выгиб влево от обхода = вправо в мире = внутрь
    expect(validateContour(v)).toBeNull()
    const r = calcContourLayout(baseInput(v, { step: 250 }))
    expect(r.error).toBeNull()
    const cutArcs = r.sheets.flatMap(s => s.arcs).filter(a => a.edge === 3)
    expect(cutArcs.length).toBeGreaterThan(0)
    expect(cutArcs.every(a => a.axis === 'v')).toBe(true)
  })
})

describe('косые стороны и опорное ребро', () => {
  const trap: ContourVertex[] = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }]
  it('трапеция: площадь по формуле', () => {
    expect(contourAreaMm2(trap) / 1e6).toBeCloseTo(((6000 + 4000) / 2) * 3000 / 1e6, 6)
  })
  it('любое опорное ребро даёт ту же площадь и согласованные отходы', () => {
    for (let e = 0; e < 4; e++) {
      const r = calcContourLayout(baseInput(trap, { refEdge: e }))
      expect(r.error).toBeNull()
      expect(r.areaM2).toBeCloseTo(15, 6)
      expect(r.sheetAreaM2 - r.wasteM2).toBeCloseTo(r.areaM2, 2)
    }
  })
  it('обход по часовой: та же площадь, отходы согласованы', () => {
    const cw = [...trap].reverse()
    const b = calcContourLayout(baseInput(cw))
    expect(b.error).toBeNull()
    expect(b.areaM2).toBeCloseTo(15, 6)
    expect(b.sheetAreaM2 - b.wasteM2).toBeCloseTo(b.areaM2, 2)
  })
  it('по часовой с дугой: отметки не пропадают, площадь та же, что против часовой', () => {
    const ccw: ContourVertex[] = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000, sag: 0 }]
    ccw[2].sag = -600
    const cw: ContourVertex[] = [{ x: 0, y: 4000, sag: 600 }, { x: 6000, y: 4000 }, { x: 6000, y: 0 }, { x: 0, y: 0 }]
    // у «cw» ребро 0 идёт (0,4000)→(6000,4000), выгиб влево от обхода (вниз)… обратное направление у ccw[2]
    // даёт выгиб вверх; чтобы форма совпала, берём sag обратного знака
    cw[0].sag = 600
    const a = calcContourLayout(baseInput(ccw, { refEdge: 0 }))
    const b = calcContourLayout(baseInput(cw, { refEdge: 3 }))
    expect(a.error).toBeNull(); expect(b.error).toBeNull()
    expect(b.areaM2).toBeCloseTo(a.areaM2, 4)
    expect(b.sheets.some(s => s.arcs.length > 0)).toBe(true)
  })
})

describe('эскиз пользователя: дуга, косые стороны, уступы', () => {
  // Условные размеры. Обход против часовой: дуга снизу (внутрь), справа ступени.
  const c: ContourVertex[] = [
    { x: 0, y: 0, sag: 1900 },
    { x: 20800, y: 0 },
    { x: 20800, y: 3000 },
    { x: 20400, y: 3000 },
    { x: 20400, y: 3400 },
    { x: 20800, y: 3400 },
    { x: 20800, y: 5200 },
    { x: 0, y: 5200 },
  ]
  it('валиден, опорное ребро — дуга', () => {
    expect(validateContour(c)).toBeNull()
    expect(defaultRefEdge(c)).toBe(0)
  })
  it('площадь = многоугольник минус сегмент дуги; отходы согласованы', () => {
    const r = calcContourLayout(baseInput(c, { step: 250 }))
    expect(r.error).toBeNull()
    const R = 20800 * 20800 / (8 * 1900) + 1900 / 2
    const th = 2 * Math.asin(20800 / 2 / R)
    const seg = (R * R / 2) * (th - Math.sin(th))
    const poly = 20800 * 5200 - 400 * 400
    expect(r.areaM2 * 1e6).toBeCloseTo(poly - seg, 0)
    expect(r.sheetAreaM2 - r.wasteM2).toBeCloseTo(r.areaM2, 1)
    expect(r.sheets.filter(s => s.arcs.length > 0).length).toBeGreaterThan(10)
  })
  it('лист с дугой имеет углы реза и ординаты', () => {
    const r = calcContourLayout(baseInput(c, { step: 250 }))
    const s = r.sheets.find(x => x.arcs.length > 0)!
    expect(s.corners.length).toBeGreaterThanOrEqual(3)
    expect(s.arcs[0].rows.length).toBeGreaterThan(2)
  })
  it('сдвиг раскладки меняет стыки, но не площадь', () => {
    const a = calcContourLayout(baseInput(c, { shiftU: 0 }))
    const b = calcContourLayout(baseInput(c, { shiftU: 600, shiftV: 300 }))
    expect(b.areaM2).toBeCloseTo(a.areaM2, 6)
    expect(b.sheetAreaM2 - b.wasteM2).toBeCloseTo(b.areaM2, 1)
  })
})

describe('защита', () => {
  it('слишком мелкий лист — понятная ошибка вместо зависания', () => {
    const r = calcContourLayout(baseInput(rect(20000, 20000), { sheetWidth: 5, sheetLength: 5 }))
    expect(r.error).toMatch(/много/)
  })
  it('нулевой лист', () => {
    expect(calcContourLayout(baseInput(rect(2000, 2000), { sheetWidth: 0 })).error).not.toBeNull()
  })
})
