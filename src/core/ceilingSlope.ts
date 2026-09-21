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
import { DEFAULT_SLAB_THICKNESS_MM } from '../types'
import { pointInPolygon, type Point2D } from './geometry2d'
import { extractContourPoints } from './contour'

/**
 * Площадь под ломаной высоты профиля (07.09.2026, вынесено из FloorPlan.tsx
 * calcLineArea — там была найдена ошибка: площадь в сводной таблице
 * «Конструкции на плане» всегда считалась по фиксированной heightMm, даже
 * когда на линии действовал профиль уклона). Профиль — точки (x вдоль
 * линии от начала, y — высота в этой точке), площадь — сумма трапеций по
 * соседним точкам. Для простого 2-точечного линейного профиля (сейчас
 * единственный вид, который порождает ceilingProfileForLine) это ровно
 * length × средняя высота — но формула верна для профиля с любым числом
 * точек, если он появится позже (ступенчатые перекрытия и т.п.).
 */
export function areaUnderProfileM2(profile: EdgeProfile): number {
  let areaMm2 = 0
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1]
    areaMm2 += (b.x - a.x) * (a.y + b.y) / 2 // трапеция
  }
  return areaMm2 / 1_000_000
}

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
 * раньше потолка (структурная плита перекрытия), но Slab.slope хранит
 * отметку её ВЕРХНЕЙ грани (та же величина, что задаёт положение плиты в
 * 3D, см. Scene3D.tsx) — до чего реально должна доходить перегородка, это
 * её НИЖНЯЯ грань, поэтому здесь вычитается толщина плиты (20.09.2026,
 * найдено на тестовом объекте: без вычитания перегородка рисовалась
 * насквозь через плиту до её верха) — см. DEFAULT_SLAB_THICKNESS_MM в
 * types/index.ts. У Ceiling такого вычитания нет: подвесной потолок сам
 * по себе уже готовая/подвешенная поверхность на нужной отметке, а не
 * сырая структурная плита со своей толщиной.
 */
function slopeFromCoveringEntity(point: Point2D, slabs: Slab[], ceilings: Ceiling[]): SlopePlane | undefined {
  for (const sl of slabs) {
    if (sl.slope && sl.outer.length >= 3 && pointInPolygon(point, [sl.outer])) {
      // Slope хранит отметку ВЕРХНЕЙ грани плиты (та же величина, что
      // используется для 3D-экструзии в Scene3D.tsx) — перегородка/колонна
      // под плитой должна доходить до её НИЖНЕЙ грани, поэтому толщина
      // плиты вычитается здесь один раз, до того как высота уйдёт дальше
      // ко всем потребителям (ceilingProfileForLine, колонны, ригели).
      const thicknessMm = sl.thicknessMm ?? DEFAULT_SLAB_THICKNESS_MM
      return { ...sl.slope, height1Mm: sl.slope.height1Mm - thicknessMm, height2Mm: sl.slope.height2Mm - thicknessMm }
    }
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
 * Опускание РИГЕЛЯ (dropMm) при рисовании новой линии — 13.09.2026, объект
 * в Ростове (общая нижняя отметка ригелей 3450мм при плите от 3800 до
 * ~5500 на разных участках): вместо того, чтобы вручную считать разное
 * опускание под каждый ригель на наклонном участке, пользователь один раз
 * задаёт желаемую отметку низа (targetBottomMm) — опускание считается как
 * (высота плиты/потолка в СРЕДНЕЙ точке ригеля, через
 * effectiveCeilingSlopeHeightAtPoint выше) минус эта отметка. Без
 * применимого уклона в этой точке (targetBottomMm не задан, или нет
 * покрывающей Плиты/Потолка/зоны) — откат на manualDropMm как есть.
 *
 * Чистая функция (вынесена из FloorPlan.tsx, где раньше была локальным
 * замыканием resolveRibDropMm — недоступным для теста, т.к. в проекте нет
 * ни одного .test.tsx/React-теста компонентов, только core/-логика).
 */
export function resolveRibBeamDropMm(
  x1: number, y1: number, x2: number, y2: number,
  targetBottomMm: number | undefined, manualDropMm: number,
  allLines: PlanLine[], slabs: Slab[], ceilings: Ceiling[], slopes: CeilingSlope[], rooms: Room[],
): number {
  if (targetBottomMm === undefined || !(targetBottomMm >= 0)) return manualDropMm
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2
  const slabTopMm = effectiveCeilingSlopeHeightAtPoint({ x: midX, y: midY }, allLines, slabs, ceilings, slopes, rooms)
  if (slabTopMm === undefined) return manualDropMm
  return Math.max(0, Math.round(slabTopMm - targetBottomMm))
}

/**
 * Материал потолка ДЛЯ КОМНАТЫ (15.09.2026, по просьбе Сергея — чек-лист
 * последующих работ Room.ceilingProgress должен подстраиваться под тип
 * потолка: Черновой — без каркаса, но с малярными работами; ГКЛ — полный
 * цикл каркас→обшивка→шпаклёвка→покраска; Подвесной/Натяжной — готовая
 * система, монтаж и сразу «готово», без малярки и ГКЛ-работ).
 *
 * Тот же принцип "накрывающей сущности", что и slopeFromCoveringEntity
 * выше (point-in-polygon по Ceiling.outer), просто по ЦЕНТРОИДУ полигона
 * комнаты, а не по точке линии — у комнаты нет естественной "середины
 * отрезка", а простое среднее вершин полигона (не истинный центроид
 * многоугольника) — тот же уровень точности, что и у остальных подобных
 * резолверов в проекте (см., например, resolveRibBeamDropMm выше — среднее
 * по двум концам, не интеграл по кривой). Для сильно вогнутых комнат
 * среднее вершин теоретически может попасть мимо самой комнаты — на
 * практике для типовых прямоугольных/Г-образных помещений вопрос не
 * возникал, не мудрим сверх необходимого.
 *
 * Первая накрывающая Ceiling-зона с заданным material — та и даёт ответ
 * (соответствует порядку, в котором зоны лежат в массиве; если на одну
 * комнату случайно наложены две зоны разного материала — берётся первая,
 * это редкий/ошибочный случай рисования, а не нормальный сценарий).
 */
export function ceilingMaterialForRoom(room: Room, allLines: PlanLine[], ceilings: Ceiling[]): string | undefined {
  const poly = roomPolygon(room, allLines)
  if (!poly) return undefined
  let cx = 0, cy = 0
  for (const p of poly) { cx += p.x; cy += p.y }
  const centroid: Point2D = { x: cx / poly.length, y: cy / poly.length }
  for (const cl of ceilings) {
    if (cl.material && cl.outer.length >= 3 && pointInPolygon(centroid, [cl.outer])) return cl.material
  }
  return undefined
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
