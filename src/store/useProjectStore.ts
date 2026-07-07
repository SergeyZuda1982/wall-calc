import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { WallInput, CalcResult, LiningInput, LiningResult, ProfileTemplate, FloorPlan, PlanLine, PlanContour, Room, Level, Slab, RoundColumn, RectColumn } from '../types'
import { migrateBoard, DEFAULT_BOARD_SPEC, DEFAULT_FLOOR_PLAN, emptyLevel } from '../types'
import { duplicateFloorPlanGeometry } from '../core/duplicateFloorPlan'

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
  levels: Level[]
  activeLevelId: string
  createdAt: string
  /** Пользовательские шаблоны этапов работ ("Сохранить как шаблон" в инспекторе) */
  customWorkStageTemplates?: import('../types').WorkStageTemplate[]
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
  levels: Level[]
  activeLevelId: string | null
  floorPlan: FloorPlan  // = план АКТИВНОГО этажа (levels.find(activeLevelId).floorPlan)
  activeWallId: string | null
  activeLiningId: string | null

  /**
   * Ошибка последнего сохранения на диск (см. safeLocalStorage выше).
   * null — сохранение прошло успешно (или ещё не было ошибок).
   * Непустая строка — данные живут только в памяти, диск переполнен.
   */
  saveError: string | null
  clearSaveError: () => void

  // управление объектами
  createProject: (name: string) => ProjectEntry
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  selectProject: (id: string | null) => void
  hydrateProject: (entry: ProjectEntry) => void

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

  // этажи
  addLevel: (name: string, elevationMm: number) => string
  duplicateLevel: (id: string, name: string, elevationMm: number) => string
  removeLevel: (id: string) => void
  renameLevel: (id: string, name: string) => void
  setLevelElevation: (id: string, elevationMm: number) => void
  selectLevel: (id: string) => void

  // план объекта (всегда пишет в план АКТИВНОГО этажа)
  setFloorPlanScale: (scaleMmPerPx: number) => void
  setBackgroundImage: (img: import('../types').BackgroundImage | null) => void
  updateBackgroundImage: (patch: Partial<import('../types').BackgroundImage>) => void
  addPlanLine: (line: Omit<PlanLine, 'id'>) => string
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
  // плиты (пол/потолок этажа) — свободный контур + вырезы
  addSlab: (outer: { x: number; y: number }[]) => string
  removeSlab: (id: string) => void
  updateSlabOuter: (id: string, outer: { x: number; y: number }[]) => void
  addSlabHole: (id: string, hole: { x: number; y: number }[]) => void
  removeSlabHole: (id: string, holeIndex: number) => void
  // круглые колонны (штамп шаблона либо ручное создание)
  addRoundColumn: (col: Omit<RoundColumn, 'id'>) => string
  updateRoundColumn: (id: string, patch: Partial<RoundColumn>) => void
  removeRoundColumn: (id: string) => void
  // прямоугольные колонны (с 05.07.2026 — самостоятельная сущность, см. types/index.ts)
  addRectColumn: (col: Omit<RectColumn, 'id'>) => string
  updateRectColumn: (id: string, patch: Partial<RectColumn>) => void
  removeRectColumn: (id: string) => void

  // пользовательские шаблоны этапов работ (объектные — свои на каждый проект)
  customWorkStageTemplates: import('../types').WorkStageTemplate[]
  addCustomWorkStageTemplate: (template: import('../types').WorkStageTemplate) => void
  removeCustomWorkStageTemplate: (id: string) => void
}

function emptyProject(name: string): ProjectEntry {
  const level = emptyLevel('Этаж 1', 0)
  return {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    name,
    walls: [],
    linings: [],
    profileTemplates: [],
    levels: [level],
    activeLevelId: level.id,
    createdAt: new Date().toISOString(),
    customWorkStageTemplates: [],
  }
}

/** Достаёт активный этаж проекта — с защитой, если activeLevelId не совпал ни с чем (берёт первый). */
function getActiveLevel(p: ProjectEntry | undefined): Level | undefined {
  if (!p) return undefined
  return p.levels.find(lv => lv.id === p.activeLevelId) ?? p.levels[0]
}

