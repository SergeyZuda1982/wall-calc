import type { StudKind, StudInfo, StudOrientation, CalcResult, Opening } from '../types'
import { calcStudMaterial, STUD_LENGTH } from './calcStudMaterial'

function buildStudInfos(
  positions: number[],
  l: number,
  openings: Opening[],
  abutment: string,
): StudInfo[] {
  const activeOpenings = openings.filter(o => o.width > 0)

  // Определяем к какому проёму относится позиция
  function getOpeningId(p: number): string | null {
    for (const o of activeOpenings) {
      if (p === o.pos || p === o.pos + o.width) return o.id
      if (p > o.pos && p < o.pos + o.width) return o.id
    }
    return null
  }

  function isAboveOpening(p: number): boolean {
    return activeOpenings.some(o => p > o.pos && p < o.pos + o.width)
  }

  function isDoorStud(p: number): boolean {
    return activeOpenings.some(o => p === o.pos || p === o.pos + o.width)
  }

  const withKind: { pos: number; kind: StudKind; isAbove: boolean; openingId: string | null }[] =
    positions.map(p => {
      const isAbove = isAboveOpening(p)
      const isDoor = isDoorStud(p)
      const openingId = getOpeningId(p)

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

      return { pos: p, kind, isAbove, openingId }
    })

  let middleCount = 0
  let lastMiddleOrientation: StudOrientation = 'down'

  return withKind.map(({ pos, kind, isAbove, openingId }) => {
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

    return { pos, kind, orientation, isAbove, openingId }
  })
}

export function calcResults(
  positions: number[],
  h: number,
  l: number,
  openings: Opening[],
  abutment: string,
  overlap: number,
  gklLayers: number = 1
): CalcResult {
  const activeOpenings = openings.filter(o => o.width > 0)
  const studInfos = buildStudInfos(positions, l, openings, abutment)

  let cwTotal = 0
  let aboveStuds = 0

  // Высота стоек над каждым проёмом
  function aboveHeight(openingId: string): number {
    const o = activeOpenings.find(x => x.id === openingId)
    if (!o) return 0
    return h - o.height - o.sillHeight
  }

  for (const { kind, isAbove, orientation, openingId } of studInfos) {
    if (isAbove && openingId) {
      cwTotal += aboveHeight(openingId)
      aboveStuds++
    } else {
      const calcKind: StudKind = (kind === 'door') ? 'middle' : kind
      cwTotal += calcStudMaterial(h, calcKind, overlap, orientation).length
    }
  }

  // ПН пол: длина стены минус ширина всех дверных проёмов (окна не вырезают пол)
  const doorOpeningsWidth = activeOpenings
    .filter(o => o.type === 'door')
    .reduce((s, o) => s + o.width, 0)

  // Перемычки: над каждым проёмом (ширина + 400мм)
  const lintelTotal = activeOpenings.reduce((s, o) => s + (o.width + 400), 0)

  // ГКЛ: площадь стены минус все проёмы
  const openingsArea = activeOpenings.reduce((s, o) => s + o.width * o.height, 0)
  const gklArea = ((l * h - openingsArea) * 2 * gklLayers) / 1_000_000

  // Для обратной совместимости — высота над первым проёмом
  const firstOpening = activeOpenings[0]
  const aboveStudHeight = firstOpening
    ? h - firstOpening.height - firstOpening.sillHeight
    : 0

  return {
    uwFloor:         (l - doorOpeningsWidth) / 1000,
    uwCeiling:       l / 1000,
    lintel:          lintelTotal / 1000,
    cwTotal:         cwTotal / 1000,
    studsCount:      positions.length,
    aboveStuds,
    aboveStudHeight,
    gklArea,
    needsOverlap:    h > STUD_LENGTH,
    studInfos,
  }
}
