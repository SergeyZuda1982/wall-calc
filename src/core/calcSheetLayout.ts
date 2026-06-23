/**
 * Раскрой листов ГСП (ГКЛ / ГВЛ / Сапфир / Аквамарин) для одной стены.
 *
 * Правила (Кнауф, п.8.16 + Схема 4):
 * — Листы стоят вертикально, стык по оси стоечного профиля.
 * — Слой 1: первая колонка = firstStud мм (от Wall-стойки до первого ПС).
 * — Слой 2: сдвинут на шаг стоек (step). Первая колонка = (firstStud+step)%1200 || 1200.
 * — Всё что попадает в зону проёма → пул отходов (void).
 * — Пул обрезков: ширина 1200 (горизонтальный рез) или остаток по высоте.
 * — Переиспользование жадное: сначала подходящий обрезок, потом новый лист.
 */

import type {
  Opening, BoardSpec, BoardPiece, BoardColumn,
  BoardOffcut, BoardLayerLayout, BoardSheetResult,
} from '../types'

const SHEET_W = 1200  // ширина листа всегда 1200 мм

// ─── Вспомогательные ─────────────────────────────────────────────────────────

/** Границы колонок для заданного слоя */
function columnBoundaries(
  firstStud: number,
  step: number,
  wallL: number,
  layer: 1 | 2,
): number[] {
  const firstW = layer === 1
    ? firstStud
    : (() => { const r = (firstStud + step) % SHEET_W; return r === 0 ? SHEET_W : r })()

  const pts: number[] = [0]
  if (firstW < wallL) {
    pts.push(firstW)
    let p = firstW
    while (p + SHEET_W < wallL) { p += SHEET_W; pts.push(p) }
  }
  if (pts[pts.length - 1] !== wallL) pts.push(wallL)
  return pts
}

/**
 * «Пустые» зоны в колонке [x1,x2] по высоте — то что занимают проёмы.
 * Возвращает массив [yBottom, yTop] — диапазоны куда лист класть НЕ надо.
 */
function voidZones(
  x1: number, x2: number,
  openings: Opening[],
): Array<[number, number]> {
  const voids: Array<[number, number]> = []
  for (const op of openings.filter(o => o.width > 0)) {
    const oL = op.pos - op.width / 2
    const oR = op.pos + op.width / 2
    if (Math.max(x1, oL) >= Math.min(x2, oR)) continue  // нет перекрытия
    const oBottom = op.sillHeight
    const oTop    = op.sillHeight + op.height
    voids.push([oBottom, oTop])
  }
  return voids
}

/**
 * «Рабочие» зоны в колонке: [0, wallH] минус void-зоны.
 * Возвращает отсортированный массив [yBottom, yTop].
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

// ─── Жадный пул обрезков ─────────────────────────────────────────────────────

interface PoolItem { w: number; h: number; used: boolean }

/** Берём первый подходящий обрезок из пула (жадно, первое подходящее) */
function takeFromPool(pool: PoolItem[], needW: number, needH: number): PoolItem | null {
  for (const item of pool) {
    if (!item.used && item.w >= needW && item.h >= needH) {
      item.used = true
      return item
    }
  }
  return null
}

// ─── Основной алгоритм ───────────────────────────────────────────────────────

