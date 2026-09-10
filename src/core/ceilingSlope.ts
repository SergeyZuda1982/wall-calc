/**
 * ceilingSlope.ts — уклон плиты перекрытия (потолка) на плане.
 *
 * Найдено на объекте 30.08.2026 (philharmonic Ростов): форма расчёта
 * перегородки уже умеет принимать скошенный потолок (ceilingProfile,
 * см. profileGeometry.ts), но на плане это нигде не задаётся — линии
 * всегда получают плоский heightMm. Эта модель заполняет пробел на
 * уровне ПЛАНА: пользователь задаёт уклон один раз (двумя опорными
 * точками с известной высотой), а все перегородки/облицовки, которые в
 * зону действия этого уклона попадают, автоматически получают верный
 * ceilingProfile — дальше расчёт объёма/площади идёт как обычно, через
 * уже существующий calcResults/calcLining (interpolateY/integrateHeight),
 * без отдельной логики счёта площади здесь.
 *
 * Геометрия уклона — см. подробный комментарий на CeilingSlope в
 * types/index.ts: плоскость, постоянная в направлении, перпендикулярном
 * линии p1→p2, экстраполируется на весь охват (не только между p1 и p2).
 */

import type { CeilingSlope, SlopePlane, EdgeProfile, PlanLine, Room, Slab, Ceiling } from '../types'
import { pointInPolygon, type Point2D } from './geometry2d'
import { extractContourPoints } from './contour'

/**
 * Высота плоскости уклона в произвольной точке (x,y), мм. Принимает
 * минимальный SlopePlane (07.09.2026 — тот же расчёт переиспользуется для
 * наклона Плиты/Потолка, см. types/index.ts Slab.slope/Ceiling.slope, и
 * core/planTo3D.ts slopePlaneCoefficients для 3D-развёртки той же плоскости),
 * CeilingSlope (id/label/roomId) подходит сюда же — она расширяет SlopePlane.
 * t — проекция (p−p1) на направление (p2−p1), НЕ клампится в [0,1]:
 * плоскость продолжается за пределы отрезка p1-p2 (иначе точки за
 * пределами отрезка остались бы без определённой высоты).
 * Вырожденный случай (p1 совпадает с p2) — возвращает height1Mm.
 */
export function ceilingSlopeHeightAt(slope: SlopePlane, x: number, y: number): number {
  const dx = slope.x2 - slope.x1
  const dy = slope.y2 - slope.y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return slope.height1Mm
  const t = ((x - slope.x1) * dx + (y - slope.y1) * dy) / lenSq
  return slope.height1Mm + t * (slope.height2Mm - slope.height1Mm)
}

/** Полигон комнаты (мировые px), или null если контур не замкнут/не найден. */
function roomPolygon(room: Room, lines: PlanLine[]): Point2D[] | null {
  const pts = extractContourPoints(room.lineIds, lines)
  return pts.length >= 3 ? pts : null
}

/**
 * Строит контуры комнат ОДИН РАЗ (не на каждую линию) и возвращает
 * функцию-резолвер per-line: сперва ищем уклон, у которого roomId
 * указывает на комнату, ГЕОМЕТРИЧЕСКИ содержащую середину линии (свой
 * уклон для помещения перекрывает общий), иначе — первый уклон без
 * roomId (общий на весь план), иначе — undefined (линия остаётся плоской).
 * Используется calcPlanFrameEstimate/FloorPlan.tsx.
 */
export function buildCeilingSlopeResolver(
  allLines: PlanLine[],
  slopes: CeilingSlope[],
  rooms: Room[],
): (line: PlanLine) => CeilingSlope | undefined {
  if (slopes.length === 0) return () => undefined

  const globalSlope = slopes.find(s => !s.roomId)
  const roomSlopes = slopes
    .filter(s => s.roomId)
    .map(s => {
      const room = rooms.find(r => r.id === s.roomId)
      const poly = room ? roomPolygon(room, allLines) : null
      return poly ? { slope: s, poly } : null
    })
    .filter((v): v is { slope: CeilingSlope; poly: Point2D[] } => v !== null)

  return (line: PlanLine) => {
    if (roomSlopes.length > 0) {
      const mid: Point2D = { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 }
      const hit = roomSlopes.find(rs => pointInPolygon(mid, [rs.poly]))
      if (hit) return hit.slope
    }
    return globalSlope
  }
}

/**
 * Резолвер уклона в ПРОИЗВОЛЬНОЙ точке плана (не привязанной к линии) —
 * та же логика выбора "свой уклон комнаты перекрывает общий", что и в
 * buildCeilingSlopeResolver выше, но по точке. Нужен для колонн (04.09.2026,
 * закрытие объёмов на оплату) — у колонны нет двух концов, только центр.
 */
export function ceilingSlopeHeightAtPoint(
  point: Point2D, allLines: PlanLine[], slopes: CeilingSlope[], rooms: Room[],
): number | undefined {
  if (slopes.length === 0) return undefined
  const globalSlope = slopes.find(s => !s.roomId)
  for (const s of slopes) {
    if (!s.roomId) continue
    const room = rooms.find(r => r.id === s.roomId)
    const poly = room ? roomPolygon(room, allLines) : null
    if (poly && pointInPolygon(point, [poly])) return ceilingSlopeHeightAt(s, point.x, point.y)
  }
  return globalSlope ? ceilingSlopeHeightAt(globalSlope, point.x, point.y) : undefined
}

