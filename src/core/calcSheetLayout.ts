/**
 * Раскрой листов ГСП (ГКЛ / ГВЛ / Сапфир / Аквамарин) для одной стены.
 *
 * Правила (Кнауф, п.8.16 + Схема 4):
 * — Листы стоят вертикально, стык по оси стоечного профиля.
 * — Слой 1: первая колонка = firstStud мм.
 * — Слой 2: сдвинут по горизонтали на step, первая колонка = (firstStud+step)%1200 || 1200.
 * — Горизонтальные стыки: 4-значная схема vOffset {0, SL/4, SL/2, 3*SL/4}.
 *   Слой 1 и 2 смещены на 2 шага (SL/2). Соседние колонки — на 1 шаг (SL/4).
 *   Минимальный разбег в любой точке стены ≥ SL/4 = 625мм ≥ 400мм (п.8.16).
 * — Края проёмов добавляются в список границ колонок → нет ложных void-зон.
 * — Переиспользование обрезков: жадный алгоритм (первый подходящий из пула).
 */

import type {
  Opening, BoardSpec, BoardPiece, BoardColumn,
  BoardOffcut, BoardLayerLayout, BoardSheetResult,
} from '../types'

const SHEET_W = 1200  // ширина листа всегда 1200 мм

// ─── Вспомогательные ─────────────────────────────────────────────────────────

/** Ширина первой колонки слоя */
function firstColWidth(firstStud: number, step: number, layer: 1 | 2): number {
  if (layer === 1) return firstStud
  const r = (firstStud + step) % SHEET_W
  return r === 0 ? SHEET_W : r
}

/**
 * Номер листа (слот) для колонки с левым краем x1.
 * Все под-колонки одного физического листа получают одинаковый слот —
 * это важно для проёмов, которые разбивают лист на несколько под-колонок.
 */
function sheetSlot(x1: number, firstW: number): number {
  if (x1 < firstW) return 0
  return 1 + Math.floor((x1 - firstW) / SHEET_W)
}

/**
 * Границы колонок:
 * - шаговые точки по листу (firstStud, затем каждые 1200мм)
 * - ПЛЮС левые и правые края всех проёмов
 * → каждая под-колонка либо целиком внутри проёма, либо целиком снаружи
 */
function columnBoundaries(
  firstStud: number,
  step: number,
  wallL: number,
  layer: 1 | 2,
  openings: Opening[],
): number[] {
  const firstW = layer === 1
    ? firstStud
    : (() => { const r = (firstStud + step) % SHEET_W; return r === 0 ? SHEET_W : r })()

  const pts = new Set<number>([0, wallL])

  // Шаговые границы листов
  if (firstW > 0 && firstW < wallL) {
    pts.add(firstW)
    let p = firstW
    while (p + SHEET_W < wallL) { p += SHEET_W; pts.add(p) }
  }

  // Края проёмов — разбиваем колонки на части
  // pos = левый край проёма, правый = pos + width
  for (const op of openings.filter(o => o.width > 0)) {
    const oL = op.pos
    const oR = op.pos + op.width
    if (oL > 0 && oL < wallL) pts.add(Math.round(oL))
    if (oR > 0 && oR < wallL) pts.add(Math.round(oR))
  }

  return [...pts].sort((a, b) => a - b)
}

/**
 * Высотные диапазоны [yBottom, yTop] где нужно оставить пустоту (проёмы).
 * Применяется к под-колонке [x1, x2].
 */
function voidZones(
  x1: number, x2: number,
  openings: Opening[],
): Array<[number, number]> {
  const voids: Array<[number, number]> = []
  for (const op of openings.filter(o => o.width > 0)) {
    const oL = op.pos
    const oR = op.pos + op.width
    // Строгая проверка: под-колонка должна полностью лежать внутри проёма
    if (x1 < oR && x2 > oL) {
      voids.push([op.sillHeight, op.sillHeight + op.height])
    }
  }
  return voids
}

/**
 * Рабочие диапазоны [yBottom, yTop] — wallH минус void-зоны.
 */
function workZones(
  wallH: number,
  voids: Array<[number, number]>,
): Array<[number, number]> {
  let zones: Array<[number, number]> = [[0, wallH]]
  for (const [vB, vT] of voids) {
    const next: Array<[number, number]> = []
    for (const [z1, z2] of zones) {
      if (vT <= z1 || vB >= z2) { next.push([z1, z2]); continue }
      if (z1 < vB) next.push([z1, vB])
      if (vT < z2) next.push([vT, z2])
    }
    zones = next
  }
  return zones
}

