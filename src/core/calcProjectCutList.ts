/**
 * Общий раскрой объекта.
 *
 * Собирает все куски ПН/ПС/ПП со всех перегородок и облицовок,
 * группирует по типоразмеру и прогоняет через buildCutList один раз.
 * Остатки от одной конструкции используются для другой.
 */

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

  const pnPcs: Piece[] = result.cutList.pn.bars.flatMap(b => b.pieces.map(p => p.piece))
  const psPcs: Piece[] = result.cutList.ps.bars.flatMap(b => b.pieces.map(p => p.piece))

  return { [pnKey]: pnPcs, [psKey]: psPcs }
}

// ─── Куски из облицовки ──────────────────────────────────────────────────────

function liningPieces(l: LiningEntry): Partial<Record<ProfilePool, Piece[]>> {
  const { input, result } = l
  if (!result) return {}

  const isC623 = input.liningType === 'c623'
  const prof = input.profileType

  const pnPcs: Piece[] = result.cutList.pn.bars.flatMap(b => b.pieces.map(p => p.piece))
  const studPcs: Piece[] = result.cutList.stud.bars.flatMap(b => b.pieces.map(p => p.piece))

  if (isC623) {
    return { pn_27x28: pnPcs, pp_60x27: studPcs }
  } else {
    const pnKey: ProfilePool = prof === 'ps50' ? 'pn_50' : prof === 'ps75' ? 'pn_75' : 'pn_100'
    const psKey: ProfilePool = prof === 'ps50' ? 'ps_50' : prof === 'ps75' ? 'ps_75' : 'ps_100'
    return { [pnKey]: pnPcs, [psKey]: studPcs }
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