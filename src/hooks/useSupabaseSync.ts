// Синхронизирует активный объект (walls + linings + levels + profileTemplates)
// с Supabase, пока пользователь вошёл и открытый объект — облачный.
// Дебаунс ~1 сек после последнего изменения (план на активном этаже меняется
// на каждое действие мышью — писать в облако на каждый пиксель нельзя).

import { useCallback, useRef, useEffect } from 'react'
import { syncFullProjectToCloud, fetchProjectContent, type CloudProjectContent } from '../lib/projectCloud'

const DEBOUNCE_MS = 1000

export function useSupabaseSync(activeCloudProjectId: string | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // при смене/закрытии облачного объекта — отменяем отложенное сохранение по
  // старому id, чтобы случайно не перезаписать чужой/предыдущий объект
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [activeCloudProjectId])

  const scheduleSync = useCallback((content: CloudProjectContent) => {
    if (!activeCloudProjectId) return
    if (timer.current) clearTimeout(timer.current)
    const pid = activeCloudProjectId
    timer.current = setTimeout(() => {
      syncFullProjectToCloud(pid, content).catch(e => console.error('[wall-calc] облачная синхронизация упала:', e))
    }, DEBOUNCE_MS)
  }, [activeCloudProjectId])

  const loadProject = useCallback((pid: string) => fetchProjectContent(pid), [])

  return { scheduleSync, loadProject }
}
