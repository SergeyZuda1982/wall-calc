// Облачные операции над объектом (проектом), не привязанные к React-хукам.
// См. KONSPEKT «переход объектов на реальное облачное хранение» от 06.07.2026.
//
// Решение по способу синхронизации (шаг 5, уточнено при интеграции в App.tsx):
// useProjectStore хранит весь активный объект одним деревом (projects[]) и
// правится десятками отдельных функций (addWall, addRoomColumn, updatePlanLine
// и т.д.) — расставлять облачный вызов в каждую из них было бы огромной и
// хрупкой переделкой. Вместо этого синхронизация идёт ПОЛНЫМ СЛЕПКОМ активного
// объекта (walls+linings+levels+profileTemplates) с дебаунсом ~1 сек после
// последнего изменения — см. useSupabaseSync.ts и App.tsx.

import { supabase } from './supabase'
import type { DbProject } from './supabase'
import type { Level, ProfileTemplate } from '../types'
import type { ProjectEntry, WallEntry, LiningEntry } from '../store/useProjectStore'

export interface CloudProjectContent {
  walls: WallEntry[]
  linings: LiningEntry[]
  levels: Level[]
  profileTemplates: ProfileTemplate[]
}

// ─── Загрузка полного содержимого одного объекта ────────────────────────────
export async function fetchProjectContent(projectId: string): Promise<CloudProjectContent> {
  const [{ data: walls }, { data: linings }, { data: projectRow }] = await Promise.all([
    supabase.from('walls').select('*').eq('project_id', projectId).order('created_at'),
    supabase.from('linings').select('*').eq('project_id', projectId).order('created_at'),
    supabase.from('projects').select('levels_data, profile_templates').eq('id', projectId).single(),
  ])

  return {
    walls: (walls ?? []) as unknown as WallEntry[],
    linings: (linings ?? []) as unknown as LiningEntry[],
    levels: (projectRow?.levels_data as Level[] | null) ?? [],
    profileTemplates: (projectRow?.profile_templates as ProfileTemplate[] | null) ?? [],
  }
}

// ─── Полная перезапись содержимого объекта в облаке ─────────────────────────
// Для объёма данных одного объекта (десятки стен/обшивок) это надёжнее, чем
// построчный diff: удаляем текущий набор walls/linings и вставляем актуальный,
// levels_data/profile_templates просто перезаписываем в строке projects.
export async function syncFullProjectToCloud(projectId: string, content: CloudProjectContent): Promise<void> {
  await supabase.from('projects').update({
    levels_data: content.levels,
    profile_templates: content.profileTemplates,
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)

  await supabase.from('walls').delete().eq('project_id', projectId)
  if (content.walls.length > 0) {
    await supabase.from('walls').insert(content.walls.map(w => ({
      id: w.id, project_id: projectId, label: w.label, input: w.input, result: w.result, positions: w.positions,
    })))
  }

  await supabase.from('linings').delete().eq('project_id', projectId)
  if (content.linings.length > 0) {
    await supabase.from('linings').insert(content.linings.map(l => ({
      id: l.id, project_id: projectId, label: l.label, input: l.input, result: l.result,
    })))
  }
}

// ─── Перенос локальных объектов в облако при первом входе ──────────────────
export async function migrateLocalProjectsToCloud(
  localProjects: ProjectEntry[],
  userId: string,
): Promise<{ migrated: number; errors: string[] }> {
  const errors: string[] = []
  let migrated = 0

  for (const p of localProjects) {
    const { data: projectRow, error: projectError } = await supabase
      .from('projects')
      .insert({
        name: p.name,
        user_id: userId,
        levels_data: p.levels,
        profile_templates: p.profileTemplates,
        created_at: p.createdAt,
      })
      .select()
      .single()

    if (projectError || !projectRow) {
      errors.push(`Объект "${p.name}": ${projectError?.message ?? 'не удалось создать запись'}`)
      continue
    }

    const newProjectId = (projectRow as DbProject).id

    const { error: memberError } = await supabase
      .from('project_members')
      .insert({ project_id: newProjectId, user_id: userId, role: 'owner', status: 'active' })
    if (memberError) errors.push(`Объект "${p.name}": не удалось создать владельца в project_members (${memberError.message})`)

    if (p.walls.length > 0) {
      const { error } = await supabase.from('walls').insert(p.walls.map(w => ({
        id: w.id, project_id: newProjectId, label: w.label, input: w.input, result: w.result, positions: w.positions,
      })))
      if (error) errors.push(`Объект "${p.name}", стены: ${error.message}`)
    }

    if (p.linings.length > 0) {
      const { error } = await supabase.from('linings').insert(p.linings.map(l => ({
        id: l.id, project_id: newProjectId, label: l.label, input: l.input, result: l.result,
      })))
      if (error) errors.push(`Объект "${p.name}", обшивки: ${error.message}`)
    }

    migrated++
  }

  return { migrated, errors }
}
