import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import ArcCalc, { sanitizeArcSaved } from '../ArcCalc'
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

describe('отступы от крайней линии', () => {
  it('в таблице ординат есть столбец отступов и переключатель', () => {
    const html = renderToString(createElement(ArcCalc))
    expect(html).toContain('от верхней')
    expect(html).toContain('От нижней')
  })
})


describe('ArcCalc: наклонная поверхность', () => {
  const renderIncl = () => {
    const g = globalThis as unknown as { window?: unknown }
    const prev = g.window
    g.window = {
      localStorage: {
        getItem: () => JSON.stringify({ incl: true, chord: 20860, sagitta: 1900, dropH: 1200, offsetH: 2250, orientation: 'along' }),
        setItem: () => undefined,
      },
    }
    try { return renderToString(createElement(ArcCalc)) } finally { g.window = prev }
  }
  it('по умолчанию наклон выключен', () => {
    expect(sanitizeArcSaved({}).incl).toBe(false)
  })
  it('с включённым наклоном: цифры развёртки, таблица координат, нижняя кромка', () => {
    const html = renderIncl()
    expect(html).toContain('2550')               // длина стойки
    expect(html).toContain('Координаты кромки на развёртке')
    expect(html).toContain('Нижняя кромка')
    expect(html).toContain('Верхняя кромка')
    expect(html).not.toContain('+ Добавить дугу') // в режиме наклона дуги не добавляются
  })
  it('сохраняет и читает поля наклона', () => {
    const v = sanitizeArcSaved({ incl: true, dropH: 900, offsetH: 1500 })
    expect(v.incl).toBe(true)
    expect(v.dropH).toBe(900)
    expect(v.offsetH).toBe(1500)
  })
})
