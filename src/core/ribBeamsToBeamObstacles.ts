/**
 * Мост между ригелями (PlanLine type='rib_beam'), нарисованными на плане, и
 * BeamObstacle из hangerBeamConflict.ts — тем же способом, каким полигональный
 * расчёт каркаса (calcPolygonP112Frame.ts) переводит контур потолка в
 * локальные координаты (buildLocalFrame/toLocal): U вдоль выбранной стены
 * начала раскладки ("length" в терминах BeamObstacle), V — перпендикулярно,
 * внутрь контура ("width"). Тот же локальный кадр, что уже используется для
 * самого каркаса — координаты ригеля и подвеса гарантированно в одной
 * системе отсчёта.
 *
 * Ригель на плане не обязан лежать ТОЧНО внутри контура потолка (может
 * заходить за периметр, если обведён неточно, или наоборот — реальный
 * ригель длиннее, чем зона расчёта) — учитываются все ригели, чей
 * ограничивающий прямоугольник в локальных координатах пересекается с
 * ограничивающим прямоугольником контура потолка (с запасом overlapMarginMm
 * на неточность обводки).
 *
 * НЕ применимо к rib_beam-дугам (sagittaMm задан) — такие линии пропускаются
 * (прямая аппроксимация балки-дуги отдельно не решается, см. ограничения
 * дуг в types/index.ts).
 */

import type { PlanLine } from '../types'
import { DEFAULT_RIB_SECTION_MM } from './planTo3D'
import { buildLocalFrame, toLocal, type LocalFrame } from './calcPolygonP112Frame'
import type { Point2D } from './geometry2d'
import type { BeamObstacle } from './hangerBeamConflict'

function toMm(p: { x: number; y: number }, scaleMmPerPx: number): Point2D {
  return { x: p.x * scaleMmPerPx, y: p.y * scaleMmPerPx }
}

/**
 * @param lines весь набор линий плана (будут отфильтрованы rib_beam)
 * @param outerMm контур потолка/плиты, в мм (тот же outerMm, что уходит в CeilingPolygonInput)
 * @param startSide выбранная стена начала раскладки, в мм (та же, что у самого каркаса)
 * @param scaleMmPerPx масштаб плана — линии ригелей хранятся в px
 * @param overlapMarginMm допуск на неточность обводки контура относительно реального ригеля (мм)
 */
export function ribBeamsToBeamObstacles(
  lines: PlanLine[],
  outerMm: Point2D[],
  startSide: { start: Point2D; end: Point2D },
  scaleMmPerPx: number,
  overlapMarginMm = 200,
): BeamObstacle[] {
  if (outerMm.length < 3) return []
  const frame = buildLocalFrame(startSide, outerMm)

  const localOuter = outerMm.map(p => toLocal(p, frame))
  const uValues = localOuter.map(p => p.x)
  const vValues = localOuter.map(p => p.y)
  const uMin = Math.min(...uValues), uMax = Math.max(...uValues)
  const vMin = Math.min(...vValues), vMax = Math.max(...vValues)

  const obstacles: BeamObstacle[] = []
  let autoIndex = 1

  for (const line of lines) {
    if (line.type !== 'rib_beam') continue
    if (line.sagittaMm) continue // дуги не поддержаны, см. шапку файла

    const startMm = toMm({ x: line.x1, y: line.y1 }, scaleMmPerPx)
    const endMm = toMm({ x: line.x2, y: line.y2 }, scaleMmPerPx)
    const localStart = toLocal(startMm, frame)
    const localEnd = toLocal(endMm, frame)

    const du = Math.abs(localEnd.x - localStart.x)
    const dv = Math.abs(localEnd.y - localStart.y)
    const widthMm = line.sectionWidthMm ?? DEFAULT_RIB_SECTION_MM

    // Балка идёт преимущественно вдоль U (длины) -> пересекает ось V в
    // примерно постоянной точке -> ограничение по оси 'width'. И наоборот.
    const runsAlongU = du >= dv

    if (runsAlongU) {
      const beamUMin = Math.min(localStart.x, localEnd.x)
      const beamUMax = Math.max(localStart.x, localEnd.x)
      // Пересекается ли протяжённость балки вдоль U с протяжённостью контура по U?
      if (beamUMax < uMin - overlapMarginMm || beamUMin > uMax + overlapMarginMm) continue
      const posMm = (localStart.y + localEnd.y) / 2
      if (posMm < vMin - overlapMarginMm || posMm > vMax + overlapMarginMm) continue
      obstacles.push({
        axis: 'width',
        posMm,
        widthMm,
        label: line.label || `Ригель ${autoIndex++}`,
      })
    } else {
      const beamVMin = Math.min(localStart.y, localEnd.y)
      const beamVMax = Math.max(localStart.y, localEnd.y)
      if (beamVMax < vMin - overlapMarginMm || beamVMin > vMax + overlapMarginMm) continue
      const posMm = (localStart.x + localEnd.x) / 2
      if (posMm < uMin - overlapMarginMm || posMm > uMax + overlapMarginMm) continue
      obstacles.push({
        axis: 'length',
        posMm,
        widthMm,
        label: line.label || `Ригель ${autoIndex++}`,
      })
    }
  }

  return obstacles
}

export type { LocalFrame }
