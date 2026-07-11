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
 * - митры/стыки стен (wallJoin) С 08.07.2026 УЧИТЫВАЮТСЯ: тело стены
 *   (footprint) строится по расширенной оси (JoinedWall.ax1/ay1/ax2/ay2,
 *   та же самая, что и 2D-план использует для заливки без дыр в углах —
 *   см. FloorPlan.tsx, buildWallsForJoin в wallJoin.ts), а не по сырым
 *   line.x1/y1/x2/y2. Проёмы по-прежнему отмеряются от ОРИГИНАЛЬНОЙ линии
 *   (offsetMm не должен "уезжать" вместе с расширением на T-стыке) — см.
 *   wallToBoxesWithOpenings3D, тот же приём, что и в 2D computeOpeningSegments.
 *   Настоящего митра (скошенной грани) по-прежнему нет — стены остаются
 *   прямоугольными коробками, просто нужной длины и без торчащих торцов
 *   в местах стыков; довести до идеального скошенного стыка можно отдельным
 *   шагом (полноценная геометрия многоугольного сечения вместо коробки).
 * - высота потолка не хранится как отдельная величина — estimateCeilingMm
 *   берёт максимум heightMm среди wall_existing (или дефолт), только чтобы
 *   было от чего повесить ригель
 */

import type { PlanLine, PlanLineType, Room, Slab, RoundColumn, RectColumn, FreeformStructure } from '../types'
import { getLineVisual } from '../data/constructionTaxonomy'
import { extractContourPoints } from './contour'
import { isLineBuiltForRender } from './lineProgress'
import { computeWallJoins, buildWallsForJoin, type JoinedWall } from './wallJoin'
import { resolveWallProfileType, mapOpenings, DEFAULT_STEP_MM } from './planLineToWallInput'
import { buildPositions } from './buildPositions'

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

/**
 * Огрублённая "визуальная" категория материала стены для 3D (не путать с
 * PlanLineSpec.material — тем более детальным строковым значением из
 * таксономии типа 'gasblock'/'foamblock'/'block'/etc). Для 3D-текстур важна
 * только категория внешнего вида: кирпичная кладка / блочная кладка (газо-
 * блок, пеноблок, обычный блок — визуально те же ряды и швы, просто другой
 * оттенок) / монолит-бетон / неизвестно (нет данных — нейтральная плоская
 * штукатурка, как было раньше). ГКЛ (gkl), плитка, штукатурка как отделка
 * (wall_lining) и wall_new без заданного материала кладки сюда НЕ попадают —
 * это не кладка, у них остаётся текущий плоский вид (см. KONSPEKT.md,
 * обсуждение с пользователем: реалистичный ГКЛ-каркас — отдельная, более
 * крупная задача, пока не начата).
 */
export type WallMaterialKind = 'brick' | 'block' | 'concrete' | 'unknown'

export function wallMaterialKindOf(material: string | undefined): WallMaterialKind {
  if (material === 'brick') return 'brick'
  if (material === 'gasblock' || material === 'foamblock' || material === 'block') return 'block'
  if (material === 'concrete') return 'concrete'
  return 'unknown'
}

/**
 * Позиции вертикальных стоек каркаса ГКЛ-стены, мм от начала ЛИНИИ (x1,y1) —
 * для 3D-визуализации каркаса (Этап 2 "реалистичные материалы", 10-11.07.2026,
 * см. Scene3D.tsx wallGklVisual3D). НЕ рисует сам каркас (это остаётся three.js
 * стороне, Scene3D.tsx) — только числа, чтобы 3D показывал стойки РЕАЛЬНО ТАМ,
 * где они физически будут (тот же расчёт, что и материал на смету, см.
 * planLineToWallInput.ts/buildPositions.ts), а не выдуманную равномерную сетку.
 *
 * Полноценный расчёт (buildPositions с учётом проёмов) — только для wall_new
 * с поддержанным профилем каркаса (ps50/ps75/ps100, см. resolveWallProfileType).
 * Для wall_lining (облицовка, там нет "каркаса" в смысле calcResults — обрешётка
 * на кляймерах) и для неподдержанных профилей (ps125/двойной каркас — сам
 * калькулятор материала их тоже не считает, см. planLineToWallInput.ts) —
 * упрощённая равномерная сетка с шагом spec.step без учёта проёмов; известное
 * упрощение, документировано здесь и там же, где аналогичное для материала.
 */
