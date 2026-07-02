/**
 * planLineToSurfaceInput.ts — Слой 4: переводчик линии плана в вход раскроя
 * листов (SurfaceSheetInput, см. calcProjectSheetLayout.ts).
 *
 * ВАЖНО: раскрой листов не зависит от системы каркаса (С623/С625/С626,
 * профиль ПС50/75/100 или ПП60×27) — calcSheetLayout режет полотно ГКЛ
 * по геометрии стены/проёмов и шагу стоек, ему всё равно, чем каркас
 * зашит изнутри. Поэтому этот переводчик НЕ требует резолва liningType/
 * profileType — тот резолв понадобится отдельным переводчиком в сторону
 * профиля/крепежа/подвесов (следующий слой), не сюда.
 *
 * Упрощение (как и в buildSurfaceInputs для облицовки): позиции стоек
 * на плане не хранятся (нет запущенного calcStudMaterial по линии плана),
 * поэтому firstStud = step. Высота — плоская (line.heightMm ?? 3000),
 * без учёта уклонов/ступеней (EdgeProfile ещё не подключён к плану —
 * это отдельная задача "разрез", пункт 3 дорожной карты).
 */

import type { PlanLine, Opening } from '../types'
import type { SurfaceSheetInput } from './calcProjectSheetLayout'
import { DEFAULT_BOARD_SPEC } from '../types'

const DEFAULT_STEP_MM = 600 // совпадает с дефолтом drawStep в FloorPlan.tsx

function mapOpenings(line: PlanLine): Opening[] {
  return (line.openings ?? []).map(o => ({
    id: o.id,
    type: o.type,
    pos: o.offsetMm,
    width: o.widthMm,
    height: o.heightMm,
    sillHeight: o.sillHeightMm ?? 0,
  }))
}

/**
 * Переводит одну линию плана в SurfaceSheetInput.
 * Возвращает null для линий, которые не являются ГКЛ-конструкциями
 * с раскроем листов: wall_existing (существующая стена — ничего не покупаем),
 * кирпич/газоблок/пеноблок (кладка — не ГКЛ), плитка/штукатурка/малярка
 * (не листовой раскрой), ceiling/floor (свой расчёт, calcCeiling.ts).
 */
export function planLineToSurfaceInput(line: PlanLine): SurfaceSheetInput | null {
  if (line.type !== 'wall_new' && line.type !== 'wall_lining') return null
  if (line.spec?.material !== 'gkl') return null
  if (line.lengthMm <= 0) return null

  const sides: 1 | 2 = line.type === 'wall_new' ? 2 : 1
  const gklLayers: 1 | 2 = line.spec.layers ?? 1
  const step = line.spec.step ?? DEFAULT_STEP_MM
  const wallH = line.heightMm ?? 3000

  return {
    id: line.id,
    label: line.label,
    wallL: line.lengthMm,
    wallH,
    firstStud: step,
    step,
    gklLayers,
    openings: mapOpenings(line),
    layer1: line.spec.layer1 ?? DEFAULT_BOARD_SPEC,
    layer2: line.spec.layer2 ?? DEFAULT_BOARD_SPEC,
    sides,
  }
}

/** Батч-версия: переводит все линии плана, отбрасывая неприменимые (null). Порядок сохраняется. */
export function planLinesToSurfaceInputs(lines: PlanLine[]): SurfaceSheetInput[] {
  const out: SurfaceSheetInput[] = []
  for (const l of lines) {
    const input = planLineToSurfaceInput(l)
    if (input) out.push(input)
  }
  return out
}
