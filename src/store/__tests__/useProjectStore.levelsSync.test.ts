import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Регресс-тест на баг 07.07.2026: верхнеуровневое зеркало `state.levels`
 * (отдельное от `state.floorPlan` и от `state.projects[...].levels`) не
 * обновлялось при обычных правках плана (линии, плиты, колонны) — только
 * при действиях с самими этажами (addLevel/duplicateLevel/renameLevel/
 * setLevelElevation/selectLevel/removeLevel), которые явно вызывают
 * syncActive().
 *
 * Симптом на практике: пользователь рисует плиту, потом колонны, открывает
 * вкладку 3D (Scene3D.tsx читает именно `state.levels`, не `state.floorPlan`,
 * т.к. показывает ВСЕ этажи разом) — видит только то, что успело попасть в
 * levels на момент последней синхронизации. Нажатие "Дублировать этаж"
 * (вызывает syncActive) неожиданно "чинит" картинку и заодно протаскивает
 * актуальные данные на новый дубликат — отсюда репорт "колонны появились
 * только после дублирования, причём сразу на обоих этажах".
 *
 * Тот же пробел бил по дебаунс-синхронизации с облаком в App.tsx (она
 * следит именно за `levels` через useEffect).
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('useProjectStore — state.levels остаётся в синхроне с floorPlan (не только на действиях с этажами)', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('addRoundColumn сразу отражается в state.levels, не только в state.floorPlan', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().addRoundColumn({
      cx: 100, cy: 100, diameterMm: 400, spec: { material: 'concrete' } as any,
      category: 'capital', workStatus: 'existing', label: 'Колонна 1',
    })

    const state = useProjectStore.getState()
    // Мирроры между собой согласованы...
    expect(state.floorPlan.roundColumns?.length).toBe(1)
    // ...и, что важно, ТОП-УРОВНЕВЫЙ levels (то, что читает Scene3D) —
    // тоже видит новую колонну, а не старый снимок без неё.
    const activeLevel = state.levels.find(lv => lv.id === state.activeLevelId)
    expect(activeLevel?.floorPlan.roundColumns?.length).toBe(1)
  })

  it('addRectColumn сразу отражается в state.levels', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().addRectColumn({
      cx: 200, cy: 200, widthMm: 400, depthMm: 400, angleRad: 0,
      spec: { material: 'concrete' } as any, category: 'capital', workStatus: 'existing', label: 'Колонна 1',
    })

    const state = useProjectStore.getState()
    const activeLevel = state.levels.find(lv => lv.id === state.activeLevelId)
    expect(activeLevel?.floorPlan.rectColumns?.length).toBe(1)
  })

  it('addSlab и addPlanLine тоже сразу отражаются в state.levels (не только колонны — баг был общий)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    useProjectStore.getState().addPlanLine({
      type: 'wall_existing', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, label: 'С-1',
    } as any)

    const state = useProjectStore.getState()
    const activeLevel = state.levels.find(lv => lv.id === state.activeLevelId)
    expect(activeLevel?.floorPlan.slabs?.length).toBe(1)
    expect(activeLevel?.floorPlan.lines.length).toBe(1)
  })

  it('несколько последовательных правок подряд не теряют синхронизацию (несколько addRoundColumn без действий с этажами между ними)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().addRoundColumn({
      cx: 0, cy: 0, diameterMm: 300, spec: { material: 'concrete' } as any,
      category: 'capital', workStatus: 'existing', label: 'Колонна 1',
    })
    useProjectStore.getState().addRoundColumn({
      cx: 500, cy: 0, diameterMm: 300, spec: { material: 'concrete' } as any,
      category: 'capital', workStatus: 'existing', label: 'Колонна 2',
    })
    useProjectStore.getState().addRoundColumn({
      cx: 1000, cy: 0, diameterMm: 300, spec: { material: 'concrete' } as any,
      category: 'capital', workStatus: 'existing', label: 'Колонна 3',
    })

    const state = useProjectStore.getState()
    const activeLevel = state.levels.find(lv => lv.id === state.activeLevelId)
    expect(activeLevel?.floorPlan.roundColumns?.length).toBe(3)
  })

  it('РЕГРЕСС 07.07.2026: если activeProjectId не совпадает ни с одним проектом (пустой список или рассинхрон), правка плана НЕ должна затирать state.levels пустым массивом', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    // Ни одного проекта не создано — activeProjectId остаётся null,
    // но 2D-план всё равно рисуется поверх state.floorPlan "по умолчанию"
    // (FloorPlan.tsx не требует выбранного объекта для показа вкладки
    // "План" — это отдельная, уже существующая особенность интерфейса).
    expect(useProjectStore.getState().activeProjectId).toBeNull()
    const levelsBefore = useProjectStore.getState().levels

    useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])

    const state = useProjectStore.getState()
    // floorPlan-зеркало обновляется всегда (как и раньше — иначе бы не
    // рисовалось на самом 2D-плане)
    expect(state.floorPlan.slabs?.length).toBe(1)
    // а вот верхнеуровневый levels — НЕ должен превратиться в [] только
    // из-за того, что нет активного проекта. Раньше (до защитного фикса)
    // именно это и происходило: `levels: activeProject?.levels ?? []`
    // подставляло пустой массив, что ломало и 3D (пусто), и панель
    // этажей в FloorPlan.tsx (видна только кнопка "+ этаж", остальные
    // кнопки скрыты по условию `activeLevelId &&`).
    expect(state.levels).toBe(levelsBefore)
  })
})
