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

import type { CeilingSlope, EdgeProfile, PlanLine, Room } from '../types'
import { pointInPolygon, type Point2D } from './geometry2d'
import { extractContourPoints } from './contour'

/**
 * Высота плоскости уклона в произвольной точке (x,y), мм.
 * t — проекция (p−p1) на направление (p2−p1), НЕ клампится в [0,1]:
 * плоскость продолжается за пределы отрезка p1-p2 (иначе точки за
 * пределами отрезка остались бы без определённой высоты).
 * Вырожденный случай (p1 совпадает с p2) — возвращает height1Mm.
 */
export function ceilingSlopeHeightAt(slope: CeilingSlope, x: number, y: number): number {
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
 * Профиль потолка для линии line под данным уклоном, или undefined если
 * уклон неприменим (нет уклона / линия — дуга, sagittaMm задан и не 0).
 * Прямая линия на плоскости всегда имеет ЛИНЕЙНО меняющуюся высоту вдоль
 * своей длины — поэтому двух точек (начало/конец) достаточно, это точный
 * результат, а не аппроксимация.
 */
export function ceilingProfileForLine(line: PlanLine, slope: CeilingSlope | undefined): EdgeProfile | undefined {
  if (!slope) return undefined
  if (line.sagittaMm) return undefined // дуга — известное ограничение, см. заголовок файла
  if (line.lengthMm <= 0) return undefined
  const h1 = ceilingSlopeHeightAt(slope, line.x1, line.y1)
  const h2 = ceilingSlopeHeightAt(slope, line.x2, line.y2)
  return [{ x: 0, y: h1 }, { x: line.lengthMm, y: h2 }]
}

/**
 * Удобная пакетная обёртка: line.id → ceilingProfile (только для линий,
 * где уклон реально применим — остальные в карте отсутствуют, вызывающий
 * код должен трактовать отсутствие как "плоская линия", не как ошибку).
 */
export function buildCeilingProfilesByLineId(
  lines: PlanLine[],
  slopes: CeilingSlope[],
  rooms: Room[],
): Map<string, EdgeProfile> {
  const map = new Map<string, EdgeProfile>()
  if (slopes.length === 0) return map
  const resolve = buildCeilingSlopeResolver(lines, slopes, rooms)
  for (const line of lines) {
    const slope = resolve(line)
    const profile = ceilingProfileForLine(line, slope)
    if (profile) map.set(line.id, profile)
  }
  return map
}
