import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Регресс-тест на фичу 27.09.2026 (по решению Сергея — вставка лестницы в
 * вырез плиты не должна автоматически класть её в этаж N-1: сам вырез в
 * плите не обязательно вообще лестница — шахта лифта/вентиляция/
 * дымоудаление тоже проёмы, и этаж-получатель спрашивается явно у
 * пользователя, см. диалог того же дня). addStaircaseToLevel — в отличие
 * от addStaircase (всегда пишет в АКТИВНЫЙ этаж) — должна уметь писать в
 * ЛЮБОЙ указанный этаж, включая НЕ активный, и не портить при этом
 * undo-историю активного этажа (она рассчитана только на правки самого
 * активного плана).
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('useProjectStore.addStaircaseToLevel', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('добавляет лестницу в УКАЗАННЫЙ этаж, а не в активный', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const level1Id = useProjectStore.getState().activeLevelId!
    const level2Id = useProjectStore.getState().addLevel('Этаж 2', 3000)
    // Активный этаж сейчас — Этаж 2 (addLevel переключает на новый), вставляем
    // лестницу явно в Этаж 1 (level1Id), НЕ в активный.
    expect(useProjectStore.getState().activeLevelId).toBe(level2Id)

    const stId = useProjectStore.getState().addStaircaseToLevel(level1Id, {
      kind: 'spiral', cx: 0, cy: 0, innerRadiusMm: 0, outerRadiusMm: 1500,
      startAngleRad: 0, totalAngleRad: Math.PI * 2, targetRiserMm: 170, treadThicknessMm: 30,
      label: 'Тест',
    })

    const project = useProjectStore.getState().projects.find(
      p => p.id === useProjectStore.getState().activeProjectId
    )!
    const level1 = project.levels.find(lv => lv.id === level1Id)!
    const level2 = project.levels.find(lv => lv.id === level2Id)!
    expect(level1.floorPlan.staircases?.some(st => st.id === stId)).toBe(true)
    expect(level2.floorPlan.staircases ?? []).toHaveLength(0)
    // activeLevelId не менялся — сама функция не переключает этаж (это
    // делает UI отдельно, если нужно показать результат пользователю).
    expect(useProjectStore.getState().activeLevelId).toBe(level2Id)
  })

  it('не сбрасывает undo-стек активного (другого) этажа', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const level1Id = useProjectStore.getState().activeLevelId!
    useProjectStore.getState().addLevel('Этаж 2', 3000)
    // Правка активного (Этаж 2) плана — кладём что-то в его undo-стек.
    useProjectStore.getState().addLevel('Этаж 3', 6000)
    const undoBefore = useProjectStore.getState().undoStack.length
    expect(undoBefore).toBeGreaterThanOrEqual(0)

    useProjectStore.getState().addStaircaseToLevel(level1Id, {
      kind: 'spiral', cx: 0, cy: 0, innerRadiusMm: 0, outerRadiusMm: 1500,
      startAngleRad: 0, totalAngleRad: Math.PI * 2, targetRiserMm: 170, treadThicknessMm: 30,
      label: 'Тест',
    })

    expect(useProjectStore.getState().undoStack.length).toBe(undoBefore)
  })

  it('если указанный этаж — активный, floorPlan в сторе тоже сразу обновляется', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const activeId = useProjectStore.getState().activeLevelId!

    const stId = useProjectStore.getState().addStaircaseToLevel(activeId, {
      kind: 'spiral', cx: 0, cy: 0, innerRadiusMm: 0, outerRadiusMm: 1500,
      startAngleRad: 0, totalAngleRad: Math.PI * 2, targetRiserMm: 170, treadThicknessMm: 30,
      label: 'Тест',
    })

    expect(useProjectStore.getState().floorPlan?.staircases?.some(st => st.id === stId)).toBe(true)
  })
})
