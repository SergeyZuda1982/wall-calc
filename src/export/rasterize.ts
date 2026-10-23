import { prepareSvgForRaster } from '../core/calcReport'

export interface Raster { dataUrl: string; w: number; h: number }

/** SVG-строка → PNG (dataURL) через canvas браузера. Возвращает null, если не получилось. */
export async function svgToPng(svg: string, longSidePx = 1800): Promise<Raster | null> {
  const prep = prepareSvgForRaster(svg, longSidePx)
  if (!prep) return null
  const url = URL.createObjectURL(new Blob([prep.svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('svg')); img.src = url })
    const canvas = document.createElement('canvas')
    canvas.width = prep.w; canvas.height = prep.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, prep.w, prep.h)
    ctx.drawImage(img, 0, 0, prep.w, prep.h)
    return { dataUrl: canvas.toDataURL('image/png'), w: prep.w, h: prep.h }
  } catch { return null } finally { URL.revokeObjectURL(url) }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
