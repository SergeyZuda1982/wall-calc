import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMembersMock = vi.fn()
const inviteMemberMock = vi.fn()
const changeRoleMock = vi.fn()
const removeMemberMock = vi.fn()
const transferOwnershipMock = vi.fn()

vi.mock('../../lib/projectMembers', () => ({
  fetchMembers: (...args: unknown[]) => fetchMembersMock(...args),
  inviteMember: (...args: unknown[]) => inviteMemberMock(...args),
  changeRole: (...args: unknown[]) => changeRoleMock(...args),
  removeMember: (...args: unknown[]) => removeMemberMock(...args),
  transferOwnership: (...args: unknown[]) => transferOwnershipMock(...args),
}))

describe('useProjectMembersStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('load — загружает список участников и сбрасывает ошибку', async () => {
    fetchMembersMock.mockResolvedValue([{ id: 'm1', role: 'owner' }])
    const { useProjectMembersStore } = await import('../useProjectMembersStore')
    await useProjectMembersStore.getState().load('p1')
    expect(useProjectMembersStore.getState().members).toEqual([{ id: 'm1', role: 'owner' }])
    expect(useProjectMembersStore.getState().error).toBeNull()
  })

  it('load — при ошибке фиксирует текст ошибки, не роняет стор', async () => {
    fetchMembersMock.mockRejectedValue(new Error('нет доступа'))
    const { useProjectMembersStore } = await import('../useProjectMembersStore')
    await useProjectMembersStore.getState().load('p1')
    expect(useProjectMembersStore.getState().error).toBe('нет доступа')
  })

  it('invite — успешная попытка добавляет участника в members', async () => {
    inviteMemberMock.mockResolvedValue({ member: { id: 'm2', role: 'installer' }, error: null })
    const { useProjectMembersStore } = await import('../useProjectMembersStore')
    const ok = await useProjectMembersStore.getState().invite({
      projectId: 'p1', email: 'a@b.com', role: 'installer', invitedBy: 'u1',
    })
    expect(ok).toBe(true)
    expect(useProjectMembersStore.getState().members.some(m => m.id === 'm2')).toBe(true)
  })

  it('invite — ошибка не добавляет участника и пишет error', async () => {
    inviteMemberMock.mockResolvedValue({ member: null, error: 'Email уже занят' })
    const { useProjectMembersStore } = await import('../useProjectMembersStore')
    const ok = await useProjectMembersStore.getState().invite({
      projectId: 'p1', email: 'a@b.com', role: 'installer', invitedBy: 'u1',
    })
    expect(ok).toBe(false)
    expect(useProjectMembersStore.getState().error).toBe('Email уже занят')
  })

  it('invite — повторное приглашение того же id обновляет запись, не дублирует', async () => {
    fetchMembersMock.mockResolvedValue([{ id: 'm3', role: 'installer' }])
    const { useProjectMembersStore } = await import('../useProjectMembersStore')
    await useProjectMembersStore.getState().load('p1')

    inviteMemberMock.mockResolvedValue({ member: { id: 'm3', role: 'foreman' }, error: null })
    await useProjectMembersStore.getState().invite({
      projectId: 'p1', email: 'a@b.com', role: 'foreman', invitedBy: 'u1',
    })
    const members = useProjectMembersStore.getState().members
    expect(members).toHaveLength(1)
    expect(members[0].role).toBe('foreman')
  })

  it('setRole — обновляет роль участника локально при успехе', async () => {
    fetchMembersMock.mockResolvedValue([{ id: 'm4', role: 'installer' }])
    changeRoleMock.mockResolvedValue(null)
    const { useProjectMembersStore } = await import('../useProjectMembersStore')
    await useProjectMembersStore.getState().load('p1')
    const ok = await useProjectMembersStore.getState().setRole('m4', 'foreman')
    expect(ok).toBe(true)
    expect(useProjectMembersStore.getState().members[0].role).toBe('foreman')
  })

  it('remove — убирает участника из списка при успехе', async () => {
    fetchMembersMock.mockResolvedValue([{ id: 'm5', role: 'installer' }])
    removeMemberMock.mockResolvedValue(null)
    const { useProjectMembersStore } = await import('../useProjectMembersStore')
    await useProjectMembersStore.getState().load('p1')
    const ok = await useProjectMembersStore.getState().remove('m5')
    expect(ok).toBe(true)
    expect(useProjectMembersStore.getState().members).toHaveLength(0)
  })

  it('transferTo — при успехе перезагружает список участников объекта', async () => {
    fetchMembersMock.mockResolvedValueOnce([{ id: 'owner1', project_id: 'p1', role: 'owner' }])
    const { useProjectMembersStore } = await import('../useProjectMembersStore')
    await useProjectMembersStore.getState().load('p1')

    transferOwnershipMock.mockResolvedValue(null)
    fetchMembersMock.mockResolvedValueOnce([
      { id: 'owner1', project_id: 'p1', role: 'foreman' },
      { id: 'new1', project_id: 'p1', role: 'owner' },
    ])
    const ok = await useProjectMembersStore.getState().transferTo('owner1', 'new1', 'foreman')
    expect(ok).toBe(true)
    expect(fetchMembersMock).toHaveBeenCalledWith('p1')
    expect(useProjectMembersStore.getState().members.find(m => m.id === 'new1')?.role).toBe('owner')
  })

  it('clearError — сбрасывает текст ошибки', async () => {
    const { useProjectMembersStore } = await import('../useProjectMembersStore')
    useProjectMembersStore.setState({ error: 'что-то не так' })
    useProjectMembersStore.getState().clearError()
    expect(useProjectMembersStore.getState().error).toBeNull()
  })
})
