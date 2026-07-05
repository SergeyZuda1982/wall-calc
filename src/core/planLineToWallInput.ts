/**
 * planLineToWallInput.ts — Слой 5а: переводчик линии плана (wall_new) в
 * WallInput для полного расчёта перегородки (профиль/крепёж/раскрой через
 * существующий calcResults.ts).
 *
 * В отличие от planLineToSurfaceInput (который считает только раскрой листов
 * и не зависит от системы каркаса), этот переводчик ДОЛЖЕН резолвить
 * profileType из spec.subtype — здесь профиль напрямую определяет количество
 * направляющих/стоек и допустимую высоту.
 *
 * Резолв wallType: 'c111' (1 слой обшивки) / 'c112' (2 слоя) — по
 * spec.layers, совпадает с тем, как это выведено в App.tsx (форма
 * standalone-калькулятора): gklLayers = wallType==='c112' ? 2 : 1.
 *
 * Резолв profileType: дерево материалов wall_new (constructionTaxonomy.ts)
 * содержит одинарные подтипы ГКЛ-каркаса (ps50/ps75/ps100/ps125/double) и,
 * с сессии 04.07.2026, подтипы двойного каркаса (c115_1_ps50 ... c116_ps100,
 * см. parseDoubleFrameSubtype в constructionTaxonomy.ts) — но калькулятор
 * (ProfileType/WallInput) поддерживает только одинарный каркас с одной парой
 * layer1/layer2 на всю стену. ps125, double и ВСЕ подтипы двойного каркаса —
 * известный пробел (сама механика расчёта для двух рядов стоек ещё не
 * реализована, см. КОНСПЕКТ.md), эти линии возвращают null, пока не появится
 * отдельный переводчик/WallInput для двойного каркаса.
 *
 * Резолв abutment: WallInput.abutment влияет на крайние стойки (торец в
 * торец без нахлёста у стены vs нахлёст на свободном конце) — та же логика,
 * что editKind в LiningCalc.tsx. Источник — attachmentResolver.ts (уже
 * есть в проекте для крепежа примыкания): есть примыкание любого типа на
 * конце линии → это "стена" для abutment, независимо от материала соседа.
 */

import type { PlanLine, WallInput, WallType, ProfileType, Opening, AbutmentType } from '../types'
import { DEFAULT_BOARD_SPEC } from '../types'
import type { LineAttachments } from './attachmentResolver'

const DEFAULT_STEP_MM = 600            // совпадает с дефолтом drawStep в FloorPlan.tsx
const DEFAULT_PROFILE_THICKNESS = '06' // не влияет на BOM, только на предупреждение о высоте

/** wallType по числу слоёв обшивки. */
export function resolveWallType(layers: 1 | 2 | undefined): WallType {
  return layers === 2 ? 'c112' : 'c111'
}

/**
 * profileType по subtype дерева материалов wall_new:gkl.
 * ps50/ps75/ps100 — прямой проброс. ps125/double и все подтипы двойного
 * каркаса (c115_1..c115_3, c116) — не поддержаны калькулятором (нет ProfileType/
 * данных по раскрою для двух рядов стоек), null.
 */
export function resolveWallProfileType(subtype: string | undefined): ProfileType | null {
  if (subtype === 'ps50' || subtype === 'ps75' || subtype === 'ps100') return subtype
  return null
}

/**
 * abutment по факту примыкания концов линии (любой материал соседа).
 * Без attachments (не передано / оба конца свободны) — 'none'.
 */
export function resolveAbutment(attachments: LineAttachments | undefined): AbutmentType {
  const hasStart = !!attachments?.start
  const hasEnd = !!attachments?.end
  if (hasStart && hasEnd) return 'both'
  if (hasStart) return 'left'
  if (hasEnd) return 'right'
  return 'none'
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
 * Переводит одну линию плана (wall_new, материал gkl) в WallInput.
 * null для: любого другого типа линии, кладки (brick/gasblock/foamblock —
 * калькулятор каркаса их не считает), нулевой длины, неподдержанного
 * профиля (ps125/double — см. resolveWallProfileType).
 */
export function planLineToWallInput(line: PlanLine, attachments?: LineAttachments): WallInput | null {
  if (line.type !== 'wall_new') return null
  if (line.spec?.material !== 'gkl') return null
  if (line.lengthMm <= 0) return null

  const profileType = resolveWallProfileType(line.spec.subtype)
  if (!profileType) return null

  const step = line.spec.step ?? DEFAULT_STEP_MM

  return {
    wallType: resolveWallType(line.spec.layers),
    profileType,
    profileThickness: line.spec.profileThickness ?? DEFAULT_PROFILE_THICKNESS,
    abutment: resolveAbutment(attachments),
    length: line.lengthMm,
    height: line.heightMm ?? 3000,
    step,
    firstStud: step, // калька: позиции стоек на линии плана не хранятся (как в planLineToSurfaceInput)
    openings: mapOpenings(line),
    layer1: line.spec.layer1 ?? DEFAULT_BOARD_SPEC,
    layer2: line.spec.layer2 ?? DEFAULT_BOARD_SPEC,
    plywoodInserts: [],
  }
}

/** Батч-версия: переводит все линии плана, отбрасывая неприменимые (null). Порядок сохраняется. */
export function planLinesToWallInputs(
  lines: PlanLine[],
  attachmentsMap?: Map<string, LineAttachments>,
): { line: PlanLine; input: WallInput }[] {
  const out: { line: PlanLine; input: WallInput }[] = []
  for (const l of lines) {
    const input = planLineToWallInput(l, attachmentsMap?.get(l.id))
    if (input) out.push({ line: l, input })
  }
  return out
}

