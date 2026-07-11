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

import type { PlanLine, PlanLineType, LineCategory, RectColumn } from '../types'
import { getLineVisual } from '../data/constructionTaxonomy'
import { rectColumnCornersPx } from './columnStamp'

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

/**
 * Позиция точки вдоль оси стены (в тех же мировых px, что и координаты) —
 * растёт от x1,y1 к x2,y2. Не путать с projT() — та возвращает t∈[0,1]
 * от длины, а тут — абсолютное расстояние, чтобы сравнивать точки без
 * лишнего деления.
 */
function axisPos(w: WallForJoin, wi: WInfo, p: Pt): number {
  return (p.x - w.x1) * wi.ux + (p.y - w.y1) * wi.uy
}

/**
 * Защита от перекручивания короткой стены под острым углом (см. KONSPEKT.md,
 * "ступенька" на диагональном примыкании — реальный кейс с объекта).
 *
 * Митровый стык может "утянуть" угловую точку НАЗАД за уже зафиксированную
 * точку на другом конце той же стены — если стена короткая, а угол между
 * ней и соседкой острый. Тогда верхняя и нижняя грани стены меняются
 * местами по ходу оси, и заливка получается перекрученной (самопересечение).
 *
 * Проверяем: не нарушает ли кандидат порядок точек вдоль оси относительно
 * уже зафиксированной точки на другом конце. Если нарушает — откатываемся
 * на исходную (не митрованную) точку конца стены: это оставит небольшой
 * зазор в самом углу вместо развёрнутого клина, что при таких коротких
 * отрезках заметно безопаснее.
 */
function safeCorner(
  w: WallForJoin, wi: WInfo, end: 'end1' | 'end2',
  candidate: Pt, fallback: Pt, otherEndCurrent: Pt,
): Pt {
  const MARGIN = 1 // px, запас на числовую погрешность
  const tCand = axisPos(w, wi, candidate)
  const tOther = axisPos(w, wi, otherEndCurrent)
  const ok = end === 'end2' ? tCand > tOther + MARGIN : tCand < tOther - MARGIN
  return ok ? candidate : fallback
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

  // Точки на ДРУГОМ конце той же стены (для проверки порядка вдоль оси)
  const aOtherPp = aEnd === 'end1' ? ja.p2p : ja.p1p
  const aOtherPm = aEnd === 'end1' ? ja.p2m : ja.p1m
  const bOtherPp = bEnd === 'end1' ? jb.p2p : jb.p1p
  const bOtherPm = bEnd === 'end1' ? jb.p2m : jb.p1m

  const aSafePp = safeCorner(a, ai, aEnd, Ipp, aPp, aOtherPp)
  const aSafePm = safeCorner(a, ai, aEnd, Imm, aPm, aOtherPm)
  const bSafePp = safeCorner(b, bi, bEnd, Ipp, bPp, bOtherPp)
  const bSafePm = safeCorner(b, bi, bEnd, Imm, bPm, bOtherPm)

  // Устанавливаем скорректированные точки (только если конец ещё не обработан)
  setEnd(ja, aEnd, aSafePp, aSafePm)
  setEnd(jb, bEnd, bSafePp, bSafePm)

  // Расширяем оси для заливки — но только со стороны, где реально
  // применился митр (не откат на fallback): иначе при коротком отрезке
  // под острым углом ось "уедет" дальше, чем реально прорисованные грани,
  // и получится нахлёст в другом месте.
  const aUsedMiter = aSafePp === Ipp && aSafePm === Imm
  const bUsedMiter = bSafePp === Ipp && bSafePm === Imm

  // Конец A продлевается вдоль dir_A на halfB (чтобы заливка дошла до внешнего угла)
  if (aUsedMiter) {
    if (aEnd === 'end2') { ja.ax2 += ai.ux * b.halfPx; ja.ay2 += ai.uy * b.halfPx }
    else                  { ja.ax1 -= ai.ux * b.halfPx; ja.ay1 -= ai.uy * b.halfPx }
  }

  // Конец B продлевается вдоль dir_B на halfA
  if (bUsedMiter) {
    if (bEnd === 'end2') { jb.ax2 += bi.ux * a.halfPx; jb.ay2 += bi.uy * a.halfPx }
    else                  { jb.ax1 -= bi.ux * a.halfPx; jb.ay1 -= bi.uy * a.halfPx }
  }
}

