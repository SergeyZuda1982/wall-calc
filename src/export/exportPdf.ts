import { reportFileName, type Report, type ReportSection, type ReportTable } from '../core/calcReport'
import { downloadBlob, svgToPng } from './rasterize'

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROWS_PER_COLUMN = 36

const tableNode = (t: ReportTable, rows: ReportTable['rows'], offset: number, widths?: number): any => {
  const bold = new Set(t.boldRows ?? [])
  return {
    table: {
      headerRows: 1,
      widths: t.head.map(() => (widths ? '*' : 'auto')),
      body: [
        t.head.map(h => ({ text: h, bold: true, fillColor: '#e5e7eb', fontSize: 7.5 })),
        ...rows.map((r, i) => r.map(v => ({ text: String(v), bold: bold.has(offset + i), fillColor: bold.has(offset + i) ? '#f3f4f6' : undefined, alignment: typeof v === 'number' ? 'right' : 'left' }))),
      ],
    },
    layout: { hLineWidth: () => 0.3, vLineWidth: () => 0.3, hLineColor: () => '#cbd5e1', vLineColor: () => '#cbd5e1', paddingTop: () => 1.5, paddingBottom: () => 1.5, paddingLeft: () => 3, paddingRight: () => 3 },
    fontSize: 8, margin: [0, 0, 8, 0],
  }
}

async function sectionContent(sec: ReportSection, first: boolean): Promise<any[]> {
  const out: any[] = []
  const head: any[] = [{ text: sec.title, style: 'h2' }, { text: sec.subtitle ?? '', style: 'sub', margin: [0, 0, 0, 6] }]
  const img = sec.svg ? await svgToPng(sec.svg, 1600) : null
  const real = sec.tables.filter(t => t.head.length)
  const notes = sec.tables.filter(t => t.note).map(t => ({ text: t.note, style: 'sub', margin: [0, 0, 0, 4] }))
  const picture = img ? { image: img.dataUrl, fit: [250, 440] as [number, number] } : null

  const single = real.length === 1 ? real[0] : null
  const total = real.reduce((s, t) => s + t.rows.length + 3, 0)
  let body: any[]
  if (picture && single) {
    const n = Math.max(1, Math.ceil(single.rows.length / ROWS_PER_COLUMN))
    if (n <= 3) {
      const cols: any[] = [{ width: 255, stack: [picture] }]
      for (let c = 0; c < n; c++) {
        const part = single.rows.slice(c * ROWS_PER_COLUMN, (c + 1) * ROWS_PER_COLUMN)
        cols.push({ width: '*', stack: [tableNode(single, part, c * ROWS_PER_COLUMN, 1)] })
      }
      body = [...notes, { columns: cols, columnGap: 10 }]
    } else body = [...notes, picture, tableNode(single, single.rows, 0)]
  } else if (picture && total <= ROWS_PER_COLUMN + 4) {
    body = [...notes, { columns: [{ width: 255, stack: [picture] }, { width: '*', stack: real.flatMap(t => [{ text: t.title, bold: true, fontSize: 9, margin: [0, 0, 0, 3] }, tableNode(t, t.rows, 0, 1)]) }], columnGap: 10 }]
  } else {
    body = [...notes, ...(picture ? [picture] : []), ...real.flatMap(t => [{ text: t.title, bold: true, fontSize: 9, margin: [0, 6, 0, 3] }, tableNode(t, t.rows, 0)])]
  }
  out.push({ stack: [...head, ...body], pageBreak: first ? undefined : 'before' })
  return out
}

export async function exportPdf(report: Report): Promise<void> {
  const mod: any = await import('pdfmake/build/pdfmake')
  const vfsMod: any = await import('pdfmake/build/vfs_fonts')
  const pdfMake = mod.default ?? mod
  pdfMake.addVirtualFileSystem(vfsMod.default ?? vfsMod)

  const content: any[] = [
    { text: report.title, style: 'h1' },
    { text: report.subtitle ?? '', style: 'sub', margin: [0, 0, 0, 8] },
    { table: { widths: [200, 120], body: report.params.map(([k, v]) => [{ text: k, fontSize: 9 }, { text: v, bold: true, fontSize: 9 }]) }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 10] },
  ]
  for (const t of report.summaryTables) {
    content.push({ text: t.title, bold: true, fontSize: 9, margin: [0, 4, 0, 3] }, tableNode(t, t.rows, 0))
  }
  if (report.overviewSvg) {
    const img = await svgToPng(report.overviewSvg, 2000)
    if (img) content.push({ image: img.dataUrl, fit: [760, 300], margin: [0, 4, 0, 0] })
  }
  for (let i = 0; i < report.sections.length; i++) {
    content.push(...(await sectionContent(report.sections[i], false)))
  }

  const doc = {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [30, 28, 30, 28],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    styles: { h1: { fontSize: 16, bold: true }, h2: { fontSize: 13, bold: true }, sub: { fontSize: 8.5, color: '#6b7280' } },
    footer: (cur: number, total: number) => ({ text: `${report.title} · ${report.subtitle ?? ''} · стр. ${cur} из ${total}`, alignment: 'right', fontSize: 7, color: '#9ca3af', margin: [30, 6, 30, 0] }),
    content,
  }
  const blob: Blob = await new Promise((res, rej) => {
    try {
      const pdf = pdfMake.createPdf(doc)
      const p = pdf.getBlob(res)
      if (p && typeof p.then === 'function') p.then(res, rej)
    } catch (e) { rej(e) }
  })
  downloadBlob(blob, reportFileName(report.kind, 'pdf'))
}
