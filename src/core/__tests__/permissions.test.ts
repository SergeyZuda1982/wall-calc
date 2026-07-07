import { describe, it, expect } from 'vitest'
import { can, canManageMember, findMember, type ProjectMember } from '../permissions'

function member(overrides: Partial<ProjectMember>): ProjectMember {
  return {
    id: 'm1',
    projectId: 'p1',
    userId: 'u1',
    invitedEmail: null,
    role: 'installer',
    specialty: null,
    isTeamLead: false,
    teamLeadId: null,
    status: 'active',
    invitedBy: null,
    createdAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  }
}

describe('can — базовая матрица ролей (раздел 1 конспекта)', () => {
  it('удалить объект и передать владение — только owner', () => {
    expect(can('owner', 'deleteProject')).toBe(true)
    expect(can('foreman', 'deleteProject')).toBe(false)
    expect(can('management', 'deleteProject')).toBe(false)

    expect(can('owner', 'transferOwnership')).toBe(true)
    expect(can('management', 'transferOwnership')).toBe(false)
  })

  it('редактировать план — owner, foreman, designer', () => {
    expect(can('owner', 'editPlan')).toBe(true)
    expect(can('foreman', 'editPlan')).toBe(true)
    expect(can('designer', 'editPlan')).toBe(true)
    expect(can('installer', 'editPlan')).toBe(false)
    expect(can('subcontractor', 'editPlan')).toBe(false)
    expect(can('management', 'editPlan')).toBe(false)
  })

  it('отмечать статус своего участка — owner, foreman, installer, subcontractor; management только смотрит', () => {
    expect(can('installer', 'markOwnProgress')).toBe(true)
    expect(can('subcontractor', 'markOwnProgress')).toBe(true)
    expect(can('management', 'markOwnProgress')).toBe(false)
    expect(can('management', 'viewProgress')).toBe(true)
  })

  it('видеть план могут все роли объекта', () => {
    const allRoles = ['owner', 'foreman', 'installer', 'management', 'supply', 'designer', 'subcontractor'] as const
    for (const role of allRoles) {
      expect(can(role, 'viewPlan')).toBe(true)
    }
  })

  it('снабжение и проектировщик не управляют участниками по умолчанию', () => {
    expect(can('supply', 'manageMembers')).toBe(false)
    expect(can('designer', 'manageMembers')).toBe(false)
  })
})

describe('canManageMember — прораб субподрядчика только в рамках своей команды', () => {
  it('owner/foreman/management могут управлять любым участником', () => {
    const owner = member({ role: 'owner' })
    const target = member({ id: 'm2', role: 'installer' })
    expect(canManageMember(owner, target)).toBe(true)
  })

  it('прораб субподрядчика управляет только своими сотрудниками (team_lead_id совпадает)', () => {
    const teamLead = member({ id: 'lead1', role: 'subcontractor', isTeamLead: true })
    const ownEmployee = member({ id: 'emp1', role: 'subcontractor', teamLeadId: 'lead1' })
    const otherEmployee = member({ id: 'emp2', role: 'subcontractor', teamLeadId: 'lead2' })

    expect(canManageMember(teamLead, ownEmployee)).toBe(true)
    expect(canManageMember(teamLead, otherEmployee)).toBe(false)
  })

  it('рядовой субподрядчик (не team lead) не управляет никем', () => {
    const regular = member({ role: 'subcontractor', isTeamLead: false })
    const someone = member({ id: 'm3', role: 'installer' })
    expect(canManageMember(regular, someone)).toBe(false)
  })
})

describe('findMember', () => {
  const members = [
    member({ id: 'm1', userId: 'u1', status: 'active' }),
    member({ id: 'm2', userId: 'u2', status: 'invited' }),
  ]

  it('находит активного участника по userId', () => {
    expect(findMember(members, 'u1')?.id).toBe('m1')
  })

  it('не возвращает участника со статусом invited', () => {
    expect(findMember(members, 'u2')).toBeNull()
  })

  it('null для userId = null', () => {
    expect(findMember(members, null)).toBeNull()
  })
})
