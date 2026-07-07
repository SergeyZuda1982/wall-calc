import { describe, it, expect } from 'vitest'
import { TAXONOMY, getWallThicknessMm, getSpecAbbr, isLiningLayersFixed } from '../constructionTaxonomy'

describe('wall_lining — ПС100 (frame_ps100)', () => {
  it('присутствует в дереве материалов wall_lining:gkl', () => {
    const gklNode = TAXONOMY.wall_lining.find(n => n.value === 'gkl')
    const child = gklNode?.children?.find(n => n.value === 'frame_ps100')
    expect(child).toBeDefined()
    expect(child?.abbr).toBe('К100')
  })

  it('толщина стены для frame_ps100 = 115мм (профиль 100 + ~15мм обшивка)', () => {
    expect(getWallThicknessMm('wall_lining', 'gkl', 'frame_ps100')).toBe(115)
  })

  it('frame_ps50/frame_ps75 по-прежнему работают (регрессия)', () => {
    expect(getWallThicknessMm('wall_lining', 'gkl', 'frame_ps50')).toBe(65)
    expect(getWallThicknessMm('wall_lining', 'gkl', 'frame_ps75')).toBe(90)
  })

  it('аббревиатура на холсте включает К100', () => {
    const abbr = getSpecAbbr('wall_lining', 'gkl', 'frame_ps100')
    expect(abbr).toContain('К100')
  })
})

describe('wall_lining — ПС50 (frame_ps50) фиксирован на 2 слоя, С625 не бывает', () => {
  it('isLiningLayersFixed: true только для wall_lining + frame_ps50', () => {
    expect(isLiningLayersFixed('wall_lining', 'frame_ps50')).toBe(true)
    expect(isLiningLayersFixed('wall_lining', 'frame_ps75')).toBe(false)
    expect(isLiningLayersFixed('wall_lining', 'frame_ps100')).toBe(false)
    // wall_new (перегородки) — ПС50 там валиден и с 1, и с 2 слоями (С111/С112), не трогаем
    expect(isLiningLayersFixed('wall_new', 'ps50')).toBe(false)
  })

  it('аббревиатура на холсте показывает ·2сл для ПС50 даже без явного spec.layers', () => {
    const abbrNoLayers = getSpecAbbr('wall_lining', 'gkl', 'frame_ps50')
    expect(abbrNoLayers).toContain('·2сл')
    // тот же результат, даже если у старой линии по ошибке записан layers:1
    const abbrLegacyOneLayer = getSpecAbbr('wall_lining', 'gkl', 'frame_ps50', undefined, 1)
    expect(abbrLegacyOneLayer).toContain('·2сл')
  })

  it('для ПС75/ПС100 однослойных линий ·2сл НЕ показывается (регрессия)', () => {
    expect(getSpecAbbr('wall_lining', 'gkl', 'frame_ps75', undefined, 1)).not.toContain('·2сл')
    expect(getSpecAbbr('wall_lining', 'gkl', 'frame_ps100')).not.toContain('·2сл')
  })
})
