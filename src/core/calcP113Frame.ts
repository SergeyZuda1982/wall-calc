/**
 * Точный геометрический расчёт металлического каркаса П113 (одноуровневый).
 * По аналогии с calcP112Frame.ts (см. КОНСПЕКТ.md, сессия 05.07.2026), но
 * топология другая — см. ниже. Источник: официальный чертёж КНАУФ, серия
 * 1.045.9-2.08.1-4, лист 38 «Потолок П113.1 (П213.1)» (прислан пользователем
 * 12.07.2026) + подтверждено пользователем на объекте (монтажник, реальная
 * практика — см. диалог в этом чате).
 *
 * ⚠️ РОЛИ ПРОФИЛЕЙ У П113 ОБРАТНЫЕ ПО СРАВНЕНИЮ С П112 — это НЕ опечатка:
 *
 *   ОСНОВНОЙ профиль — СПЛОШНОЙ на всю длину пролёта, крепится к плите
 *     ПРЯМЫМ ПОДВЕСОМ. Держит нагрузку и плоскость. Шаг между соседними
 *     рядами основного — c (500-1200мм, свободный выбор пользователя,
 *     как и раньше в остальных типах).
 *   НЕСУЩИЙ профиль — идёт ПЕРПЕНДИКУЛЯРНО основному, и в отличие от П112
 *     режется КОРОТКИМИ ВСТАВКАМИ между соседними рядами основного профиля
 *     (не идёт сплошным через все пересечения — по чертежу видно, что
 *     каждая вставка помещается ровно в один пролёт между двумя рядами
 *     основного). Стык — ТОРЦОМ В ГРАНЬ основного профиля (одноуровневый
 *     краб, не внахлёст, подтверждено фото пользователя 18.07.2026) —
 *     поэтому физическая длина вставки короче межосевого расстояния на
 *     ширину основного профиля (MAIN_PROFILE_WIDTH_MM, см.
 *     bearingSegmentLengthsMm ниже: внутренние вставки короче на полную
 *     ширину, крайние у стен — на половину). На него ложится ГКЛ. Шаг
 *     между рядами несущего — b, ЖЁСТКО задан направлением монтажа листов
 *     (500мм поперечный / 400мм
 *     продольный), как и в П112 (см. KNAUF_BEARING_STEP_BY_MOUNT).
 *   В П112 было наоборот: несущий — сплошной верхний уровень с подвесами,
 *     основной — сплошной нижний уровень. У П113 такого разделения по
 *     уровням нет (система одноуровневая, отсюда и название) — поэтому
 *     один из двух профилей физически ОБЯЗАН прерываться в местах
 *     пересечения, и это именно несущий.
 *
 * Соединитель — ОДНОУРОВНЕВЫЙ (в просторечье тоже иногда зовут «краб», но
 * это другая деталь, чем двухуровневый краб П112). По подтверждению
 * пользователя — ОДИН соединитель на каждое пересечение (там, где торец
 * вставки несущего профиля примыкает к ряду основного), а не два.
 * connectorsTotal = mainCount × bearingRowCount — та же формула по форме,
 * что и у П112 (bearingCount × mainCount), просто множители значат другое.
 *
 * Официальная таблица межосевых расстояний (лист 38, та же серия) числом
 * идентична KNAUF_HANGER_SPACING_TABLE / KNAUF_BEARING_STEP_BY_MOUNT, уже
 * используемым для П112 (см. calcP112Frame.ts) — переиспользуем как есть,
 * без дублирования. Требует проверки: возможно эта же таблица общая для
 * обеих систем, а не была ошибочно взята из чужого листа для П112 —
 * см. TASKS.md, пункт "открытые вопросы" на 12.07.2026.
 *
 * Подвесы — крепятся к ОСНОВНОМУ профилю (он крепится к плите). По прямой
 * аналогии с правилом П112 (подвес обязан висеть строго в точке
 * пересечения/соединителя, snapHangerPositionsToAxis) — здесь подвес на
 * основном профиле снэпается к позициям НЕСУЩЕГО профиля (bearingPositions),
 * т.к. именно там стоит соединитель и узел жёсткий. Это ЭКСТРАПОЛЯЦИЯ
 * правила П112 на П113 по аналогии, отдельно с пользователем не сверялась —
 * если на объекте иначе, поправить здесь.
 */

