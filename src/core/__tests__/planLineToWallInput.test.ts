import { describe, it, expect } from 'vitest'
import { planLineToWallInput, planLinesToWallInputs, resolveWallType, resolveWallProfileType, resolveAbutment } from '../planLineToWallInput'
import type { PlanLine } from '../../types'
import { DEFAULT_BOARD_SPEC } from '../../types'
import type { LineAttachments } from '../attachmentResolver'

function gklLine(overrides: Partial<PlanLine> = {}): PlanLine {
  return {
    id: 'L1', x1: 0, y1: 0, x2: 3000, y2: 0,
    type: 'wall_new', lengthMm: 3000, label: 'П-1',
    spec: { material: 'gkl', subtype: 'ps50' },
    ...overrides,
  } as PlanLine
}

describe('resolveWallType', () => {
  it('layers не задано или 1 -> c111', () => {
    expect(resolveWallType(undefined)).toBe('c111')
    expect(resolveWallType(1)).toBe('c111')
  })
  it('layers 2 -> c112', () => {
    expect(resolveWallType(2)).toBe('c112')
  })
})

describe('resolveWallProfileType', () => {
  it('ps50/ps75/ps100 — прямой проброс', () => {
    expect(resolveWallProfileType('ps50')).toBe('ps50')
    expect(resolveWallProfileType('ps75')).toBe('ps75')
    expect(resolveWallProfileType('ps100')).toBe('ps100')
  })
  it('ps125/double — не поддержаны, null', () => {
    expect(resolveWallProfileType('ps125')).toBeNull()
    expect(resolveWallProfileType('double')).toBeNull()
  })
  it('неизвестный/отсутствующий subtype — null', () => {
    expect(resolveWallProfileType(undefined)).toBeNull()
  })
})

describe('resolveAbutment', () => {
  it('оба конца примыкают -> both', () => {
    const att: LineAttachments = { start: { neighborId: 'A', material: 'brick' }, end: { neighborId: 'B', material: 'concrete' } }
    expect(resolveAbutment(att)).toBe('both')
  })
  it('только start -> left', () => {
    const att: LineAttachments = { start: { neighborId: 'A', material: 'brick' }, end: null }
    expect(resolveAbutment(att)).toBe('left')
  })
  it('только end -> right', () => {
    const att: LineAttachments = { start: null, end: { neighborId: 'B', material: 'concrete' } }
    expect(resolveAbutment(att)).toBe('right')
  })
  it('ничего не задано -> none', () => {
    expect(resolveAbutment(undefined)).toBe('none')
    expect(resolveAbutment({ start: null, end: null })).toBe('none')
  })
})

describe('planLineToWallInput — фильтрация неприменимых линий', () => {
  it('wall_lining -> null (не тот переводчик)', () => {
    expect(planLineToWallInput(gklLine({ type: 'wall_lining' }))).toBeNull()
  })
  it('кладка (brick/gasblock/foamblock) -> null (не ГКЛ-каркас)', () => {
    expect(planLineToWallInput(gklLine({ spec: { material: 'brick', subtype: '250' } }))).toBeNull()
  })
  it('нулевая длина -> null', () => {
    expect(planLineToWallInput(gklLine({ lengthMm: 0 }))).toBeNull()
  })
  it('ps125/double -> null (нет ProfileType)', () => {
    expect(planLineToWallInput(gklLine({ spec: { material: 'gkl', subtype: 'ps125' } }))).toBeNull()
    expect(planLineToWallInput(gklLine({ spec: { material: 'gkl', subtype: 'double' } }))).toBeNull()
  })
})

describe('planLineToWallInput — резолв и дефолты', () => {
  it('wallType/profileType резолвятся из spec', () => {
    const res = planLineToWallInput(gklLine({ spec: { material: 'gkl', subtype: 'ps75', layers: 2 } }))!
    expect(res.wallType).toBe('c112')
    expect(res.profileType).toBe('ps75')
  })

  it('без step — дефолт 600, firstStud = step', () => {
    const res = planLineToWallInput(gklLine())!
    expect(res.step).toBe(600)
    expect(res.firstStud).toBe(600)
  })

  it('без heightMm — дефолт 3000', () => {
    expect(planLineToWallInput(gklLine())!.height).toBe(3000)
  })

  it('без profileThickness — дефолт 06', () => {
    expect(planLineToWallInput(gklLine())!.profileThickness).toBe('06')
  })

  it('без layer1/layer2 — DEFAULT_BOARD_SPEC', () => {
    const res = planLineToWallInput(gklLine())!
    expect(res.layer1).toEqual(DEFAULT_BOARD_SPEC)
    expect(res.layer2).toEqual(DEFAULT_BOARD_SPEC)
  })

  it('без attachments — abutment none', () => {
    expect(planLineToWallInput(gklLine())!.abutment).toBe('none')
  })

  it('с attachments — abutment резолвится', () => {
    const att: LineAttachments = { start: { neighborId: 'A', material: 'brick' }, end: { neighborId: 'B', material: 'concrete' } }
    expect(planLineToWallInput(gklLine(), att)!.abutment).toBe('both')
  })

  it('проёмы маппятся PlanOpening -> Opening', () => {
    const line = gklLine({
      openings: [{ id: 'O1', type: 'door', offsetMm: 500, widthMm: 900, heightMm: 2000, label: 'Д-1' }],
    })
    expect(planLineToWallInput(line)!.openings).toEqual([{ id: 'O1', type: 'door', pos: 500, width: 900, height: 2000, sillHeight: 0 }])
  })
})

describe('planLinesToWallInputs — батч', () => {
  it('сохраняет порядок и пропускает неприменимые линии', () => {
    const lines: PlanLine[] = [
      gklLine({ id: 'L1', label: 'П-1' }),
      gklLine({ id: 'L2', label: 'Облицовка', type: 'wall_lining' }),
      gklLine({ id: 'L3', label: 'П-2', spec: { material: 'gkl', subtype: 'ps75' } }),
    ]
    const res = planLinesToWallInputs(lines)
    expect(res.map(r => r.line.id)).toEqual(['L1', 'L3'])
  })
})
