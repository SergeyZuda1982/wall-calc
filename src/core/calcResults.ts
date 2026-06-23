import type { StudKind, StudInfo, StudOrientation, CalcResult, Opening, AbutmentType, EdgeProfile, BoardSpec, PlywoodInsert } from '../types'
import { DEFAULT_BOARD_SPEC } from '../types'
import { calcScrews } from './calcScrews'
import { calcStudMaterial, STUD_LENGTH } from './calcStudMaterial'
import { buildOpeningStuds, mergeStuds, attachStudHeights } from './buildPositions'
import { buildCutList, pnPieces, psPieces } from './cutList'
import { integrateHeight, maxStudHeight, studHeightAt, profilePathLength } from './profileGeometry'

function assignOrientations(
  studs: { pos: number; kind: StudKind; height: number }[]
): StudInfo[] {
  let middleCount = 0
  let lastMiddleOrientation: StudOrientation = 'down'

  return studs.map(({ pos, kind, height }) => {
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
      orientation = lastMiddleOrientation === 'down' ? 'up' : 'down'
    }

    return { pos, kind, height, orientation, isAbove: false, openingId: null }
  })
}

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
  ceilingProfile: EdgeProfile,
  floorProfile: EdgeProfile,
  l: number,
  openings: Opening[],
  abutment: AbutmentType | string,
  overlap: number,
  gklLayers: number = 1,
  layer1: BoardSpec = DEFAULT_BOARD_SPEC,
  layer2: BoardSpec = DEFAULT_BOARD_SPEC,
  plywoodInserts: PlywoodInsert[] = [],
): CalcResult {
  const activeOpenings = openings.filter(o => o.width > 0)

  const openingStuds = buildOpeningStuds(openings)
  const openingPositions = new Set(openingStuds.map(s => s.pos))
  const grid = positions.filter(p => p !== 0 && p !== l && !openingPositions.has(p))
  const merged = mergeStuds(grid, openingStuds, l, abutment as AbutmentType)
  const withHeights = attachStudHeights(merged, ceilingProfile, floorProfile)
  const withOrientation = assignOrientations(withHeights)
  const studInfos = assignOpeningContext(withOrientation, openings)

  // ─── Расчёт материала ────────────────────────────────────────────────────

  function aboveHeight(si: StudInfo, openingId: string): number {
    const o = activeOpenings.find(x => x.id === openingId)
    if (!o) return 0
    return si.height - o.height - o.sillHeight
  }

  function belowHeight(openingId: string): number {
    const o = activeOpenings.find(x => x.id === openingId)
    if (!o) return 0
    return o.sillHeight
  }

  let cwTotal = 0
  let aboveStuds = 0

  for (const si of studInfos) {
    const { kind, isAbove, orientation, openingId, height } = si
    if (isAbove && openingId) {
      cwTotal += aboveHeight(si, openingId) + belowHeight(openingId)
      aboveStuds++
    } else {
      const calcKind: StudKind = (kind === 'door' || kind === 'window') ? 'middle' : kind
      cwTotal += calcStudMaterial(height, calcKind, overlap, orientation).length
    }
  }

  // ─── Направляющие ────────────────────────────────────────────────────────

  const doorOpenings = activeOpenings.filter(o => o.type === 'door')

  const SILL_TRACK_MARGIN = 200
  const sillTrackTotal = activeOpenings
    .filter(o => o.sillHeight > 0)
    .reduce((s, o) => s + o.width + 2 * SILL_TRACK_MARGIN, 0)

  const lintelTotal = activeOpenings.reduce((s, o) => s + (o.width + 400), 0)

  // ─── ГКЛ ─────────────────────────────────────────────────────────────────
  // Площадь между потолком и полом интегрируется по всей длине стены
  // (для плоской стены = l × h, как и раньше).

  const openingsArea = activeOpenings.reduce((s, o) => s + o.width * o.height, 0)
  const wallArea = integrateHeight(ceilingProfile, floorProfile, 0, l)
  const gklArea = ((wallArea - openingsArea) * 2 * gklLayers) / 1_000_000

  const firstOpening = activeOpenings[0]
  const aboveStudHeight = firstOpening
    ? studHeightAt(firstOpening.pos, ceilingProfile, floorProfile) - firstOpening.height - firstOpening.sillHeight
    : 0

  // ─── Раскрой ─────────────────────────────────────────────────────────────

  const worstHeight = maxStudHeight(ceilingProfile, floorProfile, l)

  // Реальные длины направляющих по ломаной профиля (учитывают скат)
  const ceilPathLen = profilePathLength(ceilingProfile, 0, l)
  const floorSegPathLen = (() => {
    let total = 0
    let cursor = 0
    for (const o of [...doorOpenings].sort((a, b) => a.pos - b.pos)) {
      if (o.pos > cursor) total += profilePathLength(floorProfile, cursor, o.pos)
      cursor = o.pos + o.width
    }
    if (cursor < l) total += profilePathLength(floorProfile, cursor, l)
    return total
  })()

  const pnCuts = pnPieces(l, activeOpenings, ceilingProfile, floorProfile)
  const psCuts = psPieces(studInfos, worstHeight, overlap, activeOpenings)

  const cutList = {
    pn: buildCutList(pnCuts),
    ps: buildCutList(psCuts),
  }

  const screws = calcScrews(
    studInfos,
    openings,
    layer1,
    layer2,
    gklLayers as 1 | 2,
    2, // перегородка — две стороны
    overlap,
    plywoodInserts,
    positions,
  )

  return {
    uwFloor:      floorSegPathLen / 1000,
    uwCeiling:    ceilPathLen / 1000,
    uwSill:       sillTrackTotal / 1000,
    lintel:       lintelTotal / 1000,
    cwTotal:      cwTotal / 1000,
    studsCount:   positions.length,
    aboveStuds,
    aboveStudHeight,
    gklArea,
    needsOverlap: worstHeight > STUD_LENGTH,
    studInfos,
    cutList,
    rawPieces: { pn: pnCuts, ps: psCuts },
    screws,
  }
}