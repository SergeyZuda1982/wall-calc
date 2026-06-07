import type { LiningInput, LiningResult } from '../types'

const STUD_LENGTH = 3000

export function calcLining(input: LiningInput, positions: number[]): LiningResult {
  const { length: l, height: h, hangerStep,
          gklLayers, doorPos: dp, doorWidth: dw, doorHeight: dh } = input

  const isC623 = input.liningType === 'c623'

  // ─── Направляющие ────────────────────────────────────────────────────────
  // С623: ПН 28×27 по всему периметру (пол+потолок+боковые)
  // С625/626: ПН только пол + потолок (как в перегородке)
  const floorRail = dw > 0 ? l - dw : l
  const ceilingRail = l
  const lintel = dw > 0 ? (dw + 400) : 0

  let guideRail = 0
  if (isC623) {
    // полный периметр
    let sideRail = 0
    if (input.abutment === 'both')  sideRail = 2 * h
    if (input.abutment === 'left' || input.abutment === 'right') sideRail = h
    guideRail = (floorRail + ceilingRail + sideRail + lintel) / 1000
  } else {
    // только пол + потолок + перемычка
    guideRail = (floorRail + ceilingRail + lintel) / 1000
  }

  // ─── Стойки ──────────────────────────────────────────────────────────────
  // С623: крайние стойки (pos=0 и pos=l) — это ПН, не ПП
  //       считаем только внутренние стойки
  // С625/626: все стойки включая крайние — ПС профиль
  const overlapMap: Record<string, number> = { ps50: 500, ps75: 750, ps100: 1000 }
  const overlap = overlapMap[input.profileType] ?? 750

  function studLen(sh: number): number {
    if (sh <= STUD_LENGTH || isC623) return sh
    return sh + overlap
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
    const isAbove = dw > 0 && pos > dp && pos < dp + dw
    const sh = isAbove ? h - dh : h
    studTotal += studLen(sh)
    if (isAbove) aboveStuds++

    if (isC623) {
      hangers += Math.ceil(sh / hangerStep)
      extenders += Math.floor(sh / STUD_LENGTH)
    }
  }

  // ─── ГКЛ ─────────────────────────────────────────────────────────────────
  const wallArea = l * h
  const openingArea = dw > 0 ? dw * dh : 0
  const gklArea = ((wallArea - openingArea) * gklLayers) / 1_000_000

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
