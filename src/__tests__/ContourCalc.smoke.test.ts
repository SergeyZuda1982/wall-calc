import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import ContourCalc from '../ContourCalc'

describe('ContourCalc', () => {
  const html = renderToString(createElement(ContourCalc))
  it('рисуется пустым: заголовок, режимы, привязка и кнопка примера', () => {
    expect(html).toContain('Контур потолка')
    expect(html).toContain('Рисовать')
    expect(html).toContain('Править')
    expect(html).toContain('Листы')
    expect(html).toContain('Привязка при рисовании')
    expect(html).toContain('Пример с эскиза')
  })
  it('холст — svg с подсказкой про первую вершину', () => {
    expect(html).toContain('<svg')
    expect(html).toContain('поставить первую вершину')
  })
  it('в подсказке есть правая кнопка мыши', () => {
    expect(html).toContain('Правая кнопка мыши')
  })
  it('без контура итогов нет', () => {
    expect(html).not.toContain('Площадь потолка')
  })
})
