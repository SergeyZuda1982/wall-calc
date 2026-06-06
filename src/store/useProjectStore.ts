import { create } from 'zustand'
import type { WallInput, CalcResult, LiningInput, LiningResult } from '../types'

const PROFILE_LETTER: Record<string, string> = {
  ps50: 'А',
  ps75: 'В',
  ps100: 'С',
}

export interface LiningEntry {
  id: string
  label: string        // О1, О2...
  input: LiningInput
  result: LiningResult | null
}

export interface WallEntry {
  id: string
  label: string        // А1, В2, С1...
  input: WallInput
  result: CalcResult | null
  positions: number[]
}

export interface ProjectStore {
  projectName: string
  walls: WallEntry[]
  activeWallId: string | null

  setProjectName: (name: string) => void
  addWall: (input: WallInput, result: CalcResult | null, positions: number[]) => void
  updateWall: (id: string, input: WallInput, result: CalcResult | null, positions: number[]) => void
  removeWall: (id: string) => void
  setActiveWall: (id: string | null) => void

  // облицовки
  linings: LiningEntry[]
  activeLiningId: string | null
  addLining: (input: LiningInput, result: LiningResult | null) => void
  updateLining: (id: string, input: LiningInput, result: LiningResult | null) => void
  removeLining: (id: string) => void
  setActiveLining: (id: string | null) => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projectName: '',
  walls: [],
  activeWallId: null,
  linings: [],
  activeLiningId: null,

  setProjectName: (name) => set({ projectName: name }),

  addWall: (input, result, positions) => {
    const { walls } = get()
    const letter = PROFILE_LETTER[input.profileType] ?? 'А'
    const count = walls.filter(w => w.label.startsWith(letter)).length + 1
    const label = `${letter}${count}`
    const id = `${Date.now()}`
    set({ walls: [...walls, { id, label, input, result, positions }] })
  },

  updateWall: (id, input, result, positions) => {
    set(state => ({
      walls: state.walls.map(w =>
        w.id === id ? { ...w, input, result, positions } : w
      )
    }))
  },

  removeWall: (id) => {
    set(state => ({
      walls: state.walls.filter(w => w.id !== id),
      activeWallId: state.activeWallId === id ? null : state.activeWallId,
    }))
  },

  setActiveWall: (id) => set({ activeWallId: id }),

  addLining: (input, result) => {
    const { linings } = get()
    const count = linings.length + 1
    const label = `О${count}`
    const id = `l_${Date.now()}`
    set({ linings: [...linings, { id, label, input, result }] })
  },

  updateLining: (id, input, result) => {
    set(state => ({
      linings: state.linings.map(l =>
        l.id === id ? { ...l, input, result } : l
      )
    }))
  },

  removeLining: (id) => {
    set(state => ({
      linings: state.linings.filter(l => l.id !== id),
      activeLiningId: state.activeLiningId === id ? null : state.activeLiningId,
    }))
  },

  setActiveLining: (id) => set({ activeLiningId: id }),
}))
