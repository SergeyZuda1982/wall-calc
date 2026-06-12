import type { LiningInput, LiningResult } from '../types'

const STUD_LENGTH = 3000

export function calcLining(input: LiningInput, positions: number[]): LiningResult {
  const { length: l, height: h, hangerStep, gklLayers, openings } = input
  const activeOpenings = openings.filter(o => o.width > 0)

  const isC623 = input.liningType === 'c623'

  // ─── Направляющие ────────────────────────────────────────────────────────
  // Дверные проёмы вырезают из нижней направляющей; оконные — не вырезают
  const doorOpeningsWidth = activeOpenings
    .filter(o => o.type === 'door')
    .reduce((s, o) => s + o.width, 0)

  const floorRail = l - doorOpeningsWidth
  const ceilingRail = l

  // Перемычки над каждым проёмом (ширина + 400мм)
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

  function studLen(sh: number): number {
    if (sh <= STUD_LENGTH || isC623) return sh
    return sh + overlap
  }

  // Высота стоек над проёмом (если стойка попадает в зону проёма)
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

  // для С623 пропускаем крайние стойки (они ПН)
  const countablePositions = isC623
    ? positions.filter(p => p !== 0 && p !== l)
    : positions

  for (const pos of countablePositions) {
    const above = aboveHeight(pos)
    const sh = above !== null ? above : h
    studTotal += studLen(sh)
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

  return {
    guideRail,
    stud: studTotal / 1000,
    studsCount: countablePositions.length,
    hangers,
    extenders,
    gklArea,
    needsOverlap: h > STUD_LENGTH && !isC623,
  }
}
