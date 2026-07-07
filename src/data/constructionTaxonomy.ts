/**
 * Таксономия конструкций для плана объекта.
 *
 * Каждый тип линии (PlanLineType) имеет дерево:
 *   Level 1 — материал / система (material)
 *   Level 2 — подтип / толщина (subtype)
 *
 * visual — как линия выглядит на холсте:
 *   thicknessMm > 0  → двойные параллельные линии (поперечное сечение стены)
 *   thicknessMm = 0  → одиночная линия
 *   dash             → паттерн штриха (null = сплошная)
 *   colorOverride    → заменяет базовый цвет типа
 *   fillColor        → заливка между двойными линиями
 *   contourFill      → заливка замкнутого контура
 */

import type { PlanLineType, DoubleFrameType, ProfileType } from '../types'
import { getProfile } from './profiles'

export interface TaxNode {
  value: string
  label: string
  abbr: string          // 2–4 символа для подписи на холсте
  children?: TaxNode[]
}

export interface LineVisualSpec {
  strokeWidth: number
  dash: number[] | null
  colorOverride: string | null   // null = использовать LINE_COLORS[type]
  thicknessMm: number            // 0 = одна линия, >0 = двойные линии
  fillColor: string              // заливка между двойными линиями
  contourFill: string            // заливка контура (потолок/пол)
}

// ─── Таксономия ──────────────────────────────────────────────────────────────

