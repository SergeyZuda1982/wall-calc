/**
 * Точный геометрический расчёт каркаса П113 (одноуровневый) для
 * ПРОИЗВОЛЬНОГО контура потолка (в т.ч. вогнутого) — по прямой аналогии с
 * `calcPolygonP112Frame.ts` (пункт 6 плана, KONSPEKT.md 10.07.2026), но с
 * топологией П113 (см. `calcP113Frame.ts` — прямоугольный вариант, шапка
 * файла целиком описывает роли профилей и источник, здесь не повторяется).
 *
 * ─── Что отличается от calcPolygonP112Frame.ts ─────────────────────────────
 * У П112 ОБА профиля (несущий и основной) — сплошные внутри контура, просто
 * обрезанные его границами (insideSegments даёт готовый список отрезков на
 * ряд). У П113 роли обратные и физика другая:
 *   ОСНОВНОЙ профиль (шаг c) — как и у П112: сплошной внутри контура,
 *     ряды на фиксированных V, тянутся вдоль U. insideSegments достаточно —
 *     ряд просто обрезается границей контура, как и раньше.
 *   НЕСУЩИЙ профиль (шаг b) — ряды на фиксированных U, тянутся вдоль V, НО
 *     физически режется КОРОТКИМИ ВСТАВКАМИ между соседними рядами основного
 *     профиля (тот же принцип, что и в прямоугольном calcP113FrameGeometry,
 *     bearingSegmentLengthsMm) — insideSegments даёт только границу контура,
 *     дальше каждый такой интервал ДОПОЛНИТЕЛЬНО режется в точках, где его
 *     пересекают позиции основного профиля (mainVPositions), через
 *     splitSegmentAtCuts. Каждый получившийся кусок — отдельная физическая
 *     вставка со своими удлинителями (если длиннее 3м, на практике редкость).
 * Крабы/подвесы — соединитель ОДНОУРОВНЕВЫЙ (один на пересечение), подвес —
 *   на основном профиле, снэпается по позициям несущего вдоль U — та же
 *   логика (и тот же код), что и в calcPolygonP112Frame.ts, потому что после
 *   правки 12.07.2026 внешний цикл там уже идёт по mainRows независимо от
 *   типа системы (см. комментарий в calcP112Frame.ts, snapHangerPositionsToAxis).
 */

import type { Point2D } from './geometry2d'
import { insideSegments, pointInPolygon } from './geometry2d'
import type { CeilingLoadClass, CeilingMountDirection } from '../data/ceilingData'
import { KNAUF_WALL_OFFSET_MAIN_MM, KNAUF_WALL_OFFSET_BEARING_MM } from '../data/ceilingData'
import {
  calcFrameRowPositionsSigned, snapHangerPositionsToAxis, resolveHangerKind,
  STANDARD_BAR_LENGTH_MM, type FrameLayoutMode, type HangerKind,
} from './calcP112Frame'
import {
  buildLocalFrame, toLocal, toWorld, polygonsToLocal,
  type LocalFrame, type PolygonFrameRow,
} from './calcPolygonP112Frame'

export { buildLocalFrame, toLocal, toWorld, polygonsToLocal }
export type { LocalFrame, PolygonFrameRow }

export interface PolygonP113FrameResult {
  frame: LocalFrame
  /** Ряды основного профиля (шаг c, сплошной) — позиция вдоль V. */
  mainRows: PolygonFrameRow[]
  /** Ряды несущего профиля (шаг b, короткие вставки) — позиция вдоль U;
   *  segments уже разрезаны и по контуру, и по пересечениям с mainRows. */
  bearingRows: PolygonFrameRow[]
  mainTotalLm: number
  bearingTotalLm: number
  mainExtenders: number
  bearingExtenders: number
  /** Соединитель одноуровневый — один на пересечение (не двухуровневый краб). */
  connectorsTotal: number
  hangersTotal: number
  /** Точки соединителей внутри контура, локальные (u,v), мм. */
  crabPoints: Point2D[]
  hangerPoints: Point2D[]
  hangerKind: HangerKind
  warnings: string[]
}

