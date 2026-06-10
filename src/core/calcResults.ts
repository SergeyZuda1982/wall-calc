import type { StudKind, StudInfo, StudOrientation, CalcResult } from '../types'
import { calcStudMaterial, STUD_LENGTH } from './calcStudMaterial'

function buildStudInfos(
  positions: number[],
  l: number,
  dw: number,
  dp: number,
  abutment: string,
): StudInfo[] {
  const withKind: { pos: number; kind: StudKind; isAbove: boolean }[] = positions.map(p => {
    const isAbove = dw > 0 && p > dp && p < dp + dw
    const isDoor  = dw > 0 && (p === dp || p === dp + dw)

    let kind: StudKind
    if (isDoor) {
      kind = 'door'
    } else if (p === 0) {
      kind = (abutment === 'both' || abutment === 'left') ? 'wall' : 'free'
    } else if (p === l) {
      kind = (abutment === 'both' || abutment === 'right') ? 'wall' : 'free'
    } else {
      kind = 'middle'
    }

    return { pos: p, kind, isAbove }
  })

  let middleCount = 0
  let lastMiddleOrientation: StudOrientation = 'down'

  return withKind.map(({ pos, kind, isAbove }) => {
    let orientation: StudOrientation

    if (kind === 'wall') {
      orientation = 'down'
    } else if (kind === 'door') {
      orientation = 'up'
      lastMiddleOrientation = 'up'
      middleCount++
    } else if (kind === 'middle') {
      orientation = middleCount % 2 === 0 ? 'down' : 'up'
      lastMiddleOrientation = orientation
      middleCount++
    } else {
      // free
      orientation = lastMiddleOrientation === 'down' ? 'up' : 'down'
    }

    return { pos, kind, orientation, isAbove }
  })
}

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

  const studInfos = buildStudInfos(positions, l, dw, dp, abutment)

  for (const { kind, isAbove } of studInfos) {
    if (isAbove) {
      cwTotal += aboveH
      aboveStuds++
    } else {
      const calcKind: StudKind = (kind === 'door') ? 'middle' : kind
      cwTotal += calcStudMaterial(h, calcKind, overlap).length
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
    studInfos,
  }
}
