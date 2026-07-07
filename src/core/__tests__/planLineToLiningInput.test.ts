import { describe, it, expect } from 'vitest'
import { planLineToLiningInput, planLinesToLiningInputs, resolveLiningType, resolveLiningProfileType } from '../planLineToLiningInput'
import type { PlanLine } from '../../types'
import { DEFAULT_BOARD_SPEC } from '../../types'
import type { LineAttachments } from '../attachmentResolver'

function liningLine(overrides: Partial<PlanLine> = {}): PlanLine {
  return {
    id: 'L1', x1: 0, y1: 0, x2: 3000, y2: 0,
    type: 'wall_lining', lengthMm: 3000, label: 'О-1',
    spec: { material: 'gkl', subtype: 'frame_ps75' },
    ...overrides,
  } as PlanLine
}

describe('resolveLiningType', () => {
  it('frame_pn28 -> c623 (независимо от layers)', () => {
    expect(resolveLiningType('frame_pn28', undefined)).toBe('c623')
    expect(resolveLiningType('frame_pn28', 2)).toBe('c623')
  })
  it('frame_ps75 + layers 1 (или не задано) -> c625', () => {
    expect(resolveLiningType('frame_ps75', undefined)).toBe('c625')
    expect(resolveLiningType('frame_ps75', 1)).toBe('c625')
  })
  it('frame_ps100 + layers 1 (или не задано) -> c625, + layers 2 -> c626', () => {
    expect(resolveLiningType('frame_ps100', undefined)).toBe('c625')
    expect(resolveLiningType('frame_ps100', 1)).toBe('c625')
    expect(resolveLiningType('frame_ps100', 2)).toBe('c626')
  })
  it('frame_ps75 + layers 2 -> c626', () => {
    expect(resolveLiningType('frame_ps75', 2)).toBe('c626')
  })
  it('frame_ps50 -> ВСЕГДА c626, независимо от layers (по нормам Кнауф однослойной С625 на ПС50 не бывает)', () => {
    expect(resolveLiningType('frame_ps50', undefined)).toBe('c626')
    expect(resolveLiningType('frame_ps50', 1)).toBe('c626')
    expect(resolveLiningType('frame_ps50', 2)).toBe('c626')
  })
  it('glued (С611) -> null, нет калькулятора', () => {
    expect(resolveLiningType('glued', 1)).toBeNull()
  })
  it('неизвестный subtype -> null', () => {
    expect(resolveLiningType(undefined, 1)).toBeNull()
  })
})

describe('resolveLiningProfileType', () => {
  it('frame_pn28 -> дефолт ps75 (не влияет на BOM при c623)', () => {
    expect(resolveLiningProfileType('frame_pn28')).toBe('ps75')
  })
  it('frame_ps50 -> ps50, frame_ps75 -> ps75', () => {
    expect(resolveLiningProfileType('frame_ps50')).toBe('ps50')
    expect(resolveLiningProfileType('frame_ps75')).toBe('ps75')
  })
  it('frame_ps100 -> ps100', () => {
    expect(resolveLiningProfileType('frame_ps100')).toBe('ps100')
  })
  it('glued/неизвестный -> null', () => {
    expect(resolveLiningProfileType('glued')).toBeNull()
    expect(resolveLiningProfileType(undefined)).toBeNull()
  })
})

describe('planLineToLiningInput — фильтрация неприменимых линий', () => {
  it('wall_new -> null (не тот переводчик)', () => {
    expect(planLineToLiningInput(liningLine({ type: 'wall_new' }))).toBeNull()
  })
  it('плитка/штукатурка/малярка -> null (не листовая облицовка)', () => {
    expect(planLineToLiningInput(liningLine({ spec: { material: 'tile', subtype: 'ceramic' } }))).toBeNull()
    expect(planLineToLiningInput(liningLine({ spec: { material: 'plaster', subtype: 'gypsum' } }))).toBeNull()
  })
  it('на клею (glued/С611) -> null, расчёта нет', () => {
    expect(planLineToLiningInput(liningLine({ spec: { material: 'gkl', subtype: 'glued' } }))).toBeNull()
  })
  it('нулевая длина -> null', () => {
    expect(planLineToLiningInput(liningLine({ lengthMm: 0 }))).toBeNull()
  })
})

