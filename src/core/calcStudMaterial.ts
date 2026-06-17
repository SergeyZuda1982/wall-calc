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

  // free — дополнительный соединительный профиль
  // Два основных профиля (ПС1 и ПС2) = длина h каждый (как wall, без нахлёста).
  // Дополнительный профиль наращивается с нахлёстом в обе стороны:
  //   нахлёст снизу = overlap
  //   нахлёст сверху = overlap если (h−3000) ≥ overlap, иначе 500мм
  const overlapUp = part2 >= overlap ? overlap : MIN_OVERLAP_UP
  const totalLength = STUD_LENGTH + part2 + overlap + overlapUp

  let overlapZone: { from: number; to: number }
  if (orientation === 'up') {
    // длинный снизу: зона от (3000−overlap) до (3000+overlapUp)
    overlapZone = { from: STUD_LENGTH - overlap, to: STUD_LENGTH + overlapUp }
  } else {
    // длинный сверху: стык на (h−3000)
    const jointH = h - STUD_LENGTH
    overlapZone = { from: jointH - overlap, to: jointH + overlapUp }
  }

  return { length: totalLength, overlapZone }
}
