/**
 * Раскрой профиля — алгоритм First Fit Decreasing.
 *
 * Принимает список нужных кусков (с пометкой — целый или можно из остатка),
 * возвращает список прутков с раскладкой кусков по ним и остатками.
 *
 * Правила:
 * - Стандартная длина прутка: 3000мм
 * - Перемычки и подоконники — ЦЕЛЫЕ куски (нельзя брать из остатка < длины куска)
 * - Пол/потолок — можно из любых кусков
 * - Сначала пробуем использовать наименьший подходящий остаток,
 *   если не нашли — берём новый пруток
 */

import { splitFreeStud } from './calcStudMaterial'
import { profilePathLength, studHeightAt } from './profileGeometry'
import { COMM_HEADROOM_MIN } from '../types'

export const BAR_LENGTH = 3000 // мм

export type PieceRole =
  | 'floor'      // пол
  | 'ceiling'    // потолок
  | 'sill'       // подоконник (целый)
  | 'lintel'     // перемычка (целый)
  | 'stud'       // стойка ПС
  | 'stud_part'  // часть стойки ПС (второй кусок при наращивании)

export interface Piece {
  length: number   // мм
  role: PieceRole
  label: string    // для отображения
  mustBeWhole: boolean // true = нельзя составлять из кусков (перемычки, подоконники)
}

export interface Bar {
  pieces: { piece: Piece; from: number }[] // куски и их позиции в прутке
  waste: number  // остаток мм
}

export interface CutListResult {
  bars: Bar[]
  totalBars: number
  totalWaste: number  // мм
}

/**
 * Раскраивает список кусков по пруткам 3000мм.
 * Куски сортируются по убыванию длины (FFD).
 * Для каждого куска ищем наименьший подходящий остаток среди уже открытых прутков.
 */
export function buildCutList(pieces: Piece[]): CutListResult {
  // Сортируем по убыванию длины
  const sorted = [...pieces].sort((a, b) => b.length - a.length)

  const bars: Bar[] = []

  for (const piece of sorted) {
    if (piece.length > BAR_LENGTH) {
      // Кусок длиннее прутка — ошибка конфигурации, пропускаем
      // (в реальности такого не должно быть после валидации)
      continue
    }

    // Ищем наименьший подходящий остаток среди открытых прутков
    let bestBarIdx = -1
    let bestWaste = Infinity

    for (let i = 0; i < bars.length; i++) {
      const remaining = bars[i].waste
      if (remaining >= piece.length) {
        // Подходит — проверяем что это наименьший остаток
        if (remaining < bestWaste) {
          bestWaste = remaining
          bestBarIdx = i
        }
      }
    }

    if (bestBarIdx >= 0) {
      // Кладём в найденный пруток
      const bar = bars[bestBarIdx]
      const from = BAR_LENGTH - bar.waste
      bar.pieces.push({ piece, from })
      bar.waste -= piece.length
    } else {
      // Открываем новый пруток
      const bar: Bar = { pieces: [], waste: BAR_LENGTH }
      bar.pieces.push({ piece, from: 0 })
      bar.waste -= piece.length
      bars.push(bar)
    }
  }

  const totalWaste = bars.reduce((s, b) => s + b.waste, 0)

  return { bars, totalBars: bars.length, totalWaste }
}

/**
 * Формирует список кусков ПН для одной перегородки.
 * Опциональные профили потолка/пола позволяют считать реальную длину по скату,
 * а не горизонтальную проекцию. Без профилей — поведение прежнее (плоская стена).
 */
