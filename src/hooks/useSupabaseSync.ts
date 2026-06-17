// Синхронизирует текущий открытый объект (walls + linings) с Supabase.
// Вызывается из App.tsx после каждого изменения.

import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { WallEntry, LiningEntry } from '../store/useProjectStore'

export function useSupabaseSync(projectId: string | null) {

  const saveWall = useCallback(async (wall: WallEntry) => {
    if (!projectId) return
    await supabase.from('walls').upsert({
      id: wall.id,
      project_id: projectId,
      label: wall.label,
      input: wall.input,
      result: wall.result,
      positions: wall.positions,
    })
    // обновим updated_at у проекта
    await supabase.from('projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', projectId)
  }, [projectId])

  const deleteWall = useCallback(async (wallId: string) => {
    if (!projectId) return
    await supabase.from('walls').delete().eq('id', wallId)
  }, [projectId])

  const saveLining = useCallback(async (lining: LiningEntry) => {
    if (!projectId) return
    await supabase.from('linings').upsert({
      id: lining.id,
      project_id: projectId,
      label: lining.label,
      input: lining.input,
      result: lining.result,
    })
  }, [projectId])

  const deleteLining = useCallback(async (liningId: string) => {
    if (!projectId) return
    await supabase.from('linings').delete().eq('id', liningId)
  }, [projectId])

  const loadProject = useCallback(async (pid: string) => {
    const [{ data: walls }, { data: linings }] = await Promise.all([
      supabase.from('walls').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('linings').select('*').eq('project_id', pid).order('created_at'),
    ])
    return { walls: walls ?? [], linings: linings ?? [] }
  }, [])

  return { saveWall, deleteWall, saveLining, deleteLining, loadProject }
}
