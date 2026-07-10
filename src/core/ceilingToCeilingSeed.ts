/**
 * Мост между отдельной сущностью «Потолок» (Ceiling — свободный контур,
 * обведённый по подложке/чертежу) и калькулятором потолка (CeilingCalc.tsx).
 *
 * Отдельно от slabToCeilingSeed.ts, хотя логика площади/периметра идентична —
 * Ceiling и Slab начали как одна и та же механика обводки, но это разные
 * сущности с разным смыслом (10.07.2026, см. types/index.ts), и держать мосты
 * раздельными проще, чем плодить условную ветвление внутри одной функции по
 * тому, откуда пришли данные.
 *
 * Ceiling пока сознательно без вырезов (holes) — holesCount всегда 0.
 */

import type { Ceiling } from '../types'
import { polygonArea, polygonPerimeter, type Point2D } from './geometry2d'

export interface CeilingSeedFromCeiling {
  areaSqm: number
  perimeterM: number
  holesCount: 0
}

function toMm(points: Point2D[], scaleMmPerPx: number): Point2D[] {
  return points.map(p => ({ x: p.x * scaleMmPerPx, y: p.y * scaleMmPerPx }))
}

/** null — если у контура меньше 3 точек (не может быть реальной фигурой). */
export function ceilingToCeilingSeed(ceiling: Ceiling, scaleMmPerPx: number): CeilingSeedFromCeiling | null {
  if (ceiling.outer.length < 3) return null

  const outerMm = toMm(ceiling.outer, scaleMmPerPx)
  const areaMm2 = polygonArea(outerMm)
  const perimeterMm = polygonPerimeter(outerMm)

  return {
    areaSqm: Math.round(Math.max(areaMm2, 0) / 1e6 * 100) / 100,
    perimeterM: Math.round(perimeterMm / 1000 * 100) / 100,
    holesCount: 0,
  }
}
