/**
 * calcArcLayout.ts — «Разметка дуги» (15.10.2026).
 *
 * Задача: потолок оканчивается дугой очень большого радиуса (20+ м), циркулем
 * её на листе не прочертить. Модуль раскладывает листы ГКЛ в системе координат
 * «вдоль хорды / от хорды» и для каждого листа выдаёт ординаты дуги — расстояния
 * от кромки листа до линии реза через заданный шаг (по умолчанию 50 мм).
 *
 * Система координат (мм):
 *   u — вдоль хорды от её левого конца (0 … chord),
 *   v — перпендикулярно хорде в сторону выпуклости дуги (v = 0 на хорде).
 *   Центр окружностей лежит в (chord/2, −d), d = R − стрела (R — радиус первой дуги).
 *   Дуга i: v = √((R + offsets[i])² − (u − chord/2)²) − d.
 *   Первая дуга задаётся хордой и стрелой (или радиусом); остальные —
 *   необязательные, концентрические, со смещением offsets[i] > 0 от первой.
 *
 * Раскладка: сетка листов a × b (a — размер вдоль u, b — вдоль v).
 *   orientation 'across' (поперёк хорды): a = ширина листа, b = длина.
 *   orientation 'along'  (вдоль хорды):   a = длина листа,  b = ширина.
 * Стыки сдвигаются shiftU / shiftV; ряды (по v) сдвигаются вразбежку на
 * `stagger` мм каждый (имеет смысл для 'along').
 * Лист снизу обрезается по хорде (v ≥ 0).
 */

export type ArcOrientation = 'across' | 'along'

export interface ArcGeometry {
  chord: number
  /** Стрела первой дуги. */
  sagitta: number
  /** Радиус первой дуги. */
  radius: number
  /** Смещения дуг от первой (offsets[0] = 0), по возрастанию. */
  offsets: number[]
  /** Расстояние от хорды до центра окружностей (центр лежит на −d по v). */
  d: number
}

export interface ArcLayoutInput {
  geometry: ArcGeometry
  sheetWidth: number
  sheetLength: number
  orientation: ArcOrientation
  shiftU: number
  shiftV: number
  /** Сдвиг каждого следующего ряда по u (вразбежку), мм. */
  stagger: number
  /** Шаг ординат вдоль кромки листа, мм. */
  step: number
}

export interface ArcMark {
  /** Расстояние от левой кромки листа, мм. */
  du: number
  /** Расстояние от нижней кромки листа до линии реза, мм (округлено до 1 мм). */
  dv: number
  /** Линия реза вышла за лист и обрезана его кромкой. */
  clipped: 'top' | 'bottom' | null
}

export interface ArcCut {
  /** full — лист целиком под дугой (резать не надо), cut — дуга пересекает лист,
   *  none — лист целиком за дугой (в раскладку не входит). */
  status: 'full' | 'cut' | 'none'
  marks: ArcMark[]
  /** Площадь части листа под дугой, м². */
  keptAreaM2: number
}

export interface ArcSheet {
  id: number
  row: number
  col: number
  u0: number
  u1: number
  v0: number
  v1: number
  /** Размеры (после обрезки по хорде). */
  w: number
  h: number
  /** Лист обрезан по хорде (нижний ряд). */
  clippedByChord: boolean
  /** Резы по дугам, в том же порядке, что geometry.offsets. */
  cuts: ArcCut[]
}

export interface ArcLayoutResult {
  sheets: ArcSheet[]
  /** Полуширина области под самой дальней дугой по хорде (от центра), мм. */
  halfMax: number
  /** Полуширина области под каждой дугой, мм. */
  halfs: number[]
  vTop: number
}

const EPS = 1e-9

/** offsets — смещения дуг от первой; offsets[0] должен быть 0. */
export function geometryFromChordSagitta(chord: number, sagitta: number, offsets: number[] = [0]): ArcGeometry {
  const radius = (chord * chord) / (8 * sagitta) + sagitta / 2
  return build(chord, sagitta, radius, offsets)
}

export function geometryFromChordRadius(chord: number, radius: number, offsets: number[] = [0]): ArcGeometry {
  const half = chord / 2
  const sagitta = radius - Math.sqrt(Math.max(radius * radius - half * half, 0))
  return build(chord, sagitta, radius, offsets)
}

function build(chord: number, sagitta: number, radius: number, offsets: number[]): ArcGeometry {
  return { chord, sagitta, radius, offsets: offsets.length ? offsets : [0], d: radius - sagitta }
}

export function arcRadius(g: ArcGeometry, i: number): number {
  return g.radius + g.offsets[i]
}

/** Высота дуги i над хордой в точке u (мм). −Infinity — за пределами окружности. */
export function arcV(g: ArcGeometry, i: number, u: number): number {
  const R = arcRadius(g, i)
  const x = u - g.chord / 2
  const t = R * R - x * x
  if (t < 0) return -Infinity
  return Math.sqrt(t) - g.d
}

