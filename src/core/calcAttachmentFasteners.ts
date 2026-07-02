/**
 * calcAttachmentFasteners.ts — количество крепежа для бокового примыкания
 * (крайняя стойка перегородки/облицовки → соседняя конструкция).
 *
 * Отдельно от calcScrews.ts: там саморезы ГКЛ-полотна в профиль по всей
 * плоскости, здесь — крепёж самого каркаса к соседней стене/блоку/монолиту
 * по высоте на одном конце линии. Разные крепёжные системы, разные детали.
 *
 * Конвенция count = Math.ceil(h / step) без "+1" — сохранена как в
 * screwsByHeight() (calcScrews.ts), чтобы шаг/кол-во считались одинаково
 * везде в проекте.
 */

import type { PlanLine, FastenerSpec } from '../types'
import type { EndAttachment, LineAttachments } from './attachmentResolver'
import { suggestFastener, DEFAULT_FASTENER_STEP_MM } from '../data/fastenerCatalog'

/**
 * Резолвит фактический FastenerSpec для конца линии: ручное переопределение
 * побеждает, иначе — дефолт по материалу. Возвращает null, если примыкания
 * нет (свободный край) или материал 'unknown' без ручного выбора — там
 * нет разумного дефолта, посчитать нечего, пока пользователь не выберет тип.
 */
export function resolveEndFastener(
  info: EndAttachment | null,
  override: FastenerSpec | undefined,
): FastenerSpec | null {
  if (!info) return null
  if (override) return override
  const suggested = suggestFastener(info.material)
  if (!suggested) return null
  return { type: suggested, stepMm: DEFAULT_FASTENER_STEP_MM }
}

/** Кол-во точек крепежа по высоте h с заданным шагом. */
export function fastenerCountByHeight(h: number, stepMm: number): number {
  if (h <= 0 || stepMm <= 0) return 0
  return Math.ceil(h / stepMm)
}

export interface EndFastenerResult {
  spec: FastenerSpec
  qty: number
}

export interface LineFastenerResult {
  start: EndFastenerResult | null
  end: EndFastenerResult | null
}

/**
 * Считает крепёж для одной линии плана по её примыканиям.
 * Высота — l.heightMm ?? 3000 (тот же дефолт, что calcLineArea).
 */
export function calcLineFasteners(
  line: PlanLine,
  attachments: LineAttachments | undefined,
): LineFastenerResult {
  const h = line.heightMm ?? 3000
  const resolveEnd = (info: EndAttachment | null | undefined, override: FastenerSpec | undefined): EndFastenerResult | null => {
    const spec = resolveEndFastener(info ?? null, override)
    if (!spec) return null
    return { spec, qty: fastenerCountByHeight(h, spec.stepMm) }
  }
  return {
    start: resolveEnd(attachments?.start, line.fastenerStart),
    end: resolveEnd(attachments?.end, line.fastenerEnd),
  }
}

/**
 * Агрегирует крепёж по всем линиям проекта в разрезе по типу — сырьё для
 * будущей сметы (переводчика PlanLine -> SurfaceSheetInput). Не привязана
 * к UI, просто Map<FastenerType, qty>.
 */
export function calcProjectFasteners(
  lines: PlanLine[],
  attachmentsByLineId: Map<string, LineAttachments>,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const line of lines) {
    const result = calcLineFasteners(line, attachmentsByLineId.get(line.id))
    for (const end of [result.start, result.end]) {
      if (!end) continue
      totals.set(end.spec.type, (totals.get(end.spec.type) ?? 0) + end.qty)
    }
  }
  return totals
}
