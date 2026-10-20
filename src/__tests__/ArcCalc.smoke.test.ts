import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import ArcCalc from '../ArcCalc'
import { labelIndices } from '../core/calcArcLayout'

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

describe('labelIndices (шаг подписей)', () => {
  const dus = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500]
  it('шаг 250: 0, 250, 500', () => {
    expect([...labelIndices(dus, 250)]).toEqual([0, 5, 10])
  })
  it('шаг 100: 0, 100, 200, ... и последняя', () => {
    expect([...labelIndices(dus, 100)].sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10])
  })
  it('шаг равен шагу отметок: подписана каждая точка', () => {
    expect(labelIndices(dus, 50).size).toBe(dus.length)
  })
  it('шаг не кратен шагу отметок: подписи всё равно идут, последняя всегда', () => {
    const r = [...labelIndices(dus, 120)].sort((a, b) => a - b)
    expect(r[0]).toBe(0)
    expect(r[r.length - 1]).toBe(10)
    expect(r.length).toBeGreaterThan(3)
  })
  it('в экране есть поле шага подписей', () => {
    expect(renderToString(createElement(ArcCalc))).toContain('Шаг подписей')
  })
})
