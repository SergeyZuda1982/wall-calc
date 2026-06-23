/**
 * Расчёт саморезов для перегородки и облицовки.
 *
 * Правила:
 * — TN/MN/XTN крутим только к стоечным профилям (ПС) и перемычкам над
 *   дверьми и над/под окнами. К потолочному и половому ПН — не крутим.
 * — Шаг по высоте стойки: 250 мм → ceil(высота / 250) шт на стойку на слой.
 * — Перегородка: саморезы с двух сторон (×2), облицовка — с одной (×1).
 * — Второй слой (при двухслойке): 35 мм вместо 25 мм.
 * — LN 11 (клопы): 6 шт на каждый перехлёст стойки.
 * — Саморезы по дереву (фанера): шаг 250 мм по высоте на каждую стойку
 *   в зоне пересечения с закладной.
 * — Не-Кнауф TN/MN/XTN: +20% (отображается в UI, не в этом модуле).
 */

import type { StudInfo, Opening, PlywoodInsert, ScrewResult, BoardSpec } from '../types'
import { screwCode } from '../types'
import { middleStudPieceCount } from './calcStudMaterial'

const SCREW_STEP = 250 // мм

/** Кол-во саморезов по высоте h с шагом 250 мм */
function screwsByHeight(h: number): number {
  if (h <= 0) return 0
  return Math.ceil(h / SCREW_STEP)
}

/** Считает кол-во перехлёстов для одной стойки (→ LN 11 = перехлёсты × 6) */
function spliceCount(
  si: StudInfo,
  overlap: number,
): number {
  const { kind, height, isAbove, openingId } = si

  if (isAbove && openingId) return 0
  const h = height

  if (kind === 'wall') return 0
  if (h <= 3000) return 0

  if (kind === 'middle' || kind === 'door' || kind === 'window') {
    return middleStudPieceCount(h, overlap) - 1
  }

  // free
  const { mainPieces } = (function () {
    const numFull = Math.floor((h - 1) / 3000)
    const main: number[] = []
    let rem = h
    for (let i = 0; i < numFull; i++) { main.push(3000); rem -= 3000 }
    if (rem > 0) main.push(rem)
    return { mainPieces: main }
  })()

  return Math.max(0, mainPieces.length - 1)
}

/**
 * Полный расчёт саморезов для одной стены/облицовки.
 *
 * @param studInfos      — стойки из calcResults / calcLining
 * @param openings       — все проёмы (с фильтрацией нулевых внутри)
 * @param layer1         — спецификация 1-го слоя обшивки
 * @param layer2         — спецификация 2-го слоя (тот же что layer1 если слой 1)
 * @param gklLayers      — 1 или 2
 * @param sides          — 2 для перегородки, 1 для облицовки
 * @param overlap        — нахлёст стоек (мм), нужен для подсчёта LN
 * @param plywoodInserts — закладные из фанеры
 * @param studPositions  — позиции стоек в мм (для расчёта саморезов по дереву)
 */
export function calcScrews(
  studInfos: StudInfo[],
  openings: Opening[],
  layer1: BoardSpec,
  layer2: BoardSpec,
  gklLayers: 1 | 2,
  sides: 1 | 2,
  overlap: number,
  plywoodInserts: PlywoodInsert[],
  studPositions: number[],
): ScrewResult {
  const activeOpenings = openings.filter(o => o.width > 0)

  // ─── LN 11 — клопы на перехлёсты ─────────────────────────────────────────
  let totalSplices = 0
  for (const si of studInfos) {
    totalSplices += spliceCount(si, overlap)
  }
  const ln11 = totalSplices * 6

  // ─── TN/MN/XTN — к стойкам ───────────────────────────────────────────────
  let count25 = 0
  let count35 = 0

  for (const si of studInfos) {
    const { isAbove, openingId, height } = si

    if (isAbove && openingId) {
      // Стойки внутри проёма: два куска — над проёмом и под подоконником
      const o = activeOpenings.find(x => x.id === openingId)
      if (!o) continue
      const aboveH = height - o.height - o.sillHeight
      const belowH = o.sillHeight
      const h = aboveH + belowH
      if (h <= 0) continue
      count25 += screwsByHeight(h) * sides
      if (gklLayers === 2) count35 += screwsByHeight(h) * sides
    } else {
      count25 += screwsByHeight(height) * sides
      if (gklLayers === 2) count35 += screwsByHeight(height) * sides
    }
  }

  // ─── TN/MN/XTN — к перемычкам ────────────────────────────────────────────
  for (const o of activeOpenings) {
    const n = Math.ceil(o.width / SCREW_STEP)
    if (o.type === 'door') {
      count25 += n * sides
      if (gklLayers === 2) count35 += n * sides
    } else {
      count25 += n * 2 * sides
      if (gklLayers === 2) count35 += n * 2 * sides
    }
  }

  // ─── Саморезы по дереву — фанерные закладные ─────────────────────────────
  let woodScrews = 0
  for (const ins of plywoodInserts) {
    const insLeft  = ins.x
    const insRight = ins.x + ins.width

    for (const sPos of studPositions) {
      if (sPos < insLeft || sPos > insRight) continue
      woodScrews += screwsByHeight(ins.height) * sides
    }
  }

  return {
    ln11,
    code25: screwCode(layer1),
    count25,
    code35: gklLayers === 2 ? screwCode(layer2) : null,
    count35: gklLayers === 2 ? count35 : 0,
    woodScrews,
  }
}
