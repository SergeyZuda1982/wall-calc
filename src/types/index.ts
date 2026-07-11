import type { CeilingSpec } from '../data/ceilingData'

// ─── Геометрия потолка/пола (переменная высота) ──────────────────────────────

// x = позиция по длине стены от начала (мм), y = высота от условного нуля (мм)
export interface ProfilePoint {
  x: number
  y: number
}

// Ломаная линия потолка или пола, минимум 2 точки, отсортирована по x от 0 до l.
// Несколько точек с одинаковым x подряд = вертикальный перепад (ступень в полу).
export type EdgeProfile = ProfilePoint[]

// Сохранённый фрагмент профиля (балка/ригель/ступени и т.п.) — хранится
// смещениями от первой точки формы (shape[0] всегда {dx:0, dy:0}), чтобы
// один и тот же шаблон можно было воткнуть в любом месте любой стены
// объекта: dx — длина по стене, dy — отклонение от базовой высоты в этой
// точке на момент вставки (не абсолютная высота).
export interface ProfileTemplate {
  id: string
  name: string
  shape: ProfilePoint[]   // переиспользуем x/y как dx/dy
}

// ─── Материал обшивки ────────────────────────────────────────────────────────

// Базовый тип материала — используется как ключ пула раскроя и для типа самореза
export type BoardMaterial = 'gkl' | 'gvl' | 'sapphire' | 'aquamarine'

// Подтипы ГКЛ (ГВЛ/Сапфир/Аквамарин подтипов не имеют)
export type GklSubtype = 'standard' | 'moisture' | 'fire' | 'moisture_fire'

// Полная спецификация листового материала
export interface BoardSpec {
  material:    BoardMaterial
  subtype:     GklSubtype | null  // null для ГВЛ / Сапфир / Аквамарин
  thickness:   number             // мм: 9.5 | 10 | 12.5
  sheetWidth:  number             // мм, всегда 1200 для RU-рынка
  sheetLength: number             // мм: 2500 | 2700 | 3000
}

// Дефолт — ГКЛ обычный 12.5 × 1200 × 2500
export const DEFAULT_BOARD_SPEC: BoardSpec = {
  material:    'gkl',
  subtype:     'standard',
  thickness:   12.5,
  sheetWidth:  1200,
  sheetLength: 2500,
}

// Миграция старых значений (строка 'gkl') → BoardSpec
// Используется в useProjectStore при rehydrate и в useWallCalc
export function migrateBoard(val: BoardMaterial | BoardSpec | unknown): BoardSpec {
  if (val && typeof val === 'object' && 'material' in (val as object)) {
    return val as BoardSpec
  }
  const mat = (typeof val === 'string' ? val : 'gkl') as BoardMaterial
  return { ...DEFAULT_BOARD_SPEC, material: mat }
}

// Человекочитаемая метка для BoardSpec
// Примеры: «ГКЛВ 12.5», «ГВЛ 10», «Сапфир», «Аквамарин»
export function boardLabel(spec: BoardSpec): string {
  const { material, subtype, thickness, sheetLength } = spec
  if (material === 'sapphire')   return 'Сапфир'
  if (material === 'aquamarine') return 'Аквамарин'

  let label = material === 'gvl' ? 'ГВЛ' : 'ГКЛ'
  if (subtype === 'moisture')      label += 'В'
  else if (subtype === 'fire')     label += 'О'
  else if (subtype === 'moisture_fire') label += 'ВО'

  label += ` ${thickness}`
  if (sheetLength !== 2500) label += ` · ${sheetLength}`
  return label
}

// Оставляем для обратной совместимости (используется в ведомости материалов)
export const BOARD_LABEL: Record<BoardMaterial, string> = {
  gkl:        'ГКЛ',
  gvl:        'ГВЛ',
  sapphire:   'Сапфир',
  aquamarine: 'Аквамарин',
}

// Тип самореза по материалу листа
export function screwCode(spec: BoardSpec): 'TN' | 'MN' | 'XTN' {
  if (spec.material === 'gkl') return 'TN'
  if (spec.material === 'gvl') return 'MN'
  return 'XTN'
}

// ─── Закладные из фанеры ─────────────────────────────────────────────────────

export interface PlywoodInsert {
  id: string
  x: number      // горизонтальная позиция от начала стены, мм
  y: number      // отступ от пола, мм
  width: number  // ширина, мм
  height: number // высота, мм
}

// ─── Результат расчёта саморезов ─────────────────────────────────────────────

export interface ScrewResult {
  ln11: number                          // клопы LN 11 мм
  code25: 'TN' | 'MN' | 'XTN'         // тип самореза 25 мм (1-й слой)
  count25: number                       // кол-во 25 мм (Кнауф)
  code35: 'TN' | 'MN' | 'XTN' | null  // тип самореза 35 мм (2-й слой), null если 1 слой
  count35: number                       // кол-во 35 мм (Кнауф), 0 если 1 слой
  woodScrews: number                    // саморезы по дереву для фанеры
}

// ─── Профили ────────────────────────────────────────────────────────────────

export type ProfileType = 'ps50' | 'ps75' | 'ps100'
export type ProfileThickness = '06' | '07'

export interface Profile {
  label: string
  value: ProfileType
  overlap: number
  width: number
}

// ─── Проёмы ─────────────────────────────────────────────────────────────────

export type OpeningType = 'door' | 'window'