function extendersForSegment(lengthMm: number): number {
  return Math.max(0, Math.ceil(lengthMm / STANDARD_BAR_LENGTH_MM) - 1)
}

/** Допуск (мм) для сравнения позиций основного профиля с границами отрезка
 *  несущего при разрезании — совпадает с JOIN_EPS-масштабом, используемым
 *  в остальном проекте для геометрии на мм-координатах. */
const CUT_EPS_MM = 0.5

/** Режет отрезок [a,b] на куски в точках cuts, которые СТРОГО внутри (a,b)
 *  (с допуском CUT_EPS_MM) — точки на границе или вне отрезка игнорируются.
 *  Всегда возвращает хотя бы один кусок (сам [a,b], если резать не пришлось). */
function splitSegmentAtCuts(a: number, b: number, cuts: number[]): [number, number][] {
  const inner = cuts
    .filter(c => c > a + CUT_EPS_MM && c < b - CUT_EPS_MM)
    .sort((x, y) => x - y)
  const points = [a, ...inner, b]
  const segs: [number, number][] = []
  for (let i = 0; i + 1 < points.length; i++) segs.push([points[i], points[i + 1]])
  return segs
}

export interface CalcPolygonP113FrameOpts {
  stepA?: number
  wallOffsetMainMm?: number
  wallOffsetBearingMm?: number
  loadClass?: CeilingLoadClass
  mountDirection?: CeilingMountDirection
}

/**
 * Геометрия каркаса П113 для произвольного (в т.ч. вогнутого) контура.
 *
 * @param outerMm внешний контур потолка, мм, мировые координаты
 * @param holesMm дырки (шахты/короба), тот же формат, что и outerMm
 * @param startSide выбранная стена начала раскладки (см. polygonSides)
 * @param stepC шаг основного профиля (сплошного), мм
 * @param stepB шаг несущего профиля (вставки), мм
 * @param slabGapMm зазор до плиты — для типа подвеса
 * @param layoutMode 'user' | 'knauf' — см. calcP112Frame.ts
 */
