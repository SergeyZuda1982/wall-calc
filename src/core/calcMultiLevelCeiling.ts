/**
 * Общая смета многоуровневого потолка (П19) — этап 2 из 5 (см. переписку
 * 16.09.2026, TASKS.md). Складывает уже посчитанные результаты НЕСКОЛЬКИХ
 * независимых расчётов: каждый уровень — обычный calcCeiling() (П112/П113,
 * см. calcCeiling.ts), каждый борт между уровнями — calcCeilingBorder()
 * (см. calcCeilingBorder.ts). Сам этот файл ничего не считает заново —
 * только объединяет уже готовые результаты в одну сводную смету.
 *
 * ⚠️ Сознательно НЕ трогает существующую заглушку `type === 'p19'` внутри
 * calcCeiling() (там до сих пор пустой результат с warnings "в разработке",
 * см. calcCeiling.ts ~строка 145) — эта заглушка остаётся заботой этапа 3
 * (UI), где будет решено, как именно пользователь попадает в многоуровневый
 * режим (отдельная кнопка/пункт меню, а не просто "выбрал тип p19 у одного
 * потолка", раз теперь это НЕСКОЛЬКО сущностей Ceiling + CeilingBorder, а
 * не один CeilingSpec).
 */

import type { CeilingCalcResult } from './calcCeiling'
import type { CeilingBorderCalcResult } from './calcCeilingBorder'

export interface MultiLevelCeilingLevelInput {
  /** Подпись уровня для сметы/предупреждений, напр. "Ступень 2 (+3.500)" */
  label: string
  result: CeilingCalcResult
}

export interface MultiLevelCeilingBorderInput {
  /** Подпись борта для сметы/предупреждений, напр. "Борт 1→2" */
  label: string
  result: CeilingBorderCalcResult
}

export interface MultiLevelMaterialItem {
  name: string
  unit: string
  qty: number
}

export interface MultiLevelCeilingResult {
  /** Сумма площадей всех уровней, м² */
  totalAreaSqm: number
  /** Сумма длин всех бортов, м */
  totalBorderLengthM: number
  /** Площади по уровням отдельно — для отображения построчно в смете */
  levels: { label: string; areaSqm: number }[]
  /** Длины по бортам отдельно */
  borders: { label: string; pathLengthM: number }[]
  /** Материалы уровней и бортов ВМЕСТЕ, объединены по паре (название+единица) —
   *  если у уровня и борта совпало и название, и единица измерения (напр.
   *  одинаковый саморез), количество суммируется в одну строку; если нет —
   *  остаются отдельными строками. Порядок — по первому появлению. */
  materials: MultiLevelMaterialItem[]
  /** Предупреждения всех уровней и бортов, с префиксом источника
   *  ("[Ступень 2] ...", "[Борт 1→2] ...") — иначе непонятно, к чему
   *  относится предупреждение, когда их складывают из многих источников. */
  warnings: string[]
}

export function calcMultiLevelCeiling(
  levels: MultiLevelCeilingLevelInput[],
  borders: MultiLevelCeilingBorderInput[] = [],
): MultiLevelCeilingResult {
  if (levels.length === 0) {
    throw new Error('calcMultiLevelCeiling: нужен хотя бы один уровень')
  }

  const totalAreaSqm = Math.round(levels.reduce((sum, l) => sum + l.result.areaSqm, 0) * 100) / 100
  const totalBorderLengthM = Math.round(borders.reduce((sum, b) => sum + b.result.pathLengthM, 0) * 100) / 100

  // Map сохраняет порядок первой вставки ключа — материалы в смете идут в
  // том порядке, в котором впервые встретились (сначала уровни по порядку,
  // потом борта), а не пересортировываются алфавитно/как-то ещё.
  const materialsByKey = new Map<string, MultiLevelMaterialItem>()
  const addMaterials = (items: { name: string; unit: string; qty: number }[]) => {
    for (const item of items) {
      const key = `${item.name}__${item.unit}`
      const existing = materialsByKey.get(key)
      if (existing) {
        existing.qty += item.qty
      } else {
        materialsByKey.set(key, { name: item.name, unit: item.unit, qty: item.qty })
      }
    }
  }

  const warnings: string[] = []

  for (const level of levels) {
    addMaterials(level.result.materials)
    for (const w of level.result.warnings) warnings.push(`[${level.label}] ${w}`)
  }
  for (const border of borders) {
    addMaterials(border.result.materials)
    for (const w of border.result.warnings) warnings.push(`[${border.label}] ${w}`)
  }

  return {
    totalAreaSqm,
    totalBorderLengthM,
    levels: levels.map(l => ({ label: l.label, areaSqm: l.result.areaSqm })),
    borders: borders.map(b => ({ label: b.label, pathLengthM: b.result.pathLengthM })),
    materials: Array.from(materialsByKey.values()),
    warnings,
  }
}
