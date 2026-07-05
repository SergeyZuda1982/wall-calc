/**
 * planTo3D.ts — перевод плоской геометрии плана (PlanLine/Room, координаты
 * в px + scaleMmPx) в геометрические примитивы для 3D-сцены (метры).
 *
 * Намеренно НЕ импортирует three.js и ничего не рендерит — чистые функции,
 * которые можно протестировать без браузера/WebGL. Сборка реальных мешей
 * (extrude, материалы, цвета) — в Scene3D.tsx.
 *
 * v1 упрощения (сознательно, см. KONSPEKT.md):
 * - проёмы (дверь/окно/просто проём) вырезаются как прямые прямоугольные
 *   разрезы вдоль оси стены (см. wallToBoxesWithOpenings3D) — без скосов
 *   и без арок; откос/четверть проёма не моделируются, просто чистый
 *   прямоугольный вырез на всю толщину стены
 * - митры/стыки стен (wallJoin) не учитываются — стены просто накладываются
 *   друг на друга по углам, как коробки; визуально это уже "стена", а не
 *   голая линия, довести до идеального стыка можно отдельным шагом
 * - высота потолка не хранится как отдельная величина — estimateCeilingMm
 *   берёт максимум heightMm среди wall_existing (или дефолт), только чтобы
 *   было от чего повесить ригель
 */

import type { PlanLine, PlanLineType, Room, Slab, RoundColumn, RectColumn } from '../types'
import { getLineVisual } from '../data/constructionTaxonomy'
import { extractContourPoints } from './contour'

export const DEFAULT_HEIGHT_MM = 3000
export const DEFAULT_RIB_SECTION_MM = 300
export const DEFAULT_RIB_DROP_MM = 200
export const FLOOR_SLAB_THICKNESS_MM = 200
export const CEILING_SLAB_THICKNESS_MM = 200

export function mmToM(mm: number): number {
  return mm / 1000
}

/** px плана → метры мира, с учётом масштаба (scaleMmPx = мм на 1px) */
export function pxToM(px: number, scaleMmPx: number): number {
  return mmToM(px * scaleMmPx)
}

/**
 * Толщина линии в мм — та же логика, что в 2D-рендере (FloorPlan.tsx):
 * для стен/облицовки/существующих стен — из taxonomy по spec.material,
 * для ригеля — из sectionWidthMm напрямую. Линия без явного spec (и не
 * ригель) толщины не имеет — она "не построена" ни в 2D, ни в 3D.
 */
export function wallThicknessMm(line: PlanLine): number {
  if (line.type === 'rib_beam') return line.sectionWidthMm ?? DEFAULT_RIB_SECTION_MM
  if (!line.spec?.material) return 0
  return getLineVisual(line.type, line.spec.material, line.spec.subtype, line.spec.gapMm).thicknessMm
}

/**
 * Опорная высота потолка (низ плиты перекрытия), мм — по максимуму heightMm
 * среди существующих стен (они обычно идут от пола до плиты). Нужна только
 * чтобы было от чего вертикально повесить ригель; не хранится как
 * самостоятельная величина в модели данных (см. KONSPEKT.md, пробел
 * "монолитный пол/потолок как отдельный объект").
 */
export function estimateCeilingMm(lines: PlanLine[]): number {
  const existing = lines.filter(l => l.type === 'wall_existing').map(l => l.heightMm ?? DEFAULT_HEIGHT_MM)
  return existing.length > 0 ? Math.max(...existing) : DEFAULT_HEIGHT_MM
}

export interface WallBox3D {
  id: string
  planLineType: PlanLineType
  /** центр коробки, метры; x/z — план (сверху), y — вертикаль (вверх) */
  center: { x: number; y: number; z: number }
  /** размеры, метры: sx — вдоль оси линии, sy — высота, sz — толщина */
  size: { sx: number; sy: number; sz: number }
  /** поворот вокруг вертикальной оси Y, радианы */
  rotationY: number
}

/**
 * Одна линия плана (стена любого типа или ригель) → коробка в 3D.
 * Возвращает null для линий без толщины (та же логика "не рисуем трапецию
 * без spec", что и в 2D) — они и на плане не видны как объём.
 */
export function wallToBox3D(line: PlanLine, scaleMmPx: number, ceilingMm: number): WallBox3D | null {
  const tMm = wallThicknessMm(line)
  if (tMm <= 0) return null

  const x1 = pxToM(line.x1, scaleMmPx), z1 = pxToM(line.y1, scaleMmPx)
  const x2 = pxToM(line.x2, scaleMmPx), z2 = pxToM(line.y2, scaleMmPx)
  const dx = x2 - x1, dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)
  if (length < 0.001) return null

  const isRib = line.type === 'rib_beam'
  const heightM = isRib
    ? mmToM(line.dropMm ?? DEFAULT_RIB_DROP_MM)
    : mmToM(line.heightMm ?? DEFAULT_HEIGHT_MM)
  const centerY = isRib
    ? mmToM(ceilingMm) - heightM / 2   // висит под плитой
    : heightM / 2                       // стоит на полу (y=0)

  return {
    id: line.id,
    planLineType: line.type,
    center: { x: (x1 + x2) / 2, y: centerY, z: (z1 + z2) / 2 },
    size: { sx: length, sy: heightM, sz: mmToM(tMm) },
    rotationY: Math.atan2(-dz, dx),
  }
}

