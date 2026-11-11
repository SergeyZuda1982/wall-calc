/**
 * Модель ломаной облицовки («ниша», скосы, возвраты) для вкладки «Ломаная стена».
 *
 * Контур задаётся по ЧИСТОВОЙ поверхности цепочкой участков. У участка:
 *  - along — длина вдоль стены (≥ 0; 0 — возврат перпендикулярно стене),
 *  - depth — глубина чистовой поверхности в КОНЦЕ участка от плоскости стены, мм
 *    (вглубь помещения — плюс); у начала участка глубина равна глубине конца предыдущего,
 *  - layers × board — число слоёв и толщина одного слоя обшивки на этом участке.
 * Цепочка начинается в точке (0, startDepth). Расчёт смещения — core/calcOffsetPolyline.ts.
 */

import { offsetPolyline, type OffsetResult, type Pt, type VertexKind } from './calcOffsetPolyline'

export interface NicheSeg {
  along: number
  depth: number
  layers: number
  board: number
}

export interface NicheModel {
  startDepth: number
  segs: NicheSeg[]
}

export type SegKind = 'return' | 'run' | 'slope'

export interface NicheSegRow {
  index: number
  kind: SegKind
  /** угол к плоскости стены, градусы (0 — участок параллельно стене, 90 — возврат) */
  angleDeg: number
  thickness: number
  cleanLength: number
  profileLength: number
  startDelta: number
  endDelta: number
  /** глубина профиля (его лицевой полки) от плоскости стены в начале и в конце участка */
  profileDepthStart: number
  profileDepthEnd: number
}

export interface NicheVertexRow {
  index: number
  kind: VertexKind
  turnDeg: number
  /** угол реза профиля на изломе (половина угла поворота), градусы */
  cutDeg: number
}

export interface NicheAnalysis {
  points: Pt[]
  offset: OffsetResult
  rows: NicheSegRow[]
  vertices: NicheVertexRow[]
  totalClean: number
  totalProfile: number
  warnings: string[]
}

const seg = (along: number, depth: number, layers = 1, board = 12.5): NicheSeg => ({ along, depth, layers, board })

/** Пример: ниша под пожарный шкаф с чертежа (возврат 223 + фаска 177, участки 1900 / 1873 / 4000, зеркально). */
export function exampleNiche(layers = 2, board = 12.5): NicheModel {
  // левая половина; центральный участок задан половиной длины (4000 = 2000 + 2000 после зеркала)
  const half = [
    seg(0, 223), seg(177, 400), seg(1900, 400), seg(177, 223), seg(1873, 223), seg(177, 0), seg(2000, 0),
  ].map(s => ({ ...s, layers, board }))
  return mirrorAppend({ startDepth: 0, segs: half })
}

export function emptyNiche(): NicheModel {
  return { startDepth: 0, segs: [seg(1000, 0)] }
}

/** Глубина в начале участка i. */
export function depthBefore(m: NicheModel, i: number): number {
  return i === 0 ? m.startDepth : m.segs[i - 1].depth
}

/**
 * Дописывает цепочку зеркально (с конца к началу) — для симметричной ниши.
 * Если последний участок исходной цепочки и первый зеркальный — участки вдоль стены
 * на одной глубине с одинаковой обшивкой, они склеиваются в один (длина удваивается).
 */
export function mirrorAppend(m: NicheModel): NicheModel {
  const mirrored: NicheSeg[] = []
  for (let i = m.segs.length - 1; i >= 0; i--) {
    mirrored.push({ ...m.segs[i], depth: depthBefore(m, i) })
  }
  const segs = [...m.segs, ...mirrored]
  const n = m.segs.length
  const a = segs[n - 1]
  const b = segs[n]
  if (a && b && a.along > 0 && a.depth === depthBefore(m, n - 1) && a.layers === b.layers && a.board === b.board) {
    segs.splice(n - 1, 2, { ...a, along: a.along + b.along })
  }
  return { startDepth: m.startDepth, segs }
}

export function segThickness(s: NicheSeg): number {
  return s.layers * s.board
}

export function validateNiche(m: NicheModel): string | null {
  if (m.segs.length < 1) return 'Добавьте хотя бы один участок'
  if (!Number.isFinite(m.startDepth)) return 'Начальная глубина задана неверно'
  for (let i = 0; i < m.segs.length; i++) {
    const s = m.segs[i]
    const n = i + 1
    if (![s.along, s.depth, s.layers, s.board].every(Number.isFinite)) return `Участок ${n}: число задано неверно`
    if (s.along < 0) return `Участок ${n}: длина вдоль стены не может быть отрицательной`
    if (s.layers < 0 || s.board < 0) return `Участок ${n}: слои и толщина не могут быть отрицательными`
    if (s.along === 0 && s.depth === depthBefore(m, i)) return `Участок ${n}: нулевой длины (нет ни длины, ни изменения глубины)`
  }
  return null
}

export function nichePoints(m: NicheModel): Pt[] {
  const pts: Pt[] = [{ x: 0, y: m.startDepth }]
  for (const s of m.segs) pts.push({ x: pts[pts.length - 1].x + s.along, y: s.depth })
  return pts
}

export function segLabel(kind: SegKind): string {
  return kind === 'return' ? 'возврат' : kind === 'slope' ? 'скос' : 'участок'
}

/** Полный расчёт. Бросает Error, если модель не проходит validateNiche. */
export function analyzeNiche(m: NicheModel): NicheAnalysis {
  const err = validateNiche(m)
  if (err) throw new Error(err)
  const points = nichePoints(m)
  const offset = offsetPolyline(points, m.segs.map(segThickness))
  const warnings = [...offset.warnings]

  const rows: NicheSegRow[] = offset.segments.map(o => {
    const dx = o.cleanEnd.x - o.cleanStart.x
    const dy = o.cleanEnd.y - o.cleanStart.y
    const angleDeg = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
    const kind: SegKind = Math.abs(dx) < 1e-9 ? 'return' : Math.abs(dy) < 1e-9 ? 'run' : 'slope'
    return {
      index: o.index + 1,
      kind,
      angleDeg,
      thickness: o.thickness,
      cleanLength: o.cleanLength,
      profileLength: o.profileLength,
      startDelta: o.startDelta,
      endDelta: o.endDelta,
      profileDepthStart: o.profileStart.y,
      profileDepthEnd: o.profileEnd.y,
    }
  })
  const vertices: NicheVertexRow[] = offset.vertices.map(v => ({
    index: v.index,
    kind: v.kind,
    turnDeg: v.turnDeg,
    cutDeg: Math.abs(v.turnDeg) / 2,
  }))
  m.segs.forEach((s, i) => {
    if (s.layers === 0 || s.board === 0) warnings.push(`Участок ${i + 1}: обшивка нулевой толщины, профиль совпадает с чистовой линией`)
  })
  return {
    points,
    offset,
    rows,
    vertices,
    totalClean: rows.reduce((a, r) => a + r.cleanLength, 0),
    totalProfile: rows.reduce((a, r) => a + r.profileLength, 0),
    warnings,
  }
}

const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def)

/** Разбор данных из файла / localStorage с подстановкой значений по умолчанию. */
export function sanitizeNiche(d: unknown): NicheModel {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  const raw = Array.isArray(o.segs) ? o.segs : []
  const segs = raw.slice(0, 60).map(r => {
    const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    return { along: num(x.along, 0), depth: num(x.depth, 0), layers: num(x.layers, 1), board: num(x.board, 12.5) }
  })
  if (segs.length === 0) return exampleNiche()
  return { startDepth: num(o.startDepth, 0), segs }
}
