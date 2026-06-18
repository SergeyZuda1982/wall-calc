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
 *         Основной столб высотой h = два куска торец в торец (3000 + part2).
 *         Соединительный кусок перекрывает стык: overlap вниз + overlapUp вверх.
 *         Соединительный = overlap + overlapUp (part2 в нём НЕ участвует —
 *         part2 уже учтён как отдельный кусок основного столба).
 *         overlapUp = overlap если (h−3000) ≥ overlap, иначе 500мм.
 *         Итого длина материала = h + overlap + overlapUp (3000+part2+overlap+overlapUp).
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
  // Два куска торец в торец (3000 + part2) — основной столб высотой h.
  // + соединительный кусок, перекрывающий стык: overlap вниз + overlapUp вверх.
  // overlapUp = overlap если part2 ≥ overlap, иначе 500мм.
  const overlapUp = part2 >= overlap ? overlap : MIN_OVERLAP_UP
  // Соединительный = overlap + overlapUp (НЕ part2 + overlap + overlapUp).
  // Итого длина материала = 3000 + part2 + overlap + overlapUp
  // Пример h=3600, overlap=750: part2=600 < overlap → overlapUp=500
  //   столб: 3000 + 600 = 3600 (= h, торец в торец)
  //   соединительный: overlap+overlapUp = 750+500 = 1250
  //   итого материала: 3600 + 1250 = 4850
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