export interface Opening {
  id: string
  type: OpeningType
  pos: number
  width: number
  height: number
  sillHeight: number
}

// ─── Перегородка ────────────────────────────────────────────────────────────

export type WallType = 'c111' | 'c112'
export type AbutmentType = 'both' | 'left' | 'right' | 'none'

/**
 * Двойной каркас (два независимых параллельных ряда стоек, свой ПН/ПС
 * с каждой стороны) — см. КОНСПЕКТ.md, сессия 04.07.2026. Отличаются
 * только обшивкой/зазором, не геометрией каркаса:
 *   c115_1 — 2 слоя ГКЛ с обеих сторон (симметрично)
 *   c115_2 — как c115_1 + лист-разделитель посередине зазора
 *   c115_3 — асимметричная обшивка: 2 слоя с одной стороны, 3 с другой
 *   c116   — как c115_1, но увеличенный зазор под коммуникации
 * Сама механика расчёта (WallInput/calcResults для двух рядов стоек)
 * ЕЩЁ НЕ реализована — это отдельная задача (см. TASKS.md/КОНСПЕКТ.md).
 * Пока используется только для таксономии/толщины на плане.
 */
export type DoubleFrameType = 'c115_1' | 'c115_2' | 'c115_3' | 'c116'

export type StudKind =
  | 'wall'
  | 'free'
  | 'middle'
  | 'door'
  | 'window'
  | 'user'

export type StudOrientation = 'down' | 'up'

export interface StudInfo {
  pos: number
  kind: StudKind
  orientation: StudOrientation
  isAbove: boolean
  openingId: string | null
  height: number // локальная высота стойки (потолок−пол) в точке pos, мм
}

export interface WallInput {
  wallType: WallType
  profileType: ProfileType
  profileThickness: ProfileThickness
  abutment: AbutmentType
  length: number
  height: number
  step: number
  firstStud: number
  openings: Opening[]
  customOverlap?: number | null
  // Если заданы (≥2 точек) — переопределяют плоское height переменной геометрией
  // (мансардный скос, ломаная линия, ступени пола). Если не заданы — стена плоская,
  // как раньше (height используется как обычно).
  ceilingProfile?: EdgeProfile
  floorProfile?: EdgeProfile
  layer1: BoardSpec        // спецификация 1-го слоя обшивки
  layer2: BoardSpec        // спецификация 2-го слоя (актуален только при c112)
  plywoodInserts: PlywoodInsert[]
}

export interface CalcResult {
  uwFloor: number
  uwCeiling: number
  uwSill: number
  lintel: number
  cwTotal: number
  studsCount: number
  aboveStuds: number
  aboveStudHeight: number
  gklArea: number
  needsOverlap: boolean
  studInfos: StudInfo[]
  cutList: WallCutList
  rawPieces: { pn: CutPiece[]; ps: CutPiece[] }
  screws: ScrewResult
  sealingTapeLm: number
}

export interface DrawingSnap {
  l: number
  h: number
  openings: Opening[]
  ceilingProfile: EdgeProfile
  floorProfile: EdgeProfile
}

// ─── Облицовка ──────────────────────────────────────────────────────────────

export type LiningType = 'c623' | 'c625' | 'c626'
export type LiningLayers = 1 | 2

export interface LiningInput {
  liningType: LiningType
  profileType: ProfileType
  profileThickness: ProfileThickness
  gklLayers: LiningLayers
  length: number
  height: number
  step: number
  hangerStep: number
  abutment: AbutmentType
  openings: Opening[]
  ceilingProfile?: EdgeProfile
  floorProfile?: EdgeProfile
  layer1: BoardSpec
  layer2: BoardSpec
  plywoodInserts: PlywoodInsert[]
}

export interface LiningResult {
  guideRail: number
  stud: number
  studsCount: number
  hangers: number
  extenders: number
  gklArea: number
  needsOverlap: boolean
  studInfos: StudInfo[]
  cutList: LiningCutList
  rawPieces: { pn: CutPiece[]; stud: CutPiece[] }
  screws: ScrewResult
}

// ─── Раскрой ─────────────────────────────────────────────────────────────────

export interface CutPiece {
  length: number
  role: 'floor' | 'ceiling' | 'sill' | 'lintel' | 'stud' | 'stud_part'
  label: string
  mustBeWhole: boolean
}

export interface CutBar {
  pieces: { piece: CutPiece; from: number }[]
  waste: number
}

export interface WallCutList {
  pn: { bars: CutBar[]; totalBars: number; totalWaste: number }
  ps: { bars: CutBar[]; totalBars: number; totalWaste: number }
}

export interface LiningCutList {
  pn: { bars: CutBar[]; totalBars: number; totalWaste: number }
  stud: { bars: CutBar[]; totalBars: number; totalWaste: number }
}

// ─── Раскрой ГСП (листы) ─────────────────────────────────────────────────────