export function wallsToBoxes3D(lines: PlanLine[], scaleMmPx: number): WallBox3D[] {
  const ceilingMm = estimateCeilingMm(lines)
  return lines.flatMap(l => wallToBoxesWithOpenings3D(l, scaleMmPx, ceilingMm))
}

/**
 * Стена (короб) с вырезанными проёмами (дверь/окно/просто проём).
 *
 * Вместо булевой геометрии (CSG) — которой в проекте нет и на three.js r128
 * заводить её ради этого не стоит — короб просто режется на несколько
 * коробов поменьше вдоль оси линии, ровно как это уже делает 2D-рендер для
 * плана (см. FloorPlan.tsx, computeOpeningSegments): сплошные участки между
 * проёмами — целые короба на всю высоту стены; под и над самим проёмом,
 * если там есть материал стены (подоконник ниже низа проёма, перемычка выше
 * его верха) — отдельные короба пониже; сам проём — просто дырка, там
 * никакого короба нет.
 *
 * sillHeightMm трактуется одинаково для всех трёх типов проёма (окно/дверь/
 * просто проём) — просто "от пола" (для двери и сквозного проёма обычно 0).
 */
export function wallToBoxesWithOpenings3D(line: PlanLine, scaleMmPx: number, ceilingMm: number): WallBox3D[] {
  const baseOrNull = wallToBox3D(line, scaleMmPx, ceilingMm)
  if (!baseOrNull) return []
  const base: WallBox3D = baseOrNull

  const lengthM = base.size.sx
  const openings = (line.openings ?? [])
    .filter(o => o.widthMm > 0 && o.heightMm > 0)
    .map(o => ({
      id: o.id,
      // клэмпим к длине стены — защита от рассинхрона, если линию укоротили после того,
      // как проём был добавлен (проём на плане в этом случае тоже "обрежется" по факту)
      startM: Math.min(Math.max(mmToM(o.offsetMm), 0), lengthM),
      endM: Math.min(Math.max(mmToM(o.offsetMm + o.widthMm), 0), lengthM),
      sillM: Math.max(mmToM(o.sillHeightMm ?? 0), 0),
      heightM: mmToM(o.heightMm),
    }))
    .filter(o => o.endM > o.startM)
    .sort((a, b) => a.startM - b.startM)

  if (openings.length === 0) return [base]

  const wallHeightM = base.size.sy
  const bottomY = base.center.y - wallHeightM / 2   // низ стены (обычно 0, стена стоит на полу)
  const ux = Math.cos(base.rotationY), uz = -Math.sin(base.rotationY) // см. rotationY = atan2(-dz, dx) в wallToBox3D
  const startX = base.center.x - ux * lengthM / 2
  const startZ = base.center.z - uz * lengthM / 2

  const boxes: WallBox3D[] = []

  function pushAlong(fromM: number, toM: number, suffix: string) {
    const segLen = toM - fromM
    if (segLen <= 0.001) return
    const midM = (fromM + toM) / 2
    boxes.push({
      id: `${line.id}__${suffix}`,
      planLineType: line.type,
      center: { x: startX + ux * midM, y: base.center.y, z: startZ + uz * midM },
      size: { sx: segLen, sy: wallHeightM, sz: base.size.sz },
      rotationY: base.rotationY,
    })
  }

  function pushVertical(fromM: number, toM: number, yFrom: number, yTo: number, suffix: string) {
    const segLen = toM - fromM
    const h = yTo - yFrom
    if (segLen <= 0.001 || h <= 0.001) return
    const midM = (fromM + toM) / 2
    boxes.push({
      id: `${line.id}__${suffix}`,
      planLineType: line.type,
      center: { x: startX + ux * midM, y: yFrom + h / 2, z: startZ + uz * midM },
      size: { sx: segLen, sy: h, sz: base.size.sz },
      rotationY: base.rotationY,
    })
  }

  let curM = 0
  for (const op of openings) {
    // Часть проёма, ещё не вырезанная предыдущим (на случай двух проёмов внахлёст на
    // одной линии — редкий, но возможный пользовательский ввод): не досчитываем
    // подоконник/перемычку там, где стена уже вырезана целиком предыдущим проёмом.
    const cutStartM = Math.max(op.startM, curM)
    if (cutStartM >= op.endM) continue // полностью перекрыт предыдущим проёмом — пропускаем целиком

    pushAlong(curM, op.startM, `seg_${op.id}`)
    const topM = Math.min(wallHeightM, op.sillM + op.heightM)
    pushVertical(cutStartM, op.endM, bottomY, bottomY + op.sillM, `sill_${op.id}`)          // подоконник (если есть)
    pushVertical(cutStartM, op.endM, bottomY + topM, bottomY + wallHeightM, `lintel_${op.id}`) // перемычка (если есть)
    curM = Math.max(curM, op.endM)
  }
  pushAlong(curM, lengthM, 'tail')

  return boxes
}

