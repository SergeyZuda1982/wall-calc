/**
 * Остаточные зоны плиты (18.09.2026, объект «Ростов», запрос пользователя).
 *
 * Контекст: Плита (Slab) — это монолитное перекрытие целиком. Внутри неё
 * пользователь обводит отдельные Room (помещения) — у каждого уже есть свой
 * чек-лист "Пол"/"Потолок" (Room.floorProgress/ceilingProgress). Но часть
 * площади плиты (коридоры, техзоны, вообще всё, что ещё не обвели Room)
 * никаким Room не покрыта — а статус по ней всё равно нужен, и разным
 * несвязным кускам этой площади может требоваться РАЗНЫЙ статус (в реальном
 * кейсе — известна отделка большого зала, но не двух коридоров, которые к
 * тому же физически отрезаны друг от друга).
 *
 * computeSlabResidualPolygons — чистая геометрия: Slab.outer минус
 * объединение контуров всех Room (через extractContourPoints) минус
 * Slab.holes, все в px (как и остальной план). Использует уже проверенный
 * subtractPolygons (polygon-clipping) из geometry2d.ts — не изобретаем
 * булевы операции заново.
 *
 * matchSlabZones — сопоставление свежего пересчёта со старыми SlabZone по
 * ближайшему центроиду (жадно, без внешней библиотеки паросочетаний — кусков
 * обычно единицы). Старые зоны, которым не нашлось пары в этот раз (Room
 * закрыла кусок целиком), НЕ удаляются — помечаются live=false и остаются в
 * массиве, чтобы прогресс не терялся, если контур Room потом уберут обратно.
 *
 * Пересчёт запускается ТОЛЬКО по явному клику пользователя (кнопка
 * "Пересчитать зоны" в панели плиты), не на каждый рендер — иначе это было
 * бы побочным эффектом в рендере и непредсказуемо дёргало бы уже отмеченный
 * прогресс при любой сторонней правке контура помещения.
 */

import type { PlanLine, Room, Slab, SlabZone } from '../types'
import { extractContourPoints } from './contour'
import { polygonArea, subtractPolygons, type Point2D } from './geometry2d'

/** Центроид простого многоугольника (среднее вершин — для этой задачи
 *  точности "центр масс по вершинам" достаточно, это не приёмка формы). */
function centroid(points: Point2D[]): Point2D {
  const n = points.length
  const sx = points.reduce((s, p) => s + p.x, 0)
  const sy = points.reduce((s, p) => s + p.y, 0)
  return { x: sx / n, y: sy / n }
}

function dist2(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Room, контур которых физически лежит (полностью или частично) на этой
 * плите — берём ВСЕ Room с этого же этажа (передаются вызывающим кодом уже
 * отфильтрованными по этажу, как и slabs/lines в FloorPlan.tsx) и с
 * контуром из >=3 точек; subtractPolygons сам корректно обработает случаи,
 * когда Room вообще не пересекается с Slab (тогда просто не повлияет).
 */
export function computeSlabResidualPolygons(
  slab: Slab,
  rooms: Room[],
  lines: PlanLine[],
): Point2D[][] {
  if (slab.outer.length < 3) return []

  const roomPolys: Point2D[][] = []
  for (const room of rooms) {
    if (room.isColumn) continue // колонна — не помещение, площадь пола не "занимает"
    const pts = extractContourPoints(room.lineIds, lines)
    if (pts.length >= 3) roomPolys.push(pts)
  }

  const holePolys = slab.holes.filter(h => h.length >= 3)

  return subtractPolygons(slab.outer, [...roomPolys, ...holePolys])
}

/** px² → м², с тем же округлением, что и slabToCeilingSeed.ts/roomToCeilingSeed.ts. */
function areaM2FromPx(outerPx: Point2D[], scaleMmPerPx: number): number {
  const mmPts = outerPx.map(p => ({ x: p.x * scaleMmPerPx, y: p.y * scaleMmPerPx }))
  return Math.round(Math.max(polygonArea(mmPts), 0) / 1e6 * 100) / 100
}

let zoneCounter = 0
function makeZoneId(): string {
  zoneCounter += 1
  return `slabzone_${Date.now()}_${zoneCounter}`
}

/**
 * Сопоставляет свежий пересчёт полигонов с уже сохранёнными зонами.
 * Возвращает ПОЛНЫЙ новый массив zones для записи в Slab.zones: и
 * подтверждённые (live=true, geometрия/площадь обновлены), и старые
 * непарные (live=false, без изменений — прогресс не трогаем).
 */
export function matchSlabZones(
  newPolygons: Point2D[][],
  previousZones: SlabZone[] | undefined,
  scaleMmPerPx: number,
): SlabZone[] {
  const prev = previousZones ?? []
  const prevAvailable = prev.map((z, i) => ({ z, i, centroid: centroid(z.outer) }))
  const claimed = new Set<number>()

  let nextDefaultNumber = prev.length + 1
  const matched: SlabZone[] = newPolygons.map(poly => {
    const c = centroid(poly)
    let bestIdx = -1
    let bestDist = Infinity
    for (const cand of prevAvailable) {
      if (claimed.has(cand.i)) continue
      const d = dist2(c, cand.centroid)
      if (d < bestDist) { bestDist = d; bestIdx = cand.i }
    }

    const areaM2 = areaM2FromPx(poly, scaleMmPerPx)

    if (bestIdx >= 0) {
      claimed.add(bestIdx)
      const old = prev[bestIdx]
      return { ...old, outer: poly, areaM2, live: true }
    }

    const label = `Зона плиты ${nextDefaultNumber}`
    nextDefaultNumber += 1
    return { id: makeZoneId(), label, outer: poly, areaM2, live: true }
  })

  const unmatchedOld = prev
    .filter((_, i) => !claimed.has(i))
    .map(z => ({ ...z, live: false }))

  return [...matched, ...unmatchedOld]
}
