/**
 * Калькулятор плитки (15.07.2026) — по аналогии с калькуляторами ГКЛ
 * (LiningCalc/CeilingCalc), но материал штучный, а не листовой, поэтому
 * логика раскладки принципиально проще: обычная сетка (или "кирпичик" —
 * перевязка со сдвигом чётных рядов), без пула переиспользуемых обрезков
 * (в отличие от calcSheetLayout.ts) — на практике обрезки плитки
 * переиспользуют значительно реже, чем 3-метровые обрезки ГКЛ-листа,
 * поэтому материал считается через стандартный запас (wastePercent), а не
 * через оптимизацию раскроя.
 *
 * Раскладка (calcTileLayout) — только ДЛЯ КАРТИНКИ и памятки монтажнику
 * ("на этой стене N кусков резать под WxH") — реального выбора итогового
 * количества плитки/коробок эта раскладка не определяет (см. выше).
 */

import type { TileInput, TileLayoutResult, TilePiece, TileResult } from '../types'

/**
 * Раскрой одной оси (ряд по X или колонка по Y): цепочка плиток шагом
 * tileMm+seamMm, с необязательным сдвигом начала (startOffsetMm — для
 * "кирпичика", сдвиг чётных рядов). Кусок на любом краю обрезается по
 * границе поверхности [0, totalMm] — если после обрезки его размер меньше
 * tileMm, это подрезка (isCut).
 *
 * Отрицательный x (первая плитка "заезжает" за левый край при сдвиге)
 * корректно обрезается через left=max(x,0) — часть плитки за пределами
 * поверхности просто не попадает в итоговый кусок (это и есть подрезка
 * слева, обычная вещь в раскладке "кирпичиком").
 */
function generateAxisPieces(
  totalMm: number,
  tileMm: number,
  seamMm: number,
  startOffsetMm: number,
): { pos: number; size: number }[] {
  if (totalMm <= 0 || tileMm <= 0) return []
  const step = tileMm + seamMm
  const out: { pos: number; size: number }[] = []
  let x = -startOffsetMm
  let guard = 0
  while (x < totalMm && guard < 10000) {
    const left = Math.max(x, 0)
    const right = Math.min(x + tileMm, totalMm)
    if (right - left > 1e-6) out.push({ pos: left, size: right - left })
    x += step
    guard++
  }
  return out
}

export function calcTileLayout(input: TileInput): TileLayoutResult {
  const { lengthMm, heightMm, tileWidthMm, tileHeightMm, seamMm, layoutMode, offsetRowPercent } = input

  const rowsAxis = generateAxisPieces(heightMm, tileHeightMm, seamMm, 0)
  const pieces: TilePiece[] = []

  rowsAxis.forEach((rowAxis, rowIdx) => {
    // Сдвиг чётных (по факту — каждого второго, начиная со 2-го, rowIdx===1,3,5...)
    // рядов в режиме "кирпичик". Модуль по tileWidthMm — чтобы даже при
    // offsetRowPercent>100 (не должно приходить из формы, но не должно и
    // ломать раскладку) сдвиг оставался в пределах одной плитки.
    const rawOffset = layoutMode === 'brick' && rowIdx % 2 === 1
      ? (tileWidthMm * offsetRowPercent) / 100
      : 0
    const rowOffsetMm = tileWidthMm > 0 ? ((rawOffset % tileWidthMm) + tileWidthMm) % tileWidthMm : 0

    const colsAxis = generateAxisPieces(lengthMm, tileWidthMm, seamMm, rowOffsetMm)
    colsAxis.forEach((colAxis, colIdx) => {
      const isCut = colAxis.size < tileWidthMm - 1e-6 || rowAxis.size < tileHeightMm - 1e-6
      pieces.push({
        x: colAxis.pos, y: rowAxis.pos, w: colAxis.size, h: rowAxis.size,
        isCut, row: rowIdx, col: colIdx,
      })
    })
  })

  // Группируем подрезки по (ширина, высота), округляя до целого мм —
  // чисто для читаемой памятки монтажнику ("вырезать 4 куска 300×180"),
  // плавающая точка иначе развела бы визуально одинаковые куски по разным
  // строкам таблицы.
  const cutMap = new Map<string, { widthMm: number; heightMm: number; count: number }>()
  for (const p of pieces) {
    if (!p.isCut) continue
    const w = Math.round(p.w)
    const h = Math.round(p.h)
    const key = `${w}x${h}`
    const existing = cutMap.get(key)
    if (existing) existing.count++
    else cutMap.set(key, { widthMm: w, heightMm: h, count: 1 })
  }

  const colsPerRow = rowsAxis.map((_, rowIdx) => pieces.filter(p => p.row === rowIdx).length)
  const cols = colsPerRow.length > 0 ? Math.max(...colsPerRow) : 0

  return {
    pieces,
    rows: rowsAxis.length,
    cols,
    cutSizes: [...cutMap.values()].sort((a, b) => b.count - a.count),
  }
}

/**
 * Расход затирки — стандартная промышленная формула (публикуется
 * производителями затирки на упаковке/в калькуляторах, например Mapei/
 * Litokol/Ceresit): чем крупнее плитка, тем меньше суммарная длина шва на
 * м² поверхности, отсюда (A+B)/(A×B) — обратная величина, растущая с
 * уменьшением плитки. Проверочная точка: плитка 300×300, шов 3мм, глубина
 * шва 8мм (≈ толщина плитки), плотность 1.6 → ≈0.26 кг/м², что совпадает
 * с типичными табличными значениями производителей для такого формата.
 */
function groutKgPerM2(tileWidthMm: number, tileHeightMm: number, seamMm: number, depthMm: number, densityGCm3: number): number {
  if (tileWidthMm <= 0 || tileHeightMm <= 0) return 0
  return ((tileWidthMm + tileHeightMm) / (tileWidthMm * tileHeightMm)) * seamMm * depthMm * densityGCm3
}

export function calcTile(input: TileInput): TileResult {
  const layout = calcTileLayout(input)

  const areaM2 = (input.lengthMm * input.heightMm) / 1_000_000
  const areaWithWasteM2 = areaM2 * (1 + input.wastePercent / 100)

  // Итог в штуках целых плиток — через площадь с запасом, а НЕ через
  // count(pieces) раскладки выше: раскладка не переиспользует обрезки
  // между разными кусками (см. комментарий у файла) и потому давала бы
  // заниженную оценку без права на бой/лишний рез в другом месте стены —
  // площадь+запас (стандартная практика закупки плитки) надёжнее.
  const tileAreaM2 = (input.tileWidthMm * input.tileHeightMm) / 1_000_000
  const tilesWholeEquivalent = tileAreaM2 > 0 ? Math.ceil(areaWithWasteM2 / tileAreaM2) : 0

  const boxesCount = input.areaPerBoxM2 > 0 ? Math.ceil(areaWithWasteM2 / input.areaPerBoxM2) : 0

  const adhesiveKg = areaM2 * input.adhesiveKgPerM2

  const groutKg = areaM2 * groutKgPerM2(
    input.tileWidthMm, input.tileHeightMm, input.seamMm, input.tileThicknessMm, input.groutDensityGCm3,
  )

  return {
    layout,
    areaM2,
    areaWithWasteM2,
    tilesWholeEquivalent,
    boxesCount,
    adhesiveKg,
    groutKg,
  }
}
