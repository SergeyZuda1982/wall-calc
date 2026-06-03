import type { StudKind, CalcResult } from '../types'
import { calcStudMaterial, STUD_LENGTH } from './calcStudMaterial'

/**
 * Итоговый расчёт всех материалов по расставленным стойкам.
 */
export function calcResults(
  positions: number[],
  h: number,          // высота стены, мм
  l: number,          // длина стены, мм
  dw: number,         // ширина проёма, мм
  dh: number,         // высота проёма, мм
  dp: number,         // позиция проёма, мм
  abutment: string,
  overlap: number     // нахлёст профиля, мм
): CalcResult {
  let cwTotal = 0
  let aboveStuds = 0
  const aboveH = h - dh

  for (const p of positions) {
    let kind: StudKind = 'middle'

    if (p === 0)
      kind = (abutment === 'both' || abutment === 'left') ? 'wall' : 'free'
    if (p === l)
      kind = (abutment === 'both' || abutment === 'right') ? 'wall' : 'free'

    if (dw > 0 && p > dp && p < dp + dw) {
      // стойка над проёмом — только верхняя часть
      cwTotal += aboveH
      aboveStuds++
    } else {
      cwTotal += calcStudMaterial(h, kind, overlap)
    }
  }

  return {
    uwFloor:          dw > 0 ? (l - dw) / 1000 : l / 1000,
    uwCeiling:        l / 1000,
    lintel:           dw > 0 ? (dw + 400) / 1000 : 0,
    cwTotal:          cwTotal / 1000,
    studsCount:       positions.length,
    aboveStuds,
    aboveStudHeight:  aboveH,
    gklArea:          (l * h * 2) / 1_000_000,
    needsOverlap:     h > STUD_LENGTH,
  }
}
