import type { WallEntry, LiningEntry } from '../store/useProjectStore'
import type { Ceiling } from '../types'
import { buildCutList } from './cutList'
import type { Piece, CutListResult } from './cutList'
import { calcCeiling } from './calcCeiling'

export type ProfilePool =
  | 'pn_50' | 'pn_75' | 'pn_100'
  | 'ps_50' | 'ps_75' | 'ps_100'
  | 'pp_60x27' | 'pn_27x28'

export interface ProjectCutList {
  pools: Partial<Record<ProfilePool, CutListResult & { pieces: Piece[] }>>
}

// ─── Куски из перегородки ────────────────────────────────────────────────────

function wallPieces(w: WallEntry): Partial<Record<ProfilePool, Piece[]>> {
  if (w.kind === 'double') {
    const { doubleInput, doubleResult } = w
    if (!doubleInput || !doubleResult) return {}
    const prof = doubleInput.profileType
    const pnKey: ProfilePool = prof === 'ps50' ? 'pn_50' : prof === 'ps75' ? 'pn_75' : 'pn_100'
    const psKey: ProfilePool = prof === 'ps50' ? 'ps_50' : prof === 'ps75' ? 'ps_75' : 'ps_100'
    // Одна и та же сетка стоек у обоих рядов (см. calcDoubleFrame.ts), но
    // КАЖДЫЙ ряд — свой набор направляющих/стоек (два независимых каркаса) —
    // куски обоих рядов идут в один пул на раскрой, чтобы обрезки одного ряда
    // могли уйти на другой (реальная экономия материала на объекте).
    return {
      [pnKey]: [...doubleResult.frameA.rawPieces.pn, ...doubleResult.frameB.rawPieces.pn],
      [psKey]: [...doubleResult.frameA.rawPieces.ps, ...doubleResult.frameB.rawPieces.ps],
    }
  }
  const { input, result } = w
  if (!result || !input) return {}

  const prof = input.profileType
  const pnKey: ProfilePool = prof === 'ps50' ? 'pn_50' : prof === 'ps75' ? 'pn_75' : 'pn_100'
  const psKey: ProfilePool = prof === 'ps50' ? 'ps_50' : prof === 'ps75' ? 'ps_75' : 'ps_100'

  return {
    [pnKey]: result.rawPieces.pn,
    [psKey]: result.rawPieces.ps,
  }
}

// ─── Куски из облицовки ──────────────────────────────────────────────────────

function liningPieces(l: LiningEntry): Partial<Record<ProfilePool, Piece[]>> {
  const { input, result } = l
  if (!result) return {}

  const isC623 = input.liningType === 'c623'
  const prof = input.profileType

  if (isC623) {
    return {
      pn_27x28: result.rawPieces.pn,
      pp_60x27: result.rawPieces.stud,
    }
  } else {
    const pnKey: ProfilePool = prof === 'ps50' ? 'pn_50' : prof === 'ps75' ? 'pn_75' : 'pn_100'
    const psKey: ProfilePool = prof === 'ps50' ? 'ps_50' : prof === 'ps75' ? 'ps_75' : 'ps_100'
    return {
      [pnKey]: result.rawPieces.pn,
      [psKey]: result.rawPieces.stud,
    }
  }
}

// ─── Куски из потолка ────────────────────────────────────────────────────────

/** 05.09.2026, запрос пользователя: тот же пул, что и у пп_60x27 из
 *  облицовки С623 (см. liningPieces выше) — все куски ПП 60×27, откуда бы
 *  они ни были нужны, делят один пул остатков. Только прямоугольная
 *  геометрия (см. calcCeiling.ts/ceilingCutList.ts) — потолок без
 *  сохранённых roomLengthMm/roomWidthMm (fallback-режим) пропускается,
 *  пула нет для него, как и у панели на одном потолке. */
function ceilingPieces(c: Ceiling): Partial<Record<ProfilePool, Piece[]>> {
  if (!c.ceilingSpec) return {}
  const result = calcCeiling(c.ceilingSpec)
  if (!result.rawProfilePieces) return {}
  return {
    pp_60x27: [...result.rawProfilePieces.main, ...result.rawProfilePieces.bearing],
  }
}

// ─── Объединение всех кусков и раскрой ───────────────────────────────────────

export function calcProjectCutList(
  walls: WallEntry[],
  linings: LiningEntry[],
  ceilings: Ceiling[] = [],
): ProjectCutList {
  const allPieces: Partial<Record<ProfilePool, Piece[]>> = {}

  const addPieces = (pieces: Partial<Record<ProfilePool, Piece[]>>) => {
    for (const [key, pcs] of Object.entries(pieces) as [ProfilePool, Piece[]][]) {
      if (!allPieces[key]) allPieces[key] = []
      allPieces[key]!.push(...pcs)
    }
  }

  for (const w of walls) addPieces(wallPieces(w))
  for (const l of linings) addPieces(liningPieces(l))
  for (const c of ceilings) addPieces(ceilingPieces(c))

  const pools: ProjectCutList['pools'] = {}
  for (const [key, pcs] of Object.entries(allPieces) as [ProfilePool, Piece[]][]) {
    if (pcs.length > 0) {
      const cl = buildCutList(pcs)
      pools[key] = { ...cl, pieces: pcs }
    }
  }

  return { pools }
}