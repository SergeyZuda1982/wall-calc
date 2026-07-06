import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Регресс-тест на КРИТИЧНЫЙ баг от 05.07.2026: safeLocalStorage.setItem
 * безусловно звал setState({saveError: null}) при КАЖДОМ успешном
 * сохранении. Zustand persist подписывается на ВЕСЬ стор, чтобы
 * автосохранять на каждое изменение — значит любой setState() сам
 * порождает новую попытку сохранения → новый вызов setItem → снова
 * успех → снова setState → бесконечный синхронный цикл. На проде это
 * вешало вкладку намертво (100% CPU, требовался принудительный выход)
 * даже на ПУСТЫХ проектах без единого файла — воспроизводилось при
 * любом действии, меняющем стор (включая создание/выбор объекта).
 *
 * Тест проверяет напрямую: два успешных вызова setItem подряд НЕ должны
 * порождать больше одного уведомления подписчиков стора (а если
 * saveError уже null — то вообще ни одного).
 */

class FakeStorage {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
}

describe('safeLocalStorage.setItem — не должен зацикливать setState на успехе', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = new FakeStorage()
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
    delete (globalThis as any).window
  })

  it('успешный setItem, когда saveError уже null — НИ ОДНОГО уведомления подписчиков', async () => {
    const { useProjectStore, safeLocalStorage } = await import('../useProjectStore')

    await new Promise<void>((resolve) => {
      if (useProjectStore.persist.hasHydrated()) return resolve()
      useProjectStore.persist.onFinishHydration(() => resolve())
    })

    expect(useProjectStore.getState().saveError).toBeNull()

    let notifyCount = 0
    const unsub = useProjectStore.subscribe(() => { notifyCount++ })

    safeLocalStorage.setItem('some-key', '{"a":1}')
    safeLocalStorage.setItem('some-key', '{"a":2}')
    safeLocalStorage.setItem('some-key', '{"a":3}')

    unsub()
    expect(notifyCount).toBe(0)
  })

  it('после перехода из ошибки в успех дальнейшие сохранения не шлют новых уведомлений (нет цикла)', async () => {
    const { useProjectStore, safeLocalStorage } = await import('../useProjectStore')

    await new Promise<void>((resolve) => {
      if (useProjectStore.persist.hasHydrated()) return resolve()
      useProjectStore.persist.onFinishHydration(() => resolve())
    })

    // Симулируем состояние "была ошибка сохранения". Этот вызов сам может
    // спровоцировать автосохранение persist (он подписан на весь стор),
    // которое, если бы код был багованным, тоже могло бы зациклиться —
    // поэтому даём этой цепочке полностью устояться ДО подписки счётчика.
    useProjectStore.setState({ saveError: 'какая-то прошлая ошибка' })
    expect(useProjectStore.getState().saveError).toBeNull() // уже должно было само схлопнуться в null

    let notifyCount = 0
    const unsub = useProjectStore.subscribe(() => { notifyCount++ })

    // Теперь saveError точно null и устоялся — дальнейшие успешные
    // сохранения НЕ должны слать вообще никаких уведомлений.
    safeLocalStorage.setItem('some-key', '{"a":1}')
    safeLocalStorage.setItem('some-key', '{"a":2}')
    safeLocalStorage.setItem('some-key', '{"a":3}')

    unsub()
    expect(notifyCount).toBe(0)
  })
})
