import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'

/**
 * 08.07.2026 — тест на сам репортнутый пользователем баг: "перезагрузил
 * страницу — подложка PDF исчезла, надо грузить заново". Раньше dataUrl
 * нигде не сохранялся, кроме памяти текущей сессии (см.
 * stripHeavyDataForPersist). Теперь dataUrl уходит в IndexedDB при каждой
 * записи подложки (setBackgroundImage/setMepBackground) и подтягивается
 * обратно через ensureBackgroundsLoaded — этот тест эмулирует именно
 * перезагрузку: dataUrl в live-состоянии стирается (как после гидратации
 * из localStorage), затем вызывается ensureBackgroundsLoaded и проверяется,
 * что dataUrl вернулся.
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('useProjectStore — восстановление подложек из IndexedDB после "перезагрузки"', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('setBackgroundImage → имитация перезагрузки (dataUrl стёрт) → ensureBackgroundsLoaded возвращает картинку', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().setBackgroundImage({
      dataUrl: 'data:image/png;base64,ARCH_ORIGINAL',
      x: 0, y: 0, width: 1000, height: 800, opacity: 0.6, locked: true,
    })

    // IndexedDB-запись асинхронная (fire-and-forget внутри setBackgroundImage) —
    // даём микрозадачам отработать перед тем, как имитировать перезагрузку.
    await new Promise(r => setTimeout(r, 0))

    // Имитация того, что делает stripHeavyDataForPersist сразу после
    // гидратации из localStorage: dataUrl стёрт, остальные поля на месте.
    const pid = useProjectStore.getState().activeProjectId!
    useProjectStore.setState(s => ({
      projects: s.projects.map(p => p.id !== pid ? p : ({
        ...p,
        levels: p.levels.map(lv => ({
          ...lv,
          floorPlan: { ...lv.floorPlan, backgroundImage: { ...lv.floorPlan.backgroundImage!, dataUrl: '' } },
        })),
      })),
      floorPlan: { ...s.floorPlan, backgroundImage: { ...s.floorPlan.backgroundImage!, dataUrl: '' } },
    }))
    expect(useProjectStore.getState().floorPlan.backgroundImage?.dataUrl).toBe('')

    await useProjectStore.getState().ensureBackgroundsLoaded()

    expect(useProjectStore.getState().floorPlan.backgroundImage?.dataUrl).toBe('data:image/png;base64,ARCH_ORIGINAL')
    // остальные поля (позиционирование/масштаб подложки) не пострадали
    expect(useProjectStore.getState().floorPlan.backgroundImage?.width).toBe(1000)
  })

  it('то же самое для подложки инженерной дисциплины (вентиляция)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().setMepBackground('ventilation', {
      dataUrl: 'data:image/png;base64,VENT_ORIGINAL',
      x: 0, y: 0, width: 500, height: 500, opacity: 0.6, locked: true,
    })
    await new Promise(r => setTimeout(r, 0))

    const pid = useProjectStore.getState().activeProjectId!
    useProjectStore.setState(s => ({
      projects: s.projects.map(p => p.id !== pid ? p : ({
        ...p,
        levels: p.levels.map(lv => ({
          ...lv,
          floorPlan: {
            ...lv.floorPlan,
            mepBackgrounds: { ...lv.floorPlan.mepBackgrounds, ventilation: { ...lv.floorPlan.mepBackgrounds.ventilation!, dataUrl: '' } },
          },
        })),
      })),
      floorPlan: {
        ...s.floorPlan,
        mepBackgrounds: { ...s.floorPlan.mepBackgrounds, ventilation: { ...s.floorPlan.mepBackgrounds.ventilation!, dataUrl: '' } },
      },
    }))
    expect(useProjectStore.getState().floorPlan.mepBackgrounds.ventilation?.dataUrl).toBe('')

    await useProjectStore.getState().ensureBackgroundsLoaded()

    expect(useProjectStore.getState().floorPlan.mepBackgrounds.ventilation?.dataUrl).toBe('data:image/png;base64,VENT_ORIGINAL')
  })

  it('setBackgroundImage(null) удаляет запись из IndexedDB — ensureBackgroundsLoaded ничего не находит и не падает', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().setBackgroundImage({
      dataUrl: 'data:image/png;base64,TO_BE_DELETED',
      x: 0, y: 0, width: 100, height: 100, opacity: 1, locked: false,
    })
    await new Promise(r => setTimeout(r, 0))
    useProjectStore.getState().setBackgroundImage(null)
    await new Promise(r => setTimeout(r, 0))

    await expect(useProjectStore.getState().ensureBackgroundsLoaded()).resolves.toBeUndefined()
    expect(useProjectStore.getState().floorPlan.backgroundImage).toBeNull()
  })

  it('ensureBackgroundsLoaded — если dataUrl уже на месте, ничего не перезаписывает (не дёргает IndexedDB зря)', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    useProjectStore.getState().createProject('Тест')

    useProjectStore.getState().setBackgroundImage({
      dataUrl: 'data:image/png;base64,ALREADY_HERE',
      x: 0, y: 0, width: 100, height: 100, opacity: 1, locked: false,
    })
    await new Promise(r => setTimeout(r, 0))

    await useProjectStore.getState().ensureBackgroundsLoaded()
    expect(useProjectStore.getState().floorPlan.backgroundImage?.dataUrl).toBe('data:image/png;base64,ALREADY_HERE')
  })

  it('без активного проекта ensureBackgroundsLoaded ничего не делает и не падает', async () => {
    const { useProjectStore } = await import('../useProjectStore')
    await expect(useProjectStore.getState().ensureBackgroundsLoaded()).resolves.toBeUndefined()
  })
})
