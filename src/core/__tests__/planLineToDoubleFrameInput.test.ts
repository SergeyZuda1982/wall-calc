import { describe, it, expect } from 'vitest'
import { planLineToDoubleFrameInput, planLinesToDoubleFrameInputs } from '../planLineToDoubleFrameInput'
import type { PlanLine } from '../../types'
import { DEFAULT_BOARD_SPEC } from '../../types'
import type { LineAttachments } from '../attachmentResolver'

function dfLine(overrides: Partial<PlanLine> = {}): PlanLine {
  return {
    id: 'L1', x1: 0, y1: 0, x2: 3000, y2: 0,
    type: 'wall_new', lengthMm: 3000, label: 'П-1 (двойной)',
    spec: { material: 'gkl', subtype: 'c115_1_ps50' },
    ...overrides,
  } as PlanLine
}

describe('planLineToDoubleFrameInput — фильтрация неприменимых линий', () => {
  it('wall_lining -> null (не тот переводчик)', () => {
    expect(planLineToDoubleFrameInput(dfLine({ type: 'wall_lining' }))).toBeNull()
  })
  it('кладка -> null (не ГКЛ-каркас)', () => {
    expect(planLineToDoubleFrameInput(dfLine({ spec: { material: 'brick', subtype: '250' } }))).toBeNull()
  })
  it('нулевая длина -> null', () => {
    expect(planLineToDoubleFrameInput(dfLine({ lengthMm: 0 }))).toBeNull()
  })
  it('одинарный каркас (ps50/ps75/ps100/ps125/double) -> null (не двойной)', () => {
    expect(planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'ps50' } }))).toBeNull()
    expect(planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'ps125' } }))).toBeNull()
    expect(planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'double' } }))).toBeNull()
  })
})

describe('planLineToDoubleFrameInput — резолв и дефолты', () => {
  it('dfType/profileType резолвятся из subtype', () => {
    const res = planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'c115_2_ps75' } }))!
    expect(res.dfType).toBe('c115_2')
    expect(res.profileType).toBe('ps75')
  })

  it('С115.3 -> layerB3 заполняется дефолтом, если не задан', () => {
    const res = planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'c115_3_ps100' } }))!
    expect(res.dfType).toBe('c115_3')
    expect(res.layerB3).toEqual(DEFAULT_BOARD_SPEC)
  })

  it('не С115.3 -> layerB3 не задан (undefined)', () => {
    const res = planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'c115_1_ps50' } }))!
    expect(res.layerB3).toBeUndefined()
    const res2 = planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'c116_ps75' } }))!
    expect(res2.layerB3).toBeUndefined()
  })

  it('без layerA1/A2/B1/B2 — DEFAULT_BOARD_SPEC для всех', () => {
    const res = planLineToDoubleFrameInput(dfLine())!
    expect(res.layerA1).toEqual(DEFAULT_BOARD_SPEC)
    expect(res.layerA2).toEqual(DEFAULT_BOARD_SPEC)
    expect(res.layerB1).toEqual(DEFAULT_BOARD_SPEC)
    expect(res.layerB2).toEqual(DEFAULT_BOARD_SPEC)
  })

  it('заданные layerA1/A2/B1/B2/B3 пробрасываются как есть', () => {
    const custom = { material: 'gkl' as const, subtype: 'moisture' as const, thickness: 12.5, sheetWidth: 1200, sheetLength: 2500 }
    const res = planLineToDoubleFrameInput(dfLine({
      spec: {
        material: 'gkl', subtype: 'c115_3_ps75',
        layerA1: custom, layerA2: custom, layerB1: custom, layerB2: custom, layerB3: custom,
      },
    }))!
    expect(res.layerA1).toEqual(custom)
    expect(res.layerB3).toEqual(custom)
  })

  it('overlap — норма Кнауф по профилю (ps50->500, ps75->750, ps100->1000)', () => {
    expect(planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'c115_1_ps50' } }))!.overlap).toBe(500)
    expect(planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'c115_1_ps75' } }))!.overlap).toBe(750)
    expect(planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'c115_1_ps100' } }))!.overlap).toBe(1000)
  })

  it('gapMm пробрасывается для С116', () => {
    const res = planLineToDoubleFrameInput(dfLine({ spec: { material: 'gkl', subtype: 'c116_ps50', gapMm: 150 } }))!
    expect(res.gapMm).toBe(150)
  })

  it('без step — дефолт 600, firstStud = step', () => {
    const res = planLineToDoubleFrameInput(dfLine())!
    expect(res.step).toBe(600)
    expect(res.firstStud).toBe(600)
  })

  it('без heightMm — дефолт 3000', () => {
    expect(planLineToDoubleFrameInput(dfLine())!.height).toBe(3000)
  })

  it('без attachments — abutment none; с attachments — резолвится', () => {
    expect(planLineToDoubleFrameInput(dfLine())!.abutment).toBe('none')
    const att: LineAttachments = { start: { neighborId: 'A', material: 'brick' }, end: null }
    expect(planLineToDoubleFrameInput(dfLine(), att)!.abutment).toBe('left')
  })

  it('проёмы маппятся PlanOpening -> Opening', () => {
    const line = dfLine({
      openings: [{ id: 'O1', type: 'door', offsetMm: 500, widthMm: 900, heightMm: 2000, label: 'Д-1' }],
    })
    expect(planLineToDoubleFrameInput(line)!.openings).toEqual([{ id: 'O1', type: 'door', pos: 500, width: 900, height: 2000, sillHeight: 0 }])
  })
})

describe('planLinesToDoubleFrameInputs — батч', () => {
  it('сохраняет порядок и пропускает неприменимые (в т.ч. одинарный каркас)', () => {
    const lines: PlanLine[] = [
      dfLine({ id: 'L1', label: 'П-1' }),
      dfLine({ id: 'L2', label: 'Одинарный', spec: { material: 'gkl', subtype: 'ps75' } }),
      dfLine({ id: 'L3', label: 'П-2', spec: { material: 'gkl', subtype: 'c116_ps100' } }),
    ]
    const res = planLinesToDoubleFrameInputs(lines)
    expect(res.map(r => r.line.id)).toEqual(['L1', 'L3'])
  })
})
