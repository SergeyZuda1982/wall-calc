/**
 * Проектный раскрой листов (ГКЛ/ГВЛ/Сапфир/Аквамарин).
 *
 * Пул обрезков течёт последовательно через все конструкции объекта:
 *   перегородка 1 → перегородка 2 → … → облицовка 1 → облицовка 2 → …
 *   → потолок 1 → потолок 2 → … (12.07.2026, шаг 2 плана — см. чат)
 *
 * Расширяемость: функция работает с абстрактным SurfaceSheetInput —
 * не знает, перегородка это или облицовка. Достаточно передать правильные
 * sides=1|2 и параметры геометрии.
 *
 * ─── 12.07.2026: потолки — ОТДЕЛЬНЫЙ параллельный тип, не SurfaceSheetInput ──
 * Как задумывалось изначально (см. комментарий выше, был "в будущем: третий
 * параметр ceilings"), казалось — потолок можно завести как ещё один
 * SurfaceSheetInput (wallL × wallH, как прямоугольная стена). Но свободный
 * Ceiling-контур (пункт 6-7 плана каркаса, calcPolygonP112Frame.ts) может
 * быть ВОГНУТЫМ — это полигон, не прямоугольник, raскрой у него собственный
 * (calcPolygonSheetLayout.ts, работает через outer/holes/startSide, а не
 * wallL/firstStud/step). Поэтому — параллельный тип PolygonSurfaceInput и
 * отдельный билдер buildCeilingSurfaceInputs; сквозной пул обрезков от этого
 * не страдает — оба движка обмениваются одним и тем же BoardOffcut[].
 */

import type { Opening, BoardSpec, BoardOffcut, BoardSheetResult } from '../types'
import type { WallEntry, LiningEntry } from '../store/useProjectStore'
import type { Ceiling } from '../types'
import type { CeilingSpecFull } from '../data/ceilingData'
import type { Point2D } from './geometry2d'
import { polygonSides } from './geometry2d'
import { calcSheetLayout } from './calcSheetLayout'
import { calcPolygonSheetLayout, type PolygonSheetLayoutResult } from './calcPolygonSheetLayout'
import { flatProfile } from './profileGeometry'

// ─── Публичные типы ─────────────────────────────────────────────────────────

/** Абстрактная поверхность для раскроя: перегородка, облицовка, потолок */
export interface SurfaceSheetInput {
  id: string
  label: string
  wallL: number          // длина конструкции, мм
  wallH: number          // максимальная высота (worst case), мм
  firstStud: number      // позиция первой рабочей стойки от левого края, мм
  step: number           // шаг стоек, мм
  gklLayers: 1 | 2
  openings: Opening[]
  layer1: BoardSpec
  layer2: BoardSpec
  sides: 1 | 2           // 2 = перегородка (А+Б), 1 = облицовка / потолок
}

export interface SurfaceSheetResult {
  id: string
  label: string
  result: BoardSheetResult
}

/** Потолок по произвольному контуру (см. заголовок файла) — параллельный
 *  вход для calcPolygonSheetLayout.ts, не SurfaceSheetInput. */
export interface PolygonSurfaceInput {
  id: string
  label: string
  outerMm: Point2D[]
  holesMm: Point2D[][]
  startSide: { start: Point2D; end: Point2D }
  sheetLengthMm: number
  gklLayers: 1 | 2
  layer1: BoardSpec
  layer2: BoardSpec
}

export interface PolygonSurfaceResult {
  id: string
  label: string
  result: PolygonSheetLayoutResult
}

export interface ProjectSheetResult {
  /** Оба типа результата используют одни и те же 4 агрегатных поля
   *  (totalSheetsNeeded/totalUsedAreaM2/totalSheetAreaM2/totalWastePercent) —
   *  этого достаточно для табличных сводок (App.tsx, FloorPlan.tsx), поэтому
   *  UI не нужно различать перегородку/облицовку и потолок. */
  surfaces: (SurfaceSheetResult | PolygonSurfaceResult)[]
  totalSheetsNeeded: number
  totalUsedAreaM2: number
  totalSheetAreaM2: number
  totalOffcutAreaM2: number
  totalWastePercent: number
  finalOffcuts: BoardOffcut[]
}

// ─── Построение входных данных из store-записей ──────────────────────────────

/**
 * Преобразует записи объекта (стены + облицовки) в единый список SurfaceSheetInput.
 * Порядок: стены в порядке добавления, затем облицовки в порядке добавления.
 * В будущем сюда добавится третий параметр ceilings.
 */
