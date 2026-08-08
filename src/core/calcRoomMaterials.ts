/**
 * calcRoomMaterials.ts — смета материалов отделки ПО ОДНОЙ КОМНАТЕ.
 * Обсуждено с пользователем 20.07.2026 (тема "общая смета по помещению").
 *
 * Источники материала для комнаты:
 *  - Room.floorProgress / Room.ceilingProgress — вся площадь комнаты (areaM2)
 *  - Стены периметра (Room.lineIds) — PlanLine.finishProgressA/B, площадь
 *    length×height минус проёмы; НУЖНАЯ сторона (A или B) определяется
 *    геометрически через wallSideToRoom.ts (без этого стена, общая для двух
 *    комнат, задвоила бы материал или ушла бы не в ту комнату).
 *
 * ГКЛ-каркас сюда НЕ входит (materialKind не проставлен на шагах
 * gkl_partition — см. data/workStageTemplates.ts) — материал по нему уже
 * точно считается calcSheetLayout.ts/buildPositions.ts отдельно, эта смета
 * его не дублирует. Плитка/затирка — то же самое, TileCalc.tsx.
 *
 * Одинаковые материалы с разных поверхностей (пол/потолок/несколько стен)
 * складываются в один общий пул (result.pooled) — так и просил пользователь:
 * "если материалы совпадают в разных поверхностях, они в общем пуле
 * складываются".
 */

import type { PlanLine, Room, MaterialKind } from '../types'
import { calcStepMaterial, type MaterialRate } from '../data/workMaterialCatalog'
import { wallSideFacingRoom } from './wallSideToRoom'
import { extractContourPoints } from './contour'

/** Площадь поверхности стены для отделки: length×height минус проёмы, не меньше 0. */
export function wallFinishAreaM2(line: PlanLine): number {
  const lengthM = line.lengthMm / 1000
  const heightM = (line.heightMm ?? 0) / 1000
  const grossM2 = lengthM * heightM
  const openingsM2 = (line.openings ?? []).reduce((sum, o) => sum + (o.widthMm / 1000) * (o.heightMm / 1000), 0)
  return Math.max(0, grossM2 - openingsM2)
}

export interface RoomMaterialLine {
  /** Читаемый источник для отображения построчно, например "Стена С-2 (сторона A): Грунтовка" */
  source: string
  materialKind: MaterialKind
  areaM2: number
  totalMass: number
  packages: number
  rate: MaterialRate
}

export type RoomMaterialPool = Partial<Record<MaterialKind, { totalMass: number, packages: number, rate: MaterialRate }>>

export interface RoomMaterialResult {
  /** Построчно, по каждому шагу-источнику — для детального списка в UI */
  lines: RoomMaterialLine[]
  /** Одинаковые materialKind сложены вместе — то, что реально нужно купить */
  pooled: RoomMaterialPool
}

function pushStepLines(
  progress: { steps: Array<{ label: string, materialKind?: MaterialKind, materialThicknessMm?: number, materialLayers?: number }> } | undefined,
  areaM2: number,
  sourcePrefix: string,
  out: RoomMaterialLine[],
) {
  if (!progress || areaM2 <= 0) return
  for (const step of progress.steps) {
    if (!step.materialKind) continue
    const { rate, totalMass, packages } = calcStepMaterial(step.materialKind, areaM2, {
      thicknessMm: step.materialThicknessMm, layers: step.materialLayers,
    })
    out.push({ source: `${sourcePrefix}: ${step.label}`, materialKind: step.materialKind, areaM2, totalMass, packages, rate })
  }
}

export function calcRoomMaterials(room: Room, allLines: PlanLine[]): RoomMaterialResult {
  const lines: RoomMaterialLine[] = []

  pushStepLines(room.floorProgress, room.areaM2, 'Пол', lines)
  pushStepLines(room.ceilingProgress, room.areaM2, 'Потолок', lines)

  const roomPolygon = extractContourPoints(room.lineIds, allLines)
  for (const lineId of room.lineIds) {
    const line = allLines.find(l => l.id === lineId)
    if (!line) continue
    const side = wallSideFacingRoom(line, roomPolygon)
    if (!side) continue
    const progress = side === 'A' ? line.finishProgressA : line.finishProgressB
    const areaM2 = wallFinishAreaM2(line)
    pushStepLines(progress, areaM2, `${line.label} (сторона ${side})`, lines)
  }

  const pooled: RoomMaterialPool = {}
  for (const l of lines) {
    const acc = pooled[l.materialKind] ?? { totalMass: 0, packages: 0, rate: l.rate }
    acc.totalMass += l.totalMass
    pooled[l.materialKind] = acc
  }
  for (const kind of Object.keys(pooled) as MaterialKind[]) {
    const acc = pooled[kind]!
    acc.packages = Math.ceil(acc.totalMass / acc.rate.packageSize)
  }

  return { lines, pooled }
}
