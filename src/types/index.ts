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
  w: number        // ширина (мм)
  h: number        // высота (мм)
  /** full — целый лист (1200×SL); width_cut — резан по ширине; height_cut — по высоте;
   *  both_cut — по ширине и высоте; opening_void — проём (не закрывается листом) */
  kind: 'full' | 'width_cut' | 'height_cut' | 'both_cut' | 'opening_void'
  /** откуда взят материал */
  source: 'new_sheet' | 'offcut'
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

/** Конструктивная спецификация линии — выбирается каскадно */
export interface PlanLineSpec {
  material: string    // level 1: 'gkl' | 'brick' | 'armstrong' | etc.
  subtype?: string    // level 2: толщина, слои, подтип
}

/** Одна линия на плане */
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
}

/** План объекта */
export interface FloorPlan {
  scaleMmPerPx: number      // мм на пиксель (например 10 = 1px → 10мм)
  lines: PlanLine[]
  contours: PlanContour[]
}

export const DEFAULT_FLOOR_PLAN: FloorPlan = {
  scaleMmPerPx: 10,
  lines: [],
  contours: [],
}

/** Активный вид на холсте */
export type PlanView = 'top' | 'side'

/** Замкнутый контур (периметр) */
export interface PlanContour {
  id: string
  lineIds: string[]      // id линий в порядке обхода
  areaM2: number         // площадь м²
  type: PlanLineType     // тип конструкции
  label: string
  spec?: PlanLineSpec    // конструктивная спецификация (для заливки контура)
}
