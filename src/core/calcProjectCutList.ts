import type { WallEntry, LiningEntry } from '../store/useProjectStore'
import { buildCutList } from './cutList'
import type { Piece, CutListResult } from './cutList'

export type ProfilePool =
  | 'pn_50' | 'pn_75' | 'pn_100'
  | 'ps_50' | 'ps_75' | 'ps_100'
  | 'pp_60x27' | 'pn_27x28'

export interface ProjectCutList {
  pools: Partial<Record<ProfilePool, CutListResult & { pieces: Piece[] }>>
}

// ─── Куски из перегородки ────────────────────────────────────────────────────

function wallPieces(w: WallEntry): Partial<Record<ProfilePool, Piece[]>> {
  const { input, result } = w
  if (!result) return {}

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

// ─── Объединение всех кусков и раскрой ───────────────────────────────────────

export function calcProjectCutList(
  walls: WallEntry[],
  linings: LiningEntry[]
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

  const pools: ProjectCutList['pools'] = {}
  for (const [key, pcs] of Object.entries(allPieces) as [ProfilePool, Piece[]][]) {
    if (pcs.length > 0) {
      const cl = buildCutList(pcs)
      pools[key] = { ...cl, pieces: pcs }
    }
  }

  return { pools }
}