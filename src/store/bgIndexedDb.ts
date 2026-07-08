/**
 * IndexedDB-хранилище для тяжёлых данных подложек (PDF-страница как base64
 * dataUrl). localStorage/zustand-persist хранит только лёгкие поля подложки
 * (x/y/width/height/opacity/locked) — см. stripHeavyDataForPersist в
 * useProjectStore.ts. Сама картинка живёт здесь: лимит на порядки больше
 * localStorage (обычно сотни МБ и выше вместо ~5-10 МБ на весь сайт),
 * переживает перезагрузку страницы, работает офлайн.
 *
 * 08.07.2026 — реальный фикс на баг "подложка пропадает после перезагрузки"
 * (см. TASKS.md). До этого фикса dataUrl нарочно вырезался перед записью на
 * диск и нигде больше не сохранялся — это гасило зависания из-за
 * переполнения localStorage (см. safeLocalStorage), но ценой того, что саму
 * картинку приходилось грузить заново после каждой перезагрузки. Теперь
 * dataUrl уходит сюда при каждой записи подложки, а после перезагрузки —
 * подтягивается обратно (см. ensureBackgroundsLoaded в useProjectStore.ts).
 *
 * Все функции безопасны к отсутствию IndexedDB (SSR/тесты/старый браузер) —
 * молча ничего не делают вместо падения.
 */

const DB_NAME = 'wall-calc-backgrounds'
const STORE_NAME = 'backgrounds'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return }
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      console.error('[wall-calc] IndexedDB.open упал:', e)
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { console.error('[wall-calc] IndexedDB open упал:', req.error); resolve(null) }
  })
}

/** Ключ подложки: одна запись на (проект, этаж, дисциплина). */
export function backgroundStorageKey(
  projectId: string, levelId: string, discipline: 'architecture' | 'ventilation' | 'electrical',
): string {
  return `${projectId}:${levelId}:${discipline}`
}

export async function idbSetBackground(key: string, dataUrl: string): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(dataUrl, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.error('[wall-calc] IndexedDB: не удалось сохранить подложку:', e)
  }
}

export async function idbGetBackground(key: string): Promise<string | undefined> {
  try {
    const db = await openDb()
    if (!db) return undefined
    return await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(key)
      req.onsuccess = () => resolve(req.result as string | undefined)
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.error('[wall-calc] IndexedDB: не удалось прочитать подложку:', e)
    return undefined
  }
}

export async function idbDeleteBackground(key: string): Promise<void> {
  try {
    const db = await openDb()
    if (!db) return
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.error('[wall-calc] IndexedDB: не удалось удалить подложку:', e)
  }
}
