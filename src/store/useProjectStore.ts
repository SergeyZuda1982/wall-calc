import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WallInput, CalcResult, LiningInput, LiningResult, ProfileTemplate, FloorPlan, PlanLine, PlanContour, Room } from '../types'
import { migrateBoard, DEFAULT_BOARD_SPEC, DEFAULT_FLOOR_PLAN } from '../types'

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
  profileTemplates: ProfileTemplate[]
  floorPlan: FloorPlan
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
  profileTemplates: ProfileTemplate[]
  floorPlan: FloorPlan
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

  // шаблоны профиля на объект (балки, ригели, ступени и т.п.)
  addProfileTemplate: (name: string, shape: ProfileTemplate['shape']) => void
  removeProfileTemplate: (id: string) => void
  renameProfileTemplate: (id: string, name: string) => void

  // план объекта
  setFloorPlanScale: (scaleMmPerPx: number) => void
  addPlanLine: (line: Omit<PlanLine, 'id'>) => void
  updatePlanLine: (id: string, patch: Partial<PlanLine>) => void
  removePlanLine: (id: string) => void
  clearFloorPlan: () => void
  // контуры (замкнутые периметры)
  addContour: (contour: Omit<PlanContour, 'id'>) => void
  removeContour: (id: string) => void
  updateContour: (id: string, patch: Partial<PlanContour>) => void
  // помещения
  addRoom: (room: Omit<Room, 'id'>) => void
  removeRoom: (id: string) => void
  updateRoom: (id: string, patch: Partial<Room>) => void
}

