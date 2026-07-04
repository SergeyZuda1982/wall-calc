import { describe, it, expect } from 'vitest'
import {
  parseDoubleFrameSubtype,
  getDoubleFrameLayerCounts,
  getDoubleFrameThicknessMm,
  getWallThicknessMm,
  TAXONOMY,
} from '../constructionTaxonomy'

describe('parseDoubleFrameSubtype', () => {
  it('разбирает валидные комбинации тип+профиль', () => {
    expect(parseDoubleFrameSubtype('c115_1_ps50')).toEqual({ dfType: 'c115_1', profile: 'ps50' })
    expect(parseDoubleFrameSubtype('c115_2_ps75')).toEqual({ dfType: 'c115_2', profile: 'ps75' })
    expect(parseDoubleFrameSubtype('c115_3_ps100')).toEqual({ dfType: 'c115_3', profile: 'ps100' })
    expect(parseDoubleFrameSubtype('c116_ps50')).toEqual({ dfType: 'c116', profile: 'ps50' })
  })

  it('возвращает null для обычных (не двойных) подтипов', () => {
    expect(parseDoubleFrameSubtype('ps50')).toBeNull()
    expect(parseDoubleFrameSubtype('double')).toBeNull()
    expect(parseDoubleFrameSubtype('ps125')).toBeNull()
    expect(parseDoubleFrameSubtype(undefined)).toBeNull()
  })

  it('возвращает null для неизвестного профиля с валидным префиксом', () => {
    expect(parseDoubleFrameSubtype('c115_1_ps999')).toBeNull()
  })
})

describe('getDoubleFrameLayerCounts', () => {
  it('c115_1 — 2+2 без разделителя', () => {
    expect(getDoubleFrameLayerCounts('c115_1')).toEqual({ sideA: 2, sideB: 2, hasSeparator: false })
  })
  it('c115_2 — 2+2 с разделителем', () => {
    expect(getDoubleFrameLayerCounts('c115_2')).toEqual({ sideA: 2, sideB: 2, hasSeparator: true })
  })
  it('c115_3 — асимметрично 2+3', () => {
    expect(getDoubleFrameLayerCounts('c115_3')).toEqual({ sideA: 2, sideB: 3, hasSeparator: false })
  })
  it('c116 — как c115_1 (2+2, без разделителя)', () => {
    expect(getDoubleFrameLayerCounts('c116')).toEqual({ sideA: 2, sideB: 2, hasSeparator: false })
  })
})

describe('getDoubleFrameThicknessMm', () => {
  it('c115_1 + ПС50: 2×50 + 4×12.5 + 3 = 153', () => {
    expect(getDoubleFrameThicknessMm('c115_1', 'ps50')).toBeCloseTo(153, 5)
  })

  it('c115_2 + ПС50: 2×50 + 5×12.5 + 3 = 165.5 (пример из КОНСПЕКТ.md)', () => {
    expect(getDoubleFrameThicknessMm('c115_2', 'ps50')).toBeCloseTo(165.5, 5)
  })

  it('c115_3 + ПС50: 2×50 + 5×12.5 + 3 = 165.5 (тот же суммарный лист, без разделителя)', () => {
    expect(getDoubleFrameThicknessMm('c115_3', 'ps50')).toBeCloseTo(165.5, 5)
  })

  it('c115_3 + ПС100 (проверка на реальной опечатке из КОНСПЕКТ.md: 265.5, не 365.5)', () => {
    expect(getDoubleFrameThicknessMm('c115_3', 'ps100')).toBeCloseTo(265.5, 5)
  })

  it('c116 без явного gapMm использует визуальный дефолт зазора', () => {
    const withDefault = getDoubleFrameThicknessMm('c116', 'ps50')
    const withExplicitDefault = getDoubleFrameThicknessMm('c116', 'ps50', 100)
    expect(withDefault).toBeCloseTo(withExplicitDefault, 5)
  })

  it('c116 с явным gapMm учитывает зазор', () => {
    const gap150 = getDoubleFrameThicknessMm('c116', 'ps50', 150)
    const gap100 = getDoubleFrameThicknessMm('c116', 'ps50', 100)
    expect(gap150 - gap100).toBeCloseTo(50, 5)
  })

  it('профиль ПС75 даёт большую толщину, чем ПС50, при одном dfType', () => {
    const ps50 = getDoubleFrameThicknessMm('c115_1', 'ps50')
    const ps75 = getDoubleFrameThicknessMm('c115_1', 'ps75')
    expect(ps75 - ps50).toBeCloseTo(50, 5) // разница в профиле ×2 стороны = (75-50)*2
  })
})

describe('getWallThicknessMm — интеграция с двойным каркасом', () => {
  it('делегирует к формуле двойного каркаса для новых подтипов', () => {
    const direct = getDoubleFrameThicknessMm('c115_1', 'ps75')
    expect(getWallThicknessMm('wall_new', 'gkl', 'c115_1_ps75')).toBeCloseTo(direct, 5)
  })

  it('старые подтипы (ps50/double) считаются как раньше, не через двойной каркас', () => {
    expect(getWallThicknessMm('wall_new', 'gkl', 'ps50')).toBe(75)
    expect(getWallThicknessMm('wall_new', 'gkl', 'double')).toBe(200)
  })

  it('gapMm прокидывается через getWallThicknessMm для c116', () => {
    const t = getWallThicknessMm('wall_new', 'gkl', 'c116_ps50', 200)
    expect(t).toBeCloseTo(getDoubleFrameThicknessMm('c116', 'ps50', 200), 5)
  })
})

describe('TAXONOMY — узлы двойного каркаса присутствуют для всех 4 систем × 3 профилей', () => {
  it('wall_new:gkl содержит все 12 комбинаций + старый общий "double"', () => {
    const gklNode = TAXONOMY.wall_new.find(n => n.value === 'gkl')
    const values = (gklNode?.children ?? []).map(c => c.value)
    for (const dfType of ['c115_1', 'c115_2', 'c115_3', 'c116']) {
      for (const profile of ['ps50', 'ps75', 'ps100']) {
        expect(values).toContain(`${dfType}_${profile}`)
      }
    }
    expect(values).toContain('double')
  })
})
