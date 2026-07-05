import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Регресс-тест на миграцию levels в onRehydrateStorage (см. useProjectStore.ts).
 *
 * У легаси-проектов (созданных до появления многоэтажности) на диске нет
 * поля levels — оно оборачивается вокруг старого floorPlan при гидратации.
 * Проверяем, что после гидратации store.getState() отдаёт корректный
 * непустой levels, а не потерянный/пустой план.
 *
 * ВАЖНО (05.07.2026): изначально этот тест пытался проверить, что ПОДПИСЧИК
 * стора (не просто getState()) уведомляется о смигрированных данных — по
 * гипотезе, что прямая мутация state в onRehydrateStorage (без вызова
 * setState) не будит React. Эмпирически это не удалось ни подтвердить,
 * ни опровергнуть: с реальным (синхронным) localStorage вся цепочка
 * гидратации в zustand persist выполняется ПОЛНОСТЬЮ СИНХРОННО в момент
 * импорта модуля — она успевает завершиться до того, как тестовый код
 * вообще успевает подписаться. Это, вероятно, верно и в браузере (модуль
 * стора импортируется до первого рендера React, а первый рендер читает
 * getState() напрямую, не через подписку) — то есть исходная гипотеза
 * про "React не узнает" может быть НЕ настоящей причиной бага с пустой
 * шапкой этажей у пользователя. Явный setState() после миграции оставлен
 * в коде как защитная мера (не вредит), но настоящая причина уже
 * репортнутого пользователем бага требует дополнительной диагностики
 * (см. TASKS.md / KONSPEKT.md) — не считать эту миграцию единственным
 * подозреваемым, пока не получены реальные данные из localStorage
 * пользователя.
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('useProjectStore — гидратация легаси-проекта (без levels)', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('после гидратации getState() отдаёт непустой levels и сохранённый floorPlan', async () => {
    const legacyProject = {
      id: 'p1',
      name: 'Легаси проект',
      walls: [],
      linings: [],
      floorPlan: {
        scaleMmPerPx: 5,
        lines: [{ id: 'l1', x1: 0, y1: 0, x2: 1000, y2: 0, type: 'wall_existing', lengthMm: 1000, label: 'С-1' }],
        contours: [],
        rooms: [],
      },
    }
    ;(globalThis as any).localStorage.setItem('wall-calc-projects', JSON.stringify({
      state: { projects: [legacyProject], activeProjectId: 'p1' },
      version: 0,
    }))

    const { useProjectStore } = await import('../useProjectStore')

    await new Promise<void>((resolve) => {
      if (useProjectStore.persist.hasHydrated()) return resolve()
      useProjectStore.persist.onFinishHydration(() => resolve())
    })

    const finalState = useProjectStore.getState()
    expect(finalState.levels.length).toBeGreaterThan(0)
    expect(finalState.activeLevelId).toBe(finalState.levels[0].id)
    expect(finalState.floorPlan.lines.length).toBe(1)
    expect(finalState.floorPlan.lines[0].id).toBe('l1')
  })
})