describe('planLineToLiningInput — резолв систем С623/625/626', () => {
  it('frame_pn28 -> c623, 1 слой по умолчанию', () => {
    const res = planLineToLiningInput(liningLine({ spec: { material: 'gkl', subtype: 'frame_pn28' } }))!
    expect(res.liningType).toBe('c623')
    expect(res.gklLayers).toBe(1)
  })
  it('frame_pn28 + layers 2 -> c623, 2 слоя (С623 поддерживает оба варианта)', () => {
    const res = planLineToLiningInput(liningLine({ spec: { material: 'gkl', subtype: 'frame_pn28', layers: 2 } }))!
    expect(res.liningType).toBe('c623')
    expect(res.gklLayers).toBe(2)
  })
  it('frame_ps75 без layers -> c625, 1 слой', () => {
    const res = planLineToLiningInput(liningLine())!
    expect(res.liningType).toBe('c625')
    expect(res.profileType).toBe('ps75')
    expect(res.gklLayers).toBe(1)
  })
  it('frame_ps50 + layers 2 -> c626, 2 слоя, profileType ps50', () => {
    const res = planLineToLiningInput(liningLine({ spec: { material: 'gkl', subtype: 'frame_ps50', layers: 2 } }))!
    expect(res.liningType).toBe('c626')
    expect(res.profileType).toBe('ps50')
    expect(res.gklLayers).toBe(2)
  })
  it('frame_ps50 без layers (или layers 1, устаревшие данные) -> ВСЁ РАВНО c626, 2 слоя — не c625', () => {
    const res1 = planLineToLiningInput(liningLine({ spec: { material: 'gkl', subtype: 'frame_ps50' } }))!
    expect(res1.liningType).toBe('c626')
    expect(res1.gklLayers).toBe(2)
    const res2 = planLineToLiningInput(liningLine({ spec: { material: 'gkl', subtype: 'frame_ps50', layers: 1 } }))!
    expect(res2.liningType).toBe('c626')
    expect(res2.gklLayers).toBe(2)
  })
  it('frame_ps100 + layers 2 -> c626, 2 слоя, profileType ps100', () => {
    const res = planLineToLiningInput(liningLine({ spec: { material: 'gkl', subtype: 'frame_ps100', layers: 2 } }))!
    expect(res.liningType).toBe('c626')
    expect(res.profileType).toBe('ps100')
    expect(res.gklLayers).toBe(2)
  })
})

describe('planLineToLiningInput — дефолты', () => {
  it('без hangerStep — дефолт 1000', () => {
    expect(planLineToLiningInput(liningLine())!.hangerStep).toBe(1000)
  })
  it('hangerStep из spec переопределяет дефолт', () => {
    const res = planLineToLiningInput(liningLine({ spec: { material: 'gkl', subtype: 'frame_ps75', hangerStep: 700 } }))!
    expect(res.hangerStep).toBe(700)
  })
  it('без step — дефолт 600', () => {
    expect(planLineToLiningInput(liningLine())!.step).toBe(600)
  })
  it('без heightMm — дефолт 3000', () => {
    expect(planLineToLiningInput(liningLine())!.height).toBe(3000)
  })
  it('без profileThickness — дефолт 06', () => {
    expect(planLineToLiningInput(liningLine())!.profileThickness).toBe('06')
  })
  it('без layer1/layer2 — DEFAULT_BOARD_SPEC', () => {
    const res = planLineToLiningInput(liningLine())!
    expect(res.layer1).toEqual(DEFAULT_BOARD_SPEC)
    expect(res.layer2).toEqual(DEFAULT_BOARD_SPEC)
  })
  it('без attachments — abutment none; с attachments — резолвится', () => {
    expect(planLineToLiningInput(liningLine())!.abutment).toBe('none')
    const att: LineAttachments = { start: { neighborId: 'A', material: 'brick' }, end: null }
    expect(planLineToLiningInput(liningLine(), att)!.abutment).toBe('left')
  })
  it('проёмы маппятся PlanOpening -> Opening', () => {
    const line = liningLine({
      openings: [{ id: 'O1', type: 'window', offsetMm: 500, widthMm: 1200, heightMm: 900, sillHeightMm: 900, label: 'О-1' }],
    })
    expect(planLineToLiningInput(line)!.openings).toEqual([{ id: 'O1', type: 'window', pos: 500, width: 1200, height: 900, sillHeight: 900 }])
  })
})

describe('planLinesToLiningInputs — батч', () => {
  it('сохраняет порядок и пропускает неприменимые линии (в т.ч. glued)', () => {
    const lines: PlanLine[] = [
      liningLine({ id: 'L1' }),
      liningLine({ id: 'L2', spec: { material: 'gkl', subtype: 'glued' } }),
      liningLine({ id: 'L3', spec: { material: 'gkl', subtype: 'frame_pn28' } }),
    ]
    const res = planLinesToLiningInputs(lines)
    expect(res.map(r => r.line.id)).toEqual(['L1', 'L3'])
  })
})
