import { create } from 'zustand'
import type { ProjectRole } from '../core/permissions'
import {
  type DbProjectMember,
  fetchMembers,
  inviteMember,
  changeRole,
  removeMember,
  transferOwnership,
} from '../lib/projectMembers'

interface ProjectMembersStore {
  members: DbProjectMember[]
  loading: boolean
  error: string | null

  load: (projectId: string) => Promise<void>
  invite: (params: {
    projectId: string
    email: string
    role: ProjectRole
    specialty?: string
    invitedBy: string
    teamLeadId?: string
  }) => Promise<boolean>
  setRole: (memberId: string, role: ProjectRole) => Promise<boolean>
  remove: (memberId: string) => Promise<boolean>
  transferTo: (currentOwnerId: string, newOwnerId: string, currentOwnerNewRole: ProjectRole) => Promise<boolean>
  clearError: () => void
}

export const useProjectMembersStore = create<ProjectMembersStore>((set, get) => ({
  members: [],
  loading: false,
  error: null,

  load: async (projectId) => {
    set({ loading: true, error: null })
    try {
      const members = await fetchMembers(projectId)
      set({ members, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Не удалось загрузить участников' })
    }
  },

  invite: async (params) => {
    set({ error: null })
    const { member, error } = await inviteMember(params)
    if (error || !member) {
      set({ error: error ?? 'Не удалось пригласить участника' })
      return false
    }
    set(s => ({
      members: s.members.some(m => m.id === member.id)
        ? s.members.map(m => m.id === member.id ? member : m)
        : [...s.members, member],
    }))
    return true
  },

  setRole: async (memberId, role) => {
    const error = await changeRole(memberId, role)
    if (error) { set({ error }); return false }
    set(s => ({ members: s.members.map(m => m.id === memberId ? { ...m, role } : m) }))
    return true
  },

  remove: async (memberId) => {
    const error = await removeMember(memberId)
    if (error) { set({ error }); return false }
    set(s => ({ members: s.members.filter(m => m.id !== memberId) }))
    return true
  },

  transferTo: async (currentOwnerId, newOwnerId, currentOwnerNewRole) => {
    const error = await transferOwnership(currentOwnerId, newOwnerId, currentOwnerNewRole)
    if (error) { set({ error }); return false }
    const projectId = get().members.find(m => m.id === currentOwnerId)?.project_id
    if (projectId) await get().load(projectId)
    return true
  },

  clearError: () => set({ error: null }),
}))
