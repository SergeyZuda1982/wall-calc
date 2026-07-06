import { describe, it, expect } from 'vitest'
import { TAXONOMY, getWallThicknessMm, getSpecAbbr } from '../constructionTaxonomy'

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
