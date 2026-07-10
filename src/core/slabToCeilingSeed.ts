/**
 * Мост между «карандашом» (Slab — произвольный контур, обведённый по
 * подложке PDF) и калькулятором потолка (CeilingCalc.tsx).
 *
 * Для геометрически сложных помещений (не прямоугольник, углы не 90°)
 * пользователю проще обвести контур по факту на подложке, чем набирать
 * его стенами или вбивать одну длину/ширину — калькулятор потолка при
 * этом продолжает работать в режиме «площадь+периметр» (средний расход
 * на м², без точной раскладки листов — точная раскладка требует
 * прямоугольной геометрии, см. calcP112Frame.ts).
 */

import type { Slab } from '../types'
import { polygonArea, polygonPerimeter, type Point2D } from './geometry2d'

export interface CeilingSeedFromSlab {
  areaSqm: number
  perimeterM: number
  /** Кол-во вырезов (дырок) в плите — уже вычтены из areaSqm, но НЕ
   *  добавлены в periметр (обрамление вокруг вырезов профилем ПН —
   *  отдельный расчёт, не автоматизирован). */
  holesCount: number
  /** Внешний контур в мм (после масштабирования) — для визуального
   *  превью обведённой формы в калькуляторе потолка (CeilingCalc.tsx,
   *  см. KONSPEKT.md, пункт 3 "визуальный холст"), не только цифры
   *  площади/периметра. */
  outerMm: Point2D[]
  /** Вырезы в мм, для того же превью (рисуются как отверстия внутри
   *  контура). Площадь уже вычтена в areaSqm выше. */
  holesMm: Point2D[][]
}

function toMm(points: Point2D[], scaleMmPerPx: number): Point2D[] {
  return points.map(p => ({ x: p.x * scaleMmPerPx, y: p.y * scaleMmPerPx }))
}

/** null — если у плиты меньше 3 точек контура (не может быть реальной фигурой). */
export function slabToCeilingSeed(slab: Slab, scaleMmPerPx: number): CeilingSeedFromSlab | null {
  if (slab.outer.length < 3) return null

  const outerMm = toMm(slab.outer, scaleMmPerPx)
  let areaMm2 = polygonArea(outerMm)

  const validHoles = slab.holes.filter(h => h.length >= 3)
  for (const hole of validHoles) {
    areaMm2 -= polygonArea(toMm(hole, scaleMmPerPx))
  }

  const perimeterMm = polygonPerimeter(outerMm)

  return {
    areaSqm: Math.round(Math.max(areaMm2, 0) / 1e6 * 100) / 100,
    perimeterM: Math.round(perimeterMm / 1000 * 100) / 100,
    holesCount: validHoles.length,
    outerMm,
    holesMm: validHoles.map(h => toMm(h, scaleMmPerPx)),
  }
}
