/**
 * workStageTemplates.ts — стартовая библиотека шаблонов последовательности
 * этапов (см. core/workProgress.ts, applyTemplate). Это ЗАГОТОВКИ для
 * удобства — пользователь применяет шаблон к линии, дальше редактирует
 * список свободно (каждая линия своя копия, см. types/index.ts WorkProgress).
 * Список пополняется по ходу практики через "Сохранить как шаблон" в UI —
 * этот файл — только начальный набор, не жёсткий справочник.
 */

import type { WorkStageTemplate } from '../types'

function steps(labels: string[]): WorkStageTemplate['steps'] {
  return labels.map((label, i) => ({ id: `s${i + 1}`, label }))
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
    steps: steps(['Разметка', 'Каркас', 'Зашивка стороны 1', 'Минвата', 'Зашивка стороны 2', 'Готово']),
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