export const TAXONOMY: Record<PlanLineType, TaxNode[]> = {

  wall_new: [
    {
      value: 'gkl', label: 'ГКЛ / каркас', abbr: 'ГКЛ',
      children: [
        { value: 'ps50',  label: 'ПС 50 (~75мм)',  abbr: 'ПС50' },
        { value: 'ps75',  label: 'ПС 75 (~100мм)', abbr: 'ПС75' },
        { value: 'ps100', label: 'ПС 100 (~125мм)',abbr: 'ПС100' },
        { value: 'ps125', label: 'ПС 125 (~150мм)',abbr: 'ПС125' },
        { value: 'double',label: 'Двойной каркас (общий, ~200мм)', abbr: 'ДК' },
        // ── Двойной каркас, конкретные системы Кнауф (см. КОНСПЕКТ.md,
        // сессия 04.07.2026) — два параллельных ряда стоек, профиль
        // одинаковый с обеих сторон. Различие только в обшивке/зазоре.
        // Сама механика расчёта (два ряда стоек) ещё не реализована —
        // это только таксономия + толщина на плане.
        { value: 'c115_1_ps50',  label: 'С115.1 — двойной ПС50 (2+2 слоя)',  abbr: '115.1·50'  },
        { value: 'c115_1_ps75',  label: 'С115.1 — двойной ПС75 (2+2 слоя)',  abbr: '115.1·75'  },
        { value: 'c115_1_ps100', label: 'С115.1 — двойной ПС100 (2+2 слоя)', abbr: '115.1·100' },
        { value: 'c115_2_ps50',  label: 'С115.2 — двойной ПС50 + разделитель',  abbr: '115.2·50'  },
        { value: 'c115_2_ps75',  label: 'С115.2 — двойной ПС75 + разделитель',  abbr: '115.2·75'  },
        { value: 'c115_2_ps100', label: 'С115.2 — двойной ПС100 + разделитель', abbr: '115.2·100' },
        { value: 'c115_3_ps50',  label: 'С115.3 — двойной ПС50 (2+3, асимметрично)',  abbr: '115.3·50'  },
        { value: 'c115_3_ps75',  label: 'С115.3 — двойной ПС75 (2+3, асимметрично)',  abbr: '115.3·75'  },
        { value: 'c115_3_ps100', label: 'С115.3 — двойной ПС100 (2+3, асимметрично)', abbr: '115.3·100' },
        { value: 'c116_ps50',    label: 'С116 — двойной ПС50 (зазор под коммуникации)',  abbr: '116·50'  },
        { value: 'c116_ps75',    label: 'С116 — двойной ПС75 (зазор под коммуникации)',  abbr: '116·75'  },
        { value: 'c116_ps100',   label: 'С116 — двойной ПС100 (зазор под коммуникации)', abbr: '116·100' },
      ],
    },
    {
      value: 'brick', label: 'Кирпич', abbr: 'КИР',
      children: [
        { value: '120', label: '½ кирпича (120мм)',   abbr: '120' },
        { value: '250', label: '1 кирпич (250мм)',    abbr: '250' },
        { value: '380', label: '1½ кирпича (380мм)',  abbr: '380' },
        { value: '510', label: '2 кирпича (510мм)',   abbr: '510' },
      ],
    },
    {
      value: 'gasblock', label: 'Газоблок / Газобетон', abbr: 'ГАЗ',
      children: [
        { value: '100', label: '100мм', abbr: '100' },
        { value: '150', label: '150мм', abbr: '150' },
        { value: '200', label: '200мм', abbr: '200' },
        { value: '250', label: '250мм', abbr: '250' },
        { value: '300', label: '300мм', abbr: '300' },
      ],
    },
    {
      value: 'foamblock', label: 'Пеноблок', abbr: 'ПЕН',
      children: [
        { value: '100', label: '100мм', abbr: '100' },
        { value: '150', label: '150мм', abbr: '150' },
        { value: '200', label: '200мм', abbr: '200' },
      ],
    },
  ],

  wall_lining: [
    {
      value: 'gkl', label: 'ГКЛ / ГВЛ', abbr: 'ГКЛ',
      children: [
        { value: 'glued',      label: 'На клею (без каркаса)',   abbr: 'КЛЕЙ' },
        { value: 'frame_pn28', label: 'Каркас ПН/ПС 28 (~40мм)', abbr: 'К28' },
        { value: 'frame_ps50', label: 'Каркас ПС 50 (~65мм)',    abbr: 'К50' },
        { value: 'frame_ps75', label: 'Каркас ПС 75 (~90мм)',    abbr: 'К75' },
        { value: 'frame_ps100', label: 'Каркас ПС 100 (~115мм)', abbr: 'К100' },
      ],
    },
    {
      value: 'tile', label: 'Плитка / Керамогранит', abbr: 'ПЛТ',
      children: [
        { value: 'ceramic',   label: 'Кафель',        abbr: 'КАФ' },
        { value: 'porcelain', label: 'Керамогранит',  abbr: 'КГ'  },
        { value: 'mosaic',    label: 'Мозаика',       abbr: 'МОЗ' },
        { value: 'large',     label: 'Крупный формат',abbr: 'КФ'  },
      ],
    },
    {
      value: 'plaster', label: 'Штукатурка', abbr: 'ШТК',
      children: [
        { value: 'cement', label: 'Цементная', abbr: 'ЦМ' },
        { value: 'gypsum', label: 'Гипсовая',  abbr: 'ГП' },
      ],
    },
    {
      value: 'paint', label: 'Малярка', abbr: 'МЛР',
      children: [],
    },
  ],

  wall_existing: [
    {
      value: 'brick', label: 'Кирпич', abbr: 'КИР',
      children: [
        { value: '120', label: '½ кирпича — 120мм',  abbr: '120' },
        { value: '250', label: '1 кирпич — 250мм',   abbr: '250' },
        { value: '380', label: '1½ кирпича — 380мм', abbr: '380' },
        { value: '510', label: '2 кирпича — 510мм',  abbr: '510' },
        { value: '640', label: '2½ кирпича — 640мм', abbr: '640' },
      ],
    },
    {
      value: 'block', label: 'Блок / Газобетон', abbr: 'БЛК',
      children: [
        { value: '100', label: '100мм', abbr: '100' },
        { value: '150', label: '150мм', abbr: '150' },
        { value: '200', label: '200мм', abbr: '200' },
        { value: '250', label: '250мм', abbr: '250' },
        { value: '300', label: '300мм', abbr: '300' },
        { value: '400', label: '400мм', abbr: '400' },
      ],
    },
    {
      value: 'concrete', label: 'Монолит / Бетон', abbr: 'МНЛ',
      children: [
        { value: '150', label: '150мм', abbr: '150' },
        { value: '180', label: '180мм', abbr: '180' },
        { value: '200', label: '200мм', abbr: '200' },
        { value: '250', label: '250мм', abbr: '250' },
        { value: '300', label: '300мм', abbr: '300' },
      ],
    },
    { value: 'unknown', label: 'Тип неизвестен', abbr: '?', children: [] },
  ],

  ceiling: [
    {
      value: 'rough', label: 'Черновой', abbr: 'ЧРН',
      children: [
        { value: 'concrete', label: 'Монолит', abbr: 'МНЛ' },
        { value: 'metal',    label: 'Металл',  abbr: 'МЕТ' },
        { value: 'wood',     label: 'Дерево / Брус', abbr: 'ДЕР' },
      ],
    },
    {
      value: 'gkl', label: 'ГКЛ', abbr: 'ГКЛ',
      children: [
        { value: '1',    label: '1 слой',    abbr: '1сл' },
        { value: '2',    label: '2 слоя',    abbr: '2сл' },
        { value: 'arch', label: 'Фигурный',  abbr: 'ФИГ' },
      ],
    },
    {
      value: 'suspended', label: 'Подвесной', abbr: 'ПДВ',
      children: [
        { value: 'armstrong', label: 'Армстронг', abbr: 'АРМ' },
        { value: 'rail',      label: 'Реечный',   abbr: 'РЕЙ' },
        { value: 'grillato',  label: 'Грильято',  abbr: 'ГРЛ' },
        { value: 'kubota',    label: 'Кубота',    abbr: 'КУБ' },
      ],
    },
    {
      value: 'stretch', label: 'Натяжной', abbr: 'НАТ',
      children: [],
    },
  ],

  floor: [
    {
      value: 'screed', label: 'Стяжка', abbr: 'СТЖ',
      children: [
        { value: 'cement', label: 'Цементная',         abbr: 'ЦМ' },
        { value: 'gypsum', label: 'Гипсовая (ангидрит)',abbr: 'АГ' },
      ],
    },
    {
      value: 'tile', label: 'Плитка / Керамогранит', abbr: 'ПЛТ',
      children: [
        { value: 'ceramic',   label: 'Кафель',         abbr: 'КАФ' },
        { value: 'porcelain', label: 'Керамогранит',   abbr: 'КГ'  },
        { value: 'large',     label: 'Крупный формат', abbr: 'КФ'  },
      ],
    },
    {
      value: 'laminate', label: 'Ламинат', abbr: 'ЛАМ',
      children: [],
    },
    {
      value: 'parquet', label: 'Паркет', abbr: 'ПАР',
      children: [
        { value: 'solid',      label: 'Массив',            abbr: 'МСС' },
        { value: 'engineered', label: 'Инженерная доска',  abbr: 'ИНЖ' },
      ],
    },
    {
      value: 'carpet', label: 'Ковролин', abbr: 'КВР',
      children: [],
    },
    {
      value: 'epoxy', label: 'Наливной пол', abbr: 'НАЛ',
      children: [],
    },
  ],

  // Ригель — не имеет спецификации материала (монолит, единое целое с плитой
  // перекрытия). Ширина сечения и опускание от потолка — свои числовые поля
  // на PlanLine (sectionWidthMm/dropMm), не таксономия.
  rib_beam: [],
}

