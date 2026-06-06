import type { LiningInput, LiningResult } from '../types'

const STUD_LENGTH = 3000

/**
 * Расчёт материалов облицовки.
 *
 * С623: ПП 60×27 на прямых подвесах, направляющая ПН 28×27
 * С625/626: ПС 50/75/100 без подвесов, направляющая ПН 50/75/100×40
 */
export function calcLining(input: LiningInput): LiningResult {
  const { length: l, height: h, step: s, hangerStep,
          abutment, gklLayers,
          doorPos: dp, doorWidth: dw, doorHeight: dh } = input

  // ─── Периметр направляющих ───────────────────────────────────────────────
  // Всегда: пол + потолок = 2 × l
  // Боковые: зависит от примыкания
  let sideRail = 0
  if (abutment === 'both')  sideRail = 2 * h
  if (abutment === 'left')  sideRail = h
  if (abutment === 'right') sideRail = h
  if (abutment === 'none')  sideRail = 0

  // Если есть проём — вычитаем проём из пола, добавляем перемычку над проёмом
  const floorRail = dw > 0 ? l - dw : l
  const ceilingRail = l
  const lintel = dw > 0 ? dw + 400 : 0  // перемычка над проёмом с запасом

  const guideRail = (floorRail + ceilingRail + sideRail + lintel) / 1000

  // ─── Стойки ──────────────────────────────────────────────────────────────
  // Позиции: 0, step, 2*step... l (как в перегородке но без алгоритма сдвига)
  const positions: number[] = [0]
  let p = s
  while (p < l) { positions.push(p); p += s }
  positions.push(l)

  // Стойки над проёмом (между dp и dp+dw)
  let studTotal = 0
  let aboveStuds = 0

  for (const pos of positions) {
    const isAbove = dw > 0 && pos > dp && pos < dp + dw
    if (isAbove) {
      studTotal += h - dh  // только выше проёма
      aboveStuds++
    } else {
      studTotal += h  // полная высота
    }
  }

  const studsCount = positions.length

  // ─── Подвесы (только С623) ───────────────────────────────────────────────
  // На каждую стойку: ceil(h / hangerStep) подвесов
  let hangers = 0
  if (input.liningType === 'c623') {
    for (const pos of positions) {
      const isAbove = dw > 0 && pos > dp && pos < dp + dw
      const studH = isAbove ? h - dh : h
      hangers += Math.ceil(studH / hangerStep)
    }
  }

  // ─── Удлинители (только С623) ────────────────────────────────────────────
  // floor(h / 3000) удлинителей на стойку
  let extenders = 0
  if (input.liningType === 'c623') {
    for (const pos of positions) {
      const isAbove = dw > 0 && pos > dp && pos < dp + dw
      const studH = isAbove ? h - dh : h
      extenders += Math.floor(studH / STUD_LENGTH)
    }
  }

  // ─── ГКЛ (одна сторона × слои) ───────────────────────────────────────────
  const wallArea = l * h
  const openingArea = dw > 0 ? dw * dh : 0
  const gklArea = ((wallArea - openingArea) * gklLayers) / 1_000_000

  return {
    guideRail,
    stud: studTotal / 1000,
    studsCount,
    hangers,
    extenders,
    gklArea,
    needsOverlap: h > STUD_LENGTH,
  }
}
