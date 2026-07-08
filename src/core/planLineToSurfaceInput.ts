/**
 * planLineToSurfaceInput.ts — Слой 4: переводчик линии плана в вход раскроя
 * листов (SurfaceSheetInput, см. calcProjectSheetLayout.ts).
 *
 * ВАЖНО: раскрой листов не зависит от системы каркаса (С623/С625/С626,
 * профиль ПС50/75/100 или ПП60×27) — calcSheetLayout режет полотно ГКЛ
 * по геометрии стены/проёмов и шагу стоек, ему всё равно, чем каркас
 * зашит изнутри. Поэтому этот переводчик НЕ требует резолва liningType/
 * profileType — тот резолв понадобится отдельным переводчиком в сторону
 * профиля/крепежа/подвесов (следующий слой), не сюда.
 *
 * Упрощение (как и в buildSurfaceInputs для облицовки): позиции стоек
 * на плане не хранятся (нет запущенного calcStudMaterial по линии плана),
 * поэтому firstStud = step. Высота — плоская (line.heightMm ?? 3000),
 * без учёта уклонов/ступеней (EdgeProfile ещё не подключён к плану —
 * это отдельная задача "разрез", пункт 3 дорожной карты).
 *
 * ДВОЙНОЙ КАРКАС (С115.1/.2/.3, С116, см. calcDoubleFrame.ts): это два
 * независимых ряда стоек с разной обшивкой (layerA1/A2/B1/B2/(B3)), а не
 * один каркас с общим layer1/layer2 — обычный planLineToSurfaceInput() для
 * таких линий возвращает null (иначе была бы тихая ошибка: генерик-формула
 * "sides=2, общий layer1/layer2" не знает про асимметрию С115.3 и не умеет
 * ни разделитель С115.2, ни зазор С116). Вместо этого
 * planLineToDoubleFrameSurfaceInputs() раскладывает такую линию на 2-4
 * отдельных SurfaceSheetInput (сторона А, сторона Б, [разделитель],
 * [доп. слой Б]) — каждая считается через тот же calcSheetLayout, что и
 * обычная одинарная стена/облицовка (геометрия и раскрой не отличаются,
 * отличается только то, чем зашито).
 * Упрощение: раздельная сторона у листа-разделителя (С115.2) — сам лист
 * не хранит собственную спецификацию на линии плана (не запрашивалась
 * пользователем отдельно от layerA/B), используется DEFAULT_BOARD_SPEC.
 */

import type { PlanLine, Opening } from '../types'
import type { SurfaceSheetInput } from './calcProjectSheetLayout'
import { DEFAULT_BOARD_SPEC } from '../types'
import { parseDoubleFrameSubtype, getDoubleFrameLayerCounts } from '../data/constructionTaxonomy'

const DEFAULT_STEP_MM = 600 // совпадает с дефолтом drawStep в FloorPlan.tsx

function mapOpenings(line: PlanLine): Opening[] {
  return (line.openings ?? []).map(o => ({
    id: o.id,
    // 'opening' (просто проём, без двери/окна) для расчёта материала считаем как дверь —
    // структурно то же самое: сплошной вырез от пола, требует такого же обрамления
    type: o.type === 'window' ? 'window' : 'door',
    pos: o.offsetMm,
    width: o.widthMm,
    height: o.heightMm,
    sillHeight: o.sillHeightMm ?? 0,
  }))
}

/**
 * Переводит одну линию плана в SurfaceSheetInput.
 * Возвращает null для линий, которые не являются ГКЛ-конструкциями
 * с раскроем листов: wall_existing (существующая стена — ничего не покупаем),
 * кирпич/газоблок/пеноблок (кладка — не ГКЛ), плитка/штукатурка/малярка
 * (не листовой раскрой), ceiling/floor (свой расчёт, calcCeiling.ts),
 * двойной каркас (см. planLineToDoubleFrameSurfaceInputs — там своя логика).
 */