export function calcPolygonP113Frame(
  outerMm: Point2D[],
  holesMm: Point2D[][],
  startSide: { start: Point2D; end: Point2D },
  stepC: number,
  stepB: number,
  slabGapMm: number,
  layoutMode: FrameLayoutMode = 'user',
  extra: CalcPolygonP113FrameOpts = {},
): PolygonP113FrameResult {
  const warnings: string[] = []
  const frame = buildLocalFrame(startSide, outerMm)
  const loopsLocal = polygonsToLocal([outerMm, ...holesMm], frame)
  const outerLocal = loopsLocal[0]

  const uMax = Math.max(...outerLocal.map(p => p.x))
  const uMin = Math.min(...outerLocal.map(p => p.x))
  const vMax = Math.max(...outerLocal.map(p => p.y))
  const vMin = Math.min(...outerLocal.map(p => p.y))

  const TOL = 30 // мм — см. calcPolygonP112Frame.ts, тот же смысл допуска
  if (uMin < -TOL) {
    warnings.push(
      `Часть контура выходит за пределы выбранной стены (примерно на ${Math.round(-uMin)}мм влево от её начала) ` +
      `— сетка каркаса всё равно посчитана и для этой части (профиль продолжен в обратную сторону тем же шагом), ` +
      `но для наименьшего числа обрезков удобнее выбрать сторону, начинающуюся в самом крайнем углу контура.`,
    )
  }
  if (vMin < -TOL) {
    warnings.push(
      `Часть контура находится «позади» выбранной стены (примерно на ${Math.round(-vMin)}мм) ` +
      `— сетка каркаса всё равно посчитана и для этой части тем же шагом.`,
    )
  }

  const defaultWallOffsetMain = layoutMode === 'knauf' ? KNAUF_WALL_OFFSET_MAIN_MM : undefined
  const defaultWallOffsetBearing = layoutMode === 'knauf' ? KNAUF_WALL_OFFSET_BEARING_MM : undefined
  const wallOffsetMainMm = extra.wallOffsetMainMm ?? defaultWallOffsetMain
  const wallOffsetBearingMm = extra.wallOffsetBearingMm ?? defaultWallOffsetBearing
  const stepA = extra.stepA ?? stepB

  // ── Основной профиль: сплошной, ряды на фиксированных V, вдоль U ────────
  // (точно как mainRows в calcPolygonP112Frame.ts — контур режет ряд только
  // своей границей, позиции несущего профиля его НЕ дробят).
  const mainVPositions = calcFrameRowPositionsSigned(vMin, vMax, stepC, { mode: layoutMode, wallOffsetMm: wallOffsetMainMm, profileKind: 'main' })
  const mainRows: PolygonFrameRow[] = mainVPositions.map(v => {
    const segments = insideSegments(loopsLocal, v, 'y')
    const lengthMm = segments.reduce((s, [a, b]) => s + (b - a), 0)
    return { pos: v, segments, lengthMm }
  })

  // ── Несущий профиль: ряды на фиксированных U, вдоль V, режется на КОРОТКИЕ
  // ВСТАВКИ между соседними рядами основного профиля (см. шапку файла) ─────
  const bearingUPositions = calcFrameRowPositionsSigned(uMin, uMax, stepB, { mode: layoutMode, wallOffsetMm: wallOffsetBearingMm, profileKind: 'bearing' })
  const bearingRows: PolygonFrameRow[] = bearingUPositions.map(u => {
    const rawSegments = insideSegments(loopsLocal, u, 'x')
    const segments = rawSegments.flatMap(([a, b]) => splitSegmentAtCuts(a, b, mainVPositions))
    const lengthMm = segments.reduce((s, [a, b]) => s + (b - a), 0)
    return { pos: u, segments, lengthMm }
  })

  const mainTotalLm = mainRows.reduce((s, r) => s + r.lengthMm, 0) / 1000
  const bearingTotalLm = bearingRows.reduce((s, r) => s + r.lengthMm, 0) / 1000

  const mainExtenders = mainRows.reduce((s, r) => s + r.segments.reduce((s2, [a, b]) => s2 + extendersForSegment(b - a), 0), 0)
  const bearingExtenders = bearingRows.reduce((s, r) => s + r.segments.reduce((s2, [a, b]) => s2 + extendersForSegment(b - a), 0), 0)

  // ── Соединители (одноуровневые) и подвесы ────────────────────────────────
  // Подвес — на основном профиле, снэп по позициям несущего вдоль U — та же
  // логика, что и в calcPolygonP112Frame.ts (внешний цикл по mainRows).
  const crabPoints: Point2D[] = []
  const hangerPoints: Point2D[] = []
  for (const vRow of mainRows) {
    const validUs = bearingUPositions.filter(u => pointInPolygon({ x: u, y: vRow.pos }, loopsLocal))
    for (const u of validUs) crabPoints.push({ x: u, y: vRow.pos })
    for (const u of snapHangerPositionsToAxis(validUs, stepA)) hangerPoints.push({ x: u, y: vRow.pos })
  }
  const connectorsTotal = crabPoints.length
  const hangersTotal = hangerPoints.length

  const { kind: hangerKind, warning: hangerWarning } = resolveHangerKind(slabGapMm)
  if (hangerWarning) warnings.push(hangerWarning)

  return {
    frame, mainRows, bearingRows, mainTotalLm, bearingTotalLm,
    mainExtenders, bearingExtenders, connectorsTotal, hangersTotal,
    crabPoints, hangerPoints, hangerKind, warnings,
  }
}
