/**
 * planFrameEstimate.ts — смета каркаса (стойки/раскрой ПС) по всему плану
 * с дедупликацией угловой стойки на 90°-примыканиях.
 *
 * См. TASKS.md / KONSPEKT.md "дедупликация угловой стойки на
 * 90°-примыканиях" (короба/ниши/колонны, любые перегородки/облицовки).
 *
 * Суть: каждая линия плана (wall_new, gkl) считается независимо через
 * calcResults — как и раньше (см. planLineToWallInput.ts). Если на конце
 * линии есть примыкание (любого типа), calcResults ставит туда стойку
 * kind='wall' — она входит в studsCount/cwTotal этой линии целиком, как
 * будто стойка "своя". Если этот же конец физически является 90°-углом
 * с другим сегментом каркаса (короб/ниша/колонна/угол двух перегородок),
 * соседняя линия СИММЕТРИЧНО ставит туда точно такую же стойку — по факту
 * на объекте она одна общая, но в сумме по двум линиям посчитана дважды.
 *
 * Эта функция считает все линии по отдельности (без каких-либо изменений
 * в per-line расчёте — это НАМЕРЕННО, calcResults/buildPositions остаются
 * тем же кодом, что и в standalone-калькуляторе), находит 90°-угловые узлы
 * между парами линий (frameCornerNodes.ts) и на уровне АГРЕГАЦИИ вычитает
 * ровно одну лишнюю угловую стойку на каждый найденный узел — из итогового
 * количества, метража (cwTotal) и объединённого раскроя (cutList).
 *
 * T-стык/крест/торец-в-торец/примыкание к капстене/свободный конец —
 * не 90°-угол между двумя concat, под findFrameCornerNodes не попадают,
 * считаются как раньше (без изменений).
 */

import type { PlanLine, RectColumn, CalcResult } from '../types'
import type { LineAttachments } from './attachmentResolver'
import { buildWallsForJoin } from './wallJoin'
import { findFrameCornerNodes, type FrameCornerNode } from './frameCornerNodes'
import { planLinesToWallInputs } from './planLineToWallInput'
import { buildPositions } from './buildPositions'
import { calcResults } from './calcResults'
import { normalizeProfile } from './profileGeometry'
import { getProfile } from '../data/profiles'
import { buildCutList, type CutListResult, type Piece } from './cutList'

export interface PlanFrameLineResult {
  lineId: string
  result: CalcResult
}

export interface PlanFrameEstimate {
  perLine: PlanFrameLineResult[]
  /** Число найденных 90°-угловых узлов, по которым была вычтена дублирующаяся стойка. */
  cornerNodesCount: number
  /** Сумма studsCount по линиям без дедупликации (для справки/диагностики). */
  studsCountRaw: number
  /** Итоговое число стоек по плану с учётом дедупликации угловых узлов. */
  studsCount: number
  /** Сумма cwTotal (м) по линиям без дедупликации. */
  cwTotalMRaw: number
  /** Итоговый метраж ПС (м) по плану с учётом дедупликации угловых узлов. */
  cwTotalM: number
  /** Объединённый раскрой ПС по всему плану, с учётом дедупликации. */
  studCutList: CutListResult
}

/**
 * Считает смету каркаса (ПС) по всему плану с дедупликацией угловой
 * стойки на 90°-узлах. attachmentsMap — тот же результат
 * resolveAllAttachments(surfaces), что уже строится в FloorPlan.tsx для
 * сметы крепежа боковых примыканий (lineAttachments).
 */
export function calcPlanFrameEstimate(
  lines: PlanLine[],
  attachmentsMap: Map<string, LineAttachments>,
  scaleMmPx: number,
  rectColumns: RectColumn[] = [],
): PlanFrameEstimate {
  const inputs = planLinesToWallInputs(lines, attachmentsMap)

  const perLine: PlanFrameLineResult[] = []
  const lineLenById = new Map<string, number>()
  const psPiecesById = new Map<string, Piece[]>()

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
    lineLenById.set(line.id, input.length)
    psPiecesById.set(line.id, [...result.rawPieces.ps])
  }

  const frameLineIds = new Set(perLine.map(p => p.lineId))
  const lineById = new Map(perLine.map(p => [p.lineId, p]))

  const walls = buildWallsForJoin(lines, scaleMmPx, rectColumns)
  const cornerNodes: FrameCornerNode[] = findFrameCornerNodes(walls)
    .filter(c => frameLineIds.has(c.aId) && frameLineIds.has(c.bId))

  const studsCountRaw = perLine.reduce((s, p) => s + p.result.studsCount, 0)
  const cwTotalMRaw = perLine.reduce((s, p) => s + p.result.cwTotal, 0)

  let studsCount = studsCountRaw
  let cwTotalM = cwTotalMRaw
  let cornerNodesCount = 0

  // Каждый конец линии может участвовать максимум в одном дедуплицированном
  // узле — защита от переучёта, если в одной точке физически сходится
  // больше двух сегментов (редкий случай, вне основного скоупа).
  const consumedEnds = new Set<string>()

  for (const c of cornerNodes) {
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
    // Обе стойки должны быть реальными 'wall'-стойками (примыкание
    // подтверждено резолвером) — если нет, это не тот случай, пропускаем
    // без вычета (защита, не должно случаться при найденном 90°-узле).
    if (!aStud || !bStud) continue

    // Оставляем угловую стойку линии A, вычитаем дублирующую стойку линии B
    // (какую из двух оставить — не важно, стойка физически одна и та же).
    studsCount -= 1
    cwTotalM -= bStud.height / 1000 // для kind='wall' длина материала === высота, без нахлёстов

    // Убираем один кусок раскроя линии B той же длины, что и убранная
    // стойка (kind='wall' высотой ≤3000мм — один кусок; выше 3000мм —
    // несколько кусков "пристенная осн./доп.", убираем самый крупный,
    // остальные куски того же дубля физически всё равно нужны — они
    // относятся к длине материала, а не к числу стоек, оставляем как есть,
    // это консервативный round вниз, не завышающий раскрой).
    const bPieces = psPiecesById.get(c.bId)
    if (bPieces) {
      const idx = bPieces.findIndex(p => p.length === bStud.height)
      if (idx >= 0) bPieces.splice(idx, 1)
    }

    consumedEnds.add(aKey)
    consumedEnds.add(bKey)
    cornerNodesCount++
  }

  const allPsPieces: Piece[] = []
  for (const pieces of psPiecesById.values()) allPsPieces.push(...pieces)
  const studCutList = buildCutList(allPsPieces)

  return {
    perLine,
    cornerNodesCount,
    studsCountRaw,
    studsCount,
    cwTotalMRaw,
    cwTotalM,
    studCutList,
  }
}
