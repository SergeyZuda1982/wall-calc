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
 * Локальная очистка: убирает рядовые стойки, попавшие в зону MIN_GAP
 * вокруг любой "фиксированной" точки (стен 0/l или стоек проёмов).
 * Не зависит от количества проёмов, всегда завершается за O(грид × fixed).
 */
function localCleanup(grid: number[], fixed: number[]): number[] {
  return grid.filter(p => fixed.every(f => Math.abs(p - f) > MIN_GAP))
}

/**
 * Строит сетку стоек по заданной фазе БЕЗ поиска альтернативной фазы.
 *
 * Используется при ручном сдвиге гребёнки — пользователь полностью
 * управляет позицией сетки, шаг сдвига может быть любым (от 1мм).
 * Конфликты MIN_GAP (с проёмами и со стенами 0/l) устраняются ЛОКАЛЬНЫМ
 * удалением конкретной конфликтующей рядовой стойки — без глобального
 * поиска фазы. Поэтому работает при любом числе проёмов и никогда не
 * "виснет"/не блокирует сдвиг.
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

  if (!openingStuds.length) {
    // Без проёмов конфликтов MIN_GAP не бывает — стены 0/l не фильтруем,
    // первая/последняя стойка может быть сколь угодно близко к стене
    // (это сознательный выбор через firstStud).
    const pos = new Set<number>([0, l])
    for (const p of grid) if (p > 0 && p < l) pos.add(p)
    return { positions: [...pos].sort((a, b) => a - b), phase: ph }
  }

  // Стены 0/l тоже считаются "фиксированными точками" — рядовая стойка
  // ближе MIN_GAP к стене бессмысленна (там уже есть крайняя стойка).
  const fixed = [0, l, ...openingStuds]
  const filteredGrid = localCleanup(grid, fixed)

  const pos = new Set<number>([0, l])
  for (const os of openingStuds) {
    if (os > 0 && os < l) pos.add(os)
  }
  for (const p of filteredGrid) {
    if (p > 0 && p < l) pos.add(p)
  }

  return { positions: [...pos].sort((a, b) => a - b), phase: ph }
}

/**
 * Начальный расчёт сетки (calculate()).
 *
 * Ищем фазу, при которой базовая сетка не конфликтует ни с проёмами,
 * ни со стенами 0/l — это даёт равномерную раскладку (как в примере
 * с одной дверью: фаза 400 вместо 0).
 *
 * Best-effort: если идеальной фазы не существует (много проёмов —
 * теоретически может не найтись фазы без конфликтов вообще), берём
 * фазу с МИНИМАЛЬНЫМ числом конфликтов среди всех проверенных, а затем
 * прогоняем её через ту же локальную очистку, что и при ручном сдвиге.
 * Поэтому результат всегда определён, независимо от количества проёмов.
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

  const fixed = [0, l, ...openingStuds]

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