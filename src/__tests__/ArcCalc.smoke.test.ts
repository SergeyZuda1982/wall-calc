import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import ArcCalc from '../ArcCalc'

describe('ArcCalc', () => {
  it('рисуется с данными по умолчанию: схема, чертёж листа 1, таблица', () => {
    const html = renderToString(createElement(ArcCalc))
    expect(html).toContain('Разметка дуги')
    expect(html).toContain('Лист №')
    expect(html).toContain('Ординаты дуги')
    expect(html).toContain('<polyline')
  })
})
