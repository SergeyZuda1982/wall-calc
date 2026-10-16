import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import ArcCalc from '../ArcCalc'

describe('ArcCalc', () => {
  const html = renderToString(createElement(ArcCalc))
  it('рисуется с данными по умолчанию: схема, чертёж листа, таблица', () => {
    expect(html).toContain('Разметка дуги')
    expect(html).toContain('Лист №')
    expect(html).toContain('Ординаты дуги')
    expect(html).toContain('<polyline')
  })
  it('по умолчанию одна дуга, остальные добавляются кнопкой', () => {
    expect(html).toContain('+ Добавить дугу')
    expect(html).toContain('Дуга 1')
    expect(html).not.toContain('Дуга 2')
  })
})