// ─── T-стык: attached обрезается до ближней грани main ───────────────────

function applyT(
  attached: WallForJoin, main: WallForJoin,
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

  // Защита от перекручивания — тот же самый самопересекающийся клин, что
  // и в applyL (см. safeCorner), возможен и на T-стыке: при почти
  // касательном угле между attached и гранью main (близко к 0° или 180°,
  // напр. диагональная стена почти вдоль грани колонны) пересечение Side±
  // может "утянуть" точку конца НАЗАД за уже зафиксированную точку на
  // другом конце той же стены. Откатываемся на исходную (не обрезанную)
  // точку конца — оставит небольшой зазор/нахлёст вместо развёрнутого клина.
  const otherPp = aEnd === 'end1' ? ja.p2p : ja.p1p
  const otherPm = aEnd === 'end1' ? ja.p2m : ja.p1m
  const safeIp = safeCorner(attached, ai, aEnd, Ip, aPp, otherPp)
  const safeIm = safeCorner(attached, ai, aEnd, Im, aPm, otherPm)

  setEnd(ja, aEnd, safeIp, safeIm)

  // Расширяем ось attached до ближней грани main — только если реально
  // применился обрез (не откат на fallback), иначе ось "уедет" дальше,
  // чем реально прорисованные грани (та же логика, что и в applyL).
  const usedMiter = safeIp === Ip && safeIm === Im
  if (usedMiter) {
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

// ─── общий сборщик входа для computeWallJoins (переиспользуется 2D-планом
// в FloorPlan.tsx и 3D-переводчиком в planTo3D.ts, чтобы не дублировать
// логику "какие линии/колонны считаются стенами для стыковки") ────────────

// ─── угол узла (debug/справочно) ───────────────────────────────────────────

export interface JoinAngleInfo {
  /** Точка стыка, мировые px */
  x: number; y: number
  /** Внутренний угол узла в градусах (0..180) — угол между стенами,
   *  считая от точки стыка наружу вдоль каждой стены. Побочный продукт
   *  той же геометрии, что и биссектриса митра в applyL. */
  angleDeg: number
  wallAId: string
  wallBId: string
}

/**
 * Находит все L-стыки (конец=конец) среди стен и возвращает угол узла в
 * градусах для каждого. Не пересчитывает митр — только диагностика/
 * подпись на плане, использует ту же пару направлений, что и applyL.
 *
 * См. KONSPEKT.md 11.07.2026 — открытая задача "показывать угол узла
 * в градусах", а также диагностика самопересекающегося клина на остром
 * угле (safeCorner) — угол в градусах нужен, чтобы воспроизвести кейс
 * в юнит-тесте по точным цифрам с объекта.
 */
export function computeJoinAngles(walls: WallForJoin[]): JoinAngleInfo[] {
  const result: JoinAngleInfo[] = []
  const EPS2 = JOIN_EPS * JOIN_EPS

  for (let i = 0; i < walls.length; i++) {
    const a = walls[i]
    const dxA = a.x2 - a.x1, dyA = a.y2 - a.y1
    const lenA = Math.sqrt(dxA * dxA + dyA * dyA)
    if (lenA < 1) continue

    for (let j = i + 1; j < walls.length; j++) {
      const b = walls[j]
      const dxB = b.x2 - b.x1, dyB = b.y2 - b.y1
      const lenB = Math.sqrt(dxB * dxB + dyB * dyB)
      if (lenB < 1) continue

      const aEnds: [number, number, 'end1' | 'end2'][] = [
        [a.x1, a.y1, 'end1'], [a.x2, a.y2, 'end2'],
      ]
      const bEnds: [number, number, 'end1' | 'end2'][] = [
        [b.x1, b.y1, 'end1'], [b.x2, b.y2, 'end2'],
      ]

      for (const [ax, ay, aEnd] of aEnds) {
        for (const [bx, by, bEnd] of bEnds) {
          if (d2(ax, ay, bx, by) > EPS2) continue

          // Направления ОТ точки стыка наружу вдоль каждой стены
          const vax = aEnd === 'end1' ? dxA / lenA : -dxA / lenA
          const vay = aEnd === 'end1' ? dyA / lenA : -dyA / lenA
          const vbx = bEnd === 'end1' ? dxB / lenB : -dxB / lenB
          const vby = bEnd === 'end1' ? dyB / lenB : -dyB / lenB

          const dot = vax * vbx + vay * vby
          const clamped = Math.max(-1, Math.min(1, dot))
          const angleDeg = Math.acos(clamped) * 180 / Math.PI

          result.push({ x: ax, y: ay, angleDeg, wallAId: a.id, wallBId: b.id })
        }
      }
    }
  }

  return result
}

/** Капитал по умолчанию — периметр (wall_existing) и ригели, всё остальное изменяемое */
export function defaultCategory(type: PlanLineType): LineCategory {
  return (type === 'wall_existing' || type === 'rib_beam') ? 'capital' : 'mutable'
}

/**
 * Половина толщины (px) для граней прямоугольных колонн в computeWallJoins.
 * Не может быть строго 0 (деление в applyT на main.halfPx) — грань колонны
 * физически плоскость без своей толщины, берём мизерное значение: числовая
 * погрешность на уровне долей мм, которой можно пренебречь.
 */
export const COLUMN_EDGE_HALF_PX = 0.01

/**
 * Строит список WallForJoin из линий плана (wall_new/wall_existing/... с
 * заданным материалом и толщиной ≥3px) + граней прямоугольных колонн (как
 * капитальные "стены" почти нулевой толщины — см. COLUMN_EDGE_HALF_PX).
 *
 * Грани колонны участвуют в T-стыке под ЛЮБЫМ углом (не только 90°) — та
 * же математика пересечения линий, что и для стена-к-стене (applyT). До
 * этого колонны вообще не участвовали в computeWallJoins — линия, упирающаяся
 * в колонну под углом, не обрезалась НИКАК (см. КОНСПЕКТ, 08.07.2026).
 *
 * rectColumns — необязательный параметр (дефолт []) для мест, где колонны
 * ещё не подключены к вызову (обратная совместимость).
 */
export function buildWallsForJoin(
  lines: PlanLine[],
  scaleMmPx: number,
  rectColumns: RectColumn[] = [],
): WallForJoin[] {
  const walls: WallForJoin[] = []
  lines.forEach((l, idx) => {
    const vis = getLineVisual(l.type, l.spec?.material, l.spec?.subtype, l.spec?.gapMm)
    const hasSpec = !!(l.spec?.material)
    const thicknessPx = hasSpec && vis.thicknessMm > 0 ? vis.thicknessMm / scaleMmPx : 0
    if (thicknessPx <= 3) return
    if (l.sagittaMm) return // дуга — join со стенами пока не считаем (см. KONSPEKT.md)
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1
    if (Math.sqrt(dx * dx + dy * dy) < 1) return
    walls.push({
      id: l.id,
      x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
      halfPx: thicknessPx / 2,
      createdIndex: idx,
      category: l.category ?? defaultCategory(l.type),
    })
  })
  rectColumns.forEach((rc, rcIdx) => {
    const corners = rectColumnCornersPx(rc.cx, rc.cy, rc.widthMm, rc.depthMm, rc.angleRad, scaleMmPx)
    for (let e = 0; e < 4; e++) {
      const p0 = corners[e], p1 = corners[(e + 1) % 4]
      walls.push({
        id: `__rectcol_${rc.id}_edge${e}`,
        x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y,
        halfPx: COLUMN_EDGE_HALF_PX,
        createdIndex: -1000 - rcIdx * 4 - e,
        category: rc.category ?? 'capital',
      })
    }
  })
  return walls
}
