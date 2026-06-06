const MIN_GAP = 150 // мм

/**
 * Строит массив позиций стоек (мм от левого края стены).
 *
 * Алгоритм с проёмом:
 *  - Базовая сетка: 0, s, 2s, 3s...
 *  - Если стойка сетки попадает в зону <=MIN_GAP от стойки проёма —
 *    сдвигаем всю сетку ВЛЕВО на минимальный X (кратный 10мм)
 *    пока конфликт не уйдёт.
 *  - Результат: 0, (s-X), (2s-X), (3s-X)... первый шаг < s — подрезка.
 *  - Стойки проёма добавляются отдельно, они не влияют на шаг.
 */
export function buildPositions(
  l: number,
  s: number,
  first: number,
  dp: number,
  dw: number
): number[] {

  if (dw <= 0) {
    const pos: number[] = [0]
    let p = first
    while (p < l) { pos.push(p); p += s }
    pos.push(l)
    return [...new Set(pos)].sort((a, b) => a - b)
  }

  const doorLeft = dp
  const doorRight = dp + dw

  // Сетка со сдвигом влево на X: 0, s-X, 2s-X, 3s-X...
  // При X=0: стандартная сетка s, 2s, 3s (без нуля — он всегда отдельно)
  function makeGrid(shiftLeft: number): number[] {
    const grid: number[] = []
    // первая стойка = s - shiftLeft, далее через s
    let p = s - shiftLeft
    while (p < l) {
      if (p > 0) grid.push(Math.round(p))
      p += s
    }
    return grid
  }

  function hasConflict(grid: number[]): boolean {
    for (const p of grid) {
      if (Math.abs(p - doorLeft) <= MIN_GAP) return true
      if (Math.abs(p - doorRight) <= MIN_GAP) return true
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
      // убираем конфликтующие стойки если сдвиг не помог
      grid = grid.filter(p =>
        Math.abs(p - doorLeft) > MIN_GAP &&
        Math.abs(p - doorRight) > MIN_GAP
      )
    }
  }

  const pos = new Set<number>([0, l, doorLeft, doorRight])
  for (const p of grid) {
    if (p > 0 && p < l) pos.add(p)
  }

  return [...pos].sort((a, b) => a - b)
}

export { MIN_GAP }