// ─── Визуальные характеристики по комбинации type + material ────────────────

/** Карта contourFill по типу потолка/пола */
const CONTOUR_FILLS: Record<string, string> = {
  // потолок
  'ceiling:rough:concrete':    '#cfd8dc',
  'ceiling:rough:metal':       '#b0bec5',
  'ceiling:rough:wood':        '#d7ccc8',
  'ceiling:rough':             '#cfd8dc',
  'ceiling:gkl':               '#e8eaf6',
  'ceiling:suspended:armstrong':'#fff9c4',
  'ceiling:suspended:rail':    '#fce4ec',
  'ceiling:suspended:grillato':'#f3e5f5',
  'ceiling:suspended:kubota':  '#ede7f6',
  'ceiling:suspended':         '#f3e5f5',
  'ceiling:stretch':           '#e0e0e0',
  // пол
  'floor:screed':              '#d7ccc8',
  'floor:tile:ceramic':        '#e0f2f1',
  'floor:tile:porcelain':      '#b2dfdb',
  'floor:tile:large':          '#80cbc4',
  'floor:tile':                '#e0f2f1',
  'floor:laminate':            '#ffe0b2',
  'floor:parquet:solid':       '#ffccbc',
  'floor:parquet:engineered':  '#ffe0b2',
  'floor:parquet':             '#ffe0b2',
  'floor:carpet':              '#e8eaf6',
  'floor:epoxy':               '#e1f5fe',
}

export function getContourFill(type: PlanLineType, material?: string, subtype?: string): string | null {
  if (type !== 'ceiling' && type !== 'floor') return null
  const key3 = `${type}:${material}:${subtype}`
  const key2 = `${type}:${material}`
  return CONTOUR_FILLS[key3] ?? CONTOUR_FILLS[key2] ?? null
}

