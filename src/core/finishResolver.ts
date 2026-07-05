/**
 * finishResolver.ts — стадийная отделка поверхности линии плана.
 *
 * НЕ путать с WorkStatus (тот — построена ли САМА конструкция) и с
 * attachmentResolver (тот — к чему конструкция примыкает БОКОМ). Этот
 * модуль — что сделано с ЛИЦЕВОЙ ПОВЕРХНОСТЬЮ уже построенной стены/
 * облицовки, по каждой стороне отдельно (кладка может быть оштукатурена
 * с одной стороны и голая с другой; перегородку могли обшить только
 * с одной стороны).
 *
 * Пока НЕ затрагивает пол/потолок (стяжка/плитка/угол раскладки) —
 * там неоднозначно, к чему привязывать состояние: к Room (авто-периметр)
 * или к Slab (произвольная плита-"карандаш"), обе сущности сейчас
 * существуют параллельно. Решение отложено до отдельного разговора.
 */

import type { PlanLine, FinishBaseStage } from '../types'

export type FinishMaterialCategory = 'masonry' | 'gkl'

const MASONRY_MATERIALS = new Set(['brick', 'gasblock', 'foamblock', 'block', 'concrete'])

/**
 * Определяет категорию отделки линии: 'masonry' (кладка/монолит — штукатурка/
 * шпаклёвка/покраска или плитка), 'gkl' (каркас — обшивка/шпаклёвка/покраска
 * или плитка), либо null — стадийная отделка НЕ применима:
 *  - wall_lining материалом tile/plaster/etc — линия УЖЕ есть само покрытие,
 *    отдельного слоя отделки поверх нет
 *  - ceiling/floor/rib_beam — вне скоупа этой модели (см. шапку файла)
 */
export function finishMaterialCategoryOf(line: PlanLine): FinishMaterialCategory | null {
  const material = line.spec?.material
  if (line.type === 'wall_existing') return 'masonry'
  if (line.type === 'wall_new') {
    if (material === 'gkl') return 'gkl'
    if (material && MASONRY_MATERIALS.has(material)) return 'masonry'
    return null
  }
  if (line.type === 'wall_lining') {
    return material === 'gkl' ? 'gkl' : null
  }
  return null
}

/**
 * Сколько сторон у линии можно отделывать независимо.
 * wall_new/wall_existing — двусторонние конструкции (2).
 * wall_lining — облицовка физически односторонняя (1), "другая сторона"
 * — это уже другая линия (основа, к которой она примыкает).
 * Для линий вне finishMaterialCategoryOf (null) возвращает 0.
 */
export function finishSidesOf(line: PlanLine): 0 | 1 | 2 {
  if (!finishMaterialCategoryOf(line)) return 0
  return line.type === 'wall_lining' ? 1 : 2
}

const STAGE_ORDER: FinishBaseStage[] = ['naked', 'base_done', 'puttied']

export function nextBaseStage(stage: FinishBaseStage): FinishBaseStage | null {
  const i = STAGE_ORDER.indexOf(stage)
  return i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null
}

export function prevBaseStage(stage: FinishBaseStage): FinishBaseStage | null {
  const i = STAGE_ORDER.indexOf(stage)
  return i > 0 ? STAGE_ORDER[i - 1] : null
}

/** Подписи стадий — зависят от категории материала (штукатурка vs обшивка). */
export function finishBaseStageLabel(stage: FinishBaseStage, category: FinishMaterialCategory): string {
  if (category === 'gkl') {
    return { naked: 'Голый каркас', base_done: 'Обшито', puttied: 'Шпаклёвка выполнена' }[stage]
  }
  return { naked: 'Голая кладка', base_done: 'Оштукатурено', puttied: 'Шпаклёвка выполнена' }[stage]
}

export const FINISH_COVERING_LABEL: Record<string, string> = {
  paint: 'Покраска',
  tile: 'Плитка',
}