/** Один прямоугольный кусок листа на стене */
export interface BoardPiece {
  x: number        // левый край на стене (мм)
  y: number        // нижний край от пола (мм)
  w: number        // ширина (мм) — ширина ЗАГОТОВКИ (сколько места занято на листе/в пуле)
  h: number        // высота (мм) — высота ЗАГОТОВКИ, аналогично
  /** full — целый лист (1200×SL); width_cut — резан по ширине; height_cut — по высоте;
   *  both_cut — по ширине и высоте; opening_void — проём (не закрывается листом);
   *  diagonal_cut — заготовка дополнительно обрезана по наклонной линии уклона
   *  потолка/пола (реальная форма — см. `polygon`), x/y/w/h остаются
   *  ограничивающим прямоугольником заготовки, а не итоговой формой */
  kind: 'full' | 'width_cut' | 'height_cut' | 'both_cut' | 'opening_void' | 'diagonal_cut'
  /** откуда взят материал */
  source: 'new_sheet' | 'offcut'
  /** Только для kind === 'diagonal_cut': реальная форма куска после
   *  обрезки по уклону — многоугольник (мм, координаты в той же системе,
   *  что x/y). Обрезок за пределами многоугольника (внутри прямоугольника
   *  x/y/w/h) — это фактические отходы данной заготовки. */
  polygon?: { x: number; y: number }[]
}

/** Одна колонка раскроя */
export interface BoardColumn {
  x1: number
  x2: number
  /** куски листов (включая opening_void для визуализации) */
  pieces: BoardPiece[]
  /** высоты горизонтальных стыков в мм от пола (для canvas) */
  jointYs: number[]
}

/** Пригодный обрезок (кандидат в межперегородочный пул) */
export interface BoardOffcut {
  w: number    // ширина (мм)
  h: number    // высота (мм)
  spec: BoardSpec
}

/** Итог раскроя одного слоя обшивки одной стены */
export interface BoardLayerLayout {
  layer: 1 | 2
  spec: BoardSpec
  columns: BoardColumn[]
  sheetsNeeded: number     // листов куплено
  usedAreaM2: number       // площадь на стене м²
  sheetAreaM2: number      // площадь купленных листов м²
  offcutAreaM2: number     // площадь пригодных обрезков м²
  wastePercent: number     // отходы %
  usableOffcuts: BoardOffcut[]
}

/** Полный раскрой стены (оба слоя) */
export interface BoardSheetResult {
  /** Сторона А */
  layer1: BoardLayerLayout
  layer2: BoardLayerLayout | null
  /** Сторона Б (только для перегородок, sides=2) */
  sideB_layer1: BoardLayerLayout | null
  sideB_layer2: BoardLayerLayout | null
  /** Суммарно по всем сторонам и слоям */
  totalSheetsNeeded: number
  totalUsedAreaM2: number
  totalSheetAreaM2: number
  totalOffcutAreaM2: number
  totalWastePercent: number
  /** Финальные обрезки из общего пула (после всех слоёв) */
  finalOffcuts: BoardOffcut[]
}

// ─── План объекта (вид сверху) ───────────────────────────────────────────────

/** Тип конструкции на плане */
export type PlanLineType =
  | 'wall_new'       // новая перегородка (красный)
  | 'wall_lining'    // облицовка стены (синий)
  | 'wall_existing'  // существующая стена (серый)
  | 'ceiling'        // потолок (фиолетовый)
  | 'floor'          // пол (коричневый)
  | 'rib_beam'       // ригель — балка перекрытия между колоннами, монолит,
                      // единое целое с плитой; резать нельзя, всегда capital/existing

/** Конструктивная спецификация линии — выбирается каскадно */
export interface PlanLineSpec {
  material: string    // level 1: 'gkl' | 'brick' | 'armstrong' | etc.
  subtype?: string    // level 2: профиль каркаса / толщина / способ монтажа
  boardSubtype?: GklSubtype  // тип листа обшивки (стандарт/влагостойкий/огнестойкий) — для gkl
  layers?: 1 | 2              // число слоёв обшивки с каждой стороны — для gkl
  /**
   * Шаг стоек, мм. Глобальный дефолт задаётся при рисовании (как heightMm/
   * drawHeightMm), пишется в spec каждой новой линии, переопределяется точечно.
   */
  step?: number
  /**
   * Шаг прямых подвесов, мм — только для облицовки (wall_lining). Глобальный
   * дефолт 1000 (совпадает с DEFAULT_INPUT.hangerStep в LiningCalc.tsx),
   * переопределяется точечно. Пока без UI-панели глобального дефолта
   * (как у step/heightMm) — задаётся только через инспектор при необходимости,
   * иначе берётся дефолт из переводчика planLineToLiningInput.
   */
  hangerStep?: number
  /**
   * Толщина металла профиля, мм ('06'|'07') — влияет только на предупреждение
   * о максимальной высоте (getMaxHeight/getLiningMaxHeight) и подпись, НЕ на
   * количество материалов (проверено: calcResults.ts/calcLining.ts профиль
   * не читают). Дефолт '06', как в App.tsx/LiningCalc.tsx.
   */
  profileThickness?: ProfileThickness
  layer1?: BoardSpec   // спецификация листа 1-го слоя — вход для переводчика в SurfaceSheetInput
  layer2?: BoardSpec   // спецификация листа 2-го слоя (актуален при layers === 2)
  /**
   * Зазор между рядами стоек, мм — только для двойного каркаса С116
   * (subtype вида 'c116_ps50'/'c116_ps75'/'c116_ps100'). Зазор произвольный
   * по месту, задаёт монтажник под конкретную трубу/коммуникацию — не
   * статья материала сама по себе, влияет только на толщину перегородки
   * на плане. Не задано → используется визуальный дефолт (см.
   * constructionTaxonomy.ts, getDoubleFrameThicknessMm).
   */
  gapMm?: number
  /**
   * Слои обшивки двойного каркаса (С115.1/.2/.3, С116) — только когда subtype
   * распознаётся parseDoubleFrameSubtype (constructionTaxonomy.ts) как
   * 'c115_1_ps50' и т.п. Обычные layer1/layer2 в этом случае НЕ используются
   * (там хранится общая обшивка одинарного каркаса, для двойного её нет —
   * у каждого из двух независимых рядов стоек своя обшивка).
   * A — первый ряд (всегда 2 слоя у всех подтипов). Б — второй ряд
   * (2 слоя у С115.1/.2/С116, 3 слоя — layerB3 — только у С115.3).
   */
  layerA1?: BoardSpec
  layerA2?: BoardSpec
  layerB1?: BoardSpec
  layerB2?: BoardSpec
  layerB3?: BoardSpec  // только С115.3
}