function emptyProject(name: string): ProjectEntry {
  return {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name,
    walls: [],
    linings: [],
    profileTemplates: [],
    floorPlan: { ...DEFAULT_FLOOR_PLAN, lines: [] },
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
    profileTemplates: p?.profileTemplates ?? [],
    floorPlan: p?.floorPlan ?? { ...DEFAULT_FLOOR_PLAN, lines: [] },
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
      profileTemplates: [],
      floorPlan: { ...DEFAULT_FLOOR_PLAN, lines: [] },
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

      // ─── Шаблоны профиля (балки, ригели, ступени и т.п.) ──────────────────

      addProfileTemplate: (name, shape) => {
        set(s => {
          const tpl: ProfileTemplate = { id: `t_${Date.now()}_${Math.random().toString(36).slice(2)}`, name, shape }
          const profileTemplates = [...s.profileTemplates, tpl]
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, profileTemplates } : p
          )
          return { profileTemplates, projects }
        })
      },

      removeProfileTemplate: (id) => {
        set(s => {
          const profileTemplates = s.profileTemplates.filter(t => t.id !== id)
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, profileTemplates } : p
          )
          return { profileTemplates, projects }
        })
      },

      renameProfileTemplate: (id, name) => {
        set(s => {
          const profileTemplates = s.profileTemplates.map(t => t.id === id ? { ...t, name } : t)
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, profileTemplates } : p
          )
          return { profileTemplates, projects }
        })
      },

      // ─── План объекта ────────────────────────────────────────────────────

      setFloorPlanScale: (scaleMmPerPx) => {
        set(s => {
          const floorPlan = { ...(s.floorPlan ?? DEFAULT_FLOOR_PLAN), scaleMmPerPx }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      addPlanLine: (line) => {
        set(s => {
          const newLine: PlanLine = { ...line, id: `pl_${Date.now()}_${Math.random().toString(36).slice(2)}` }
          const floorPlan = { ...(s.floorPlan ?? DEFAULT_FLOOR_PLAN), lines: [...(s.floorPlan?.lines ?? []), newLine] }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      updatePlanLine: (id, patch) => {
        set(s => {
          const lines = (s.floorPlan?.lines ?? []).map(l => l.id === id ? { ...l, ...patch } : l)
          const floorPlan = { ...(s.floorPlan ?? DEFAULT_FLOOR_PLAN), lines }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      removePlanLine: (id) => {
        set(s => {
          const lines = (s.floorPlan?.lines ?? []).filter(l => l.id !== id)
          const floorPlan = { ...(s.floorPlan ?? DEFAULT_FLOOR_PLAN), lines }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      clearFloorPlan: () => {
        set(s => {
          const floorPlan = { ...(s.floorPlan ?? DEFAULT_FLOOR_PLAN), lines: [], contours: [] }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      addContour: (contour) => {
        set(s => {
          const newContour: PlanContour = { ...contour, id: `pc_${Date.now()}_${Math.random().toString(36).slice(2)}` }
          const prev = s.floorPlan ?? DEFAULT_FLOOR_PLAN
          const floorPlan = { ...prev, contours: [...(prev.contours ?? []), newContour] }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      removeContour: (id) => {
        set(s => {
          const prev = s.floorPlan ?? DEFAULT_FLOOR_PLAN
          const floorPlan = { ...prev, contours: (prev.contours ?? []).filter(c => c.id !== id) }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      updateContour: (id, patch) => {
        set(s => {
          const prev = s.floorPlan ?? DEFAULT_FLOOR_PLAN
          const contours = (prev.contours ?? []).map(c => c.id === id ? { ...c, ...patch } : c)
          const floorPlan = { ...prev, contours }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      addRoom: (room) => {
        set(s => {
          const newRoom: Room = { ...room, id: `rm_${Date.now()}_${Math.random().toString(36).slice(2)}` }
          const prev = s.floorPlan ?? DEFAULT_FLOOR_PLAN
          const floorPlan = { ...prev, rooms: [...(prev.rooms ?? []), newRoom] }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      removeRoom: (id) => {
        set(s => {
          const prev = s.floorPlan ?? DEFAULT_FLOOR_PLAN
          const floorPlan = { ...prev, rooms: (prev.rooms ?? []).filter(r => r.id !== id) }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },

      updateRoom: (id, patch) => {
        set(s => {
          const prev = s.floorPlan ?? DEFAULT_FLOOR_PLAN
          const rooms = (prev.rooms ?? []).map(r => r.id === id ? { ...r, ...patch } : r)
          const floorPlan = { ...prev, rooms }
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, floorPlan } : p
          )
          return { floorPlan, projects }
        })
      },
    }),
    {
      name: 'wall-calc-projects', // ключ в localStorage
      partialize: (s) => ({       // сохраняем только данные, не функции
        projects: s.projects,
        activeProjectId: s.activeProjectId,
      }),
      onRehydrateStorage: () => (state) => {
        // После загрузки из localStorage синхронизируем плоские поля.
        // Миграция: старые объекты могли хранить layer1/layer2 как строку ('gkl')
        // или без плоских полей profileTemplates / plywoodInserts.
        if (state) {
          state.projects = state.projects.map(p => ({
            ...p,
            profileTemplates: p.profileTemplates ?? [],
            floorPlan: p.floorPlan
              ? { ...p.floorPlan, contours: p.floorPlan.contours ?? [] }
              : { ...DEFAULT_FLOOR_PLAN, lines: [], contours: [] },
            walls: p.walls.map(w => ({
              ...w,
              input: {
                ...w.input,
                layer1: migrateBoard((w.input as any).layer1 ?? DEFAULT_BOARD_SPEC),
                layer2: migrateBoard((w.input as any).layer2 ?? DEFAULT_BOARD_SPEC),
                plywoodInserts: w.input.plywoodInserts ?? [],
              },
            })),
            linings: p.linings.map(l => ({
              ...l,
              input: {
                ...l.input,
                layer1: migrateBoard((l.input as any).layer1 ?? DEFAULT_BOARD_SPEC),
                layer2: migrateBoard((l.input as any).layer2 ?? DEFAULT_BOARD_SPEC),
                plywoodInserts: l.input.plywoodInserts ?? [],
              },
            })),
          }))
          const synced = syncActive(state.projects, state.activeProjectId)
          Object.assign(state, synced)
        }
      },
    }
  )
)