export function wallStudPositionsMm(line: PlanLine): number[] {
  if (line.lengthMm <= 0) return []
  const stepMm = line.spec?.step ?? DEFAULT_STEP_MM

  if (line.type === 'wall_new') {
    const profileType = resolveWallProfileType(line.spec?.subtype)
    if (profileType) {
      return buildPositions(line.lengthMm, stepMm, stepMm, mapOpenings(line)).positions
    }
  }

  const positions: number[] = []
  for (let p = stepMm; p < line.lengthMm; p += stepMm) positions.push(Math.round(p))
  return positions
}

export interface WallBox3D {
  id: string
  /**
   * id исходной PlanLine (10.07.2026, выбор стены кликом в 3D) — ОТДЕЛЬНО от
   * `id` выше, потому что `id` для сегментов вокруг проёмов (см.
   * wallToBoxesWithOpenings3D) уже занят под `${line.id}__suffix` (нужен
   * React key + уникальность на сегмент). lineId у ВСЕХ коробок одной линии
   * (целая стена, подоконник, перемычка, хвост) совпадает с line.id — по
   * нему собирается высвечивание/выбор стены ЦЕЛИКОМ по клику на любой её
   * части, а не по отдельному сегменту.
   */
  lineId: string
  planLineType: PlanLineType
  /** центр коробки, метры; x/z — план (сверху), y — вертикаль (вверх) */
  center: { x: number; y: number; z: number }
  /** размеры, метры: sx — вдоль оси линии, sy — высота, sz — толщина */
  size: { sx: number; sy: number; sz: number }
  /** поворот вокруг вертикальной оси Y, радианы */
  rotationY: number
  /** визуальная категория материала для 3D-текстуры, см. wallMaterialKindOf */
  materialKind: WallMaterialKind
}

/**
 * Одна линия плана (стена любого типа или ригель) → коробка в 3D.
 * Возвращает null для линий без толщины (та же логика "не рисуем трапецию
 * без spec", что и в 2D) — они и на плане не видны как объём.
 *
 * axisOverride — расширенная ось стыка (JoinedWall.ax1/ay1/ax2/ay2, px),
 * если задана, используется ВМЕСТО сырых line.x1/y1/x2/y2 для футпринта
 * коробки (см. wallsToBoxes3D) — та же ось, что 2D-план использует для
 * заливки без дыр в углах. Проёмы (wallToBoxesWithOpenings3D) по ней НЕ
 * мерятся — только сам футпринт целиком (длина/центр/поворот).
 */
export function wallToBox3D(
  line: PlanLine, scaleMmPx: number, ceilingMm: number,
  axisOverride?: { x1: number; y1: number; x2: number; y2: number },
): WallBox3D | null {
  const tMm = wallThicknessMm(line)
  if (tMm <= 0) return null

  const rawX1 = axisOverride?.x1 ?? line.x1, rawY1 = axisOverride?.y1 ?? line.y1
  const rawX2 = axisOverride?.x2 ?? line.x2, rawY2 = axisOverride?.y2 ?? line.y2
  const x1 = pxToM(rawX1, scaleMmPx), z1 = pxToM(rawY1, scaleMmPx)
  const x2 = pxToM(rawX2, scaleMmPx), z2 = pxToM(rawY2, scaleMmPx)
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
    lineId: line.id,
    planLineType: line.type,
    center: { x: (x1 + x2) / 2, y: centerY, z: (z1 + z2) / 2 },
    size: { sx: length, sy: heightM, sz: mmToM(tMm) },
    rotationY: Math.atan2(-dz, dx),
    materialKind: wallMaterialKindOf(line.spec?.material),
  }
}

