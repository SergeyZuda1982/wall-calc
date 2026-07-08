import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { idbSetBackground, idbGetBackground, idbDeleteBackground, backgroundStorageKey } from '../bgIndexedDb'

/**
 * 08.07.2026 — реальный фикс на баг "подложка PDF пропадает после
 * перезагрузки страницы" (см. TASKS.md). fake-indexeddb/auto подставляет
 * рабочую реализацию IndexedDB в тестовое окружение (в проде это настоящий
 * indexedDB браузера) — проверяем реальный roundtrip записи/чтения/удаления,
 * а не просто "не падает".
 */

describe('bgIndexedDb', () => {
  beforeEach(() => {
    // fake-indexeddb не чистит БД между тестами сама — свежая БД на тест
    // через уникальные ключи ниже (проще, чем удалять всю БД).
  })

  it('backgroundStorageKey — разные (проект, этаж, дисциплина) дают разные ключи', () => {
    const k1 = backgroundStorageKey('p1', 'lv1', 'architecture')
    const k2 = backgroundStorageKey('p1', 'lv1', 'ventilation')
    const k3 = backgroundStorageKey('p1', 'lv2', 'architecture')
    const k4 = backgroundStorageKey('p2', 'lv1', 'architecture')
    expect(new Set([k1, k2, k3, k4]).size).toBe(4)
  })

  it('записывает и читает dataUrl обратно (roundtrip)', async () => {
    const key = backgroundStorageKey('proj-a', 'lvl-a', 'architecture')
    await idbSetBackground(key, 'data:image/png;base64,AAABBB')
    const got = await idbGetBackground(key)
    expect(got).toBe('data:image/png;base64,AAABBB')
  })

  it('чтение отсутствующего ключа возвращает undefined, не падает', async () => {
    const got = await idbGetBackground('несуществующий-ключ-xyz')
    expect(got).toBeUndefined()
  })

  it('повторная запись по тому же ключу перезаписывает значение', async () => {
    const key = backgroundStorageKey('proj-b', 'lvl-b', 'ventilation')
    await idbSetBackground(key, 'data:old')
    await idbSetBackground(key, 'data:new')
    const got = await idbGetBackground(key)
    expect(got).toBe('data:new')
  })

  it('idbDeleteBackground удаляет запись — последующее чтение даёт undefined', async () => {
    const key = backgroundStorageKey('proj-c', 'lvl-c', 'electrical')
    await idbSetBackground(key, 'data:to-delete')
    expect(await idbGetBackground(key)).toBe('data:to-delete')
    await idbDeleteBackground(key)
    expect(await idbGetBackground(key)).toBeUndefined()
  })

  it('разные дисциплины одного этажа хранятся независимо', async () => {
    const kArch = backgroundStorageKey('proj-d', 'lvl-d', 'architecture')
    const kVent = backgroundStorageKey('proj-d', 'lvl-d', 'ventilation')
    const kElec = backgroundStorageKey('proj-d', 'lvl-d', 'electrical')
    await idbSetBackground(kArch, 'data:arch')
    await idbSetBackground(kVent, 'data:vent')
    await idbSetBackground(kElec, 'data:elec')

    expect(await idbGetBackground(kArch)).toBe('data:arch')
    expect(await idbGetBackground(kVent)).toBe('data:vent')
    expect(await idbGetBackground(kElec)).toBe('data:elec')

    await idbDeleteBackground(kVent)
    // удаление вентиляции не задевает архитектуру и электрику
    expect(await idbGetBackground(kArch)).toBe('data:arch')
    expect(await idbGetBackground(kVent)).toBeUndefined()
    expect(await idbGetBackground(kElec)).toBe('data:elec')
  })

  it('idbDeleteBackground на несуществующем ключе не падает', async () => {
    await expect(idbDeleteBackground('никогда-не-существовавший-ключ')).resolves.toBeUndefined()
  })
})