// ─── Толщина стены по spec ───────────────────────────────────────────────────

const GKL_STUD_THICKNESS: Record<string, number> = {
  ps50: 75, ps75: 100, ps100: 125, ps125: 150, double: 200,
}

// ─── Двойной каркас (С115.1/.2/.3, С116) ─────────────────────────────────────
// D — НЕ таблица, а формула (подтверждено пользователем на реальных примерах,
// см. КОНСПЕКТ.md): профиль1 + профиль2 + Σ(толщина слоёв обшивки) + ~3мм
// (допуск на уплотнительную ленту). Профиль одинаковый с обеих сторон.

const DOUBLE_FRAME_TYPES: DoubleFrameType[] = ['c115_1', 'c115_2', 'c115_3', 'c116']

/** Дефолт толщины листа для оценки D, пока spec не хранит фактический layer1/layer2 здесь. */
const DEFAULT_LAYER_THICKNESS_MM = 12.5
/** Допуск на уплотнительную ленту в формуле D. */
const DOUBLE_FRAME_TOLERANCE_MM = 3
/** Визуальный дефолт зазора С116, пока на линии не задан gapMm явно (см. PlanLineSpec.gapMm). */
const DEFAULT_C116_GAP_MM = 100

/**
 * ПС50 для облицовки (wall_lining) физически существует только как С626
 * (2 слоя ГКЛ) — по нормам Кнауф однослойной С625 на профиле ПС50 не бывает
 * (нет в таблице максимальных высот, подтверждено пользователем 07.07.2026).
 * Число слоёв для этой комбинации не выбор монтажника, а фиксированный факт —
 * тот же принцип, что и у двойного каркаса (см. parseDoubleFrameSubtype).
 */
export function isLiningLayersFixed(planType: PlanLineType, subtype?: string): boolean {
  return planType === 'wall_lining' && subtype === 'frame_ps50'
}

/** Число слоёв обшивки с каждой стороны + наличие листа-разделителя в зазоре. */
export function getDoubleFrameLayerCounts(
  dfType: DoubleFrameType,
): { sideA: number; sideB: number; hasSeparator: boolean } {
  switch (dfType) {
    case 'c115_1': return { sideA: 2, sideB: 2, hasSeparator: false }
    case 'c115_2': return { sideA: 2, sideB: 2, hasSeparator: true }
    case 'c115_3': return { sideA: 2, sideB: 3, hasSeparator: false }
    case 'c116':   return { sideA: 2, sideB: 2, hasSeparator: false }
  }
}

/**
 * Разбирает subtype вида 'c115_1_ps50' на тип двойного каркаса + профиль.
 * Возвращает null для обычных (не двойных) подтипов ('ps50', 'double', ...).
 */
export function parseDoubleFrameSubtype(
  subtype?: string,
): { dfType: DoubleFrameType; profile: ProfileType } | null {
  if (!subtype) return null
  for (const dfType of DOUBLE_FRAME_TYPES) {
    const prefix = `${dfType}_`
    if (subtype.startsWith(prefix)) {
      const profile = subtype.slice(prefix.length)
      if (profile === 'ps50' || profile === 'ps75' || profile === 'ps100') {
        return { dfType, profile }
      }
    }
  }
  return null
}

/**
 * Толщина перегородки (D) для двойного каркаса, мм.
 * gapMm — только для С116 (зазор под коммуникации), для остальных типов
 * игнорируется. Не задан для С116 → используется визуальный дефолт
 * DEFAULT_C116_GAP_MM (реальный зазор монтажник задаёт по месту,
 * см. PlanLineSpec.gapMm).
 */
export function getDoubleFrameThicknessMm(
  dfType: DoubleFrameType,
  profile: ProfileType,
  gapMm?: number,
): number {
  const profileWidth = getProfile(profile).width
  const { sideA, sideB, hasSeparator } = getDoubleFrameLayerCounts(dfType)
  const sheetsCount = sideA + sideB + (hasSeparator ? 1 : 0)
  const boardsThickness = sheetsCount * DEFAULT_LAYER_THICKNESS_MM
  const gap = dfType === 'c116' ? (gapMm ?? DEFAULT_C116_GAP_MM) : 0
  return profileWidth * 2 + boardsThickness + gap + DOUBLE_FRAME_TOLERANCE_MM
}