export function pnPieces(
  l: number,
  openings: { type: 'door' | 'window' | 'opening'; pos: number; width: number; sillHeight: number }[],
  ceilingProfile?: { x: number; y: number }[],
  floorProfile?: { x: number; y: number }[],
  communications: { pos: number; width: number; top: number }[] = [],
): Piece[] {
  const pieces: Piece[] = []
  const activeOpenings = openings.filter(o => o.width > 0)

  // Длина отрезка: реальная (гипотенуза) если задан профиль, горизонтальная иначе
  const segLen = (prof: { x: number; y: number }[] | undefined, from: number, to: number) =>
    profilePathLength(prof, from, to)

  // ─── Пол: стена минус проёмы "от пола" (sillHeight=0) → отдельные куски ──
  // Не только дверные — так же и окно/проём без подоконника (например,
  // панорамное остекление в пол).
  const floorLevelOpenings = activeOpenings
    .filter(o => o.sillHeight === 0)
    .sort((a, b) => a.pos - b.pos)

  let cursor = 0
  for (const o of floorLevelOpenings) {
    if (o.pos > cursor) {
      let remaining = segLen(floorProfile, cursor, o.pos)
      while (remaining > 0) {
        const cut = Math.min(remaining, BAR_LENGTH)
        pieces.push({ length: Math.round(cut), role: 'floor', label: `Пол ${Math.round(cut)}мм`, mustBeWhole: false })
        remaining -= cut
      }
    }
    cursor = o.pos + o.width
  }
  if (cursor < l) {
    let remaining = segLen(floorProfile, cursor, l)
    while (remaining > 0) {
      const cut = Math.min(remaining, BAR_LENGTH)
      pieces.push({ length: Math.round(cut), role: 'floor', label: `Пол ${Math.round(cut)}мм`, mustBeWhole: false })
      remaining -= cut
    }
  }

  // ─── Потолок: полная длина по профилю ────────────────────────────────────
  let ceilRemaining = segLen(ceilingProfile, 0, l)
  while (ceilRemaining > 0) {
    const cut = Math.min(ceilRemaining, BAR_LENGTH)
    pieces.push({ length: Math.round(cut), role: 'ceiling', label: `Потолок ${Math.round(cut)}мм`, mustBeWhole: false })
    ceilRemaining -= cut
  }

  // ─── Подоконники: целые куски (ширина + 400мм запас) ────────────────────
  const SILL_MARGIN = 200
  for (const o of activeOpenings.filter(o => o.sillHeight > 0)) {
    const len = o.width + 2 * SILL_MARGIN
    pieces.push({ length: len, role: 'sill', label: `Подоконник ${len}мм`, mustBeWhole: true })
  }

  // ─── Перемычки: целые куски (ширина + 400мм) ────────────────────────────
  for (const o of activeOpenings) {
    const len = o.width + 400
    pieces.push({ length: len, role: 'lintel', label: `Перемычка ${len}мм`, mustBeWhole: true })
  }

  // ─── Перемычки коммуникаций: нижняя всегда, верхняя — если запас > 400мм ─
  // (см. КОНСПЕКТ 14.07.2026). Без профилей (тесты плоской стены без ската)
  // запас считаем неограниченным — верхняя перемычка ставится всегда.
  for (const c of communications.filter(x => x.width > 0)) {
    const len = c.width + 400
    pieces.push({ length: len, role: 'lintel', label: `Перемычка под коммуникацией ${len}мм`, mustBeWhole: true })
    const headroom = (ceilingProfile && floorProfile)
      ? studHeightAt(c.pos, ceilingProfile, floorProfile) - c.top
      : Infinity
    if (headroom > COMM_HEADROOM_MIN) {
      pieces.push({ length: len, role: 'lintel', label: `Перемычка над коммуникацией ${len}мм`, mustBeWhole: true })
    }
  }

  return pieces
}

/**
 * Формирует список кусков ПС для одной перегородки (n-кусковая логика).
 *
 * Каждая стойка может нести свою индивидуальную высоту (stud.height) — для
 * перегородок с переменной геометрией потолка/пола (скос, ступени). Если у
 * стойки нет .height, используется общий параметр h (обратная совместимость
 * с плоской стеной и со старыми вызовами).
 *
 * wall:   торец в торец, без нахлёста. n = ceil(h/3000) кусков по ≤3000мм.
 * middle: n кусков с нахлёстом. step=3000-overlap. n=1+ceil((h-3000)/step).
 *         Куски: (n-1) × 3000мм + последний = h-(n-1)*step.
 *         Суммарный материал = h + (n-1)*overlap.
 * free:   N основных кусков торец в торец (3000мм + короткий остаток) +
 *         отдельный соединительный кусок НА КАЖДЫЙ стык (см. splitFreeStud).
 */
