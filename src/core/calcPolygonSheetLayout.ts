/**
 * Раскрой листов ГКЛ/ГВЛ для ПРОИЗВОЛЬНОГО (в т.ч. вогнутого) контура потолка
 * — вторая часть пункта 6 плана (KONSPEKT.md 10.07.2026), см. также
 * calcPolygonP112Frame.ts (каркас) для системы координат/идеи алгоритма.
 *
 * ─── Идея алгоритма (переписано 12.07.2026) ────────────────────────────────
 * Листы кладутся "полосами" шириной SHEET_W (1200мм) вдоль оси V (вглубь от
 * стены старта), внутри полосы — листами длиной sheetLengthMm вдоль оси U.
 * Каждая полоса обрезается контуром — как правило, распадается на несколько
 * отдельных отрезков (вогнутая форма), внутри КАЖДОГО отрезка отдельно
 * считаем целые/резаные листы.
 *
 * Раньше (до 12.07.2026) это была просто СМЕТНАЯ прикидка — количество
 * листов без координат каждого куска. Пользователь попросил переиспользовать
 * для потолка ту же механику, что уже есть для перегородок/облицовок
 * (calcSheetLayout.ts): реальные куски с координатами, смещение 2-го слоя
 * "вразбежку" относительно 1-го (та же 4-значная схема vOffset — экспортирована
 * оттуда как zoneJoints, здесь НЕ дублируется), и сквозной пул обрезков
 * (takeFromPool — тоже оттуда), чтобы обрезки от стен/облицовок могли пойти
 * в дело на потолке (и наоборот), см. calcProjectSheetLayout.ts.
 *
 * ─── Соответствие модели стены (calcSheetLayout.ts) ────────────────────────
 * Там: колонка вдоль стены (x1..x2, ширина cw≤1200) × вся высота стены,
 * поделенная на куски по SL с 4-значным vOffset(globalSlot, layer, sideIndex).
 * Здесь: полоса вдоль V (v1..v2, ширина ≤1200 = аналог cw) × отрезок(и) вдоль
 * U внутри контура (аналог "рабочих зон" колонки), поделенный на куски по SL
 * с ТЕМ ЖЕ vOffset(bandIndex, layer) — bandIndex вместо globalSlot, sideIndex
 * всегда 0 (у потолка одна "сторона", в отличие от перегородки).
 * Смещение слоя 2 дополнительно сдвигает саму сетку полос на SHEET_W/2 —
 * у стены аналога нет (там всего один "слой полос" — стойки), это добавка,
 * специфичная для двухслойной обшивки потолка плашмя.
 *
 * ─── Осознанное упрощение (не менялось, из v1 10.07.2026) ──────────────────
 * Ширина покрытия полосы определяется ПО ЦЕНТРАЛЬНОЙ ЛИНИИ полосы (одна
 * скан-линия на полосу), а не точным пересечением прямоугольной полосы
 * целиком с контуром. На прямых участках это точно; у вогнутого угла,
 * который "срезает" полосу НЕ по всей её ширине 1200мм, а частично —
 * возможна small-погрешность в 1 лист туда-сюда у самого угла. Для сметы
 * (не для миллиметрового чертежа реза) это приемлемо; отмечено явно, чтобы
 * не выдавать за более точный результат, чем он есть.
 *
 * ─── 12.07.2026: контур по ОБЕ стороны от стены старта ─────────────────────
 * Раньше (как и в calcPolygonP112Frame.ts до фикса того же дня) полосы
 * строились только от 0 (стены) и дальше в плюс (Math.max(0, vMax)) — часть
 * контура "позади" стены не попадала в раскрой вообще. Теперь диапазон
 * полос считается по РЕАЛЬНЫМ vMin..vMax (может быть отрицательным).
 */

import type { Point2D } from './geometry2d'
import { insideSegments } from './geometry2d'
import { buildLocalFrame, polygonsToLocal } from './calcPolygonP112Frame'
import { zoneJoints, takeFromPool, type PoolItem } from './calcSheetLayout'
import type { BoardSpec, BoardOffcut } from '../types'
import { DEFAULT_BOARD_SPEC } from '../types'

const SHEET_W = 1200

// ─── Кусок листа с реальными координатами ───────────────────────────────────

