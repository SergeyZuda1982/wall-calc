/**
 * planFrameEstimate.ts — смета каркаса по всему плану.
 *
 * ⚠️ ВАЖНАЯ ПРАВКА (12.07.2026, после жалобы пользователя на первую
 * версию этого файла): дедупликация угловой стойки на 90°-примыканиях
 * применяется ТОЛЬКО между сегментами ОБЛИЦОВКИ (wall_lining) — короб
 * вокруг трубы/колонны, ниша, угол двух примыкающих друг к другу
 * облицовок. Именно там на объекте в углу стоит одна общая стойка.
 *
 * Для ПЕРЕГОРОДОК (wall_new), примыкающих друг к другу под 90°, каждая
 * перегородка — самостоятельный несущий каркас со своей обшивкой с ДВУХ
 * сторон, и в углу двух перегородок каждая ставит СВОЮ угловую стойку —
 * дедупликации там быть не должно, считается как и до этой задачи (по
 * одной стойке с каждого конца каждого сегмента, без изменений).
 *
 * Отдельный случай: облицовка, начинающаяся от угла перегородки (не от
 * угла другой облицовки) — там угловая стойка уже стоит от перегородки,
 * доп. стойка для облицовки не нужна. Это НЕ требует отдельной логики
 * здесь: раз один из двух сегментов узла — wall_new, а не wall_lining,
 * такой узел просто не попадает в lining-lining фильтр ниже и не
 * дедуплицируется (у облицовки там как и раньше стоит kind='wall' конец,
 * примыкающий к перегородке через resolveAbutment — это не новая стойка
 * "с нуля", а уже существующее корректное поведение до этой задачи).
 *
 * См. TASKS.md / KONSPEKT.md "дедупликация угловой стойки на
 * 90°-примыканиях".
 */

import type { PlanLine, RectColumn, CalcResult, LiningResult } from '../types'
import type { LineAttachments } from './attachmentResolver'
import { buildWallsForJoin } from './wallJoin'
import { findFrameCornerNodes, type FrameCornerNode } from './frameCornerNodes'
import { planLinesToWallInputs } from './planLineToWallInput'
import { planLinesToLiningInputs } from './planLineToLiningInput'
import { buildPositions } from './buildPositions'
import { calcResults } from './calcResults'
import { calcLining } from './calcLining'
import { normalizeProfile } from './profileGeometry'
import { getProfile } from '../data/profiles'
import { buildCutList, type CutListResult, type Piece } from './cutList'

// ─── Перегородки (wall_new) — БЕЗ дедупликации, плоская сумма по линиям ────

export interface PlanFramePartitionLineResult {
  lineId: string
  result: CalcResult
}

export interface PlanFramePartitionEstimate {
  perLine: PlanFramePartitionLineResult[]
  studsCount: number
  cwTotalM: number
}

function calcPartitionEstimate(
  lines: PlanLine[],
  attachmentsMap: Map<string, LineAttachments>,
): PlanFramePartitionEstimate {
  const inputs = planLinesToWallInputs(lines, attachmentsMap)
  const perLine: PlanFramePartitionLineResult[] = []

  for (const { line, input } of inputs) {
    const profile = getProfile(input.profileType)
    const overlap = input.customOverlap != null && input.customOverlap >= 100
      ? input.customOverlap
      : profile.overlap

    const ceilingProfile = normalizeProfile(input.ceilingProfile, input.length, input.height)
    const floorProfile = normalizeProfile(input.floorProfile, input.length, 0)

    const { positions } = buildPositions(input.length, input.step, input.firstStud, input.openings)
    const result = calcResults(
      positions, ceilingProfile, floorProfile, input.length, input.openings,
      input.abutment, overlap,
      input.wallType === 'c112' ? 2 : 1,
      input.layer1, input.layer2, input.plywoodInserts,
    )
    perLine.push({ lineId: line.id, result })
  }

  return {
    perLine,
    studsCount: perLine.reduce((s, p) => s + p.result.studsCount, 0),
    cwTotalM: perLine.reduce((s, p) => s + p.result.cwTotal, 0),
  }
}

// ─── Облицовка (wall_lining) — С дедупликацией на 90°-углах облицовка↔облицовка ─

export interface PlanFrameLiningLineResult {
  lineId: string
  result: LiningResult
}

export interface PlanFrameLiningEstimate {
  perLine: PlanFrameLiningLineResult[]
  /** Число найденных 90°-угловых узлов облицовка↔облицовка, по которым вычтена дублирующаяся стойка. */
  cornerNodesCount: number
  studsCountRaw: number
  studsCount: number
  cwTotalMRaw: number
  cwTotalM: number
  studCutList: CutListResult
}

/** Та же равномерная сетка, что и в LiningCalc.tsx (buildPos): 0, step, 2·step, ..., l. */
function buildLiningPositions(l: number, s: number): number[] {
  const pos: number[] = [0]
  let p = s
  while (p <= l) { pos.push(p); p += s }
  if (pos[pos.length - 1] !== l) pos.push(l)
  return pos
}

