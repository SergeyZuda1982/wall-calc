/**
 * workMaterialCatalog.ts — справочник расхода материалов для этапов отделки.
 * Типы (MaterialKind/MaterialCategory/MaterialUnit) — в types/index.ts (там
 * же WorkStageTemplateStep.materialKind/materialThicknessMm/materialLayers),
 * по конвенции проекта: типы в types/, данные — здесь, data/*.ts импортирует
 * типы из types/, не наоборот.
 *
 * Здесь — только материалы формулы "площадь × расход на м² (или на м²×мм)":
 * грунтовка, штукатурка (гипсовая/цементная/декоративная), шпаклёвка,
 * краска, стяжка, наливной пол, гидроизоляция, штучные напольные покрытия
 * (ламинат/кварцвинил/паркет).
 *
 * НЕ входит сюда (обсуждено 20.07.2026, каждое — отдельная задача на потом,
 * т.к. формула расчёта другая):
 * - ГКЛ (профиль/листы/крепёж/минвата) — уже считается точными калькуляторами
 *   (calcSheetLayout.ts, buildPositions.ts), дублировать не нужно.
 * - Плитка/затирка — зависит от размера плитки и раскладки (TileCalc.tsx).
 * - Обои/стеклохолст/флизелин — рулонный материал с раскроем по высоте стены,
 *   формула "площадь/площадь рулона" даёт неверный результат (обрезки не
 *   переиспользуются между стенами) — нужен отдельный мини-калькулятор.
 * - Багеты/карнизы/плинтуса — погонный материал по периметру, а не по площади.
 * - Потолочные системы (Армстронг/реечный/грильято) — это не "материал", а
 *   отдельный калькулятор раскладки сетки/реек, по сложности как ГКЛ-потолок.
 */

import type { MaterialKind, MaterialCategory, MaterialUnit } from '../types'

export type { MaterialKind, MaterialCategory, MaterialUnit }

export interface MaterialRate {
  kind: MaterialKind
  /** Группа для UI (напр. все варианты штукатурки — один выпадающий список "Штукатурка: [вариант]") */
  category: MaterialCategory
  label: string
  /** Упаковка (мешок сухой смеси / банка краски / ведро / коробка штучного покрытия) — для округления партии */
  packageUnit: MaterialUnit
  /** Физическая величина расхода — кг для сухих смесей, л для жидкостей */
  massUnit: 'kg' | 'l'
  /**
   * Расход. Для thicknessDependent=true — кг (или л) на м² НА 1мм толщины
   * (итоговый расход = ratePerM2 × thicknessMm). Для остальных — кг/л на м²
   * ЗА ОДИН СЛОЙ (итоговый расход = ratePerM2 × layers — поэтому окраска
   * в 2 и в 3 слоя даёт РАЗНЫЙ итог, это уже учтено, layers не хардкод).
   */
  ratePerM2: number
  thicknessDependent: boolean
  /** Толщина по умолчанию, мм — только для thicknessDependent, стартовое значение в UI */
  defaultThicknessMm?: number
  /** Число слоёв по умолчанию — только для НЕ thicknessDependent (можно переопределить на шаге) */
  defaultLayers?: number
  /** Объём/масса одной упаковки, в единицах massUnit (кг или л) */
  packageSize: number
  /** Запас на отходы/подрезку/неровности основания, доля (0.1 = +10%) */
  wasteFactor: number
}

