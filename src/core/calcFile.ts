/**
 * calcFile.ts — сохранение/загрузка расчёта в файл .json (вкладки «Разметка дуги», «Контур потолка»).
 * Файл — обёртка { app, kind, version, savedAt, data }. Содержимое data проверяют сами вкладки.
 */

export type CalcKind = 'arc' | 'contour'
export const FILE_APP = 'wall-calc'

export function wrapCalcFile(kind: CalcKind, data: unknown, now: Date = new Date()): string {
  return JSON.stringify({ app: FILE_APP, kind, version: 1, savedAt: now.toISOString(), data }, null, 2)
}

/** Разбор текста файла. Бросает Error с понятным сообщением, если файл чужой или битый. */
export function parseCalcFile(text: string, kind: CalcKind): unknown {
  let d: unknown
  try { d = JSON.parse(text) } catch { throw new Error('Файл не читается: это не JSON') }
  const o = d as { app?: unknown; kind?: unknown; data?: unknown }
  if (!o || typeof o !== 'object' || o.app !== FILE_APP) throw new Error('Это не файл расчёта wall-calc')
  if (o.kind !== kind) {
    throw new Error(o.kind === 'arc' ? 'Это файл «Разметки дуги», откройте его на той вкладке'
      : o.kind === 'contour' ? 'Это файл «Контура потолка», откройте его на той вкладке' : 'Неизвестный тип файла')
  }
  if (!o.data || typeof o.data !== 'object') throw new Error('В файле нет данных расчёта')
  return o.data
}

export function calcFileName(kind: CalcKind, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  return `${kind === 'arc' ? 'duga' : 'kontur'}-${day}.json`
}

const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def)
export const pickNum = num
export function pickOneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return allowed.includes(v as T) ? (v as T) : def
}
