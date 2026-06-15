/**
 * Общий раскрой объекта.
 *
 * Собирает все куски ПН/ПС/ПП со всех перегородок и облицовок,
 * группирует по типоразмеру и прогоняет через buildCutList один раз.
 * Остатки от одной конструкции автоматически используются для другой.
 */

import type { WallEntry, LiningEntry } from '../store/useProjectStore'
import { buildCutList, BAR_LENGTH } from './cutList'
import type { Piece, CutListResult } from './cutList'

export type ProfilePool =
  | 'pn_50' | 'pn_75' | 'pn_100'
  | 'ps_50' | 'ps_75' | 'ps_100'
  | 'pp_60x27' | 'pn_27x28'

export interface ProjectCutList {
  pools: Partial<Record<ProfilePool, CutListResult & { pieces: Piece[] }>>
}

const STUD_LENGTH = 3000

// ─── Куски из перегородки ────────────────────────────────────────────────────

function wallPieces(w: WallEntry): Partial<Record<ProfilePool, Piece[]>> {
  const { input, result } = w
  if (!result) return {}

  const prof = input.profileType
  const pnKey: ProfilePool = prof === 'ps50' ? 'pn_50' : prof === 'ps75' ? 'pn_75' : 'pn_100'
  const psKey: ProfilePool = prof === 'ps50' ? 'ps_50' : prof === 'ps75' ? 'ps_75' : 'ps_100'

  // ПН: берём из cutList.pn (уже правильно сформированы в calcResults)
  const pnPcs: Piece[] = result.cutList.pn.bars
    .flatMap(b => b.pieces.map(p => p.piece))

  // ПС: берём из cutList.ps
  const psPcs: Piece[] = result.cutList.ps.bars
    .flatMap(b => b.pieces.map(p => p.piece))

  return { [pnKey]: pnPcs, [psKey]: psPcs }
}

// ─── Куски из облицовки ──────────────────────────────────────────────────────

function liningPieces(l: LiningEntry): Partial<Record<ProfilePool, Piece[]>> {
  const { input, result } = l
  if (!result) return {}

  const isC623 = input.liningType === 'c623'
  const prof = input.profileType
  const li = input

  const activeOpenings = li.openings.filter(o => o.width > 0)
  const doorWidth = activeOpenings
    .filter(o => o.type === 'door')
    .reduce((s, o) => s + o.width, 0)

  const floorMm = li.length - doorWidth
  const ceilMm  = li.length
  const lintelMms = activeOpenings.map(o => o.width + 400)

  const overlap = prof === 'ps50' ? 500 : prof === 'ps75' ? 750 : 1000
  const h = li.height

  if (isC623) {
    // ПН 27×28 — периметр + перемычки
    const pnPcs: Piece[] = []
    // Пол
    let rem = floorMm; while (rem > 0) { const c = Math.min(rem, BAR_LENGTH); pnPcs.push({ length: c, role: 'floor', label: `Пол ${c}мм`, mustBeWhole: false }); rem -= c }
    // Потолок
    rem = ceilMm; while (rem > 0) { const c = Math.min(rem, BAR_LENGTH); pnPcs.push({ length: c, role: 'ceiling', label: `Потолок ${c}мм`, mustBeWhole: false }); rem -= c }
    // Боковые (если примыкание)
    const sides = li.abutment === 'both' ? 2 : (li.abutment === 'left' || li.abutment === 'right') ? 1 : 0
    for (let i = 0; i < sides; i++) {
      rem = h; while (rem > 0) { const c = Math.min(rem, BAR_LENGTH); pnPcs.push({ length: c, role: 'floor', label: `Боковая ${c}мм`, mustBeWhole: false }); rem -= c }
    }
    // Перемычки
    for (const len of lintelMms) pnPcs.push({ length: len, role: 'lintel', label: `Перемычка ${len}мм`, mustBeWhole: true })

    // ПП 60×27 — стойки
    const ppPcs: Piece[] = []
    const studsCount = result.studsCount - (li.abutment === 'both' ? 2 : li.abutment === 'none' ? 0 : 1)
    for (let i = 0; i < studsCount; i++) {
      ppPcs.push({ length: h, role: 'stud', label: `Стойка ${h}мм`, mustBeWhole: false })
    }

    return { pn_27x28: pnPcs, pp_60x27: ppPcs }
  } else {
    // С625/С626 — ПН пол/потолок + перемычки
    const pnKey: ProfilePool = prof === 'ps50' ? 'pn_50' : prof === 'ps75' ? 'pn_75' : 'pn_100'
    const psKey: ProfilePool = prof === 'ps50' ? 'ps_50' : prof === 'ps75' ? 'ps_75' : 'ps_100'

    const pnPcs: Piece[] = []
    let rem = floorMm; while (rem > 0) { const c = Math.min(rem, BAR_LENGTH); pnPcs.push({ length: c, role: 'floor', label: `Пол ${c}мм`, mustBeWhole: false }); rem -= c }
    rem = ceilMm; while (rem > 0) { const c = Math.min(rem, BAR_LENGTH); pnPcs.push({ length: c, role: 'ceiling', label: `Потолок ${c}мм`, mustBeWhole: false }); rem -= c }
    for (const len of lintelMms) pnPcs.push({ length: len, role: 'lintel', label: `Перемычка ${len}мм`, mustBeWhole: true })

    const psPcs: Piece[] = []
    for (let i = 0; i < result.studsCount; i++) {
      if (h <= STUD_LENGTH) {
        psPcs.push({ length: h, role: 'stud', label: `Стойка ${h}мм`, mustBeWhole: false })
      } else {
        psPcs.push({ length: STUD_LENGTH, role: 'stud', label: `Стойка осн. ${STUD_LENGTH}мм`, mustBeWhole: false })
        psPcs.push({ length: h - STUD_LENGTH + overlap, role: 'stud_part', label: `Стойка доп. ${h - STUD_LENGTH + overlap}мм`, mustBeWhole: false })
      }
    }

    return { [pnKey]: pnPcs, [psKey]: psPcs }
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