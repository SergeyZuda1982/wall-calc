/**
 * calcReport.ts — нейтральная модель отчёта для экспорта в Excel и PDF.
 * Построители (arcReport, contourReport) собирают Report из расчёта, а экспортёры
 * (export/exportXlsx.ts, export/exportPdf.ts) превращают его в файл.
 */

export type ReportCell = string | number

export interface ReportTable {
  title: string
  note?: string
  head: string[]
  rows: ReportCell[][]
  /** Индексы выделенных (жирных) строк. */
  boldRows?: number[]
}

export interface ReportSection {
  title: string
  subtitle?: string
  /** SVG-чертёж листа (строка). Экспортёры растеризуют его в PNG. */
  svg?: string
  tables: ReportTable[]
}

export interface Report {
  kind: 'arc' | 'contour'
  title: string
  /** Дата и пр. */
  subtitle?: string
  params: Array<[string, string]>
  /** Общие таблицы до листов (например, вершины контура). */
  summaryTables: ReportTable[]
  overviewSvg?: string
  sections: ReportSection[]
}

export const fmtDateRu = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function reportFileName(kind: 'arc' | 'contour', ext: 'xlsx' | 'pdf', now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${kind === 'arc' ? 'duga' : 'kontur'}-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.${ext}`
}

/** Имя листа Excel: до 31 символа, без []:*?/\ . */
export function excelSheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 28) || 'Лист'
  let name = base
  let i = 2
  while (used.has(name.toLowerCase())) name = `${base} (${i++})`
  used.add(name.toLowerCase())
  return name
}

/** Размеры SVG по viewBox → {w,h}; null, если viewBox не найден. */
export function svgViewBoxSize(svg: string): { w: number; h: number } | null {
  const m = /viewBox="\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*"/.exec(svg)
  if (!m) return null
  const w = Number(m[3]); const h = Number(m[4])
  return w > 0 && h > 0 ? { w, h } : null
}

/** Готовит SVG из экрана для растеризации: убирает стиль корня, задаёт width/height и xmlns. */
export function prepareSvgForRaster(svg: string, longSidePx: number): { svg: string; w: number; h: number } | null {
  const size = svgViewBoxSize(svg)
  if (!size) return null
  const k = longSidePx / Math.max(size.w, size.h)
  const w = Math.max(1, Math.round(size.w * k)); const h = Math.max(1, Math.round(size.h * k))
  const out = svg.replace(/<text\b[^>]*>[^<]*низ листа[^<]*<\/text>/g, '').replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const clean = attrs.replace(/\sstyle="[^"]*"/, '').replace(/\s(width|height)="[^"]*"/g, '').replace(/\sxmlns="[^"]*"/, '')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"${clean}>`
  })
  return { svg: out, w, h }
}
