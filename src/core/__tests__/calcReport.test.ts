import { describe, expect, it } from 'vitest'
import { calcArcLayout, geometryFromChordSagitta } from '../calcArcLayout'
import { calcContourLayout, contourAreaMm2, contourPerimeterMm, defaultRefEdge } from '../calcContourLayout'
import { sketchExample } from '../contourEdit'
import { buildArcReport } from '../arcReport'
import { buildContourReport } from '../contourReport'
import { excelSheetName, prepareSvgForRaster, reportFileName } from '../calcReport'

describe('calcReport helpers', () => {
  it('имя файла', () => {
    expect(reportFileName('arc', 'xlsx', new Date(2026, 9, 23))).toBe('duga-2026-10-23.xlsx')
    expect(reportFileName('contour', 'pdf', new Date(2026, 0, 5))).toBe('kontur-2026-01-05.pdf')
  })
  it('имя листа Excel: без запрещённых символов, уникальное, до 31', () => {
    const used = new Set<string>()
    expect(excelSheetName('Лист №1', used)).toBe('Лист №1')
    expect(excelSheetName('Лист №1', used)).toBe('Лист №1 (2)')
    expect(excelSheetName('a/b:c*d?[e]', used)).toBe('a b c d  e')
    expect(excelSheetName('x'.repeat(50), used).length).toBeLessThanOrEqual(31)
  })
  it('подготовка svg: размеры по viewBox, без style и подписи «низ листа»', () => {
    const svg = '<svg viewBox="0 0 200 100" style="width:100%"><text>низ листа — x</text><rect/></svg>'
    const r = prepareSvgForRaster(svg, 1000)!
    expect(r.w).toBe(1000); expect(r.h).toBe(500)
    expect(r.svg).toContain('width="1000"'); expect(r.svg).not.toContain('style='); expect(r.svg).not.toContain('низ листа')
    expect(prepareSvgForRaster('<svg></svg>', 100)).toBeNull()
  })
})

describe('buildArcReport', () => {
  const geom = geometryFromChordSagitta(20800, 1900)
  const layout = calcArcLayout({ geometry: geom, sheetWidth: 1200, sheetLength: 2500, orientation: 'across', shiftU: 0, shiftV: 0, stagger: 0, step: 300 })
  const base = { geom, sheets: layout.sheets, shown: [0], labelStep: 300, offFrom: 'top' as const, orientation: 'across' as const,
    sheetW: 1200, sheetL: 2500, shiftU: 0, shiftV: 0, stagger: 0, step: 300 }
  it('все листы и отметки листа 1 как в разметке дуги', () => {
    const r = buildArcReport({ ...base, sheetIds: 'all' })
    expect(r.sections).toHaveLength(layout.sheets.length)
    const t = r.sections[0].tables[0]
    expect(t.rows.map(x => x[1])).toEqual([0, 112, 219, 324, 424])
    expect(t.rows.map(x => x[2])).toEqual([424, 312, 205, 100, 0])
    expect(r.params.find(p => p[0] === 'Листов в раскладке')![1]).toBe(String(layout.sheets.length))
  })
  it('один выбранный лист', () => {
    expect(buildArcReport({ ...base, sheetIds: [3] }).sections.map(s => s.title)).toEqual(['Лист №3'])
  })
})

describe('buildContourReport', () => {
  const vertices = sketchExample()
  const ref = defaultRefEdge(vertices)
  const layout = calcContourLayout({ vertices, refEdge: ref, sheetWidth: 1200, sheetLength: 2500, orientation: 'across', shiftU: 0, shiftV: 0, stagger: 0, step: 50 })
  const rep = buildContourReport({
    vertices, layout, areaM2: contourAreaMm2(vertices) / 1e6, perimeterM: contourPerimeterMm(vertices) / 1e3,
    sheetW: 1200, sheetL: 2500, orientation: 'across', shiftU: 0, shiftV: 0, stagger: 0, step: 50, labelStep: 250,
    refSide: ref + 1, offFrom: 'top', sideName: e => `сторона ${e + 1}`, sheetIds: 'all',
  })
  it('сводка и вершины', () => {
    expect(rep.params[0]).toEqual(['Площадь потолка, м²', '72,99'])
    expect(rep.summaryTables[0].rows).toHaveLength(vertices.length)
    expect(rep.sections).toHaveLength(layout.sheetCount)
  })
  it('у листа с дугой есть таблица ординат с отступами', () => {
    const withArc = rep.sections.find(s => s.tables.some(t => t.title.startsWith('Ординаты')))!
    const t = withArc.tables.find(x => x.title.startsWith('Ординаты'))!
    expect(t.head).toHaveLength(3)
    expect(t.rows[0]).toHaveLength(3)
  })
})
