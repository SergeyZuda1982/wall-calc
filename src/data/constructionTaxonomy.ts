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

import type { PlanLineType } from '../types'

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
        { value: 'double',label: 'Двойной каркас (~200мм)', abbr: 'ДК' },
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
        { value: '1',  label: '1 слой',  abbr: '1сл' },
        { value: '2',  label: '2 слоя',  abbr: '2сл' },
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
    { value: 'brick',    label: 'Кирпич',         abbr: 'КИР', children: [] },
    { value: 'block',    label: 'Блок / Ракушняк', abbr: 'БЛК', children: [] },
    { value: 'concrete', label: 'Монолит / Бетон', abbr: 'МНЛ', children: [] },
    { value: 'unknown',  label: 'Тип неизвестен',  abbr: '?',   children: [] },
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

export function getWallThicknessMm(type: PlanLineType, material?: string, subtype?: string): number {
  if (type === 'wall_new') {
    if (!material || material === 'gkl') return GKL_STUD_THICKNESS[subtype ?? ''] ?? 100
    if (material === 'brick' || material === 'gasblock' || material === 'foamblock')
      return parseInt(subtype ?? '0') || 200
  }
  if (type === 'wall_existing') {
    if (material === 'brick')    return 250
    if (material === 'concrete') return 200
    return 200
  }
  if (type === 'wall_lining') {
    if (material === 'gkl')     return 40
    if (material === 'tile')    return 15
    if (material === 'plaster') return 20
    return 30
  }
  return 0
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
): LineVisualSpec {
  const thicknessMm = getWallThicknessMm(type, material, subtype)
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
    if (material === 'unknown')  return { strokeWidth: 4,   dash: [3, 3],  colorOverride: '#90a4ae', thicknessMm: 0, fillColor, contourFill }
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

export function getSpecAbbr(type: PlanLineType, material?: string, subtype?: string): string {
  if (!material) return ''
  const l1 = TAXONOMY[type]?.find(n => n.value === material)
  if (!l1) return ''
  if (!subtype || !l1.children?.length) return l1.abbr
  const l2 = l1.children.find(n => n.value === subtype)
  return l2 ? `${l1.abbr}·${l2.abbr}` : l1.abbr
}
