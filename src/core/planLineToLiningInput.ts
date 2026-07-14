/**
 * planLineToLiningInput.ts — Слой 5б: переводчик линии плана (wall_lining)
 * в LiningInput для полного расчёта облицовки (профиль/подвесы/крепёж
 * через существующий calcLining.ts).
 *
 * Мэппинг систем облицовки (выяснен с пользователем, сессия 02.07.2026,
 * см. KONSPEKT.md):
 * - spec.subtype === 'frame_pn28' → С623: направляющая ПН/ПС 27×28,
 *   стойка ПП 60×27, прямой подвес всегда + удлинитель при h>3000.
 *   profileType для С623 физически не ПС (это ПП60×27), но поле
 *   LiningInput.profileType всё равно требуется (calcLining.ts использует
 *   его только для overlapMap, который не участвует в расчёте при
 *   liningType==='c623' — studLen() обходит overlap стороной для C623).
 *   Дефолт 'ps75', как в DEFAULT_INPUT (LiningCalc.tsx) — значение не
 *   влияет на итоговые количества.
 * - spec.subtype === 'frame_ps75'/'frame_ps100' + layers===1 → С625
 * - spec.subtype === 'frame_ps50'/'frame_ps75'/'frame_ps100' + layers===2 → С626
 * - spec.subtype === 'frame_ps50' + layers===1 (или не задано) → ВСЁ РАВНО С626,
 *   не С625: по нормам Кнауф однослойной С625 на ПС50 не существует
 *   (подтверждено пользователем 07.07.2026, см. isLiningLayersFixed в
 *   constructionTaxonomy.ts — то же ограничение защищено и в UI: при
 *   выборе «Каркас ПС 50» для облицовки количество слоёв зафиксировано
 *   на 2 и недоступно для изменения).
 * - spec.subtype === 'glued' → С611, расчёта нет (пользователь подтвердил:
 *   клеевой расход никогда не считали на объекте) — null.
 *
 * ⚠️ Известные пробелы (из KONSPEKT.md, не устраняются этим переводчиком):
 * - hangerStep не имеет глобального UI-дефолта на плане (в отличие от step/
 *   heightMm) — только per-line через инспектор, иначе дефолт переводчика.
 *
 * abutment резолвится через attachmentResolver (как и у wall_new) — есть
 * примыкание любого материала на конце линии → это "стена" (нужна боковая
 * направляющая при С623, крайняя стойка без нахлёста).
 */

import type { PlanLine, LiningInput, LiningType, ProfileType, Opening } from '../types'
import { DEFAULT_BOARD_SPEC } from '../types'
import type { LineAttachments } from './attachmentResolver'
import { resolveAbutment } from './planLineToWallInput'

const DEFAULT_STEP_MM = 600
const DEFAULT_HANGER_STEP_MM = 1000    // совпадает с DEFAULT_INPUT.hangerStep в LiningCalc.tsx
const DEFAULT_PROFILE_THICKNESS = '06' // не влияет на BOM, только на предупреждение о высоте
const DEFAULT_C623_PROFILE: ProfileType = 'ps75' // не влияет на BOM при c623, см. комментарий выше

/**
 * liningType по subtype + число слоёв. glued (С611) — null, расчёта нет.
 * Любой другой material (tile/plaster/paint) сюда не доходит — фильтруется
 * раньше в planLineToLiningInput по spec.material !== 'gkl'.
 */
export function resolveLiningType(subtype: string | undefined, layers: 1 | 2 | undefined): LiningType | null {
  if (subtype === 'frame_pn28') return 'c623'
  // ПС50 — только С626 (2 слоя), однослойной С625 на ПС50 по нормам Кнауф не бывает.
  if (subtype === 'frame_ps50') return 'c626'
  if (subtype === 'frame_ps75' || subtype === 'frame_ps100') {
    return layers === 2 ? 'c626' : 'c625'
  }
  return null // glued (С611) — нет калькулятора; неизвестный subtype
}

/**
 * profileType по subtype. С623 (frame_pn28) — физически ПП60×27, но полю
 * нужно валидное значение ProfileType, не влияющее на расчёт (см. выше) —
 * дефолт ps75. frame_ps50/frame_ps75 — прямой проброс.
 */
export function resolveLiningProfileType(subtype: string | undefined): ProfileType | null {
  if (subtype === 'frame_pn28') return DEFAULT_C623_PROFILE
  if (subtype === 'frame_ps50') return 'ps50'
  if (subtype === 'frame_ps75') return 'ps75'
  if (subtype === 'frame_ps100') return 'ps100'
  return null
}

function mapOpenings(line: PlanLine): Opening[] {
  return (line.openings ?? []).map(o => ({
    id: o.id,
    // 'opening' (просто проём, без двери/окна) для расчёта материала считаем как дверь —
    // структурно то же самое: сплошной вырез от пола, требует такого же обрамления
    type: o.type === 'window' ? 'window' : 'door',
    pos: o.offsetMm,
    width: o.widthMm,
    height: o.heightMm,
    sillHeight: o.sillHeightMm ?? 0,
  }))
}

/**
 * Переводит одну линию плана (wall_lining, материал gkl, subtype с рамой)
 * в LiningInput. null для: любого другого типа линии, материалов вне ГКЛ
 * (tile/plaster/paint — не листовая облицовка), способа "на клею" (glued/
 * С611 — расчёта нет), нулевой длины.
 */
export function planLineToLiningInput(line: PlanLine, attachments?: LineAttachments): LiningInput | null {
  if (line.type !== 'wall_lining') return null
  if (line.spec?.material !== 'gkl') return null
  if (line.lengthMm <= 0) return null

  const liningType = resolveLiningType(line.spec.subtype, line.spec.layers)
  const profileType = resolveLiningProfileType(line.spec.subtype)
  if (!liningType || !profileType) return null

  const step = line.spec.step ?? DEFAULT_STEP_MM
  // С626 — всегда 2 слоя, С625 — всегда 1 (это и есть их отличие), С623 —
  // 1 или 2 по факту (per konspekt), берём из spec.layers.
  const gklLayers = liningType === 'c626' ? 2 : liningType === 'c625' ? 1 : (line.spec.layers ?? 1)

  return {
    liningType,
    profileType,
    profileThickness: line.spec.profileThickness ?? DEFAULT_PROFILE_THICKNESS,
    gklLayers,
    length: line.lengthMm,
    height: line.heightMm ?? 3000,
    step,
    hangerStep: line.spec.hangerStep ?? DEFAULT_HANGER_STEP_MM,
    abutment: resolveAbutment(attachments),
    openings: mapOpenings(line),
    communications: [],
    layer1: line.spec.layer1 ?? DEFAULT_BOARD_SPEC,
    layer2: line.spec.layer2 ?? DEFAULT_BOARD_SPEC,
    plywoodInserts: [],
  }
}

/** Батч-версия: переводит все линии плана, отбрасывая неприменимые (null). Порядок сохраняется. */
export function planLinesToLiningInputs(
  lines: PlanLine[],
  attachmentsMap?: Map<string, LineAttachments>,
): { line: PlanLine; input: LiningInput }[] {
  const out: { line: PlanLine; input: LiningInput }[] = []
  for (const l of lines) {
    const input = planLineToLiningInput(l, attachmentsMap?.get(l.id))
    if (input) out.push({ line: l, input })
  }
  return out
}