// Синхронизирует плоские поля (projectName, walls, linings, floorPlan активного этажа) с активным объектом
function syncActive(projects: ProjectEntry[], activeProjectId: string | null) {
  const p = projects.find(p => p.id === activeProjectId)
  const activeLevel = getActiveLevel(p)
  return {
    projectName: p?.name ?? '',
    walls: p?.walls ?? [],
    linings: p?.linings ?? [],
    profileTemplates: p?.profileTemplates ?? [],
    levels: p?.levels ?? [],
    activeLevelId: activeLevel?.id ?? null,
    floorPlan: activeLevel?.floorPlan ?? { ...DEFAULT_FLOOR_PLAN, lines: [] },
    customWorkStageTemplates: p?.customWorkStageTemplates ?? [], // fallback: старые сохранённые проекты без этого поля
  }
}

/**
 * Общий помощник для всех действий, которые правят план АКТИВНОГО этажа
 * активного объекта. Раньше (до этажей) каждое действие вручную собирало
 * { ...floorPlan, ... } и подставляло в projects — теперь это в одном месте.
 */
function updateActiveFloorPlan(
  s: { projects: ProjectEntry[]; activeProjectId: string | null; floorPlan: FloorPlan },
  updater: (fp: FloorPlan) => FloorPlan,
) {
  const prevFloorPlan = s.floorPlan ?? DEFAULT_FLOOR_PLAN
  const floorPlan = updater(prevFloorPlan)
  const projects = s.projects.map(p => {
    if (p.id !== s.activeProjectId) return p
    const activeLevel = getActiveLevel(p)
    if (!activeLevel) return p
    const levels = p.levels.map(lv => lv.id === activeLevel.id ? { ...lv, floorPlan } : lv)
    return { ...p, levels }
  })
  return { floorPlan, projects }
}

/**
 * СРОЧНЫЙ фикс 05.07.2026: JSON.stringify всего state на КАЖДОЕ изменение
 * стора (так работает zustand persist) при наличии PDF-подложек как base64
 * внутри projects — это не только упирается в quota (см. safeLocalStorage
 * ниже), а ещё и просто ДОЛГО считается синхронно на большом объёме данных,
 * подвешивая вкладку на реальных действиях (создание/выбор проекта).
 *
 * Временное решение: вообще не пишем dataUrl подложек на диск. Сама
 * подложка остаётся в памяти на время сессии (можно откалибровать план,
 * пользоваться), но пропадёт при перезагрузке страницы — до тех пор,
 * пока подложки не переедут в IndexedDB (отдельная задача, TASKS.md).
 * Явный компромисс, согласован с пользователем как временный.
 */
export function stripHeavyDataForPersist(projects: ProjectEntry[]): ProjectEntry[] {
  return projects.map(p => ({
    ...p,
    levels: p.levels.map(lv => {
      if (!lv.floorPlan.backgroundImage) return lv
      // dataUrl вырезаем, остальные поля (x/y/width/height/opacity/locked)
      // оставляем — они лёгкие, пригодятся, чтобы не терять калибровку
      // геометрии, если подложку потом перезагрузят по новой.
      const { dataUrl: _dataUrl, ...rest } = lv.floorPlan.backgroundImage
      return { ...lv, floorPlan: { ...lv.floorPlan, backgroundImage: { ...rest, dataUrl: '' } } }
    }),
  }))
}

/**
 * Обёртка над localStorage, которая не роняет приложение при переполнении
 * хранилища (баг найден 05.07.2026 — реальный QuotaExceededError на
 * проде, PDF-подложки как base64 быстро съедают лимит ~5-10МБ на сайт).
 * По умолчанию zustand persist вызывает storage.setItem НАПРЯМУЮ, без
 * try/catch — при переполнении это Uncaught QuotaExceededError, которое
 * прерывает текущий колбэк (например, onClick создания проекта) ДО того,
 * как он успевает доделать остальную работу. Здесь просто глотаем ошибку
 * и логируем — потерять последнее сохранение на диск лучше, чем сломать
 * текущее выполнение кода на середине.
 *
 * ⚠️ Это НЕ решает переполнение — оно всё ещё будет происходить, если
 * PDF-подложек много. Настоящий фикс — перенос подложек в IndexedDB
 * (отдельная задача, см. TASKS.md). Здесь только защита от падения.
 */
