import type { StudKind, StudOrientation } from '../types'

export const STUD_LENGTH = 3000
export const MIN_OVERLAP_UP = 100

/**
 * Возвращает длину материала и зону нахлёста для одной стойки.
 *
 * Ориентация влияет только на положение зоны нахлёста (для визуализации):
 *
 * down: длинный кусок СВЕРХУ (от потолка), короткий снизу.
 *       Стык на высоте h−3000 от пола.
 *       Зона нахлёста: от (h−3000−overlap) до (h−3000) — ниже стыка.
 *
 * up:   длинный кусок СНИЗУ (от пола), короткий сверху.
 *       Стык на высоте 3000 от пола.
 *       Зона нахлёста: от 3000 до (3000+overlap) — выше стыка.
 *
 * Длина материала одинакова для обеих ориентаций.
 */
export function calcStudMaterial(
  h: number,
  kind: StudKind,
  overlap: number,
  orientation: StudOrientation = 'up'
): { length: number; overlapZone: { from: number; to: number } | null } {

  if (h <= STUD_LENGTH) {
    return { length: h, overlapZone: null }
  }

  if (kind === 'wall') {
    return { length: h, overlapZone: null }
  }

  const part2 = h - STUD_LENGTH

  if (kind === 'middle' || kind === 'door') {
    const totalLength = h + overlap

    let overlapZone: { from: number; to: number }
    if (orientation === 'up') {
      // длинный снизу, стык на 3000, зона выше стыка
      overlapZone = { from: STUD_LENGTH, to: STUD_LENGTH + overlap }
    } else {
      // длинный сверху, стык на h−3000, зона ниже стыка
      const jointH = h - STUD_LENGTH
      overlapZone = { from: jointH - overlap, to: jointH }
    }

    return { length: totalLength, overlapZone }
  }

  // free
  const up = Math.min(overlap, part2 - MIN_OVERLAP_UP)
  const actualUp = Math.max(0, up)
  const totalLength = STUD_LENGTH + part2 + overlap + actualUp

  let overlapZone: { from: number; to: number }
  if (orientation === 'up') {
    overlapZone = { from: STUD_LENGTH, to: STUD_LENGTH + overlap + actualUp }
  } else {
    const jointH = h - STUD_LENGTH
    overlapZone = { from: jointH - overlap, to: jointH + actualUp }
  }

  return { length: totalLength, overlapZone }
}
