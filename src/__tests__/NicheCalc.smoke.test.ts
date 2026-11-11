import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import NicheCalc from '../NicheCalc'
import { wrapCalcFile, parseCalcFile, calcFileName } from '../core/calcFile'

describe('NicheCalc', () => {
  it('рисуется с примером: план, таблицы участков и изломов', () => {
    const html = renderToStaticMarkup(createElement(NicheCalc))
    expect(html).toContain('Ломаная стена')
    expect(html).toContain('<svg')
    expect(html).toContain('Профиль по участкам')
    expect(html).toContain('Изломы')
  })

  it('файл расчёта kind=niche: туда-обратно, чужой тип отклоняется', () => {
    const text = wrapCalcFile('niche', { startDepth: 0, segs: [] })
    expect(parseCalcFile(text, 'niche')).toEqual({ startDepth: 0, segs: [] })
    expect(() => parseCalcFile(text, 'arc')).toThrow(/Ломаной стены/)
    expect(calcFileName('niche', new Date(2026, 10, 11))).toBe('nisha-2026-11-11.json')
  })
})
