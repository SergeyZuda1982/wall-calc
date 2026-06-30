/**
 * pdfBackground.ts — рендер страницы PDF в растровое изображение (PNG dataURL)
 * для использования как подложки на холсте плана.
 */

import * as pdfjsLib from 'pdfjs-dist'
// @ts-ignore — Vite worker import as URL
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface PdfPageImage {
  dataUrl: string
  width: number   // px при рендере (зависит от renderScale)
  height: number
  pageCount: number
  pageNum: number
}

/**
 * Рендерит указанную страницу PDF-файла в PNG dataURL.
 * renderScale ~2 даёт читаемый текст для типичных чертежей A3/A4.
 */
export async function renderPdfPageToImage(
  file: File,
  pageNum: number = 1,
  renderScale: number = 2,
): Promise<PdfPageImage> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const pageCount = pdf.numPages
  const page = await pdf.getPage(Math.min(Math.max(pageNum, 1), pageCount))
  const viewport = page.getViewport({ scale: renderScale })

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