/** Одна линия на плане */
/** Проём (дверь/окно/просто проём) на линии стены/перегородки */
export interface PlanOpening {
  id: string
  type: 'door' | 'window' | 'opening'  // 'opening' — просто проём (проход/ниша), без двери/окна
  offsetMm: number    // отступ от начала линии (x1,y1) вдоль оси, мм
  widthMm: number
  heightMm: number     // высота проёма: для двери/просто проёма — от подоконника (см. sillHeightMm); для окна — высота самого окна
  sillHeightMm?: number // высота низа проёма от уровня чистого пола, мм; не задано = 0 (от пола). Для двери обычно не задаётся (0)
  label: string         // "Д-1" / "О-1" / "Пр-1"
}

/** Категория конструкции: капитал (периметр/колонны/уровни — не трогаем) или изменяемая (строим/сносим) */
export type LineCategory = 'capital' | 'mutable'

/** Статус выполнения работ по конструкции */
export type WorkStatus = 'demolition' | 'existing' | 'planned' | 'in_progress' | 'done'

/**
 * Материал конструкции, к которой примыкает конец линии (боковое примыкание).
 * Выводится геометрически через attachmentResolver, НЕ хранится на линии.
 * 'unknown' — есть примыкание, но материал соседней конструкции не задан
 * (wall_existing без spec.material).
 */
export type AttachmentMaterial =
  | 'brick'
  | 'block'       // газо-/пеноблок
  | 'concrete'    // монолит/бетон
  | 'gkl_existing' // существующая ГКЛ-конструкция (перегородка/облицовка)
  | 'unknown'

/** Тип крепежа для примыкания к боковой конструкции или к потолку/полу */
export type FastenerType =
  | 'dowel_6x40'         // дюбель 6×40 — бетон/кирпич
  | 'wood_screw_45'      // саморез по дереву 45мм — газо-/пеноблок
  | 'wood_screw_55'      // саморез по дереву 55мм — газо-/пеноблок
  | 'metal_screw'        // саморез по металлу — ГКЛ к существующей ГКЛ-конструкции
  | 'gypsum_toggle'      // дюбель-бабочка — ГКЛ (рекомендация Кнауф, на практике редко)
  | 'anchor_wedge_6x40'  // анкер-клин 6×40 — подвесы в потолок (монолит)
  | 'self_drill_screw'   // саморез с сверлом / просечка — тонкий металл
  | 'roofing_screw'      // кровельный саморез — толстый металл

/** Выбор крепежа для одного примыкания: тип + шаг по длине примыкания, мм */
export interface FastenerSpec {
  type: FastenerType
  stepMm: number
}

/**
 * Стадийная отделка поверхности — НЕЗАВИСИМА от WorkStatus (тот описывает,
 * построена ли САМА конструкция; это — что сделано с её ПОВЕРХНОСТЬЮ поверх
 * уже построенного). Единый порядковый прогресс для кладки и ГКЛ, хотя
 * физический смысл шага 'base_done' разный (см. FINISH_BASE_STAGE_LABEL):
 *  - кладка (кирпич/блок/монолит): naked=голый, base_done=оштукатурено
 *  - ГКЛ (каркас): naked=голый каркас, base_done=обшито (зашито листом)
 * 'puttied' — шпаклёвка, общий финальный этап подготовки перед покрытием
 * для обоих случаев.
 */
export type FinishBaseStage = 'naked' | 'base_done' | 'puttied'

export type FinishCoveringType = 'paint' | 'tile'

export interface FinishCovering {
  type: FinishCoveringType
  ralCode?: string   // код RAL — только для paint
  done?: boolean     // покрытие выбрано (запланировано) vs реально нанесено
}

/** Состояние отделки ОДНОЙ стороны поверхности (см. PlanLine.finishA/finishB) */
export interface FinishState {
  baseStage: FinishBaseStage
  covering?: FinishCovering | null
}

/**
 * ⚠️ DEPRECATED (06.07.2026) — WorkStatus/FinishBaseStage/FinishCovering/
 * FinishState заменяются на WorkProgress (см. ниже): пользователь описал
 * реальный процесс как ПРОИЗВОЛЬНУЮ последовательность этапов на каждую
 * поверхность (не фиксированный enum на 3-5 шагов), с подтверждением ✓
 * или отклонением ✗ + причиной на каждом шаге. Старые типы оставлены
 * в коде и ещё используются в FloorPlan.tsx/finishResolver.ts — сама
 * миграция вызовов (инспектор, STATUS_COLORS, planTo3D видимость) —
 * ОТДЕЛЬНАЯ следующая задача после того, как новая модель обкатана.
 * Не удалять эти типы, пока миграция не завершена и не смержена.
 */

