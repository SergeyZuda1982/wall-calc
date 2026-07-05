import { describe, it, expect } from 'vitest'
import {
  finishMaterialCategoryOf,
  finishSidesOf,
  nextBaseStage,
  prevBaseStage,
  finishBaseStageLabel,
} from '../finishResolver'
import type { PlanLine } from '../../types'

function line(overrides: Partial<PlanLine>): PlanLine {
  return { id: 'L1', x1: 0, y1: 0, x2: 1000, y2: 0, type: 'wall_new', lengthMm: 1000, label: 'Л1', ...overrides } as PlanLine
}

describe('finishMaterialCategoryOf', () => {
  it('wall_existing — всегда masonry, независимо от spec.material', () => {
    expect(finishMaterialCategoryOf(line({ type: 'wall_existing', spec: { material: 'brick' } }))).toBe('masonry')
    expect(finishMaterialCategoryOf(line({ type: 'wall_existing', spec: { material: 'concrete' } }))).toBe('masonry')
    expect(finishMaterialCategoryOf(line({ type: 'wall_existing' }))).toBe('masonry')
  })

  it('wall_new gkl — gkl', () => {
    expect(finishMaterialCategoryOf(line({ spec: { material: 'gkl' } }))).toBe('gkl')
  })

  it('wall_new кладка (brick/gasblock/foamblock) — masonry', () => {
    expect(finishMaterialCategoryOf(line({ spec: { material: 'brick' } }))).toBe('masonry')
    expect(finishMaterialCategoryOf(line({ spec: { material: 'gasblock' } }))).toBe('masonry')
    expect(finishMaterialCategoryOf(line({ spec: { material: 'foamblock' } }))).toBe('masonry')
  })

  it('wall_lining gkl — gkl', () => {
    expect(finishMaterialCategoryOf(line({ type: 'wall_lining', spec: { material: 'gkl' } }))).toBe('gkl')
  })

  it('wall_lining плитка/штукатурка напрямую — null (сама линия уже покрытие)', () => {
    expect(finishMaterialCategoryOf(line({ type: 'wall_lining', spec: { material: 'tile' } }))).toBeNull()
    expect(finishMaterialCategoryOf(line({ type: 'wall_lining', spec: { material: 'plaster' } }))).toBeNull()
  })

  it('ceiling/floor/rib_beam — null', () => {
    expect(finishMaterialCategoryOf(line({ type: 'ceiling' }))).toBeNull()
    expect(finishMaterialCategoryOf(line({ type: 'floor' }))).toBeNull()
    expect(finishMaterialCategoryOf(line({ type: 'rib_beam' }))).toBeNull()
  })
})

describe('finishSidesOf', () => {
  it('wall_new/wall_existing применимые — 2 стороны', () => {
    expect(finishSidesOf(line({ spec: { material: 'gkl' } }))).toBe(2)
    expect(finishSidesOf(line({ type: 'wall_existing', spec: { material: 'brick' } }))).toBe(2)
  })

  it('wall_lining gkl — 1 сторона', () => {
    expect(finishSidesOf(line({ type: 'wall_lining', spec: { material: 'gkl' } }))).toBe(1)
  })

  it('неприменимые линии — 0', () => {
    expect(finishSidesOf(line({ type: 'ceiling' }))).toBe(0)
    expect(finishSidesOf(line({ type: 'wall_lining', spec: { material: 'tile' } }))).toBe(0)
  })
})

describe('nextBaseStage / prevBaseStage', () => {
  it('прогресс по порядку naked -> base_done -> puttied -> конец', () => {
    expect(nextBaseStage('naked')).toBe('base_done')
    expect(nextBaseStage('base_done')).toBe('puttied')
    expect(nextBaseStage('puttied')).toBeNull()
  })

  it('откат по порядку puttied -> base_done -> naked -> конец', () => {
    expect(prevBaseStage('puttied')).toBe('base_done')
    expect(prevBaseStage('base_done')).toBe('naked')
    expect(prevBaseStage('naked')).toBeNull()
  })
})

describe('finishBaseStageLabel', () => {
  it('кладка: разные подписи для base_done, чем ГКЛ', () => {
    expect(finishBaseStageLabel('base_done', 'masonry')).toBe('Оштукатурено')
    expect(finishBaseStageLabel('base_done', 'gkl')).toBe('Обшито')
  })

  it('puttied — одинаковая подпись для обеих категорий', () => {
    expect(finishBaseStageLabel('puttied', 'masonry')).toBe(finishBaseStageLabel('puttied', 'gkl'))
  })
})
