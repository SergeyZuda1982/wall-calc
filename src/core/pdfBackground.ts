/**
 * pdfBackground.ts — рендер страницы PDF в растровое изображение (PNG dataURL)
 * для использования как подложки на холсте плана.
 *
 * Важно: PDF превращается в обычную картинку ОДИН РАЗ при рендере — это
 * не "живой" векторный чертёж внутри холста (холст на Konva, а Konva в
 * итоге всегда рисует через растровый canvas). Чёткость на экране зависит
 * от того, сколько пикселей мы попросили при рендере, и до какого размера
 * эту картинку потом растягивают на холсте.
 *
 * Раньше renderScale был одним и тем же фиксированным числом для любого
 * файла — из-за этого маленький лист (например, А4 план квартиры)
 * получал заметно меньше пикселей на тот же объём деталей, чем большой
 * лист (А1 план объекта), и выглядел мутнее при том же приближении.
 *
 * Теперь по умолчанию масштаб подбирается по РЕАЛЬНОМУ размеру страницы
 * (в PDF-пунктах, единица не зависящая от того, что нарисовано) — так,
 * чтобы длинная сторона страницы после рендера была одинаковой у всех
 * файлов (см. DEFAULT_TARGET_LONG_SIDE_PX), а не зависела от случайного
 * фиксированного множителя.
 *
 * `targetLongSidePx` также используется для ДОРЕНДЕРА при сильном зуме
 * холста (см. вызов из FloorPlan.tsx) — если холст показывает подложку
 * крупнее, чем позволяет её текущее разрешение, страница перерисовывается
 * из исходного PDF заново, уже под нужный масштаб. Это работает, только
 * пока исходный файл PDF ещё жив в памяти текущей сессии — сами байты
 * PDF нигде не сохраняются (ни в localStorage, ни в Supabase), чтобы не
 * раздувать хранилище: там лежит только уже готовая картинка.
 */

import * as pdfjsLib from 'pdfjs-dist'
// @ts-ignore — Vite worker import as URL
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { pickRenderScale, type RenderPdfPageOptions } from './pdfRenderScale'
export type { RenderPdfPageOptions } from './pdfRenderScale'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface PdfPageImage {
  dataUrl: string
  width: number   // px при рендере (зависит от подобранного масштаба)
  height: number
  pageCount: number
  pageNum: number
}

/**
 * Рендерит указанную страницу PDF-файла в PNG dataURL.
 * Без явного renderScale масштаб подбирается по реальному размеру
 * страницы, чтобы длинная сторона была ~targetLongSidePx пикселей —
 * одинаково что для маленького листа, что для большого.
 */
export async function renderPdfPageToImage(
  file: File,
  pageNum: number = 1,
  opts: RenderPdfPageOptions = {},
): Promise<PdfPageImage> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const pageCount = pdf.numPages
  const page = await pdf.getPage(Math.min(Math.max(pageNum, 1), pageCount))

  let scale = opts.renderScale
  if (!scale) {
    const native = page.getViewport({ scale: 1 })  // реальный размер листа, PDF-пункты
    const longSide = Math.max(native.width, native.height)
    scale = pickRenderScale(longSide, opts)
  }

  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context недоступен')

  // Белый фон — PDF может иметь прозрачность
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: ctx, viewport, canvas } as any).promise

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: viewport.width,
    height: viewport.height,
    pageCount,
    pageNum,
  }
}

/** Узнать количество страниц без полного рендера (для выбора страницы). */
export async function getPdfPageCount(file: File): Promise<number> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  return pdf.numPages
}
