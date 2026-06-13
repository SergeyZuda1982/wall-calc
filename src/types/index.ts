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
  pos: number         // мм от левого края
  width: number       // мм
  height: number      // мм
  sillHeight: number  // мм от пола (0 для дверей, >0 для окон)
}

// ─── Перегородка ────────────────────────────────────────────────────────────

export type WallType = 'c111' | 'c112'
export type AbutmentType = 'both' | 'left' | 'right' | 'none'
export type StudKind = 'wall' | 'free' | 'middle' | 'door'
export type StudOrientation = 'down' | 'up'

export interface StudInfo {
  pos: number
  kind: StudKind
  orientation: StudOrientation
  isAbove: boolean
  openingId: string | null  // к какому проёму относится (для door/above стоек)
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
}

export interface CalcResult {
  uwFloor: number
  uwCeiling: number
  uwSill: number          // суммарная длина направляющей под подоконниками окон, метры
  lintel: number          // сумма перемычек над всеми проёмами, метры
  cwTotal: number
  studsCount: number
  aboveStuds: number
  aboveStudHeight: number // высота стоек над первым проёмом (для обратной совместимости)
  gklArea: number
  needsOverlap: boolean
  studInfos: StudInfo[]
}

export interface DrawingSnap {
  l: number
  h: number
  openings: Opening[]
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