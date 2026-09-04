import { describe, it, expect } from 'vitest'
import { buildClosingVolumesReport } from '../closingVolumesReport'
import type { PlanLine, RoundColumn, RectColumn, CeilingSlope, Room } from '../../types'
import { createWorkProgress } from '../workProgress'

function line(overrides: Partial<PlanLine> = {}): PlanLine {
  return {
    id: 'L1', x1: 0, y1: 0, x2: 4000, y2: 0,
    type: 'wall_new', lengthMm: 4000, label: 'П-1',
    ...overrides,
  } as PlanLine
}

const baseInput = { ceilingSlopes: [] as CeilingSlope[], rooms: [] as Room[], defaultHeightMm: 3000, rateBelow: 1200, rateAbove: 1400 }

describe('buildClosingVolumesReport — flat lines, no slope', () => {
  it('перегородка ниже порога — вся по нижней ставке', () => {
    const l = line({ heightMm: 2700 })
    const r = buildClosingVolumesReport({ ...baseInput, lines: [l], roundColumns: [], rectColumns: [] })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].tiers.belowM2).toBeCloseTo(4 * 2.7)
    expect(r.rows[0].tiers.aboveM2).toBe(0)
    expect(r.rows[0].cost).toBeCloseTo(4 * 2.7 * 1200)
    expect(r.totalCost).toBeCloseTo(4 * 2.7 * 1200)
  })

  it('облицовка выше порога — обе ставки', () => {
    const l = line({ id: 'LN', type: 'wall_lining', heightMm: 3500 })
    const r = buildClosingVolumesReport({ ...baseInput, lines: [l], roundColumns: [], rectColumns: [] })
    expect(r.rows[0].kind).toBe('wall_lining')
    expect(r.rows[0].tiers.belowM2).toBeCloseTo(4 * 3)
    expect(r.rows[0].tiers.aboveM2).toBeCloseTo(4 * 0.5)
  })

  it('линии других типов (wall_existing, потолок, ригель) не попадают в отчёт', () => {
    const excluded = ['wall_existing', 'ceiling', 'floor', 'rib_beam'] as const
    const lines = excluded.map((t, i) => line({ id: `X${i}`, type: t }))
    const r = buildClosingVolumesReport({ ...baseInput, lines, roundColumns: [], rectColumns: [] })
    expect(r.rows).toHaveLength(0)
  })

  it('без heightMm — берёт defaultHeightMm', () => {
    const l = line({ heightMm: undefined })
    const r = buildClosingVolumesReport({ ...baseInput, defaultHeightMm: 3200, lines: [l], roundColumns: [], rectColumns: [] })
    expect(r.rows[0].tiers.belowM2).toBeCloseTo(4 * 3)
    expect(r.rows[0].tiers.aboveM2).toBeCloseTo(4 * 0.2)
  })
})

describe('buildClosingVolumesReport — уклон плиты перекрытия', () => {
  it("пример Сергея: 6400мм, 4500→5200мм", () => {
    const slope: CeilingSlope = { id: 'S1', label: 'Уклон', x1: 0, y1: 0, x2: 6400, y2: 0, height1Mm: 4500, height2Mm: 5200 }
    const l = line({ x1: 0, y1: 0, x2: 6400, y2: 0, lengthMm: 6400 })
    const r = buildClosingVolumesReport({ ...baseInput, ceilingSlopes: [slope], lines: [l], roundColumns: [], rectColumns: [] })
    expect(r.rows[0].tiers.belowM2).toBeCloseTo(6.4 * 3)
    expect(r.rows[0].tiers.aboveM2).toBeCloseTo(6.4 * 1.85)
  })

  it('customHeight:true игнорирует уклон, использует свою heightMm', () => {
    const slope: CeilingSlope = { id: 'S1', label: 'Уклон', x1: 0, y1: 0, x2: 6400, y2: 0, height1Mm: 4500, height2Mm: 5200 }
    const l = line({ x1: 0, y1: 0, x2: 6400, y2: 0, lengthMm: 6400, heightMm: 3000, customHeight: true })
    const r = buildClosingVolumesReport({ ...baseInput, ceilingSlopes: [slope], lines: [l], roundColumns: [], rectColumns: [] })
    expect(r.rows[0].tiers.belowM2).toBeCloseTo(6.4 * 3)
    expect(r.rows[0].tiers.aboveM2).toBe(0)
  })
})

