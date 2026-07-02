/**
 * Каталог крепежа для боковых примыканий (стойка → соседняя конструкция)
 * и для подвесов потолка (профиль → монолит перекрытия).
 *
 * Источник дефолтов — практика пользователя (не Кнауф-таблицы буквально):
 * Кнауф формально рекомендует дюбель-бабочку для ГКЛ→ГКЛ, но на практике
 * почти всегда крутят саморез по металлу или по дереву — оставлено как
 * отдельный вариант в списке, дефолтом не выбран.
 *
 * Это ТОЛЬКО предложение по умолчанию. Пользователь может переопределить
 * тип и шаг вручную (см. PlanLine.fastenerStart/fastenerEnd) — регионы,
 * бригады и конкретные объекты отличаются, единой таблицы "на все случаи"
 * не существует.
 */

import type { FastenerType, AttachmentMaterial } from '../types'

export interface FastenerOption {
  value: FastenerType
  label: string
}

/** Полный список крепежа для выпадающего списка в UI (не завязан на материал) */
export const ATTACHMENT_MATERIAL_LABEL: Record<AttachmentMaterial, string> = {
  brick: 'Кирпич',
  block: 'Блок / газобетон',
  concrete: 'Монолит / бетон',
  gkl_existing: 'Существующая ГКЛ-конструкция',
  unknown: 'Материал не задан',
}

export const FASTENER_OPTIONS: FastenerOption[] = [
  { value: 'dowel_6x40',        label: 'Дюбель 6×40 (бетон/кирпич)' },
  { value: 'wood_screw_45',     label: 'Саморез по дереву 45мм (блок)' },
  { value: 'wood_screw_55',     label: 'Саморез по дереву 55мм (блок)' },
  { value: 'metal_screw',       label: 'Саморез по металлу (ГКЛ к ГКЛ)' },
  { value: 'gypsum_toggle',     label: 'Дюбель-бабочка (ГКЛ, редко на практике)' },
  { value: 'anchor_wedge_6x40', label: 'Анкер-клин 6×40 (подвес в потолок)' },
  { value: 'self_drill_screw',  label: 'Саморез с сверлом / просечка (тонкий металл)' },
  { value: 'roofing_screw',     label: 'Кровельный саморез (толстый металл)' },
]

export const FASTENER_LABEL: Record<FastenerType, string> =
  Object.fromEntries(FASTENER_OPTIONS.map(o => [o.value, o.label])) as Record<FastenerType, string>

/** Дефолт по умолчанию: 300мм — стартовая точка, пользователь всегда может поменять шаг вручную. */
export const DEFAULT_FASTENER_STEP_MM = 300

/**
 * Предлагаемый по умолчанию тип крепежа для данного материала примыкания.
 * Возвращает null для 'unknown' — там нет разумного дефолта, пользователь
 * обязан выбрать сам (тип неизвестной существующей конструкции).
 */
export function suggestFastener(material: AttachmentMaterial): FastenerType | null {
  switch (material) {
    case 'concrete':
    case 'brick':
      return 'dowel_6x40'
    case 'block':
      return 'wood_screw_45'
    case 'gkl_existing':
      return 'metal_screw'
    case 'unknown':
    default:
      return null
  }
}