export interface SlabPolygon3D {
  id: string
  /** внешний контур в метрах, план сверху (x,z) */
  outer: { x: number; z: number }[]
  /** вырезы (лестницы/шахты) в метрах — ноль или больше замкнутых контуров */
  holes: { x: number; z: number }[][]
}

/**
 * Плиты, нарисованные "карандашом" → полигоны в метрах (с дырками).
 * Отметка по высоте у плиты не хранится (см. types/index.ts, Slab) —
 * она берётся с этажа снаружи (Level.elevationMm), эта функция отдаёт
 * только форму в плоскости, без положения по Y.
 */
export function slabsToPolygons3D(slabs: Slab[], scaleMmPx: number): SlabPolygon3D[] {
  const toM = (pts: { x: number; y: number }[]) => pts.map(p => ({ x: pxToM(p.x, scaleMmPx), z: pxToM(p.y, scaleMmPx) }))
  return slabs
    .filter(sl => sl.outer.length >= 3)
    .map(sl => ({
      id: sl.id,
      outer: toM(sl.outer),
      holes: sl.holes.filter(h => h.length >= 3).map(toM),
    }))
}
export interface RoomPolygon3D {
  id: string
  isColumn: boolean
  /** точки контура в метрах, план сверху (x,z) — по часовой/против часовой,
   *  как пришли из extractContourPoints, без изменений */
  points: { x: number; z: number }[]
}

export interface ColumnCylinder3D {
  id: string
  /** центр в метрах, план сверху (x,z) */
  cx: number
  cz: number
  radius: number
  /** высота колонны, метры — до отметки потолка (та же логика, что у прямоугольной колонны-Room) */
  heightM: number
}

/**
 * Круглые колонны → цилиндры в метрах, для Scene3D (CylinderGeometry).
 * Высота — до общей отметки потолка этажа (estimateCeilingMm), как и у
 * прямоугольной колонны (Room с isColumn: true, extrude на всю высоту потолка).
 */
export function roundColumnsToCylinders3D(
  roundColumns: RoundColumn[], scaleMmPx: number, ceilingMm: number,
): ColumnCylinder3D[] {
  return roundColumns
    .filter(rc => rc.diameterMm > 0)
    .map(rc => ({
      id: rc.id,
      cx: pxToM(rc.cx, scaleMmPx),
      cz: pxToM(rc.cy, scaleMmPx),
      radius: mmToM(rc.diameterMm) / 2,
      heightM: mmToM(ceilingMm),
    }))
}

export interface RectColumnBox3D {
  id: string
  /** центр коробки, метры; x/z — план (сверху), y — вертикаль (вверх) */
  center: { x: number; y: number; z: number }
  /** размеры, метры: sx — вдоль ширины (widthMm), sy — высота, sz — вдоль глубины (depthMm) */
  size: { sx: number; sy: number; sz: number }
  /** поворот вокруг вертикальной оси Y, радианы */
  rotationY: number
}

/**
 * Прямоугольные колонны (самостоятельная сущность, см. types/index.ts) →
 * коробки в метрах, для Scene3D (BoxGeometry). Высота — до общей отметки
 * потолка этажа, как и у круглой колонны (roundColumnsToCylinders3D) —
 * тот же принцип, колонна стоит от пола до потолка целиком.
 *
 * rotationY = -angleRad: тот же знак, что и wallToBox3D выше выводит из
 * (dx,dz) направления линии (rotationY = atan2(-dz,dx)) — там для линии,
 * направленной как (cos θ, sin θ) в px-пространстве (θ = angleRad плана),
 * dz берётся БЕЗ инверсии (z = pxToM(y) впрямую), так что то же направление
 * даёт rotationY = atan2(-sin θ, cos θ) = -θ.
 */
export function rectColumnsToBoxes3D(
  rectColumns: RectColumn[], scaleMmPx: number, ceilingMm: number,
): RectColumnBox3D[] {
  return rectColumns
    .filter(rc => rc.widthMm > 0 && rc.depthMm > 0)
    .map(rc => ({
      id: rc.id,
      center: { x: pxToM(rc.cx, scaleMmPx), y: mmToM(ceilingMm) / 2, z: pxToM(rc.cy, scaleMmPx) },
      size: { sx: mmToM(rc.widthMm), sy: mmToM(ceilingMm), sz: mmToM(rc.depthMm) },
      rotationY: -rc.angleRad,
    }))
}


export function roomsToPolygons3D(rooms: Room[], lines: PlanLine[], scaleMmPx: number): RoomPolygon3D[] {
  return rooms
    .map(room => {
      const pts = extractContourPoints(room.lineIds, lines)
      if (pts.length < 3) return null
      return {
        id: room.id,
        isColumn: !!room.isColumn,
        points: pts.map(p => ({ x: pxToM(p.x, scaleMmPx), z: pxToM(p.y, scaleMmPx) })),
      }
    })
    .filter((r): r is RoomPolygon3D => r !== null)
}
