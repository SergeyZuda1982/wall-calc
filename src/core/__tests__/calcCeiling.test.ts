import { describe, it, expect } from 'vitest'
import { calcCeiling } from '../calcCeiling'
import type { CeilingSpec } from '../../data/ceilingData'

// Помещение 4000×5000мм = 20м², периметр 18м
const BASE: CeilingSpec & { roomLengthMm: number; roomWidthMm: number; sheetLengthMm: number } = {
  type: 'p112',
  layers: 1,
  material: 'gsp',
  thickness: 12.5,
  stepC: 600,
  areaSqm: 20,
  perimeterM: 18,
  roomLengthMm: 5000,
  roomWidthMm: 4000,
  sheetLengthMm: 2500,
}

describe('calcCeiling — П112.1 (20м², шаг 600мм)', () => {
  const res = calcCeiling(BASE)

  it('нет предупреждений', () => {
    expect(res.warnings).toHaveLength(0)
  })

  it('площадь и периметр переданы корректно', () => {
    expect(res.areaSqm).toBe(20)
    expect(res.perimeterM).toBe(18)
  })

  it('ПП 60×27 — 64 пог.м (3.2 × 20)', () => {
    const item = res.materials.find(m => m.name === 'Профиль ПП 60×27')
    expect(item).toBeDefined()
    expect(item!.qty).toBe(64)
  })

  it('Подвесы прямые — 26 шт (1.3 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('Подвес прямой'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(26)
  })

  it('Дюбели анкерные — 26 шт (1.3 × 20)', () => {
    const item = res.materials.find(m => m.name === 'Дюбель анкерный')
    expect(item).toBeDefined()
    expect(item!.qty).toBe(26)
  })

  it('ГСП 12.5мм — 20 м²', () => {
    const item = res.materials.find(m => m.name.includes('ГСП'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(20)
  })

  it('Шуруп TN 25мм — 340 шт (17 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('TN 25'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(340)
  })

  it('Соединитель двухуровневый — 46 шт (ceil(2.3 × 20))', () => {
    const item = res.materials.find(m => m.name.includes('двухуровневый'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(46)
  })

  it('Лента разделительная — по периметру 18 пог.м', () => {
    const item = res.materials.find(m => m.name.includes('разделительная'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(18)
  })
})

describe('calcCeiling — П112.2 двухслойный', () => {
  const res = calcCeiling({ ...BASE, layers: 2 })

  it('ГСП 12.5мм — 40 м² (2 слоя)', () => {
    const item = res.materials.find(m => m.name.includes('ГСП'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(40)
  })

  it('Шуруп TN 25мм — 180 шт (9 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('TN 25'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(180)
  })

  it('Шуруп TN 35мм — 340 шт (17 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('TN 35'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(340)
  })
})

describe('calcCeiling — П113.1 (одноуровневый)', () => {
  const res = calcCeiling({ ...BASE, type: 'p113', stepC: 800 })

  it('ПП 60×27 — 58 пог.м (2.9 × 20)', () => {
    const item = res.materials.find(m => m.name === 'Профиль ПП 60×27')
    expect(item).toBeDefined()
    expect(item!.qty).toBe(58)
  })

  it('ПН 28×27 — по периметру 18 пог.м', () => {
    const item = res.materials.find(m => m.name.includes('ПН 28×27'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(18)
  })

  it('Соединитель одноуровневый — 34 шт (ceil(1.7 × 20))', () => {
    const item = res.materials.find(m => m.name.includes('одноуровневый'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(34)
  })

  it('Шуруп TN 25мм — 460 шт (23 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('TN 25'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(460)
  })
})

describe('calcCeiling — П131.1', () => {
  const res = calcCeiling({ ...BASE, type: 'p131', stepC: 500 })

  it('ПН профиль — 16 пог.м (0.8 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('ПН 50'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(16)
  })

  it('ПС несущий — 38 пог.м (1.9 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('ПС несущий'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(38)
  })

  it('нет подвесов', () => {
    const item = res.materials.find(m => m.name.includes('Подвес'))
    expect(item).toBeUndefined()
  })
})

describe('calcCeiling — П19 заглушка', () => {
  const res = calcCeiling({ ...BASE, type: 'p19' })

  it('нет материалов', () => {
    expect(res.materials).toHaveLength(0)
  })

  it('есть предупреждение', () => {
    expect(res.warnings.length).toBeGreaterThan(0)
    expect(res.warnings[0]).toContain('П19')
  })
})

describe('calcCeilingSheetLayout — раскрой 5000×4000мм', () => {
  const res = calcCeiling(BASE)
  const layout = res.sheetLayout!

  it('layout существует', () => {
    expect(layout).not.toBeNull()
  })

  it('sheetW = 1200, sheetL = 2500', () => {
    expect(layout.sheetW).toBe(1200)
    expect(layout.sheetL).toBe(2500)
  })

  it('stepB = 500мм', () => {
    expect(layout.stepB).toBe(500)
  })

  it('stepA = 1150мм (шаг подвесов, П112, c=600)', () => {
    expect(layout.stepA).toBe(1150)
  })

  it('rowCount = 2 (4000 / 2500 → 2 ряда)', () => {
    expect(layout.rowCount).toBe(2)
  })

  it('colCount = 5 (5000 / 1200 → 5 колонок)', () => {
    expect(layout.colCount).toBe(5)
  })

  it('totalSheets = 10', () => {
    expect(layout.totalSheets).toBe(10)
  })
})