export interface PolygonSheetPiece {
  /** мм, локальные координаты той же системы, что calcPolygonP112Frame
   *  (U — вдоль стены старта, V — вглубь от неё; могут быть отрицательными,
   *  см. заголовок файла про обе стороны от стены). */
  u1: number
  u2: number
  v1: number
  v2: number
  /** length_cut — обрезан вдоль U (короче листа); width_cut — обрезана полоса
   *  вдоль V (уже 1200мм, у края контура); both_cut — и то и другое. */
  kind: 'full' | 'length_cut' | 'width_cut' | 'both_cut'
  source: 'new_sheet' | 'offcut'
}

export interface PolygonSheetLayerResult {
  layer: 1 | 2
  spec: BoardSpec
  pieces: PolygonSheetPiece[]
  sheetsNeeded: number
  usedAreaM2: number
  sheetAreaM2: number
  offcutAreaM2: number
  wastePercent: number
  usableOffcuts: BoardOffcut[]
}

export interface PolygonSheetLayoutResult {
  sheetW: number
  sheetL: number
  /** Листы повёрнуты (длинная сторона идёт вдоль стены, а не вглубь). */
  rotated: boolean

  // ── Агрегат по слою 1 — сохранено для обратной совместимости с уже
  // написанным кодом/тестами (calcCeiling.ts читает именно эти поля). ──────
  totalSheets: number
  fullSheets: number
  cutSheets: number
  /** Обрезки [длина, ширина], мм — для справки/визуализации. */
  offcuts: [number, number][]

  // ── 12.07.2026: детальная раскладка по кускам, слой 2 "вразбежку",
  // сквозной пул обрезков (см. заголовок файла). ──────────────────────────
  layer1: PolygonSheetLayerResult
  layer2: PolygonSheetLayerResult | null
  totalSheetsNeeded: number
  totalUsedAreaM2: number
  totalSheetAreaM2: number
  totalOffcutAreaM2: number
  totalWastePercent: number
  /** Финальные обрезки общего пула (уходят в следующую конструкцию объекта). */
  finalOffcuts: BoardOffcut[]
}

// ─── Быстрая прикидка (только для выбора ориентации — без слоя/пула) ───────

function calcOneOrientation(loopsLocal: Point2D[][], vMin: number, vMax: number, sheetL: number): {
  totalSheets: number; fullSheets: number; cutSheets: number
  offcuts: [number, number][]; wasteArea: number
} {
  let fullSheets = 0
  let cutSheets = 0
  const offcuts: [number, number][] = []
  let bandStart = vMin
  while (bandStart < vMax) {
    const bandCenter = Math.min(bandStart + SHEET_W / 2, vMax - 1e-6)
    const segs = insideSegments(loopsLocal, bandCenter, 'y')
    for (const [a, b] of segs) {
      const lengthMm = b - a
      if (lengthMm <= 0) continue
      const full = Math.floor(lengthMm / sheetL)
      const remainder = lengthMm - full * sheetL
      fullSheets += full
      if (remainder > 1) {
        cutSheets += 1
        offcuts.push([remainder, SHEET_W])
      }
    }
    bandStart += SHEET_W
  }
  const totalSheets = fullSheets + cutSheets
  const wasteArea = offcuts.reduce((s, [l, w]) => s + l * w, 0)
  return { totalSheets, fullSheets, cutSheets, offcuts, wasteArea }
}

// ─── Границы полос вдоль V — периодическая сетка с фазой, покрывает весь
// диапазон [vMin, vMax] (включая отрицательную сторону), см. заголовок. ────

function bandBoundaries(vMin: number, vMax: number, bandW: number, phaseMm: number): number[] {
  const first = phaseMm + Math.floor((vMin - phaseMm) / bandW) * bandW
  const pts = new Set<number>([vMin, vMax])
  let v = first
  while (v <= vMin) v += bandW
  while (v < vMax) { pts.add(v); v += bandW }
  return [...pts].sort((a, b) => a - b)
}

// ─── Детальный раскрой одного слоя (реальные куски + пул) ──────────────────

