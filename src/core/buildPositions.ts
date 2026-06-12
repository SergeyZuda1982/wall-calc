import type { Opening } from '../types'

export const MIN_GAP = 150 // мм

/**
 * Строит массив позиций стоек для стены с произвольным числом проёмов.
 * Алгоритм тот же что и раньше, но конфликт проверяется со всеми проёмами.
 */
export function buildPositions(
  l: number,
  s: number,
  first: number,
  openings: Opening[]
): number[] {
  const activeOpenings = openings.filter(o => o.width > 0)

  if (activeOpenings.length === 0) {
    const pos: number[] = [0]
    let p = first
    while (p < l) { pos.push(p); p += s }
    pos.push(l)
    return [...new Set(pos)].sort((a, b) => a - b)
  }

  // Все стойки проёмов (левый и правый край каждого)
  const openingStuds: number[] = []
  for (const o of activeOpenings) {
    openingStuds.push(o.pos)
    openingStuds.push(o.pos + o.width)
  }

  function makeGrid(shiftLeft: number): number[] {
    const grid: number[] = []
    let p = s - shiftLeft
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

  let grid = makeGrid(0)

  if (hasConflict(grid)) {
    let found = false
    for (let x = 10; x < s; x += 10) {
      const candidate = makeGrid(x)
      if (!hasConflict(candidate)) {
        grid = candidate
        found = true
        break
      }
    }
    if (!found) {
      grid = grid.filter(p =>
        openingStuds.every(os => Math.abs(p - os) > MIN_GAP || Math.abs(p - os) === 0)
      )
    }
  }

  const pos = new Set<number>([0, l])
  for (const os of openingStuds) pos.add(os)
  for (const p of grid) {
    if (p > 0 && p < l) pos.add(p)
  }

  return [...pos].sort((a, b) => a - b)
}

export { MIN_GAP as default }
