/**
 * calcContourLayout.ts — раскладка листов по ПРОИЗВОЛЬНОМУ контуру потолка с дугами
 * и косыми сторонами + точная площадь (15.10.2026).
 *
 * Контур — замкнутая ломаная из вершин (мм, ось Y смотрит ВВЕРХ), у каждого ребра
 * может быть стрела (`sag` у начальной вершины ребра): sag > 0 — дуга выгибается
 * ВЛЕВО от направления обхода, sag < 0 — вправо, 0 — прямая. Стрела не больше
 * половины хорды (дуга не больше полуокружности).
 *
 * Раскладка строится в локальной системе выбранного опорного ребра:
 *   u — вдоль опорного ребра (у дуги — вдоль её хорды), v — от ребра ВНУТРЬ контура.
 * Так же, как в «Разметке дуги» (calcArcLayout.ts): сетка листов a × b
 * (orientation 'across': a = ширина, b = длина; 'along': наоборот), сдвиги
 * shiftU/shiftV и смещение рядов `stagger`. Каждый лист обрезается контуром.
 *
 * Для каждого листа: углы получившегося куска (точки реза на кромках листа,
 * мм от левого нижнего угла листа) и, для каждой дуговой кромки, ординаты
 * через заданный шаг — расстояние от кромки листа до линии реза.
 */

export interface Pt { x: number; y: number }
export interface ContourVertex { x: number; y: number; sag?: number }

export type ContourOrientation = 'across' | 'along'

// ─── Дуга ребра ─────────────────────────────────────────────────────────────

export interface EdgeArc {
  cx: number; cy: number; R: number
  /** Угол из центра на начало ребра. */
  a0: number
  /** Знаковый угол обхода (рад): > 0 против часовой. Модуль = theta. */
  sweep: number
  theta: number
  /** Длина дуги. */
  len: number
  chord: number
  /** +1: выгиб влево от направления обхода, −1: вправо. */
  side: 1 | -1
}

export function edgeArc(a: Pt, b: Pt, sag: number): EdgeArc | null {
  const dx = b.x - a.x, dy = b.y - a.y
  const chord = Math.hypot(dx, dy)
  const H = Math.abs(sag)
  if (chord < 1e-9 || H < 1e-9) return null
  const L = chord / 2
  const R = (L * L + H * H) / (2 * H)
  const nx = -dy / chord, ny = dx / chord
  const side: 1 | -1 = sag > 0 ? 1 : -1
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const cx = mx + side * (H - R) * nx
  const cy = my + side * (H - R) * ny
  const theta = H <= L ? 2 * Math.asin(Math.min(1, L / R)) : 2 * Math.PI - 2 * Math.asin(Math.min(1, L / R))
  return { cx, cy, R, a0: Math.atan2(a.y - cy, a.x - cx), sweep: -side * theta, theta, len: R * theta, chord, side }
}

function arcPoint(arc: EdgeArc, t: number): Pt {
  const ang = arc.a0 + arc.sweep * t
  return { x: arc.cx + arc.R * Math.cos(ang), y: arc.cy + arc.R * Math.sin(ang) }
}

// ─── Разбиение контура на точки ─────────────────────────────────────────────

export interface TessPoint {
  x: number; y: number
  /** Угол контура или пересечение с кромкой листа (true) либо промежуточная точка дуги (false). */
  c: boolean
  /** Индекс ребра контура, по которому идёт отрезок от этой точки к следующей; −1 — кромка листа. */
  e: number
}

const NEXT = (i: number, n: number) => (i + 1) % n

export function tessellate(vs: ContourVertex[], dev = 0.1): TessPoint[] {
  const out: TessPoint[] = []
  const n = vs.length
  for (let i = 0; i < n; i++) {
    const a = vs[i], b = vs[NEXT(i, n)]
    out.push({ x: a.x, y: a.y, c: true, e: i })
    const arc = edgeArc(a, b, a.sag ?? 0)
    if (!arc) continue
    const step = 2 * Math.acos(Math.max(-1, 1 - dev / arc.R))
    const segs = Math.min(4000, Math.max(4, Math.ceil(arc.theta / Math.max(step, 1e-6))))
    for (let k = 1; k < segs; k++) {
      const p = arcPoint(arc, k / segs)
      out.push({ x: p.x, y: p.y, c: false, e: i })
    }
  }
  return out
}

