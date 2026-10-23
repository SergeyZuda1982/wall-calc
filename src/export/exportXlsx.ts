import { excelSheetName, reportFileName, type Report, type ReportTable } from '../core/calcReport'
import { downloadBlob, svgToPng } from './rasterize'

const FONT = 'Arial'

export async function exportXlsx(report: Report): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'wall-calc'
  const used = new Set<string>()

  const putTable = (ws: import('exceljs').Worksheet, t: ReportTable, row: number): number => {
    const title = ws.getCell(row, 1); title.value = t.title; title.font = { name: FONT, bold: true, size: 11 }
    row++
    if (t.note) {
      for (const line of t.note.split('\n')) { const c = ws.getCell(row, 1); c.value = line; c.font = { name: FONT, size: 10, color: { argb: 'FF6B7280' } }; row++ }
    }
    if (!t.head.length) return row + 1
    t.head.forEach((h, i) => {
      const c = ws.getCell(row, i + 1); c.value = h
      c.font = { name: FONT, bold: true, size: 10 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
      c.alignment = { wrapText: true, vertical: 'middle' }
      c.border = { bottom: { style: 'thin' } }
    })
    row++
    t.rows.forEach((r, ri) => {
      const bold = t.boldRows?.includes(ri)
      r.forEach((v, i) => {
        const c = ws.getCell(row, i + 1); c.value = v
        c.font = { name: FONT, size: 10, bold }
        if (typeof v === 'number') c.alignment = { horizontal: 'right' }
        if (bold) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
      })
      row++
    })
    return row + 1
  }
  const widths = (ws: import('exceljs').Worksheet, n: number, w: number) => { for (let i = 1; i <= n; i++) ws.getColumn(i).width = w }

  // Сводка
  const ws0 = wb.addWorksheet(excelSheetName('Сводка', used))
  ws0.getCell(1, 1).value = report.title; ws0.getCell(1, 1).font = { name: FONT, bold: true, size: 14 }
  ws0.getCell(2, 1).value = report.subtitle ?? ''; ws0.getCell(2, 1).font = { name: FONT, size: 10, color: { argb: 'FF6B7280' } }
  let r = 4
  for (const [k, v] of report.params) {
    ws0.getCell(r, 1).value = k; ws0.getCell(r, 1).font = { name: FONT, size: 10 }
    const c = ws0.getCell(r, 2); c.value = v; c.font = { name: FONT, size: 10, bold: true }; c.alignment = { horizontal: 'left' }
    r++
  }
  r++
  for (const t of report.summaryTables) r = putTable(ws0, t, r)
  ws0.getColumn(1).width = 34; ws0.getColumn(2).width = 22; ws0.getColumn(3).width = 14; ws0.getColumn(4).width = 52
  if (report.overviewSvg) {
    const img = await svgToPng(report.overviewSvg, 1800)
    if (img) {
      const id = wb.addImage({ base64: img.dataUrl, extension: 'png' })
      const w = 760
      ws0.addImage(id, { tl: { col: 5, row: 3 }, ext: { width: w, height: Math.round(w * img.h / img.w) } })
    }
  }

  // По листу на вкладку
  for (const sec of report.sections) {
    const ws = wb.addWorksheet(excelSheetName(sec.title, used))
    ws.getCell(1, 1).value = sec.title; ws.getCell(1, 1).font = { name: FONT, bold: true, size: 13 }
    ws.getCell(2, 1).value = sec.subtitle ?? ''; ws.getCell(2, 1).font = { name: FONT, size: 10, color: { argb: 'FF6B7280' } }
    let row = 4
    let maxCols = 1
    for (const t of sec.tables) { maxCols = Math.max(maxCols, t.head.length); row = putTable(ws, t, row) }
    widths(ws, Math.max(maxCols, 3), 20)
    ws.getColumn(1).width = 22
    if (sec.svg) {
      const img = await svgToPng(sec.svg, 1600)
      if (img) {
        const id = wb.addImage({ base64: img.dataUrl, extension: 'png' })
        const h = 640
        ws.addImage(id, { tl: { col: Math.max(maxCols, 3) + 1, row: 3 }, ext: { width: Math.round(h * img.w / img.h), height: h } })
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), reportFileName(report.kind, 'xlsx'))
}