export function buildSurfaceInputs(
  walls: WallEntry[],
  linings: LiningEntry[],
): SurfaceSheetInput[] {
  const surfaces: SurfaceSheetInput[] = []

  // ── Перегородки ──────────────────────────────────────────────────────────
  for (const w of walls) {
    if (!w.result || !w.positions || w.positions.length < 2) continue

    const snapL = w.positions[w.positions.length - 1]
    const firstStud = w.positions.find(p => p > 0 && p < snapL) ?? w.input.step
    const snapWorstH = w.result.studInfos.length > 0
      ? Math.max(...w.result.studInfos.map(s => s.height))
      : w.input.height

    // С112 — всегда 2 слоя; остальные — 1 слой (с623/с625/с626 тут не бывает)
    const gklLayers: 1 | 2 = w.input.wallType === 'c112' ? 2 : 1

    surfaces.push({
      id: w.id,
      label: w.label,
      wallL: snapL,
      wallH: snapWorstH,
      firstStud,
      step: w.input.step,
      gklLayers,
      openings: w.input.openings,
      layer1: w.input.layer1,
      layer2: w.input.layer2,
      sides: 2,
    })
  }

  // ── Облицовки ─────────────────────────────────────────────────────────────
  for (const l of linings) {
    if (!l.result) continue

    const snapL = l.input.length
    // Позиции стоек облицовки в store не хранятся — используем шаг как firstStud
    const firstStud = l.input.step
    const snapWorstH = l.result.studInfos.length > 0
      ? Math.max(...l.result.studInfos.map(s => s.height))
      : l.input.height

    // С626 фиксированно 2 слоя; С623/С625 — по выбору пользователя
    const gklLayers: 1 | 2 = l.input.liningType === 'c626' ? 2 : (l.input.gklLayers as 1 | 2)

    surfaces.push({
      id: l.id,
      label: l.label,
      wallL: snapL,
      wallH: snapWorstH,
      firstStud,
      step: l.input.step,
      gklLayers,
      openings: l.input.openings,
      layer1: l.input.layer1,
      layer2: l.input.layer2,
      sides: 1,
    })
  }

  return surfaces
}

// ─── Потолки (Ceiling-контуры) — параллельный билдер, см. заголовок файла ───

export function boardSpecFromCeilingSpec(spec: CeilingSpecFull | { material: 'gsp' | 'gvl'; thickness: number }): BoardSpec {
  return {
    material: spec.material === 'gvl' ? 'gvl' : 'gkl',
    subtype: null,
    thickness: spec.thickness,
    sheetWidth: 1200,
    sheetLength: (spec as CeilingSpecFull).sheetLengthMm ?? 2500,
  }
}

/**
 * Преобразует свободные Ceiling-контуры одного этажа в PolygonSurfaceInput.
 * Пропускает потолки без сохранённой раскладки (нет ceilingSpec или
 * startWallSideIndex — без стены старта нет точки отсчёта локальных
 * координат для calcPolygonP112Frame.ts/calcPolygonSheetLayout.ts, та же
 * проверка, что и в CeilingEntityMesh.tsx для 3D).
 */
export function buildCeilingSurfaceInputs(ceilings: Ceiling[], scaleMmPx: number): PolygonSurfaceInput[] {
  const out: PolygonSurfaceInput[] = []

  for (const cl of ceilings) {
    const spec = cl.ceilingSpec
    if (!spec || cl.startWallSideIndex == null || cl.outer.length < 3) continue

    const outerMm = cl.outer.map(p => ({ x: p.x * scaleMmPx, y: p.y * scaleMmPx }))
    const sides = polygonSides(outerMm)
    const side = sides[cl.startWallSideIndex]
    if (!side) continue

    const boardSpec = boardSpecFromCeilingSpec(spec)
    out.push({
      id: cl.id,
      label: cl.label,
      outerMm,
      holesMm: [],
      startSide: { start: side.start, end: side.end },
      sheetLengthMm: boardSpec.sheetLength,
      gklLayers: spec.layers,
      layer1: boardSpec,
      layer2: boardSpec,
    })
  }

  return out
}

// ─── Основной расчёт ─────────────────────────────────────────────────────────

/**
 * Прогоняет calcSheetLayout последовательно через все конструкции,
 * передавая finalOffcuts каждой → initialPool следующей. Затем (12.07.2026)
 * тем же пулом продолжает через потолки (calcPolygonSheetLayout) — порядок
 * стена → облицовка → потолок, см. заголовок файла.
 */
export function calcProjectSheetLayout(
  surfaces: SurfaceSheetInput[],
  ceilingSurfaces: PolygonSurfaceInput[] = [],
): ProjectSheetResult {
  let pool: BoardOffcut[] = []
  const results: (SurfaceSheetResult | PolygonSurfaceResult)[] = []

  for (const s of surfaces) {
    const result = calcSheetLayout(
      s.wallL,
      flatProfile(s.wallL, s.wallH),
      flatProfile(s.wallL, 0),
      s.firstStud,
      s.step,
      s.gklLayers,
      s.openings,
      s.layer1,
      s.layer2,
      s.sides,
      pool,            // ← обрезки предыдущей конструкции
    )
    results.push({ id: s.id, label: s.label, result })
    pool = result.finalOffcuts  // ← уходят в следующую
  }

  for (const c of ceilingSurfaces) {
    const result = calcPolygonSheetLayout(
      c.outerMm, c.holesMm, c.startSide, c.sheetLengthMm,
      c.gklLayers, c.layer1, c.layer2,
      pool,            // ← тот же пул, что и у стен/облицовок
    )
    if (!result) continue
    results.push({ id: c.id, label: c.label, result })
    pool = result.finalOffcuts
  }

  const totalSheetsNeeded = results.reduce((s, r) => s + r.result.totalSheetsNeeded, 0)
  const totalUsedAreaM2   = results.reduce((s, r) => s + r.result.totalUsedAreaM2,   0)
  const totalSheetAreaM2  = results.reduce((s, r) => s + r.result.totalSheetAreaM2,  0)
  const totalOffcutAreaM2 = pool.reduce((s, o) => s + o.w * o.h / 1e6, 0)
  const totalWastePercent = totalSheetAreaM2 > 0
    ? Math.round((1 - totalUsedAreaM2 / totalSheetAreaM2) * 100)
    : 0

  return {
    surfaces: results,
    totalSheetsNeeded,
    totalUsedAreaM2,
    totalSheetAreaM2,
    totalOffcutAreaM2,
    totalWastePercent,
    finalOffcuts: pool,
  }
}
