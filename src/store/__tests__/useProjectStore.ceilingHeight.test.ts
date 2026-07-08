import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * 08.07.2026 — "Отметка изменить высоту потолка": постоянно видимый
 * контрол вместо потерянного внизу поля на панели рисования (см. бэклог
 * идей пользователя, KONSPEKT.md). Плюс реальный запрос пользователя:
 * "нужно сделать так, чтобы в уже созданном объекте можно было пересчитать
 * высоту на актуальную" — applyHeightToAllConstructions.
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('useProjectStore — высота потолка (defaultHeightMm / applyHeightToAllConstructions)', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('новый проект создаётся с defaultHeightMm 3000 (обратная совместимость с старым хардкодом)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    expect(useProjectStore.getState().floorPlan.defaultHeightMm).toBe(3000)
  })

  it('setFloorPlanDefaultHeight меняет только "высоту по умолчанию", не трогая уже нарисованные стены', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    useProjectStore.getState().addPlanLine({
      type: 'wall_existing', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, label: 'С-1', heightMm: 3000,
    } as any)

    useProjectStore.getState().setFloorPlanDefaultHeight(2700)

    const state = useProjectStore.getState()
    expect(state.floorPlan.defaultHeightMm).toBe(2700)
    expect(state.floorPlan.lines[0].heightMm).toBe(3000) // уже нарисованная стена не изменилась
  })

  it('applyHeightToAllConstructions пересчитывает heightMm у ВСЕХ уже нарисованных стен', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    useProjectStore.getState().addPlanLine({
      type: 'wall_existing', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, label: 'С-1', heightMm: 3000,
    } as any)
    useProjectStore.getState().addPlanLine({
      type: 'wall_new', x1: 0, y1: 0, x2: 500, y2: 0, lengthMm: 500, label: 'С-2', heightMm: 2500,
    } as any)

    useProjectStore.getState().applyHeightToAllConstructions(2650)

    const state = useProjectStore.getState()
    expect(state.floorPlan.lines.every(l => l.heightMm === 2650)).toBe(true)
    expect(state.floorPlan.defaultHeightMm).toBe(2650) // заодно и дефолт для новых стен обновляется
  })

  it('applyHeightToAllConstructions пересчитывает и freeform-обводки (произвольные стены/колонны)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    useProjectStore.getState().addFreeformStructure({
      kind: 'wall',
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      heightMm: 3000,
      label: 'Обводка 1',
    } as any)

    useProjectStore.getState().applyHeightToAllConstructions(2400)

    const fs = useProjectStore.getState().floorPlan.freeformStructures[0]
    expect(fs.heightMm).toBe(2400)
  })

  it('applyHeightToAllConstructions на пустом плане (без стен) просто обновляет defaultHeightMm, не падает', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    expect(() => useProjectStore.getState().applyHeightToAllConstructions(2800)).not.toThrow()
    expect(useProjectStore.getState().floorPlan.defaultHeightMm).toBe(2800)
    expect(useProjectStore.getState().floorPlan.lines).toEqual([])
  })

  it('applyHeightToAllConstructions затрагивает только активный этаж, не другие этажи объекта', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    useProjectStore.getState().addPlanLine({
      type: 'wall_existing', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, label: 'Этаж1-С1', heightMm: 3000,
    } as any)
    const level2Id = useProjectStore.getState().addLevel('Этаж 2', 3000)
    useProjectStore.getState().addPlanLine({
      type: 'wall_existing', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, label: 'Этаж2-С1', heightMm: 3000,
    } as any)

    useProjectStore.getState().applyHeightToAllConstructions(2500)

    const state = useProjectStore.getState()
    const level2 = state.levels.find(lv => lv.id === level2Id)!
    expect(level2.floorPlan.lines[0].heightMm).toBe(2500) // активный этаж (второй) пересчитан
    const level1 = state.levels.find(lv => lv.id !== level2Id)!
    expect(level1.floorPlan.lines[0].heightMm).toBe(3000) // первый этаж не тронут
  })
})
