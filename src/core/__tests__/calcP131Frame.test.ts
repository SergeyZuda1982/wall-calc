import { describe, it, expect } from 'vitest'
import { calcP131FrameGeometry } from '../calcP131Frame'
import { calcFrameRowPositions } from '../calcP112Frame'
import { P131_MAX_SPAN_SINGLE_MM } from '../../data/ceilingData'

describe('calcP131FrameGeometry — базовая геометрия (одинарный ПС)', () => {
  it('ПС расставлены вдоль A с шагом stepMm — та же формула, что и calcFrameRowPositions', () => {
    const geo = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    const expected = calcFrameRowPositions(5000, 500, { mode: 'user' })
    expect(geo.psPositions).toEqual(expected)
    expect(geo.psCount).toBe(expected.length)
  })

  it('длина каждого ПС = пролёт B (между двумя длинными стенами)', () => {
    const geo = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    expect(geo.psLengthEachMm).toBe(4000)
  })

  it('pnAlongLength=false — A и B меняются местами (ПН вдоль ширины, ПС перекрывает длину)', () => {
    const alongLength = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    const alongWidth = calcP131FrameGeometry(5000, 4000, 500, false, 1)
    expect(alongLength.psLengthEachMm).toBe(4000) // B = roomWidthMm
    expect(alongWidth.psLengthEachMm).toBe(5000)  // B = roomLengthMm
  })

  it('ПН — ровно 2 рейки по длине A (только 2 длинные стены, не весь периметр)', () => {
    const geo = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    expect(geo.pnTotalLm).toBeCloseTo((2 * 5000) / 1000)
  })

  it('psTotalLm = psCount × psLengthEachMm / 1000 при одинарном ПС (layers=1)', () => {
    const geo = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    expect(geo.psTotalLm).toBeCloseTo((geo.psCount * geo.psLengthEachMm) / 1000)
  })
})

describe('calcP131FrameGeometry — спаренный ПС (layers=2)', () => {
  it('psTotalLm ровно вдвое больше, чем при одинарном ПС, при тех же размерах', () => {
    const single = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    const paired = calcP131FrameGeometry(5000, 4000, 500, true, 2)
    expect(paired.psCount).toBe(single.psCount) // позиции те же — те же ряды, просто по 2 профиля
    expect(paired.psTotalLm).toBeCloseTo(single.psTotalLm * 2)
  })

  it('ПН не меняется от layers (спаривается только ПС, не ПН)', () => {
    const single = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    const paired = calcP131FrameGeometry(5000, 4000, 500, true, 2)
    expect(paired.pnTotalLm).toBeCloseTo(single.pnTotalLm)
  })
})

describe('calcP131FrameGeometry — предупреждение о превышении официального лимита пролёта', () => {
  it('одинарный ПС, пролёт B ≤ 4250мм — без предупреждения', () => {
    const geo = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    expect(geo.spanWarning).toBeUndefined()
  })

  it('одинарный ПС, пролёт B > 4250мм — предупреждение с указанием лимита', () => {
    const geo = calcP131FrameGeometry(5000, 5000, 500, true, 1)
    expect(geo.spanWarning).toBeDefined()
    expect(geo.spanWarning).toContain(String(P131_MAX_SPAN_SINGLE_MM))
  })

  it('спаренный ПС (layers=2), пролёт B > 4250мм — без предупреждения (официального лимита нет)', () => {
    const geo = calcP131FrameGeometry(5000, 5000, 500, true, 2)
    expect(geo.spanWarning).toBeUndefined()
  })
})

describe('calcP131FrameGeometry — удлинители (пролёт B длиннее стандартного хлыста 3000мм)', () => {
  it('psExtenders > 0, когда B > 3000мм', () => {
    const geo = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    expect(geo.psExtenders).toBeGreaterThan(0)
    expect(geo.psExtenders).toBe(geo.psCount) // ceil(4000/3000)-1 = 1 удлинитель на кусок
  })

  it('psExtenders = 0, когда B ≤ 3000мм', () => {
    const geo = calcP131FrameGeometry(5000, 2800, 500, true, 1)
    expect(geo.psExtenders).toBe(0)
  })

  it('спаренный ПС — удлинители считаются на КАЖДЫЙ из двух профилей пары', () => {
    const single = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    const paired = calcP131FrameGeometry(5000, 4000, 500, true, 2)
    expect(paired.psExtenders).toBe(single.psExtenders * 2)
  })

  it('pnExtenders > 0, когда A > 3000мм', () => {
    const geo = calcP131FrameGeometry(5000, 4000, 500, true, 1)
    expect(geo.pnExtenders).toBeGreaterThan(0)
    expect(geo.pnExtenders).toBe(2) // 2 рейки, по 1 удлинителю каждая (5000мм)
  })
})

describe('calcP131FrameGeometry — вырожденные случаи', () => {
  it('нулевой пролёт -> нулевые счётчики, не падает', () => {
    const geo = calcP131FrameGeometry(0, 0, 500, true, 1)
    expect(geo.psCount).toBe(0)
    expect(geo.psTotalLm).toBe(0)
    expect(geo.pnTotalLm).toBe(0)
  })
})
