// ─── Профили ────────────────────────────────────────────────────────────────

export type ProfileType = 'ps50' | 'ps75' | 'ps100'
export type ProfileThickness = '06' | '07'

export interface Profile {
  label: string
  value: ProfileType
  overlap: number  // мм нахлёста при наращивании
  width: number    // мм ширины профиля
}

// ─── Перегородка ────────────────────────────────────────────────────────────

export type WallType = 'c111' | 'c112'
export type AbutmentType = 'both' | 'left' | 'right' | 'none'
export type StudKind = 'wall' | 'free' | 'middle'

// Входные данные формы
export interface WallInput {
  wallType: WallType
  profileType: ProfileType
  profileThickness: ProfileThickness
  abutment: AbutmentType

  length: number      // мм
  height: number      // мм
  step: number        // мм, шаг стоек
  firstStud: number   // мм, первая стойка от края

  doorPos: number     // мм, начало проёма
  doorWidth: number   // мм
  doorHeight: number  // мм

  // Пользовательский нахлёст (0 = использовать норму Кнауф по профилю)
  customOverlap?: number | null
}

// Результат расчёта
export interface CalcResult {
  uwFloor: number         // ПН пол, метры
  uwCeiling: number       // ПН потолок, метры
  lintel: number          // перемычка над проёмом (ПН), метры
  cwTotal: number         // ПС стойки итого, метры
  studsCount: number      // количество стоек
  aboveStuds: number      // стоек над проёмом
  aboveStudHeight: number // высота стоек над проёмом, мм
  gklArea: number         // ГКЛ, м²
  needsOverlap: boolean   // нужно наращивание стоек
}

// Снапшот параметров, с которыми был построен чертёж
// (нужен для onDragEnd и update без повторного парсинга формы)
export interface DrawingSnap {
  l: number   // длина стены, мм
  h: number   // высота стены, мм
  dw: number  // ширина проёма, мм
  dh: number  // высота проёма, мм
  dp: number  // позиция проёма, мм
}

// ─── Облицовка ──────────────────────────────────────────────────────────────

export type LiningType = 'c623' | 'c625' | 'c626'
export type LiningLayers = 1 | 2

export interface LiningInput {
  liningType: LiningType
  profileType: ProfileType       // ps50 / ps75 / ps100 (для c625/c626)
  profileThickness: ProfileThickness
  gklLayers: LiningLayers

  length: number    // длина облицовки, мм
  height: number    // высота, мм
  step: number      // шаг стоек, мм
  hangerStep: number // шаг подвесов (только с623), мм

  // примыкание боковых сторон (как в перегородке)
  abutment: AbutmentType

  // проём
  doorPos: number
  doorWidth: number
  doorHeight: number
}

export interface LiningResult {
  // ПН 28×27 (с623) или ПН 50/75/100×40 (с625/626)
  guideRail: number      // периметр направляющих, метры
  // ПП 60×27 или ПС 50/75/100
  stud: number           // стойки итого, метры
  studsCount: number
  // только с623
  hangers: number        // подвесы, штук
  extenders: number      // удлинители профиля, штук
  // ГКЛ
  gklArea: number        // м², одна сторона × слои
  needsOverlap: boolean  // нужно наращивание
}
