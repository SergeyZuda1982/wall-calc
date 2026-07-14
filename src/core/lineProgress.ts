/**
 * lineProgress.ts — мост между общим резолвером core/workProgress.ts и
 * конкретно PlanLine: что показывать как индикатор статуса (2D-дот) и
 * видна ли конструкция в 3D, с учётом ОБРАТНОЙ СОВМЕСТИМОСТИ.
 *
 * Ключевое решение: buildProgress не задан (undefined) → линия ведёт
 * себя ТОЧНО как раньше (всегда видна, дот синий/planned) — старые
 * планы, нарисованные до этой фичи, не должны внезапно пропасть из 3D.
 * Скрытие в 3D происходит ТОЛЬКО когда пользователь явно завёл
 * buildProgress с шагами и ни один ещё не подтверждён — то есть это
 * осознанный выбор "включить отслеживание", а не побочный эффект.
 */

import type { PlanLine, WorkProgress } from '../types'
import { isComplete, isBlocked, hasAnyConfirmedStep, hasConfirmedStepWithMeaning, currentStep, progressPercent } from './workProgress'
import { finishMaterialCategoryOf } from './finishResolver'

export type LineProgressStatus = 'legacy' | 'not_started' | 'blocked' | 'in_progress' | 'complete'

const STATUS_COLOR: Record<LineProgressStatus, string> = {
  legacy:      '#1e88e5', // как старое 'planned' — прогресс не настроен, ведём себя как раньше
  not_started: '#1e88e5',
  blocked:     '#e53935',
  in_progress: '#fb8c00',
  complete:    '#43a047',
}

export const LINE_PROGRESS_STATUS_LABEL: Record<LineProgressStatus, string> = {
  legacy:      'Прогресс не настроен',
  not_started: 'Не начато',
  blocked:     'Остановлено',
  in_progress: 'В работе',
  complete:    'Готово',
}

export function lineProgressStatus(progress: WorkProgress | undefined): LineProgressStatus {
  if (!progress || progress.steps.length === 0) return 'legacy'
  if (isComplete(progress)) return 'complete'
  if (isBlocked(progress)) return 'blocked'
  if (hasAnyConfirmedStep(progress)) return 'in_progress'
  return 'not_started'
}

export function lineProgressColor(progress: WorkProgress | undefined): string {
  return STATUS_COLOR[lineProgressStatus(progress)]
}

/**
 * Видна ли конструкция в 3D. legacy (не настроено) и capital — всегда true
 * (обратная совместимость + периметр/колонны стоят по определению).
 * Для mutable с явно заведённым buildProgress — false, пока не подтверждён
 * хотя бы один шаг (см. шапку файла).
 */
export function isLineBuiltForRender(line: PlanLine): boolean {
  if ((line.category ?? 'mutable') === 'capital') return true
  if (!line.buildProgress || line.buildProgress.steps.length === 0) return true // legacy — обратная совместимость
  return hasAnyConfirmedStep(line.buildProgress)
}

/** Короткая подпись для инспектора/списка: "В работе · 40%" и т.п. */
export function lineProgressSummary(progress: WorkProgress | undefined): string {
  const status = lineProgressStatus(progress)
  if (status === 'legacy') return LINE_PROGRESS_STATUS_LABEL.legacy
  const pct = progressPercent(progress!)
  const step = currentStep(progress!)
  const stepPart = step ? ` — ${step.label}` : ''
  return `${LINE_PROGRESS_STATUS_LABEL[status]}${stepPart} · ${pct}%`
}

/**
 * Визуальное состояние ГКЛ-каркаса для 3D (Этап 2 "реалистичные материалы",
 * 10-11.07.2026, см. обсуждение с пользователем в KONSPEKT.md). Применимо
 * ТОЛЬКО к линиям с finishMaterialCategoryOf(line) === 'gkl' (wall_new/
 * wall_lining материалом gkl) — для кладки/бетона/прочего возвращает null,
 * там остаётся обычный вид (текстура материала), эта функция не участвует.
 *
 * 13.07.2026: раньше каркас показывался ТОЛЬКО если пользователь явно
 * настроил отслеживание хода работ (buildProgress) — иначе, даже с полностью
 * заданными размерами/шагом, рисовалась просто сплошная коробка ("legacy"
 * режим). По аналогии с потолками (П112/П113 — там точная геометрия каркаса
 * всегда видна по спецификации, без привязки к прогрессу стройки) этот гейт
 * снят: каркас виден ВСЕГДА, как только материал — гипсокартон, независимо
 * от buildProgress. Само поле mode убрано за ненадобностью (раньше
 * различало legacy/frame, других значений теперь не бывает).
 *
 * sheetA/sheetB — обшита ли соответствующая сторона:
 * - buildProgress НЕ настроен (обычный случай — только смета, без
 *   отслеживания стройки) — обе стороны true, показываем финальный вид "как
 *   по проекту" (та же логика, что и у потолка — там ГКЛ тоже виден всегда,
 *   вне зависимости от прогресса, потому что прогресса там просто нет).
 * - buildProgress настроен — прежнее поведение БЕЗ ИЗМЕНЕНИЙ: обшита, если
 *   подтверждён шаг с meaning3D:'sheet_a'/'sheet_b' в любом месте списка
 *   шагов; если ни один шаг нигде не помечен meaning3D — обе стороны голый
 *   каркас (пользователь сознательно не захотел настраивать теги, это ок).
 *   Это сохраняет ценность прогресс-трекинга — раз пользователь его завёл,
 *   3D должен честно показывать, что реально уже зашито, а не "как по плану".
 */
export interface WallGklVisual3D {
  sheetA: boolean
  sheetB: boolean
}

export function wallGklVisual3D(line: PlanLine): WallGklVisual3D | null {
  if (finishMaterialCategoryOf(line) !== 'gkl') return null
  if (!line.buildProgress || line.buildProgress.steps.length === 0) {
    return { sheetA: true, sheetB: true }
  }
  return {
    sheetA: hasConfirmedStepWithMeaning(line.buildProgress, 'sheet_a'),
    sheetB: hasConfirmedStepWithMeaning(line.buildProgress, 'sheet_b'),
  }
}
