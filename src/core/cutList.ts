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
 */
export function pnPieces(
  l: number,
  openings: { type: 'door' | 'window'; pos: number; width: number; sillHeight: number }[]
): Piece[] {
  const pieces: Piece[] = []
  const activeOpenings = openings.filter(o => o.width > 0)

  // ─── Пол: стена минус дверные проёмы → отдельные куски ──────────────────
  const doorOpenings = activeOpenings
    .filter(o => o.type === 'door')
    .sort((a, b) => a.pos - b.pos)

  const floorSegments: number[] = []
  let cursor = 0
  for (const o of doorOpenings) {
    if (o.pos > cursor) floorSegments.push(o.pos - cursor)
    cursor = o.pos + o.width
  }
  if (cursor < l) floorSegments.push(l - cursor)

  for (const seg of floorSegments) {
    // Длинные сегменты разбиваем на куски по 3000мм
    let remaining = seg
    while (remaining > 0) {
      const cut = Math.min(remaining, BAR_LENGTH)
      pieces.push({ length: cut, role: 'floor', label: `Пол ${cut}мм`, mustBeWhole: false })
      remaining -= cut
    }
  }

  // ─── Потолок: всегда полная длина стены ─────────────────────────────────
  let ceilRemaining = l
  while (ceilRemaining > 0) {
    const cut = Math.min(ceilRemaining, BAR_LENGTH)
    pieces.push({ length: cut, role: 'ceiling', label: `Потолок ${cut}мм`, mustBeWhole: false })
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

  return pieces
}

/**
 * Формирует список кусков ПС для одной перегородки.
 * Каждая стойка — один или два куска (если h > 3000).
 */
export function psPieces(
  studInfos: { kind: string; isAbove: boolean; openingId: string | null; orientation: string }[],
  h: number,
  overlap: number,
  openings: { id: string; height: number; sillHeight: number }[]
): Piece[] {
  const pieces: Piece[] = []

  for (const stud of studInfos) {
    if (stud.isAbove && stud.openingId) {
      // Стойка внутри проёма — два коротких куска (над и под)
      const o = openings.find(x => x.id === stud.openingId)
      if (!o) continue
      const aboveLen = h - o.height - o.sillHeight
      const belowLen = o.sillHeight
      if (aboveLen > 0) pieces.push({ length: aboveLen, role: 'stud_part', label: `Над проёмом ${aboveLen}мм`, mustBeWhole: false })
      if (belowLen > 0) pieces.push({ length: belowLen, role: 'stud_part', label: `Под подоконником ${belowLen}мм`, mustBeWhole: false })
    } else if (h <= BAR_LENGTH) {
      // Стойка целиком из одного куска
      pieces.push({ length: h, role: 'stud', label: `Стойка ${h}мм`, mustBeWhole: false })
    } else if (stud.kind === 'wall') {
      // Крайняя стойка wall — примыкает к конструкции, без нахлёста, один кусок длиной h
      pieces.push({ length: h, role: 'stud', label: `Стойка пристенная ${h}мм`, mustBeWhole: false })
    } else if (stud.kind === 'free') {
      // Свободный край: 2 основных профиля (длина h, без нахлёста) + 1 доп. профиль с нахлёстом в обе стороны
      pieces.push({ length: h, role: 'stud', label: `Стойка свободная 1 ${h}мм`, mustBeWhole: false })
      pieces.push({ length: h, role: 'stud', label: `Стойка свободная 2 ${h}мм`, mustBeWhole: false })
      if (h <= BAR_LENGTH) {
        // доп. профиль целиком
        pieces.push({ length: h, role: 'stud', label: `Стойка соед. ${h}мм`, mustBeWhole: false })
      } else {
        // доп. профиль наращивается
        const part2 = h - BAR_LENGTH
        const overlapUp = part2 >= overlap ? overlap : 500
        pieces.push({ length: BAR_LENGTH, role: 'stud', label: `Стойка соед. осн. ${BAR_LENGTH}мм`, mustBeWhole: false })
        pieces.push({ length: part2 + overlap + overlapUp, role: 'stud_part', label: `Стойка соед. доп. ${part2 + overlap + overlapUp}мм`, mustBeWhole: false })
      }
    } else {
      // Стойка наращивается: два куска (middle, free, door, window)
      const part1 = BAR_LENGTH        // длинный кусок 3000мм
      const part2 = h - BAR_LENGTH + overlap  // короткий кусок с нахлёстом
      pieces.push({ length: part1, role: 'stud', label: `Стойка осн. ${part1}мм`, mustBeWhole: false })
      pieces.push({ length: part2, role: 'stud_part', label: `Стойка доп. ${part2}мм`, mustBeWhole: false })
    }
  }

  return pieces
}
