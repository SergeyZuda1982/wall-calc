/**
 * closingVolumesReport.ts — сводка «закрытие объёмов на оплату» (Сергей,
 * 04.09.2026). Автономный отчёт: НЕ требует настроенного двухступенчатого
 * подтверждения (прораб → начальник участка) — считает и показывает объёмы
 * по всем перегородкам/облицовке/колоннам плана независимо от того, ведётся
 * ли на них buildProgress вообще. Если прогресс настроен — показываем
 * статус и даём фильтр «только подтверждённые»; если нет — строка просто
 * помечается как "без отслеживания прогресса" (не блокирует расчёт).
 *
 * Двухступенчатое подтверждение само по себе — НЕ новая сущность: это
 * обычный WorkStageTemplate/WorkProgress из workProgress.ts с двумя шагами
 * ("Выполнено (прораб)" / "Принято (нач. участка)"), при желании гейтится
 * правом markOwnProgress/viewProgress по ролям (permissions.ts). Здесь эта
 * логика не переизобретается — отчёт просто читает line.buildProgress как
 * есть.
 *
 * Колонны: WorkProgress на них пока не заведён (buildProgress есть только
 * у PlanLine) — статус готовности берём из workStatus==='done' (легаси
 * поле, см. types/index.ts). Когда/если понадобится тот же гибкий прогресс
 * на колонны — отдельная небольшая задача (добавить buildProgress? в
 * RoundColumn/RectColumn), сейчас не делаем, чтобы не расширять модель
 * данных без нужды.
 */

import type { PlanLine, RoundColumn, RectColumn, CeilingSlope, Room } from '../types'
import { ceilingProfileForLine, ceilingSlopeHeightAtPoint, buildCeilingSlopeResolver } from './ceilingSlope'
import { areaByPriceTier, columnRunByPriceTier, flatEdgeProfile, sumTierSplits, tierSplitCost, PRICE_TIER_THRESHOLD_MM, type TierSplit } from './laborPriceTiers'
import { progressPercent, isComplete } from './workProgress'

export type ClosingVolumeKind = 'wall_new' | 'wall_lining' | 'round_column' | 'rect_column'

export interface ClosingVolumeRow {
  id: string
  label: string
  kind: ClosingVolumeKind
  tiers: TierSplit
  cost: number
  /** null = прогресс вообще не настроен на этой линии/колонне */
  progressPercent: number | null
  isComplete: boolean
}

export interface ClosingVolumesReportInput {
  lines: PlanLine[]
  roundColumns: RoundColumn[]
  rectColumns: RectColumn[]
  ceilingSlopes: CeilingSlope[]
  rooms: Room[]
  defaultHeightMm: number
  rateBelow: number
  rateAbove: number
  thresholdMm?: number
}

export interface ClosingVolumesReport {
  rows: ClosingVolumeRow[]
  totals: TierSplit
  totalCost: number
}

export function buildClosingVolumesReport(input: ClosingVolumesReportInput): ClosingVolumesReport {
  const T = input.thresholdMm ?? PRICE_TIER_THRESHOLD_MM
  const resolveSlope = buildCeilingSlopeResolver(input.lines, input.ceilingSlopes, input.rooms)
  const rows: ClosingVolumeRow[] = []

  for (const line of input.lines) {
    if (line.type !== 'wall_new' && line.type !== 'wall_lining') continue
    const slope = resolveSlope(line)
    const profile = ceilingProfileForLine(line, slope) ?? flatEdgeProfile(line.lengthMm, line.heightMm ?? input.defaultHeightMm)
    const tiers = areaByPriceTier(profile, T)
    rows.push({
      id: line.id,
      label: line.label,
      kind: line.type,
      tiers,
      cost: tierSplitCost(tiers, input.rateBelow, input.rateAbove),
      progressPercent: line.buildProgress ? progressPercent(line.buildProgress) : null,
      isComplete: line.buildProgress ? isComplete(line.buildProgress) : false,
    })
  }

  for (const col of input.roundColumns) {
    const heightMm = ceilingSlopeHeightAtPoint({ x: col.cx, y: col.cy }, input.lines, input.ceilingSlopes, input.rooms) ?? input.defaultHeightMm
    const tiers = columnRunByPriceTier(heightMm, T)
    rows.push({
      id: col.id, label: col.label, kind: 'round_column', tiers,
      cost: tierSplitCost(tiers, input.rateBelow, input.rateAbove),
      progressPercent: null,
      isComplete: col.workStatus === 'done',
    })
  }

  for (const col of input.rectColumns) {
    const heightMm = ceilingSlopeHeightAtPoint({ x: col.cx, y: col.cy }, input.lines, input.ceilingSlopes, input.rooms) ?? input.defaultHeightMm
    const tiers = columnRunByPriceTier(heightMm, T)
    rows.push({
      id: col.id, label: col.label, kind: 'rect_column', tiers,
      cost: tierSplitCost(tiers, input.rateBelow, input.rateAbove),
      progressPercent: null,
      isComplete: col.workStatus === 'done',
    })
  }

  const totals = sumTierSplits(rows.map(r => r.tiers))
  return { rows, totals, totalCost: tierSplitCost(totals, input.rateBelow, input.rateAbove) }
}