function calcLayerDetailed(
  loopsLocal: Point2D[][],
  vMin: number, vMax: number,
  sheetL: number,
  layer: 1 | 2,
  spec: BoardSpec,
  sharedPool: PoolItem[],
): PolygonSheetLayerResult {
  // Слой 2 сдвигает саму сетку полос на пол-ширины листа — швы между полосами
  // не совпадают со швами слоя 1 (см. заголовок файла).
  const bandPhase = layer === 2 ? SHEET_W / 2 : 0
  const bounds = bandBoundaries(vMin, vMax, SHEET_W, bandPhase)

  const pieces: PolygonSheetPiece[] = []
  let sheetsNeeded = 0
  let usedMm2 = 0
  let sheetMm2 = 0

  for (let bi = 0; bi < bounds.length - 1; bi++) {
    const v1 = bounds[bi]
    const v2 = bounds[bi + 1]
    const cw = v2 - v1
    if (cw <= 0) continue
    const bandCenter = Math.min(v1 + cw / 2, vMax - 1e-6)
    const segs = insideSegments(loopsLocal, bandCenter, 'y')

    // Та же 4-значная схема, что и у стен/облицовок (calcSheetLayout.ts,
    // zoneJoints) — bandIndex играет роль globalSlot, sideIndex всегда 0
    // (у потолка одна "сторона"), +2 слота для слоя 2 (сдвиг на SL/2).
    const bandIndex = Math.round((v1 - bandPhase) / SHEET_W)
    const vOffset = ((bandIndex + (layer === 2 ? 2 : 0)) % 4 + 4) % 4 * (sheetL / 4)

    for (const [a, b] of segs) {
      const runLen = b - a
      if (runLen <= 0) continue
      const joints = zoneJoints(0, runLen, sheetL, vOffset)

      for (let k = 0; k < joints.length - 1; k++) {
        const u1 = a + joints[k]
        const u2 = a + joints[k + 1]
        const ph = u2 - u1
        if (ph <= 0) continue

        const fromPool = takeFromPool(sharedPool, cw, ph)
        let source: PolygonSheetPiece['source']
        if (fromPool) {
          source = 'offcut'
          if (fromPool.h - ph >= 200) sharedPool.push({ w: fromPool.w, h: fromPool.h - ph, used: false })
          if (fromPool.w - cw >= 200) sharedPool.push({ w: fromPool.w - cw, h: ph, used: false })
        } else {
          source = 'new_sheet'
          sheetsNeeded++
          sheetMm2 += SHEET_W * sheetL
          if (SHEET_W - cw >= 200) sharedPool.push({ w: SHEET_W - cw, h: sheetL, used: false })
          if (sheetL - ph >= 200) sharedPool.push({ w: cw, h: sheetL - ph, used: false })
        }

        const lengthCut = ph < sheetL
        const widthCut = cw < SHEET_W
        const kind: PolygonSheetPiece['kind'] =
          lengthCut && widthCut ? 'both_cut'
          : widthCut ? 'width_cut'
          : lengthCut ? 'length_cut'
          : 'full'

        pieces.push({ u1, u2, v1, v2, kind, source })
        usedMm2 += cw * ph
      }
    }
  }

  const usableOffcuts: BoardOffcut[] = sharedPool
    .filter(p => !p.used && p.w >= 200 && p.h >= 200)
    .map(p => ({ w: p.w, h: p.h, spec }))
  const offcutMm2 = usableOffcuts.reduce((s, o) => s + o.w * o.h, 0)
  const wastePercent = sheetMm2 > 0 ? Math.max(0, (sheetMm2 - usedMm2) / sheetMm2 * 100) : 0

  return {
    layer, spec, pieces, sheetsNeeded,
    usedAreaM2: usedMm2 / 1e6,
    sheetAreaM2: sheetMm2 / 1e6,
    offcutAreaM2: offcutMm2 / 1e6,
    wastePercent: Math.round(wastePercent * 10) / 10,
    usableOffcuts,
  }
}

/**
 * Раскрой листов для контура произвольной формы, с автовыбором ориентации
 * (полосы вдоль V вглубь / вдоль U вдоль стены — берём вариант с меньшим
 * числом листов, при равенстве — с меньшими отходами), см. calcCeiling.ts
 * (calcCeilingSheetLayout) для аналогичной логики на прямоугольнике.
 *
 * gklLayers/specs/initialPool — необязательные (12.07.2026), по умолчанию
 * даёт старое поведение (1 слой, без пула) для существующих вызовов.
 */
