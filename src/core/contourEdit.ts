/**
 * contourEdit.ts — чистые операции редактирования контура потолка
 * (вкладка «Контур потолка», ContourCalc.tsx). Все функции возвращают НОВЫЙ массив.
 * Система координат та же, что в calcContourLayout.ts: мм, Y вверх;
 * sag > 0 — выгиб влево от направления обхода, sag < 0 — вправо.
 */

import { edgeArc, tessellate, type ContourVertex, type Pt } from './calcContourLayout'

const nextIdx = (i: number, n: number) => (i + 1) % n

/** Контур обходится против часовой стрелки (внутренность слева от обхода). */
export function isCCW(vs: ContourVertex[]): boolean {
  const pts = tessellate(vs, 1)
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[nextIdx(i, pts.length)]
    s += a.x * b.y - b.x * a.y
  }
  return s > 0
}

export interface SnapOptions {
  /** Шаг сетки, мм; 0 — без привязки к сетке. */
  grid: number
  /** Только горизонтально/вертикально относительно предыдущей вершины. */
  ortho: boolean
  prev: Pt | null
  vertices: Pt[]
  /** Радиус притяжения к вершинам, мм (в мировых единицах). */
  vertexTol: number
}

export interface SnapResult extends Pt { kind: 'vertex' | 'grid' | 'free'; vertexIndex?: number }

export function snapPoint(p: Pt, o: SnapOptions): SnapResult {
  let best = -1, bestD = o.vertexTol
  o.vertices.forEach((v, i) => {
    const d = Math.hypot(v.x - p.x, v.y - p.y)
    if (d <= bestD) { best = i; bestD = d }
  })
  if (best >= 0) return { x: o.vertices[best].x, y: o.vertices[best].y, kind: 'vertex', vertexIndex: best }
  let { x, y } = p
  if (o.ortho && o.prev) {
    if (Math.abs(x - o.prev.x) < Math.abs(y - o.prev.y)) x = o.prev.x
    else y = o.prev.y
  }
  if (o.grid > 0) {
    if (!(o.ortho && o.prev && x === o.prev.x)) x = Math.round(x / o.grid) * o.grid
    if (!(o.ortho && o.prev && y === o.prev.y)) y = Math.round(y / o.grid) * o.grid
  }
  return { x, y, kind: o.grid > 0 || o.ortho ? 'grid' : 'free' }
}

/** Стрела по хорде и радиусу (меньшая дуга). null — радиус меньше половины хорды. */
export function sagittaFromChordRadius(chord: number, radius: number): number | null {
  const L = chord / 2
  if (!(radius >= L - 1e-9) || !(chord > 0)) return null
  return radius - Math.sqrt(Math.max(radius * radius - L * L, 0))
}

/** Выгиб ребра внутрь контура? */
export function isBulgeInward(vs: ContourVertex[], i: number): boolean {
  const sag = vs[i].sag ?? 0
  if (!sag) return false
  return (sag > 0) === isCCW(vs)
}

/** Задать стрелу ребра: величина ≥ 0 (0 — прямая) и направление. */
export function setEdgeBulge(vs: ContourVertex[], i: number, magnitude: number, inward: boolean): ContourVertex[] {
  const m = Math.max(magnitude, 0)
  const left = inward === isCCW(vs)   // внутрь при CCW = влево
  return vs.map((v, k) => (k === i ? { ...v, sag: m < 1e-9 ? 0 : (left ? m : -m) } : v))
}

export function flipEdgeBulge(vs: ContourVertex[], i: number): ContourVertex[] {
  return vs.map((v, k) => (k === i ? { ...v, sag: -(v.sag ?? 0) } : v))
}

/** Изменить длину хорды ребра i, двигая его конечную вершину вдоль ребра. */
export function setEdgeChord(vs: ContourVertex[], i: number, chord: number): ContourVertex[] {
  const n = vs.length
  const a = vs[i], j = nextIdx(i, n), b = vs[j]
  const cur = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(chord > 0) || cur < 1e-9) return vs
  const k = chord / cur
  return vs.map((v, idx) => (idx === j ? { ...v, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k } : v))
}

/** Вставить вершину в середину ребра. У дуги новая вершина лежит на самой дуге, обе половины остаются на той же окружности. */
export function splitEdge(vs: ContourVertex[], i: number): ContourVertex[] {
  const n = vs.length
  const a = vs[i], b = vs[nextIdx(i, n)]
  const sag = a.sag ?? 0
  const arc = edgeArc(a, b, sag)
  let mid: Pt
  let half = 0
  if (arc) {
    const ang = arc.a0 + arc.sweep / 2
    mid = { x: arc.cx + arc.R * Math.cos(ang), y: arc.cy + arc.R * Math.sin(ang) }
    const c = Math.hypot(mid.x - a.x, mid.y - a.y)
    const h = sagittaFromChordRadius(c, arc.R) ?? 0
    half = Math.sign(sag) * h
  } else {
    mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const out = vs.map(v => ({ ...v }))
  out[i] = { ...out[i], sag: half }
  out.splice(i + 1, 0, { x: mid.x, y: mid.y, sag: half })
  return out
}

/** Удалить вершину; ребро, которое получилось вместо двух, делаем прямым. */
export function removeVertex(vs: ContourVertex[], i: number): ContourVertex[] {
  if (vs.length <= 1) return vs
  const n = vs.length
  const prev = (i + n - 1) % n
  const out = vs.map(v => ({ ...v }))
  out[prev] = { ...out[prev], sag: 0 }
  out.splice(i, 1)
  return out
}

export function moveVertex(vs: ContourVertex[], i: number, p: Pt): ContourVertex[] {
  return vs.map((v, k) => (k === i ? { ...v, x: p.x, y: p.y } : v))
}

/** Расстояние от точки до ребра (до его дуги, если есть), мм. */
export function distanceToEdge(vs: ContourVertex[], i: number, p: Pt): number {
  const n = vs.length
  const pts: Pt[] = [{ x: vs[i].x, y: vs[i].y }]
  const arc = edgeArc(vs[i], vs[nextIdx(i, n)], vs[i].sag ?? 0)
  if (arc) {
    const segs = Math.min(200, Math.max(8, Math.ceil(arc.theta / 0.02)))
    for (let k = 1; k < segs; k++) {
      const ang = arc.a0 + (arc.sweep * k) / segs
      pts.push({ x: arc.cx + arc.R * Math.cos(ang), y: arc.cy + arc.R * Math.sin(ang) })
    }
  }
  const e = vs[nextIdx(i, n)]
  pts.push({ x: e.x, y: e.y })
  let best = Infinity
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  }
  return best
}

/** Форма с эскиза: дуга слева, косые сверху и снизу, ступенчатая правая сторона. Размеры УСЛОВНЫЕ. */
export function sketchExample(): ContourVertex[] {
  return [
    { x: 0, y: 0 },
    { x: 5700, y: 2340 },
    { x: 5700, y: 5200 },
    { x: 5130, y: 5200 },
    { x: 5130, y: 15860 },
    { x: 5700, y: 15860 },
    { x: 5700, y: 18590 },
    { x: 0, y: 20800, sag: 1900 },
  ]
}
