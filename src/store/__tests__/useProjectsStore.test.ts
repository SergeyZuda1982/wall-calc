import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Баг 07.07.2026: у новых облачных объектов (createProject в
 * useProjectsStore.ts) не было ни одного этажа — insert в Supabase не
 * задавал `levels_data` вообще. Итог: fetchProjectContent().levels === [],
 * activeLevelId нигде не находится → state.activeLevelId=null,
 * state.levels=[]. Симптомы на практике: 2D-план рисовать МОЖНО
 * (state.floorPlan — отдельное зеркало, не привязанное к Level, всегда
 * обновляется), но 3D (Scene3D читает именно state.levels) оставался
 * пустым, а кнопки «дублировать/удалить/переименовать/отметка» у панели
 * этажей (завязаны на activeLevelId) переставали отображаться — виден
 * только «+ этаж».
 *
 * Фикс — в двух местах: (1) createProject теперь сразу вставляет один
 * стартовый Level, как и локальный emptyProject(); (2)
 * loadActiveProjectEntry защищает уже существующие (созданные ДО фикса)
 * облачные объекты — если у объекта в БД всё ещё 0 этажей, синтезирует
 * один прямо при загрузке, не роняя 3D/панель молча.
 */

const insertMock = vi.fn()
const singleMock = vi.fn()
const getUserMock = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => getUserMock(...args) },
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}))

vi.mock('../../lib/projectCloud', () => ({
  fetchProjectContent: vi.fn(),
  migrateLocalProjectsToCloud: vi.fn(),
}))

describe('useProjectsStore — облачный объект всегда получает хотя бы один этаж', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertMock.mockReturnValue({ select: () => ({ single: singleMock }) })
  })

  it('createProject вставляет levels_data с одним стартовым этажом и создаёт owner-запись в project_members', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    singleMock.mockResolvedValue({
      data: { id: 'p1', user_id: 'u1', name: 'Объект', created_at: 't', updated_at: 't', levels_data: null, profile_templates: null },
      error: null,
    })

    const { useProjectsStore } = await import('../useProjectsStore')
    await useProjectsStore.getState().createProject('Объект')

    expect(insertMock).toHaveBeenCalledTimes(2)
    const insertArg = insertMock.mock.calls[0][0] as { levels_data: { id: string; name: string }[] }
    expect(insertArg.levels_data).toHaveLength(1)
    expect(insertArg.levels_data[0].name).toBe('Этаж 1')

    const memberInsertArg = insertMock.mock.calls[1][0] as { project_id: string; user_id: string; role: string; status: string }
    expect(memberInsertArg).toEqual({ project_id: 'p1', user_id: 'u1', role: 'owner', status: 'active' })
  })

  it('loadActiveProjectEntry синтезирует этаж для уже сломанного (созданного до фикса) объекта с 0 этажей', async () => {
    const { useProjectsStore } = await import('../useProjectsStore')
    const { fetchProjectContent } = await import('../../lib/projectCloud')
    vi.mocked(fetchProjectContent).mockResolvedValue({ walls: [], linings: [], levels: [], profileTemplates: [] })

    useProjectsStore.setState({
      projects: [{ id: 'p1', user_id: 'u1', name: 'Старый объект', created_at: 't', updated_at: 't', levels_data: null, profile_templates: null }],
    })

    const entry = await useProjectsStore.getState().loadActiveProjectEntry('p1')

    expect(entry).not.toBeNull()
    expect(entry!.levels).toHaveLength(1)
    expect(entry!.activeLevelId).toBe(entry!.levels[0].id)
  })

  it('loadActiveProjectEntry не трогает объект, у которого этажи уже есть', async () => {
    const { useProjectsStore } = await import('../useProjectsStore')
    const { fetchProjectContent } = await import('../../lib/projectCloud')
    const existingLevel = { id: 'lv_existing', name: 'Этаж 1', elevationMm: 0, floorPlan: { scaleMmPerPx: 10, lines: [], contours: [], rooms: [] } }
    vi.mocked(fetchProjectContent).mockResolvedValue({ walls: [], linings: [], levels: [existingLevel as any], profileTemplates: [] })

    useProjectsStore.setState({
      projects: [{ id: 'p1', user_id: 'u1', name: 'Объект', created_at: 't', updated_at: 't', levels_data: [existingLevel], profile_templates: null }],
    })

    const entry = await useProjectsStore.getState().loadActiveProjectEntry('p1')

    expect(entry!.levels).toHaveLength(1)
    expect(entry!.levels[0].id).toBe('lv_existing')
    expect(entry!.activeLevelId).toBe('lv_existing')
  })
})
