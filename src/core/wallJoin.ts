/**
 * wallJoin.ts — алгоритм стыковки двойных линий (wall join)
 *
 * Не меняет данные в store — только вычисляет скорректированные точки для рендера.
 *
 * Три типа стыков:
 *   L — конец A = конец B (угол). Митровый стык: пересечения граней.
 *   T — конец A лежит на теле B. B главная, A обрезается до внешней грани B.
 *   Продолжение — коллинеарные (обрабатываются автоматически через L с нулевым cross).
 */

const JOIN_EPS = 3 // допуск совпадения точек, px

interface Pt { x: number; y: number }

export interface WallForJoin {
  id: string
  x1: number; y1: number
  x2: number; y2: number
  halfPx: number       // половина толщины в мировых px
  createdIndex: number // порядок создания (для приоритета в L-стыке)
  category?: 'capital' | 'mutable' // капитал (периметр/колонна) — никогда не "уступает" изменяемой при T-стыке
}

export interface JoinedWall {
  /** Расширенная ось для заливки (прямоугольник без дыр в углах) */
  ax1: number; ay1: number
  ax2: number; ay2: number
  /** Точки граничных линий: Side+ (перпендикуляр +nx,+ny) */
  p1p: Pt; p2p: Pt
  /** Точки граничных линий: Side− (перпендикуляр −nx,−ny) */
  p1m: Pt; p2m: Pt
  /** Нужен ли торец на конце 1 / конце 2 (false = конец в стыке) */
  cap1: boolean; cap2: boolean
}

// ─── утилиты ────────────────────────────────────────────────────────────────

function d2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2
}

/**
 * Капитал (периметр/колонна) никогда не "уступает" изменяемой конструкции
 * при T-стыке — т.е. не может оказаться attached-стороной (обрезаемой),
 * даже если геометрически её конец случайно лёг на тело mutable-стены.
 * Между двумя capital или двумя mutable — приоритета нет, обычная геометрия.
 */
function attachedYieldsToMain(attached: WallForJoin, main: WallForJoin): boolean {
  if (attached.category === 'capital' && main.category === 'mutable') return false
  return true
}

/**
 * Пересечение двух прямых, заданных точкой и единичным направлением.
 * Возвращает null если параллельны.
 */
function rayX(
  p1x: number, p1y: number, d1x: number, d1y: number,
  p2x: number, p2y: number, d2x: number, d2y: number,
): Pt | null {
  const den = d1x * d2y - d1y * d2x
  if (Math.abs(den) < 1e-9) return null
  const t = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / den
  return { x: p1x + t * d1x, y: p1y + t * d1y }
}

/** Параметр t проекции точки P на прямую AB (0=A, 1=B). */
function projT(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-9) return 0
  return ((px - ax) * dx + (py - ay) * dy) / l2
}

// ─── кэш данных линии ───────────────────────────────────────────────────────

interface WInfo {
  ux: number; uy: number // единичный вектор вдоль оси
  nx: number; ny: number // перпендикуляр * halfPx (side+)
  len: number
}

// ─── главная функция ─────────────────────────────────────────────────────────