const LINING_THICKNESS: Record<string, number> = {
  glued: 12, frame_pn28: 40, frame_ps50: 65, frame_ps75: 90, frame_ps100: 115,
}

export function getWallThicknessMm(
  type: PlanLineType, material?: string, subtype?: string, gapMm?: number,
): number {
  if (type === 'wall_new') {
    if (!material) return 0  // нет spec → не рисуем трапецию
    if (material === 'gkl') {
      const df = parseDoubleFrameSubtype(subtype)
      if (df) return getDoubleFrameThicknessMm(df.dfType, df.profile, gapMm)
      return GKL_STUD_THICKNESS[subtype ?? ''] ?? 100
    }
    if (material === 'brick' || material === 'gasblock' || material === 'foamblock')
      return parseInt(subtype ?? '0') || 200
  }
  if (type === 'wall_existing') {
    if (!material) return 0
    // Подтип содержит толщину в мм числом
    if (subtype) {
      const t = parseInt(subtype)
      if (!isNaN(t)) return t
    }
    // Fallback для старых линий без подтипа
    if (material === 'brick')    return 250
    if (material === 'concrete') return 200
    if (material === 'block')    return 200
    return 0  // unknown — одиночная линия
  }
  if (type === 'wall_lining') {
    if (material === 'gkl')     return LINING_THICKNESS[subtype ?? ''] ?? 40
    if (material === 'tile')    return 15
    if (material === 'plaster') return 20
    return 30
  }
  return 0
}

/** Краткая аббревиатура типа листа ГКЛ для подписи на плане */
const BOARD_SUBTYPE_ABBR: Record<string, string> = {
  standard: '', moisture: 'ГКЛВ', fire: 'ГКЛО', moisture_fire: 'ГКЛВО',
}

export function getBoardSubtypeAbbr(boardSubtype?: string): string {
  if (!boardSubtype) return ''
  return BOARD_SUBTYPE_ABBR[boardSubtype] ?? ''
}

// ─── Визуальный стиль линии ──────────────────────────────────────────────────

/** Заливка между двойными линиями (поперечное сечение) */
const DOUBLE_LINE_FILLS: Record<string, string> = {
  'wall_new:gkl':       '#ffe0e0',
  'wall_new:brick':     '#d7a89a',
  'wall_new:gasblock':  '#ffd0cc',
  'wall_new:foamblock': '#ffc8c8',
  'wall_existing:brick':    '#bcaaa4',
  'wall_existing:block':    '#cfd8dc',
  'wall_existing:concrete': '#b0bec5',
  'wall_existing:unknown':  '#e0e0e0',
  'wall_lining:gkl':    '#dde9ff',
  'wall_lining:tile':   '#c8deff',
  'wall_lining:plaster':'#e8eeff',
}

