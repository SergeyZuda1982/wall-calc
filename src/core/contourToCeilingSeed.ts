/**
 * contourToCeilingSeed.ts — мост от вкладки «Контур потолка» (ContourCalc.tsx)
 * к калькулятору потолков (CeilingCalc.tsx) через useCeilingSeedStore.
 *
 * Контур с дугами переводится в обычную ломаную в мм: дуги разбиваются на отрезки
 * с отклонением от настоящей дуги не больше `dev` мм (по умолчанию 1 мм).
 * Калькулятор потолков работает с ломаными, поэтому раскладка и каркас там
 * считаются по этой ломаной; ординаты реза по дугам остаются во вкладке «Контур».
 *
 * Площадь и периметр в семени — ТОЧНЫЕ (сегменты кругов и длины дуг), а не по
 * ломаной, как у roomToCeilingSeed (источник истины — само помещение).
 *
 * Система координат: на плане и в калькуляторе Y направлена ВНИЗ (экран), во
 * вкладке «Контур» — вверх, поэтому Y отражается, форма на превью выглядит так же,
 * как была нарисована.
 */

import type { CeilingSeed } from '../store/useCeilingSeedStore'
import { contourAreaMm2, contourPerimeterMm, tessellate, validateContour, type ContourVertex } from './calcContourLayout'

const round2 = (x: number) => Math.round(x * 100) / 100

export interface ContourSeedOptions {
  label?: string
  /** Опорная сторона раскладки: если она прямая, калькулятор потолков сразу получит её как стену начала. */
  refEdge?: number
  /** Допуск разбиения дуг, мм. */
  dev?: number
}

/** null — контур не годится для расчёта (меньше 3 вершин, самопересечение и т.п.). */
export function contourToCeilingSeed(vertices: ContourVertex[], opts: ContourSeedOptions = {}): CeilingSeed | null {
  if (validateContour(vertices) !== null) return null
  const label = opts.label?.trim() || 'Контур потолка'
  const pts = tessellate(vertices, opts.dev ?? 1)
  const outerMm = pts.map(p => ({ x: p.x, y: -p.y }))
  const areaSqm = round2(contourAreaMm2(vertices) / 1e6)
  const perimeterM = round2(contourPerimeterMm(vertices) / 1000)

  let startSideIndex: number | undefined
  const ref = opts.refEdge
  if (ref !== undefined && ref >= 0 && ref < vertices.length && !vertices[ref].sag) {
    const idx = pts.findIndex(p => p.c && p.e === ref)
    if (idx >= 0) startSideIndex = idx
  }

  return {
    label, areaSqm, perimeterM, holesCount: 0, source: 'contour',
    zones: [{ label, areaSqm, perimeterM, outerMm, holesMm: [] }],
    ...(startSideIndex !== undefined ? { startSideIndex } : {}),
  }
}
