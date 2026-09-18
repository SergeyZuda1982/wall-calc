/**
 * Расчёт материалов борта (короба) между двумя уровнями многоуровневого
 * потолка — см. архитектуру в data/ceilingBorderData.ts и комментарий у
 * типа CeilingBorder в types/index.ts (16.09.2026, тема "П19").
 *
 * Сами плоскости уровней считаются ОБЫЧНЫМ calcCeiling() (П112/П113) без
 * изменений — этот файл считает только соединяющий их узел.
 *
 * ⚠️ v1 (16.09.2026, этап 1 из 5, см. переписку): чистая расчётная логика,
 * НЕ подключена к calcCeiling()/UI/плану/3D — только типы + этот файл +
 * тесты. Следующие этапы: 2) суммирование в calcCeiling() для типа 'p19',
 * 3) UI полного калькулятора, 4) рисование борта на плане, 5) 3D.
 */

import type { CeilingBorder } from '../types'
import { CEILING_BORDER_JOINT_RATES, CEILING_BORDER_SHEET_WIDTH_MM } from '../data/ceilingBorderData'
import { polylineLength, type Point2D } from './geometry2d'
import { BAR_LENGTH } from './cutList'

export interface CeilingBorderMaterialItem {
  name: string
  unit: string
  qty: number
  /** Расход на погонный метр борта (для справки), если применимо */
  ratePerM?: number
}

export interface CeilingBorderCalcResult {
  pathLengthM: number
  /** Внутренние вершины пути (не считая концов) — справочно, для UI */
  cornerCount: number
  /** Число угловых соединителей = число вертикальных отрезков профиля 60×27 */
  connectorCount: number
  materials: CeilingBorderMaterialItem[]
  warnings: string[]
}

/** Позиции соединителей вдоль ОДНОГО прямого отрезка длиной segLenMm, шаг
 *  ~stepMm — включает ОБА конца отрезка (0 и segLenMm), поэтому вершины
 *  пути (в т.ч. углы) всегда получают соединитель. Фактический шаг слегка
 *  корректируется, чтобы уложить целое число интервалов на отрезок — как и
 *  у остального крепежа в проекте (см. calcP112Frame.ts), это не строгий
 *  шаг "ровно 300/600мм", а "не реже, чем step". */
function positionsAlongSegment(segLenMm: number, stepMm: number): number[] {
  if (segLenMm <= 0) return [0]
  const count = Math.max(1, Math.round(segLenMm / stepMm))
  const actualStep = segLenMm / count
  const positions: number[] = []
  for (let i = 0; i <= count; i++) positions.push(i * actualStep)
  return positions
}

/** Число позиций вдоль ВСЕГО пути (возможно, ломаного) с шагом stepMm, без
 *  двойного счёта общих вершин между соседними отрезками. Если путь
 *  замкнут явным повтором первой точки в конце (см. комментарий у
 *  CeilingBorder.path) — точка стыка тоже не задваивается, т.к. это просто
 *  ещё одна общая вершина двух соседних отрезков. */
function countPositionsAlongPath(path: Point2D[], stepMm: number): number {
  if (path.length < 2) return path.length
  let total = 0
  for (let i = 0; i < path.length - 1; i++) {
    const segLen = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y)
    const segPositions = positionsAlongSegment(segLen, stepMm).length
    // первая позиция отрезка совпадает с последней позицией предыдущего
    // отрезка (общая вершина) — не считаем её второй раз, кроме самого
    // первого отрезка пути.
    total += i === 0 ? segPositions : segPositions - 1
  }
  return total
}