/**
 * Линии, у которых явно заведён buildProgress без единого подтверждённого
 * шага (пользователь осознанно включил отслеживание, но работы ещё не
 * начаты) — не рисуются в 3D вообще. Линии БЕЗ buildProgress ведут себя
 * как раньше (всегда видны) — обратная совместимость, см. lineProgress.ts.
 * estimateCeilingMm намеренно считается по ПОЛНОМУ списку линий (высота
 * потолка — не то, что должно "пропадать" вместе с ещё не начатой стеной).
 *
 * rectColumns — прямоугольные колонны этого этажа (необязательно, дефолт
 * []): участвуют в расчёте стыков (buildWallsForJoin/computeWallJoins), их
 * грани обрезают/удлиняют примыкающие стены под ЛЮБЫМ углом, не только 90°
 * (см. wallJoin.ts). Сама колонна рисуется отдельно, см. rectColumnsToBoxes3D.
 */
export function wallsToBoxes3D(lines: PlanLine[], scaleMmPx: number, rectColumns: RectColumn[] = []): WallBox3D[] {
  const ceilingMm = estimateCeilingMm(lines)
  const joins = computeWallJoins(buildWallsForJoin(lines, scaleMmPx, rectColumns))
  return lines.filter(isLineBuiltForRender).flatMap(l => {
    const jw: JoinedWall | undefined = joins.get(l.id)
    const axisOverride = jw ? { x1: jw.ax1, y1: jw.ay1, x2: jw.ax2, y2: jw.ay2 } : undefined
    return wallToBoxesWithOpenings3D(l, scaleMmPx, ceilingMm, axisOverride)
  })
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
 *
 * axisOverride — см. wallToBox3D. Проёмы (offsetMm) ВСЕГДА мерятся от
 * ОРИГИНАЛЬНОЙ линии (line.x1/y1), а не от расширенной оси — иначе при
 * T-стыке с колонной/соседней стеной проёмы "уехали" бы вместе с
 * расширением. Ровно тот же приём, что computeOpeningSegments в 2D
 * (fax1/fay1 для тела стены, origX1/origY1 для позиций проёмов).
 */
export function wallToBoxesWithOpenings3D(
  line: PlanLine, scaleMmPx: number, ceilingMm: number,
  axisOverride?: { x1: number; y1: number; x2: number; y2: number },
): WallBox3D[] {
  const baseOrNull = wallToBox3D(line, scaleMmPx, ceilingMm, axisOverride)
  if (!baseOrNull) return []
  const base: WallBox3D = baseOrNull

  const lengthM = base.size.sx
  const ux = Math.cos(base.rotationY), uz = -Math.sin(base.rotationY) // см. rotationY = atan2(-dz, dx) в wallToBox3D
  const startX = base.center.x - ux * lengthM / 2
  const startZ = base.center.z - uz * lengthM / 2

  // Сдвиг: где вдоль РАСШИРЕННОЙ оси (0..lengthM) лежит начало ОРИГИНАЛЬНОЙ
  // линии — проекция (origStart − extStart) на направление оси. Обычно ≥0
  // (T-стык расширяет начало "назад", наружу), но защищаемся и от обратного
  // случая на всякий (например, будущий митр, который вместо расширения
  // подрежет — clamp ниже всё равно не даст уйти за пределы футпринта).
  const origX1M = pxToM(line.x1, scaleMmPx), origZ1M = pxToM(line.y1, scaleMmPx)
  const shiftM = (origX1M - startX) * ux + (origZ1M - startZ) * uz

  const openings = (line.openings ?? [])
    .filter(o => o.widthMm > 0 && o.heightMm > 0)
    .map(o => ({
      id: o.id,
      // клэмпим к длине РАСШИРЕННОГО футпринта — защита от рассинхрона (линию
      // укоротили после того, как проём был добавлен, ИЛИ проём у самого края
      // и попадает в зону расширения T-стыка — в 2D в этом случае тоже "режется")
      startM: Math.min(Math.max(shiftM + mmToM(o.offsetMm), 0), lengthM),
      endM: Math.min(Math.max(shiftM + mmToM(o.offsetMm + o.widthMm), 0), lengthM),
      sillM: Math.max(mmToM(o.sillHeightMm ?? 0), 0),
      heightM: mmToM(o.heightMm),
    }))
    .filter(o => o.endM > o.startM)
    .sort((a, b) => a.startM - b.startM)

  if (openings.length === 0) return [base]

  const wallHeightM = base.size.sy
  const bottomY = base.center.y - wallHeightM / 2   // низ стены (обычно 0, стена стоит на полу)

  const boxes: WallBox3D[] = []

  function pushAlong(fromM: number, toM: number, suffix: string) {
    const segLen = toM - fromM
    if (segLen <= 0.001) return
    const midM = (fromM + toM) / 2
    boxes.push({
      id: `${line.id}__${suffix}`,
      lineId: line.id,
      planLineType: line.type,
      center: { x: startX + ux * midM, y: base.center.y, z: startZ + uz * midM },
      size: { sx: segLen, sy: wallHeightM, sz: base.size.sz },
      rotationY: base.rotationY,
      materialKind: base.materialKind,
    })
  }

  function pushVertical(fromM: number, toM: number, yFrom: number, yTo: number, suffix: string) {
    const segLen = toM - fromM
    const h = yTo - yFrom
    if (segLen <= 0.001 || h <= 0.001) return
    const midM = (fromM + toM) / 2
    boxes.push({
      id: `${line.id}__${suffix}`,
      lineId: line.id,
      planLineType: line.type,
      center: { x: startX + ux * midM, y: yFrom + h / 2, z: startZ + uz * midM },
      size: { sx: segLen, sy: h, sz: base.size.sz },
      rotationY: base.rotationY,
      materialKind: base.materialKind,
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
  /** "Помещение 1" и т.п. — для подписи-таблички в 3D (Scene3D), не используется
   *  для колонн (isColumn: true) */
  label: string
  /** точки контура в метрах, план сверху (x,z) — по часовой/против часовой,
   *  как пришли из extractContourPoints, без изменений */
  points: { x: number; z: number }[]
  /** НОВОЕ (10.07.2026): настройки каркаса подвесного потолка, если были
   *  сохранены из CeilingCalc.tsx («Сохранить в 3D», см. roomToCeilingSeed.ts).
   *  Не задано -> Scene3D рисует CeilingGridMesh по дефолтам, как раньше. */
  ceilingSpec?: Room['ceilingSpec']
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
        label: room.label,
        points: pts.map(p => ({ x: pxToM(p.x, scaleMmPx), z: pxToM(p.y, scaleMmPx) })),
        ...(room.ceilingSpec ? { ceilingSpec: room.ceilingSpec } : {}),
      }
    })
    .filter((r): r is RoomPolygon3D => r !== null)
}

export interface FreeformPrism3D {
  id: string
  /**
   * id исходного FreeformStructure (10.07.2026, выбор кликом в 3D) —
   * ОТДЕЛЬНО от `id` выше по той же причине, что и lineId у WallBox3D:
   * при нескольких проёмах на разной высоте один FreeformStructure даёт
   * НЕСКОЛЬКО призм (band'ов) с id вида `${fs.id}__band_${i}` — structureId
   * у всех них общий, по нему собирается выделение конструкции ЦЕЛИКОМ.
   */
  structureId: string
  kind: 'wall' | 'column'
  /** точки контура в метрах, план сверху (x,z) */
  points: { x: number; z: number }[]
  /** высота ЭТОГО сегмента (band) по вертикали, метры */
  heightM: number
  /** смещение сегмента по вертикали от пола, метры (0 — сегмент начинается от пола) */
  bottomM: number
  /** вырезы (проёмы), активные на всём протяжении этого сегмента — контуры в метрах, план сверху (x,z) */
  holes: { x: number; z: number }[][]
  /**
   * визуальная категория материала для 3D-текстуры (см. wallMaterialKindOf).
   * Для kind: 'column' всегда 'concrete' (произвольные колонны в этом проекте
   * не заводят отдельный spec.material для внешнего вида, как и остальные
   * колонны — RoundColumnMesh/RectColumnMesh); для kind: 'wall' — из fs.spec.
   */
  materialKind: WallMaterialKind
}

/**
 * Обведённые карандашом стены/перегородки и колонны произвольной формы →
 * призмы для Scene3D (THREE.Shape + ExtrudeGeometry, та же техника, что
 * уже применяется в Scene3D.tsx для колонн-Room, см. SlabOrColumn/
 * columnGeo). Оба вида (kind) — геометрически одна и та же операция,
 * extrude контура на всю высоту; kind нужен Scene3D только для выбора
 * цвета (стена — TYPE_COLOR_3D.wall_existing, колонна — COLUMN_COLOR),
 * геометрически они неразличимы.
 *
 * Проёмы (07.07.2026, FreeformOpening) — без булевой геометрии (CSG),
 * которой в проекте нет: используется тот же приём, что и у Slab (полигон
 * с дырками, THREE.Shape.holes), но т.к. проёмы могут иметь разную высоту
 * (sillHeightMm/heightMm), контур режется на вертикальные "band"-сегменты
 * по границам проёмов (та же идея, что wallToBoxesWithOpenings3D делает
 * вдоль оси прямой стены, только тут — по высоте, а не по длине): один
 * FreeformStructure может дать НЕСКОЛЬКО FreeformPrism3D, каждый — свой
 * диапазон высоты (bottomM..bottomM+heightM), с дырками, которые в этот
 * диапазон целиком попадают. Проём без heightMm — на всю высоту стены
 * (сразу один сплошной вырез, без верхнего/нижнего band).
 */
export function freeformStructuresToPrisms3D(
  structures: FreeformStructure[], scaleMmPx: number, ceilingMm: number,
): FreeformPrism3D[] {
  const toM = (pts: { x: number; y: number }[]) => pts.map(p => ({ x: pxToM(p.x, scaleMmPx), z: pxToM(p.y, scaleMmPx) }))
  const EPS = 1e-6
  const result: FreeformPrism3D[] = []

  for (const fs of structures) {
    if (fs.outer.length < 3) continue
    const points = toM(fs.outer)
    const totalHeightM = mmToM(fs.heightMm ?? ceilingMm)
    const materialKind: WallMaterialKind = fs.kind === 'column' ? 'concrete' : wallMaterialKindOf(fs.spec?.material)

    const openings = (fs.openings ?? [])
      .filter(o => o.contour.length >= 3)
      .map(o => {
        const sillM = Math.min(Math.max(mmToM(o.sillHeightMm ?? 0), 0), totalHeightM)
        const heightMm = o.heightMm ?? (fs.heightMm ?? ceilingMm) // не задано — на всю высоту стены
        const topM = Math.min(totalHeightM, sillM + mmToM(heightMm))
        return { contourM: toM(o.contour), sillM, topM }
      })
      .filter(o => o.topM - o.sillM > EPS)

    if (openings.length === 0) {
      result.push({ id: fs.id, structureId: fs.id, kind: fs.kind, points, heightM: totalHeightM, bottomM: 0, holes: [], materialKind })
      continue
    }

    const boundariesSet = new Set<number>([0, totalHeightM])
    for (const o of openings) { boundariesSet.add(o.sillM); boundariesSet.add(o.topM) }
    const boundaries = [...boundariesSet].sort((a, b) => a - b)

    for (let i = 0; i < boundaries.length - 1; i++) {
      const bFrom = boundaries[i], bTo = boundaries[i + 1]
      const bandH = bTo - bFrom
      if (bandH <= EPS) continue
      const activeHoles = openings
        .filter(o => o.sillM <= bFrom + EPS && o.topM >= bTo - EPS)
        .map(o => o.contourM)
      result.push({
        id: `${fs.id}__band_${i}`,
        structureId: fs.id,
        kind: fs.kind,
        points,
        heightM: bandH,
        bottomM: bFrom,
        holes: activeHoles,
        materialKind,
      })
    }
  }

  return result
}
