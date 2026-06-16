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
  cutList: LiningCutList
  rawPieces: { pn: CutPiece[]; stud: CutPiece[] }
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