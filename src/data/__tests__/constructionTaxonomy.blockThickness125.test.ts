import { describe, it, expect } from 'vitest'
import { TAXONOMY, getWallThicknessMm } from '../constructionTaxonomy'

/**
 * 08.07.2026 — пользователь оцифровывал реальную квартиру, встретил
 * перегородку 125мм ("бетонные блоки" со слов замерщика, подозревается
 * пенобетон — такие блоки 125мм реально существуют в продаже).
 * Раньше в таксономии этой толщины не было ни у одной блочной категории.
 */
describe('125мм блок — таксономия и толщина', () => {
  it('wall_existing:block содержит опцию 125мм', () => {
    const block = TAXONOMY.wall_existing.find(n => n.value === 'block')
    const opt = block?.children?.find(c => c.value === '125')
    expect(opt).toBeDefined()
    expect(opt?.label).toContain('125')
  })

  it('wall_new:gasblock содержит опцию 125мм', () => {
    const gasblock = TAXONOMY.wall_new.find(n => n.value === 'gasblock')
    const opt = gasblock?.children?.find(c => c.value === '125')
    expect(opt).toBeDefined()
  })

  it('wall_new:foamblock содержит опцию 125мм', () => {
    const foamblock = TAXONOMY.wall_new.find(n => n.value === 'foamblock')
    const opt = foamblock?.children?.find(c => c.value === '125')
    expect(opt).toBeDefined()
  })

  it('getWallThicknessMm возвращает 125 для existing block/125', () => {
    expect(getWallThicknessMm('wall_existing', 'block', '125')).toBe(125)
  })

  it('getWallThicknessMm возвращает 125 для new gasblock/125 и foamblock/125', () => {
    expect(getWallThicknessMm('wall_new', 'gasblock', '125')).toBe(125)
    expect(getWallThicknessMm('wall_new', 'foamblock', '125')).toBe(125)
  })
})