export function getLineVisual(
  type: PlanLineType,
  material?: string,
  subtype?: string,
  gapMm?: number,
): LineVisualSpec {
  const thicknessMm = getWallThicknessMm(type, material, subtype, gapMm)
  const fillKey = material ? `${type}:${material}` : type
  const fillColor = DOUBLE_LINE_FILLS[fillKey] ?? 'rgba(200,200,200,0.3)'
  const contourFill = getContourFill(type, material, subtype) ?? 'transparent'

  // wall_new
  if (type === 'wall_new') {
    if (material === 'brick')     return { strokeWidth: 1.5, dash: null,       colorOverride: '#8d4e3a', thicknessMm, fillColor, contourFill }
    if (material === 'gasblock')  return { strokeWidth: 1.5, dash: [6, 3],     colorOverride: '#c62828', thicknessMm, fillColor, contourFill }
    if (material === 'foamblock') return { strokeWidth: 1.5, dash: [3, 3],     colorOverride: '#d32f2f', thicknessMm, fillColor, contourFill }
    // gkl — default
    return { strokeWidth: 1.5, dash: null, colorOverride: '#e53935', thicknessMm, fillColor, contourFill }
  }

  // wall_lining
  if (type === 'wall_lining') {
    if (material === 'tile')    return { strokeWidth: 4, dash: [2, 3],  colorOverride: '#0d47a1', thicknessMm, fillColor, contourFill }
    if (material === 'plaster') return { strokeWidth: 2, dash: null,    colorOverride: '#1565c0', thicknessMm, fillColor, contourFill }
    if (material === 'paint')   return { strokeWidth: 2, dash: [8, 3],  colorOverride: '#42a5f5', thicknessMm: 0, fillColor, contourFill }
    // gkl
    return { strokeWidth: 3, dash: [5, 3], colorOverride: '#1e88e5', thicknessMm, fillColor, contourFill }
  }

  // wall_existing
  if (type === 'wall_existing') {
    if (material === 'concrete') return { strokeWidth: 1.5, dash: null,    colorOverride: '#455a64', thicknessMm, fillColor, contourFill }
    if (material === 'block')    return { strokeWidth: 1.5, dash: [6, 3],  colorOverride: '#607d8b', thicknessMm, fillColor, contourFill }
    if (material === 'unknown')  return { strokeWidth: 1.5, dash: [5, 4], colorOverride: '#90a4ae', thicknessMm: 0, fillColor, contourFill }
    // brick — default
    return { strokeWidth: 1.5, dash: null, colorOverride: '#6d4c41', thicknessMm, fillColor, contourFill }
  }

  // ceiling
  if (type === 'ceiling') {
    if (material === 'rough')     return { strokeWidth: 2, dash: [2, 2],     colorOverride: '#8e24aa', thicknessMm: 0, fillColor, contourFill }
    if (material === 'suspended') return { strokeWidth: 2, dash: [4, 2, 1, 2], colorOverride: '#6a1b9a', thicknessMm: 0, fillColor, contourFill }
    if (material === 'stretch')   return { strokeWidth: 1.5, dash: null,     colorOverride: '#4a148c', thicknessMm: 0, fillColor, contourFill }
    // gkl
    return { strokeWidth: 2, dash: [6, 3], colorOverride: '#7b1fa2', thicknessMm: 0, fillColor, contourFill }
  }

  // floor
  if (type === 'floor') {
    if (material === 'tile')     return { strokeWidth: 2, dash: [1, 3],     colorOverride: '#5d4037', thicknessMm: 0, fillColor, contourFill }
    if (material === 'laminate') return { strokeWidth: 2, dash: [8, 2],     colorOverride: '#6d4c41', thicknessMm: 0, fillColor, contourFill }
    if (material === 'parquet')  return { strokeWidth: 2, dash: [4, 1, 1, 1], colorOverride: '#4e342e', thicknessMm: 0, fillColor, contourFill }
    if (material === 'carpet')   return { strokeWidth: 2, dash: [3, 2],     colorOverride: '#8d6e63', thicknessMm: 0, fillColor, contourFill }
    if (material === 'epoxy')    return { strokeWidth: 1.5, dash: null,     colorOverride: '#a1887f', thicknessMm: 0, fillColor, contourFill }
    // screed
    return { strokeWidth: 2, dash: [2, 2], colorOverride: '#795548', thicknessMm: 0, fillColor, contourFill }
  }

  // fallback
  return { strokeWidth: 3, dash: null, colorOverride: null, thicknessMm: 0, fillColor: 'transparent', contourFill: 'transparent' }
}

// ─── Подпись на холсте ───────────────────────────────────────────────────────

export function getSpecAbbr(
  type: PlanLineType, material?: string, subtype?: string,
  boardSubtype?: string, layers?: 1 | 2,
): string {
  if (!material) return ''
  const l1 = TAXONOMY[type]?.find(n => n.value === material)
  if (!l1) return ''
  let abbr = l1.abbr
  if (subtype && l1.children?.length) {
    const l2 = l1.children.find(n => n.value === subtype)
    if (l2) abbr = `${abbr}·${l2.abbr}`
  }
  if (material === 'gkl') {
    const boardAbbr = getBoardSubtypeAbbr(boardSubtype)
    if (boardAbbr) abbr = `${abbr}·${boardAbbr}`
    // Для двойного каркаса число слоёв фиксировано системой (уже видно
    // в l2.abbr, например '115.3·50' = 2+3 слоя) — spec.layers сюда не
    // относится и показывать "·2сл"/"·1сл" было бы вводящим в заблуждение.
    // Аналогично для ПС50-облицовки: система всегда С626 (2 слоя),
    // независимо от того, что записано в spec.layers у старых линий.
    if (!parseDoubleFrameSubtype(subtype) && (layers === 2 || isLiningLayersFixed(type, subtype))) {
      abbr = `${abbr}·2сл`
    }
  }
  return abbr
}
