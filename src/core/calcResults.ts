import type { StudKind, StudInfo, StudOrientation, CalcResult, Opening, AbutmentType } from '../types'
import { calcStudMaterial, STUD_LENGTH } from './calcStudMaterial'
import { buildOpeningStuds, mergeStuds } from './buildPositions'
import { buildCutList, pnPieces, psPieces } from './cutList'

/**
 * Проставляет ориентацию (up/down) каждой стойке.
 *
 * Правила чередования:
 * - wall: всегда down
 * - door/window: всегда up (длинный кусок снизу, цельный до закладной)
 * - middle/user: чередуются down/up по порядку слева направо
 * - free: противоположная последней middle
 */
function assignOrientations(
  studs: { pos: number; kind: StudKind }[]
): StudInfo[] {
  let middleCount = 0
  let lastMiddleOrientation: StudOrientation = 'down'

  return studs.map(({ pos, kind }) => {
    let orientation: StudOrientation

    if (kind === 'wall') {
      orientation = 'down'
    } else if (kind === 'door' || kind === 'window') {
      orientation = 'up'
      lastMiddleOrientation = 'up'
      middleCount++
    } else if (kind === 'middle' || kind === 'user') {
      orientation = middleCount % 2 === 0 ? 'down' : 'up'
      lastMiddleOrientation = orientation
      middleCount++
    } else {
      // free
      orientation = lastMiddleOrientation === 'down' ? 'up' : 'down'
    }

    return { pos, kind, orientation, isAbove: false, openingId: null }
  })
}

/**
 * Проставляет isAbove и openingId для стоек, попадающих внутрь проёма.
 */
function assignOpeningContext(
  studInfos: StudInfo[],
  openings: Opening[],
): StudInfo[] {
  const activeOpenings = openings.filter(o => o.width > 0)
  return studInfos.map(si => {
    for (const o of activeOpenings) {
      if (si.pos > o.pos && si.pos < o.pos + o.width) {
        return { ...si, isAbove: true, openingId: o.id }
      }
      if (si.pos === o.pos || si.pos === o.pos + o.width) {
        return { ...si, openingId: o.id }
      }
    }
    return si
  })
}

export function calcResults(
  positions: number[],
  h: number,
  l: number,
  openings: Opening[],
  abutment: AbutmentType | string,
  overlap: number,
  gklLayers: number = 1
): CalcResult {
  const activeOpenings = openings.filter(o => o.width > 0)

  // Строим типизированные стойки через mergeStuds
  // (positions уже содержат все нужные точки, но kind нам нужен из mergeStuds)
  const openingStuds = buildOpeningStuds(openings)
  const openingPositions = new Set(openingStuds.map(s => s.pos))

  // Восстанавливаем grid из positions (убираем 0, l и стойки проёмов)
  const grid = positions.filter(p => p !== 0 && p !== l && !openingPositions.has(p))

  const merged = mergeStuds(grid, openingStuds, l, abutment as AbutmentType)

  // Проставляем ориентацию и контекст проёма
  const withOrientation = assignOrientations(merged)
  const studInfos = assignOpeningContext(withOrientation, openings)

  // ─── Расчёт материала ────────────────────────────────────────────────────

  function aboveHeight(openingId: string): number {
    const o = activeOpenings.find(x => x.id === openingId)
    if (!o) return 0
    return h - o.height - o.sillHeight
  }

  function belowHeight(openingId: string): number {
    const o = activeOpenings.find(x => x.id === openingId)
    if (!o) return 0
    return o.sillHeight
  }

  let cwTotal = 0
  let aboveStuds = 0

  for (const { kind, isAbove, orientation, openingId } of studInfos) {
    if (isAbove && openingId) {
      cwTotal += aboveHeight(openingId) + belowHeight(openingId)
      aboveStuds++
    } else {
      // door/window считаются как middle (полная стойка h+overlap)
      const calcKind: StudKind = (kind === 'door' || kind === 'window') ? 'middle' : kind
      cwTotal += calcStudMaterial(h, calcKind, overlap, orientation).length
    }
  }

  // ─── Направляющие ────────────────────────────────────────────────────────

  const doorOpeningsWidth = activeOpenings
    .filter(o => o.type === 'door')
    .reduce((s, o) => s + o.width, 0)

  const SILL_TRACK_MARGIN = 200
  const sillTrackTotal = activeOpenings
    .filter(o => o.sillHeight > 0)
    .reduce((s, o) => s + o.width + 2 * SILL_TRACK_MARGIN, 0)

  const lintelTotal = activeOpenings.reduce((s, o) => s + (o.width + 400), 0)

  // ─── ГКЛ ─────────────────────────────────────────────────────────────────

  const openingsArea = activeOpenings.reduce((s, o) => s + o.width * o.height, 0)
  const gklArea = ((l * h - openingsArea) * 2 * gklLayers) / 1_000_000

  const firstOpening = activeOpenings[0]
  const aboveStudHeight = firstOpening
    ? h - firstOpening.height - firstOpening.sillHeight
    : 0

  // ─── Раскрой ─────────────────────────────────────────────────────────────

  const pnCuts = pnPieces(l, activeOpenings)
  const psCuts = psPieces(studInfos, h, overlap, activeOpenings)

  const cutList = {
    pn: buildCutList(pnCuts),
    ps: buildCutList(psCuts),
  }

  return {
    uwFloor:      (l - doorOpeningsWidth) / 1000,
    uwCeiling:    l / 1000,
    uwSill:       sillTrackTotal / 1000,
    lintel:       lintelTotal / 1000,
    cwTotal:      cwTotal / 1000,
    studsCount:   positions.length,
    aboveStuds,
    aboveStudHeight,
    gklArea,
    needsOverlap: h > STUD_LENGTH,
    studInfos,
    cutList,
  }
}
