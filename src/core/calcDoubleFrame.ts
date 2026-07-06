/**
 * calcDoubleFrame.ts — механика расчёта двойного каркаса С115.1/.2/.3, С116.
 *
 * Архитектурная основа (см. КОНСПЕКТ.md, сессия 04.07.2026, подтверждено
 * пользователем на реальном объекте): это НЕ один каркас с общим `layers`,
 * а ДВА НЕЗАВИСИМЫХ ряда стоек — свой ПН/ПС с каждой стороны. Стойки в
 * обоих рядах строго параллельны, профиль одинаковый с двух сторон
 * (не бывает асимметрии ПС50+ПС75) — значит оба ряда используют ОДНУ и ту
 * же сетку позиций стоек (buildPositions вызывается один раз).
 *
 * Каждый ряд считается как отдельная одинарная стена (переиспользуем
 * calcResults целиком — PN/PS раскрой, крепёж, уплотнительную ленту), но
 * с обшивкой ТОЛЬКО с внешней стороны (`sides=1`): вторая сторона каждого
 * ряда обращена в зазор между каркасами и сама по себе ничем не обшита.
 *
 * Различия между подтипами — только в обшивке/зазоре, не в каркасе:
 *   С115.1 — 2+2 слоя, зазор пустой (без разделителя)
 *   С115.2 — 2+2 слоя + лист-разделитель посередине зазора
 *   С115.3 — 2+3 слоя (асимметрично), зазор пустой
 *   С116   — 2+2 слоя, как С115.1, но увеличенный зазор под коммуникации
 *
 * ⚠️ Известное упрощение (С115.3): существующий CalcResult/ScrewResult
 * поддерживают максимум 2 слоя обшивки на сторону (layer1/layer2 везде
 * по проекту). Третий слой стороны B считается ОТДЕЛЬНО, упрощённо —
 * только площадь листа + количество и тип самореза (TN/MN/XTN) по высоте
 * стоек, без интеграции в общий ScrewResult/CutList третьего слоя
 * (нахлёсты LN11 не задваиваются — они уже учтены расчётом стороны B
 * для первых двух слоёв, дальше геометрия стойки та же).
 */

import type {
  DoubleFrameType, ProfileType, AbutmentType, Opening,
  EdgeProfile, BoardSpec, CalcResult, PlywoodInsert,
} from '../types'
import { buildPositions } from './buildPositions'
import { calcResults } from './calcResults'
import { calcScrews } from './calcScrews'
import { integrateHeight } from './profileGeometry'
import { getDoubleFrameLayerCounts, getDoubleFrameThicknessMm } from '../data/constructionTaxonomy'
import { calcDoubleFrameTapeStrips } from './calcSealingTape'

export interface DoubleFrameInput {
  dfType: DoubleFrameType
  profileType: ProfileType
  abutment: AbutmentType | string
  length: number
  height: number
  step: number
  firstStud: number
  openings: Opening[]
  overlap: number
  /** Плоская стена, если не заданы (см. calcResults) */
  ceilingProfile?: EdgeProfile
  floorProfile?: EdgeProfile
  layerA1: BoardSpec
  layerA2: BoardSpec
  layerB1: BoardSpec
  layerB2: BoardSpec
  /** Только для С115.3 — третий слой стороны B (толще обшивка) */
  layerB3?: BoardSpec
  /** Только для С116 — зазор под коммуникации, влияет на толщину D */
  gapMm?: number
  plywoodInsertsA?: PlywoodInsert[]
  plywoodInsertsB?: PlywoodInsert[]
}

export interface DoubleFrameResult {
  dfType: DoubleFrameType
  /** Ряд стоек А — полноценный CalcResult, как для одинарной стены */
  frameA: CalcResult
  /** Ряд стоек Б — полноценный CalcResult (для С115.3 содержит только первые 2 слоя) */
  frameB: CalcResult
  /** Толщина перегородки D, мм (формула, см. constructionTaxonomy.ts) */
  thicknessMm: number
  /** Площадь листа-разделителя в зазоре, м² — только С115.2, иначе 0 */
  separatorAreaM2: number
  /** Кол-во штучных отрезков ленты L=200мм между стойками — только там, где нет разделителя */
  tapeStrips: number
  /** Суммарная уплотнительная лента, м.п. (оба ряда) */
  sealingTapeLm: number
  /** Площадь третьего слоя стороны B, м² — только С115.3, иначе 0 */
  extraLayerAreaM2: number
  /** Саморезы третьего слоя — только С115.3, иначе null */
  extraLayerScrews: { code: 'TN' | 'MN' | 'XTN'; count: number } | null
}

export function calcDoubleFrame(input: DoubleFrameInput): DoubleFrameResult {
  const {
    dfType, abutment,
    length: l, height: h, step, firstStud, openings, overlap,
    layerA1, layerA2, layerB1, layerB2, layerB3,
    plywoodInsertsA = [], plywoodInsertsB = [],
  } = input

  const ceilingProfile: EdgeProfile = input.ceilingProfile ?? [{ x: 0, y: h }, { x: l, y: h }]
  const floorProfile: EdgeProfile = input.floorProfile ?? [{ x: 0, y: 0 }, { x: l, y: 0 }]

  // Одна и та же сетка стоек для обоих рядов — профиль одинаковый
  // с обеих сторон, ряды строго параллельны (подтверждено пользователем).
  const { positions } = buildPositions(l, step, firstStud, openings)

  const { sideA, sideB, hasSeparator } = getDoubleFrameLayerCounts(dfType)

  const frameA = calcResults(
    positions, ceilingProfile, floorProfile, l, openings, abutment, overlap,
    Math.min(sideA, 2) as 1 | 2, layerA1, layerA2, plywoodInsertsA, 1,
  )
  const frameB = calcResults(
    positions, ceilingProfile, floorProfile, l, openings, abutment, overlap,
    Math.min(sideB, 2) as 1 | 2, layerB1, layerB2, plywoodInsertsB, 1,
  )

  const openingsArea = openings.filter(o => o.width > 0).reduce((s, o) => s + o.width * o.height, 0)
  const wallArea = integrateHeight(ceilingProfile, floorProfile, 0, l)
  const netAreaM2 = (wallArea - openingsArea) / 1_000_000

  // ─── Лист-разделитель в зазоре (только С115.2) ──────────────────────────
  const separatorAreaM2 = hasSeparator ? netAreaM2 : 0

  // ─── Штучные отрезки ленты между стойками (там, где нет разделителя) ───
  const tapeStrips = hasSeparator ? 0 : calcDoubleFrameTapeStrips(l, step)

  // ─── Третий слой стороны B (только С115.3) ──────────────────────────────
  let extraLayerAreaM2 = 0
  let extraLayerScrews: DoubleFrameResult['extraLayerScrews'] = null
  if (sideB > 2 && layerB3) {
    extraLayerAreaM2 = netAreaM2
    const extra = calcScrews(frameB.studInfos, openings, layerB3, layerB3, 1, 1, overlap, [], positions)
    extraLayerScrews = { code: extra.code25, count: extra.count25 }
  }

  return {
    dfType,
    frameA,
    frameB,
    thicknessMm: getDoubleFrameThicknessMm(dfType, input.profileType, input.gapMm),
    separatorAreaM2,
    tapeStrips,
    sealingTapeLm: frameA.sealingTapeLm + frameB.sealingTapeLm,
    extraLayerAreaM2,
    extraLayerScrews,
  }
}
