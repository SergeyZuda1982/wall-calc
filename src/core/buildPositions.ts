/**
 * Строит массив позиций стоек (мм от левого края стены).
 *
 * Правила расстановки:
 *  - Всегда есть крайние стойки: 0 и l
 *  - Если есть проём — стойки по краям проёма: dp и dp+dw
 *  - С проёмом: шаг отсчитывается от краёв проёма наружу
 *  - Без проёма: шаг отсчитывается от firstStud
 */
export function buildPositions(
  l: number,        // длина стены, мм
  s: number,        // шаг, мм
  first: number,    // первая стойка от левого края, мм
  dp: number,       // позиция начала проёма, мм
  dw: number        // ширина проёма, мм
): number[] {
  const pos: number[] = [0]

  if (dw > 0) {
    // фиксированные стойки по краям проёма
    pos.push(dp, dp + dw)

    // стойки левее проёма
    let p = dp - s
    while (p > 0) { pos.push(p); p -= s }

    // стойки правее проёма
    p = dp + dw + s
    while (p < l) { pos.push(p); p += s }
  } else {
    let p = first
    while (p < l) { pos.push(p); p += s }
  }

  pos.push(l)

  return [...new Set(pos)].sort((a, b) => a - b)
}
