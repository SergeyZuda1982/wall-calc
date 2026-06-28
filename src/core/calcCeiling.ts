/**
 * Расчёт материалов подвесного потолка КНАУФ
 * Типы П112, П113, П131
 */

import type { CeilingSpec, CeilingStep, CeilingSpecFull } from '../data/ceilingData'
import {
  P112_FRAME_RATES, P112_SHEET_RATES, P112_HANGER_STEP,
  P113_FRAME_RATES, P113_SHEET_RATES, P113_HANGER_STEP,
  P131_FRAME_RATES, P131_SPECIAL_RATES, P131_SHEET_RATES,
} from '../data/ceilingData'

// ─── Результат расчёта ────────────────────────────────────────────────────────

export interface CeilingMaterialItem {
  name: string
  unit: string
  qty: number
  /** Расход на м² (для справки) */
  ratePerSqm?: number
}

export interface CeilingSheetLayout {
  /** Ширина помещения по короткой стороне (для раскроя), мм */
  roomWidthMm: number
  /** Длина помещения по длинной стороне, мм */
  roomLengthMm: number
  /** Шаг основных профилей c, мм */
  stepC: number
  /** Межосевое расстояние несущих профилей b (поперечный монтаж), мм */
  stepB: number
  /** Межосевое расстояние подвесов a, мм */
  stepA: number
  /** Ширина листа, мм */
  sheetW: number
  /** Длина листа, мм */
  sheetL: number
  /** Количество рядов листов (поперёк несущих профилей) */
  rowCount: number
  /** Количество листов в ряду */
  colCount: number
  /** Общее количество листов (на 1 слой) */
  totalSheets: number
  /** Целых листов */
  fullSheets: number
  /** Резаных листов */
  cutSheets: number
  /** Остатки: список обрезков [ширина, длина] */
  offcuts: [number, number][]
}

export interface CeilingCalcResult {
  /** Входные данные */
  spec: CeilingSpec
  /** Площадь, м² */
  areaSqm: number
  /** Периметр, м */
  perimeterM: number
  /** Спецификация материалов */
  materials: CeilingMaterialItem[]
  /** Раскрой листов (для визуализации) */
  sheetLayout: CeilingSheetLayout | null
  /** Предупреждения */
  warnings: string[]
}

// ─── Вспомогательные ─────────────────────────────────────────────────────────

/** Округление вверх до целого */
function ceil(n: number): number { return Math.ceil(n) }

/** Шаг несущих профилей b — всегда 500мм при поперечном монтаже (стандарт) */
const STEP_B = 500

/** Шаг подвесов по умолчанию (нагрузка ≤0.15 кН/м²) */
function getHangerStep(type: CeilingSpec['type'], stepC: CeilingStep): number {
  if (type === 'p112') return P112_HANGER_STEP[stepC] ?? 1000
  if (type === 'p113') return P113_HANGER_STEP[stepC] ?? 950
  return 0  // П131 — нет подвесов
}

// ─── Основная функция ─────────────────────────────────────────────────────────

