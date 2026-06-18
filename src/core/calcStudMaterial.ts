import type { StudKind, StudOrientation } from '../types'

export const STUD_LENGTH = 3000
export const MIN_OVERLAP_UP = 500  // минимальный нахлёст сверху для free

/**
 * Возвращает длину материала и зону нахлёста для одной стойки.
 *
 * wall:   торец в торец, без нахлёста.
 *         h ≤ 3000: один кусок h.
 *         h > 3000: два куска (3000 + (h−3000)), зона нахлёста null.
 *
 * middle: наращивается с нахлёстом overlap в одну сторону.
 *         Длина = h + overlap.
 *         down: длинный СВЕРХУ, стык на h−3000, зона нахлёста ниже стыка.
 *         up:   длинный СНИЗУ, стык на 3000,    зона нахлёста выше стыка.
 *
 * free:   торец в торец + соединительный кусок с нахлёстом в ОБЕ стороны.
 *         Соединительный = (h−3000) + overlap + overlapUp.
 *         overlapUp = overlap если (h−3000) ≥ overlap, иначе 500мм.
 *         Итого длина материала = h + overlap + overlapUp.
 */
export function calcStudMaterial(
  h: number,
  kind: StudKind,
  overlap: number,
  orientation: StudOrientation = 'up'
): { length: number; overlapZone: { from: number; to: number } | null } {

  // ─── wall ────────────────────────────────────────────────────────────────
  // Торец в торец, без нахлёста. Длина = h.
  if (kind === 'wall') {
    return { length: h, overlapZone: null }
  }

  // h ≤ 3000: любая стойка — один кусок
  if (h <= STUD_LENGTH) {
    return { length: h, overlapZone: null }
  }

  const part2 = h - STUD_LENGTH  // короткий кусок (остаток выше/ниже 3000)

  // ─── middle / door / window ───────────────────────────────────────────────
  // Нахлёст в одну сторону: длина = h + overlap
  if (kind === 'middle' || kind === 'door' || kind === 'window') {
    const totalLength = h + overlap

    let overlapZone: { from: number; to: number }
    if (orientation === 'up') {
      // длинный снизу, стык на 3000, зона нахлёста выше стыка
      overlapZone = { from: STUD_LENGTH, to: STUD_LENGTH + overlap }
    } else {
      // длинный сверху, стык на h−3000, зона нахлёста ниже стыка
      const jointH = h - STUD_LENGTH
      overlapZone = { from: jointH - overlap, to: jointH }
    }

    return { length: totalLength, overlapZone }
  }

  // ─── free ─────────────────────────────────────────────────────────────────
  // Два куска торец в торец (3000 + part2) + соединительный кусок.
  // Соединительный входит внутрь обоих: нахлёст overlap снизу + overlapUp сверху.
  // overlapUp = overlap если part2 ≥ overlap, иначе 500мм.
  const overlapUp = part2 >= overlap ? overlap : MIN_OVERLAP_UP
  // Длина материала = два основных куска (3000 + part2) + соединительный (part2 + overlap + overlapUp)
  // Итого: 3000 + part2 + part2 + overlap + overlapUp = STUD_LENGTH + 2*part2 + overlap + overlapUp
  // Пример h=3600, overlap=750: 3000+600+600+750+500 = 5450... нет!
  // Правильно: 3000 + 600 (торец) + (600+750+500) (соед.) = 4850
  // То есть: STUD_LENGTH + part2 + overlap + overlapUp
  const totalLength = STUD_LENGTH + part2 + overlap + overlapUp

  let overlapZone: { from: number; to: number }
  if (orientation === 'up') {
    // стык на 3000, зона соединительного: (3000−overlap) до (3000+overlapUp)
    overlapZone = { from: STUD_LENGTH - overlap, to: STUD_LENGTH + overlapUp }
  } else {
    // стык на h−3000
    const jointH = h - STUD_LENGTH
    overlapZone = { from: jointH - overlap, to: jointH + overlapUp }
  }

  return { length: totalLength, overlapZone }
}
