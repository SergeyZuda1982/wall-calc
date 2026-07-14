import type { StudKind, StudInfo, StudOrientation, CalcResult, Opening, Communication, AbutmentType, EdgeProfile, BoardSpec, PlywoodInsert } from '../types'
import { DEFAULT_BOARD_SPEC, COMM_HEADROOM_MIN } from '../types'
import { calcScrews } from './calcScrews'
import { calcStudMaterial, STUD_LENGTH } from './calcStudMaterial'
import { buildOpeningStuds, mergeStuds, attachStudHeights } from './buildPositions'
import { buildCutList, pnPieces, psPieces } from './cutList'
import { integrateHeight, maxStudHeight, studHeightAt, profilePathLength } from './profileGeometry'
import { calcSealingTape } from './calcSealingTape'

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

    return { pos, kind, height, orientation, isAbove: false, openingId: null, communicationId: null }
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

/**
 * Транзитные коммуникации (14.07.2026) — рядовая стойка, попадающая в
 * диапазон коммуникации, НЕ превращается в торцевую (в отличие от проёма):
 * она остаётся 'middle'/'user' как была, только помечается isAbove +
 * communicationId, чтобы её материал/раскрой считались двумя кусками
 * (см. aboveHeight/belowHeight ниже). Стойка, уже относящаяся к проёму,
 * не переопределяется (зоны проёмов и коммуникаций не должны пересекаться).
 */
function assignCommunicationContext(
  studInfos: StudInfo[],
  communications: Communication[],
): StudInfo[] {
  const active = communications.filter(c => c.width > 0)
  return studInfos.map(si => {
    if (si.openingId) return si
    for (const c of active) {
      if (si.pos > c.pos && si.pos < c.pos + c.width) {
        return { ...si, isAbove: true, communicationId: c.id }
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
  // 2 — перегородка (обшивка с обеих сторон, дефолт, как раньше).
  // 1 — облицовка ИЛИ один независимый ряд двойного каркаса С115/С116
  // (обшивка только с внешней стороны, вторая сторона ряда обращена
  // в зазор между каркасами и ничем не обшивается сама по себе).
  sides: 1 | 2 = 2,
  communications: Communication[] = [],
): CalcResult {
  const activeOpenings = openings.filter(o => o.width > 0)
  const activeCommunications = communications.filter(c => c.width > 0)

  const openingStuds = buildOpeningStuds(openings)
  const openingPositions = new Set(openingStuds.map(s => s.pos))
  const grid = positions.filter(p => p !== 0 && p !== l && !openingPositions.has(p))
  const merged = mergeStuds(grid, openingStuds, l, abutment as AbutmentType)
  const withHeights = attachStudHeights(merged, ceilingProfile, floorProfile)
  const withOrientation = assignOrientations(withHeights)
  const withOpenings = assignOpeningContext(withOrientation, openings)
  const studInfos = assignCommunicationContext(withOpenings, activeCommunications)

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

  // Запас от верха коммуникации до верхнего ПН в её собственной точке pos
  // (единая точка отсчёта для решения "ставить верхнюю перемычку или нет" —
  // тот же приём, что и aboveStudHeight ниже для первого проёма).
  function commHeadroom(c: Communication): number {
    return studHeightAt(c.pos, ceilingProfile, floorProfile) - c.top
  }
  function commHasTop(c: Communication): boolean {
    return commHeadroom(c) > COMM_HEADROOM_MIN
  }

  let cwTotal = 0
  let aboveStuds = 0

  for (const si of studInfos) {
    const { kind, isAbove, orientation, openingId, communicationId, height } = si
    if (isAbove && openingId) {
      cwTotal += aboveHeight(si, openingId) + belowHeight(openingId)
      aboveStuds++
    } else if (isAbove && communicationId) {
      const c = activeCommunications.find(x => x.id === communicationId)
      if (c) {
        const belowLen = c.bottom
        const aboveLen = commHasTop(c) ? (height - c.top) : 0
        cwTotal += belowLen + aboveLen
        aboveStuds++
      }
    } else {
      const calcKind: StudKind = (kind === 'door' || kind === 'window') ? 'middle' : kind
      cwTotal += calcStudMaterial(height, calcKind, overlap, orientation).length
    }
  }

  // ─── Направляющие ────────────────────────────────────────────────────────

  // Напольная направляющая отсутствует под любым проёмом "от пола"
  // (sillHeight=0) — не только под дверью, но и под окном/проёмом без
  // подоконника (например, панорамное остекление в пол).
  const floorLevelOpenings = activeOpenings.filter(o => o.sillHeight === 0)

  const SILL_TRACK_MARGIN = 200
  const sillTrackTotal = activeOpenings
    .filter(o => o.sillHeight > 0)
    .reduce((s, o) => s + o.width + 2 * SILL_TRACK_MARGIN, 0)

  const lintelTotal = activeOpenings.reduce((s, o) => s + (o.width + 400), 0)

  // Перемычки коммуникаций — нижняя всегда, верхняя только если commHasTop.
  // Та же формула "ширина+400", что и у проёмов (см. КОНСПЕКТ 14.07.2026).
  const commLintelTotal = activeCommunications.reduce((s, c) => {
    const len = c.width + 400
    return s + len + (commHasTop(c) ? len : 0)
  }, 0)

  // ─── ГКЛ ─────────────────────────────────────────────────────────────────
  // Площадь между потолком и полом интегрируется по всей длине стены
  // (для плоской стены = l × h, как и раньше).

  const openingsArea = activeOpenings.reduce((s, o) => s + o.width * o.height, 0)
  const wallArea = integrateHeight(ceilingProfile, floorProfile, 0, l)
  const gklArea = ((wallArea - openingsArea) * sides * gklLayers) / 1_000_000

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
    for (const o of [...floorLevelOpenings].sort((a, b) => a.pos - b.pos)) {
      if (o.pos > cursor) total += profilePathLength(floorProfile, cursor, o.pos)
      cursor = o.pos + o.width
    }
    if (cursor < l) total += profilePathLength(floorProfile, cursor, l)
    return total
  })()

  const pnCuts = pnPieces(l, activeOpenings, ceilingProfile, floorProfile, activeCommunications)
  const psCuts = psPieces(studInfos, worstHeight, overlap, activeOpenings, activeCommunications)

  const sealingTape = calcSealingTape(ceilPathLen, floorSegPathLen, studInfos)

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
    sides,
    overlap,
    plywoodInserts,
    positions,
    activeCommunications,
    ceilingProfile,
    floorProfile,
  )

  return {
    uwFloor:      floorSegPathLen / 1000,
    uwCeiling:    ceilPathLen / 1000,
    uwSill:       sillTrackTotal / 1000,
    lintel:       (lintelTotal + commLintelTotal) / 1000,
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
    sealingTapeLm: sealingTape.tapeLm,
  }
}