/**
 * Профиль потолка для линии line под данным уклоном, или undefined если
 * уклон неприменим (нет уклона / линия — дуга, sagittaMm задан и не 0).
 * Прямая линия на плоскости всегда имеет ЛИНЕЙНО меняющуюся высоту вдоль
 * своей длины — поэтому двух точек (начало/конец) достаточно, это точный
 * результат, а не аппроксимация.
 */
export function ceilingProfileForLine(line: PlanLine, slope: SlopePlane | undefined): EdgeProfile | undefined {
  if (!slope) return undefined
  if (line.customHeight) return undefined // высота зафиксирована пользователем — не до перекрытия, уклон не применяем
  if (line.sagittaMm) return undefined // дуга — известное ограничение, см. заголовок файла
  if (line.lengthMm <= 0) return undefined
  const h1 = ceilingSlopeHeightAt(slope, line.x1, line.y1)
  const h2 = ceilingSlopeHeightAt(slope, line.x2, line.y2)
  return [{ x: 0, y: h1 }, { x: line.lengthMm, y: h2 }]
}

/**
 * Наклон у реально нарисованной Плиты/Потолка (07.09.2026, Slab.slope/
 * Ceiling.slope), контур которой(ого) геометрически содержит точку —
 * фактическая нарисованная геометрия приоритетнее отдельно введённой
 * зоны «Задать уклон» (см. buildEffectiveCeilingSlopeResolver ниже):
 * Сергей решил, что если плита/потолок над помещением уже нарисованы —
 * перегородки должны брать высоту из них, а зона уклона остаётся только
 * запасным вариантом, пока плита ещё не нарисована. Плита проверяется
 * раньше потолка (структурная плита перекрытия — то, до чего реально
 * должна доходить перегородка; подвесной потолок ниже неё на высоту
 * подвесов и не обязан совпадать).
 */
function slopeFromCoveringEntity(point: Point2D, slabs: Slab[], ceilings: Ceiling[]): SlopePlane | undefined {
  for (const sl of slabs) {
    if (sl.slope && sl.outer.length >= 3 && pointInPolygon(point, [sl.outer])) return sl.slope
  }
  for (const cl of ceilings) {
    if (cl.slope && cl.outer.length >= 3 && pointInPolygon(point, [cl.outer])) return cl.slope
  }
  return undefined
}

/**
 * Резолвер уклона для линии, объединяющий ОБА источника (07.09.2026,
 * приоритет подтверждён Сергеем): сперва — наклон нарисованной Плиты/
 * Потолка, накрывающей середину линии; если такой нет — старая зона
 * «Задать уклон» (buildCeilingSlopeResolver). Возвращает SlopePlane
 * (не обязательно CeilingSlope — у найденного через Плиту/Потолок нет
 * id/label/roomId, это нормально, ceilingProfileForLine их не требует).
 */
export function buildEffectiveCeilingSlopeResolver(
  allLines: PlanLine[], slabs: Slab[], ceilings: Ceiling[], slopes: CeilingSlope[], rooms: Room[],
): (line: PlanLine) => SlopePlane | undefined {
  const zoneResolve = buildCeilingSlopeResolver(allLines, slopes, rooms)
  return (line: PlanLine) => {
    const mid: Point2D = { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 }
    return slopeFromCoveringEntity(mid, slabs, ceilings) ?? zoneResolve(line)
  }
}

/** То же самое (Плита/Потолок → зона уклона), но для произвольной точки — см. ceilingSlopeHeightAtPoint выше (колонны). */
export function effectiveCeilingSlopeHeightAtPoint(
  point: Point2D, allLines: PlanLine[], slabs: Slab[], ceilings: Ceiling[], slopes: CeilingSlope[], rooms: Room[],
): number | undefined {
  const entitySlope = slopeFromCoveringEntity(point, slabs, ceilings)
  if (entitySlope) return ceilingSlopeHeightAt(entitySlope, point.x, point.y)
  return ceilingSlopeHeightAtPoint(point, allLines, slopes, rooms)
}

/**
 * Удобная пакетная обёртка: line.id → ceilingProfile (только для линий,
 * где уклон реально применим — остальные в карте отсутствуют, вызывающий
 * код должен трактовать отсутствие как "плоская линия", не как ошибку).
 * 07.09.2026 — принимает slabs/ceilings и использует объединённый
 * резолвер (см. buildEffectiveCeilingSlopeResolver) вместо только зон.
 */
export function buildCeilingProfilesByLineId(
  lines: PlanLine[],
  slabs: Slab[],
  ceilings: Ceiling[],
  slopes: CeilingSlope[],
  rooms: Room[],
): Map<string, EdgeProfile> {
  const map = new Map<string, EdgeProfile>()
  const hasAnyEntitySlope = slabs.some(s => s.slope) || ceilings.some(c => c.slope)
  if (slopes.length === 0 && !hasAnyEntitySlope) return map
  const resolve = buildEffectiveCeilingSlopeResolver(lines, slabs, ceilings, slopes, rooms)
  for (const line of lines) {
    const slope = resolve(line)
    const profile = ceilingProfileForLine(line, slope)
    if (profile) map.set(line.id, profile)
  }
  return map
}