/** Причина, по которой шаг НЕ подтверждён (outcome: 'rejected') */
export type StepRejectReason =
  | 'waiting_materials'   // ждём материалов
  | 'waiting_trades'      // ждём смежников
  | 'changes'             // вносим изменения (переделка/уточнение проекта)
  | 'other'               // своя причина — см. rejectNote

export const STEP_REJECT_REASON_LABEL: Record<StepRejectReason, string> = {
  waiting_materials: 'Ждём материалов',
  waiting_trades: 'Ждём смежников',
  changes: 'Вносим изменения',
  other: 'Другая причина',
}

/** Один именованный шаг в шаблоне ("Грунтовка", "Каркас", "Плитка"...) */
/**
 * НЕОБЯЗАТЕЛЬНЫЙ технический тег шага — что он значит для 3D-визуализации
 * (см. core/lineProgress.ts wallGklVisual3D, Этап 2 "реалистичные материалы",
 * 10-11.07.2026). Сам WorkProgress остаётся произвольным списком со свободным
 * текстом — тег НЕ меняет эту гибкость, просто отмечает, что КОНКРЕТНО этот
 * шаг физически означает для ГКЛ-каркаса, если пользователь хочет получить
 * визуальную обратную связь в 3D. Без тегов ни на одном шаге — 3D ведёт себя
 * как в Этапе 1 (просто сплошная стена по мере готовности, без разбивки на
 * каркас/обшивку по сторонам) — безопасный дефолт, ничего не ломается.
 *  - 'frame'   — каркас (стойки+направляющие) собран
 *  - 'sheet_a' — обшита сторона A
 *  - 'sheet_b' — обшита сторона Б (актуально только для двусторонних —
 *    finishSidesOf(line)===2, см. finishResolver.ts)
 */
export type WorkStepMeaning3D = 'frame' | 'sheet_a' | 'sheet_b'

export interface WorkStageTemplateStep {
  id: string
  label: string
  meaning3D?: WorkStepMeaning3D
}

/**
 * Именованный шаблон последовательности этапов — заготовка, из которой
 * можно "проштамповать" список на новую линию/поверхность. НЕ является
 * источником истины для уже применённого прогресса (WorkProgress копирует
 * шаги себе и живёт дальше независимо — правки шаблона задним числом не
 * трогают уже начатые линии, см. applyTemplate()).
 */
export interface WorkStageTemplate {
  id: string
  label: string                    // "Стена под покраску", "ГКЛ перегородка"...
  steps: WorkStageTemplateStep[]
}

export type StepOutcome = 'pending' | 'confirmed' | 'rejected'

/** Фактическое состояние одного шага на конкретной линии/поверхности */
export interface StepProgress {
  stepId: string
  label: string             // копия label на момент применения шаблона (шаблон могли поменять/удалить позже)
  meaning3D?: WorkStepMeaning3D // копия тега шаблона на момент применения, см. WorkStageTemplateStep
  outcome: StepOutcome
  rejectReason?: StepRejectReason
  rejectNote?: string       // текст своей причины, если rejectReason === 'other'
  confirmedAt?: string      // ISO-дата, для истории/отчёта
  userId?: string           // кто подтвердил/отклонил шаг — заполняется автоматически из текущего пользователя
}

/**
 * Полный прогресс по ОДНОЙ поверхности (одна сторона линии, пол, потолок...).
 * templateId/sourceTemplateLabel — просто след происхождения (для UI/отчёта),
 * steps живут и редактируются независимо от шаблона после применения.
 */
export interface WorkProgress {
  templateId?: string
  sourceTemplateLabel?: string
  steps: StepProgress[]
}

