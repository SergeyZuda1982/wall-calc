/**
 * Точный геометрический расчёт каркаса П112 для ПРОИЗВОЛЬНОГО контура потолка
 * (в т.ч. вогнутого — L/Т-образного, из объединения нескольких помещений без
 * капитальной перегородки, см. Ceiling-сущность и CeilingCalc.tsx) —
 * пункт 6 плана (KONSPEKT.md 10.07.2026, продолжение сессии про потолки).
 *
 * Обобщает calcP112Frame.ts (там — только прямоугольник L×W) на произвольный
 * простой многоугольник с необязательными дырками (шахты/короба — сквозь
 * scanlineCrossings обрабатываются автоматически, чёт-нечёт).
 *
 * ─── Идея алгоритма ────────────────────────────────────────────────────────
 * 1. Выбранная пользователем "стена начала раскладки" (см. StartWallPicker
 *    в CeilingCalc.tsx, пункт 5) задаёт локальную систему координат:
 *      U — вдоль стены (от её начала к концу),
 *      V — перпендикулярно, вглубь помещения.
 *    Вся дальнейшая геометрия считается в этой локальной системе — ровно те
 *    же формулы, что и для прямоугольника, просто "ширина/длина помещения"
 *    заменяются на "протяжённость контура вдоль U/V".
 * 2. ОСНОВНОЙ профиль (шаг c) — ряды на фиксированных V (шаг от стены вглубь
 *    помещения, calcFrameRowPositions), каждый ряд тянется вдоль U. Раньше
 *    (для прямоугольника) один ряд = один сплошной отрезок на весь пролёт;
 *    для вогнутого контура ряд может распасться на НЕСКОЛЬКО отдельных
 *    отрезков (insideSegments) — каждый отрезок = отдельный физический кусок
 *    профиля (с своими удлинителями, если длиннее 3м).
 * 3. НЕСУЩИЙ профиль (шаг b) — симметрично, ряды на фиксированных U, каждый
 *    ряд тянется вдоль V, тоже может распасться на несколько отрезков.
 * 4. Соединитель-краб — в каждой точке пересечения (несущий ряд × основной
 *    ряд), которая физически лежит внутри контура (pointInPolygon) — если
 *    точка внутри, значит она попадает и в отрезок несущего, и в отрезок
 *    основного ряда одновременно (оба ряда — сечения ОДНОГО И ТОГО ЖЕ
 *    контура на пересекающихся линиях, поэтому проверка через контур
 *    эквивалентна проверке пересечения отрезков, но проще).
 * 5. Подвесы — 12.07.2026: подвес физически крепится к ОСНОВНОМУ профилю
 *    (см. исправление в calcP112Frame.ts, там было наоборот) — ОТДЕЛЬНО для
 *    каждого ряда основного профиля: берём U-позиции несущего профиля,
 *    которые физически пересекают ИМЕННО этот ряд основного (через
 *    pointInPolygon), и прогоняем через snapHangerPositionsToAxis.
 *    Для прямоугольника это давало один и тот же список для всех рядов —
 *    здесь список может отличаться от ряда к ряду (вогнутая форма).
 *
 * ─── Осознанные упрощения / известные границы (v1, 10.07.2026) ────────────
 * — Если выбранная стена не в САМОМ дальнем углу контура (часть фигуры
 *   оказывается "позади" неё, т.е. U<0 или V<0) — раньше (до 12.07.2026)
 *   эта часть в сетку не попадала. Теперь calcFrameRowPositionsSigned
 *   (calcP112Frame.ts) строит ряды и в отрицательную сторону — сетка
 *   покрывает весь контур при любой выбранной стене, просто выдаётся
 *   мягкий warning: для минимума обрезков удобнее стена от крайнего угла.
 * — Дырки (holesMm) уже поддержаны на уровне геометрии (scanlineCrossings),
 *   но сама сущность "вырез в потолке" как отдельная фича — пункт 1 плана,
 *   ещё не реализована; здесь они учитываются просто потому что структура
 *   данных CeilingSeedZone уже несёт holesMm с сессии про Плиту.
 */

