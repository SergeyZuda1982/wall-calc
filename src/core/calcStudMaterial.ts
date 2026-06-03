import type { StudKind } from '../types'

const STUD_LENGTH = 3000 // стандартная длина стоечного профиля, мм

/**
 * Возвращает суммарную длину материала (мм) для одной стойки с учётом наращивания.
 *
 * Правила:
 *  - wall   (крайняя у стены) — всегда точно по высоте, без нахлёста
 *  - middle (рядовая средняя) — h + overlap (одно наращивание)
 *  - free   (крайняя свободная) — два куска: основной + нахлёст снизу + нахлёст сверху
 */
export function calcStudMaterial(h: number, kind: StudKind, overlap: number): number {
  if (h <= STUD_LENGTH) return h

  if (kind === 'wall') return h

  if (kind === 'middle') return h + overlap

  // free: стойка наращивается с двух сторон для жёсткости
  const part2 = h - STUD_LENGTH
  const up = part2 >= overlap ? overlap : 500
  return STUD_LENGTH + part2 + overlap + up
}

export { STUD_LENGTH }
