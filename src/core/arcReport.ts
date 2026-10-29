import { arcRadius, crossingNotes, labelIndices, ordinateOffsets, type ArcGeometry, type ArcOrientation, type ArcSheet, type OffsetFrom } from './calcArcLayout'
import { fmtDateRu, type Report, type ReportCell, type ReportSection } from './calcReport'

export interface ArcReportInput {
  geom: ArcGeometry
  sheets: ArcSheet[]
  /** Какие дуги показывать (индексы). */
  shown: number[]
  labelStep: number
  offFrom: OffsetFrom
  orientation: ArcOrientation
  sheetW: number; sheetL: number
  shiftU: number; shiftV: number; stagger: number; step: number
  /** Разбежка стыков по колонкам, мм, и ручные сдвиги (индекс колонки → мм). */
  colStaggerV?: number
  colOv?: Record<string, number>
  /** id листов в отчёте. */
  sheetIds: number[] | 'all'
  drawing?: (s: ArcSheet) => string
  overview?: () => string
  now?: Date
}

const cell = (m: { dv: number; clipped: 'top' | 'bottom' | null }): ReportCell =>
  m.clipped === 'top' ? `${m.dv} (край листа)` : m.clipped === 'bottom' ? '0 (ниже хорды)' : m.dv

export function buildArcReport(o: ArcReportInput): Report {
  const { geom } = o
  const sheets = o.sheetIds === 'all' ? o.sheets : o.sheets.filter(s => (o.sheetIds as number[]).includes(s.id))
  const fromWord = o.offFrom === 'top' ? 'верхней' : 'нижней'
  const params: Array<[string, string]> = [
    ['Хорда, мм', String(Math.round(geom.chord))],
    ['Стрела дуги 1, мм', String(Math.round(geom.sagitta))],
    ...geom.offsets.map((_, k): [string, string] => [`Радиус дуги ${k + 1}, мм`, String(Math.round(arcRadius(geom, k)))]),
    ['Лист, мм', `${o.sheetW} × ${o.sheetL}`],
    ['Раскладка', o.orientation === 'across' ? 'поперёк хорды' : 'вдоль хорды'],
    ['Сдвиг по хорде, мм', String(o.shiftU)],
    ['Сдвиг от хорды, мм', String(o.shiftV)],
    ...(o.orientation === 'along' ? [['Смещение рядов, мм', String(o.stagger)] as [string, string]] : []),
    ...(o.orientation === 'across' && ((o.colStaggerV ?? 0) > 0 || Object.keys(o.colOv ?? {}).length > 0)
      ? [['Разбежка стыков по колонкам, мм', `${o.colStaggerV ?? 0} (через колонку)${Object.keys(o.colOv ?? {}).length ? `, вручную: ${Object.entries(o.colOv ?? {}).map(([k, v]) => `к${k}=${v}`).join(', ')}` : ''}`] as [string, string]]
      : []),
    ['Шаг отметок, мм', String(o.step)],
    ['Листов в раскладке', String(o.sheets.length)],
    ...geom.offsets.map((_, k): [string, string] => {
      const cut = o.sheets.filter(s => s.cuts[k].status === 'cut').length
      return [`Дуга ${k + 1}: резать листов`, String(cut)]
    }),
  ]

  const sections: ReportSection[] = sheets.map(sheet => {
    const ref = sheet.cuts.find(c => c.marks.length)
    const rows = ref ? ref.marks : []
    const labeled = labelIndices(rows.map(m => m.du), o.labelStep)
    const offs = o.shown.map(k => ordinateOffsets(sheet.cuts[k].marks.map(m => (m.clipped ? null : m.dv)), o.offFrom))
    const notes: string[] = []
    for (const k of o.shown) {
      const s = sheet.cuts[k].status
      if (s === 'full') notes.push(`Дуга ${k + 1}: лист целиком под дугой, резать не надо.`)
      if (s === 'none') notes.push(`Дуга ${k + 1}: лист за дугой, для неё не нужен.`)
    }
    o.shown.forEach((k, j) => {
      if (offs[j].top !== null) notes.push(`Дуга ${k + 1}: верхняя линия ${offs[j].top}, нижняя ${offs[j].bottom}, между ними ${offs[j].span} мм.`)
    })
    for (const k of o.shown) {
      for (const t of crossingNotes(sheet.cuts[k])) notes.push(`Дуга ${k + 1}: ${t}.`)
    }
    if (rows.length) notes.push(`Проведите поперёк листа две линии по этим отметкам, а между ними мерьте столбец «отступ от ${fromWord} линии».`)
    const head = ['От левой кромки, мм', ...o.shown.flatMap(k => [`Дуга ${k + 1}, мм`, `Дуга ${k + 1}: отступ от ${fromWord} линии, мм`])]
    const body: ReportCell[][] = rows.map((m, i) => [
      m.du,
      ...o.shown.flatMap((k, j) => {
        const mk = sheet.cuts[k].marks[i]
        const off = offs[j].offsets[i]
        return [mk ? cell(mk) : '—', off === null || off === undefined ? '—' : off]
      }),
    ])
    return {
      title: `Лист №${sheet.id}`,
      subtitle: `ряд ${sheet.row + 1}, ${sheet.w}×${sheet.h} мм${sheet.clippedByChord ? ' (обрезан по хорде)' : ''}, u = ${Math.round(sheet.u0)}…${Math.round(sheet.u1)} от левого конца хорды`,
      svg: o.drawing?.(sheet),
      tables: rows.length
        ? [{ title: 'Ординаты дуги, мм', note: notes.join('\n'), head, rows: body, boldRows: [...labeled] }]
        : [{ title: 'Ординаты дуги', note: notes.join('\n') || 'Резов на этом листе нет.', head: [], rows: [] }],
    }
  })

  return {
    kind: 'arc', title: 'Разметка дуги', subtitle: fmtDateRu(o.now ?? new Date()),
    params, summaryTables: [], overviewSvg: o.overview?.(), sections,
  }
}
