/**
 * Смещение ломаной стены (облицовки) на толщину обшивки.
 *
 * Конвенция координат: x — вдоль стены, y — вглубь помещения (от плоскости
 * стены к залу). Ломаная задаётся по ЧИСТОВОЙ поверхности и обходится так, что
 * помещение остаётся СЛЕВА от направления обхода (для хода вдоль +x это +y).
 * Профиль лежит за обшивкой, то есть смещён от чистовой линии вправо
 * (в тело облицовки) на толщину обшивки данного участка.
 *
 * Толщина задаётся по участкам: сумма слоёв на каждом, поэтому соседние
 * участки могут иметь разную обшивку. Вершина профиля — пересечение
 * смещённых прямых соседних участков, формула tan(θ/2) здесь не нужна
 * и работает при любых толщинах.
 */

export interface Pt { x: number; y: number }

export type VertexKind = 'convex' | 'concave' | 'straight' | 'jog'

export interface OffsetVertex {
  /** индекс вершины чистовой ломаной */
  index: number
  /** угол поворота, градусы: > 0 влево (к помещению), < 0 вправо (в тело) */
  turnDeg: number
  /** convex — угол облицовки выступает в зал, concave — западает */
  kind: VertexKind
}

export interface OffsetSegment {
  index: number
  thickness: number
  cleanStart: Pt
  cleanEnd: Pt
  cleanLength: number
  profileStart: Pt
  profileEnd: Pt
  profileLength: number
  /** изменение длины на начале / конце относительно чистовой, мм */
  startDelta: number
  endDelta: number
}

export interface OffsetResult {
  segments: OffsetSegment[]
  vertices: OffsetVertex[]
  warnings: string[]
}

const EPS = 1e-9

function sub(a: Pt, b: Pt): Pt { return { x: a.x - b.x, y: a.y - b.y } }
function cross(a: Pt, b: Pt): number { return a.x * b.y - a.y * b.x }
function dot(a: Pt, b: Pt): number { return a.x * b.x + a.y * b.y }
function len(a: Pt): number { return Math.hypot(a.x, a.y) }

/** Поправка длины профиля на изломе при ОДИНАКОВОЙ толщине: t·tan(θ/2), со знаком (+ западающий угол). */
export function cornerAllowance(thickness: number, turnDeg: number): number {
  return thickness * Math.tan((turnDeg * Math.PI) / 360)
}

/**
 * @param points      вершины чистовой ломаной (не менее 2)
 * @param thicknesses толщина обшивки по каждому участку (points.length - 1 значений), мм
 */
export function offsetPolyline(points: Pt[], thicknesses: number[]): OffsetResult {
  const n = points.length - 1
  if (n < 1) throw new Error('Нужно минимум 2 точки')
  if (thicknesses.length !== n) throw new Error('Толщин должно быть на одну меньше, чем точек')

  const warnings: string[] = []
  const dirs: Pt[] = []
  const shiftedStart: Pt[] = []
  for (let i = 0; i < n; i++) {
    const v = sub(points[i + 1], points[i])
    const l = len(v)
    if (l < EPS) throw new Error(`Участок ${i + 1} нулевой длины`)
    const d = { x: v.x / l, y: v.y / l }
    dirs.push(d)
    const left = { x: -d.y, y: d.x }
    const t = thicknesses[i]
    shiftedStart.push({ x: points[i].x - t * left.x, y: points[i].y - t * left.y })
  }

  const starts: Pt[] = new Array(n)
  const ends: Pt[] = new Array(n)
  const vertices: OffsetVertex[] = []

  starts[0] = shiftedStart[0]
  ends[n - 1] = {
    x: points[n].x - thicknesses[n - 1] * -dirs[n - 1].y,
    y: points[n].y - thicknesses[n - 1] * dirs[n - 1].x,
  }

  for (let j = 1; j < n; j++) {
    const d1 = dirs[j - 1]
    const d2 = dirs[j]
    const cr = cross(d1, d2)
    const turnDeg = (Math.atan2(cr, dot(d1, d2)) * 180) / Math.PI
    if (Math.abs(cr) < 1e-9 && dot(d1, d2) > 0) {
      // участки на одной прямой: разная толщина даёт уступ профиля
      const e1: Pt = {
        x: points[j].x + thicknesses[j - 1] * d1.y,
        y: points[j].y - thicknesses[j - 1] * d1.x,
      }
      ends[j - 1] = e1
      starts[j] = shiftedStart[j]
      const same = Math.abs(thicknesses[j - 1] - thicknesses[j]) < EPS
      vertices.push({ index: j, turnDeg: 0, kind: same ? 'straight' : 'jog' })
      continue
    }
    if (Math.abs(cr) < 1e-9) {
      warnings.push(`Вершина ${j}: разворот на 180°, профиль не строится`)
      ends[j - 1] = shiftedStart[j - 1]
      starts[j] = shiftedStart[j]
      vertices.push({ index: j, turnDeg, kind: 'convex' })
      continue
    }
    const s = cross(sub(shiftedStart[j], shiftedStart[j - 1]), d2) / cr
    const p: Pt = { x: shiftedStart[j - 1].x + s * d1.x, y: shiftedStart[j - 1].y + s * d1.y }
    ends[j - 1] = p
    starts[j] = p
    vertices.push({ index: j, turnDeg, kind: turnDeg > 0 ? 'concave' : 'convex' })
  }

  const segments: OffsetSegment[] = []
  for (let i = 0; i < n; i++) {
    const cleanLength = len(sub(points[i + 1], points[i]))
    const profileLength = dot(sub(ends[i], starts[i]), dirs[i])
    const startDelta = -dot(sub(starts[i], shiftedStart[i]), dirs[i])
    const endDelta = profileLength - cleanLength - startDelta
    if (profileLength <= 0) {
      warnings.push(`Участок ${i + 1}: профиль вырождается (длина ≤ 0), обшивка толще участка`)
    }
    segments.push({
      index: i,
      thickness: thicknesses[i],
      cleanStart: points[i],
      cleanEnd: points[i + 1],
      cleanLength,
      profileStart: starts[i],
      profileEnd: ends[i],
      profileLength,
      startDelta,
      endDelta,
    })
  }
  return { segments, vertices, warnings }
}
