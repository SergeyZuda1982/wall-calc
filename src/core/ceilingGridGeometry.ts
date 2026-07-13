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
  /** несущий профиль (нижний уровень, соединяется с основным крабом, без подвесов) */
  bearingSegments: CeilingGridSegment[]
  /** основной профиль (верхний уровень, крепится к плите подвесами), перпендикулярно несущему */
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
  // 12.07.2026, ИСПРАВЛЕНИЕ: подвес физически крепится к ОСНОВНОМУ профилю,
  // не к несущему (см. calcP112Frame.ts, шапка файла, — подтверждено
  // официальными чертежами КНАУФ П112.1 и П113.1). Раньше здесь снэпались
  // mainPositions и повторялись на каждом bearingPositions (то есть подвес
  // считался закреплённым НА несущем) — теперь наоборот: снэпаем
  // bearingPositions и повторяем на каждом mainPositions.
  const hangerOffsets = snapHangerPositionsToAxis(bearingPositions, stepA ?? stepB)

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
  for (const alongA of mainPositions) {
    for (const acrossB of hangerOffsets) {
      hangerPoints.push(toXZ(alongA, acrossB))
    }
  }

  return { bearingSegments, mainSegments, crabPoints, hangerPoints }
}

// ─── П113 (одноуровневая система) ──────────────────────────────────────────
// 13.07.2026: геометрия сетки для 3D — прямой аналог calcCeilingGrid выше, но
// с топологией П113 (см. core/calcP113Frame.ts, шапка файла — роли профилей
// ОБРАТНЫЕ по сравнению с П112): основной профиль СПЛОШНОЙ (как mainSegments
// у П112 по форме, но физика другая — он же несёт подвесы), несущий профиль
// физически режется КОРОТКИМИ ВСТАВКАМИ между соседними рядами основного —
// в отличие от П112, где оба профиля сплошные и просто пересекаются.
// Результат — тот же интерфейс CeilingGridResult (mainSegments/bearingSegments/
// crabPoints/hangerPoints), поэтому CeilingGridMesh.tsx переиспользует один и
// тот же рендер-код для обоих типов, различается только то, как заполнен
// bearingSegments (сплошные линии vs короткие куски) и высота Y на вызывающей
// стороне (одноуровневая система — один Y для обоих профилей, не mainY/bearingY
// с вертикальным разносом).

export interface CeilingGridP113Input {
  /** размер помещения вдоль X (bounding box контура), мм */
  lengthMm: number
  /** размер помещения вдоль Z (bounding box контура), мм */
  widthMm: number
  /** шаг несущего профиля (коротких вставок), мм */
  stepB: number
  /** шаг основного профиля (сплошного, с подвесами), мм */
  stepC: number
  /** основной профиль идёт вдоль X (true) или вдоль Z (false) — то же поле
   *  спецификации, что и bearingAlongLength у П112 (переиспользуется по
   *  аналогии, см. calcCeiling.ts, ветка hasPreciseGeometryP113). */
  mainAlongLength: boolean
  /** макс. допустимое расстояние между подвесами (шаг "a") — как у П112. */
  stepA?: number
}

/**
 * Считает сетку каркаса П113 (одноуровневая система) для прямоугольного
 * пролёта — та же bounding-box-логика v1, что и у calcCeilingGrid (см. шапку
 * файла, упрощение №1). Основной профиль — сплошные линии поперёк B на
 * позициях mainPositions (шаг c). Несущий профиль — на позициях bearingPositions
 * (шаг b) вдоль A, но КАЖДАЯ такая линия физически разбита на короткие куски
 * в точках пересечения с mainPositions (та же логика, что и
 * bearingSegmentLengthsMm в calcP113FrameGeometry, только тут сразу отрезки
 * с координатами для отрисовки, а не только длины).
 */
export function calcCeilingGridP113(input: CeilingGridP113Input): CeilingGridResult {
  const { lengthMm, widthMm, stepB, stepC, mainAlongLength, stepA } = input
  // A — пролёт, вдоль которого идёт (своей длиной) основной профиль
  // B — пролёт, поперёк которого основной профиль расставлен с шагом stepC
  const A = mainAlongLength ? lengthMm : widthMm
  const B = mainAlongLength ? widthMm : lengthMm

  const mainPositions = calcFrameRowPositions(B, stepC)
  const bearingPositions = calcFrameRowPositions(A, stepB)
  // Подвес — на основном профиле, снэп по позициям несущего (см. calcP113Frame.ts).
  const hangerOffsets = snapHangerPositionsToAxis(bearingPositions, stepA ?? stepB)

  const toXZ = (alongA: number, acrossB: number): CeilingGridPoint =>
    mainAlongLength ? { x: alongA, z: acrossB } : { x: acrossB, z: alongA }

  // Основной — сплошной, вдоль A, на каждой позиции acrossB (mainPositions).
  const mainSegments: CeilingGridSegment[] = mainPositions.map(acrossB => {
    const p1 = toXZ(0, acrossB)
    const p2 = toXZ(A, acrossB)
    return { x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z }
  })

  // Несущий — короткие вставки: на каждой позиции alongA (bearingPositions),
  // порезан позициями mainPositions вдоль B (плюс крайние куски у стен).
  const cutsB = [0, ...mainPositions, B]
  const bearingSegments: CeilingGridSegment[] = []
  for (const alongA of bearingPositions) {
    for (let i = 0; i + 1 < cutsB.length; i++) {
      const p1 = toXZ(alongA, cutsB[i])
      const p2 = toXZ(alongA, cutsB[i + 1])
      bearingSegments.push({ x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z })
    }
  }

  // Соединители одноуровневые — на пересечениях (тот же перебор, что и
  // connectorsTotal = mainCount × bearingRowCount в calcP113FrameGeometry).
  const crabPoints: CeilingGridPoint[] = []
  for (const alongA of bearingPositions) {
    for (const acrossB of mainPositions) {
      crabPoints.push(toXZ(alongA, acrossB))
    }
  }

  // Подвесы — на основном профиле (по одному ряду на каждую mainPosition),
  // позиции вдоль A — подмножество bearingPositions (там же соединитель).
  const hangerPoints: CeilingGridPoint[] = []
  for (const acrossB of mainPositions) {
    for (const alongA of hangerOffsets) {
      hangerPoints.push(toXZ(alongA, acrossB))
    }
  }

  return { mainSegments, bearingSegments, crabPoints, hangerPoints }
}
