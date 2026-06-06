import type { StudKind } from '../types'

export const STUD_LENGTH = 3000 // стандартная длина стоечного профиля, мм
export const MIN_OVERLAP_UP = 100 // минимальный отступ от потолка при наращивании, мм

/**
 * Возвращает суммарную длину материала (мм) для одной стойки.
 * Также возвращает зону нахлёста для визуализации.
 *
 * wall:   цельная стойка точно по высоте, нет нахлёста
 * middle: нижний 3000 + верхний кусок, муфта идёт ВНИЗ на overlap
 * free:   нижний 3000 + верхний кусок, муфта = overlap вниз + up вверх
 */
export function calcStudMaterial(
  h: number,
  kind: StudKind,
  overlap: number
): { length: number; overlapZone: { from: number; to: number } | null } {

  if (h <= STUD_LENGTH) {
    return { length: h, overlapZone: null }
  }

  if (kind === 'wall') {
    return { length: h, overlapZone: null }
  }

  const part2 = h - STUD_LENGTH // длина верхнего куска

  if (kind === 'middle') {
    // Муфта идёт только вниз на overlap от стыка
    const down = overlap
    const totalLength = h + overlap
    return {
      length: totalLength,
      overlapZone: {
        from: STUD_LENGTH - down,  // 3000 - overlap
        to: STUD_LENGTH,           // 3000
      }
    }
  }

  // free: муфта вниз overlap + вверх сколько влезет минус 100мм до потолка
  const up = Math.min(overlap, part2 - MIN_OVERLAP_UP)
  const actualUp = Math.max(0, up) // не меньше 0
  const totalLength = STUD_LENGTH + part2 + overlap + actualUp

  return {
    length: totalLength,
    overlapZone: {
      from: STUD_LENGTH - overlap,       // вниз от стыка
      to: STUD_LENGTH + actualUp,        // вверх от стыка
    }
  }
}