function calcLiningEstimate(
  lines: PlanLine[],
  attachmentsMap: Map<string, LineAttachments>,
  scaleMmPx: number,
  rectColumns: RectColumn[],
): PlanFrameLiningEstimate {
  const inputs = planLinesToLiningInputs(lines, attachmentsMap)

  const perLine: PlanFrameLiningLineResult[] = []
  const lineLenById = new Map<string, number>()
  const liningTypeById = new Map<string, string>()
  const studPiecesById = new Map<string, Piece[]>()

  for (const { line, input } of inputs) {
    const positions = buildLiningPositions(input.length, input.step)
    const result = calcLining(input, positions)

    perLine.push({ lineId: line.id, result })
    lineLenById.set(line.id, input.length)
    liningTypeById.set(line.id, input.liningType)
    studPiecesById.set(line.id, [...result.rawPieces.stud])
  }

  const liningLineIds = new Set(perLine.map(p => p.lineId))
  const lineById = new Map(perLine.map(p => [p.lineId, p]))

  const walls = buildWallsForJoin(lines, scaleMmPx, rectColumns)
  // Только узлы, где ОБА сегмента — облицовка (wall_lining). Если один из
  // двух — перегородка (wall_new) или капстена, он просто отсутствует в
  // liningLineIds (planLinesToLiningInputs фильтрует по type==='wall_lining')
  // — узел естественно не попадает в список ниже, отдельная проверка не нужна.
  const cornerNodes: FrameCornerNode[] = findFrameCornerNodes(walls)
    .filter(c => liningLineIds.has(c.aId) && liningLineIds.has(c.bId))

  const studsCountRaw = perLine.reduce((s, p) => s + p.result.studsCount, 0)
  const cwTotalMRaw = perLine.reduce((s, p) => s + p.result.stud, 0)

  let studsCount = studsCountRaw
  let cwTotalM = cwTotalMRaw
  let cornerNodesCount = 0

  const consumedEnds = new Set<string>()

  for (const c of cornerNodes) {
    // С623 (frame_pn28) — крайние позиции обходятся боковой направляющей,
    // не 'wall'-стойкой, и не входят в studsCount вообще (см. calcLining.ts
    // countablePositions) — дедупликация тут не имеет смысла, пропускаем.
    if (liningTypeById.get(c.aId) === 'c623' || liningTypeById.get(c.bId) === 'c623') continue

    const aKey = `${c.aId}#${c.aEnd}`
    const bKey = `${c.bId}#${c.bEnd}`
    if (consumedEnds.has(aKey) || consumedEnds.has(bKey)) continue

    const aLen = lineLenById.get(c.aId)
    const bLen = lineLenById.get(c.bId)
    const aLine = lineById.get(c.aId)
    const bLine = lineById.get(c.bId)
    if (aLen == null || bLen == null || !aLine || !bLine) continue

    const aPos = c.aEnd === 'end1' ? 0 : aLen
    const bPos = c.bEnd === 'end1' ? 0 : bLen

    const aStud = aLine.result.studInfos.find(s => s.pos === aPos && s.kind === 'wall')
    const bStud = bLine.result.studInfos.find(s => s.pos === bPos && s.kind === 'wall')
    if (!aStud || !bStud) continue

    // Оставляем угловую стойку линии A, вычитаем дублирующую стойку линии B.
    studsCount -= 1
    cwTotalM -= bStud.height / 1000 // kind='wall' -> длина материала === высота

    const bPieces = studPiecesById.get(c.bId)
    if (bPieces) {
      const idx = bPieces.findIndex(p => p.length === bStud.height)
      if (idx >= 0) bPieces.splice(idx, 1)
    }

    consumedEnds.add(aKey)
    consumedEnds.add(bKey)
    cornerNodesCount++
  }

  const allStudPieces: Piece[] = []
  for (const pieces of studPiecesById.values()) allStudPieces.push(...pieces)
  const studCutList = buildCutList(allStudPieces)

  return { perLine, cornerNodesCount, studsCountRaw, studsCount, cwTotalMRaw, cwTotalM, studCutList }
}

// ─── Публичная точка входа ──────────────────────────────────────────────────

export interface PlanFrameEstimate {
  partitions: PlanFramePartitionEstimate
  lining: PlanFrameLiningEstimate
}

/**
 * Считает смету каркаса по всему плану: перегородки (wall_new) — плоской
 * суммой без изменений, облицовка (wall_lining) — с дедупликацией угловой
 * стойки на найденных 90°-узлах облицовка↔облицовка.
 *
 * attachmentsMap — тот же результат resolveAllAttachments(surfaces), что
 * уже строится в FloorPlan.tsx для сметы крепежа боковых примыканий
 * (lineAttachments).
 */
export function calcPlanFrameEstimate(
  lines: PlanLine[],
  attachmentsMap: Map<string, LineAttachments>,
  scaleMmPx: number,
  rectColumns: RectColumn[] = [],
): PlanFrameEstimate {
  return {
    partitions: calcPartitionEstimate(lines, attachmentsMap),
    lining: calcLiningEstimate(lines, attachmentsMap, scaleMmPx, rectColumns),
  }
}
