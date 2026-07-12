import { describe, it, expect } from 'vitest'
import { calcP113FrameGeometry } from '../calcP113Frame'
import { KNAUF_WALL_OFFSET_MM } from '../calcP112Frame'

describe('calcP113FrameGeometry — базовая геометрия', () => {
  it('основной профиль сплошной на весь пролёт A', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.mainLengthEachMm).toBe(4000)
    expect(geo.mainCount).toBeGreaterThan(0)
    expect(geo.mainTotalLm).toBeCloseTo((geo.mainCount * 4000) / 1000)
  })

  it('mainAlongLength=false — основной идёт вдоль ширины, а не длины', () => {
    const alongLength = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    const alongWidth = calcP113FrameGeometry(4000, 3000, 600, 500, 50, false)
    expect(alongLength.mainLengthEachMm).toBe(4000)
    expect(alongWidth.mainLengthEachMm).toBe(3000)
  })

  it('несущий профиль режется вставками: число вставок в ряду = mainCount + 1', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.bearingSegmentsPerRow).toBe(geo.mainCount + 1)
    expect(geo.bearingSegmentLengthsMm.length).toBe(geo.bearingSegmentsPerRow)
  })

  it('сумма длин вставок несущего профиля в одном ряду = полный пролёт B', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    const B = 3000 // mainAlongLength=true -> B = roomWidthMm
    const sum = geo.bearingSegmentLengthsMm.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(B)
  })

  it('bearingTotalLm не зависит от разбивки на куски — равен bearingRowCount * B / 1000', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.bearingTotalLm).toBeCloseTo((geo.bearingRowCount * 3000) / 1000)
  })

  it('bearingTotalPieces = bearingRowCount * bearingSegmentsPerRow', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.bearingTotalPieces).toBe(geo.bearingRowCount * geo.bearingSegmentsPerRow)
  })
})

describe('calcP113FrameGeometry — соединители (один на пересечение, подтверждено пользователем 12.07.2026)', () => {
  it('connectorsTotal = mainCount * bearingRowCount, ровно один на пересечение', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.connectorsTotal).toBe(geo.mainCount * geo.bearingRowCount)
  })

  it('растёт вместе с числом рядов при уменьшении шага', () => {
    const coarse = calcP113FrameGeometry(4000, 3000, 1200, 500, 50, true)
    const fine = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(fine.connectorsTotal).toBeGreaterThan(coarse.connectorsTotal)
  })
})

describe('calcP113FrameGeometry — подвесы на основном профиле, снэп к несущему', () => {
  it('hangerPositions — подмножество bearingPositions', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    for (const pos of geo.hangerPositions) {
      expect(geo.bearingPositions).toContain(pos)
    }
  })

  it('hangersTotal = mainCount * hangersPerMain', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.hangersTotal).toBe(geo.mainCount * geo.hangersPerMain)
  })

  it('без явного stepA — максимум подвесов = stepB (та же практика, что и П112)', () => {
    const withDefault = calcP113FrameGeometry(4000, 3000, 600, 950, 50, true)
    const withExplicit = calcP113FrameGeometry(4000, 3000, 600, 950, 50, true, 'user', { stepA: 950 })
    expect(withDefault.hangerPositions).toEqual(withExplicit.hangerPositions)
  })

  it('маленький stepA (реже позиций несущего) — подвес на каждом ряду несущего', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true, 'user', { stepA: 500 })
    expect(geo.hangerPositions).toEqual(geo.bearingPositions)
  })
})

describe('calcP113FrameGeometry — тип подвеса по зазору (переиспользует resolveHangerKind из П112)', () => {
  it('маленький зазор -> прямой подвес', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.hangerKind).toBe('direct')
  })

  it('зазор >1000мм -> тяга 1000мм с предупреждением (нестандартный случай)', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 1500, true)
    expect(geo.hangerKind).toBe('rod_1000')
    expect(geo.hangerWarning).toBeDefined()
  })
})

describe('calcP113FrameGeometry — layoutMode', () => {
  it('knauf — отступ от стены ≤100мм применяется к обоим профилям при передаче wallOffset*', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true, 'knauf', {
      stepA: 950, wallOffsetMainMm: KNAUF_WALL_OFFSET_MM, wallOffsetBearingMm: KNAUF_WALL_OFFSET_MM,
    })
    expect(geo.mainPositions[0]).toBe(KNAUF_WALL_OFFSET_MM)
    expect(geo.bearingPositions[0]).toBe(KNAUF_WALL_OFFSET_MM)
  })

  it('user (по умолчанию) — первый ряд основного на расстоянии одного шага от стены', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.mainPositions[0]).toBe(600)
  })
})

describe('calcP113FrameGeometry — удлинители', () => {
  it('mainExtenders > 0, если основной профиль длиннее стандартного хлыста 3000мм', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.mainExtenders).toBeGreaterThan(0)
  })

  it('bearingExtenders = 0 при обычных шагах c (вставки короче 3000мм)', () => {
    const geo = calcP113FrameGeometry(4000, 3000, 600, 500, 50, true)
    expect(geo.bearingExtenders).toBe(0)
  })
})

describe('calcP113FrameGeometry — вырожденные случаи', () => {
  it('пустой пролёт -> нулевые счётчики, не падает', () => {
    const geo = calcP113FrameGeometry(0, 0, 600, 500, 50, true)
    expect(geo.mainCount).toBe(0)
    expect(geo.bearingRowCount).toBe(0)
    expect(geo.connectorsTotal).toBe(0)
    // даже без рядов основного профиля один "пролёт" на всю ширину B есть
    expect(geo.bearingSegmentsPerRow).toBe(1)
  })
})
