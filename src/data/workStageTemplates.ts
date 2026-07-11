/**
 * workStageTemplates.ts — стартовая библиотека шаблонов последовательности
 * этапов (см. core/workProgress.ts, applyTemplate). Это ЗАГОТОВКИ для
 * удобства — пользователь применяет шаблон к линии, дальше редактирует
 * список свободно (каждая линия своя копия, см. types/index.ts WorkProgress).
 * Список пополняется по ходу практики через "Сохранить как шаблон" в UI —
 * этот файл — только начальный набор, не жёсткий справочник.
 */

import type { WorkStageTemplate, WorkStepMeaning3D } from '../types'

function steps(labels: string[]): WorkStageTemplate['steps'] {
  return labels.map((label, i) => ({ id: `s${i + 1}`, label }))
}

/** Та же steps(), но с тегами meaning3D для конкретных шагов (см. WorkStepMeaning3D) —
 *  labelToMeaning ключ по label (проще читать здесь, чем по индексу). */
function stepsWithMeaning3D(labels: string[], labelToMeaning: Record<string, WorkStepMeaning3D>): WorkStageTemplate['steps'] {
  return labels.map((label, i) => ({ id: `s${i + 1}`, label, meaning3D: labelToMeaning[label] }))
}

export const BUILTIN_WORK_STAGE_TEMPLATES: WorkStageTemplate[] = [
  {
    id: 'wall_paint',
    label: 'Существующая стена — под покраску/обои',
    steps: steps(['Грунтовка', 'Штукатурка', 'Грунтовка', 'Шпаклёвка', 'Грунтовка', 'Покраска/обои']),
  },
  {
    id: 'wall_tile',
    label: 'Существующая стена — под плитку (санузел)',
    steps: steps(['Грунтовка', 'Штукатурка цементная', 'Грунтовка', 'Плитка', 'Затирка']),
  },
  {
    id: 'gkl_partition',
    label: 'Перегородка ГКЛ',
    steps: stepsWithMeaning3D(
      ['Разметка', 'Каркас', 'Зашивка стороны 1', 'Минвата', 'Зашивка стороны 2', 'Готово'],
      { 'Каркас': 'frame', 'Зашивка стороны 1': 'sheet_a', 'Зашивка стороны 2': 'sheet_b' },
    ),
  },
  {
    id: 'floor_screed_tile',
    label: 'Пол — стяжка + плитка',
    steps: steps(['Гидроизоляция', 'Стяжка', 'Грунтовка', 'Плитка', 'Затирка']),
  },
  {
    id: 'floor_selfleveling',
    label: 'Пол — наливной под ламинат/паркет',
    steps: steps(['Гидроизоляция', 'Стяжка', 'Наливной пол', 'Ламинат/паркет']),
  },
]

export function findBuiltinTemplate(id: string): WorkStageTemplate | undefined {
  return BUILTIN_WORK_STAGE_TEMPLATES.find(t => t.id === id)
}
