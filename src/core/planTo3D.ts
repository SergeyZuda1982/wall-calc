/**
 * planTo3D.ts — перевод плоской геометрии плана (PlanLine/Room, координаты
 * в px + scaleMmPx) в геометрические примитивы для 3D-сцены (метры).
 *
 * Намеренно НЕ импортирует three.js и ничего не рендерит — чистые функции,
 * которые можно протестировать без браузера/WebGL. Сборка реальных мешей
 * (extrude, материалы, цвета) — в Scene3D.tsx.
 *
 * v1 упрощения (сознательно, см. KONSPEKT.md):
 * - проёмы (двери/окна) НЕ вырезаются из объёма стены — сплошной короб
 * - митры/стыки стен (wallJoin) не учитываются — стены просто накладываются
 *   друг на друга по углам, как коробки; визуально это уже "стена", а не
 *   голая линия, довести до идеального стыка можно отдельным шагом
 * - высота потолка не хранится как отдельная величина — estimateCeilingMm
 *   берёт максимум heightMm среди wall_existing (или дефолт), только чтобы
 *   было от чего повесить ригель
 */

import type { PlanLine, PlanLineType, Room, Slab } from '../types'
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
  return lines
    .map(l => wallToBox3D(l, scaleMmPx, ceilingMm))
    .filter((b): b is WallBox3D => b !== null)
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

/** Контуры помещений/колонн → полигоны в метрах, для заливки пола/потолка
 *  и объёма колонн в Scene3D (extrude по высоте средствами three.js). */
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
