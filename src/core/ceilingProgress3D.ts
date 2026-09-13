/**
 * ceilingProgress3D.ts — мост между общим резолвером core/workProgress.ts и
 * `Room.ceilingProgress`: виден ли каркас/обшивка подвесного потолка в 3D.
 * Ровно тот же принцип, что и core/lineProgress.ts у стен (isLineBuiltForRender/
 * wallGklVisual3D) — 13.09.2026, Этап 3 темы "реалистичные материалы в 3D"
 * (см. TASKS.md, ждал починки бага с углами/примыканиями стен, подтверждено
 * пользователем как решённое на практике). Отдельный файл, не лезем в
 * lineProgress.ts — там докстринг файла явно про PlanLine, а тут вход не
 * линия, а `Room.ceilingProgress` (WorkProgress | undefined).
 *
 * Ключевое отличие от стены: у стены ДВЕ стороны (sheet_a/sheet_b), у
 * подвесного потолка обшивка ОДНА (снизу) — используем только meaning3D
 * 'sheet_a', 'sheet_b' у потолка просто никогда не имеет смысла тегировать
 * (см. data/workStageTemplates.ts, ceiling_gkl).
 *
 * Как и у стены: buildProgress/ceilingProgress НЕ задан → ведёт себя ТОЧНО
 * как раньше (каркас+обшивка всегда видны, "как по проекту") — старые
 * комнаты, сохранённые до этой фичи, не должны внезапно менять вид в 3D.
 */

import type { WorkProgress } from '../types'
import { hasAnyConfirmedStep, hasConfirmedStepWithMeaning } from './workProgress'

/**
 * Виден ли ВЕСЬ каркас подвесного потолка комнаты в 3D (сетка профилей,
 * подвесы, крабы — вся геометрия CeilingGridMesh целиком, не только
 * обшивка). ceilingProgress не задан/без шагов → true (обратная
 * совместимость — потолок виден "как по проекту", прогресс не отслеживается).
 * Задан, но ни один шаг ещё не подтверждён → false (осознанно скрыто, тот
 * же принцип, что и isLineBuiltForRender у mutable-стен).
 */
export function isCeilingBuiltForRender(ceilingProgress: WorkProgress | undefined): boolean {
  if (!ceilingProgress || ceilingProgress.steps.length === 0) return true
  return hasAnyConfirmedStep(ceilingProgress)
}

export interface CeilingGklVisual3D {
  showGkl: boolean
}

/**
 * Зашита ли обшивка ГКЛ подвесного потолка (см. CeilingGridMesh.showGkl).
 * ceilingProgress не задан → true (финальный вид "как по проекту", тот же
 * принцип, что и wallGklVisual3D для стен). Задан — обшивка видна, только
 * если подтверждён шаг с meaning3D:'sheet_a' (честный прогресс, не "как по
 * проекту"); если ни один шаг нигде не помечен — обшивка скрыта (пользователь
 * сознательно не захотел тегировать, это ок — тот же выбор, что у стены).
 */
export function ceilingGklVisual3D(ceilingProgress: WorkProgress | undefined): CeilingGklVisual3D {
  if (!ceilingProgress || ceilingProgress.steps.length === 0) return { showGkl: true }
  return { showGkl: hasConfirmedStepWithMeaning(ceilingProgress, 'sheet_a') }
}