import type { CeilingLoadClass, CeilingMountDirection } from '../data/ceilingData'
import { MAIN_PROFILE_WIDTH_MM } from '../data/ceilingData'
import {
  calcFrameRowPositions,
  snapHangerPositionsToAxis,
  resolveHangerKind,
  KNAUF_WALL_OFFSET_MM,
  type FrameLayoutMode,
  type HangerKind,
  STANDARD_BAR_LENGTH_MM,
} from './calcP112Frame'

export interface P113FrameGeometry {
  /** Число рядов основного профиля (сплошного, с подвесами). */
  mainCount: number
  /** Длина каждого основного профиля, мм (= пролёт, вдоль которого он идёт). */
  mainLengthEachMm: number
  mainTotalLm: number
  /** Позиции рядов основного профиля вдоль пролёта B, мм. */
  mainPositions: number[]
  /** Число подвесов на одном ряду основного профиля. */
  hangersPerMain: number
  hangersTotal: number
  /** Позиции подвесов вдоль A, мм — подмножество bearingPositions (подвес
   *  стоит строго в точке соединителя с несущим профилем). Одни и те же
   *  для каждого ряда основного профиля. */
  hangerPositions: number[]
  /** Число рядов несущего профиля (поперёк, шаг b) — КАЖДЫЙ ряд состоит из
   *  bearingSegmentsPerRow коротких вставок, а не одного сплошного куска. */
  bearingRowCount: number
  /** Позиции рядов несущего профиля вдоль A, мм. */
  bearingPositions: number[]
  /** Число вставок несущего профиля в одном ряду (= mainCount + 1 —
   *  пролётов между рядами основного профиля, включая крайние у стен). */
  bearingSegmentsPerRow: number
  /** Длины отдельных вставок несущего профиля в одном ряду, мм. Всегда
   *  короче межосевого расстояния до соседних рядов основного профиля —
   *  вычтена его ширина (стык торцом в грань, см. MAIN_PROFILE_WIDTH_MM):
   *  внутренние вставки короче на полную ширину, крайние у стен — на
   *  половину (другой конец упирается в периметральный профиль). */
  bearingSegmentLengthsMm: number[]
  /** Общее число физических кусков несущего профиля. */
  bearingTotalPieces: number
  bearingTotalLm: number
  /** Соединитель одноуровневый — по пересечениям (mainCount × bearingRowCount). */
  connectorsTotal: number
  bearingExtenders: number
  mainExtenders: number
  hangerKind: HangerKind
  hangerWarning?: string
}

/**
 * Геометрия каркаса П113 для прямоугольного помещения без препятствий.
 *
 * mainAlongLength: основной профиль (сплошной, с подвесами) идёт вдоль
 * длины помещения (true) или вдоль ширины (false) — как и bearingAlongLength
 * в П112, не определяется автоматически.
 */