/**
 * Разбивает зону [z1, z2] на куски с учётом вертикального смещения слоя.
 * Возвращает массив y-границ: [z1, joint1, joint2, ..., z2].
 * Горизонтальные стыки листов попадают в точки vOffset, vOffset+SL, vOffset+2*SL...
 */
function zoneJoints(z1: number, z2: number, SL: number, vOffset: number): number[] {
  const pts = [z1]
  // Первый стык ≥ z1
  let j = vOffset % SL  // нормализуем смещение
  while (j <= z1) j += SL
  while (j < z2) {
    pts.push(j)
    j += SL
  }
  pts.push(z2)
  return pts
}

// ─── Жадный пул обрезков ─────────────────────────────────────────────────────

interface PoolItem { w: number; h: number; used: boolean }

function takeFromPool(pool: PoolItem[], needW: number, needH: number): PoolItem | null {
  for (const item of pool) {
    if (!item.used && item.w >= needW && item.h >= needH) {
      item.used = true
      return item
    }
  }
  return null
}

// ─── Основной алгоритм одного слоя ───────────────────────────────────────────

function calcLayer(
  wallL: number,
  wallH: number,
  firstStud: number,
  step: number,
  openings: Opening[],
  spec: BoardSpec,
  layer: 1 | 2,
  sideIndex: 0 | 1,
  sharedPool: PoolItem[],   // общий пул — передаётся снаружи и живёт через все слои/стороны
): BoardLayerLayout {
  const SL = spec.sheetLength

  const bounds  = columnBoundaries(firstStud, step, wallL, layer, openings)
  const columns: BoardColumn[] = []
  const pool    = sharedPool   // алиас для читаемости

  let sheetsNeeded = 0
  let usedMm2      = 0
  let sheetMm2     = 0

  for (let i = 0; i < bounds.length - 1; i++) {
    const x1 = bounds[i]
    const x2 = bounds[i + 1]
    const cw  = x2 - x1

    // ── 4-значная схема vOffset ──────────────────────────────────────────────
    // Значения: 0, SL/4, SL/2, 3*SL/4 (шаг 625мм для SL=2500).
    //
    // Доказательство корректности:
    //   Слот L1 и слот L2 для любого x различаются не более чем на 1
    //   (потому что firstW2 - firstW1 < SHEET_W = 1200мм).
    //   При смещении L2 на 2 шага (= SL/2):
    //     |k - j| = 0  →  diff = SL/2 = 1250мм  ✓
    //     |k - j| = 1  →  diff = SL/4 = 625мм   ✓  (≥ 400мм норматив)
    //   Соседние колонки одного слоя: diff = SL/4 = 625мм  ✓
    //   Стороны А/Б перегородки (sideIndex 0/1): diff = SL/4  ✓
    const firstW = firstColWidth(firstStud, step, layer)
    const slot   = sheetSlot(x1, firstW)
    const vOffset = ((slot + (layer === 2 ? 2 : 0) + sideIndex) % 4) * (SL / 4)

    // Позиции горизонтальных стыков для этой колонки (для canvas)
    const jointYs = zoneJoints(0, wallH, SL, vOffset).slice(1, -1)

    const voids = voidZones(x1, x2, openings)
    const work  = workZones(wallH, voids)
    const pieces: BoardPiece[] = []

    // Void-зоны → opening_void для Canvas
    for (const [vB, vT] of voids) {
      const clampB = Math.max(0, vB)
      const clampT = Math.min(wallH, vT)
      if (clampT > clampB) {
        pieces.push({
          x: x1, y: clampB, w: cw, h: clampT - clampB,
          kind: 'opening_void', source: 'new_sheet',
        })
      }
    }

    // Рабочие зоны → листы
    for (const [z1, z2] of work) {
      const ys = zoneJoints(z1, z2, SL, vOffset)

      for (let k = 0; k < ys.length - 1; k++) {
        const py = ys[k]
        const ph = ys[k + 1] - ys[k]

        // Пробуем взять из пула
        const fromPool = takeFromPool(pool, cw, ph)

        let source: BoardPiece['source']
        if (fromPool) {
          source = 'offcut'
          // Кладём остатки обратно в пул
          if (fromPool.h - ph >= 200) pool.push({ w: fromPool.w, h: fromPool.h - ph, used: false })
          if (fromPool.w - cw >= 200) pool.push({ w: fromPool.w - cw, h: ph, used: false })
        } else {
          // Открываем новый лист
          source = 'new_sheet'
          sheetsNeeded++
          sheetMm2 += SHEET_W * SL

          // Боковой обрезок
          if (SHEET_W - cw >= 200) pool.push({ w: SHEET_W - cw, h: SL, used: false })
          // Высотный обрезок
          if (SL - ph >= 200)      pool.push({ w: cw, h: SL - ph, used: false })
        }

        const widthCut  = cw < SHEET_W
        const heightCut = ph < SL
        const kind: BoardPiece['kind'] =
          widthCut && heightCut ? 'both_cut'
          : widthCut            ? 'width_cut'
          : heightCut           ? 'height_cut'
          : 'full'

        pieces.push({ x: x1, y: py, w: cw, h: ph, kind, source })
        usedMm2 += cw * ph
      }
    }

    columns.push({ x1, x2, pieces, jointYs })
  }

  // Неиспользованные обрезки → usableOffcuts
  const usableOffcuts: BoardOffcut[] = pool
    .filter(p => !p.used && p.w >= 200 && p.h >= 200)
    .map(p => ({ w: p.w, h: p.h, spec }))

  const offcutMm2    = usableOffcuts.reduce((s, o) => s + o.w * o.h, 0)
  const wastePercent = sheetMm2 > 0
    ? Math.max(0, (sheetMm2 - usedMm2) / sheetMm2 * 100)
    : 0

  return {
    layer,
    spec,
    columns,
    sheetsNeeded,
    usedAreaM2:   usedMm2    / 1e6,
    sheetAreaM2:  sheetMm2   / 1e6,
    offcutAreaM2: offcutMm2  / 1e6,
    wastePercent: Math.round(wastePercent * 10) / 10,
    usableOffcuts,
  }
}