export interface PlanLine {
  id: string
  x1: number; y1: number   // координаты на холсте (px)
  x2: number; y2: number
  type: PlanLineType
  lengthMm: number          // длина в мм (вычисляется из масштаба)
  label: string             // пользовательское имя ("Перегородка А1")
  spec?: PlanLineSpec       // конструктивная спецификация (материал / подтип)
  wallId?: string           // ссылка на WallEntry если привязана
  liningId?: string         // ссылка на LiningEntry если привязана
  openings?: PlanOpening[]  // дверные/оконные проёмы на этой линии
  heightMm?: number         // высота конструкции, мм (по умолчанию 3000, если не задано)
  category?: LineCategory   // капитал (периметр/колонны) или изменяемая конструкция
  workStatus?: WorkStatus   // статус работ — актуально для mutable
  sectionWidthMm?: number   // rib_beam: ширина сечения по плану, мм
  dropMm?: number           // rib_beam: опускание низа балки от плиты перекрытия, мм
  /**
   * Стрела дуги, мм ("H" в формуле R=(L²+H²)/2H, L — половина хорды).
   * Не задано или 0 — линия прямая (как раньше). Задано — линия дуга,
   * x1/y1/x2/y2 остаются координатами КОНЦОВ ХОРДЫ (не меняются),
   * центр/радиус вычисляются на лету через geometry2d.arcFromChordAndSagitta.
   * Знак определяет сторону выгиба (см. документацию arcFromChordAndSagitta).
   * lengthMm при наличии sagittaMm — это длина ДУГИ, не хорды.
   *
   * ⚠️ Известные ограничения (сознательно не сделано, см. KONSPEKT.md):
   * дуга не участвует в wallJoin/attachmentResolver (стыки со стенами),
   * не поддерживает проёмы (PlanOpening), T-снап к телу дуги не работает
   * (только к концам хорды, как обычный endpoint-снап). Раскрой листов
   * по кривой стене не считается — материал по lengthMm (длине дуги)
   * прикидочно верен, а вот сама раскладка листов calcSheetLayout для
   * дуги нарисует прямую диаграмму той же длины — упрощение.
   */
  sagittaMm?: number
  /**
   * Ручное переопределение крепежа для примыкания на конце линии (start=x1,y1 / end=x2,y2).
   * Если не задано — используется дефолт из suggestFastener(material) по резолву attachmentResolver.
   */
  fastenerStart?: FastenerSpec
  fastenerEnd?: FastenerSpec
  /**
   * Стадийная отделка по сторонам. finishA — единственная сторона у
   * wall_lining (облицовка физически односторонняя) ИЛИ первая сторона
   * у wall_new/wall_existing (двусторонние). finishB — вторая сторона,
   * актуальна только когда finishSidesOf(line) === 2. Не задано —
   * значит отделка ещё не отслеживается для этой линии (эквивалент
   * baseStage:'naked', covering: null, но без явного объекта).
   * ⚠️ DEPRECATED (06.07.2026) — заменяется на finishProgressA/B ниже.
   */
  finishA?: FinishState
  finishB?: FinishState
  /**
   * НОВОЕ (06.07.2026, срез 2) — прогресс СТРОИТЕЛЬСТВА самой конструкции
   * (заменяет workStatus): произвольный список этапов ("Разметка" →
   * "Каркас" → ... → "Готово"), см. core/workProgress.ts. Не задано —
   * значит прогресс для этой линии ещё не настроен (по умолчанию
   * ведём себя как раньше — конструкция считается видимой/существующей,
   * см. core/lineProgress.ts isLineBuiltForRender). Актуально в первую
   * очередь для category==='mutable' — капитальные (периметр/колонны)
   * уже стоят по определению, прогресс им обычно не нужен.
   */
  buildProgress?: WorkProgress
  /**
   * НОВОЕ (06.07.2026, срез 2) — прогресс ОТДЕЛКИ поверхности по сторонам
   * (заменяет finishA/finishB выше), тот же принцип: произвольный список
   * этапов вместо фиксированного naked/base_done/puttied. sideA/B — та же
   * семантика сторон, что и у finishA/finishB.
   */
  finishProgressA?: WorkProgress
  finishProgressB?: WorkProgress
}

/** Подложка — растровое изображение страницы PDF, по которому обводят план */
export interface BackgroundImage {
  dataUrl: string    // PNG base64
  x: number; y: number       // мировые px левого верхнего угла
  width: number; height: number  // мировые px (натуральный размер при загрузке)
  opacity: number     // 0..1
  locked: boolean      // true = не реагирует на клики, не двигается
}

/**
 * Плита (пол/потолок этажа) — свободный контур, нарисованный "карандашом"
 * (не привязан к прямым стенам, как Room). Отметка по высоте берётся с
 * самого этажа (Level.elevationMm), у плиты своего поля высоты нет —
 * один этаж = одна плита пола на его отметке, снизу она же потолок этажа
 * ниже (см. KONSPEKT.md, обсуждение односторонней прозрачности).
 * holes — вырезы под лестницы/лифтовые шахты/стволы коммуникаций,
 * коммуникации в 3D должны их обходить (это отдельная будущая задача).
 */
export interface Slab {
  id: string
  outer: { x: number; y: number }[]      // внешний контур, px (как у линий)
  holes: { x: number; y: number }[][]    // вырезы — ноль или больше замкнутых контуров внутри outer
  label: string                           // "Плита 1", "Плита 2"...
}

/**
 * Потолок — отдельная от Slab сущность (10.07.2026). Та же механика обводки
 * мышкой (клик-клик-клик, замыкание у стартовой точки), что и у Плиты, но
 * концептуально другое: пользователь обводит ОДИН физический потолок,
 * который может перекрывать НЕСКОЛЬКО помещений из экспликации (разные зоны
 * посчитаны отдельно для смет по стенам/полу, а потолок над ними один,
 * общий — реальный кейс с объединением нескольких комнат без капитальной
 * перегородки между ними).
 *
 * Пока сознательно БЕЗ вырезов (holes) — только внешний контур, дырки
 * (ниша под подсветку, короб МЕР, колонна сквозь потолок) добавим отдельной
 * задачей, если понадобится.
 *
 * Пока сознательно БЕЗ привязки к Room (см. KONSPEKT.md — блокируется
 * известным багом углов/примыканий стен, чинить отдельно). Свободный
 * контур — единственный источник геометрии на этом этапе.
 */
export interface Ceiling {
  id: string
  outer: { x: number; y: number }[]      // внешний контур, px (как у линий/Slab)
  label: string                           // "Потолок 1", "Потолок 2"...
}

/**
 * Круглая колонна — лёгкая самостоятельная сущность (не Room, не набор линий),
 * по аналогии с тем, как Slab существует параллельно старому коду линий/помещений.
 *
 * ⚠️ Прямоугольные колонны — тоже самостоятельная сущность, см. RectColumn ниже
 * (с 05.07.2026). До этой даты штамповка прямоугольного шаблона создавала
 * 4 линии wall_existing + Room с isColumn: true — старые, уже расставленные
 * на реальных объектах колонны ТАК И ОСТАЮТСЯ (не мигрированы, риск потери
 * данных при автомиграции сочли выше пользы), Room.isColumn всё ещё
 * поддерживается везде в коде ради них. Новые прямоугольные колонны с этой
 * даты — уже RectColumn.
 */
