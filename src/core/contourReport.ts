import { labelIndices, ordinateOffsets, type OffsetFrom } from './calcArcLayout'
import { isBulgeInward } from './contourEdit'
import type { ContourLayoutResult, ContourOrientation, ContourSheet, ContourVertex } from './calcContourLayout'
import { fmtDateRu, type Report, type ReportCell, type ReportSection } from './calcReport'

export interface ContourReportInput {
  vertices: ContourVertex[]
  layout: ContourLayoutResult
  areaM2: number
  perimeterM: number
  sheetW: number; sheetL: number
  orientation: ContourOrientation
  shiftU: number; shiftV: number; stagger: number; step: number; labelStep: number
  /** Номер опорной стороны (с 1) и её описание. */
  refSide: number
  offFrom: OffsetFrom
  sideName: (edge: number) => string
  sheetIds: number[] | 'all'
  drawing?: (s: ContourSheet) => string
  now?: Date
}

export function buildContourReport(o: ContourReportInput): Report {
  const all = o.layout.sheets
  const sheets = o.sheetIds === 'all' ? all : all.filter(s => (o.sheetIds as number[]).includes(s.id))
  const f = (x: number, d = 2) => x.toFixed(d).replace('.', ',')
  const params: Array<[string, string]> = [
    ['Площадь потолка, м²', f(o.areaM2)],
    ['Периметр, м', f(o.perimeterM)],
    ['Опорная сторона', String(o.refSide)],
    ['Лист, мм', `${o.sheetW} × ${o.sheetL}`],
    ['Раскладка', o.orientation === 'across' ? 'поперёк опоры' : 'вдоль опоры'],
    ['Сдвиг вдоль опоры, мм', String(o.shiftU)],
    ['Сдвиг от опоры, мм', String(o.shiftV)],
    ['Смещение рядов, мм', String(o.stagger)],
    ['Шаг отметок, мм', String(o.step)],
    ['Листов в раскладке', String(o.layout.sheetCount)],
    ['Целых листов', String(o.layout.fullCount)],
    ['Резать листов', String(o.layout.sheetCount - o.layout.fullCount)],
  ]
  const n = o.vertices.length
  const summaryTables = [{
    title: 'Вершины контура, мм (ось Y направлена вверх)',
    head: ['№', 'X, мм', 'Y, мм', 'Сторона к следующей вершине'],
    rows: o.vertices.map((v, i): ReportCell[] => [
      i + 1, Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10,
      v.sag ? `дуга, стрела ${Math.abs(Math.round(v.sag))} мм, ${isBulgeInward(o.vertices, i) ? 'внутрь' : 'наружу'} (к вершине ${((i + 1) % n) + 1})` : `прямая (к вершине ${((i + 1) % n) + 1})`,
    ]),
  }]

  const sections: ReportSection[] = sheets.map(sheet => {
    const tables: ReportSection['tables'] = []
    if (sheet.corners.length) {
      tables.push({
        title: 'Точки реза на листе, мм',
        head: ['№', 'От левой кромки', 'От нижней кромки', 'Дальше по линии'],
        rows: sheet.corners.map((c, i): ReportCell[] => [i + 1, c.u, c.v, c.toNext < 0 ? 'по кромке листа' : o.sideName(c.toNext)]),
      })
    }
    sheet.arcs.forEach(arc => {
      const posHead = arc.axis === 'u' ? 'От левой кромки' : 'От нижней кромки'
      const valHead = arc.axis === 'u' ? 'до реза от нижней кромки' : 'до реза от левой кромки'
      const offs = ordinateOffsets(arc.rows.map(r => (r.vals.length ? r.vals[0] : null)), o.offFrom)
      const offHead = o.offFrom === 'top' ? 'отступ от дальней линии' : 'отступ от ближней линии'
      const labeled = labelIndices(arc.rows.map(r => r.pos), o.labelStep)
      tables.push({
        title: `Ординаты: ${o.sideName(arc.edge)}, мм`,
        note: offs.top !== null ? `Дальняя линия ${offs.top}, ближняя ${offs.bottom}, между ними ${offs.span} мм. Проведите их поперёк листа и мерьте внутри столбец «${offHead}».` : undefined,
        head: [posHead, valHead, offHead],
        rows: arc.rows.map((r, i): ReportCell[] => [r.pos, r.vals.join(' / '), offs.offsets[i] ?? '—']),
        boldRows: [...labeled],
      })
    })
    if (!tables.length) tables.push({ title: 'Резов нет', note: 'Лист целиком внутри контура — резать не надо.', head: [], rows: [] })
    return {
      title: `Лист №${sheet.id}`,
      subtitle: `ряд ${sheet.row + 1}, ${sheet.w}×${sheet.h} мм, в контуре ${f(sheet.areaM2, 3)} м², ${sheet.status === 'full' ? 'целый' : 'резать'}`,
      svg: o.drawing?.(sheet), tables,
    }
  })

  return { kind: 'contour', title: 'Контур потолка', subtitle: fmtDateRu(o.now ?? new Date()), params, summaryTables, sections }
}