export function computeWallJoins(walls: WallForJoin[]): Map<string, JoinedWall> {
  const res = new Map<string, JoinedWall>()
  const info: Array<WInfo | null> = []

  // Инициализация дефолтных значений
  for (const w of walls) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1) { info.push(null); continue }
    const ux = dx / len, uy = dy / len
    const nx = -uy * w.halfPx, ny = ux * w.halfPx
    info.push({ ux, uy, nx, ny, len })
    res.set(w.id, {
      ax1: w.x1, ay1: w.y1, ax2: w.x2, ay2: w.y2,
      p1p: { x: w.x1 + nx, y: w.y1 + ny },
      p2p: { x: w.x2 + nx, y: w.y2 + ny },
      p2m: { x: w.x2 - nx, y: w.y2 - ny },
      p1m: { x: w.x1 - nx, y: w.y1 - ny },
      cap1: true, cap2: true,
    })
  }

  const EPS2 = JOIN_EPS * JOIN_EPS

  for (let i = 0; i < walls.length; i++) {
    const a = walls[i], ai = info[i]
    if (!ai) continue
    const ja = res.get(a.id)!

    for (let j = i + 1; j < walls.length; j++) {
      const b = walls[j], bi = info[j]
      if (!bi) continue
      const jb = res.get(b.id)!

      const aEnds: [number, number, 'end1' | 'end2'][] = [
        [a.x1, a.y1, 'end1'], [a.x2, a.y2, 'end2'],
      ]
      const bEnds: [number, number, 'end1' | 'end2'][] = [
        [b.x1, b.y1, 'end1'], [b.x2, b.y2, 'end2'],
      ]

      // ── L-стыки (конец A = конец B) ──────────────────────────────────────
      let foundL = false
      for (const [ax, ay, aEnd] of aEnds) {
        for (const [bx, by, bEnd] of bEnds) {
          if (d2(ax, ay, bx, by) > EPS2) continue
          applyL(a, b, ai, bi, ja, jb, aEnd, bEnd)
          foundL = true
        }
      }
      if (foundL) continue

      // ── T-стыки (конец A на теле B) ────────────────────────────────────
      for (const [ax, ay, aEnd] of aEnds) {
        const t = projT(ax, ay, b.x1, b.y1, b.x2, b.y2)
        if (t <= JOIN_EPS / bi.len || t >= 1 - JOIN_EPS / bi.len) continue
        const cx = b.x1 + t * (b.x2 - b.x1), cy = b.y1 + t * (b.y2 - b.y1)
        // Допуск — вся ПОЛОСА толщины стены B (её грань), а не только ось:
        // snapPoint() ставит конец примыкающей линии на БЛИЖНЮЮ ГРАНЬ,
        // это может быть на расстоянии b.halfPx от оси B (для толстых стен —
        // десятки px), не только в пределах JOIN_EPS от центра.
        const distToAxis = Math.sqrt(d2(ax, ay, cx, cy))
        if (distToAxis > b.halfPx + JOIN_EPS) continue
        if (!attachedYieldsToMain(a, b)) continue // капитал не обрезается изменяемой
        applyT(a, b, ai, bi, ja, aEnd)
      }

      // ── T-стыки (конец B на теле A) ────────────────────────────────────
      for (const [bx, by, bEnd] of bEnds) {
        const t = projT(bx, by, a.x1, a.y1, a.x2, a.y2)
        if (t <= JOIN_EPS / ai.len || t >= 1 - JOIN_EPS / ai.len) continue
        const cx = a.x1 + t * (a.x2 - a.x1), cy = a.y1 + t * (a.y2 - a.y1)
        const distToAxis = Math.sqrt(d2(bx, by, cx, cy))
        if (distToAxis > a.halfPx + JOIN_EPS) continue
        if (!attachedYieldsToMain(b, a)) continue // капитал не обрезается изменяемой
        applyT(b, a, bi, ai, jb, bEnd)
      }
    }
  }

  return res
}

// ─── L-стык: митровый стык, обе линии корректируются ──────────────────────

