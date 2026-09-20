import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { CeilingSpec } from '../../data/ceilingData'

/**
 * П19 этап 3 (18.09.2026, см. переписку/TASKS.md) — store-действия
 * конструктора композиции (уровни+борта). Архитектура: композиция сама
 * НЕ хранит геометрию/параметры, только levelIds/borderIds на обычные
 * Ceiling/CeilingBorder — см. types/index.ts CeilingComposition.
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

const SPEC: CeilingSpec = { type: 'p112', layers: 1, material: 'gsp', thickness: 12.5, stepC: 600, areaSqm: 10, perimeterM: 14 }

describe('useProjectStore — CeilingComposition (П19, этап 3)', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('addCeilingComposition создаёт пустую композицию (без уровней/бортов)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    const id = useProjectStore.getState().addCeilingComposition('Кинотеатр Ростов')

    const comp = useProjectStore.getState().floorPlan.ceilingCompositions?.find(c => c.id === id)
    expect(comp).toBeDefined()
    expect(comp!.label).toBe('Кинотеатр Ростов')
    expect(comp!.levelIds).toEqual([])
    expect(comp!.borderIds).toEqual([])
  })

  it('addCeilingComposition без label подставляет автогенерированное имя', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    const id = useProjectStore.getState().addCeilingComposition()

    const comp = useProjectStore.getState().floorPlan.ceilingCompositions?.find(c => c.id === id)
    expect(comp!.label.length).toBeGreaterThan(0)
  })

  it('addCompositionLevel создаёт обычный Ceiling (outer пуст, slope=elevationMm) и линкует id в композицию', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const compId = useProjectStore.getState().addCeilingComposition()

    const levelId = useProjectStore.getState().addCompositionLevel(compId, SPEC, 3300, 'Ступень 1 (+3.300)')

    const state = useProjectStore.getState()
    const comp = state.floorPlan.ceilingCompositions!.find(c => c.id === compId)!
    expect(comp.levelIds).toEqual([levelId])

    const level = state.floorPlan.ceilings.find(cl => cl.id === levelId)!
    expect(level).toBeDefined()
    expect(level.label).toBe('Ступень 1 (+3.300)')
    expect(level.outer).toEqual([]) // геометрия на плане — этап 4, ещё не задана
    expect(level.ceilingSpec).toEqual(SPEC)
    expect(level.slope?.height1Mm).toBe(3300)
    expect(level.slope?.height2Mm).toBe(3300) // высота, не уклон — height1===height2
  })

  it('несколько addCompositionLevel сохраняют порядок levelIds "снизу вверх" (по порядку добавления)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const compId = useProjectStore.getState().addCeilingComposition()

    const id1 = useProjectStore.getState().addCompositionLevel(compId, SPEC, 3300, 'Ступень 1')
    const id2 = useProjectStore.getState().addCompositionLevel(compId, SPEC, 3500, 'Ступень 2')
    const id3 = useProjectStore.getState().addCompositionLevel(compId, SPEC, 3750, 'Ступень 3')

    const comp = useProjectStore.getState().floorPlan.ceilingCompositions!.find(c => c.id === compId)!
    expect(comp.levelIds).toEqual([id1, id2, id3])
  })

  it('addCompositionBorder создаёт CeilingBorder (path пуст) и линкует id в композицию', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const compId = useProjectStore.getState().addCeilingComposition()

    const borderId = useProjectStore.getState().addCompositionBorder(compId, {
      jointType: 'p112_p113_angle_connector', dropMm: 250, shelfDepthMm: 125, stepCMm: 600, sheetLengthMm: 2500,
    }, 'Борт 1→2')

    const state = useProjectStore.getState()
    const comp = state.floorPlan.ceilingCompositions!.find(c => c.id === compId)!
    expect(comp.borderIds).toEqual([borderId])

    const border = state.floorPlan.ceilingBorders!.find(b => b.id === borderId)!
    expect(border).toBeDefined()
    expect(border.label).toBe('Борт 1→2')
    expect(border.path).toEqual([]) // путь на плане — этап 4
    expect(border.dropMm).toBe(250)
    expect(border.shelfDepthMm).toBe(125)
  })

  it('removeCompositionLevel убирает уровень из ceilings И из levelIds композиции', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const compId = useProjectStore.getState().addCeilingComposition()
    const levelId = useProjectStore.getState().addCompositionLevel(compId, SPEC, 3300)

    useProjectStore.getState().removeCompositionLevel(compId, levelId)

    const state = useProjectStore.getState()
    expect(state.floorPlan.ceilings.find(cl => cl.id === levelId)).toBeUndefined()
    expect(state.floorPlan.ceilingCompositions!.find(c => c.id === compId)!.levelIds).toEqual([])
  })

  it('removeCompositionBorder убирает борт из ceilingBorders И из borderIds композиции', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const compId = useProjectStore.getState().addCeilingComposition()
    const borderId = useProjectStore.getState().addCompositionBorder(compId, {
      jointType: 'p112_p113_angle_connector', dropMm: 250, shelfDepthMm: 125, stepCMm: 600, sheetLengthMm: 2500,
    })

    useProjectStore.getState().removeCompositionBorder(compId, borderId)

    const state = useProjectStore.getState()
    expect(state.floorPlan.ceilingBorders!.find(b => b.id === borderId)).toBeUndefined()
    expect(state.floorPlan.ceilingCompositions!.find(c => c.id === compId)!.borderIds).toEqual([])
  })

  it('removeCeilingComposition удаляет композицию каскадно — ВСЕ её уровни и борта тоже исчезают', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const compId = useProjectStore.getState().addCeilingComposition()
    const level1 = useProjectStore.getState().addCompositionLevel(compId, SPEC, 3300)
    const level2 = useProjectStore.getState().addCompositionLevel(compId, SPEC, 3500)
    const border1 = useProjectStore.getState().addCompositionBorder(compId, {
      jointType: 'p112_p113_angle_connector', dropMm: 250, shelfDepthMm: 125, stepCMm: 600, sheetLengthMm: 2500,
    })

    useProjectStore.getState().removeCeilingComposition(compId)

    const state = useProjectStore.getState()
    expect(state.floorPlan.ceilingCompositions!.find(c => c.id === compId)).toBeUndefined()
    expect(state.floorPlan.ceilings.find(cl => cl.id === level1)).toBeUndefined()
    expect(state.floorPlan.ceilings.find(cl => cl.id === level2)).toBeUndefined()
    expect(state.floorPlan.ceilingBorders!.find(b => b.id === border1)).toBeUndefined()
  })

  it('removeCeilingComposition НЕ трогает уровни/борта другой композиции', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const comp1 = useProjectStore.getState().addCeilingComposition('Композиция 1')
    const comp2 = useProjectStore.getState().addCeilingComposition('Композиция 2')
    useProjectStore.getState().addCompositionLevel(comp1, SPEC, 3300)
    const level2 = useProjectStore.getState().addCompositionLevel(comp2, SPEC, 3500)

    useProjectStore.getState().removeCeilingComposition(comp1)

    const state = useProjectStore.getState()
    expect(state.floorPlan.ceilingCompositions!.find(c => c.id === comp2)).toBeDefined()
    expect(state.floorPlan.ceilings.find(cl => cl.id === level2)).toBeDefined()
  })

  it('updateCeilingComposition меняет label, не трогая levelIds/borderIds', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')
    const compId = useProjectStore.getState().addCeilingComposition('Старое имя')
    const levelId = useProjectStore.getState().addCompositionLevel(compId, SPEC, 3300)

    useProjectStore.getState().updateCeilingComposition(compId, { label: 'Новое имя' })

    const comp = useProjectStore.getState().floorPlan.ceilingCompositions!.find(c => c.id === compId)!
    expect(comp.label).toBe('Новое имя')
    expect(comp.levelIds).toEqual([levelId])
  })
})
