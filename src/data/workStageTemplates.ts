/**
 * workStageTemplates.ts — стартовая библиотека шаблонов последовательности
 * этапов (см. core/workProgress.ts, applyTemplate). Это ЗАГОТОВКИ для
 * удобства — пользователь применяет шаблон к линии, дальше редактирует
 * список свободно (каждая линия своя копия, см. types/index.ts WorkProgress).
 * Список пополняется по ходу практики через "Сохранить как шаблон" в UI —
 * этот файл — только начальный набор, не жёсткий справочник.
 */

import type { WorkStageTemplate, WorkStageTemplateStep } from '../types'

type StepTag = Partial<Pick<WorkStageTemplateStep, 'meaning3D' | 'materialKind' | 'materialThicknessMm' | 'materialLayers'>>

/**
 * Собирает список шагов шаблона из подписей + необязательных тегов по label
 * (meaning3D для 3D-визуализации ГКЛ-каркаса, materialKind/thicknessMm/layers
 * для сметы материалов отделки — см. types/index.ts и data/workMaterialCatalog.ts).
 * Ключ по label, не по индексу — читаемее; если одна подпись встречается в
 * списке несколько раз (например "Грунтовка" трижды в wall_paint — до/между/
 * после штукатурки и шпаклёвки), все повторы получают ОДИН И ТОТ ЖЕ тег, что
 * и корректно (это один и тот же вид материала независимо от места в списке).
 */
function steps(labels: string[], tags: Record<string, StepTag> = {}): WorkStageTemplate['steps'] {
  return labels.map((label, i) => ({ id: `s${i + 1}`, label, ...tags[label] }))
}

export const BUILTIN_WORK_STAGE_TEMPLATES: WorkStageTemplate[] = [
  {
    id: 'wall_paint',
    label: 'Существующая стена — под покраску/обои',
    steps: steps(
      ['Грунтовка', 'Штукатурка', 'Грунтовка', 'Шпаклёвка', 'Грунтовка', 'Покраска/обои'],
      {
        'Грунтовка': { materialKind: 'priming' },
        'Штукатурка': { materialKind: 'plaster_gypsum', materialThicknessMm: 15 },
        'Шпаклёвка': { materialKind: 'putty' },
        'Покраска/обои': { materialKind: 'paint' },
      },
    ),
  },
  {
    id: 'wall_tile',
    label: 'Существующая стена — под плитку (санузел)',
    steps: steps(
      ['Грунтовка', 'Штукатурка цементная', 'Грунтовка', 'Плитка', 'Затирка'],
      {
        'Грунтовка': { materialKind: 'priming' },
        'Штукатурка цементная': { materialKind: 'plaster_cement', materialThicknessMm: 15 },
        // Плитка/Затирка — без materialKind: расход зависит от размера плитки и
        // раскладки, это уже считает TileCalc.tsx, дублировать нельзя (см. шапку
        // data/workMaterialCatalog.ts).
      },
    ),
  },
  {
    id: 'gkl_partition',
    label: 'Перегородка ГКЛ',
    steps: steps(
      ['Разметка', 'Каркас', 'Зашивка стороны 1', 'Минвата', 'Зашивка стороны 2', 'Готово'],
      {
        // Без materialKind — материал (профиль/листы/крепёж/минвата) уже точно
        // считается calcSheetLayout.ts/buildPositions.ts, не этим справочником.
        'Каркас': { meaning3D: 'frame' },
        'Зашивка стороны 1': { meaning3D: 'sheet_a' },
        'Зашивка стороны 2': { meaning3D: 'sheet_b' },
      },
    ),
  },
  {
    id: 'floor_screed_tile',
    label: 'Пол — стяжка + плитка',
    steps: steps(
      ['Гидроизоляция', 'Стяжка', 'Грунтовка', 'Плитка', 'Затирка'],
      {
        'Гидроизоляция': { materialKind: 'waterproofing' },
        'Стяжка': { materialKind: 'screed', materialThicknessMm: 50 },
        'Грунтовка': { materialKind: 'priming' },
      },
    ),
  },
  {
    id: 'floor_selfleveling',
    label: 'Пол — наливной под ламинат/паркет',
    steps: steps(
      ['Гидроизоляция', 'Стяжка', 'Наливной пол', 'Ламинат/паркет'],
      {
        'Гидроизоляция': { materialKind: 'waterproofing' },
        'Стяжка': { materialKind: 'screed', materialThicknessMm: 50 },
        'Наливной пол': { materialKind: 'self_leveling', materialThicknessMm: 5 },
        'Ламинат/паркет': { materialKind: 'flooring_laminate' },
      },
    ),
  },
]

export function findBuiltinTemplate(id: string): WorkStageTemplate | undefined {
  return BUILTIN_WORK_STAGE_TEMPLATES.find(t => t.id === id)
}
