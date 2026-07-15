import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Undo/Redo для плана активного этажа (14.07.2026).
 *
 * Повод: пользователь на реальном объекте случайно поставил проём шириной
 * 800мм вместо 900 — единственным способом исправить было полностью
 * удалить перегородку и начертить заново. Нужна возможность откатить одно
 * последнее действие (Undo) и, если откатили лишнее, вернуть его обратно
 * (Redo).
 *
 * Ключевой механизм, который проверяем отдельно: соседние по времени
 * изменения (посимвольный ввод в поле, перетаскивание мышью — десятки
 * updatePlanLine подряд) должны схлопываться в ОДИН чекпоинт истории
 * (см. UNDO_COALESCE_MS в useProjectStore.ts), иначе Undo пришлось бы жать
 * по разу на каждое промежуточное состояние.
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('useProjectStore — undo/redo плана активного этажа', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('undo() откатывает последнее действие (изменение ширины проёма 800 → 900 → undo)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    const lineId = useProjectStore.getState().addPlanLine({
      type: 'wall_existing', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, label: 'С-1',
    } as any)

    vi.advanceTimersByTime(1000) // выходим за окно склейки — следующее действие отдельный чекпоинт
    useProjectStore.getState().updatePlanLine(lineId, {
      openings: [{ id: 'op1', offsetMm: 100, widthMm: 800 } as any],
    })

    vi.advanceTimersByTime(1000)
    useProjectStore.getState().updatePlanLine(lineId, {
      openings: [{ id: 'op1', offsetMm: 100, widthMm: 900 } as any],
    })

    expect(useProjectStore.getState().floorPlan.lines[0].openings?.[0].widthMm).toBe(900)

    useProjectStore.getState().undo()

    // Откатились к состоянию ДО правки на 900 — то есть обратно на 800,
    // а не полностью потеряли проём.
    expect(useProjectStore.getState().floorPlan.lines[0].openings?.[0].widthMm).toBe(800)
  })

  it('redo() возвращает отменённое действие обратно', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().addPlanLine({
      type: 'wall_existing', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, label: 'С-1',
    } as any)

    vi.advanceTimersByTime(1000)
    useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])

    expect(useProjectStore.getState().floorPlan.slabs?.length).toBe(1)
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().floorPlan.slabs?.length).toBe(0)
    useProjectStore.getState().redo()
    expect(useProjectStore.getState().floorPlan.slabs?.length).toBe(1)
  })

  it('undo() на пустой истории ничего не ломает (нет действий — нет отмены)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const before = useProjectStore.getState().floorPlan
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().floorPlan).toBe(before)
  })

  it('redo() на пустом стеке повтора ничего не ломает', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    const state = useProjectStore.getState().floorPlan
    useProjectStore.getState().redo() // стек повтора пуст — редо ничего не делает
    expect(useProjectStore.getState().floorPlan).toBe(state)
  })

  it('новое действие после undo стирает стек повтора (стандартное поведение Undo/Redo)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    vi.advanceTimersByTime(1000)
    useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }])

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().redoStack.length).toBe(1)

    vi.advanceTimersByTime(1000)
    useProjectStore.getState().addCeiling([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }])

    expect(useProjectStore.getState().redoStack.length).toBe(0)
  })

  it('быстрые последовательные правки (посимвольный ввод/перетаскивание) схлопываются в ОДИН чекпоинт undo', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    const lineId = useProjectStore.getState().addPlanLine({
      type: 'wall_existing', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, label: 'С-1',
    } as any)
    vi.advanceTimersByTime(1000) // отдельный чекпоинт для самой линии

    // Имитация быстрого посимвольного ввода "900" без задержек между
    // символами — должно схлопнуться в одно движение истории.
    useProjectStore.getState().updatePlanLine(lineId, { heightMm: 9 })
    useProjectStore.getState().updatePlanLine(lineId, { heightMm: 90 })
    useProjectStore.getState().updatePlanLine(lineId, { heightMm: 900 })

    const undoStackLenAfterBurst = useProjectStore.getState().undoStack.length

    useProjectStore.getState().undo()
    // Один Undo должен откатить всю серию целиком — обратно к состоянию
    // ДО начала ввода (heightMm ещё не выставлен), а не на "90" или "9".
    expect(useProjectStore.getState().floorPlan.lines[0].heightMm).toBeUndefined()
    expect(undoStackLenAfterBurst).toBeGreaterThan(0)
  })

  it('переключение на другой этаж сбрасывает историю undo/redo (история чужого плана не должна применяться)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    expect(useProjectStore.getState().undoStack.length).toBeGreaterThan(0)

    const newLevelId = useProjectStore.getState().addLevel('Этаж 2', 3000)
    useProjectStore.getState().selectLevel(newLevelId)

    expect(useProjectStore.getState().undoStack.length).toBe(0)
    expect(useProjectStore.getState().redoStack.length).toBe(0)
  })

  it('история не сохраняется в localStorage (undoStack/redoStack не входят в partialize)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])

    const raw = (globalThis as any).localStorage.getItem('wall-calc-projects')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed.state.undoStack).toBeUndefined()
    expect(parsed.state.redoStack).toBeUndefined()
  })
})
