import type { LiningInput, LiningResult } from '../types'
import { buildCutList, BAR_LENGTH } from './cutList'
import type { Piece } from './cutList'

const STUD_LENGTH = 3000

export function calcLining(input: LiningInput, positions: number[]): LiningResult {
  const { length: l, height: h, hangerStep, gklLayers, openings } = input
  const activeOpenings = openings.filter(o => o.width > 0)

  const isC623 = input.liningType === 'c623'

  // ─── Направляющие ────────────────────────────────────────────────────────
  const doorOpeningsWidth = activeOpenings
    .filter(o => o.type === 'door')
    .reduce((s, o) => s + o.width, 0)

  const floorRail = l - doorOpeningsWidth
  const ceilingRail = l
  const lintelTotal = activeOpenings.reduce((s, o) => s + (o.width + 400), 0)

  let guideRail = 0
  if (isC623) {
    let sideRail = 0
    if (input.abutment === 'both')  sideRail = 2 * h
    if (input.abutment === 'left' || input.abutment === 'right') sideRail = h
    guideRail = (floorRail + ceilingRail + sideRail + lintelTotal) / 1000
  } else {
    guideRail = (floorRail + ceilingRail + lintelTotal) / 1000
  }

  // ─── Стойки ──────────────────────────────────────────────────────────────
  const overlapMap: Record<string, number> = { ps50: 500, ps75: 750, ps100: 1000 }
  const overlap = overlapMap[input.profileType] ?? 750

  // Крайние стойки (pos===0 / pos===l) примыкают к существующей стене на стороне,
  // отмеченной в abutment как "Стена" — там стойка цельная, торец в торец, без
  // нахлёста (как wall-стойка в перегородке). Если сторона "Свободно" — оставляем
  // как обычную стойку с нахлёстом (она всё равно непрерывно держится подвесами/
  // кронштейнами на стене по всей высоте, в отличие от свободного края перегородки).
  function edgeKind(pos: number): 'wall' | 'middle' {
    if (pos === 0) return (input.abutment === 'both' || input.abutment === 'left') ? 'wall' : 'middle'
    if (pos === l) return (input.abutment === 'both' || input.abutment === 'right') ? 'wall' : 'middle'
    return 'middle'
  }

  function studLen(sh: number, kind: 'wall' | 'middle'): number {
    if (sh <= STUD_LENGTH || isC623) return sh
    if (kind === 'wall') return sh // торец в торец, без нахлёста
    return sh + overlap
  }

  function aboveHeight(pos: number): number | null {
    for (const o of activeOpenings) {
      if (pos > o.pos && pos < o.pos + o.width) {
        return h - o.height - o.sillHeight
      }
    }
    return null
  }

  let studTotal = 0
  let aboveStuds = 0
  let hangers = 0
  let extenders = 0

  const countablePositions = isC623
    ? positions.filter(p => p !== 0 && p !== l)
    : positions

  for (const pos of countablePositions) {
    const above = aboveHeight(pos)
    const sh = above !== null ? above : h
    const kind = above !== null ? 'middle' : edgeKind(pos)
    studTotal += studLen(sh, kind)
    if (above !== null) aboveStuds++

    if (isC623) {
      hangers += Math.ceil(sh / hangerStep)
      extenders += Math.floor(sh / STUD_LENGTH)
    }
  }

  // ─── ГКЛ ─────────────────────────────────────────────────────────────────
  const wallArea = l * h
  const openingsArea = activeOpenings.reduce((s, o) => s + o.width * o.height, 0)
  const gklArea = ((wallArea - openingsArea) * gklLayers) / 1_000_000

  // ─── Раскрой ─────────────────────────────────────────────────────────────

  // ПН (или ПН 27×28 для С623): пол + потолок + боковые (С623) + перемычки
  const pnPcs: Piece[] = []

  // Пол (без дверных проёмов)
  let rem = floorRail
  while (rem > 0) {
    const c = Math.min(rem, BAR_LENGTH)
    pnPcs.push({ length: c, role: 'floor', label: `Пол ${c}мм`, mustBeWhole: false })
    rem -= c
  }

  // Потолок
  rem = ceilingRail
  while (rem > 0) {
    const c = Math.min(rem, BAR_LENGTH)
    pnPcs.push({ length: c, role: 'ceiling', label: `Потолок ${c}мм`, mustBeWhole: false })
    rem -= c
  }

  // Боковые направляющие (только С623)
  if (isC623) {
    const sides = input.abutment === 'both' ? 2
      : (input.abutment === 'left' || input.abutment === 'right') ? 1
      : 0
    for (let i = 0; i < sides; i++) {
      rem = h
      while (rem > 0) {
        const c = Math.min(rem, BAR_LENGTH)
        pnPcs.push({ length: c, role: 'floor', label: `Боковая ${c}мм`, mustBeWhole: false })
        rem -= c
      }
    }
  }

  // Перемычки — целые куски
  for (const o of activeOpenings) {
    const len = o.width + 400
    pnPcs.push({ length: len, role: 'lintel', label: `Перемычка ${len}мм`, mustBeWhole: true })
  }

  // ПС (С625/С626) или ПП 60×27 (С623): стойки
  const studPcs: Piece[] = []

  for (const pos of countablePositions) {
    const above = aboveHeight(pos)

    if (above !== null) {
      // Стойка попадает в зону проёма — только надпроёмная часть
      if (above > 0) {
        studPcs.push({ length: above, role: 'stud_part', label: `Над проёмом ${above}мм`, mustBeWhole: false })
      }
      // Подоконниковая часть (для оконных проёмов)
      const o = activeOpenings.find(o => pos > o.pos && pos < o.pos + o.width)
      if (o && o.sillHeight > 0) {
        studPcs.push({ length: o.sillHeight, role: 'stud_part', label: `Под подоконником ${o.sillHeight}мм`, mustBeWhole: false })
      }
    } else if (isC623 || h <= STUD_LENGTH) {
      // С623 не наращивается; или высота вписывается в пруток
      studPcs.push({ length: h, role: 'stud', label: `Стойка ${h}мм`, mustBeWhole: false })
    } else if (edgeKind(pos) === 'wall') {
      // Крайняя стойка у стены — торец в торец, без нахлёста: 3000 + остаток
      const rest = h - STUD_LENGTH
      studPcs.push({ length: STUD_LENGTH, role: 'stud', label: `Стойка пристенная осн. ${STUD_LENGTH}мм`, mustBeWhole: false })
      studPcs.push({ length: rest, role: 'stud_part', label: `Стойка пристенная доп. ${rest}мм`, mustBeWhole: false })
    } else {
      // Рядовая стойка, h > 3000 — два куска с нахлёстом
      studPcs.push({ length: STUD_LENGTH, role: 'stud', label: `Стойка осн. ${STUD_LENGTH}мм`, mustBeWhole: false })
      studPcs.push({ length: h - STUD_LENGTH + overlap, role: 'stud_part', label: `Стойка доп. ${h - STUD_LENGTH + overlap}мм`, mustBeWhole: false })
    }
  }

  const cutList = {
    pn:   buildCutList(pnPcs),
    stud: buildCutList(studPcs),
  }

  return {
    guideRail,
    stud: studTotal / 1000,
    studsCount: countablePositions.length,
    hangers,
    extenders,
    gklArea,
    needsOverlap: h > STUD_LENGTH && !isC623,
    cutList,
        rawPieces: { pn: pnPcs, stud: studPcs },  // ← исходные куски до раскроя
  }
}