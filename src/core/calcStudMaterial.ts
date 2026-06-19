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
 * free:   торец в торец + соединительный кусок.
 *   Длина = h + overlap + overlapUp.
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
  const part2 = h - STUD_LENGTH
  const overlapUp = part2 >= overlap ? overlap : MIN_OVERLAP_UP
  const totalLength = STUD_LENGTH + part2 + overlap + overlapUp

  let zoneFrom: number, zoneTo: number
  if (orientation === 'up') {
    zoneFrom = Math.max(0, STUD_LENGTH - overlap)
    zoneTo   = Math.min(STUD_LENGTH + overlapUp, h)
  } else {
    const jointH = h - STUD_LENGTH
    zoneFrom = Math.max(0, jointH - overlap)
    zoneTo   = Math.min(jointH + overlapUp, h)
  }

  return { length: totalLength, overlapZones: [{ from: zoneFrom, to: zoneTo }] }
}
