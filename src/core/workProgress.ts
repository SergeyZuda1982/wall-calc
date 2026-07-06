/**
 * workProgress.ts — резолвер гибкой модели этапов работ (см. types/index.ts,
 * WorkProgress/WorkStageTemplate). Заменяет собой смысл старых WorkStatus/
 * FinishBaseStage: каждая поверхность (сторона линии, пол, потолок...)
 * получает свой список этапов — либо "проштампованный" из шаблона, либо
 * набранный с нуля вручную — и дальше живёт независимо от шаблона.
 *
 * Ничего не знает про геометрию/3D/UI — чистые функции над WorkProgress.
 */

import type {
  WorkProgress,
  WorkStageTemplate,
  WorkStageTemplateStep,
  StepProgress,
  StepOutcome,
  StepRejectReason,
} from '../types'

/** Создаёт новый WorkProgress "с нуля" из произвольного списка шагов (свой список на линии) */
export function createWorkProgress(steps: WorkStageTemplateStep[]): WorkProgress {
  return {
    steps: steps.map(s => ({ stepId: s.id, label: s.label, outcome: 'pending' as StepOutcome })),
  }
}

/**
 * "Штампует" шаблон в новый WorkProgress — копирует id/label шагов на момент
 * применения. Дальнейшие правки шаблона не влияют на уже применённый прогресс.
 */
export function applyTemplate(template: WorkStageTemplate): WorkProgress {
  return {
    templateId: template.id,
    sourceTemplateLabel: template.label,
    steps: template.steps.map(s => ({ stepId: s.id, label: s.label, outcome: 'pending' as StepOutcome })),
  }
}

/**
 * Строит шаблон ИЗ уже настроенного прогресса конкретной линии ("Сохранить
 * как шаблон") — берёт только id/label шагов, без outcome/причин (шаблон —
 * это чистая заготовка списка, не история работ по конкретному объекту).
 */
export function saveAsTemplate(progress: WorkProgress, templateId: string, label: string): WorkStageTemplate {
  return {
    id: templateId,
    label,
    steps: progress.steps.map(s => ({ id: s.stepId, label: s.label })),
  }
}

/**
 * Индекс первого НЕ подтверждённого шага (pending или rejected) — это и есть
 * "текущий этап", над которым сейчас реально работают. null, если все шаги
 * подтверждены (работа полностью завершена) или шагов нет вообще.
 */
export function currentStepIndex(progress: WorkProgress): number | null {
  const i = progress.steps.findIndex(s => s.outcome !== 'confirmed')
  return i === -1 ? null : i
}

export function currentStep(progress: WorkProgress): StepProgress | null {
  const i = currentStepIndex(progress)
  return i === null ? null : progress.steps[i]
}

/** true, если работа ещё не начата вообще (все шаги pending, ни один не тронут) */
export function isNotStarted(progress: WorkProgress): boolean {
  return progress.steps.length === 0 || progress.steps.every(s => s.outcome === 'pending')
}

/** true, если все шаги подтверждены (работа полностью завершена) */
export function isComplete(progress: WorkProgress): boolean {
  return progress.steps.length > 0 && progress.steps.every(s => s.outcome === 'confirmed')
}

/** true, если текущий шаг отклонён (простой/блок с причиной) */
export function isBlocked(progress: WorkProgress): boolean {
  const s = currentStep(progress)
  return s?.outcome === 'rejected'
}

/**
 * Подтверждает шаг по индексу (ставит зелёную галочку). confirmedAt — ISO-дата
 * (по умолчанию "сейчас"), передаётся явно ради тестируемости.
 */
export function confirmStep(progress: WorkProgress, stepIndex: number, confirmedAt: string = new Date().toISOString()): WorkProgress {
  return {
    ...progress,
    steps: progress.steps.map((s, i) =>
      i === stepIndex ? { ...s, outcome: 'confirmed', rejectReason: undefined, rejectNote: undefined, confirmedAt } : s
    ),
  }
}

/** Отклоняет шаг по индексу (крестик) — обязательна причина */
export function rejectStep(progress: WorkProgress, stepIndex: number, reason: StepRejectReason, note?: string): WorkProgress {
  return {
    ...progress,
    steps: progress.steps.map((s, i) =>
      i === stepIndex ? { ...s, outcome: 'rejected', rejectReason: reason, rejectNote: reason === 'other' ? note : undefined, confirmedAt: undefined } : s
    ),
  }
}

/** Возвращает шаг в состояние "не начато" (отмена подтверждения/отклонения) */
export function resetStep(progress: WorkProgress, stepIndex: number): WorkProgress {
  return {
    ...progress,
    steps: progress.steps.map((s, i) =>
      i === stepIndex ? { stepId: s.stepId, label: s.label, outcome: 'pending' } : s
    ),
  }
}

/** Процент выполнения ОДНОЙ поверхности: доля подтверждённых шагов, 0..100 */
export function progressPercent(progress: WorkProgress): number {
  if (progress.steps.length === 0) return 0
  const confirmed = progress.steps.filter(s => s.outcome === 'confirmed').length
  return Math.round((confirmed / progress.steps.length) * 100)
}

/**
 * Агрегированный процент по НЕСКОЛЬКИМ поверхностям (весь объект, или один
 * тип работ) — среднее по количеству подтверждённых/всего шагов СУММАРНО
 * (не среднее процентов каждой линии — так длинные и короткие списки этапов
 * не искажают вклад друг друга непропорционально числу шагов).
 */
export function aggregateProgressPercent(progresses: WorkProgress[]): number {
  const withSteps = progresses.filter(p => p.steps.length > 0)
  const totalSteps = withSteps.reduce((sum, p) => sum + p.steps.length, 0)
  if (totalSteps === 0) return 0
  const totalConfirmed = withSteps.reduce((sum, p) => sum + p.steps.filter(s => s.outcome === 'confirmed').length, 0)
  return Math.round((totalConfirmed / totalSteps) * 100)
}
