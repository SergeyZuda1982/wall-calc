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
  /**
   * Параллельный перенос дуги i вдоль v (мм), по умолчанию 0. Дуга с переносом
   * существует только в пределах хорды u ∈ [0, chord] (боковые края — вертикали).
   * Нужен для наклонной цилиндрической поверхности: нижняя кромка на развёртке —
   * та же дуга, сдвинутая вдоль стоек (а не концентрическая).
   */
  shifts?: number[]
  /**
   * Дополнительный провис дуги i вдоль v (мм): у концов хорды на `sags[i]` больше,
   * в центре 0, между ними по параболе. Для нижней кромки, которая у краёв
   * опускается из-за неровного потолка. По умолчанию 0.
   */
  sags?: number[]
  /**
   * Режим «полоса»: поверхность — это область МЕЖДУ дугой 0 (верхняя кромка) и
   * дугой 1 (нижняя кромка), а не область под дугой. Лист в раскладку входит,
   * если он не целиком под дугой 0 и хоть частично под дугой 1.
   */
  band?: boolean
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
  /**
   * Разбежка поперечных стыков между соседними колонками, мм: чётные колонки 0, нечётные
   * сдвинуты по v на это значение (0–500–0–500). 0/не задано — стыки колонок на одной высоте.
   * Только для orientation = 'across'. Включает режим колонок: сдвиг рядов по u (`stagger`) в нём не применяется.
   */
  colStaggerV?: number
  /** Ручной сдвиг стыков для колонки (индекс `col` листа → мм), заменяет автоматическое значение. */
  colOffsets?: Record<number, number>
}

/**
 * Новый сдвиг стыков колонки при перетаскивании: стартовый сдвиг + смещение указателя по v,
 * округлённое до шага `snap`, по модулю длины листа `period` (результат в [0, period)).
 */
export function dragColumnOffset(startOffset: number, deltaV: number, snap: number, period: number): number {
  const step = snap > 0 ? snap : 1
  const moved = startOffset + Math.round(deltaV / step) * step
  return ((moved % period) + period) % period
}

/** Сдвиг стыков колонки по v (до взятия по модулю длины листа), мм. */
export function colShiftV(col: number, colStaggerV: number, colOffsets?: Record<number, number>): number {
  const manual = colOffsets?.[col]
  if (manual !== undefined && Number.isFinite(manual)) return manual
  return mod(col, 2) === 1 ? colStaggerV : 0
}

export interface ArcMark {
  /** Расстояние от левой кромки листа, мм. */
  du: number
  /** Расстояние от нижней кромки листа до линии реза, мм (округлено до 1 мм). */
  dv: number
  /** Линия реза вышла за лист и обрезана его кромкой. */
  clipped: 'top' | 'bottom' | null
}

/** Точка, где линия реза доходит до кромки листа (между отметками, поэтому в таблице её не видно). */
export interface ArcCrossing {
  /** Расстояние от левой кромки листа, мм (округлено до 1 мм). */
  du: number
  /** Расстояние от правой кромки листа, мм. */
  duRight: number
  /** bottom — линия реза спускается к нижней кромке листа («0»), top — поднимается к верхней. */
  edge: 'bottom' | 'top'
  /** Линия реза после этой точки идёт вверх (true) или вниз (false). */
  rising: boolean
}

