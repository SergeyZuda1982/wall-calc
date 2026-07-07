// Хранилище СПИСКА объектов (проектов) пользователя в облаке.
// Не путать с useProjectStore (локальный стор, работает на localStorage).

import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { DbProject } from '../lib/supabase'
import type { ProjectEntry } from './useProjectStore'
import { fetchProjectContent, migrateLocalProjectsToCloud } from '../lib/projectCloud'

interface ProjectsStore {
  projects: DbProject[]
  activeProjectId: string | null
  loading: boolean
  // true, пока идёт перенос локальных объектов в облако при первом входе
  migrating: boolean

  fetchProjects: () => Promise<void>
  createProject: (name: string) => Promise<DbProject | null>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setActiveProject: (id: string | null) => void

  // подгружает полное содержимое объекта (walls/linings/levels/profileTemplates)
  // в форме, аналогичной локальному ProjectEntry
  loadActiveProjectEntry: (id: string) => Promise<ProjectEntry | null>

  // перенос локальных объектов в облако — вызывается один раз после первого
  // входа, если в облаке у пользователя пока нет ни одного объекта
  migrateLocalIfNeeded: (localProjects: ProjectEntry[], userId: string) => Promise<{ migrated: number; errors: string[] } | null>
}

export const useProjectsStore = create<ProjectsStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  loading: false,
  migrating: false,

  fetchProjects: async () => {
    set({ loading: true })
    // levels_data/profile_templates не тянем в список — они могут быть
    // большими, а для списка нужны только имя и даты
    const { data } = await supabase
      .from('projects')
      .select('id, user_id, name, created_at, updated_at')
      .order('updated_at', { ascending: false })
    set({ projects: (data as DbProject[]) ?? [], loading: false })
  },

  createProject: async (name) => {
    // user_id берём из текущей сессии — Supabase требует его явно при insert
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('projects')
      .insert({ name, user_id: user.id })
      .select()
      .single()
    if (error || !data) {
      console.error('createProject error:', error)
      return null
    }
    set(s => ({ projects: [data as DbProject, ...s.projects] }))
    return data as DbProject
  },

  renameProject: async (id, name) => {
    await supabase.from('projects').update({ name, updated_at: new Date().toISOString() }).eq('id', id)
    set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, name } : p) }))
  },

  deleteProject: async (id) => {
    await supabase.from('projects').delete().eq('id', id)
    set(s => ({
      projects: s.projects.filter(p => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
    }))
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  loadActiveProjectEntry: async (id) => {
    const row = get().projects.find(p => p.id === id)
    if (!row) return null
    const content = await fetchProjectContent(id)
    return {
      id: row.id,
      name: row.name,
      walls: content.walls,
      linings: content.linings,
      profileTemplates: content.profileTemplates,
      levels: content.levels,
      activeLevelId: content.levels[0]?.id ?? '',
      createdAt: row.created_at,
    }
  },

  migrateLocalIfNeeded: async (localProjects, userId) => {
    if (localProjects.length === 0) return null
    // первый вход определяем по отсутствию объектов в облаке у пользователя
    const { count } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    if ((count ?? 0) > 0) return null // не первый вход — не переносим

    set({ migrating: true })
    const result = await migrateLocalProjectsToCloud(localProjects, userId)
    await get().fetchProjects()
    set({ migrating: false })
    return result
  },
}))
