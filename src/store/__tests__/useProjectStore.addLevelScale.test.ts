import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Регресс-тест на фичу (запрошена пользователем 20.09.2026): "+ этаж"
 * должен подхватывать масштаб уже откалиброванного плана активного этажа,
 * чтобы не перекалибровывать масштаб заново на каждом новом этаже —
 * UI (FloorPlan.tsx) передаёт floorPlan?.scaleMmPerPx активного этажа
 * третьим (опциональным) аргументом в addLevel.
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('useProjectStore.addLevel — наследование масштаба', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('без третьего аргумента новый этаж получает масштаб по умолчанию (как раньше)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const newId = useProjectStore.getState().addLevel('Этаж 2', 3000)
    const project = useProjectStore.getState().projects.find(
      p => p.id === useProjectStore.getState().activeProjectId
    )!
    const level = project.levels.find(lv => lv.id === newId)!
    expect(level.floorPlan.scaleMmPerPx).toBe(10)
  })

  it('с переданным масштабом новый этаж наследует его от активного (уже откалиброванного) этажа', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const newId = useProjectStore.getState().addLevel('Этаж 2', 3000, 4.37)
    const project = useProjectStore.getState().projects.find(
      p => p.id === useProjectStore.getState().activeProjectId
    )!
    const level = project.levels.find(lv => lv.id === newId)!
    expect(level.floorPlan.scaleMmPerPx).toBe(4.37)
  })
})