function calcLayer(
  wallL: number,
  wallH: number,
  firstStud: number,
  step: number,
  openings: Opening[],
  spec: BoardSpec,
  layer: 1 | 2,
): BoardLayerLayout {
  const SL = spec.sheetLength

  const bounds  = columnBoundaries(firstStud, step, wallL, layer)
  const columns: BoardColumn[] = []

  // Пул обрезков этой стены (жадное межколоночное переиспользование)
  const pool: PoolItem[] = []

  let sheetsNeeded = 0
  let usedMm2      = 0     // площадь листов на стене
  let sheetMm2     = 0     // площадь купленных листов

  for (let i = 0; i < bounds.length - 1; i++) {
    const x1 = bounds[i]
    const x2 = bounds[i + 1]
    const cw  = x2 - x1         // ширина колонки

    const voids = voidZones(x1, x2, openings)
    const work  = workZones(wallH, voids)
    const pieces: BoardPiece[] = []

    // Void-зоны — добавляем как opening_void для Canvas
    for (const [vB, vT] of voids) {
      const clampB = Math.max(0, vB)
      const clampT = Math.min(wallH, vT)
      if (clampT > clampB) {
        pieces.push({ x: x1, y: clampB, w: cw, h: clampT - clampB, kind: 'opening_void', source: 'new_sheet' })
      }
    }

    // Рабочие зоны — раскладываем листы
    for (const [z1, z2] of work) {
      let y = z1
      while (y < z2) {
        const ph = Math.min(SL, z2 - y)  // высота куска

        // Пробуем взять из пула
        const fromPool = takeFromPool(pool, cw, ph)

        let source: BoardPiece['source']
        if (fromPool) {
          source = 'offcut'
          // Остаток обрезка (если выше нужного) — добавляем обратно в пул
          if (fromPool.h > ph) {
            pool.push({ w: fromPool.w, h: fromPool.h - ph, used: false })
          }
          // Боковой остаток (если шире нужного) — в пул
          if (fromPool.w > cw) {
            pool.push({ w: fromPool.w - cw, h: ph, used: false })
          }
        } else {
          // Открываем новый лист
          source = 'new_sheet'
          sheetsNeeded++
          sheetMm2 += SHEET_W * SL

          // Боковой обрезок (если колонка уже листа)
          if (cw < SHEET_W) {
            pool.push({ w: SHEET_W - cw, h: SL, used: false })
          }
          // Высотный обрезок (если кусок короче листа)
          if (ph < SL) {
            pool.push({ w: cw, h: SL - ph, used: false })
          }
        }

        // Определяем вид куска
        const widthCut  = cw < SHEET_W
        const heightCut = ph < SL
        const kind: BoardPiece['kind'] =
          widthCut && heightCut ? 'both_cut'
          : widthCut            ? 'width_cut'
          : heightCut           ? 'height_cut'
          : 'full'

        pieces.push({ x: x1, y, w: cw, h: ph, kind, source })
        usedMm2 += cw * ph
        y += ph
      }
    }

    columns.push({ x1, x2, pieces })
  }

  // Неиспользованные обрезки из пула → usableOffcuts
  const usableOffcuts: BoardOffcut[] = pool
    .filter(p => !p.used && p.w >= 200 && p.h >= 200)
    .map(p => ({ w: p.w, h: p.h, spec }))

  const offcutMm2 = usableOffcuts.reduce((s, o) => s + o.w * o.h, 0)
  const wasteMm2  = sheetMm2 - usedMm2
  const wastePercent = sheetMm2 > 0 ? (wasteMm2 / sheetMm2) * 100 : 0

  return {
    layer,
    spec,
    columns,
    sheetsNeeded,
    usedAreaM2:    usedMm2    / 1e6,
    sheetAreaM2:   sheetMm2   / 1e6,
    offcutAreaM2:  offcutMm2  / 1e6,
    wastePercent:  Math.round(wastePercent * 10) / 10,
    usableOffcuts,
  }
}

/** Публичная точка входа — считает раскрой для 1 или 2 слоёв */
export function calcSheetLayout(
  wallL: number,
  wallH: number,
  firstStud: number,
  step: number,
  gklLayers: 1 | 2,
  openings: Opening[],
  layer1Spec: BoardSpec,
  layer2Spec: BoardSpec,
): BoardSheetResult {
  return {
    layer1: calcLayer(wallL, wallH, firstStud, step, openings, layer1Spec, 1),
    layer2: gklLayers === 2
      ? calcLayer(wallL, wallH, firstStud, step, openings, layer2Spec, 2)
      : null,
  }
}