export const WORK_MATERIAL_CATALOG: Record<MaterialKind, MaterialRate> = {
  priming: {
    kind: 'priming', category: 'priming', label: 'Грунтовка глубокого проникновения', packageUnit: 'can', massUnit: 'l',
    ratePerM2: 0.12, thicknessDependent: false, defaultLayers: 1,
    packageSize: 10, wasteFactor: 0.05,
  },
  plaster_gypsum: {
    kind: 'plaster_gypsum', category: 'plaster', label: 'Штукатурка гипсовая (машинного/ручного нанесения)', packageUnit: 'bag', massUnit: 'kg',
    ratePerM2: 0.9, thicknessDependent: true, defaultThicknessMm: 15,
    packageSize: 30, wasteFactor: 0.1,
  },
  plaster_cement: {
    kind: 'plaster_cement', category: 'plaster', label: 'Штукатурка цементно-песчаная', packageUnit: 'bag', massUnit: 'kg',
    ratePerM2: 1.7, thicknessDependent: true, defaultThicknessMm: 15,
    packageSize: 25, wasteFactor: 0.1,
  },
  plaster_decorative: {
    // Фактурная (короед/шуба и т.п.) — толщина определяется размером зерна, а не задаётся мм,
    // поэтому thicknessDependent=false, расход — фикс. кг/м² за один проход.
    kind: 'plaster_decorative', category: 'plaster', label: 'Штукатурка декоративная (короед/шуба)', packageUnit: 'bucket', massUnit: 'kg',
    ratePerM2: 3.0, thicknessDependent: false, defaultLayers: 1,
    packageSize: 25, wasteFactor: 0.1,
  },
  putty: {
    kind: 'putty', category: 'putty', label: 'Шпаклёвка финишная', packageUnit: 'bag', massUnit: 'kg',
    ratePerM2: 1.1, thicknessDependent: false, defaultLayers: 2,
    packageSize: 20, wasteFactor: 0.1,
  },
  paint: {
    kind: 'paint', category: 'paint', label: 'Краска водоэмульсионная', packageUnit: 'can', massUnit: 'l',
    ratePerM2: 0.12, thicknessDependent: false, defaultLayers: 2,
    packageSize: 2.5, wasteFactor: 0.05,
  },
  screed: {
    kind: 'screed', category: 'screed', label: 'Стяжка цементно-песчаная', packageUnit: 'bag', massUnit: 'kg',
    ratePerM2: 1.9, thicknessDependent: true, defaultThicknessMm: 50,
    packageSize: 25, wasteFactor: 0.05,
  },
  self_leveling: {
    kind: 'self_leveling', category: 'self_leveling', label: 'Наливной пол / ровнитель', packageUnit: 'bag', massUnit: 'kg',
    ratePerM2: 1.6, thicknessDependent: true, defaultThicknessMm: 5,
    packageSize: 20, wasteFactor: 0.05,
  },
  waterproofing: {
    kind: 'waterproofing', category: 'waterproofing', label: 'Гидроизоляция обмазочная', packageUnit: 'bucket', massUnit: 'kg',
    ratePerM2: 1.7, thicknessDependent: false, defaultLayers: 2,
    packageSize: 20, wasteFactor: 0.05,
  },
  flooring_laminate: {
    kind: 'flooring_laminate', category: 'flooring', label: 'Ламинат / паркетная доска', packageUnit: 'pack', massUnit: 'kg',
    ratePerM2: 1, thicknessDependent: false, defaultLayers: 1,
    packageSize: 2.2, wasteFactor: 0.08,
  },
  flooring_quartz_vinyl: {
    kind: 'flooring_quartz_vinyl', category: 'flooring', label: 'Кварцвинил / SPC-плитка', packageUnit: 'pack', massUnit: 'kg',
    ratePerM2: 1, thicknessDependent: false, defaultLayers: 1,
    packageSize: 2.2, wasteFactor: 0.07,
  },
  flooring_parquet: {
    // Штучный паркет — мельче упаковка и обычно больше подрезки под рисунок/фризы
    kind: 'flooring_parquet', category: 'flooring', label: 'Паркет штучный', packageUnit: 'pack', massUnit: 'kg',
    ratePerM2: 1, thicknessDependent: false, defaultLayers: 1,
    packageSize: 1.8, wasteFactor: 0.12,
  },
}

/**
 * Расход материала (в кг/л, ТОЧНОЕ число — для отображения в смете) для
 * одного шага с заданным materialKind на поверхности площадью areaM2,
 * плюс округление вверх до целой упаковки.
 * thicknessMm — обязателен и используется, только если rate.thicknessDependent.
 * layers — только если !rate.thicknessDependent (по умолчанию rate.defaultLayers;
 * переданное значение полностью переопределяет расход — 3 слоя дадут в 1.5 раза
 * больше материала, чем 2 слоя, никакого хардкода).
 */
export function calcStepMaterial(
  kind: MaterialKind,
  areaM2: number,
  opts: { thicknessMm?: number, layers?: number } = {},
): { rate: MaterialRate, totalMass: number, packages: number } {
  const rate = WORK_MATERIAL_CATALOG[kind]
  const consumption = rate.thicknessDependent
    ? rate.ratePerM2 * (opts.thicknessMm ?? rate.defaultThicknessMm ?? 0)
    : rate.ratePerM2 * (opts.layers ?? rate.defaultLayers ?? 1)
  const totalMass = areaM2 * consumption * (1 + rate.wasteFactor)
  const packages = Math.ceil(totalMass / rate.packageSize)
  return { rate, totalMass, packages }
}