export interface RoundColumn {
  id: string
  cx: number            // центр, px (координаты плана)
  cy: number
  diameterMm: number
  spec?: PlanLineSpec    // тот же тип spec, что у wall_existing (материал/подтип)
  category?: LineCategory   // по умолчанию 'capital'
  workStatus?: WorkStatus   // по умолчанию 'existing'
  label: string
}

/**
 * Прямоугольная колонна — самостоятельная сущность (см. комментарий у
 * RoundColumn выше про историю до/после 05.07.2026). Геометрия — центр +
 * ширина/глубина (мм) + угол поворота (радианы, 0 = ширина вдоль оси X
 * плана), та же математика, что уже была в core/columnStamp.ts
 * (rectColumnCornersPx) для штамповки — теперь она просто хранится как
 * поля объекта, а не "запекается" в 4 отдельные линии.
 */
export interface RectColumn {
  id: string
  cx: number
  cy: number
  widthMm: number
  depthMm: number
  angleRad: number
  spec?: PlanLineSpec
  category?: LineCategory   // по умолчанию 'capital'
  workStatus?: WorkStatus   // по умолчанию 'existing'
  label: string
}

/**
 * Обведённая карандашом стена/перегородка ИЛИ колонна произвольной формы —
 * единый контур по реальным граням (px), БЕЗ деления на прямые отрезки, в
 * отличие от обычных wall_new/wall_existing (x1/y1/x2/y2 + перпендикулярная
 * толщина). Нужна там, где реальная геометрия не укладывается в "ось +
 * толщина" — неровные колонны разной формы на одном объекте, кривые
 * фрагменты периметра со скана чертежа и т.п.
 *
 * Технически — тот же паттерн, что и у Slab (contour, см. выше): свободный
 * контур, не привязанный к линиям/помещениям. `kind` влияет только на
 * дефолтную подпись/категорию и на то, каким цветом/штриховкой рисовать —
 * геометрия и материал (через тот же PlanLineSpec/wall_existing-таксономию,
 * что у RectColumn/RoundColumn) одинаковы для обоих видов.
 *
 * ⚠️ Сознательное упрощение v1 (см. KONSPEKT.md): НЕ участвует в обычном
 * расчётном движке стен (calcResults/calcSheetLayout/calcAttachmentFasteners) —
 * это геометрия + материал для плана/сметы площадей/3D, а не для раскроя
 * листов конкретно этой конструкции.
 *
 * Проёмы (07.07.2026, см. FreeformOpening ниже) — поддержаны на уровне
 * геометрии (вырез в плане и в 3D; откос/четверть не моделируются, чистый
 * прямоугольный/произвольный вырез, как и у прямых стен), но так же НЕ
 * участвуют в расчётном движке — площадь проёма не вычитается из сметы
 * материала (у freeform-стены и без проёмов нет сметы материала, см. выше).
 */
export type FreeformKind = 'wall' | 'column'

/**
 * Проём на обведённой карандашом стене (FreeformStructure, kind: 'wall') —
 * с 07.07.2026. В отличие от PlanOpening (прямая стена, offsetMm вдоль оси),
 * у freeform-стены нет единой оси, поэтому проём задаётся так же, как и сама
 * стена — обводом реального контура (клик-клик, замыкание у первой точки),
 * тем же паттерном, что и outer. Контур проёма должен целиком лежать внутри
 * outer (не проверяется геометрически при вводе — ответственность
 * пользователя, как и у обычной обводки).
 *
 * sillHeightMm/heightMm — тот же смысл, что у PlanOpening (высота низа от
 * пола / высота самого проёма); heightMm не задан → проём на всю высоту
 * стены (частый случай для простого проёма/ниши). sillHeightMm не задан →
 * от пола (0), как и у обычных проёмов.
 */
export interface FreeformOpening {
  id: string
  type: 'door' | 'window' | 'opening'
  contour: { x: number; y: number }[]   // контур проёма, px, тот же формат, что и outer
  sillHeightMm?: number
  heightMm?: number                      // не задано — на всю высоту стены (bottomMm..heightMm стены)
  label: string
}

export interface FreeformStructure {
  id: string
  kind: FreeformKind
  outer: { x: number; y: number }[]   // контур, px (как у Slab.outer)
  spec?: PlanLineSpec                  // та же таксономия, что у RectColumn/RoundColumn (wall_existing)
  category?: LineCategory              // по умолчанию 'capital'
  workStatus?: WorkStatus              // по умолчанию 'existing'
  heightMm?: number                    // своя высота; не задано — высота потолка этажа, как у обычных стен
  /** Проёмы (только имеют смысл для kind: 'wall'; для колонны UI их не предлагает) */
  openings?: FreeformOpening[]
  label: string
}

/**
 * Инженерные дисциплины поверх архитектурного плана (08.07.2026).
 * Реальный workflow пользователя: проектировщик присылает единый
 * многостраничный PDF, где вентиляция/электрика — отдельные страницы того
 * же файла, а стены/колонны уже отрисованы на каждой странице для
 * ориентира. Поэтому привязка страниц друг к другу — вручную, по уже
 * нарисованным на плане колоннам/стенам, тем же существующим инструментом
 * позиционирования backgroundImage (перетаскивание/масштаб) — отдельного
 * механизма привязки координат заводить не нужно.
 */