function applyL(
  a: WallForJoin, b: WallForJoin,
  ai: WInfo, bi: WInfo,
  ja: JoinedWall, jb: JoinedWall,
  aEnd: 'end1' | 'end2', bEnd: 'end1' | 'end2',
) {
  // Берём текущие (возможно уже скорректированные) точки граней
  const aPp = aEnd === 'end1' ? ja.p1p : ja.p2p
  const aPm = aEnd === 'end1' ? ja.p1m : ja.p2m
  const bPp = bEnd === 'end1' ? jb.p1p : jb.p2p
  const bPm = bEnd === 'end1' ? jb.p1m : jb.p2m

  // Пересечение Side+ A с Side+ B → внутренний угол
  const Ipp = rayX(aPp.x, aPp.y, ai.ux, ai.uy, bPp.x, bPp.y, bi.ux, bi.uy)
  // Пересечение Side− A с Side− B → внешний угол
  const Imm = rayX(aPm.x, aPm.y, ai.ux, ai.uy, bPm.x, bPm.y, bi.ux, bi.uy)
  if (!Ipp || !Imm) return

  // Устанавливаем скорректированные точки (только если конец ещё не обработан)
  setEnd(ja, aEnd, Ipp, Imm)
  setEnd(jb, bEnd, Ipp, Imm)

  // Расширяем оси для заливки:
  // Конец A продлевается вдоль dir_A на halfB (чтобы заливка дошла до внешнего угла)
  if (aEnd === 'end2') { ja.ax2 += ai.ux * b.halfPx; ja.ay2 += ai.uy * b.halfPx }
  else                  { ja.ax1 -= ai.ux * b.halfPx; ja.ay1 -= ai.uy * b.halfPx }

  // Конец B продлевается вдоль dir_B на halfA
  if (bEnd === 'end2') { jb.ax2 += bi.ux * a.halfPx; jb.ay2 += bi.uy * a.halfPx }
  else                  { jb.ax1 -= bi.ux * a.halfPx; jb.ay1 -= bi.uy * a.halfPx }
}

// ─── T-стык: attached обрезается до ближней грани main ───────────────────

function applyT(
  _attached: WallForJoin, main: WallForJoin,
  ai: WInfo, bi: WInfo,
  ja: JoinedWall,
  aEnd: 'end1' | 'end2',
) {
  // Направление "внутрь" attached от точки стыка
  const dir_into_x = aEnd === 'end1' ? ai.ux : -ai.ux
  const dir_into_y = aEnd === 'end1' ? ai.uy : -ai.uy

  // Dot с side+ main: если > 0, attached лежит со стороны side+ →
  // ближняя грань (та, в которую упирается attached) — это side+
  const dot = dir_into_x * (bi.nx / main.halfPx) + dir_into_y * (bi.ny / main.halfPx)
  const extSign = dot > 0 ? 1 : -1

  // Точка на ближней грани main (не дальней!) — именно туда физически
  // упирается примыкающая стена
  const extPx = main.x1 + extSign * bi.nx
  const extPy = main.y1 + extSign * bi.ny

  // Текущие точки граней attached
  const aPp = aEnd === 'end1' ? ja.p1p : ja.p2p
  const aPm = aEnd === 'end1' ? ja.p1m : ja.p2m

  // Пересечения Side± attached с внешней гранью main
  const Ip = rayX(aPp.x, aPp.y, ai.ux, ai.uy, extPx, extPy, bi.ux, bi.uy)
  const Im = rayX(aPm.x, aPm.y, ai.ux, ai.uy, extPx, extPy, bi.ux, bi.uy)
  if (!Ip || !Im) return

  setEnd(ja, aEnd, Ip, Im)

  // Расширяем ось attached до ближней грани main (dir_out = −dir_into)
  const dir_out_x = -dir_into_x
  const dir_out_y = -dir_into_y
  if (aEnd === 'end1') {
    ja.ax1 += dir_out_x * main.halfPx
    ja.ay1 += dir_out_y * main.halfPx
  } else {
    ja.ax2 += dir_out_x * main.halfPx
    ja.ay2 += dir_out_y * main.halfPx
  }
}

// ─── утилита: установить скорректированные точки конца ───────────────────

function setEnd(
  jw: JoinedWall, end: 'end1' | 'end2', pp: Pt, pm: Pt,
) {
  if (end === 'end1') {
    if (!jw.cap1) return // уже обработан
    jw.p1p = pp; jw.p1m = pm; jw.cap1 = false
  } else {
    if (!jw.cap2) return // уже обработан
    jw.p2p = pp; jw.p2m = pm; jw.cap2 = false
  }
}