import type { Point2D } from './geometry2d'
import { insideSegments, pointInPolygon } from './geometry2d'
import type { CeilingLoadClass, CeilingMountDirection } from '../data/ceilingData'
import { KNAUF_WALL_OFFSET_MM } from '../data/ceilingData'
import {
  calcFrameRowPositionsSigned, snapHangerPositionsToAxis, resolveHangerKind,
  STANDARD_BAR_LENGTH_MM, type FrameLayoutMode, type HangerKind,
} from './calcP112Frame'

// ─── Локальная система координат от выбранной стены ────────────────────────

export interface LocalFrame {
  origin: Point2D
  /** Орт вдоль стены (U). */
  ux: number
  uy: number
  /** Орт перпендикулярно стене, внутрь контура (V). */
  vx: number
  vy: number
}

/** Строит локальный базис по выбранной стороне контура — U вдоль неё (от
 *  start к end), V перпендикулярно, развёрнут так, чтобы центроид контура
 *  (грубая, но достаточная оценка "внутрь") был на положительной стороне V. */
export function buildLocalFrame(side: { start: Point2D; end: Point2D }, outerMm: Point2D[]): LocalFrame {
  const dx = side.end.x - side.start.x
  const dy = side.end.y - side.start.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  let vx = -uy
  let vy = ux
  const cx = outerMm.reduce((s, p) => s + p.x, 0) / outerMm.length
  const cy = outerMm.reduce((s, p) => s + p.y, 0) / outerMm.length
  const dot = (cx - side.start.x) * vx + (cy - side.start.y) * vy
  if (dot < 0) { vx = -vx; vy = -vy }
  return { origin: side.start, ux, uy, vx, vy }
}

export function toLocal(p: Point2D, f: LocalFrame): Point2D {
  const dx = p.x - f.origin.x
  const dy = p.y - f.origin.y
  return { x: dx * f.ux + dy * f.uy, y: dx * f.vx + dy * f.vy }
}

export function toWorld(p: Point2D, f: LocalFrame): Point2D {
  return {
    x: f.origin.x + p.x * f.ux + p.y * f.vx,
    y: f.origin.y + p.x * f.uy + p.y * f.vy,
  }
}

/** Контур + дырки → локальные координаты (один вызов на весь набор). */
export function polygonsToLocal(loops: Point2D[][], f: LocalFrame): Point2D[][] {
  return loops.map(loop => loop.map(p => toLocal(p, f)))
}

// ─── Результат ───────────────────────────────────────────────────────────────

/** Один ряд каркаса — может состоять из нескольких отдельных отрезков
 *  (вогнутый контур режет ряд на куски). Координаты — локальные (мм). */
export interface PolygonFrameRow {
  /** Позиция ряда вдоль перпендикулярной оси (V для основного, U для
   *  несущего), мм от выбранной стены. */
  pos: number
  /** Отрезки ряда вдоль его собственной оси (U для основного, V для
   *  несущего), локальные координаты [начало, конец], мм. */
  segments: [number, number][]
  /** Сумма длин отрезков, мм. */
  lengthMm: number
}

export interface PolygonP112FrameResult {
  frame: LocalFrame
  /** Ряды основного профиля (шаг c), позиция — вдоль V. */
  mainRows: PolygonFrameRow[]
  /** Ряды несущего профиля (шаг b), позиция — вдоль U. */
  bearingRows: PolygonFrameRow[]
  mainTotalLm: number
  bearingTotalLm: number
  mainExtenders: number
  bearingExtenders: number
  connectorsTotal: number
  hangersTotal: number
  /** Точки кабов (пересечения несущего/основного внутри контура), локальные
   *  координаты (u,v), мм — для 3D-рендера (CeilingGridMesh), пункт 7 плана
   *  (KONSPEKT.md 10.07.2026). connectorsTotal === crabPoints.length. */
  crabPoints: Point2D[]
  /** Точки подвесов (подмножество crabPoints по snapHangerPositionsToAxis),
   *  локальные (u,v), мм — для 3D. hangersTotal === hangerPoints.length. */
  hangerPoints: Point2D[]
  hangerKind: HangerKind
  warnings: string[]
}

/** Удлинители для одного отрезка профиля — сколько стыков нужно на баре
 *  длиной STANDARD_BAR_LENGTH_MM (3000мм), см. calcP112Frame.ts. */
