import type { Opening } from '../types'

export const MIN_GAP = 150 // мм

export interface BuildResult {
  positions: number[]
  phase: number // мм, 0..s-1 — фаза периодической сетки стоек
}

const norm = (x: number, s: number) => ((x % s) + s) % s

function makeGrid(l: number, s: number, ph: number): number[] {
  const grid: number[] = []
  let p = ph
  while (p < l) {
    if (p > 0) grid.push(Math.round(p))
    p += s
  }
  return grid
}

function openingStudsOf(openings: Opening[]): number[] {
  const result: number[] = []
  for (const o of openings) {
    if (o.width > 0) result.push(o.pos, o.pos + o.width)
  }
  return result
}

function countConflicts(grid: number[], fixed: number[]): number {
  let n = 0
  for (const p of grid) {
    for (const f of fixed) {
      if (Math.abs(p - f) <= MIN_GAP) { n++; break }
    }
  }
  return n
}

/**
 * Строит сетку стоек по заданной фазе.
 *
 * ВАЖНО: НИКОГДА не удаляет и не фильтрует стойки — даже если рядовая
 * стойка попадает ближе MIN_GAP к стойке проёма или к стене. Калькулятор
 * показывает фактическую раскладку и предупреждает (см. UI), но решение
 * о допустимости такого шага — за монтажником/ответственным лицом, а не
 * за программой.
 *
 * Используется для ручного сдвига гребёнки — фаза применяется буквально,
 * любой шаг от 1мм, результат детерминированный.
 */
export function buildFromPhase(
  l: number,
  s: number,
  phase: number,
  openings: Opening[]
): BuildResult {
  const openingStuds = openingStudsOf(openings)
  const ph = norm(phase, s)
  const grid = makeGrid(l, s, ph)

  const pos = new Set<number>([0, l])
  for (const os of openingStuds) if (os > 0 && os < l) pos.add(os)
  for (const p of grid) if (p > 0 && p < l) pos.add(p)

  return { positions: [...pos].sort((a, b) => a - b), phase: ph }
}

/**
 * Начальный расчёт сетки (calculate()).
 *
 * Ищем фазу, при которой базовая сетка не конфликтует со стойками проёмов
 * (MIN_GAP=150мм). Стены 0/l не участвуют в проверке — правила минимального
 * расстояния от стены нет, рядовая стойка может стоять вплотную к стене.
 *
 * Best-effort: если идеальной фазы не существует (много проёмов),
 * берём фазу с минимальным числом конфликтов. Результат НЕ фильтруется —
 * даже "конфликтные" стойки остаются в раскладке (с предупреждением в UI).
 */
export function buildPositions(
  l: number,
  s: number,
  first: number,
  openings: Opening[]
): BuildResult {
  const openingStuds = openingStudsOf(openings)
  const phase0 = norm(first, s)

  if (!openingStuds.length) {
    return buildFromPhase(l, s, phase0, openings)
  }

  // MIN_GAP проверяется только относительно стоек проёмов.
  // Стены (0/l) — не стойки проёма, правила MIN_GAP от стен нет.
  const fixed = [...openingStuds]

  let bestPhase = phase0
  let bestConflicts = countConflicts(makeGrid(l, s, phase0), fixed)

  for (let d = 10; d < s && bestConflicts > 0; d += 10) {
    for (const cand of [norm(phase0 + d, s), norm(phase0 - d, s)]) {
      const conflicts = countConflicts(makeGrid(l, s, cand), fixed)
      if (conflicts < bestConflicts) {
        bestConflicts = conflicts
        bestPhase = cand
        if (bestConflicts === 0) break
      }
    }
  }

  return buildFromPhase(l, s, bestPhase, openings)
}