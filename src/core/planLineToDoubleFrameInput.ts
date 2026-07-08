/**
 * planLineToDoubleFrameInput.ts — переводчик линии плана (wall_new, subtype
 * двойного каркаса С115.1/.2/.3 или С116) во вход calcDoubleFrame.ts.
 *
 * Отдельный от planLineToWallInput.ts переводчик: двойной каркас — это два
 * независимых ряда стоек (см. КОНСПЕКТ.md, сессия 04.07.2026), а не один
 * каркас с общим layers/layer1/layer2, поэтому и вход другой (DoubleFrameInput
 * с layerA1/A2/B1/B2/(B3) вместо layer1/layer2 WallInput). resolveAbutment
 * переиспользуется из planLineToWallInput.ts — логика примыкания одинакова
 * для любого каркаса.
 *
 * Резолв dfType/profileType — через parseDoubleFrameSubtype
 * (constructionTaxonomy.ts), единственное место в проекте, где subtype вида
 * 'c115_1_ps50' разбирается на тип двойного каркаса + профиль.
 *
 * null возвращается для: любой другой линии/материала, subtype не двойного
 * каркаса (одинарный ps50/ps75/ps100/ps125/double — им переводчик
 * planLineToWallInput.ts), нулевой длины, отсутствующих слоёв B3 у С115.3
 * (без layerB3 калькулятор не даст третий слой — используется дефолт, см.
 * ниже DEFAULT_BOARD_SPEC).
 */

import type { PlanLine, Opening, AbutmentType } from '../types'
import { DEFAULT_BOARD_SPEC } from '../types'
import type { DoubleFrameInput } from './calcDoubleFrame'
import { parseDoubleFrameSubtype } from '../data/constructionTaxonomy'
import { getProfile } from '../data/profiles'
import { resolveAbutment } from './planLineToWallInput'
import type { LineAttachments } from './attachmentResolver'

const DEFAULT_STEP_MM = 600 // совпадает с дефолтом drawStep в FloorPlan.tsx

function mapOpenings(line: PlanLine): Opening[] {
  return (line.openings ?? []).map(o => ({
    id: o.id,
    type: o.type === 'window' ? 'window' : 'door',
    pos: o.offsetMm,
    width: o.widthMm,
    height: o.heightMm,
    sillHeight: o.sillHeightMm ?? 0,
  }))
}

/**
 * Переводит одну линию плана в DoubleFrameInput.
 * null для: любого другого типа линии, не-ГКЛ материала, subtype не
 * двойного каркаса, нулевой длины.
 */
export function planLineToDoubleFrameInput(
  line: PlanLine,
  attachments?: LineAttachments,
): DoubleFrameInput | null {
  if (line.type !== 'wall_new') return null
  if (line.spec?.material !== 'gkl') return null
  if (line.lengthMm <= 0) return null

  const df = parseDoubleFrameSubtype(line.spec.subtype)
  if (!df) return null

  const step = line.spec.step ?? DEFAULT_STEP_MM
  const abutment: AbutmentType = resolveAbutment(attachments)

  return {
    dfType: df.dfType,
    profileType: df.profile,
    abutment,
    length: line.lengthMm,
    height: line.heightMm ?? 3000,
    step,
    firstStud: step, // калька: позиции стоек на линии плана не хранятся (как в planLineToWallInput)
    openings: mapOpenings(line),
    // Норма нахлёста по Кнауф для профиля (см. knaufOverlap в App.tsx) —
    // точечного переопределения оverlap на линии плана пока нет
    // (как и у planLineToWallInput.ts — WallInput.customOverlap там тоже
    // никем ещё не читается точечно на плане).
    overlap: getProfile(df.profile).overlap,
    layerA1: line.spec.layerA1 ?? DEFAULT_BOARD_SPEC,
    layerA2: line.spec.layerA2 ?? DEFAULT_BOARD_SPEC,
    layerB1: line.spec.layerB1 ?? DEFAULT_BOARD_SPEC,
    layerB2: line.spec.layerB2 ?? DEFAULT_BOARD_SPEC,
    layerB3: df.dfType === 'c115_3' ? (line.spec.layerB3 ?? DEFAULT_BOARD_SPEC) : undefined,
    gapMm: line.spec.gapMm,
  }
}

/** Батч-версия: переводит все линии плана, отбрасывая неприменимые (null). Порядок сохраняется. */
export function planLinesToDoubleFrameInputs(
  lines: PlanLine[],
  attachmentsMap?: Map<string, LineAttachments>,
): { line: PlanLine; input: DoubleFrameInput }[] {
  const out: { line: PlanLine; input: DoubleFrameInput }[] = []
  for (const l of lines) {
    const input = planLineToDoubleFrameInput(l, attachmentsMap?.get(l.id))
    if (input) out.push({ line: l, input })
  }
  return out
}
