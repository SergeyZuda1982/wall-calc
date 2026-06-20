import type { Opening, StudKind, AbutmentType, EdgeProfile } from '../types'
import { studHeightAt } from './profileGeometry'

export const MIN_GAP = 150 // мм

export interface BuildResult {
  positions: number[]
  phase: number
}

// Типизированная стойка из mergeStuds (без orientation/isAbove — это calcResults)
export interface MergedStud {
  pos: number
  kind: StudKind
}

const norm = (x: number, s: number) => ((x % s) + s) % s

// ─── Шаг 1: чистая периодическая сетка ──────────────────────────────────────

function makeGrid(l: number, s: number, ph: number): number[] {
  const grid: number[] = []
  let p = ph
  while (p < l) {
    if (p > 0) grid.push(Math.round(p))
    p += s
  }
  return grid
}

function countConflicts(grid: number[], openingStuds: number[]): number {
  let n = 0
  for (const p of grid) {
    for (const os of openingStuds) {
      if (Math.abs(p - os) <= MIN_GAP) { n++; break }
    }
  }
  return n
}

// ─── Шаг 2: стойки проёмов ───────────────────────────────────────────────────

/**
 * Возвращает типизированные стойки всех проёмов (door/window).
 * Торцевые стойки проёма не зависят от сетки и всегда идут floor-to-ceiling.
 */
export function buildOpeningStuds(openings: Opening[]): MergedStud[] {
  const result: MergedStud[] = []
  for (const o of openings) {
    if (o.width <= 0) continue
    const kind: StudKind = o.type === 'door' ? 'door' : 'window'
    result.push({ pos: o.pos, kind })
    result.push({ pos: o.pos + o.width, kind })
  }
  return result
}

// ─── Шаг 3: объединение сетки и стоек проёмов ───────────────────────────────

/**
 * Объединяет периодическую сетку со стойками проёмов.
 * Проставляет StudKind каждой стойке.
 * Рядовые стойки, совпадающие по позиции со стойкой проёма, поглощаются ею
 * (стойка проёма приоритетнее).
 *
 * ВАЖНО: рядовые стойки НЕ удаляются даже при расстоянии < MIN_GAP —
 * это только предупреждение в UI, решение за монтажником.
 */
export function mergeStuds(
  grid: number[],
  openingStuds: MergedStud[],
  l: number,
  abutment: AbutmentType,
): MergedStud[] {
  const openingPositions = new Set(openingStuds.map(s => s.pos))

  // Крайние стойки
  const leftKind: StudKind  = (abutment === 'both' || abutment === 'left')  ? 'wall' : 'free'
  const rightKind: StudKind = (abutment === 'both' || abutment === 'right') ? 'wall' : 'free'

  const result: MergedStud[] = [{ pos: 0, kind: leftKind }]

  // Рядовые стойки из сетки (если позиция совпадает со стойкой проёма — пропускаем,
  // стойка проёма будет добавлена ниже)
  for (const p of grid) {
    if (p > 0 && p < l && !openingPositions.has(p)) {
      result.push({ pos: p, kind: 'middle' })
    }
  }

  // Стойки проёмов (кроме тех, что совпадают с 0 или l)
  for (const { pos, kind } of openingStuds) {
    if (pos > 0 && pos < l) {
      result.push({ pos, kind })
    }
  }

  result.push({ pos: l, kind: rightKind })

  return result.sort((a, b) => a.pos - b.pos)
}

// ─── Шаг 4: высота каждой стойки по геометрии потолка/пола ─────────────────

export interface MergedStudWithHeight extends MergedStud {
  height: number // ceilingProfile(pos) − floorProfile(pos)
}

/**
 * Сопоставляет каждой стойке индивидуальную высоту через интерполяцию
 * по ломаным линиям потолка и пола. Для плоской стены (flatProfile) даёт
 * одно и то же число для всех стоек — поведение полностью совместимо
 * с прежней моделью "одна высота h на всю перегородку".
 */
export function attachStudHeights(
  studs: MergedStud[],
  ceilingProfile: EdgeProfile,
  floorProfile: EdgeProfile,
): MergedStudWithHeight[] {
  return studs.map(s => ({ ...s, height: studHeightAt(s.pos, ceilingProfile, floorProfile) }))
}

// ─── Публичные функции сборки ────────────────────────────────────────────────

/**
 * buildFromPhase — для ручного сдвига гребёнки.
 * Фаза применяется буквально, стойки не фильтруются.
 */
export function buildFromPhase(
  l: number,
  s: number,
  phase: number,
  openings: Opening[]
): BuildResult {
  const ph = norm(phase, s)
  const grid = makeGrid(l, s, ph)
  const openingStuds = buildOpeningStuds(openings)

  const merged = mergeStuds(grid, openingStuds, l, 'both') // abutment не нужен здесь — positions только
  const positions = merged.map(s => s.pos)

  return { positions, phase: ph }
}

/**
 * buildPositions — начальный расчёт (calculate()).
 * Ищет фазу с минимальным числом конфликтов MIN_GAP со стойками проёмов.
 * Стены 0/l не участвуют в проверке — правила MIN_GAP от стены нет.
 */
export function buildPositions(
  l: number,
  s: number,
  first: number,
  openings: Opening[]
): BuildResult {
  const openingStuds = buildOpeningStuds(openings)
  const openingPositions = openingStuds.map(s => s.pos)
  const phase0 = norm(first, s)

  if (!openingPositions.length) {
    return buildFromPhase(l, s, phase0, openings)
  }

  let bestPhase = phase0
  let bestConflicts = countConflicts(makeGrid(l, s, phase0), openingPositions)

  for (let d = 10; d < s && bestConflicts > 0; d += 10) {
    for (const cand of [norm(phase0 + d, s), norm(phase0 - d, s)]) {
      const conflicts = countConflicts(makeGrid(l, s, cand), openingPositions)
      if (conflicts < bestConflicts) {
        bestConflicts = conflicts
        bestPhase = cand
        if (bestConflicts === 0) break
      }
    }
  }

  return buildFromPhase(l, s, bestPhase, openings)
}