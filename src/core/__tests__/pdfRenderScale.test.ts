import { describe, it, expect } from 'vitest'
import { pickRenderScale } from '../pdfRenderScale'

describe('pickRenderScale', () => {
  it('маленький лист (А4-подобный, ~842pt по длинной стороне) получает БОЛЬШИЙ масштаб, чем большой (А1, ~1683pt)', () => {
    const a4Scale = pickRenderScale(842)
    const a1Scale = pickRenderScale(1683)
    expect(a4Scale).toBeGreaterThan(a1Scale)
  })

  it('главная цель: итоговое разрешение (longSide × scale) примерно одинаковое у разных форматов', () => {
    const a4 = 842, a1 = 1683, a0 = 2384
    const results = [a4, a1, a0].map(longSide => longSide * pickRenderScale(longSide))
    // Разброс итогового разрешения между форматами небольшой (в разумных пределах,
    // а не отличается в разы, как было при одном фиксированном множителе на всех)
    const min = Math.min(...results), max = Math.max(...results)
    expect(max / min).toBeLessThan(1.5)
  })

  it('явно заданный renderScale имеет приоритет над targetLongSidePx', () => {
    expect(pickRenderScale(1000, { renderScale: 3, targetLongSidePx: 9999 })).toBe(3)
  })

  it('огромный targetLongSidePx (запрос дорендера при сильном зуме) не превышает жёсткий потолок MAX_RENDER_SCALE', () => {
    const scale = pickRenderScale(500, { targetLongSidePx: 100000 })
    expect(scale).toBeLessThanOrEqual(8)
  })

  it('очень большой лист не даёт масштаб меньше нижнего предела (совсем крошечная картинка)', () => {
    const scale = pickRenderScale(10000)
    expect(scale).toBeGreaterThanOrEqual(1.5)
  })

  it('nativeLongSidePx=0 (защита от деления на 0) — не падает, минимальный масштаб', () => {
    expect(pickRenderScale(0)).toBe(1.5)
    expect(pickRenderScale(-5)).toBe(1.5)
  })

  it('targetLongSidePx выше MAX_TARGET_LONG_SIDE_PX обрезается потолком (6000)', () => {
    // При очень маленьком листе (100pt) без обрезки масштаб был бы 6000/100=60,
    // с обрезкой цели потолком 6000 масштаб не должен быть безумно большим —
    // ограничен MAX_RENDER_SCALE=8 в любом случае
    const scale = pickRenderScale(100, { targetLongSidePx: 999999 })
    expect(scale).toBeLessThanOrEqual(8)
  })
})