function extendersForSegment(lengthMm: number): number {
  return Math.max(0, Math.ceil(lengthMm / STANDARD_BAR_LENGTH_MM) - 1)
}

export interface CalcPolygonP112FrameOpts {
  stepA?: number
  wallOffsetMainMm?: number
  wallOffsetBearingMm?: number
  loadClass?: CeilingLoadClass
  mountDirection?: CeilingMountDirection
}

/**
 * Геометрия каркаса П112 для произвольного (в т.ч. вогнутого) контура.
 *
 * @param outerMm внешний контур потолка, мм, в исходных мировых координатах
 * @param holesMm дырки (шахты/короба), тот же список контуров, что и outerMm
 * @param startSide выбранная стена начала раскладки (см. polygonSides)
 * @param stepC шаг основного профиля, мм
 * @param stepB шаг несущего профиля, мм
 * @param slabGapMm зазор до плиты — для типа подвеса
 * @param layoutMode 'user' | 'knauf' — см. calcP112Frame.ts
 */
export function calcPolygonP112Frame(
  outerMm: Point2D[],
  holesMm: Point2D[][],
  startSide: { start: Point2D; end: Point2D },
  stepC: number,
  stepB: number,
  slabGapMm: number,
  layoutMode: FrameLayoutMode = 'user',
  extra: CalcPolygonP112FrameOpts = {},
): PolygonP112FrameResult {
  const warnings: string[] = []
  const frame = buildLocalFrame(startSide, outerMm)
  const loopsLocal = polygonsToLocal([outerMm, ...holesMm], frame)
  const outerLocal = loopsLocal[0]

  const uMax = Math.max(...outerLocal.map(p => p.x))
  const uMin = Math.min(...outerLocal.map(p => p.x))
  const vMax = Math.max(...outerLocal.map(p => p.y))
  const vMin = Math.min(...outerLocal.map(p => p.y))

  const TOL = 30 // мм — контур считается "начинающимся точно от стены" в пределах этого допуска
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

  const defaultWallOffset = layoutMode === 'knauf' ? KNAUF_WALL_OFFSET_MM : undefined
  const wallOffsetMainMm = extra.wallOffsetMainMm ?? defaultWallOffset
  const wallOffsetBearingMm = extra.wallOffsetBearingMm ?? defaultWallOffset
  const stepA = extra.stepA ?? stepB

  // ── Основной профиль: ряды на фиксированных V, тянутся вдоль U ──────────
  const mainVPositions = calcFrameRowPositionsSigned(vMin, vMax, stepC, { mode: layoutMode, wallOffsetMm: wallOffsetMainMm })
  const mainRows: PolygonFrameRow[] = mainVPositions.map(v => {
    const segments = insideSegments(loopsLocal, v, 'y')
    const lengthMm = segments.reduce((s, [a, b]) => s + (b - a), 0)
    return { pos: v, segments, lengthMm }
  })

  // ── Несущий профиль: ряды на фиксированных U, тянутся вдоль V ───────────
  const bearingUPositions = calcFrameRowPositionsSigned(uMin, uMax, stepB, { mode: layoutMode, wallOffsetMm: wallOffsetBearingMm })
  const bearingRows: PolygonFrameRow[] = bearingUPositions.map(u => {
    const segments = insideSegments(loopsLocal, u, 'x')
    const lengthMm = segments.reduce((s, [a, b]) => s + (b - a), 0)
    return { pos: u, segments, lengthMm }
  })

  const mainTotalLm = mainRows.reduce((s, r) => s + r.lengthMm, 0) / 1000
  const bearingTotalLm = bearingRows.reduce((s, r) => s + r.lengthMm, 0) / 1000

  const mainExtenders = mainRows.reduce((s, r) => s + r.segments.reduce((s2, [a, b]) => s2 + extendersForSegment(b - a), 0), 0)
  const bearingExtenders = bearingRows.reduce((s, r) => s + r.segments.reduce((s2, [a, b]) => s2 + extendersForSegment(b - a), 0), 0)

  // ── Соединители-крабы и подвесы ──────────────────────────────────────────
  // 12.07.2026: подвес — на основном профиле (см. исправление комментария
  // выше), поэтому внешний цикл теперь по mainRows (не bearingRows), а
  // снэпаются U-позиции несущего профиля.
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
