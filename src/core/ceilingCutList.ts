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

/** П112: основной и несущий — оба сплошные, одной длины на весь ряд. */
export function calcCeilingProfileCutListP112(
  mainLengthEachMm: number, mainCount: number,
  bearingLengthEachMm: number, bearingCount: number,
): { main: CutListResult; bearing: CutListResult } {
  return {
    main: buildCutList(splitIntoBarPieces(mainLengthEachMm, mainCount, 'Основной')),
    bearing: buildCutList(splitIntoBarPieces(bearingLengthEachMm, bearingCount, 'Несущий')),
  }
}

/** П113: основной — сплошной (как у П112); несущий — короткие вставки
 *  разной длины между рядами основного (bearingSegmentLengthsMm), одна и
 *  та же раскладка повторяется на каждом ряду (bearingRowCount раз). */
export function calcCeilingProfileCutListP113(
  mainLengthEachMm: number, mainCount: number,
  bearingSegmentLengthsMm: number[], bearingRowCount: number,
): { main: CutListResult; bearing: CutListResult } {
  const bearingPieces: Piece[] = []
  for (let r = 0; r < bearingRowCount; r++) {
    for (const len of bearingSegmentLengthsMm) {
      bearingPieces.push(...splitIntoBarPieces(len, 1, 'Несущий'))
    }
  }
  return {
    main: buildCutList(splitIntoBarPieces(mainLengthEachMm, mainCount, 'Основной')),
    bearing: buildCutList(bearingPieces),
  }
}
