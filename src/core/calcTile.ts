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

import type { TileInput, TileLayoutResult, TilePiece, TileResult, TileAxisAlign } from '../types'

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
/**
 * Раскрой одной оси (ряд по X или колонка по Y): цепочка плиток шагом
 * tileMm+seamMm, с необязательным сдвигом начала (startOffsetMm — для
 * "кирпичика", сдвиг чётных рядов, а также для align='end'). Кусок на
 * любом краю обрезается по границе поверхности [0, totalMm] — если после
 * обрезки его размер меньше tileMm, это подрезка (isCut).
 *
 * Отрицательный x (первая плитка "заезжает" за левый край при сдвиге)
 * корректно обрезается через left=max(x,0) — часть плитки за пределами
 * поверхности просто не попадает в итоговый кусок (это и есть подрезка
 * слева, обычная вещь в раскладке "кирпичиком" или align='end').
 *
 * ⚠️ Этот "периодический разворот от одной фазы" годится для align
 * 'start'/'end' (подрезка целиком на одном крае) и для СДВИНУТЫХ рядов
 * "кирпичика" (там симметрия и не нужна — сдвиг специально её ломает).
 * Для align='center' (подрезка ПОРОВНУ на обоих краях одновременно) один
 * глобальный сдвиг фазы этого не гарантирует — там отдельная явная
 * функция centeredAxisPieces() ниже, строящая оба края одинаковыми по
 * построению, а не подбором фазы.
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

/**
 * Симметричная раскладка (align='center') — целые плитки в середине,
 * ОДИНАКОВЫЙ обрезок на обоих краях (построением, а не подбором — см.
 * комментарий выше). Сначала проверяем "идеальный" случай (размер
 * поверхности кратен плитке с учётом швов) — тогда обрезки нет вообще,
 * целые плитки от края до края. Иначе — считаем максимум целых плиток n,
 * при котором обрезка edgeW с КАЖДОЙ стороны (с учётом шва к соседней
 * целой плитке!) ещё неотрицательна, и строим [обрезок, n плиток, тот же
 * обрезок].
 */
function centeredAxisPieces(totalMm: number, tileMm: number, seamMm: number): { pos: number; size: number }[] {
  if (totalMm <= 0 || tileMm <= 0) return []
  const step = tileMm + seamMm

  const nFlush = Math.round((totalMm + seamMm) / step)
  if (nFlush > 0) {
    const flushWidth = nFlush * tileMm + (nFlush - 1) * seamMm
    if (Math.abs(flushWidth - totalMm) < 1e-6) {
      const out: { pos: number; size: number }[] = []
      let x = 0
      for (let i = 0; i < nFlush; i++) { out.push({ pos: x, size: tileMm }); x += step }
      return out
    }
  }

  const n = Math.max(0, Math.floor((totalMm - seamMm) / step))
  const usedMiddle = n * tileMm + (n + 1) * seamMm
  const edgeW = Math.max(0, (totalMm - usedMiddle) / 2)

  const out: { pos: number; size: number }[] = []
  let x = 0
  if (edgeW > 1e-6) { out.push({ pos: 0, size: edgeW }); x = edgeW + seamMm }
  for (let i = 0; i < n; i++) { out.push({ pos: x, size: tileMm }); x += step }
  if (edgeW > 1e-6) out.push({ pos: x, size: edgeW })
  return out
}

/**
 * "Фаза" раскладки для align='start'/'end'/'center' — условная позиция,
 * где начиналась бы бесконечная периодическая сетка плиток, если её
 * продолжить. Нужна ТОЛЬКО чтобы сдвинутые ряды "кирпичика" продолжали
 * тот же ритм, что и опорный (несдвинутый) ряд — сами сдвинутые ряды уже
 * не обязаны быть симметричными (см. комментарий у generateAxisPieces).
 */
function referencePhaseMm(totalMm: number, tileMm: number, seamMm: number, align: TileAxisAlign): number {
  if (tileMm <= 0) return 0
  const step = tileMm + seamMm
  if (align === 'start') return 0
  if (align === 'end') {
    const rem = ((totalMm - tileMm) % step + step) % step
    return rem
  }
  // 'center'
  const nFlush = Math.round((totalMm + seamMm) / step)
  if (nFlush > 0) {
    const flushWidth = nFlush * tileMm + (nFlush - 1) * seamMm
    if (Math.abs(flushWidth - totalMm) < 1e-6) return 0
  }
  const n = Math.max(0, Math.floor((totalMm - seamMm) / step))
  const usedMiddle = n * tileMm + (n + 1) * seamMm
  const edgeW = Math.max(0, (totalMm - usedMiddle) / 2)
  return edgeW > 1e-6 ? edgeW + seamMm : 0
}

/** Переводит "фазу" (референсную позицию первой целой плитки) в
 *  startOffsetMm для generateAxisPieces — тот подаёт x=-startOffsetMm и
 *  требует x<=0, чтобы развёртка гарантированно накрыла всю поверхность. */
function phaseToStartOffset(phaseMm: number, step: number): number {
  if (step <= 0) return 0
  const reduced = ((phaseMm % step) + step) % step
  return step - reduced
}

/** Раскладка одной оси (ряда по X либо, для вертикали, колонки по Y) с
 *  учётом выбранного выравнивания. shiftMm — дополнительный сдвиг фазы
 *  сверх align (используется только для рядов "кирпичика" по X). */
function axisPieces(
  totalMm: number, tileMm: number, seamMm: number, align: TileAxisAlign, shiftMm = 0,
): { pos: number; size: number }[] {
  if (align === 'center' && Math.abs(shiftMm) < 1e-6) return centeredAxisPieces(totalMm, tileMm, seamMm)
  const phase = referencePhaseMm(totalMm, tileMm, seamMm, align) + shiftMm
  const step = tileMm + seamMm
  return generateAxisPieces(totalMm, tileMm, seamMm, phaseToStartOffset(phase, step))
}

export function calcTileLayout(input: TileInput): TileLayoutResult {
  const {
    lengthMm, heightMm, tileWidthMm, tileHeightMm, seamMm, layoutMode, offsetRowPercent,
    horizontalAlign, verticalAlign,
  } = input

  const rowsAxis = axisPieces(heightMm, tileHeightMm, seamMm, verticalAlign)
  const pieces: TilePiece[] = []

  rowsAxis.forEach((rowAxis, rowIdx) => {
    // Сдвиг чётных (по факту — каждого второго, начиная со 2-го, rowIdx===1,3,5...)
    // рядов в режиме "кирпичик" — сверх выбранного horizontalAlign, а не
    // вместо него (иначе центровка/прижатие терялись бы в кирпичике).
    const shiftMm = layoutMode === 'brick' && rowIdx % 2 === 1
      ? (tileWidthMm * offsetRowPercent) / 100
      : 0

    const colsAxis = axisPieces(lengthMm, tileWidthMm, seamMm, horizontalAlign, shiftMm)
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