export function calcCeiling(spec: CeilingSpec): CeilingCalcResult {
  const { type, layers, areaSqm, perimeterM, stepC } = spec
  const warnings: string[] = []
  const materials: CeilingMaterialItem[] = []

  if (type === 'p19') {
    return {
      spec, areaSqm, perimeterM,
      materials: [],
      sheetLayout: null,
      warnings: ['П19 (многоуровневый) — расчёт выполняется по индивидуальному проекту'],
    }
  }

  // ─── Выбор расходов ────────────────────────────────────────────────────────
  const frameRates = type === 'p112' ? P112_FRAME_RATES
    : type === 'p113' ? P113_FRAME_RATES
    : P131_FRAME_RATES

  const sheetRates = type === 'p112' ? P112_SHEET_RATES[layers]
    : type === 'p113' ? P113_SHEET_RATES[layers]
    : P131_SHEET_RATES[layers]

  // ─── П112 / П113: каркас ───────────────────────────────────────────────────
  if (type === 'p112' || type === 'p113') {
    const hangerStep = getHangerStep(type, stepC)

    // ПП 60×27: основные + несущие профили
    const pp_qty = ceil(frameRates.pp6027_lm * areaSqm)
    materials.push({ name: 'Профиль ПП 60×27', unit: 'пог.м', qty: pp_qty, ratePerSqm: frameRates.pp6027_lm })

    // ПН 28×27 по периметру (только П113)
    if (frameRates.pn2827_perimeter) {
      const pn_qty = ceil(perimeterM)
      materials.push({ name: 'Профиль ПН 28×27', unit: 'пог.м', qty: pn_qty })
      materials.push({ name: 'Лента уплотнительная 30мм', unit: 'пог.м', qty: pn_qty })
      // Дюбели для ПН: 2 на пог.м, но не менее 3 на профиль 3000мм
      const pn_dowels = Math.max(ceil(perimeterM * 2), ceil(perimeterM / 3) * 3)
      materials.push({ name: 'Дюбель для ПН 28×27', unit: 'шт', qty: pn_dowels })
    }

    // Соединитель
    if (type === 'p112' && frameRates.connector2lvl) {
      materials.push({
        name: 'Соединитель двухуровневый ПП 60×27',
        unit: 'шт',
        qty: ceil(frameRates.connector2lvl * areaSqm),
        ratePerSqm: frameRates.connector2lvl,
      })
    }
    if (type === 'p113' && frameRates.connector1lvl) {
      materials.push({
        name: 'Соединитель одноуровневый ПП 60×27',
        unit: 'шт',
        qty: ceil(frameRates.connector1lvl * areaSqm),
        ratePerSqm: frameRates.connector1lvl,
      })
    }

    // Удлинитель ПП
    if (frameRates.extender_pp > 0) {
      materials.push({
        name: 'Удлинитель ПП 60×27',
        unit: 'шт',
        qty: ceil(frameRates.extender_pp * areaSqm),
        ratePerSqm: frameRates.extender_pp,
      })
    }

    // Подвесы
    const hanger_qty = ceil(frameRates.hanger_direct * areaSqm)
    materials.push({
      name: 'Подвес прямой ПП 60×27',
      unit: 'шт',
      qty: hanger_qty,
      ratePerSqm: frameRates.hanger_direct,
    })

    // Шуруп LN (крепление ПП в подвесе)
    materials.push({
      name: 'Шуруп LN (крепление в подвесе)',
      unit: 'шт',
      qty: ceil(frameRates.screw_ln * areaSqm),
      ratePerSqm: frameRates.screw_ln,
    })

    // Дюбели анкерные
    materials.push({
      name: 'Дюбель анкерный',
      unit: 'шт',
      qty: ceil(frameRates.dowel * areaSqm),
      ratePerSqm: frameRates.dowel,
    })

    // Предупреждение если шаг не в таблице
    if (hangerStep === 0) {
      warnings.push(`Шаг профилей ${stepC}мм не предусмотрен для типа П113`)
    }
  }

  // ─── П131: специальный каркас ──────────────────────────────────────────────
  if (type === 'p131') {
    const r = P131_SPECIAL_RATES[layers]

    materials.push({ name: 'Профиль ПН 50(75,100)/40', unit: 'пог.м', qty: ceil(r.pn_profile_lm * areaSqm), ratePerSqm: r.pn_profile_lm })
    materials.push({ name: 'Лента уплотнительная', unit: 'пог.м', qty: ceil(r.seal_tape_lm * areaSqm) })
    materials.push({ name: 'Шуруп 4.3×35 с прессшайбой (для ГСП/ГВЛ конструкций)', unit: 'шт', qty: ceil(r.screw_pn_gsp * areaSqm) })
    materials.push({ name: 'Дюбель анкерный (для кирпича/бетона)', unit: 'шт', qty: ceil(r.dowel_pn * areaSqm) })
    materials.push({
      name: layers === 2 ? 'Профиль ПС (спаренный)' : 'Профиль ПС несущий',
      unit: 'пог.м',
      qty: ceil(r.ps_profile_lm * areaSqm),
      ratePerSqm: r.ps_profile_lm,
    })
    materials.push({ name: 'Шуруп LB (скрепление ПС и ПН)', unit: 'шт', qty: ceil(r.screw_lb * areaSqm) })
  }

  // ─── Обшивка (все типы) ────────────────────────────────────────────────────
  const matLabel = spec.material === 'gvl' ? 'ГВЛ' : 'ГСП'
  const thkLabel = spec.thickness
  materials.push({
    name: `${matLabel} ${thkLabel}мм`,
    unit: 'м²',
    qty: Math.ceil(sheetRates.sheet_m2 * areaSqm * 10) / 10,
    ratePerSqm: sheetRates.sheet_m2,
  })

  // Шурупы TN/MN
  const screwCode = spec.material === 'gvl' ? 'MN' : 'TN'
  if (sheetRates.screw_25 > 0) {
    materials.push({
      name: `Шуруп ${screwCode} 25мм (1й слой)`,
      unit: 'шт',
      qty: ceil(sheetRates.screw_25 * areaSqm),
      ratePerSqm: sheetRates.screw_25,
    })
  }
  if (sheetRates.screw_35 > 0) {
    materials.push({
      name: `Шуруп ${screwCode} 35мм (2й слой)`,
      unit: 'шт',
      qty: ceil(sheetRates.screw_35 * areaSqm),
      ratePerSqm: sheetRates.screw_35,
    })
  }

  // Финишные материалы
  materials.push({ name: 'Шпаклёвка гипсовая КНАУФ-Фуген', unit: 'кг', qty: Math.ceil(sheetRates.putty_kg * areaSqm * 10) / 10 })
  materials.push({ name: 'Лента армирующая бумажная', unit: 'пог.м', qty: Math.ceil(sheetRates.tape_lm * areaSqm * 10) / 10 })
  materials.push({ name: 'Лента разделительная 50мм', unit: 'пог.м', qty: Math.ceil(perimeterM * 10) / 10 })
  materials.push({ name: 'Грунтовка КНАУФ-Тифенгрунд', unit: 'кг', qty: Math.ceil(sheetRates.primer_kg * areaSqm * 10) / 10 })

  // ─── Раскрой листов ────────────────────────────────────────────────────────
  const sheetLayout = calcCeilingSheetLayout(spec)

  return { spec, areaSqm, perimeterM, materials, sheetLayout, warnings }
}

