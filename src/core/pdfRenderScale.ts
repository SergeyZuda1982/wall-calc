/**
 * Чистая логика подбора масштаба рендера PDF-страницы в картинку —
 * вынесена отдельно от pdfBackground.ts (который тянет pdfjs-dist,
 * а та требует браузерное окружение — DOMMatrix и т.п., и не грузится
 * в обычных unit-тестах Node). Здесь — только числа, без единого
 * браузерного/PDF-специфичного вызова, поэтому тестируется напрямую.
 */

/** Длинная сторона страницы по умолчанию, px — ориентир на комфортную
 *  работу без пересчёта на типичном рабочем зуме. */
export const DEFAULT_TARGET_LONG_SIDE_PX = 3000
/** Жёсткий потолок — не раздувать картинку бесконечно даже при очень
 *  сильном зуме (страдает и память браузера, и вес в localStorage). */
export const MAX_TARGET_LONG_SIDE_PX = 6000
export const MIN_RENDER_SCALE = 1.5
export const MAX_RENDER_SCALE = 8

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

export interface RenderPdfPageOptions {
  /** Явно задать множитель рендера — обычно не нужно, автоподбор лучше */
  renderScale?: number
  /** Желаемая длина длинной стороны страницы после рендера, px.
   *  Игнорируется, если задан renderScale напрямую. */
  targetLongSidePx?: number
}

/**
 * Подбирает масштаб рендера по РЕАЛЬНОМУ размеру страницы (PDF-пункты,
 * единица не зависящая от того, что нарисовано на листе), а не одним
 * и тем же фиксированным числом для всех файлов — иначе маленький лист
 * (А4, план квартиры) получает заметно меньше пикселей на тот же объём
 * деталей, чем большой лист (А1, план объекта), и выглядит мутнее при
 * одинаковом приближении на холсте.
 *
 * nativeLongSidePx — длинная сторона страницы в PDF-пунктах, то есть
 * `page.getViewport({scale:1})` в pdf.js.
 */
export function pickRenderScale(nativeLongSidePx: number, opts: RenderPdfPageOptions = {}): number {
  if (opts.renderScale) return opts.renderScale
  if (nativeLongSidePx <= 0) return MIN_RENDER_SCALE
  const target = clamp(opts.targetLongSidePx ?? DEFAULT_TARGET_LONG_SIDE_PX, 0, MAX_TARGET_LONG_SIDE_PX)
  return clamp(target / nativeLongSidePx, MIN_RENDER_SCALE, MAX_RENDER_SCALE)
}
