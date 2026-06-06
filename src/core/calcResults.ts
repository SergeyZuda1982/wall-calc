import type { StudKind, CalcResult } from '../types'
import { calcStudMaterial, STUD_LENGTH } from './calcStudMaterial'

export function calcResults(
  positions: number[],
  h: number,
  l: number,
  dw: number,
  dh: number,
  dp: number,
  abutment: string,
  overlap: number,
  gklLayers: number = 1
): CalcResult {
  let cwTotal = 0
  let aboveStuds = 0
  const aboveH = h - dh

  for (const p of positions) {
    let kind: StudKind = 'middle'
    if (p === 0) kind = (abutment === 'both' || abutment === 'left') ? 'wall' : 'free'
    if (p === l) kind = (abutment === 'both' || abutment === 'right') ? 'wall' : 'free'

    if (dw > 0 && p > dp && p < dp + dw) {
      cwTotal += aboveH
      aboveStuds++
    } else {
      cwTotal += calcStudMaterial(h, kind, overlap).length
    }
  }

  return {
    uwFloor:         dw > 0 ? (l - dw) / 1000 : l / 1000,
    uwCeiling:       l / 1000,
    lintel:          dw > 0 ? (dw + 400) / 1000 : 0,
    cwTotal:         cwTotal / 1000,
    studsCount:      positions.length,
    aboveStuds,
    aboveStudHeight: aboveH,
    gklArea:         (l * h * 2 * gklLayers) / 1_000_000,
    needsOverlap:    h > STUD_LENGTH,
  }
}