function signedAreaPts(p: Pt[]): number {
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[NEXT(i, p.length)]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

// ─── Площадь и периметр ─────────────────────────────────────────────────────

/** Площадь сегмента круга между хордой и дугой (мм²). */
function segmentArea(chord: number, H: number): number {
  const L = chord / 2
  const R = (L * L + H * H) / (2 * H)
  const theta = H <= L ? 2 * Math.asin(Math.min(1, L / R)) : 2 * Math.PI - 2 * Math.asin(Math.min(1, L / R))
  return (R * R / 2) * (theta - Math.sin(theta))
}

/** Точная площадь контура, мм² (хорды + сегменты дуг, без разбиения на отрезки). */
export function contourAreaMm2(vs: ContourVertex[]): number {
  const n = vs.length
  if (n < 3) return 0
  let total = signedAreaPts(vs)
  for (let i = 0; i < n; i++) {
    const sag = vs[i].sag ?? 0
    if (Math.abs(sag) < 1e-9) continue
    const b = vs[NEXT(i, n)]
    const seg = segmentArea(Math.hypot(b.x - vs[i].x, b.y - vs[i].y), Math.abs(sag))
    // Дуга влево от обхода уменьшает площадь «лево-внутреннего» контура: вклад −sign·сегмент.
    total += -Math.sign(sag) * seg
  }
  return Math.abs(total)
}

export function contourPerimeterMm(vs: ContourVertex[]): number {
  const n = vs.length
  let p = 0
  for (let i = 0; i < n; i++) {
    const a = vs[i], b = vs[NEXT(i, n)]
    const arc = edgeArc(a, b, a.sag ?? 0)
    p += arc ? arc.len : Math.hypot(b.x - a.x, b.y - a.y)
  }
  return p
}

export interface ContourEdgeInfo {
  index: number
  /** Длина хорды. */
  chord: number
  /** Длина по контуру (у дуги — длина дуги). */
  length: number
  sagitta: number
  radius: number | null
}

export function contourEdges(vs: ContourVertex[]): ContourEdgeInfo[] {
  return vs.map((a, i) => {
    const b = vs[NEXT(i, vs.length)]
    const chord = Math.hypot(b.x - a.x, b.y - a.y)
    const arc = edgeArc(a, b, a.sag ?? 0)
    return { index: i, chord, length: arc ? arc.len : chord, sagitta: Math.abs(a.sag ?? 0), radius: arc ? arc.R : null }
  })
}

// ─── Проверка контура ───────────────────────────────────────────────────────

function segsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Текст ошибки или null, если контур годится для расчёта. */
export function validateContour(vs: ContourVertex[]): string | null {
  const n = vs.length
  if (n < 3) return 'Нужно минимум 3 вершины'
  for (let i = 0; i < n; i++) {
    const a = vs[i], b = vs[NEXT(i, n)]
    const chord = Math.hypot(b.x - a.x, b.y - a.y)
    if (chord < 1) return `Сторона ${i + 1}: вершины совпадают`
    const sag = Math.abs(a.sag ?? 0)
    if (sag > chord / 2 + 1e-6) return `Сторона ${i + 1}: стрела не может быть больше половины хорды (${Math.round(chord / 2)} мм)`
  }
  const pts = tessellate(vs, 0.5)
  const m = pts.length
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[NEXT(i, m)]
    for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue
      const c = pts[j], d = pts[NEXT(j, m)]
      if (segsIntersect(a, b, c, d)) {
        const ea = a.e, ec = c.e
        return ea === ec ? 'Контур пересекает сам себя' : `Стороны ${ea + 1} и ${ec + 1} пересекаются`
      }
    }
  }
  if (Math.abs(signedAreaPts(pts)) < 1) return 'Контур вырожден (нулевая площадь)'
  return null
}

// ─── Локальная система опорного ребра ───────────────────────────────────────

export interface ContourFrame {
  ox: number; oy: number
  ux: number; uy: number
  nx: number; ny: number
  /** Система отражена (контур обходится по часовой). */
  mirrored: boolean
}

export function makeFrame(vs: ContourVertex[], refEdge: number): ContourFrame {
  const n = vs.length
  const a = vs[refEdge % n], b = vs[NEXT(refEdge % n, n)]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
  const ccw = signedAreaPts(tessellate(vs, 1)) > 0
  const nx = ccw ? -uy : uy
  const ny = ccw ? ux : -ux
  return { ox: a.x, oy: a.y, ux, uy, nx, ny, mirrored: !ccw }
}

