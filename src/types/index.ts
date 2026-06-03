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
