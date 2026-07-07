/**
 * permissions.ts — единый "проверятель прав" по ролям объекта.
 * См. KONSPEKT «роли, права доступа и сметы» от 07.07.2026 (v2), раздел 1.
 *
 * ПРИНЦИП: новое право = новая строка в MATRIX ниже, а НЕ разбросанный по
 * компонентам `if (role === '...')`. Весь фронтенд спрашивает разрешение
 * только через can(...) из этого файла.
 *
 * Финансовые сметы (раздел 3 конспекта) сюда НЕ входят — там доступ зависит
 * не только от роли, но и от того, кто именно выдал смету (estimate_access),
 * это отдельная система, см. estimateAccess.ts (следующий шаг).
 */

export type ProjectRole =
  | 'owner'
  | 'foreman'
  | 'installer'
  | 'management'
  | 'supply'
  | 'designer'
  | 'subcontractor'

export interface ProjectMember {
  id: string
  projectId: string
  userId: string | null
  invitedEmail: string | null
  role: ProjectRole
  specialty: string | null
  isTeamLead: boolean
  teamLeadId: string | null
  status: 'invited' | 'active'
  invitedBy: string | null
  createdAt: string
}

/** Действия из матрицы раздела 1 (сметы — отдельно, см. шапку файла) */
export type ProjectAction =
  | 'deleteProject'
  | 'transferOwnership'
  | 'manageMembers'          // пригласить/убрать участников
  | 'editPlan'               // стены, проёмы, колонны
  | 'markOwnProgress'        // отмечать статус работ на своём участке
  | 'viewProgress'           // видеть прогресс без права отмечать
  | 'flagImportant'          // пометки "важное" с адресатом
  | 'viewPlan'

// Матрица роль → право. true/false — как в разделе 1 конспекта.
// Личный расчёт ЗП (personal_rate_calc) сюда не входит — это не "право
// объекта", а отдельная приватная сущность, доступная только владельцу
// записи, см. раздел 3.
const MATRIX: Record<ProjectAction, Partial<Record<ProjectRole, boolean>>> = {
  deleteProject:      { owner: true },
  transferOwnership:  { owner: true },
  manageMembers:      { owner: true, foreman: true, management: true }, // subcontractor.isTeamLead — см. canManageMembers()
  editPlan:           { owner: true, foreman: true, designer: true },
  markOwnProgress:    { owner: true, foreman: true, installer: true, subcontractor: true },
  viewProgress:       { owner: true, foreman: true, installer: true, management: true, subcontractor: true },
  flagImportant:      { owner: true, foreman: true, installer: true, management: true, subcontractor: true },
  viewPlan:           { owner: true, foreman: true, installer: true, management: true, supply: true, designer: true, subcontractor: true },
}

/** Базовая проверка права по роли и матрице раздела 1 */
export function can(role: ProjectRole, action: ProjectAction): boolean {
  return MATRIX[action]?.[role] === true
}

/**
 * Прораб субподрядчика (is_team_lead = true) может приглашать/убирать
 * участников, но ТОЛЬКО в рамках своей команды (раздел 4б) — обычный
 * can('manageMembers', 'subcontractor') всегда false, это отдельная проверка
 * с учётом контекста конкретного участника, которого хотят пригласить/убрать.
 */
export function canManageMember(actor: ProjectMember, target: ProjectMember): boolean {
  if (can(actor.role, 'manageMembers')) return true
  if (actor.role === 'subcontractor' && actor.isTeamLead) {
    return target.teamLeadId === actor.id
  }
  return false
}

/** Владелец — особая роль: НЕ имеет автоматического доступа к финансовым
 * сметам, если сам не management или доступ не выдан вручную (раздел 3).
 * Эта функция сюда намеренно не входит — см. estimateAccess.ts.
 */

/** Хелпер: найти активную запись участника объекта для текущего пользователя */
export function findMember(members: ProjectMember[], userId: string | null): ProjectMember | null {
  if (!userId) return null
  return members.find(m => m.userId === userId && m.status === 'active') ?? null
}
