/**
 * Раскрой листов ГКЛ/ГВЛ для ПРОИЗВОЛЬНОГО (в т.ч. вогнутого) контура потолка
 * — вторая часть пункта 6 плана (KONSPEKT.md 10.07.2026), см. также
 * calcPolygonP112Frame.ts (каркас) для системы координат/идеи алгоритма.
 *
 * ─── Идея алгоритма ────────────────────────────────────────────────────────
 * Листы кладутся "полосами" шириной SHEET_W (1200мм) поперёк одной из осей,
 * внутри полосы — целыми листами длиной sheetLengthMm вдоль другой оси,
 * начиная от края. Для прямоугольника это просто рулетка (см.
 * calcCeiling.ts, calcLayoutVariant). Для произвольного контура: каждая
 * полоса обрезается контуром — как правило, распадается на несколько
 * отдельных отрезков (вогнутая форма), внутри КАЖДОГО отрезка отдельно
 * считаем целые/резаные листы (сдвиг на новый кусок = новый лист, стыковка
 * между отдельными отрезками одной полосы не предполагается — это разные
 * физические куски стены/выступа).
 *
 * ─── Осознанное упрощение (v1, 10.07.2026) ─────────────────────────────────
 * Ширина покрытия полосы определяется ПО ЦЕНТРАЛЬНОЙ ЛИНИИ полосы (одна
 * скан-линия на полосу), а не точным пересечением прямоугольной полосы
 * целиком с контуром. На прямых участках это точно; у вогнутого угла,
 * который "срезает" полосу НЕ по всей её ширине 1200мм, а частично —
 * возможна small-погрешность в 1 лист туда-сюда у самого угла. Для сметы
 * (не для миллиметрового чертежа реза) это приемлемо; отмечено явно, чтобы
 * не выдавать за более точный результат, чем он есть.
 */

import type { Point2D } from './geometry2d'
import { insideSegments } from './geometry2d'
import { buildLocalFrame, polygonsToLocal } from './calcPolygonP112Frame'

const SHEET_W = 1200

export interface PolygonSheetLayoutResult {
  sheetW: number
  sheetL: number
  totalSheets: number
  fullSheets: number
  cutSheets: number
  /** Обрезки [длина, ширина], мм — для справки/визуализации. */
  offcuts: [number, number][]
  /** Листы повёрнуты (длинная сторона идёт вдоль стены, а не вглубь). */
  rotated: boolean
}

function calcOneOrientation(loopsLocal: Point2D[][], bandAxisMax: number, sheetL: number): {
  totalSheets: number; fullSheets: number; cutSheets: number
  offcuts: [number, number][]; wasteArea: number
} {
  let fullSheets = 0
  let cutSheets = 0
  const offcuts: [number, number][] = []
  let bandStart = 0
  while (bandStart < bandAxisMax) {
    const bandCenter = Math.min(bandStart + SHEET_W / 2, bandAxisMax - 1e-6)
    const segs = insideSegments(loopsLocal, bandCenter, 'y')
    for (const [a, b] of segs) {
      const lengthMm = b - a
      if (lengthMm <= 0) continue
      const full = Math.floor(lengthMm / sheetL)
      const remainder = lengthMm - full * sheetL
      fullSheets += full
      if (remainder > 1) { // порог 1мм — игнорируем численный шум
        cutSheets += 1
        offcuts.push([remainder, SHEET_W])
      }
    }
    bandStart += SHEET_W
  }
  const totalSheets = fullSheets + cutSheets
  const wasteArea = offcuts.reduce((s, [l, w]) => s + l * w, 0)
  return { totalSheets, fullSheets, cutSheets, offcuts, wasteArea }
}

/**
 * Раскрой листов для контура произвольной формы, с автовыбором ориентации
 * (полосы вдоль U вглубь / вдоль V вдоль стены — берём вариант с меньшим
 * числом листов, при равенстве — с меньшими отходами), см. calcCeiling.ts
 * (calcCeilingSheetLayout) для аналогичной логики на прямоугольнике.
 */
export function calcPolygonSheetLayout(
  outerMm: Point2D[],
  holesMm: Point2D[][],
  startSide: { start: Point2D; end: Point2D },
  sheetLengthMm = 2500,
): PolygonSheetLayoutResult | null {
  if (outerMm.length < 3) return null

  const frame = buildLocalFrame(startSide, outerMm)
  const loopsLocal = polygonsToLocal([outerMm, ...holesMm], frame)
  const outerLocal = loopsLocal[0]
  const uMax = Math.max(0, ...outerLocal.map(p => p.x))
  const vMax = Math.max(0, ...outerLocal.map(p => p.y))

  // Вариант А: полосы шириной 1200мм вдоль V (вглубь от стены), листы длиной
  // sheetLengthMm кладутся вдоль U (вдоль стены).
  const varA = calcOneOrientation(loopsLocal, vMax, sheetLengthMm)

  // Вариант Б: полосы вдоль U (вдоль стены), листы кладутся вдоль V (вглубь).
  // Транспонируем координаты (x<->y), чтобы переиспользовать ту же функцию.
  const loopsLocalT = loopsLocal.map(loop => loop.map(p => ({ x: p.y, y: p.x })))
  const varB = calcOneOrientation(loopsLocalT, uMax, sheetLengthMm)

  const useRotated = varB.totalSheets < varA.totalSheets ||
    (varB.totalSheets === varA.totalSheets && varB.wasteArea < varA.wasteArea)
  const best = useRotated ? varB : varA

  return {
    sheetW: SHEET_W,
    sheetL: sheetLengthMm,
    totalSheets: best.totalSheets,
    fullSheets: best.fullSheets,
    cutSheets: best.cutSheets,
    offcuts: best.offcuts,
    rotated: useRotated,
  }
}