// ─── Раскрой листов для потолка ──────────────────────────────────────────────

/**
 * Простой раскрой: листы укладываются поперёк несущих профилей (b=500мм).
 * Пользователь вводит длину и ширину — из них считаем.
 * Листы 1200×2500мм по умолчанию.
 */
export function calcCeilingSheetLayout(spec: CeilingSpec): CeilingSheetLayout | null {
  const full = spec as CeilingSpecFull
  if (!full.roomLengthMm || !full.roomWidthMm) return null

  const { roomLengthMm, roomWidthMm, sheetLengthMm = 2500, stepC } = full

  const sheetW = 1200  // ширина листа всегда 1200мм
  const sheetL = sheetLengthMm

  const stepA = getHangerStep(spec.type, stepC)
  const stepB = STEP_B  // 500мм — шаг несущих профилей

  // Лист лежит: длинная сторона (sheetL=2500) вдоль длины помещения (X)
  //             короткая сторона (sheetW=1200) поперёк, вдоль ширины (Y)
  // Колонки (X) — по длине помещения, шаг = sheetL
  // Ряды    (Y) — по ширине помещения, шаг = sheetW

  const colCount = Math.ceil(roomLengthMm / sheetL)
  const rowCount = Math.ceil(roomWidthMm / sheetW)

  const totalSheets = rowCount * colCount

  const lastColRemainder = roomLengthMm % sheetL
  const lastRowRemainder = roomWidthMm % sheetW

  const fullCols = lastColRemainder === 0 ? colCount : colCount - 1
  const fullRows = lastRowRemainder === 0 ? rowCount : rowCount - 1

  const fullSheets = fullRows * fullCols
  const cutSheets = totalSheets - fullSheets

  // Обрезки
  const offcuts: [number, number][] = []
  if (lastColRemainder > 0) {
    const rowsInRightCol = lastRowRemainder > 0 ? rowCount - 1 : rowCount
    for (let r = 0; r < rowsInRightCol; r++) {
      offcuts.push([lastColRemainder, sheetW])
    }
  }
  if (lastRowRemainder > 0) {
    const colsInBottomRow = lastColRemainder > 0 ? colCount - 1 : colCount
    for (let c = 0; c < colsInBottomRow; c++) {
      offcuts.push([sheetL, lastRowRemainder])
    }
    if (lastColRemainder > 0) {
      offcuts.push([lastColRemainder, lastRowRemainder])
    }
  }

  return {
    roomWidthMm,
    roomLengthMm,
    stepC,
    stepB,
    stepA,
    sheetW,
    sheetL,
    rowCount,
    colCount,
    totalSheets,
    fullSheets,
    cutSheets,
    offcuts,
  }
}