export function toLocal(f: ContourFrame, p: Pt): Pt {
  const dx = p.x - f.ox, dy = p.y - f.oy
  return { x: dx * f.ux + dy * f.uy, y: dx * f.nx + dy * f.ny }
}

export function toWorld(f: ContourFrame, p: Pt): Pt {
  return { x: f.ox + p.x * f.ux + p.y * f.nx, y: f.oy + p.x * f.uy + p.y * f.ny }
}

// ─── Отсечение листом (Сазерленд — Ходжман, с тегами рёбер) ──────────────────

function clipHalf(poly: TessPoint[], inside: (p: TessPoint) => boolean, cut: (a: TessPoint, b: TessPoint) => Pt): TessPoint[] {
  const out: TessPoint[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const ci = inside(cur), pi = inside(prev)
    if (ci) {
      if (!pi) { const q = cut(prev, cur); out.push({ x: q.x, y: q.y, c: true, e: prev.e }) }
      out.push(cur)
    } else if (pi) {
      const q = cut(prev, cur)
      out.push({ x: q.x, y: q.y, c: true, e: -1 })
    }
  }
  return out
}

function clipRect(poly: TessPoint[], u0: number, v0: number, u1: number, v1: number): TessPoint[] {
  const T = 1e-7
  const atX = (X: number) => (a: TessPoint, b: TessPoint): Pt => {
    const t = (X - a.x) / (b.x - a.x)
    return { x: X, y: a.y + t * (b.y - a.y) }
  }
  const atY = (Y: number) => (a: TessPoint, b: TessPoint): Pt => {
    const t = (Y - a.y) / (b.y - a.y)
    return { x: a.x + t * (b.x - a.x), y: Y }
  }
  let r = poly
  r = clipHalf(r, p => p.x >= u0 - T, atX(u0)); if (!r.length) return r
  r = clipHalf(r, p => p.x <= u1 + T, atX(u1)); if (!r.length) return r
  r = clipHalf(r, p => p.y >= v0 - T, atY(v0)); if (!r.length) return r
  r = clipHalf(r, p => p.y <= v1 + T, atY(v1))
  return r
}

// ─── Раскладка ──────────────────────────────────────────────────────────────

export interface ContourLayoutInput {
  vertices: ContourVertex[]
  /** Индекс опорного ребра: от него идёт сетка листов. */
  refEdge: number
  sheetWidth: number
  sheetLength: number
  orientation: ContourOrientation
  shiftU: number
  shiftV: number
  stagger: number
  /** Шаг ординат по дугам, мм. */
  step: number
}

export interface SheetCorner {
  /** От левого нижнего угла листа, мм. */
  u: number
  v: number
  /** Что идёт от этого угла к следующему: индекс ребра контура или −1 (кромка листа). */
  toNext: number
}

export interface ArcMarkRow {
  /** Положение вдоль кромки листа (от её начала), мм. */
  pos: number
  /** Расстояния до линии реза поперёк (обычно одно значение), мм. */
  vals: number[]
}

export interface SheetArcMarks {
  edge: number
  /** 'u': pos — от левой кромки, vals — от нижней. 'v': pos — от нижней, vals — от левой. */
  axis: 'u' | 'v'
  rows: ArcMarkRow[]
  /** Линия дуги внутри листа для чертежа, мм от левого нижнего угла листа. */
  path: Array<{ u: number; v: number }>
}

export interface ContourSheet {
  id: number
  row: number
  col: number
  /** Положение листа в локальной системе опорного ребра. */
  u0: number
  v0: number
  w: number
  h: number
  status: 'full' | 'cut'
  /** Площадь куска в контуре, м². */
  areaM2: number
  corners: SheetCorner[]
  arcs: SheetArcMarks[]
  /** Контур куска для чертежа (с точками дуг), мм от левого нижнего угла листа. */
  outline: Array<{ u: number; v: number }>
}

export interface ContourLayoutResult {
  error: string | null
  frame: ContourFrame | null
  sheets: ContourSheet[]
  areaM2: number
  perimeterM: number
  sheetCount: number
  fullCount: number
  cutCount: number
  /** Площадь купленных листов, м². */
  sheetAreaM2: number
  /** Площадь, уходящая в обрезки, м². */
  wasteM2: number
}

const MAX_CELLS = 4000

function mod(a: number, n: number): number { return ((a % n) + n) % n }
const r1 = (x: number) => Math.round(x * 10) / 10

function emptyResult(error: string | null): ContourLayoutResult {
  return { error, frame: null, sheets: [], areaM2: 0, perimeterM: 0, sheetCount: 0, fullCount: 0, cutCount: 0, sheetAreaM2: 0, wasteM2: 0 }
}

