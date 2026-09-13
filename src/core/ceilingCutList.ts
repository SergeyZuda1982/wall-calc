/**
 * Раскрой профиля потолка (ПП 60×27) по пруткам 3000мм — остатки, как у
 * стен/облицовки (см. cutList.ts). 05.09.2026, запрос пользователя.
 *
 * У потолка (в отличие от стен) куски почти всегда одной длины на весь
 * ряд — не нужен свой генератор "кусков разной роли", переиспользуем
 * готовый FFD-упаковщик buildCutList() из cutList.ts напрямую.
 *
 * Только прямоугольная геометрия (calcP112FrameGeometry/calcP113FrameGeometry)
 * — произвольный контур (calcPolygonP112Frame/calcPolygonP113Frame) пока не
 * подключён (нет готового списка длин кусков в удобном виде, отдельная
 * задача при необходимости).
 */

import { buildCutList, BAR_LENGTH, type Piece, type CutListResult } from './cutList'

/** Режет один физический кусок длиной totalLen на ≤BAR_LENGTH сегментов
 *  (сплошной профиль длиннее прутка — уже даёт "Удлинитель" в смете
 *  отдельной строкой, здесь просто получаем реальные куски под раскрой). */
function splitIntoBarPieces(totalLen: number, count: number, label: string): Piece[] {
  const pieces: Piece[] = []
  for (let i = 0; i < count; i++) {
    let remaining = totalLen
    while (remaining > 0) {
      const cut = Math.min(remaining, BAR_LENGTH)
      pieces.push({ length: Math.round(cut), role: 'ceiling', label: `${label} ${Math.round(cut)}мм`, mustBeWhole: false })
      remaining -= cut
    }
  }
  return pieces
}

/** Сырые (неупакованные) куски — для проектного пула (calcProjectCutList.ts),
 *  где куски с разных потолков/стен/облицовок объединяются в один пул на
 *  раскрой (та же логика, что уже даёт экономию у стен). */
export function ceilingRawPiecesP112(
  mainLengthEachMm: number, mainCount: number,
  bearingLengthEachMm: number, bearingCount: number,
): { main: Piece[]; bearing: Piece[] } {
  return {
    main: splitIntoBarPieces(mainLengthEachMm, mainCount, 'Основной'),
    bearing: splitIntoBarPieces(bearingLengthEachMm, bearingCount, 'Несущий'),
  }
}

export function ceilingRawPiecesP113(
  mainLengthEachMm: number, mainCount: number,
  bearingSegmentLengthsMm: number[], bearingRowCount: number,
): { main: Piece[]; bearing: Piece[] } {
  const bearingPieces: Piece[] = []
  for (let r = 0; r < bearingRowCount; r++) {
    for (const len of bearingSegmentLengthsMm) {
      bearingPieces.push(...splitIntoBarPieces(len, 1, 'Несущий'))
    }
  }
  return {
    main: splitIntoBarPieces(mainLengthEachMm, mainCount, 'Основной'),
    bearing: bearingPieces,
  }
}

/** П112: основной и несущий — оба сплошные, одной длины на весь ряд. */
export function calcCeilingProfileCutListP112(
  mainLengthEachMm: number, mainCount: number,
  bearingLengthEachMm: number, bearingCount: number,
): { main: CutListResult; bearing: CutListResult } {
  const raw = ceilingRawPiecesP112(mainLengthEachMm, mainCount, bearingLengthEachMm, bearingCount)
  return { main: buildCutList(raw.main), bearing: buildCutList(raw.bearing) }
}

/** П113: основной — сплошной (как у П112); несущий — короткие вставки
 *  разной длины между рядами основного (bearingSegmentLengthsMm), одна и
 *  та же раскладка повторяется на каждом ряду (bearingRowCount раз). */
export function calcCeilingProfileCutListP113(
  mainLengthEachMm: number, mainCount: number,
  bearingSegmentLengthsMm: number[], bearingRowCount: number,
): { main: CutListResult; bearing: CutListResult } {
  const raw = ceilingRawPiecesP113(mainLengthEachMm, mainCount, bearingSegmentLengthsMm, bearingRowCount)
  return { main: buildCutList(raw.main), bearing: buildCutList(raw.bearing) }
}

/**
 * П131: топология проще П112/П113 — один ряд профиля (ПС), без второго
 * перпендикулярного уровня (см. calcP131Frame.ts). Здесь переиспользуем ту
 * же пару ключей {main, bearing}, что и у П112/П113 (та же структура,
 * что уже потребляет CeilingCalc.tsx/App.tsx), но по факту:
 *   main    = ПС несущий (psPieceCount физических кусков длиной psLengthEachMm;
 *             при спаренном ПС psPieceCount уже включает оба профиля пары)
 *   bearing = ПН направляющий (ровно 2 рейки — по одной на каждую из двух
 *             длинных стен, длиной pnLengthEachMm)
 * 11.09.2026, запрос пользователя (сессия «П131.1» — точная геометрия
 * каркаса вместо только нормы на м²).
 */
export function ceilingRawPiecesP131(
  psLengthEachMm: number, psPieceCount: number,
  pnLengthEachMm: number,
): { main: Piece[]; bearing: Piece[] } {
  return {
    main: splitIntoBarPieces(psLengthEachMm, psPieceCount, 'Несущий ПС'),
    bearing: splitIntoBarPieces(pnLengthEachMm, 2, 'Направляющий ПН'),
  }
}

export function calcCeilingProfileCutListP131(
  psLengthEachMm: number, psPieceCount: number,
  pnLengthEachMm: number,
): { main: CutListResult; bearing: CutListResult } {
  const raw = ceilingRawPiecesP131(psLengthEachMm, psPieceCount, pnLengthEachMm)
  return { main: buildCutList(raw.main), bearing: buildCutList(raw.bearing) }
}