export function planLineToSurfaceInput(line: PlanLine): SurfaceSheetInput | null {
  if (line.type !== 'wall_new' && line.type !== 'wall_lining') return null
  if (line.spec?.material !== 'gkl') return null
  if (line.lengthMm <= 0) return null
  if (line.type === 'wall_new' && parseDoubleFrameSubtype(line.spec.subtype)) return null

  const sides: 1 | 2 = line.type === 'wall_new' ? 2 : 1
  const gklLayers: 1 | 2 = line.spec.layers ?? 1
  const step = line.spec.step ?? DEFAULT_STEP_MM
  const wallH = line.heightMm ?? 3000

  return {
    id: line.id,
    label: line.label,
    wallL: line.lengthMm,
    wallH,
    firstStud: step,
    step,
    gklLayers,
    openings: mapOpenings(line),
    layer1: line.spec.layer1 ?? DEFAULT_BOARD_SPEC,
    layer2: line.spec.layer2 ?? DEFAULT_BOARD_SPEC,
    sides,
  }
}

/**
 * Раскладывает линию двойного каркаса на 2-4 SurfaceSheetInput.
 * null, если линия не является двойным каркасом (обычный planLineToSurfaceInput
 * применим к ней вместо этого).
 */
export function planLineToDoubleFrameSurfaceInputs(line: PlanLine): SurfaceSheetInput[] | null {
  if (line.type !== 'wall_new') return null
  if (line.spec?.material !== 'gkl') return null
  if (line.lengthMm <= 0) return null
  const df = parseDoubleFrameSubtype(line.spec.subtype)
  if (!df) return null

  const step = line.spec.step ?? DEFAULT_STEP_MM
  const wallH = line.heightMm ?? 3000
  const openings = mapOpenings(line)
  const { sideB, hasSeparator } = getDoubleFrameLayerCounts(df.dfType)

  const base = {
    wallL: line.lengthMm, wallH, firstStud: step, step, openings, sides: 1 as const,
  }

  const out: SurfaceSheetInput[] = [
    {
      ...base,
      id: `${line.id}__A`,
      label: `${line.label} · сторона А`,
      gklLayers: 2,
      layer1: line.spec.layerA1 ?? DEFAULT_BOARD_SPEC,
      layer2: line.spec.layerA2 ?? DEFAULT_BOARD_SPEC,
    },
    {
      ...base,
      id: `${line.id}__B`,
      label: `${line.label} · сторона Б`,
      // ScrewResult/CutList поддерживают максимум 2 слоя на сторону — третий
      // слой Б (только С115.3) считается отдельно ниже, упрощённо по площади.
      gklLayers: Math.min(sideB, 2) as 1 | 2,
      layer1: line.spec.layerB1 ?? DEFAULT_BOARD_SPEC,
      layer2: line.spec.layerB2 ?? DEFAULT_BOARD_SPEC,
    },
  ]

  if (hasSeparator) {
    // Лист-разделитель в зазоре — только С115.2. Своей спецификации листа
    // на линии плана нет (см. докстринг файла), берём DEFAULT_BOARD_SPEC.
    out.push({
      ...base,
      id: `${line.id}__SEP`,
      label: `${line.label} · разделитель в зазоре`,
      gklLayers: 1,
      layer1: DEFAULT_BOARD_SPEC,
      layer2: DEFAULT_BOARD_SPEC,
    })
  }

  if (sideB > 2) {
    // Третий слой стороны Б — только С115.3.
    out.push({
      ...base,
      id: `${line.id}__B3`,
      label: `${line.label} · доп. слой Б (3-й)`,
      gklLayers: 1,
      layer1: line.spec.layerB3 ?? DEFAULT_BOARD_SPEC,
      layer2: DEFAULT_BOARD_SPEC,
    })
  }

  return out
}

/** Батч-версия: переводит все линии плана, отбрасывая неприменимые (null). Порядок сохраняется. */
export function planLinesToSurfaceInputs(lines: PlanLine[]): SurfaceSheetInput[] {
  const out: SurfaceSheetInput[] = []
  for (const l of lines) {
    const dfInputs = planLineToDoubleFrameSurfaceInputs(l)
    if (dfInputs) { out.push(...dfInputs); continue }
    const input = planLineToSurfaceInput(l)
    if (input) out.push(input)
  }
  return out
}