export function calcCeilingBorder(border: CeilingBorder): CeilingBorderCalcResult {
  const warnings: string[] = []
  const pathLengthMm = polylineLength(border.path)
  const pathLengthM = pathLengthMm / 1000
  const cornerCount = Math.max(0, border.path.length - 2)

  if (pathLengthMm <= 0) {
    return {
      pathLengthM: 0,
      cornerCount: 0,
      connectorCount: 0,
      materials: [],
      warnings: ['Путь борта пуст или имеет нулевую длину — материалы не посчитаны.'],
    }
  }

  const rates = CEILING_BORDER_JOINT_RATES[border.jointType]

  // ── Угловые соединители / вертикальный профиль 60×27 ────────────────────
  const connectorCount = countPositionsAlongPath(border.path, border.stepCMm)
  const verticalProfileCount = connectorCount // один вертикальный отрезок на каждый соединитель

  const piecesPerBarVertical = Math.max(1, Math.floor(BAR_LENGTH / border.dropMm))
  const verticalBars = Math.ceil(verticalProfileCount / piecesPerBarVertical)
  if (border.dropMm > BAR_LENGTH) {
    warnings.push(
      `Опуск борта (${border.dropMm}мм) больше стандартного прутка ${BAR_LENGTH}мм — ` +
      `вертикальный профиль потребует сращивания, в расчёте не учтено.`
    )
  }

  // ── Верхний профиль 27×28, по всей длине пути ────────────────────────────
  const topProfileBars = Math.ceil(pathLengthMm / BAR_LENGTH)
  const topProfileFixCount = countPositionsAlongPath(border.path, rates.topProfileFixStepMm)

  // ── Саморезы ──────────────────────────────────────────────────────────
  const lnCount = connectorCount * rates.lnPerConnector
  const tnCount = verticalProfileCount * rates.tnPerVerticalProfile

  // ── Обшивка (один фрезерованный лист на погонную длину, см. комментарий
  //    в data/ceilingBorderData.ts — площадь/раскрой листов, не точная
  //    раскладка кусков) ────────────────────────────────────────────────
  const stripWidthMm = border.dropMm + border.shelfDepthMm
  let lanesPerSheet = Math.floor(CEILING_BORDER_SHEET_WIDTH_MM / stripWidthMm)
  if (lanesPerSheet < 1) {
    lanesPerSheet = 1
    warnings.push(
      `Ширина полосы борта (опуск+полка = ${stripWidthMm}мм) больше ширины листа ` +
      `${CEILING_BORDER_SHEET_WIDTH_MM}мм — расчёт листов занижен, нужна ручная раскладка.`
    )
  }
  const sheetCoveragePerSheetMm = border.sheetLengthMm * lanesPerSheet
  const sheetCount = Math.ceil(pathLengthMm / sheetCoveragePerSheetMm)

  warnings.push(
    'Обшивка борта посчитана по площади полосы (опуск+полка) вдоль пути, БЕЗ точной ' +
    'раскладки кусков с учётом фрезеровки под 90° и стыков — оценка количества листов, ' +
    'не чертёж раскроя (как есть у П112/П113 через calcPolygonSheetLayout.ts).'
  )
  warnings.push(
    'Расход монтажной клей-пены (проклейка фрезерованного шва) не оценивается — ' +
    'норма не задана.'
  )

  const materials: CeilingBorderMaterialItem[] = [
    { name: 'Соединитель угловой 90°', unit: 'шт', qty: connectorCount },
    {
      name: 'Профиль ПП 60×27 (вертикальный, борт)',
      unit: `шт (пруток ${BAR_LENGTH / 1000}м)`,
      qty: verticalBars,
    },
    {
      name: 'Профиль ПНП 27×28 (верх борта)',
      unit: `шт (пруток ${BAR_LENGTH / 1000}м)`,
      qty: topProfileBars,
    },
    { name: 'Саморез LN (угловые соединители)', unit: 'шт', qty: lnCount },
    { name: 'Саморез TN (вертикальный профиль)', unit: 'шт', qty: tnCount },
    {
      name: 'Саморез (крепление ПНП 27×28 к верхнему уровню через ГКЛ)',
      unit: 'шт',
      qty: topProfileFixCount,
    },
    { name: 'ГКЛ-лист (обшивка борта, фрезерованный)', unit: 'лист', qty: sheetCount },
  ]

  return { pathLengthM, cornerCount, connectorCount, materials, warnings }
}
