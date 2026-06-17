import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WallInput, CalcResult, LiningInput, LiningResult } from '../types'

const PROFILE_LETTER: Record<string, string> = {
  ps50: 'А', ps75: 'В', ps100: 'С',
}

export interface LiningEntry {
  id: string
  label: string
  input: LiningInput
  result: LiningResult | null
}

export interface WallEntry {
  id: string
  label: string
  input: WallInput
  result: CalcResult | null
  positions: number[]
}

export interface ProjectEntry {
  id: string
  name: string
  walls: WallEntry[]
  linings: LiningEntry[]
  createdAt: string
}

export interface ProjectStore {
  // список объектов
  projects: ProjectEntry[]
  activeProjectId: string | null

  // активный объект (вычисляемые из projects)
  projectName: string
  walls: WallEntry[]
  linings: LiningEntry[]
  activeWallId: string | null
  activeLiningId: string | null

  // управление объектами
  createProject: (name: string) => ProjectEntry
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  selectProject: (id: string | null) => void

  // управление перегородками
  setProjectName: (name: string) => void
  addWall: (input: WallInput, result: CalcResult | null, positions: number[]) => void
  updateWall: (id: string, input: WallInput, result: CalcResult | null, positions: number[]) => void
  removeWall: (id: string) => void
  setActiveWall: (id: string | null) => void

  // управление облицовками
  addLining: (input: LiningInput, result: LiningResult | null) => void
  updateLining: (id: string, input: LiningInput, result: LiningResult | null) => void
  removeLining: (id: string) => void
  setActiveLining: (id: string | null) => void
}

function emptyProject(name: string): ProjectEntry {
  return {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name,
    walls: [],
    linings: [],
    createdAt: new Date().toISOString(),
  }
}

// Синхронизирует плоские поля (projectName, walls, linings) с активным объектом
function syncActive(projects: ProjectEntry[], activeProjectId: string | null) {
  const p = projects.find(p => p.id === activeProjectId)
  return {
    projectName: p?.name ?? '',
    walls: p?.walls ?? [],
    linings: p?.linings ?? [],
  }
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,
      projectName: '',
      walls: [],
      linings: [],
      activeWallId: null,
      activeLiningId: null,

      // ─── Объекты ────────────────────────────────────────────────────────────

      createProject: (name) => {
        const p = emptyProject(name)
        set(s => {
          const projects = [p, ...s.projects]
          return { projects, activeProjectId: p.id, ...syncActive(projects, p.id), activeWallId: null, activeLiningId: null }
        })
        return p
      },

      deleteProject: (id) => {
        set(s => {
          const projects = s.projects.filter(p => p.id !== id)
          const activeProjectId = s.activeProjectId === id
            ? (projects[0]?.id ?? null)
            : s.activeProjectId
          return { projects, activeProjectId, ...syncActive(projects, activeProjectId), activeWallId: null, activeLiningId: null }
        })
      },

      renameProject: (id, name) => {
        set(s => {
          const projects = s.projects.map(p => p.id === id ? { ...p, name } : p)
          return { projects, ...syncActive(projects, s.activeProjectId) }
        })
      },

      selectProject: (id) => {
        set(s => ({
          activeProjectId: id,
          ...syncActive(s.projects, id),
          activeWallId: null,
          activeLiningId: null,
        }))
      },

      // ─── Название объекта ────────────────────────────────────────────────

      setProjectName: (name) => {
        set(s => {
          if (!s.activeProjectId) return { projectName: name }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, name } : p
          )
          return { projects, projectName: name }
        })
      },

      // ─── Перегородки ─────────────────────────────────────────────────────

      addWall: (input, result, positions) => {
        set(s => {
          const letter = PROFILE_LETTER[input.profileType] ?? 'А'
          const count = s.walls.filter(w => w.label.startsWith(letter)).length + 1
          const label = `${letter}${count}`
          const id = `w_${Date.now()}`
          const wall: WallEntry = { id, label, input, result, positions }
          const walls = [...s.walls, wall]
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, walls } : p
          )
          return { walls, projects }
        })
      },

      updateWall: (id, input, result, positions) => {
        set(s => {
          const walls = s.walls.map(w => w.id === id ? { ...w, input, result, positions } : w)
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, walls } : p
          )
          return { walls, projects }
        })
      },

      removeWall: (id) => {
        set(s => {
          const walls = s.walls.filter(w => w.id !== id)
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, walls } : p
          )
          return { walls, projects, activeWallId: s.activeWallId === id ? null : s.activeWallId }
        })
      },

      setActiveWall: (id) => set({ activeWallId: id }),

      // ─── Облицовки ───────────────────────────────────────────────────────

      addLining: (input, result) => {
        set(s => {
          const count = s.linings.length + 1
          const label = `О${count}`
          const id = `l_${Date.now()}`
          const lining: LiningEntry = { id, label, input, result }
          const linings = [...s.linings, lining]
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, linings } : p
          )
          return { linings, projects }
        })
      },

      updateLining: (id, input, result) => {
        set(s => {
          const linings = s.linings.map(l => l.id === id ? { ...l, input, result } : l)
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, linings } : p
          )
          return { linings, projects }
        })
      },

      removeLining: (id) => {
        set(s => {
          const linings = s.linings.filter(l => l.id !== id)
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, linings } : p
          )
          return { linings, projects, activeLiningId: s.activeLiningId === id ? null : s.activeLiningId }
        })
      },

      setActiveLining: (id) => set({ activeLiningId: id }),
    }),
    {
      name: 'wall-calc-projects', // ключ в localStorage
      partialize: (s) => ({       // сохраняем только данные, не функции
        projects: s.projects,
        activeProjectId: s.activeProjectId,
      }),
      onRehydrateStorage: () => (state) => {
        // После загрузки из localStorage синхронизируем плоские поля
        if (state) {
          const synced = syncActive(state.projects, state.activeProjectId)
          Object.assign(state, synced)
        }
      },
    }
  )
)
