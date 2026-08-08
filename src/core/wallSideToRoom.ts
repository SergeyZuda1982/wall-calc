/**
 * wallSideToRoom.ts — определяет, какая сторона стены (A/B, см.
 * PlanLine.finishProgressA/B) физически смотрит В КОНКРЕТНУЮ комнату.
 *
 * Нужно для агрегации сметы материалов по комнате (calcRoomMaterials) —
 * без этого стена, общая для двух помещений, либо задвоила бы материал
 * (взяли и A, и B в одну комнату), либо приписала бы отделку не той
 * стороне.
 *
 * Конвенция стороны A/B выведена из уже существующего кода (не придумана
 * заново):
 *  - planTo3D.ts (wallToBox3D): 3D z = plan y напрямую (без инверсии знака),
 *    rotationY = atan2(-dz, dx).
 *  - Scene3D.tsx: обшивка стороны A рисуется в локальных +Z, стороны B — в −Z.
 *  - Локальная ось +Z после поворота на rotationY в мировых координатах
 *    даёт направление (-dz, dx) = (-dy_plan, dx_plan) — т.е. поворот вектора
 *    направления линии (dx,dy) на 90° "влево от хода" в пиксельных
 *    координатах плана. Это тот же принцип "влево от направления x1→x2",
 *    что уже задокументирован для sagitta в geometry2d.ts.
 * Итого: сторона A — нормаль (-dy, dx) от середины линии, сторона B —
 * противоположная (dy, -dx).
 */

import type { PlanLine } from '../types'
import { pointInPolygon } from './geometry2d'
import { extractContourPoints } from './contour'

const PROBE_OFFSET_PX = 4 // отступ от стены для теста "внутри/снаружи", px на холсте

/**
 * Какая сторона линии (A/B) смотрит внутрь полигона комнаты.
 * Возвращает null, если линия вырождена (нулевая длина) или обе/ни одна
 * тестовые точки не однозначно определились (не должно происходить для
 * реальной стены на границе реального помещения).
 */
export function wallSideFacingRoom(line: PlanLine, roomPolygon: { x: number; y: number }[]): 'A' | 'B' | null {
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1
  const len = Math.hypot(dx, dy)
  if (len < 1e-6 || roomPolygon.length < 3) return null

  const mx = (line.x1 + line.x2) / 2, my = (line.y1 + line.y2) / 2
  const nx = -dy / len, ny = dx / len // единичная нормаль стороны A (см. шапку файла)

  const probeA = { x: mx + nx * PROBE_OFFSET_PX, y: my + ny * PROBE_OFFSET_PX }
  const probeB = { x: mx - nx * PROBE_OFFSET_PX, y: my - ny * PROBE_OFFSET_PX }

  const aInside = pointInPolygon(probeA, [roomPolygon])
  const bInside = pointInPolygon(probeB, [roomPolygon])

  if (aInside && !bInside) return 'A'
  if (bInside && !aInside) return 'B'
  return null // не должно происходить для стены на границе валидного помещения
}

/**
 * То же самое, но сразу для Room (собирает полигон из lineIds через
 * extractContourPoints — тот же способ, что уже используется в
 * roomToCeilingSeed.ts/planTo3D.ts).
 */
export function wallSideFacingRoomLines(
  line: PlanLine, roomLineIds: string[], allLines: PlanLine[],
): 'A' | 'B' | null {
  const polygon = extractContourPoints(roomLineIds, allLines)
  return wallSideFacingRoom(line, polygon)
}
