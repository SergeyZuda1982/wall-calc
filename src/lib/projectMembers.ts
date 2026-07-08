// Облачные операции над участниками объекта (project_members).
// См. KONSPEKT «роли, права доступа и сметы» от 07.07.2026 (v2), раздел 4.

import { supabase } from './supabase'
import type { ProjectRole } from '../core/permissions'

export interface DbProjectMember {
  id: string
  project_id: string
  user_id: string | null
  invited_email: string | null
  role: ProjectRole
  specialty: string | null
  is_team_lead: boolean
  team_lead_id: string | null
  status: 'invited' | 'active'
  invited_by: string | null
  created_at: string
}

export const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: 'Владелец',
  foreman: 'Прораб',
  installer: 'Монтажник',
  management: 'Руководство',
  supply: 'Снабжение',
  designer: 'Проектировщик',
  subcontractor: 'Субподрядчик',
}

export const ASSIGNABLE_ROLES: ProjectRole[] = [
  'foreman', 'installer', 'management', 'supply', 'designer', 'subcontractor',
]

export async function fetchMembers(projectId: string): Promise<DbProjectMember[]> {
  const { data, error } = await supabase
    .from('project_members')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as DbProjectMember[]
}

/**
 * Вариант А приглашения (раздел 4г конспекта): если email уже зарегистрирован
 * в системе — сразу активная запись; если нет — запись висит invited до
 * первого входа этого email (см. handleNewUserInvites ниже, вызывается после
 * регистрации). Повторное приглашение уже добавленного email обновляет роль
 * через upsert по unique(project_id, invited_email).
 */
export async function inviteMember(params: {
  projectId: string
  email: string
  role: ProjectRole
  specialty?: string
  invitedBy: string
  teamLeadId?: string
}): Promise<{ member: DbProjectMember | null; error: string | null }> {
  const email = params.email.trim().toLowerCase()
  if (!email) return { member: null, error: 'Укажите email' }

  // Ищем, не зарегистрирован ли уже этот email — через RPC нет прямого
  // доступа к auth.users с фронтенда, поэтому просто пробуем найти
  // существующего участника с этим invited_email на ЛЮБОМ объекте, у
  // которого уже проставлен user_id (значит, регистрация была и наш
  // серверный триггер синхронизации уже сработал раньше). Если такого нет —
  // создаём как invited по email, активация произойдёт при следующем входе.
  const { data: existing } = await supabase
    .from('project_members')
    .select('user_id')
    .eq('invited_email', email)
    .not('user_id', 'is', null)
    .limit(1)
    .maybeSingle()

  const payload = {
    project_id: params.projectId,
    invited_email: email,
    user_id: existing?.user_id ?? null,
    role: params.role,
    specialty: params.specialty || null,
    status: existing?.user_id ? 'active' : 'invited',
    invited_by: params.invitedBy,
    team_lead_id: params.teamLeadId ?? null,
  }

  const { data, error } = await supabase
    .from('project_members')
    .upsert(payload, { onConflict: 'project_id,invited_email' })
    .select()
    .single()

  if (error) return { member: null, error: error.message }
  return { member: data as DbProjectMember, error: null }
}

export async function changeRole(memberId: string, role: ProjectRole): Promise<string | null> {
  const { error } = await supabase.from('project_members').update({ role }).eq('id', memberId)
  return error?.message ?? null
}

export async function removeMember(memberId: string): Promise<string | null> {
  const { error } = await supabase.from('project_members').delete().eq('id', memberId)
  return error?.message ?? null
}

/**
 * Передача прав владельца (раздел 4в) — отдельное действие с двумя
 * обновлениями. Не идеально атомарно с фронтенда (нет транзакции через
 * supabase-js), но триггер project_members_validate() не даст временно
 * оказаться в состоянии двух владельцев в неверном порядке — обновляем
 * старого владельца ПЕРВЫМ (снимаем роль owner), потом нового.
 */
export async function transferOwnership(
  currentOwnerId: string,
  newOwnerId: string,
  currentOwnerNewRole: ProjectRole,
): Promise<string | null> {
  const { error: e1 } = await supabase
    .from('project_members')
    .update({ role: currentOwnerNewRole })
    .eq('id', currentOwnerId)
  if (e1) return e1.message

  const { error: e2 } = await supabase
    .from('project_members')
    .update({ role: 'owner' })
    .eq('id', newOwnerId)
  if (e2) return e2.message

  return null
}

/**
 * Вызывать один раз после входа/регистрации пользователя — подхватывает
 * все invited-записи по его email на всех объектах и активирует их
 * (раздел 4г, п.3). email берём из auth-сессии, а не из формы.
 */
export async function activateInvitesForUser(userId: string, email: string): Promise<void> {
  await supabase
    .from('project_members')
    .update({ user_id: userId, status: 'active' })
    .eq('invited_email', email.trim().toLowerCase())
    .is('user_id', null)
}
