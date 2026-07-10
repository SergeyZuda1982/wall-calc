/**
 * Мост между Room (замкнутый контур по стенам — второй, автоматический
 * способ получить периметр потолка, см. ceilingToCeilingSeed.ts для
 * первого способа — ручная обводка «Потолком»/«Плитой» до/без стен) и
 * калькулятором потолка (CeilingCalc.tsx).
 *
 * ⚠️ 10.07.2026, исправлено при первой реализации: extractContourPoints
 * возвращает точки В ТЕХ ЖЕ ЕДИНИЦАХ, что и PlanLine.x1/y1 — это ПИКСЕЛИ
 * холста подложки, НЕ мм (сверено с FloorPlan.tsx, пересчёт масштаба:
 * `polygonAreaM2(pts, newScale)` — принимает scale вторым параметром
 * именно потому, что pts ещё не в мм). Нужен scaleMmPerPx, как и у
 * slabToCeilingSeed.ts/ceilingToCeilingSeed.ts — без него площадь/периметр
 * были бы в px² и px, а не в м²/м.
 *
 * roomId прокидывается в CeilingSeed — по нему CeilingCalc.tsx понимает,
 * что сид пришёл из Room, и может предложить сохранить параметры каркаса
 * обратно на этот Room (updateRoom(roomId, { ceilingSpec })), откуда их
 * читает 3D-сцена (Scene3D.tsx → CeilingGridMesh). См. KONSPEKT.md,
 * "3D-сетка потолка по реальным настройкам" (10.07.2026).
 */

import type { Room, PlanLine } from '../types'
import { extractContourPoints } from './contour'
import { polygonArea, polygonPerimeter, type Point2D } from './geometry2d'
import type { CeilingSeed } from '../store/useCeilingSeedStore'

function toMm(points: Point2D[], scaleMmPerPx: number): Point2D[] {
  return points.map(p => ({ x: p.x * scaleMmPerPx, y: p.y * scaleMmPerPx }))
}

/** null — если контур помещения не собирается (меньше 3 точек: разомкнутые
 *  или удалённые линии периметра). */
export function roomToCeilingSeed(room: Room, lines: PlanLine[], scaleMmPerPx: number): CeilingSeed | null {
  const outerPx = extractContourPoints(room.lineIds, lines)
  if (outerPx.length < 3) return null
  const outerMm = toMm(outerPx, scaleMmPerPx)

  // Room уже хранит areaM2/perimeterMm (формула Гаусса, актуализируется при
  // правке стен, см. FloorPlan.tsx applyScale) — используем их как источник
  // истины вместо пересчёта, чтобы не разъезжаться с тем, что показано в
  // самом FloorPlan рядом с помещением. Контур нужен только для визуального
  // превью в CeilingCalc.
  const areaSqm = Math.round(Math.max(room.areaM2, 0) * 100) / 100
  const perimeterM = Math.round(room.perimeterMm / 1000 * 100) / 100

  return {
    label: room.label,
    areaSqm,
    perimeterM,
    holesCount: 0,
    zones: [{ label: room.label, areaSqm, perimeterM, outerMm, holesMm: [] }],
    roomId: room.id,
  }
}

// Экспортировано для тестов/переиспользования — площадь/периметр по
// геометрии контура (в мм), а не по кэшированным полям Room, на случай
// сверки/отладки расхождений.
export function roomOuterAreaPerimeterMm(room: Room, lines: PlanLine[], scaleMmPerPx: number) {
  const outerPx = extractContourPoints(room.lineIds, lines)
  if (outerPx.length < 3) return null
  const outerMm = toMm(outerPx, scaleMmPerPx)
  return { areaMm2: polygonArea(outerMm), perimeterMm: polygonPerimeter(outerMm) }
}
