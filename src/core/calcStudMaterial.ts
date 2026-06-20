import type { StudKind, StudOrientation } from '../types'

export const STUD_LENGTH = 3000
export const MIN_OVERLAP_UP = 500  // минимальный нахлёст сверху для free

/**
 * Число кусков для middle-стойки высотой h с нахлёстом overlap.
 *
 * step = 3000 - overlap — «чистый» прирост высоты на каждый кусок.
 * n = 1 + ceil((h - 3000) / step)
 *
 * Примеры:
 *   h=3600, ПС75 (overlap=750):  step=2250, n=2  → 3000 + 1350
 *   h=5100, ПС100 (overlap=1000): step=2000, n=3  → 3000 + 3000 + 1100
 *   h=6000, ПС100:                step=2000, n=3  → 3000 + 3000 + 2000
 */
export function middleStudPieceCount(h: number, overlap: number): number {
  if (h <= STUD_LENGTH) return 1
  const step = STUD_LENGTH - overlap
  if (step <= 0) return 1 // не должно быть, но защита
  return 1 + Math.ceil((h - STUD_LENGTH) / step)
}

/**
 * Длина материала для middle-стойки (h + (n-1)*overlap).
 */
export function middleStudTotalLength(h: number, overlap: number): number {
  if (h <= STUD_LENGTH) return h
  const n = middleStudPieceCount(h, overlap)
  return h + (n - 1) * overlap
}

export interface FreeStudSplit {
  mainPieces: number[]       // основные куски торец в торец (3000мм + короткий остаток)
  connectorLengths: number[] // соединительный кусок на каждый стык между mainPieces
}

/**
 * Разбивает высоту free-стойки на основные куски (торец в торец, по 3000мм,
 * последний может быть короче) и соединительные куски — по одному на каждый стык.
 *
 * На каждый стык между mainPieces[j] и mainPieces[j+1]:
 *   - нахлёст слева = overlap (слева всегда полный 3000-кусок)
 *   - нахлёст справа = overlap, если mainPieces[j+1] ≥ overlap, иначе MIN_OVERLAP_UP
 *
 * Используется и для расчёта метража (calcStudMaterial), и для раскроя (cutList/psPieces),
 * чтобы смета и раскрой не расходились.
 *
 * Примеры (overlap=750):
 *   h=3600 → main: 3000+600,           connectors: [1250]            (600<750 → правый=500)
 *   h=4500 → main: 3000+1500,          connectors: [1500]
 *   h=7000 → main: 3000+3000+1000,     connectors: [1500, 1500]
 */
export function splitFreeStud(h: number, overlap: number): FreeStudSplit {
  const numFullBars = Math.floor((h - 1) / STUD_LENGTH)
  const mainPieces: number[] = []
  let remaining = h
  for (let i = 0; i < numFullBars; i++) {
    mainPieces.push(STUD_LENGTH)
    remaining -= STUD_LENGTH
  }
  if (remaining > 0) mainPieces.push(remaining)

  const connectorLengths: number[] = []
  for (let j = 0; j < mainPieces.length - 1; j++) {
    const rightPieceLen = mainPieces[j + 1]
    const rightOverlap = rightPieceLen >= overlap ? overlap : MIN_OVERLAP_UP
    const leftOverlap = overlap // слева всегда полный 3000-кусок
    connectorLengths.push(leftOverlap + rightOverlap)
  }

  return { mainPieces, connectorLengths }
}

/**
 * Возвращает длину материала и зоны нахлёста для одной стойки.
 *
 * wall:   торец в торец, без нахлёста. overlapZones = [].
 *
 * middle: n кусков с нахлёстом.
 *   Длина = h + (n-1)*overlap.
 *   n-1 зон нахлёста, каждая по overlap мм.
 *   up:   длинный снизу — зона i начинается с (i+1)*step от низа стойки.
 *   down: длинный сверху — зона i начинается с (h−3000) − i*step от низа.
 *
 * free:   несколько основных кусков по 3000мм (последний может быть короче) торец в торец,
 *   плюс отдельный соединительный кусок НА КАЖДЫЙ стык между ними (см. splitFreeStud).
 */
export function calcStudMaterial(
  h: number,
  kind: StudKind,
  overlap: number,
  orientation: StudOrientation = 'up'
): { length: number; overlapZones: { from: number; to: number }[] } {

  // ─── wall ────────────────────────────────────────────────────────────────
  if (kind === 'wall') {
    return { length: h, overlapZones: [] }
  }

  // h ≤ 3000: один кусок, без нахлёста
  if (h <= STUD_LENGTH) {
    return { length: h, overlapZones: [] }
  }

  const step = STUD_LENGTH - overlap  // чистый прирост высоты на кусок

  // ─── middle / door / window ───────────────────────────────────────────────
  if (kind === 'middle' || kind === 'door' || kind === 'window') {
    const n = middleStudPieceCount(h, overlap)
    const totalLength = h + (n - 1) * overlap

    // Физически правильные позиции зон нахлёста:
    //   up:   зона i = [(i+1)*step,  (i+1)*step + overlap]  (от низа стойки)
    //   down: зона i = [h−3000 − i*step,  h−3000 − i*step + overlap]
    // Зажимаем в [0, h], чтобы не выходила за пределы стойки.
    const overlapZones: { from: number; to: number }[] = []
    for (let i = 0; i < n - 1; i++) {
      let from: number, to: number
      if (orientation === 'up') {
        from = (i + 1) * step
        to   = Math.min(from + overlap, h)
      } else {
        from = Math.max(0, (h - STUD_LENGTH) - i * step)
        to   = Math.min(from + overlap, h)
      }
      if (to > from) overlapZones.push({ from, to })
    }

    return { length: totalLength, overlapZones }
  }

  // ─── free ─────────────────────────────────────────────────────────────────
  const { mainPieces, connectorLengths } = splitFreeStud(h, overlap)

  const overlapZones: { from: number; to: number }[] = []
  let cursor = 0 // позиция стыка от низа (считаем при orientation 'up')
  for (let j = 0; j < mainPieces.length - 1; j++) {
    cursor += mainPieces[j]
    const leftOverlap = overlap
    const rightOverlap = connectorLengths[j] - leftOverlap
    overlapZones.push({
      from: Math.max(0, cursor - leftOverlap),
      to: Math.min(cursor + rightOverlap, h),
    })
  }

  const mainTotal = mainPieces.reduce((a, b) => a + b, 0)
  const connectorTotal = connectorLengths.reduce((a, b) => a + b, 0)
  const totalLength = mainTotal + connectorTotal

  // down: стойка смонтирована зеркально (длинный кусок сверху) — отражаем зоны относительно h
  const finalZones = orientation === 'down'
    ? overlapZones.map(z => ({ from: h - z.to, to: h - z.from })).reverse()
    : overlapZones

  return { length: totalLength, overlapZones: finalZones }
}