/** Пересечения линии u = c (axis 'u') или v = c (axis 'v') с дугой ребра, лежащие на самой дуге. */
function arcCrossings(arc: EdgeArc, a: Pt, b: Pt, axis: 'u' | 'v', c: number): number[] {
  const t = arc.R * arc.R - (axis === 'u' ? (c - arc.cx) ** 2 : (c - arc.cy) ** 2)
  if (t < -1e-6) return []
  const d = Math.sqrt(Math.max(t, 0))
  const cands = d < 1e-6 ? [0] : [-d, d]
  const out: number[] = []
  for (const s of cands) {
    const p: Pt = axis === 'u' ? { x: c, y: arc.cy + s } : { x: arc.cx + s, y: c }
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (arc.side * (cross / arc.chord) >= -1e-3) out.push(axis === 'u' ? p.y : p.x)
  }
  return out
}

function polyAreaAbs(p: Pt[]): number { return Math.abs(signedAreaPts(p)) }

function dedupePts(p: TessPoint[], tol: number): TessPoint[] {
  const out: TessPoint[] = []
  for (const q of p) {
    const last = out[out.length - 1]
    if (last && Math.hypot(last.x - q.x, last.y - q.y) < tol) { out[out.length - 1] = { ...last, e: q.e, c: last.c || q.c }; continue }
    out.push(q)
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < tol) {
    out[0] = { ...out[0], c: out[0].c || out[out.length - 1].c }
    out.pop()
  }
  return out
}

function cornersOf(piece: TessPoint[], cu0: number, cv0: number): SheetCorner[] {
  const clean = dedupePts(piece, 0.3).filter(p => p.c)
  // убираем лишние точки на одной прямой, если к ним ведёт и от них идёт один и тот же отрезок
  const res: TessPoint[] = []
  const m = clean.length
  for (let i = 0; i < m; i++) {
    const prev = clean[(i + m - 1) % m], cur = clean[i], next = clean[(i + 1) % m]
    const cr = (cur.x - prev.x) * (next.y - prev.y) - (cur.y - prev.y) * (next.x - prev.x)
    const base = Math.hypot(next.x - prev.x, next.y - prev.y) || 1
    if (prev.e === cur.e && Math.abs(cr) / base < 0.3 && m > 3) continue
    res.push(cur)
  }
  return res.map(p => ({ u: r1(p.x - cu0), v: r1(p.y - cv0), toNext: p.e }))
}

