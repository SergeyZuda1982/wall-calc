import type { Opening } from '../types'

export const MIN_GAP = 150 // мм

export interface BuildResult {
  positions: number[]
  phase: number // мм, 0..s-1 — фаза периодической сетки стоек
}

const norm = (x: number, s: number) => ((x % s) + s) % s

/**
 * Строит сетку стоек по заданной фазе (положению первой стойки от 0 до s-1
 * по модулю шага), проверяя минимальное расстояние MIN_GAP от стоек проёмов.
 *
 * Сетка периодическая: позиции = phase, phase+s, phase+2s, ... < l
 * Если есть конфликт с проёмом (<=MIN_GAP), фаза подбирается ближайшим
 * сдвигом (±10мм шагами) до устранения конфликта.
 */
export function buildFromPhase(
  l: number,
  s: number,
  phase: number,
  openings: Opening[]
): BuildResult {
  const activeOpenings = openings.filter(o => o.width > 0)
  const openingStuds: number[] = []
  for (const o of activeOpenings) {
    openingStuds.push(o.pos, o.pos + o.width)
  }

  function makeGrid(ph: number): number[] {
    const grid: number[] = []
    let p = ph
    while (p < l) {
      if (p > 0) grid.push(Math.round(p))
      p += s
    }
    return grid
  }

  function hasConflict(grid: number[]): boolean {
    for (const p of grid) {
      for (const os of openingStuds) {
        if (Math.abs(p - os) <= MIN_GAP && Math.abs(p - os) > 0) return true
      }
    }
    return false
  }

  let ph = norm(phase, s)
  let grid = makeGrid(ph)

  if (openingStuds.length && hasConflict(grid)) {
    let found = false
    for (let d = 10; d < s; d += 10) {
      for (const cand of [norm(ph + d, s), norm(ph - d, s)]) {
        const g = makeGrid(cand)
        if (!hasConflict(g)) { ph = cand; grid = g; found = true; break }
      }
      if (found) break
    }
    if (!found) {
      grid = grid.filter(p =>
        openingStuds.every(os => Math.abs(p - os) > MIN_GAP || p === os)
      )
    }
  }

  const pos = new Set<number>([0, l])
  for (const os of openingStuds) {
    if (os > 0 && os < l) pos.add(os)
  }
  for (const p of grid) {
    if (p > 0 && p < l) pos.add(p)
  }

  return { positions: [...pos].sort((a, b) => a - b), phase: ph }
}

/**
 * Начальный расчёт сетки. Фаза вычисляется из firstStud (положение
 * первой стойки от края), по модулю шага.
 */
export function buildPositions(
  l: number,
  s: number,
  first: number,
  openings: Opening[]
): BuildResult {
  const activeOpenings = openings.filter(o => o.width > 0)

  if (activeOpenings.length === 0) {
    const pos: number[] = [0]
    let p = first
    while (p < l) { pos.push(p); p += s }
    pos.push(l)
    const sorted = [...new Set(pos)].sort((a, b) => a - b)
    return { positions: sorted, phase: norm(first, s) }
  }

  const phase0 = norm(first, s)
  return buildFromPhase(l, s, phase0, activeOpenings)
}