// Заполняются сразу после create() ниже — нужны, чтобы safeLocalStorage.setItem
// мог сообщить в стор об ошибке сохранения (см. saveError в ProjectStore).
let storeSetStateRef: ((partial: { saveError: string | null }) => void) | undefined
let storeGetStateRef: (() => { saveError: string | null }) | undefined

export const safeLocalStorage = {
  getItem: (name: string): string | null => {
    try {
      return window.localStorage.getItem(name)
    } catch (e) {
      console.error('[wall-calc] localStorage.getItem упал:', e)
      return null
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      window.localStorage.setItem(name, value)
      /**
       * КРИТИЧНЫЙ БАГ (найден 05.07.2026, версия до этого фикса вешала
       * вкладку НАМЕРТВО даже на пустых проектах): zustand persist
       * подписывается на ВЕСЬ стор, чтобы автосохранять на каждое
       * изменение. Если здесь безусловно звать setState({saveError:null})
       * при КАЖДОМ успешном сохранении — это само создаёт новое изменение
       * стора → persist сохраняет снова → setItem снова успешен → снова
       * setState → бесконечный синхронный цикл, 100% CPU, вкладка не
       * отвечает. Фикс: звать setState ТОЛЬКО если saveError реально был
       * не null — тогда переход в null происходит один раз и цикл не
       * запускается вообще (второй проход видит saveError уже null,
       * ничего не меняет, ничего не вызывает).
       */
      if (storeGetStateRef?.().saveError !== null) {
        storeSetStateRef?.({ saveError: null })
      }
    } catch (e) {
      console.error('[wall-calc] Не удалось сохранить проект в localStorage (переполнено хранилище?). Изменения останутся только в памяти до перезагрузки страницы.', e)
      if (storeGetStateRef?.().saveError === null) {
        storeSetStateRef?.({ saveError: 'Не удалось сохранить изменения на диск — переполнено хранилище браузера. Работа продолжается только в памяти: не закрывайте и не перезагружайте вкладку, пока не освободите место (например, удалите PDF-подложки на неиспользуемых этажах).' })
      }
    }
  },
  removeItem: (name: string): void => {
    try {
      window.localStorage.removeItem(name)
    } catch (e) {
      console.error('[wall-calc] localStorage.removeItem упал:', e)
    }
  },
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
      levels: [],
      activeLevelId: null,
      floorPlan: { ...DEFAULT_FLOOR_PLAN, lines: [] },
      activeWallId: null,
      activeLiningId: null,
      customWorkStageTemplates: [],
      saveError: null,
      clearSaveError: () => set({ saveError: null }),

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

      // Подставляет объект, загруженный из облака (см. useProjectsStore →
      // loadActiveProjectEntry), в общий localStorage-стор и делает его
      // активным — дальше все существующие функции (addWall, addRoomColumn
      // и т.д.) работают с ним точно так же, как с локальным объектом.
      // Не путать с обычным добавлением: если объект с таким id уже есть
      // в списке (повторное открытие того же облачного объекта) — заменяем
      // его содержимое, а не дублируем.
      hydrateProject: (entry) => {
        set(s => {
          const exists = s.projects.some(p => p.id === entry.id)
          const projects = exists
            ? s.projects.map(p => p.id === entry.id ? entry : p)
            : [entry, ...s.projects]
          return {
            projects,
            activeProjectId: entry.id,
            ...syncActive(projects, entry.id),
            activeWallId: null,
            activeLiningId: null,
          }
        })
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

      // ─── Пользовательские шаблоны этапов работ ("Сохранить как шаблон") ────

      addCustomWorkStageTemplate: (template) => {
        set(s => {
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId
              ? { ...p, customWorkStageTemplates: [...(p.customWorkStageTemplates ?? []), template] }
              : p
          )
          const active = projects.find(p => p.id === s.activeProjectId)
          return { projects, customWorkStageTemplates: active?.customWorkStageTemplates ?? [] }
        })
      },

      removeCustomWorkStageTemplate: (id) => {
        set(s => {
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId
              ? { ...p, customWorkStageTemplates: (p.customWorkStageTemplates ?? []).filter(t => t.id !== id) }
              : p
          )
          const active = projects.find(p => p.id === s.activeProjectId)
          return { projects, customWorkStageTemplates: active?.customWorkStageTemplates ?? [] }
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

      // ─── Этажи ───────────────────────────────────────────────────────────

      addLevel: (name, elevationMm) => {
        const level = emptyLevel(name, elevationMm)
        set(s => {
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, levels: [...p.levels, level], activeLevelId: level.id } : p
          )
          return { projects, ...syncActive(projects, s.activeProjectId) }
        })
        return level.id
      },

      duplicateLevel: (id, name, elevationMm) => {
        let newId = ''
        set(s => {
          const p = s.projects.find(p => p.id === s.activeProjectId)
          const src = p?.levels.find(lv => lv.id === id)
          if (!p || !src) return {}
          newId = `lv_${Date.now()}_${Math.random().toString(36).slice(2)}`
          const copy: Level = { id: newId, name, elevationMm, floorPlan: duplicateFloorPlanGeometry(src.floorPlan) }
          const projects = s.projects.map(pr =>
            pr.id === s.activeProjectId ? { ...pr, levels: [...pr.levels, copy], activeLevelId: copy.id } : pr
          )
          return { projects, ...syncActive(projects, s.activeProjectId) }
        })
        return newId
      },

      removeLevel: (id) => {
        set(s => {
          const p = s.projects.find(p => p.id === s.activeProjectId)
          if (!p || p.levels.length <= 1) return {} // последний этаж не удаляем — иначе объект без плана
          const levels = p.levels.filter(lv => lv.id !== id)
          const activeLevelId = p.activeLevelId === id ? levels[0].id : p.activeLevelId
          const projects = s.projects.map(pr =>
            pr.id === s.activeProjectId ? { ...pr, levels, activeLevelId } : pr
          )
          return { projects, ...syncActive(projects, s.activeProjectId) }
        })
      },

      renameLevel: (id, name) => {
        set(s => {
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId
              ? { ...p, levels: p.levels.map(lv => lv.id === id ? { ...lv, name } : lv) }
              : p
          )
          return { projects, ...syncActive(projects, s.activeProjectId) }
        })
      },

      setLevelElevation: (id, elevationMm) => {
        set(s => {
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId
              ? { ...p, levels: p.levels.map(lv => lv.id === id ? { ...lv, elevationMm } : lv) }
              : p
          )
          return { projects, ...syncActive(projects, s.activeProjectId) }
        })
      },

      selectLevel: (id) => {
        set(s => {
          const projects = s.projects.map(p =>
            p.id === s.activeProjectId ? { ...p, activeLevelId: id } : p
          )
          return { projects, ...syncActive(projects, s.activeProjectId) }
        })
      },

      // ─── План объекта (пишет в план активного этажа) ──────────────────────

      setFloorPlanScale: (scaleMmPerPx) => {
        set(s => updateActiveFloorPlan(s, fp => ({ ...fp, scaleMmPerPx })))
      },

      setBackgroundImage: (img) => {
        set(s => updateActiveFloorPlan(s, fp => ({ ...fp, backgroundImage: img })))
      },

      updateBackgroundImage: (patch) => {
        set(s => {
          const cur = s.floorPlan?.backgroundImage
          if (!cur) return {}
          return updateActiveFloorPlan(s, fp => ({ ...fp, backgroundImage: { ...cur, ...patch } }))
        })
      },

      addPlanLine: (line) => {
        const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2)}`
        set(s => {
          const newLine: PlanLine = { ...line, id }
          return updateActiveFloorPlan(s, fp => ({ ...fp, lines: [...fp.lines, newLine] }))
        })
        return id
      },

      updatePlanLine: (id, patch) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, lines: fp.lines.map(l => l.id === id ? { ...l, ...patch } : l),
        })))
      },

      removePlanLine: (id) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, lines: fp.lines.filter(l => l.id !== id),
        })))
      },

      clearFloorPlan: () => {
        set(s => updateActiveFloorPlan(s, fp => ({ ...fp, lines: [], contours: [] })))
      },

      addContour: (contour) => {
        set(s => {
          const newContour: PlanContour = { ...contour, id: `pc_${Date.now()}_${Math.random().toString(36).slice(2)}` }
          return updateActiveFloorPlan(s, fp => ({ ...fp, contours: [...(fp.contours ?? []), newContour] }))
        })
      },

      removeContour: (id) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, contours: (fp.contours ?? []).filter(c => c.id !== id),
        })))
      },

      updateContour: (id, patch) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, contours: (fp.contours ?? []).map(c => c.id === id ? { ...c, ...patch } : c),
        })))
      },

      addRoom: (room) => {
        set(s => {
          const newRoom: Room = { ...room, id: `rm_${Date.now()}_${Math.random().toString(36).slice(2)}` }
          return updateActiveFloorPlan(s, fp => ({ ...fp, rooms: [...(fp.rooms ?? []), newRoom] }))
        })
      },

      removeRoom: (id) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, rooms: (fp.rooms ?? []).filter(r => r.id !== id),
        })))
      },

      updateRoom: (id, patch) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, rooms: (fp.rooms ?? []).map(r => r.id === id ? { ...r, ...patch } : r),
        })))
      },

      // ─── Плиты (пол/потолок этажа) ─────────────────────────────────────────

      addSlab: (outer) => {
        const id = `sl_${Date.now()}_${Math.random().toString(36).slice(2)}`
        set(s => {
          const count = (s.floorPlan?.slabs ?? []).length + 1
          const newSlab: Slab = { id, outer, holes: [], label: `Плита ${count}` }
          return updateActiveFloorPlan(s, fp => ({ ...fp, slabs: [...(fp.slabs ?? []), newSlab] }))
        })
        return id
      },

      removeSlab: (id) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, slabs: (fp.slabs ?? []).filter(sl => sl.id !== id),
        })))
      },

      updateSlabOuter: (id, outer) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, slabs: (fp.slabs ?? []).map(sl => sl.id === id ? { ...sl, outer } : sl),
        })))
      },

      addSlabHole: (id, hole) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, slabs: (fp.slabs ?? []).map(sl => sl.id === id ? { ...sl, holes: [...sl.holes, hole] } : sl),
        })))
      },

      removeSlabHole: (id, holeIndex) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, slabs: (fp.slabs ?? []).map(sl => sl.id === id ? { ...sl, holes: sl.holes.filter((_, i) => i !== holeIndex) } : sl),
        })))
      },

      // ─── Круглые колонны ────────────────────────────────────────────────────

      addRoundColumn: (col) => {
        const id = `rc_${Date.now()}_${Math.random().toString(36).slice(2)}`
        set(s => {
          const newCol: RoundColumn = { ...col, id }
          return updateActiveFloorPlan(s, fp => ({ ...fp, roundColumns: [...(fp.roundColumns ?? []), newCol] }))
        })
        return id
      },

      updateRoundColumn: (id, patch) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, roundColumns: (fp.roundColumns ?? []).map(rc => rc.id === id ? { ...rc, ...patch } : rc),
        })))
      },

      removeRoundColumn: (id) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, roundColumns: (fp.roundColumns ?? []).filter(rc => rc.id !== id),
        })))
      },

      // ─── Прямоугольные колонны (самостоятельная сущность с 05.07.2026) ─────

      addRectColumn: (col) => {
        const id = `rectcol_${Date.now()}_${Math.random().toString(36).slice(2)}`
        set(s => {
          const newCol: RectColumn = { ...col, id }
          return updateActiveFloorPlan(s, fp => ({ ...fp, rectColumns: [...(fp.rectColumns ?? []), newCol] }))
        })
        return id
      },

      updateRectColumn: (id, patch) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, rectColumns: (fp.rectColumns ?? []).map(rc => rc.id === id ? { ...rc, ...patch } : rc),
        })))
      },

      removeRectColumn: (id) => {
        set(s => updateActiveFloorPlan(s, fp => ({
          ...fp, rectColumns: (fp.rectColumns ?? []).filter(rc => rc.id !== id),
        })))
      },
    }),
    {
      name: 'wall-calc-projects', // ключ в localStorage
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({       // сохраняем только данные, не функции
        projects: stripHeavyDataForPersist(s.projects),
        activeProjectId: s.activeProjectId,
      }),
      onRehydrateStorage: () => (state) => {
        // После загрузки из localStorage синхронизируем плоские поля.
        // Миграция 1 (старая): layer1/layer2 как строка ('gkl') вместо объекта.
        // Миграция 2 (03.07.2026, этажи): у старых проектов было одно
        // floorPlan прямо на проекте — теперь это levels: Level[]. Если у
        // проекта нет levels — оборачиваем старый floorPlan в один этаж.
        if (state) {
          state.projects = state.projects.map(p => {
            const legacy = p as unknown as { floorPlan?: FloorPlan; levels?: Level[]; activeLevelId?: string }
            const levels: Level[] = legacy.levels && legacy.levels.length > 0
              ? legacy.levels.map(lv => ({ ...lv, floorPlan: { ...lv.floorPlan, contours: lv.floorPlan.contours ?? [], slabs: lv.floorPlan.slabs ?? [], roundColumns: lv.floorPlan.roundColumns ?? [], rectColumns: lv.floorPlan.rectColumns ?? [] } }))
              : [{
                  id: `lv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                  name: 'Этаж 1',
                  elevationMm: 0,
                  floorPlan: legacy.floorPlan
                    ? { ...legacy.floorPlan, contours: legacy.floorPlan.contours ?? [], slabs: legacy.floorPlan.slabs ?? [], roundColumns: legacy.floorPlan.roundColumns ?? [], rectColumns: legacy.floorPlan.rectColumns ?? [] }
                    : { ...DEFAULT_FLOOR_PLAN, lines: [], contours: [] },
                }]
            const activeLevelId = legacy.activeLevelId && levels.some(lv => lv.id === legacy.activeLevelId)
              ? legacy.activeLevelId
              : levels[0].id
            return {
              ...p,
              profileTemplates: p.profileTemplates ?? [],
              levels,
              activeLevelId,
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
            }
          })

          // ⚠️ P0-фикс 05.07.2026: stripHeavyDataForPersist раньше чистил
          // dataUrl подложки только для БУДУЩИХ записей на диск (partialize)
          // — но если localStorage уже содержал старые тяжёлые dataUrl
          // (сохранённые ДО того фикса), они как были, так и загружались
          // в live-память при гидратации и жили там всю сессию, пока не
          // перезагрузишь страницу. Именно поэтому "выбрать объект" и
          // "загрузить PDF" всё ещё зависали — дело не в самой ЗАПИСИ (та
          // уже лёгкая), а в том, что state ещё ДО первого нового действия
          // уже раздут старыми данными. Чистим прямо тут, применяя ту же
          // функцию к самому state, а не только к тому, что уйдёт в
          // localStorage. Только что заданные (только что открытые в этой
          // сессии) подложки эта чистка не трогает — она срабатывает один
          // раз, сразу после гидратации, до того как пользователь вообще
          // успел что-то новое загрузить.
          state.projects = stripHeavyDataForPersist(state.projects)

          const synced = syncActive(state.projects, state.activeProjectId)
          Object.assign(state, synced)
        }
      },
    }
  )
)

// Заполняем ссылку, использованную в safeLocalStorage.setItem (см. выше).
storeSetStateRef = useProjectStore.setState
storeGetStateRef = useProjectStore.getState
