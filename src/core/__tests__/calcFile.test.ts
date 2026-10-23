import { describe, expect, it } from 'vitest'
import { calcFileName, parseCalcFile, wrapCalcFile } from '../calcFile'
import { sanitizeArcSaved } from '../../ArcCalc'
import { parseSaved } from '../../ContourCalc'
import { sketchExample } from '../contourEdit'

describe('calcFile', () => {
  it('круг: обёртка → разбор возвращает те же данные', () => {
    const data = { chord: 20800, gaps: [300] }
    expect(parseCalcFile(wrapCalcFile('arc', data), 'arc')).toEqual(data)
  })
  it('чужие и битые файлы отклоняются с понятным текстом', () => {
    expect(() => parseCalcFile('не json', 'arc')).toThrow(/не JSON/)
    expect(() => parseCalcFile('{"a":1}', 'arc')).toThrow(/не файл расчёта/)
    expect(() => parseCalcFile(wrapCalcFile('contour', {}), 'arc')).toThrow(/Контура потолка/)
    expect(() => parseCalcFile(wrapCalcFile('arc', {}), 'contour')).toThrow(/Разметки дуги/)
  })
  it('имя файла с датой', () => {
    expect(calcFileName('arc', new Date(2026, 9, 23))).toBe('duga-2026-10-23.json')
    expect(calcFileName('contour', new Date(2026, 9, 3))).toBe('kontur-2026-10-03.json')
  })
})

describe('sanitizeArcSaved', () => {
  it('мусор заменяется значениями по умолчанию', () => {
    const v = sanitizeArcSaved({ chord: 'x', gaps: [100, 'a', NaN], mode: 'zzz', hidden: [0, 7] })
    expect(v.chord).toBe(20800); expect(v.gaps).toEqual([100]); expect(v.mode).toBe('sagitta'); expect(v.hidden).toEqual([0])
  })
  it('полный круг через файл', () => {
    const src = { ...sanitizeArcSaved({}), chord: 18000, sagitta: 1500, gaps: [250, 300], shiftU: 120, orientation: 'along', offFrom: 'bottom' }
    const back = sanitizeArcSaved(parseCalcFile(wrapCalcFile('arc', src), 'arc'))
    expect(back).toEqual(sanitizeArcSaved(src))
    expect(back.gaps).toEqual([250, 300]); expect(back.orientation).toBe('along')
  })
})

describe('parseSaved (контур)', () => {
  it('замкнутый контур и настройки восстанавливаются из файла', () => {
    const vertices = sketchExample()
    const data = { vertices, closed: true, refEdge: 2, settings: { shiftU: 50, step: 100 }, draft: { segments: [], pending: null } }
    const v = parseSaved(parseCalcFile(wrapCalcFile('contour', data), 'contour'))
    expect(v.closed).toBe(true); expect(v.vertices).toHaveLength(vertices.length); expect(v.refEdge).toBe(2)
    expect(v.settings.shiftU).toBe(50); expect(v.settings.sheetW).toBe(1200)
  })
  it('пустой мусор даёт пустой контур', () => {
    const v = parseSaved({ vertices: 5 })
    expect(v.vertices).toEqual([]); expect(v.closed).toBe(false)
  })
})