export function calcP113FrameGeometry(
  roomLengthMm: number,
  roomWidthMm: number,
  stepC: number,
  stepB: number,
  slabGapMm: number,
  mainAlongLength: boolean,
  layoutMode: FrameLayoutMode = 'user',
  extra: {
    stepA?: number
    wallOffsetMainMm?: number
    wallOffsetBearingMm?: number
    /** Ширина основного профиля, мм — см. MAIN_PROFILE_WIDTH_MM. Вычитается
     *  из длин вставок несущего профиля (стык торцом в грань, не внахлёст). */
    mainProfileWidthMm?: number
  } = {},
): P113FrameGeometry {
  // A — пролёт вдоль которого идёт (своей длиной) основной профиль
  // B — пролёт поперёк которого основной профиль расставлен с шагом stepC
  const A = mainAlongLength ? roomLengthMm : roomWidthMm
  const B = mainAlongLength ? roomWidthMm : roomLengthMm

  const defaultWallOffset = layoutMode === 'knauf' ? KNAUF_WALL_OFFSET_MM : undefined
  const wallOffsetMainMm = extra.wallOffsetMainMm ?? defaultWallOffset
  const wallOffsetBearingMm = extra.wallOffsetBearingMm ?? defaultWallOffset

  // Основной профиль (сплошной, с подвесами) — ряды поперёк B, шаг c.
  const mainPositions = calcFrameRowPositions(
    B, stepC, { mode: layoutMode, wallOffsetMm: wallOffsetMainMm },
  )
  const mainCount = mainPositions.length
  const mainLengthEachMm = A
  const mainTotalLm = (mainCount * mainLengthEachMm) / 1000

  // Несущий профиль — перпендикулярно основному, ряды вдоль A, шаг b.
  // Каждый ряд физически состоит из коротких вставок между соседними
  // позициями основного профиля (включая крайние — от стены до первого и
  // от последнего до противоположной стены).
  const bearingPositions = calcFrameRowPositions(
    A, stepB, { mode: layoutMode, wallOffsetMm: wallOffsetBearingMm },
  )
  const bearingRowCount = bearingPositions.length

  // Несущий стыкуется с основным профилем ТОРЦОМ В ГРАНЬ (одноуровневый
  // краб, фото пользователя 18.07.2026), а не внахлёст поверх — поэтому
  // физическая длина вставки короче межосевого расстояния на ширину
  // основного профиля. Внутренние вставки (оба конца упираются в основной
  // профиль) короче на ПОЛНУЮ ширину; крайние у стен (только один конец
  // упирается в основной, другой — в периметральный профиль у стены,
  // туда ничего не вычитаем) — короче на ПОЛОВИНУ ширины.
  const mainProfileWidthMm = extra.mainProfileWidthMm ?? MAIN_PROFILE_WIDTH_MM
  const bearingSegmentLengthsMm: number[] = []
  let prev = 0
  mainPositions.forEach((pos, i) => {
    const cut = i === 0 ? mainProfileWidthMm / 2 : mainProfileWidthMm
    bearingSegmentLengthsMm.push(Math.max(0, pos - prev - cut))
    prev = pos
  })
  const lastCut = mainPositions.length > 0 ? mainProfileWidthMm / 2 : 0
  bearingSegmentLengthsMm.push(Math.max(0, B - prev - lastCut))
  const bearingSegmentsPerRow = bearingSegmentLengthsMm.length // = mainCount + 1

  const bearingTotalPieces = bearingRowCount * bearingSegmentsPerRow
  const bearingRowLengthMm = bearingSegmentLengthsMm.reduce((sum, len) => sum + len, 0)
  const bearingTotalLm = (bearingRowCount * bearingRowLengthMm) / 1000

  // Подвесы — на основном профиле, снэпаются к позициям несущего профиля
  // (там же соединитель, узел жёсткий) — см. предупреждение в шапке файла.
  const stepA = extra.stepA ?? stepB
  const hangerPositions = snapHangerPositionsToAxis(bearingPositions, stepA)
  const hangersPerMain = hangerPositions.length
  const hangersTotal = mainCount * hangersPerMain

  const connectorsTotal = mainCount * bearingRowCount

  const mainExtenders = mainCount * Math.max(0, Math.ceil(mainLengthEachMm / STANDARD_BAR_LENGTH_MM) - 1)
  // Вставки несущего профиля короткие (обычно меньше стандартного хлыста
  // 3000мм — это же ширина одного пролёта c), но на случай крупного шага c
  // (>3000мм, вне обычных значений CeilingStep) проверяем и их тоже.
  const bearingExtenders = bearingRowCount * bearingSegmentLengthsMm.reduce(
    (sum, len) => sum + Math.max(0, Math.ceil(len / STANDARD_BAR_LENGTH_MM) - 1), 0,
  )

  const { kind, warning } = resolveHangerKind(slabGapMm)

  return {
    mainCount, mainLengthEachMm, mainTotalLm, mainPositions,
    hangersPerMain, hangersTotal, hangerPositions,
    bearingRowCount, bearingPositions, bearingSegmentsPerRow, bearingSegmentLengthsMm,
    bearingTotalPieces, bearingTotalLm,
    connectorsTotal, bearingExtenders, mainExtenders,
    hangerKind: kind, hangerWarning: warning,
  }
}

// Реэкспорт для удобства использования из calcCeiling.ts / UI — не дублируем
// resolveFrameParams (та же таблица КНАУФ подходит для обоих типов, см.
// шапку файла), берётся напрямую из calcP112Frame.ts.
export type { CeilingMountDirection, CeilingLoadClass }