export type MepDiscipline = 'ventilation' | 'electrical'

/**
 * Подложки по дисциплинам — хранятся ОТДЕЛЬНО от основной (архитектурной)
 * backgroundImage плана, чтобы пользователь мог в любой момент вернуться и
 * свериться именно с картинкой конкретной дисциплины (в отличие от
 * архитектурной подложки, которая всегда одна и та же — активная).
 */
export type MepBackgrounds = Partial<Record<MepDiscipline, BackgroundImage>>

/**
 * Трасса инженерной системы — воздуховод/короб вентиляции, кабель-трасса
 * электрики и т.п. Геометрия — свободный путь точек (как у
 * FreeformStructure.outer), но не замкнутый контур, а линия прохождения
 * трассы. sizeMm — либо прямоугольное сечение (короб), либо круглое
 * (диаметр воздуховода/трубы) — оба поля опциональны, задаётся то, что
 * применимо к конкретной трассе.
 */
export interface MepRoute {
  id: string
  discipline: MepDiscipline
  points: { x: number; y: number }[]   // путь трассы, px, мировые координаты плана
  elevationMm: number                   // высота прокладки от пола этажа (для будущей проверки коллизий)
  sizeMm: {
    widthMm?: number
    heightMm?: number
    diameterMm?: number
  }
  label: string
}

/** План объекта */
export interface FloorPlan {
  scaleMmPerPx: number
  lines: PlanLine[]
  contours: PlanContour[]
  rooms: Room[]
  slabs: Slab[]
  ceilings: Ceiling[]
  roundColumns: RoundColumn[]
  rectColumns: RectColumn[]
  freeformStructures: FreeformStructure[]
  backgroundImage?: BackgroundImage | null
  mepRoutes: MepRoute[]
  mepBackgrounds: MepBackgrounds
  /**
   * Высота потолка этажа, мм (08.07.2026). Раньше нигде явно не хранилась —
   * каждая новая стена получала heightMm = значению поля ввода на панели
   * рисования в момент клика (по умолчанию 3000), а сама панель после
   * перезагрузки/прокрутки экрана легко теряется из виду ("отметка
   * изменить высоту потолка ... сейчас теряется внизу, про неё не
   * вспоминаешь" — из бэклога идей пользователя). Это поле — единый,
   * постоянно видимый источник правды для "какой высоты этот этаж", плюс
   * основа для массового пересчёта уже нарисованного (см.
   * applyHeightToAllConstructions в useProjectStore.ts) — реальный сценарий:
   * начертили при одной высоте, на объекте выяснилось, что фактическая
   * другая, нужно поправить разом, а не по одной стене.
   */
  defaultHeightMm: number
}

export const DEFAULT_FLOOR_PLAN: FloorPlan = {
  scaleMmPerPx: 10,
  lines: [],
  contours: [],
  rooms: [],
  slabs: [],
  ceilings: [],
  roundColumns: [],
  rectColumns: [],
  freeformStructures: [],
  backgroundImage: null,
  mepRoutes: [],
  mepBackgrounds: {},
  defaultHeightMm: 3000,
}

/**
 * Этаж объекта. У каждого этажа — свой план (свои стены, помещения,
 * подложка) и отметка по высоте (мм, от условного нуля объекта).
 * "Дублировать этаж" — копия floorPlan на новую отметку, дальше правится
 * независимо (никакой магической синхронизации между этажами нет).
 */
export interface Level {
  id: string
  name: string          // "Этаж 1", "Цоколь", "Кровля" и т.д.
  elevationMm: number    // отметка низа этажа от условного нуля объекта
  floorPlan: FloorPlan
}

export function emptyLevel(name: string, elevationMm: number): Level {
  return {
    id: `lv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name,
    elevationMm,
    floorPlan: { ...DEFAULT_FLOOR_PLAN, lines: [] },
  }
}

/** Активный вид на холсте */
export type PlanView = 'top' | 'side'

/** Замкнутый контур (периметр) */
export interface PlanContour {
  id: string
  lineIds: string[]
  areaM2: number
  type: PlanLineType
  label: string
  spec?: PlanLineSpec
}

/**
 * Помещение — замкнутый периметр из wall_existing линий.
 * Создаётся автоматически когда последняя точка цепочки снапается к первой.
 */
export interface Room {
  id: string
  lineIds: string[]      // id линий периметра в порядке обхода
  areaM2: number         // площадь пола/потолка (формула Гаусса)
  perimeterMm: number    // периметр в мм
  label: string          // "Помещение 1", "Кухня" и т.д.
  templateName?: string  // для будущих шаблонов (ЖК)
  isColumn?: boolean     // true — это колонна (тот же замкнутый контур, но не помещение)
  /**
   * НОВОЕ (10.07.2026): параметры каркаса подвесного потолка, сохранённые
   * из CeilingCalc.tsx («отправить Room в расчёт потолка» → настроить шаг/
   * тип → «Сохранить в 3D»). Единая точка правды для 3D-сетки каркаса
   * (Scene3D.tsx → CeilingGridMesh) — не задано → 3D рисует по дефолтам
   * (DEFAULT_GRID_STEP_B/C в core/ceilingGridGeometry.ts), как раньше.
   * См. KONSPEKT.md, "3D-сетка потолка по реальным настройкам".
   */
  ceilingSpec?: CeilingSpec
}