export function psPieces(
  studInfos: { kind: string; isAbove: boolean; openingId: string | null; communicationId?: string | null; orientation: string; height?: number }[],
  h: number,
  overlap: number,
  openings: { id: string; height: number; sillHeight: number }[],
  communications: { id: string; bottom: number; top: number }[] = [],
): Piece[] {
  const pieces: Piece[] = []
  const step = BAR_LENGTH - overlap  // чистый прирост высоты на кусок (middle)

  for (const stud of studInfos) {
    const studH = stud.height ?? h // индивидуальная высота стойки (или общая h для обратной совместимости)

    if (stud.isAbove && stud.openingId) {
      // Стойка внутри проёма — куски над и под проёмом
      const o = openings.find(x => x.id === stud.openingId)
      if (!o) continue
      const aboveLen = studH - o.height - o.sillHeight
      const belowLen = o.sillHeight
      if (aboveLen > 0) pieces.push({ length: aboveLen, role: 'stud_part', label: `Над проёмом ${aboveLen}мм`, mustBeWhole: false })
      if (belowLen > 0) pieces.push({ length: belowLen, role: 'stud_part', label: `Под подоконником ${belowLen}мм`, mustBeWhole: false })

    } else if (stud.isAbove && stud.communicationId) {
      // Стойка попадает в зону коммуникации, но НЕ убирается (в отличие от
      // проёма) — режется нижней перемычкой на отметке bottom, и, если есть
      // запас > 400мм над коммуникацией, ещё и верхней на отметке top.
      const c = communications.find(x => x.id === stud.communicationId)
      if (!c) continue
      const belowLen = c.bottom
      const headroom = studH - c.top
      const aboveLen = headroom > COMM_HEADROOM_MIN ? (studH - c.top) : 0
      if (belowLen > 0) pieces.push({ length: belowLen, role: 'stud_part', label: `Под коммуникацией ${belowLen}мм`, mustBeWhole: false })
      if (aboveLen > 0) pieces.push({ length: aboveLen, role: 'stud_part', label: `Над коммуникацией ${aboveLen}мм`, mustBeWhole: false })

    } else if (studH <= BAR_LENGTH) {
      // Любая стойка вписывается в один профиль
      pieces.push({ length: studH, role: 'stud', label: `Стойка ${studH}мм`, mustBeWhole: false })

    } else if (stud.kind === 'wall') {
      // ── wall: торец в торец, без нахлёста ───────────────────────────────
      // n = ceil(h/3000) кусков; (n-1) × 3000мм + последний кусок.
      const nWall = Math.ceil(studH / BAR_LENGTH)
      for (let i = 0; i < nWall - 1; i++) {
        pieces.push({ length: BAR_LENGTH, role: 'stud', label: `Стойка пристенная осн. ${BAR_LENGTH}мм`, mustBeWhole: false })
      }
      const lastWall = studH - (nWall - 1) * BAR_LENGTH
      pieces.push({ length: lastWall, role: 'stud_part', label: `Стойка пристенная доп. ${lastWall}мм`, mustBeWhole: false })

    } else if (stud.kind === 'free') {
      // ── free: N основных кусков торец в торец + соединительный на КАЖДЫЙ стык ──
      // Используем ту же разбивку, что и calcStudMaterial (splitFreeStud), чтобы
      // смета (cwTotal) и раскрой никогда не расходились.
      const { mainPieces, connectorLengths } = splitFreeStud(studH, overlap)

      mainPieces.forEach((len, i) => {
        pieces.push({
          length: len,
          role: i === 0 ? 'stud' : 'stud_part',
          label: `Стойка своб. ${i === 0 ? 'осн.' : 'доп.'} ${len}мм`,
          mustBeWhole: false,
        })
      })

      connectorLengths.forEach(connector => {
        pieces.push({ length: connector, role: 'stud_part', label: `Стойка соед. ${connector}мм`, mustBeWhole: false })
      })

    } else {
      // ── middle / door / window: n кусков с нахлёстом ────────────────────
      // n = 1 + ceil((h-3000)/step), суммарный материал = h + (n-1)*overlap
      const n = 1 + Math.ceil((studH - BAR_LENGTH) / step)
      // (n-1) полных кусков по 3000мм
      for (let i = 0; i < n - 1; i++) {
        pieces.push({ length: BAR_LENGTH, role: 'stud', label: `Стойка осн. ${BAR_LENGTH}мм`, mustBeWhole: false })
      }
      // Последний кусок = h - (n-1)*step
      const lastMiddle = studH - (n - 1) * step
      pieces.push({ length: lastMiddle, role: 'stud_part', label: `Стойка доп. ${lastMiddle}мм`, mustBeWhole: false })
    }
  }

  return pieces
}
