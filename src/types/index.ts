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
export type StudKind = 'wall' | 'free' | 'middle' | 'door'

// Ориентация стойки: down = 3000 вниз (соединение вверху), up = 3000 вверху (соединение внизу)
export type StudOrientation = 'down' | 'up'

// Информация об одной стойке для чертежа и раскроя
export interface StudInfo {
  pos: number               // позиция, мм от левого края
  kind: StudKind            // тип стойки
  orientation: StudOrientation
  isAbove: boolean          // стойка над проёмом (короткая)
}

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
  studInfos: StudInfo[]   // ориентации и типы всех стоек
}

// Снапшот параметров, с которыми был построен чертёж
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
  profileType: ProfileType
  profileThickness: ProfileThickness
  gklLayers: LiningLayers

  length: number
  height: number
  step: number
  hangerStep: number

  abutment: AbutmentType

  doorPos: number
  doorWidth: number
  doorHeight: number
}

export interface LiningResult {
  guideRail: number
  stud: number
  studsCount: number
  hangers: number
  extenders: number
  gklArea: number
  needsOverlap: boolean
}