/** Полуширина области, где дуга i выше хорды (v ≥ 0). */
function halfExtent(g: ArcGeometry, i: number): number {
  const R = arcRadius(g, i)
  return Math.sqrt(Math.max(R * R - g.d * g.d, 0))
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

function cutForSheet(
  g: ArcGeometry, arc: number,
  u0: number, w: number, v0: number, h: number, step: number,
): ArcCut {
  // Статус и площадь — по мелкой выборке 5 мм.
  const fine = 5
  const n = Math.max(Math.ceil(w / fine), 1)
  let allTop = true
  let allBottom = true
  let kept = 0
  for (let i = 0; i < n; i++) {
    const u = u0 + ((i + 0.5) * w) / n
    const dv = arcV(g, arc, u) - v0
    if (dv < h - EPS) allTop = false
    if (dv > EPS) allBottom = false
    kept += Math.min(Math.max(dv, 0), h) * (w / n)
  }
  const keptAreaM2 = kept / 1e6
  if (allBottom) return { status: 'none', marks: [], keptAreaM2: 0 }
  if (allTop) return { status: 'full', marks: [], keptAreaM2: (w * h) / 1e6 }

  const marks: ArcMark[] = []
  const stepSafe = Math.max(step, 1)
  const dus: number[] = []
  for (let du = 0; du < w - EPS; du += stepSafe) dus.push(du)
  dus.push(w)
  for (const du of dus) {
    const raw = arcV(g, arc, u0 + du) - v0
    let clipped: ArcMark['clipped'] = null
    let dv = raw
    if (!(raw >= 0)) { dv = 0; clipped = 'bottom' }
    else if (raw > h) { dv = h; clipped = 'top' }
    marks.push({ du: Math.round(du * 100) / 100, dv: Math.round(dv), clipped })
  }
  return { status: 'cut', marks, keptAreaM2 }
}

export function calcArcLayout(input: ArcLayoutInput): ArcLayoutResult {
  const { geometry: g, orientation } = input
  const a = orientation === 'across' ? input.sheetWidth : input.sheetLength
  const b = orientation === 'across' ? input.sheetLength : input.sheetWidth
  const halfs = g.offsets.map((_, i) => halfExtent(g, i))
  const halfMax = Math.max(...halfs)
  const vTop = arcRadius(g, g.offsets.length - 1) - g.d
  const centerU = g.chord / 2

  const sheets: ArcSheet[] = []
  if (!(a > 0) || !(b > 0) || !(g.chord > 0) || !(g.sagitta > 0)) {
    return { sheets, halfMax, halfs, vTop }
  }

  const shiftV = mod(input.shiftV, b)
  const uMin = centerU - halfMax
  const uMax = centerU + halfMax

  let id = 1
  let row = 0
  // Первый (нижний) ряд: от хорды до первого стыка, если стык не на хорде.
  const rowEdges: Array<{ v0: number; v1: number; j: number }> = []
  if (shiftV > EPS) rowEdges.push({ v0: 0, v1: shiftV, j: -1 })
  for (let j = 0; shiftV + j * b < vTop; j++) {
    rowEdges.push({ v0: shiftV + j * b, v1: shiftV + (j + 1) * b, j })
  }

  for (const r of rowEdges) {
    const off = mod(input.shiftU + r.j * input.stagger, a)
    const iFrom = Math.floor((uMin - off) / a)
    const iTo = Math.ceil((uMax - off) / a)
    for (let i = iFrom; i < iTo; i++) {
      const u0 = off + i * a
      const v0 = r.v0
      const h = r.v1 - r.v0
      const clippedByChord = r.j === -1 && shiftV > EPS
      const cuts = g.offsets.map((_, k) => cutForSheet(g, k, u0, a, v0, h, input.step))
      // Лист нужен, если хоть одна дуга проходит над его площадью.
      if (cuts.every(c => c.status === 'none')) continue
      sheets.push({
        id: id++, row, col: i, u0, u1: u0 + a, v0, v1: r.v1, w: a, h, clippedByChord, cuts,
      })
    }
    row++
  }
  return { sheets, halfMax, halfs, vTop }
}

/** Индексы отметок, которые подписываем: первая, затем каждая, дошедшая до очередного шага подписи, и последняя. */
export function labelIndices(dus: number[], labelStep: number): Set<number> {
  const out = new Set<number>()
  if (dus.length === 0) return out
  const stepL = labelStep > 0 ? labelStep : 250
  let next = dus[0]
  dus.forEach((du, i) => {
    if (du >= next - 1e-6) {
      out.add(i)
      while (next <= du + 1e-6) next += stepL
    }
  })
  out.add(dus.length - 1)
  return out
}

export type OffsetFrom = 'top' | 'bottom'

/**
 * Отступы ординат от крайней линии — чтобы мерить рулеткой короткие расстояния
 * между двумя линиями, проведёнными поперёк листа по самой дальней и самой ближней
 * отметке. from = 'top': от наибольшей отметки (она получает 0), 'bottom': от наименьшей.
 * null во входе (отметка у края листа или ниже хорды) в границы не входит, в ответе — null.
 */
export function ordinateOffsets(vals: Array<number | null>, from: OffsetFrom): {
  offsets: Array<number | null>
  top: number | null
  bottom: number | null
  span: number
} {
  const real = vals.filter((v): v is number => v !== null && Number.isFinite(v))
  if (real.length === 0) return { offsets: vals.map(() => null), top: null, bottom: null, span: 0 }
  const top = Math.max(...real), bottom = Math.min(...real)
  const ref = from === 'top' ? top : bottom
  return { offsets: vals.map(v => (v === null || !Number.isFinite(v) ? null : Math.abs(ref - v))), top, bottom, span: top - bottom }
}