// ─── Публичная точка входа ────────────────────────────────────────────────────

export function calcSheetLayout(
  wallL: number,
  wallH: number,
  firstStud: number,
  step: number,
  gklLayers: 1 | 2,
  openings: Opening[],
  layer1Spec: BoardSpec,
  layer2Spec: BoardSpec,
  /** 1 = облицовка (одна сторона), 2 = перегородка (две стороны) */
  sides: 1 | 2 = 1,
): BoardSheetResult {
  // Один общий пул на все 4 экземпляра.
  // Порядок: А/сл1 → А/сл2 → Б/сл1 → Б/сл2
  // Обрезок из любого предыдущего слоя идёт в следующий.
  const sharedPool: PoolItem[] = []

  const args = (si: 0 | 1, layer: 1 | 2, spec: BoardSpec) =>
    [wallL, wallH, firstStud, step, openings, spec, layer, si, sharedPool] as const

  const l1A  = calcLayer(...args(0, 1, layer1Spec))
  const l2A  = gklLayers === 2 ? calcLayer(...args(0, 2, layer2Spec)) : null
  const l1B  = sides === 2 ? calcLayer(...args(1, 1, layer1Spec)) : null
  const l2B  = sides === 2 && gklLayers === 2 ? calcLayer(...args(1, 2, layer2Spec)) : null

  // Суммарная статистика
  const all  = [l1A, l2A, l1B, l2B].filter((x): x is BoardLayerLayout => x !== null)
  const totalSheetsNeeded = all.reduce((s, l) => s + l.sheetsNeeded, 0)
  const totalUsedAreaM2   = all.reduce((s, l) => s + l.usedAreaM2,   0)
  const totalSheetAreaM2  = all.reduce((s, l) => s + l.sheetAreaM2,  0)
  // Финальные обрезки — остаток общего пула
  const finalOffcuts = sharedPool.filter(p => !p.used && p.w >= 200 && p.h >= 200)
  const totalOffcutAreaM2 = finalOffcuts.reduce((s, p) => s + p.w * p.h, 0) / 1e6
  const totalWastePercent = totalSheetAreaM2 > 0
    ? Math.round((totalSheetAreaM2 - totalUsedAreaM2) / totalSheetAreaM2 * 1000) / 10
    : 0

  return {
    layer1: l1A,
    layer2: l2A,
    sideB_layer1: l1B,
    sideB_layer2: l2B,
    totalSheetsNeeded,
    totalUsedAreaM2,
    totalSheetAreaM2,
    totalOffcutAreaM2,
    totalWastePercent,
    finalOffcuts: finalOffcuts.map(p => ({ w: p.w, h: p.h, spec: layer1Spec })),
  }
}