describe('buildClosingVolumesReport — колонны', () => {
  it("пример Сергея: круглая колонна 4200мм -> 3м по 1200 + 1.2м по 1400", () => {
    const col: RoundColumn = { id: 'C1', cx: 100, cy: 100, diameterMm: 800, label: 'Колонна 1' }
    const r = buildClosingVolumesReport({ ...baseInput, defaultHeightMm: 4200, lines: [], roundColumns: [col], rectColumns: [] })
    expect(r.rows[0].kind).toBe('round_column')
    expect(r.rows[0].tiers.belowM).toBeCloseTo(3)
    expect(r.rows[0].tiers.aboveM).toBeCloseTo(1.2)
    expect(r.rows[0].cost).toBeCloseTo(3 * 1200 + 1.2 * 1400)
  })

  it('прямоугольная колонна берёт высоту из уклона в своей точке', () => {
    const slope: CeilingSlope = { id: 'S1', label: 'Уклон', x1: 0, y1: 0, x2: 1000, y2: 0, height1Mm: 3000, height2Mm: 5000 }
    const col: RectColumn = { id: 'C2', cx: 500, cy: 0, widthMm: 800, depthMm: 800, angleRad: 0, label: 'Колонна 2' }
    const r = buildClosingVolumesReport({ ...baseInput, ceilingSlopes: [slope], lines: [], roundColumns: [], rectColumns: [col] })
    expect(r.rows[0].kind).toBe('rect_column')
    expect(r.rows[0].tiers.belowM).toBeCloseTo(3) // высота в точке (500,0) = 4000 -> 3 ниже + 1 выше
    expect(r.rows[0].tiers.aboveM).toBeCloseTo(1)
  })
})

describe('buildClosingVolumesReport — статус прогресса', () => {
  it('без buildProgress — progressPercent null, isComplete false, но объём всё равно считается', () => {
    const l = line()
    const r = buildClosingVolumesReport({ ...baseInput, lines: [l], roundColumns: [], rectColumns: [] })
    expect(r.rows[0].progressPercent).toBeNull()
    expect(r.rows[0].isComplete).toBe(false)
    expect(r.rows[0].tiers.belowM2).toBeGreaterThan(0) // не заблокировано отсутствием прогресса
  })

  it('buildProgress настроен и полностью подтверждён — isComplete true', () => {
    const progress = createWorkProgress([{ id: 's1', label: 'Готово' }])
    progress.steps[0].outcome = 'confirmed'
    const l = line({ buildProgress: progress })
    const r = buildClosingVolumesReport({ ...baseInput, lines: [l], roundColumns: [], rectColumns: [] })
    expect(r.rows[0].isComplete).toBe(true)
    expect(r.rows[0].progressPercent).toBe(100)
  })

  it('колонна: isComplete читает legacy workStatus==="done"', () => {
    const col: RoundColumn = { id: 'C1', cx: 0, cy: 0, diameterMm: 800, label: 'К1', workStatus: 'done' }
    const r = buildClosingVolumesReport({ ...baseInput, lines: [], roundColumns: [col], rectColumns: [] })
    expect(r.rows[0].isComplete).toBe(true)
  })
})

describe('buildClosingVolumesReport — totals', () => {
  it('суммирует все строки (перегородки + колонны) в totals/totalCost', () => {
    const l = line({ heightMm: 3500 })                         // 12 below, 2 above
    const col: RoundColumn = { id: 'C1', cx: 0, cy: 0, diameterMm: 800, label: 'К1' }
    const r = buildClosingVolumesReport({ ...baseInput, defaultHeightMm: 4200, lines: [l], roundColumns: [col], rectColumns: [] })
    expect(r.totals.belowM2).toBeCloseTo(12)
    expect(r.totals.aboveM2).toBeCloseTo(2)
    expect(r.totals.belowM).toBeCloseTo(3)
    expect(r.totals.aboveM).toBeCloseTo(1.2)
    expect(r.totalCost).toBeCloseTo((12 + 3) * 1200 + (2 + 1.2) * 1400)
  })
})
