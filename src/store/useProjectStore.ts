import { create } from 'zustand'
import type { WallInput, CalcResult } from '../types'

const PROFILE_LETTER: Record<string, string> = {
  ps50: 'А',
  ps75: 'В',
  ps100: 'С',
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
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projectName: '',
  walls: [],
  activeWallId: null,

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
}))
