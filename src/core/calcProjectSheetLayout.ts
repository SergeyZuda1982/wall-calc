/**
 * Проектный раскрой листов (ГКЛ/ГВЛ/Сапфир/Аквамарин).
 *
 * Пул обрезков течёт последовательно через все конструкции объекта:
 *   перегородка 1 → перегородка 2 → … → облицовка 1 → облицовка 2 → …
 *   (в будущем: → потолок 1 → …)
 *
 * Расширяемость: функция работает с абстрактным SurfaceSheetInput —
 * не знает, перегородка это, облицовка или потолок. Достаточно передать
 * правильные sides=1|2 и параметры геометрии.
 */

import type { Opening, BoardSpec, BoardOffcut, BoardSheetResult } from '../types'
import type { WallEntry, LiningEntry } from '../store/useProjectStore'
import { calcSheetLayout } from './calcSheetLayout'

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

export interface ProjectSheetResult {
  surfaces: SurfaceSheetResult[]
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

// ─── Основной расчёт ─────────────────────────────────────────────────────────

/**
 * Прогоняет calcSheetLayout последовательно через все конструкции,
 * передавая finalOffcuts каждой → initialPool следующей.
 */
export function calcProjectSheetLayout(surfaces: SurfaceSheetInput[]): ProjectSheetResult {
  let pool: BoardOffcut[] = []
  const results: SurfaceSheetResult[] = []

  for (const s of surfaces) {
    const result = calcSheetLayout(
      s.wallL,
      s.wallH,
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