export interface ArcCut {
  /** full — лист целиком под дугой (резать не надо), cut — дуга пересекает лист,
   *  none — лист целиком за дугой (в раскладку не входит). */
  status: 'full' | 'cut' | 'none'
  marks: ArcMark[]
  /** Где линия реза выходит на нижнюю/верхнюю кромку листа. */
  crossings: ArcCrossing[]
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

/** Текст для разметчика: где линия реза выходит на кромку листа. Пусто, если не пересекает. */
export function crossingNotes(cut: ArcCut): string[] {
  return cut.crossings.map(c => {
    const edge = c.edge === 'bottom' ? 'нижней' : 'верхней'
    const zero = c.edge === 'bottom' ? ' («0»)' : ''
    const tail = c.rising
      ? `левее линия лежит на ${edge} кромке, правее идёт ${c.edge === 'bottom' ? 'вверх' : 'вниз от неё'}`
      : `левее линия идёт ${c.edge === 'bottom' ? 'вниз к кромке' : 'вверх к кромке'}, правее лежит на ${edge} кромке`
    return `доходит до ${edge} кромки листа${zero} на ${c.du} мм от левой кромки (${c.duRight} мм от правой); ${tail}`
  })
}

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

const shiftOf = (g: ArcGeometry, i: number): number => g.shifts?.[i] ?? 0

/**
 * Полоса между дугой 0 и такой же дугой, перенесённой на `shift` мм вдоль v
 * (наклонная поверхность в развёртке: shift — длина стойки).
 */
export function bandGeometry(base: ArcGeometry, shift: number, edgeSag = 0): ArcGeometry {
  return { ...base, offsets: [0, 0], shifts: [0, shift], sags: [0, edgeSag], band: true }
}

const sagAt = (g: ArcGeometry, i: number, u: number): number => {
  const sg = g.sags?.[i] ?? 0
  if (!sg) return 0
  const t = (u - g.chord / 2) / (g.chord / 2)
  return sg * t * t
}

/** Высота дуги i над хордой в точке u (мм). −Infinity — за пределами окружности. */
export function arcV(g: ArcGeometry, i: number, u: number): number {
  const R = arcRadius(g, i)
  const sh = shiftOf(g, i)
  if (sh !== 0 && (u < -1e-6 || u > g.chord + 1e-6)) return -Infinity
  const x = u - g.chord / 2
  const t = R * R - x * x
  if (t < 0) return -Infinity
  return Math.sqrt(t) - g.d + sh + sagAt(g, i, u)
}

/** Полуширина области, где дуга i выше хорды (v ≥ 0). */
function halfExtent(g: ArcGeometry, i: number): number {
  if (shiftOf(g, i) !== 0) return g.chord / 2
  const R = arcRadius(g, i)
  return Math.sqrt(Math.max(R * R - g.d * g.d, 0))
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/**
 * Точки, где дуга пересекает нижнюю (dv = 0) и верхнюю (dv = h) кромку листа.
 * Скан с шагом 2 мм, затем деление пополам до 0,01 мм. Касание без перехода не считается.
 */
export function findCrossings(
  g: ArcGeometry, arc: number, u0: number, w: number, v0: number, h: number,
): ArcCrossing[] {
  const out: ArcCrossing[] = []
  const val = (du: number) => arcV(g, arc, u0 + du) - v0
  const n = Math.max(Math.ceil(w / 2), 1)
  const refine = (level: number, a: number, b: number): number => {
    let lo = a, hi = b
    const above = val(a) >= level
    for (let it = 0; it < 40 && hi - lo > 0.01; it++) {
      const mid = (lo + hi) / 2
      if ((val(mid) >= level) === above) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  for (const [level, edge] of [[0, 'bottom'], [h, 'top']] as const) {
    let prevDu = 0
    let prev = val(0) >= level
    for (let i = 1; i <= n; i++) {
      const du = (i * w) / n
      const cur = val(du) >= level
      if (cur !== prev) {
        const x = refine(level, prevDu, du)
        // Отсечь «пересечения» на самом краю листа (линия там уже на кромке).
        if (x > 0.5 && x < w - 0.5) {
          out.push({ du: Math.round(x), duRight: Math.round(w - x), edge, rising: cur })
        }
      }
      prev = cur
      prevDu = du
    }
  }
  return out.sort((p, q) => p.du - q.du)
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
  if (allBottom) return { status: 'none', marks: [], crossings: [], keptAreaM2: 0 }
  if (allTop) return { status: 'full', marks: [], crossings: [], keptAreaM2: (w * h) / 1e6 }

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
  return { status: 'cut', marks, crossings: findCrossings(g, arc, u0, w, v0, h), keptAreaM2 }
}

export function calcArcLayout(input: ArcLayoutInput): ArcLayoutResult {
  const { geometry: g, orientation } = input
  const a = orientation === 'across' ? input.sheetWidth : input.sheetLength
  const b = orientation === 'across' ? input.sheetLength : input.sheetWidth
  const halfs = g.offsets.map((_, i) => halfExtent(g, i))
  const halfMax = Math.max(...halfs)
  const vTop = Math.max(...g.offsets.map((_, i) => arcRadius(g, i) - g.d + shiftOf(g, i) + Math.max(g.sags?.[i] ?? 0, 0)))
  const centerU = g.chord / 2

  const sheets: ArcSheet[] = []
  if (!(a > 0) || !(b > 0) || !(g.chord > 0) || !(g.sagitta > 0)) {
    return { sheets, halfMax, halfs, vTop }
  }

  // Режим колонок — только для листов «поперёк хорды»; «вдоль хорды» разбегается рядами (`stagger`).
  const columnMode = orientation === 'across' && ((input.colStaggerV ?? 0) !== 0
    || Object.values(input.colOffsets ?? {}).some(v => Number.isFinite(v) && v !== 0))
  const colStaggerV = input.colStaggerV ?? 0

  const uMin = centerU - halfMax
  const uMax = centerU + halfMax

  type Pending = Omit<ArcSheet, 'id'>
  const pending: Pending[] = []
  const rowEdgesFor = (shiftV: number): Array<{ v0: number; v1: number; j: number }> => {
    const out: Array<{ v0: number; v1: number; j: number }> = []
    // Первый (нижний) ряд: от хорды до первого стыка, если стык не на хорде.
    if (shiftV > EPS) out.push({ v0: 0, v1: shiftV, j: -1 })
    for (let j = 0; shiftV + j * b < vTop; j++) out.push({ v0: shiftV + j * b, v1: shiftV + (j + 1) * b, j })
    return out
  }
  const addSheet = (u0: number, i: number, rowIdx: number, r: { v0: number; v1: number; j: number }, shiftV: number) => {
    const v0 = r.v0
    const h = r.v1 - r.v0
    const clippedByChord = r.j === -1 && shiftV > EPS
    const cuts = g.offsets.map((_, k) => cutForSheet(g, k, u0, a, v0, h, input.step))
    // Лист нужен, если хоть одна дуга проходит над его площадью.
    // В режиме полосы — не целиком под верхней кромкой и хоть частично под нижней.
    if (g.band && cuts.length >= 2
      ? cuts[0].status === 'full' || cuts[1].status === 'none'
      : cuts.every(c => c.status === 'none')) return
    pending.push({ row: rowIdx, col: i, u0, u1: u0 + a, v0, v1: r.v1, w: a, h, clippedByChord, cuts })
  }

  if (columnMode) {
    // Колонки по u с общим сдвигом shiftU, у каждой колонки свой сдвиг стыков по v.
    const off = mod(input.shiftU, a)
    const iFrom = Math.floor((uMin - off) / a)
    const iTo = Math.ceil((uMax - off) / a)
    for (let i = iFrom; i < iTo; i++) {
      const shiftV = mod(input.shiftV + colShiftV(i, colStaggerV, input.colOffsets), b)
      rowEdgesFor(shiftV).forEach((r, rowIdx) => addSheet(off + i * a, i, rowIdx, r, shiftV))
    }
    // Нумерация как в обычном режиме: по рядам, внутри ряда слева направо.
    pending.sort((p, q) => p.row - q.row || p.col - q.col)
  } else {
    const shiftV = mod(input.shiftV, b)
    rowEdgesFor(shiftV).forEach((r, rowIdx) => {
      const off = mod(input.shiftU + r.j * input.stagger, a)
      const iFrom = Math.floor((uMin - off) / a)
      const iTo = Math.ceil((uMax - off) / a)
      for (let i = iFrom; i < iTo; i++) addSheet(off + i * a, i, rowIdx, r, shiftV)
    })
  }
  pending.forEach((p, k) => sheets.push({ id: k + 1, ...p }))
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