export function calcContourLayout(input: ContourLayoutInput): ContourLayoutResult {
  const vs = input.vertices
  const err = validateContour(vs)
  if (err) return emptyResult(err)
  const a = input.orientation === 'across' ? input.sheetWidth : input.sheetLength
  const b = input.orientation === 'across' ? input.sheetLength : input.sheetWidth
  if (!(a > 0) || !(b > 0)) return emptyResult('Размер листа должен быть больше 0')

  const n = vs.length
  const refEdge = Math.min(Math.max(Math.floor(input.refEdge), 0), n - 1)
  const frame = makeFrame(vs, refEdge)
  const local: ContourVertex[] = vs.map(v => {
    const p = toLocal(frame, v)
    const sag = v.sag ?? 0
    return { x: p.x, y: p.y, sag: frame.mirrored ? -sag : sag }
  })
  const tess = tessellate(local)
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
  for (const p of tess) {
    uMin = Math.min(uMin, p.x); uMax = Math.max(uMax, p.x)
    vMin = Math.min(vMin, p.y); vMax = Math.max(vMax, p.y)
  }
  const arcs = local.map((v, i) => {
    const bb = local[NEXT(i, n)]
    return edgeArc(v, bb, v.sag ?? 0)
  })

  const shiftV = mod(input.shiftV, b)
  const jFrom = Math.floor((vMin - shiftV) / b)
  const jTo = Math.ceil((vMax - shiftV) / b)
  const cols = Math.ceil((uMax - uMin) / a) + 2
  if ((jTo - jFrom) * cols > MAX_CELLS) return emptyResult('Слишком много листов: проверьте размеры контура и листа')

  const step = Math.max(input.step, 1)
  const sheets: ContourSheet[] = []
  let id = 1
  let row = 0
  for (let j = jFrom; j < jTo; j++) {
    const cv0 = shiftV + j * b
    const off = mod(input.shiftU + j * input.stagger, a)
    const iFrom = Math.floor((uMin - off) / a)
    const iTo = Math.ceil((uMax - off) / a)
    let rowUsed = false
    for (let i = iFrom; i < iTo; i++) {
      const cu0 = off + i * a
      const piece = clipRect(tess, cu0, cv0, cu0 + a, cv0 + b)
      if (piece.length < 3) continue
      const area = polyAreaAbs(piece)
      if (area < 100) continue
      rowUsed = true
      const full = area >= a * b - 1
      const corners = full ? [] : cornersOf(piece, cu0, cv0)
      const arcMarks: SheetArcMarks[] = []
      if (!full) {
        const edgesHere = new Set<number>()
        piece.forEach(p => { if (p.e >= 0 && arcs[p.e]) edgesHere.add(p.e) })
        for (const e of edgesHere) {
          const arc = arcs[e]!
          const pa = local[e], pb = local[NEXT(e, n)]
          const xs: number[] = [], ys: number[] = []
          piece.forEach((p, k) => {
            if (p.e !== e) return
            const q = piece[NEXT(k, piece.length)]
            xs.push(p.x - cu0, q.x - cu0)
            ys.push(p.y - cv0, q.y - cv0)
          })
          const lo = (arr: number[]) => Math.min(...arr), hi = (arr: number[]) => Math.max(...arr)
          const axis: 'u' | 'v' = hi(xs) - lo(xs) >= hi(ys) - lo(ys) ? 'u' : 'v'
          const [p0, p1] = axis === 'u' ? [lo(xs), hi(xs)] : [lo(ys), hi(ys)]
          const poss: number[] = [p0]
          for (let k = Math.floor(p0 / step) + 1; k * step < p1 - 1e-6; k++) poss.push(k * step)
          if (p1 - p0 > 1e-6) poss.push(p1)
          const rows: ArcMarkRow[] = []
          for (const pos of poss) {
            const abs = (axis === 'u' ? cu0 : cv0) + pos
            const lim = axis === 'u' ? [cv0, cv0 + b] : [cu0, cu0 + a]
            const vals = arcCrossings(arc, pa, pb, axis, abs)
              .filter(x => x >= lim[0] - 0.5 && x <= lim[1] + 0.5)
              .map(x => Math.round(Math.min(Math.max(x - lim[0], 0), lim[1] - lim[0])))
            if (vals.length) rows.push({ pos: r1(pos), vals: vals.sort((x, y) => x - y) })
          }
          const path: Array<{ u: number; v: number }> = []
          piece.forEach((p, k) => {
            if (p.e !== e) return
            const q = piece[NEXT(k, piece.length)]
            const last = path[path.length - 1]
            if (!last || Math.hypot(last.u - (p.x - cu0), last.v - (p.y - cv0)) > 0.05) path.push({ u: r1(p.x - cu0), v: r1(p.y - cv0) })
            path.push({ u: r1(q.x - cu0), v: r1(q.y - cv0) })
          })
          if (rows.length) arcMarks.push({ edge: e, axis, rows, path })
        }
        arcMarks.sort((x, y) => x.edge - y.edge)
      }
      sheets.push({
        id: id++, row, col: i, u0: cu0, v0: cv0, w: a, h: b,
        status: full ? 'full' : 'cut', areaM2: area / 1e6, corners, arcs: arcMarks,
        outline: dedupePts(piece, 0.3).map(p => ({ u: r1(p.x - cu0), v: r1(p.y - cv0) })),
      })
    }
    if (rowUsed) row++
  }

  const areaM2 = contourAreaMm2(vs) / 1e6
  const sheetAreaM2 = (sheets.length * a * b) / 1e6
  const used = sheets.reduce((s, x) => s + x.areaM2, 0)
  const fullCount = sheets.filter(s => s.status === 'full').length
  return {
    error: null, frame, sheets, areaM2,
    perimeterM: contourPerimeterMm(vs) / 1000,
    sheetCount: sheets.length, fullCount, cutCount: sheets.length - fullCount,
    sheetAreaM2, wasteM2: Math.max(sheetAreaM2 - used, 0),
  }
}

/** Лучшее опорное ребро по умолчанию: самая длинная дуга, иначе самое длинное ребро. */
export function defaultRefEdge(vs: ContourVertex[]): number {
  if (vs.length < 3) return 0
  const info = contourEdges(vs)
  const arcs = info.filter(e => e.radius !== null)
  const pool = arcs.length ? arcs : info
  return pool.reduce((best, e) => (e.chord > best.chord ? e : best), pool[0]).index
}
