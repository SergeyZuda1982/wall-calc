import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Тесты на фундамент инженерных слоёв (вентиляция/электрика), 08.07.2026.
 * См. types/index.ts (MepDiscipline, MepRoute, MepBackgrounds) и
 * TASKS.md (feat/mep-layers-foundation) за контекстом задачи.
 *
 * Этот шаг — только стор-экшены и типы, БЕЗ UI. Проверяем:
 * - трассы (MepRoute) добавляются/обновляются/удаляются независимо от
 *   архитектурной геометрии (lines/freeformStructures её не видят);
 * - подложки по дисциплинам (mepBackgrounds) хранятся отдельно от
 *   основной backgroundImage и не затираются при её смене;
 * - как и у остальной геометрии плана (см. useProjectStore.levelsSync.test.ts),
 *   изменения сразу видны в state.levels, а не только в state.floorPlan.
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('useProjectStore — инженерные слои (MepRoute/MepBackgrounds)', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('новый проект создаётся с пустыми mepRoutes/mepBackgrounds (обратная совместимость DEFAULT_FLOOR_PLAN)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    const state = useProjectStore.getState()
    expect(state.floorPlan.mepRoutes).toEqual([])
    expect(state.floorPlan.mepBackgrounds).toEqual({})
  })

  it('addMepRoute добавляет трассу нужной дисциплины, не трогая остальную геометрию плана', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().addPlanLine({
      type: 'wall_existing', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, label: 'С-1',
    } as any)

    const id = useProjectStore.getState().addMepRoute({
      discipline: 'ventilation',
      points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }],
      elevationMm: 2700,
      sizeMm: { widthMm: 200, heightMm: 150 },
      label: 'Воздуховод 1',
    })

    const state = useProjectStore.getState()
    expect(state.floorPlan.mepRoutes.length).toBe(1)
    expect(state.floorPlan.mepRoutes[0].id).toBe(id)
    expect(state.floorPlan.mepRoutes[0].discipline).toBe('ventilation')
    // архитектурная геометрия не пострадала
    expect(state.floorPlan.lines.length).toBe(1)
  })

  it('addMepRoute сразу отражается в state.levels (тот же паттерн, что у остальной геометрии плана)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().addMepRoute({
      discipline: 'electrical',
      points: [{ x: 0, y: 0 }, { x: 300, y: 0 }],
      elevationMm: 300,
      sizeMm: {},
      label: 'Кабель-трасса 1',
    })

    const state = useProjectStore.getState()
    const activeLevel = state.levels.find(lv => lv.id === state.activeLevelId)
    expect(activeLevel?.floorPlan.mepRoutes?.length).toBe(1)
    expect(activeLevel?.floorPlan.mepRoutes?.[0].discipline).toBe('electrical')
  })

  it('updateMepRoute патчит только нужную трассу по id', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    const id1 = useProjectStore.getState().addMepRoute({
      discipline: 'ventilation', points: [{ x: 0, y: 0 }], elevationMm: 2700,
      sizeMm: { diameterMm: 100 }, label: 'Воздуховод 1',
    })
    useProjectStore.getState().addMepRoute({
      discipline: 'ventilation', points: [{ x: 100, y: 100 }], elevationMm: 2700,
      sizeMm: { diameterMm: 150 }, label: 'Воздуховод 2',
    })

    useProjectStore.getState().updateMepRoute(id1, { elevationMm: 2400, label: 'Воздуховод 1 (правка)' })

    const routes = useProjectStore.getState().floorPlan.mepRoutes
    const r1 = routes.find(r => r.id === id1)!
    const r2 = routes.find(r => r.id !== id1)!
    expect(r1.elevationMm).toBe(2400)
    expect(r1.label).toBe('Воздуховод 1 (правка)')
    expect(r2.elevationMm).toBe(2700) // вторая трасса не задета
  })

  it('removeMepRoute удаляет только указанную трассу', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    const id1 = useProjectStore.getState().addMepRoute({
      discipline: 'electrical', points: [{ x: 0, y: 0 }], elevationMm: 300, sizeMm: {}, label: 'Трасса 1',
    })
    useProjectStore.getState().addMepRoute({
      discipline: 'electrical', points: [{ x: 1, y: 1 }], elevationMm: 300, sizeMm: {}, label: 'Трасса 2',
    })

    useProjectStore.getState().removeMepRoute(id1)

    const routes = useProjectStore.getState().floorPlan.mepRoutes
    expect(routes.length).toBe(1)
    expect(routes[0].label).toBe('Трасса 2')
  })

  it('setMepBackground хранит подложку дисциплины отдельно от основной backgroundImage и от других дисциплин', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().setBackgroundImage({
      dataUrl: 'data:image/png;base64,ARCH', x: 0, y: 0, width: 1000, height: 1000, opacity: 0.6, locked: true,
    })
    useProjectStore.getState().setMepBackground('ventilation', {
      dataUrl: 'data:image/png;base64,VENT', x: 0, y: 0, width: 1000, height: 1000, opacity: 0.6, locked: true,
    })

    const state = useProjectStore.getState()
    // архитектурная подложка не пострадала
    expect(state.floorPlan.backgroundImage?.dataUrl).toBe('data:image/png;base64,ARCH')
    expect(state.floorPlan.mepBackgrounds.ventilation?.dataUrl).toBe('data:image/png;base64,VENT')
    // электрика ещё не задавалась
    expect(state.floorPlan.mepBackgrounds.electrical).toBeUndefined()
  })

  it('переключение подложки одной дисциплины не стирает подложку другой (можно вернуться и свериться)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().setMepBackground('ventilation', {
      dataUrl: 'data:image/png;base64,VENT', x: 0, y: 0, width: 1000, height: 1000, opacity: 0.6, locked: true,
    })
    useProjectStore.getState().setMepBackground('electrical', {
      dataUrl: 'data:image/png;base64,ELEC', x: 0, y: 0, width: 1000, height: 1000, opacity: 0.6, locked: true,
    })

    const state = useProjectStore.getState()
    expect(state.floorPlan.mepBackgrounds.ventilation?.dataUrl).toBe('data:image/png;base64,VENT')
    expect(state.floorPlan.mepBackgrounds.electrical?.dataUrl).toBe('data:image/png;base64,ELEC')
  })

  it('updateMepBackground патчит подложку дисциплины (например, opacity для сверки), не требуя пересоздавать её целиком', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().setMepBackground('ventilation', {
      dataUrl: 'data:image/png;base64,VENT', x: 0, y: 0, width: 1000, height: 1000, opacity: 0.6, locked: true,
    })
    useProjectStore.getState().updateMepBackground('ventilation', { opacity: 0.3 })

    const bg = useProjectStore.getState().floorPlan.mepBackgrounds.ventilation
    expect(bg?.opacity).toBe(0.3)
    expect(bg?.dataUrl).toBe('data:image/png;base64,VENT') // остальное не пострадало
  })

  it('updateMepBackground для ещё не заданной дисциплины ничего не делает (нет краша на undefined)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    expect(() => {
      useProjectStore.getState().updateMepBackground('electrical', { opacity: 0.5 })
    }).not.toThrow()
    expect(useProjectStore.getState().floorPlan.mepBackgrounds.electrical).toBeUndefined()
  })
})
