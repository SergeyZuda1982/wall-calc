/**
 * ceilingGridGeometry.ts — геометрия сетки подвесного потолка (П112/П113)
 * для 3D-визуализации в Scene3D.
 *
 * Раскладка рядов и подвесов ПЕРЕИСПОЛЬЗУЕТ calcFrameRowPositions из
 * calcP112Frame.ts — то же самое правило, что уже используется в реальной
 * смете (первый ряд на расстоянии одного шага от стены, далее через шаг,
 * последний ряд подтягивается к стене, если естественный зазор большой).
 * Здесь эта раскладка не дублируется заново, а просто переводится в
 * координаты X/Z для отрисовки линий каркаса вместо расхода погонных
 * метров/штук.
 *
 * Намеренно НЕ импортирует three.js — чистые числа (мм), тот же принцип,
 * что и в core/planTo3D.ts. Сборка мешей (extrude сечения, инстансинг
 * крабов/подвесов) — в components/CeilingGridMesh.tsx.
 *
 * v1 упрощение: раскладка строится по ПРЯМОУГОЛЬНОМУ пролёту
 * (lengthMm × widthMm) — для 3D берётся bounding box контура помещения, не
 * сам многоугольник. Это не хуже того, что уже есть в смете
 * (calcP112Frame.ts тоже параметризован прямоугольным помещением) — просто
 * для непрямоугольных комнат сетка в 3D будет чуть шире фактического
 * контура. Подрезка под реальный контур — отдельная задача.
 *
 * v1 упрощение №2: bearingAlongLength/stepB/stepC пока не читаются из
 * данных помещения (Room ещё не хранит CeilingSpec, см. KONSPEKT.md/
 * ceilingData.ts) — используются дефолты (см. DEFAULT_* ниже). Это влияет
 * только на 3D-показ, не на смету — CeilingCalc.tsx считает по своим
 * значениям из формы, независимо от того, что нарисовано в 3D.
 */

import { calcFrameRowPositions, snapHangerPositionsToAxis } from './calcP112Frame'
import type { CeilingStep } from '../data/ceilingData'

export const DEFAULT_GRID_STEP_B: CeilingStep = 600
export const DEFAULT_GRID_STEP_C: CeilingStep = 600
export const DEFAULT_BEARING_ALONG_LENGTH = true

export interface CeilingGridInput {
  /** размер помещения вдоль X (bounding box контура), мм */
  lengthMm: number
  /** размер помещения вдоль Z (bounding box контура), мм */
  widthMm: number
  /** шаг несущего профиля и подвесов вдоль него, мм */
  stepB: number
  /** шаг основного профиля, мм */
  stepC: number
  /** несущий профиль идёт вдоль X (true) или вдоль Z (false) */
  bearingAlongLength: boolean
  /** 10.07.2026: максимально допустимое расстояние между подвесами (шаг "a"
   *  из таблицы КНАУФ) — подвес всегда ставится строго на оси основного
   *  профиля (см. snapHangerPositionsToAxis), это лишь ограничение "не реже
   *  чем". Не задан -> = stepB (та же практика, что и в calcP112Frame). */
  stepA?: number
}

/** Отрезок профиля в локальных координатах помещения (мм), 0..lengthMm/widthMm по обеим осям. */
export interface CeilingGridSegment {
  x1: number
  z1: number
  x2: number
  z2: number
}

export interface CeilingGridPoint {
  x: number
  z: number
}

export interface CeilingGridResult {
  /** несущий профиль (верхний уровень, к плите через подвесы) */
  bearingSegments: CeilingGridSegment[]
  /** основной профиль (нижний уровень, к нему крепится ГКЛ), перпендикулярно несущему */
  mainSegments: CeilingGridSegment[]
  /** точки соединителя (одноуровневый/двухуровневый) — пересечения несущих и основных линий */
  crabPoints: CeilingGridPoint[]
  /** точки подвесов вдоль каждой линии несущего профиля, шаг тот же — stepB */
  hangerPoints: CeilingGridPoint[]
}

/**
 * Считает сетку каркаса для прямоугольного пролёта.
 * Координаты локальные: (0,0) — один угол помещения, X растёт вдоль length,
 * Z растёт вдоль width. Перевод в мировые координаты 3D-сцены — на вызывающей
 * стороне (CeilingGridMesh), т.к. там же известны сдвиг и масштаб помещения.
 */
export function calcCeilingGrid(input: CeilingGridInput): CeilingGridResult {
  const { lengthMm, widthMm, stepB, stepC, bearingAlongLength, stepA } = input
  // A — пролёт, вдоль которого идёт (своей длиной) несущий профиль
  // B — пролёт, поперёк которого несущий профиль расставлен с шагом stepB
  const A = bearingAlongLength ? lengthMm : widthMm
  const B = bearingAlongLength ? widthMm : lengthMm

  const bearingPositions = calcFrameRowPositions(B, stepB)
  const mainPositions = calcFrameRowPositions(A, stepC)
  // 10.07.2026: подвес обязан висеть строго по оси основного профиля (тот же
  // фикс, что и в calcP112FrameGeometry/CeilingCalc.tsx, см. KONSPEKT.md,
  // "подвесы слетели с оси") — раньше здесь была НЕЗАВИСИМАЯ сетка через
  // calcFrameRowPositions(A, stepB), из-за чего подвесы в 3D физически не
  // попадали ни на один основной профиль. Теперь — подмножество mainPositions.
  const hangerOffsets = snapHangerPositionsToAxis(mainPositions, stepA ?? stepB)

  // toXZ переводит (координата вдоль A, координата поперёк B) в мировые (x,z)
  // локали помещения — учитывая, куда реально смотрит несущий профиль.
  const toXZ = (alongA: number, acrossB: number): CeilingGridPoint =>
    bearingAlongLength ? { x: alongA, z: acrossB } : { x: acrossB, z: alongA }

  const bearingSegments: CeilingGridSegment[] = bearingPositions.map(acrossB => {
    const p1 = toXZ(0, acrossB)
    const p2 = toXZ(A, acrossB)
    return { x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z }
  })

  const mainSegments: CeilingGridSegment[] = mainPositions.map(alongA => {
    const p1 = toXZ(alongA, 0)
    const p2 = toXZ(alongA, B)
    return { x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z }
  })

  const crabPoints: CeilingGridPoint[] = []
  for (const acrossB of bearingPositions) {
    for (const alongA of mainPositions) {
      crabPoints.push(toXZ(alongA, acrossB))
    }
  }

  const hangerPoints: CeilingGridPoint[] = []
  for (const acrossB of bearingPositions) {
    for (const alongA of hangerOffsets) {
      hangerPoints.push(toXZ(alongA, acrossB))
    }
  }

  return { bearingSegments, mainSegments, crabPoints, hangerPoints }
}
