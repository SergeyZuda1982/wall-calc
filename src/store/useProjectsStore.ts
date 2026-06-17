// Хранилище СПИСКА объектов (проектов) пользователя.
// Не путать с useProjectStore (текущий открытый объект).

import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { DbProject } from '../lib/supabase'

interface ProjectsStore {
  projects: DbProject[]
  activeProjectId: string | null
  loading: boolean

  fetchProjects: () => Promise<void>
  createProject: (name: string) => Promise<DbProject | null>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setActiveProject: (id: string | null) => void
}

export const useProjectsStore = create<ProjectsStore>((set) => ({
  projects: [],
  activeProjectId: null,
  loading: false,

  fetchProjects: async () => {
    set({ loading: true })
    const { data } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false })
    set({ projects: data ?? [], loading: false })
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
    set(s => ({ projects: [data, ...s.projects] }))
    return data
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
}))