export function calcPolygonSheetLayout(
  outerMm: Point2D[],
  holesMm: Point2D[][],
  startSide: { start: Point2D; end: Point2D },
  sheetLengthMm = 2500,
  gklLayers: 1 | 2 = 1,
  layer1Spec: BoardSpec = DEFAULT_BOARD_SPEC,
  layer2Spec: BoardSpec = DEFAULT_BOARD_SPEC,
  initialPool: BoardOffcut[] = [],
): PolygonSheetLayoutResult | null {
  if (outerMm.length < 3) return null

  const frame = buildLocalFrame(startSide, outerMm)
  const loopsLocal = polygonsToLocal([outerMm, ...holesMm], frame)
  const outerLocal = loopsLocal[0]
  const uMin = Math.min(0, ...outerLocal.map(p => p.x))
  const uMax = Math.max(0, ...outerLocal.map(p => p.x))
  const vMin = Math.min(0, ...outerLocal.map(p => p.y))
  const vMax = Math.max(0, ...outerLocal.map(p => p.y))

  // Вариант А: полосы вдоль V (вглубь от стены), листы длиной sheetLengthMm
  // вдоль U (вдоль стены).
  const varA = calcOneOrientation(loopsLocal, vMin, vMax, sheetLengthMm)

  // Вариант Б: полосы вдоль U (вдоль стены), листы вдоль V (вглубь).
  // Транспонируем координаты (x<->y), чтобы переиспользовать ту же функцию.
  const loopsLocalT = loopsLocal.map(loop => loop.map(p => ({ x: p.y, y: p.x })))
  const varB = calcOneOrientation(loopsLocalT, uMin, uMax, sheetLengthMm)

  const useRotated = varB.totalSheets < varA.totalSheets ||
    (varB.totalSheets === varA.totalSheets && varB.wasteArea < varA.wasteArea)

  const chosenLoops = useRotated ? loopsLocalT : loopsLocal
  const [chosenMin, chosenMax] = useRotated ? [uMin, uMax] : [vMin, vMax]

  const sharedPool: PoolItem[] = initialPool.map(o => ({ ...o, used: false }))
  const layer1 = calcLayerDetailed(chosenLoops, chosenMin, chosenMax, sheetLengthMm, 1, layer1Spec, sharedPool)
  const layer2 = gklLayers === 2
    ? calcLayerDetailed(chosenLoops, chosenMin, chosenMax, sheetLengthMm, 2, layer2Spec, sharedPool)
    : null

  const all = [layer1, layer2].filter((l): l is PolygonSheetLayerResult => l !== null)
  const totalSheetsNeeded = all.reduce((s, l) => s + l.sheetsNeeded, 0)
  const totalUsedAreaM2 = all.reduce((s, l) => s + l.usedAreaM2, 0)
  const totalSheetAreaM2 = all.reduce((s, l) => s + l.sheetAreaM2, 0)
  const finalOffcuts = sharedPool.filter(p => !p.used && p.w >= 200 && p.h >= 200)
  const totalOffcutAreaM2 = finalOffcuts.reduce((s, p) => s + p.w * p.h, 0) / 1e6
  const totalWastePercent = totalSheetAreaM2 > 0
    ? Math.round((totalSheetAreaM2 - totalUsedAreaM2) / totalSheetAreaM2 * 1000) / 10
    : 0

  const fullSheets = layer1.pieces.filter(p => p.kind === 'full').length
  const cutSheets = layer1.pieces.length - fullSheets
  const offcuts: [number, number][] = layer1.pieces
    .filter(p => p.kind !== 'full')
    .map(p => [p.u2 - p.u1, p.v2 - p.v1])

  return {
    sheetW: SHEET_W,
    sheetL: sheetLengthMm,
    rotated: useRotated,
    totalSheets: layer1.pieces.length,
    fullSheets,
    cutSheets,
    offcuts,
    layer1,
    layer2,
    totalSheetsNeeded,
    totalUsedAreaM2,
    totalSheetAreaM2,
    totalOffcutAreaM2,
    totalWastePercent,
    finalOffcuts: finalOffcuts.map(p => ({ w: p.w, h: p.h, spec: layer1Spec })),
  }
}
