import { describe, it, expect } from 'vitest'
import { planLineToSurfaceInput, planLinesToSurfaceInputs, planLineToDoubleFrameSurfaceInputs } from '../planLineToSurfaceInput'
import type { PlanLine } from '../../types'
import { DEFAULT_BOARD_SPEC } from '../../types'

function gklLine(overrides: Partial<PlanLine> = {}): PlanLine {
  return {
    id: 'L1', x1: 0, y1: 0, x2: 3000, y2: 0,
    type: 'wall_new', lengthMm: 3000, label: 'П-1',
    spec: { material: 'gkl', subtype: 'ps50' },
    ...overrides,
  } as PlanLine
}

describe('planLineToSurfaceInput — фильтрация неприменимых линий', () => {
  it('wall_existing — null (существующая стена, ничего не покупаем)', () => {
    expect(planLineToSurfaceInput(gklLine({ type: 'wall_existing', spec: { material: 'brick' } }))).toBeNull()
  })

  it('кладка (brick/gasblock/foamblock) на wall_new — null (не ГКЛ)', () => {
    expect(planLineToSurfaceInput(gklLine({ spec: { material: 'brick', subtype: '250' } }))).toBeNull()
  })

  it('плитка/штукатурка на wall_lining — null (не листовой раскрой)', () => {
    expect(planLineToSurfaceInput(gklLine({ type: 'wall_lining', spec: { material: 'tile', subtype: 'ceramic' } }))).toBeNull()
  })

  it('нулевая длина — null', () => {
    expect(planLineToSurfaceInput(gklLine({ lengthMm: 0 }))).toBeNull()
  })
})

describe('planLineToSurfaceInput — sides по типу линии', () => {
  it('wall_new -> sides: 2 (обе стороны перегородки)', () => {
    expect(planLineToSurfaceInput(gklLine())!.sides).toBe(2)
  })

  it('wall_lining -> sides: 1 (одна сторона облицовки)', () => {
    expect(planLineToSurfaceInput(gklLine({ type: 'wall_lining' }))!.sides).toBe(1)
  })
})

describe('planLineToSurfaceInput — дефолты и переопределения', () => {
  it('без spec.step — дефолт 600, firstStud = step', () => {
    const res = planLineToSurfaceInput(gklLine())!
    expect(res.step).toBe(600)
    expect(res.firstStud).toBe(600)
  })

  it('spec.step переопределяет дефолт', () => {
    const res = planLineToSurfaceInput(gklLine({ spec: { material: 'gkl', step: 400 } }))!
    expect(res.step).toBe(400)
    expect(res.firstStud).toBe(400)
  })

  it('без heightMm — дефолт 3000', () => {
    expect(planLineToSurfaceInput(gklLine())!.wallH).toBe(3000)
  })

  it('heightMm переопределяет дефолт', () => {
    expect(planLineToSurfaceInput(gklLine({ heightMm: 2700 }))!.wallH).toBe(2700)
  })

  it('без layers — дефолт 1', () => {
    expect(planLineToSurfaceInput(gklLine())!.gklLayers).toBe(1)
  })

  it('layers: 2 передаётся как есть', () => {
    expect(planLineToSurfaceInput(gklLine({ spec: { material: 'gkl', layers: 2 } }))!.gklLayers).toBe(2)
  })

  it('без layer1/layer2 — DEFAULT_BOARD_SPEC', () => {
    const res = planLineToSurfaceInput(gklLine())!
    expect(res.layer1).toEqual(DEFAULT_BOARD_SPEC)
    expect(res.layer2).toEqual(DEFAULT_BOARD_SPEC)
  })

  it('явный layer1/layer2 передаётся как есть', () => {
    const customLayer = { ...DEFAULT_BOARD_SPEC, thickness: 9.5 }
    const res = planLineToSurfaceInput(gklLine({ spec: { material: 'gkl', layer1: customLayer } }))!
    expect(res.layer1).toEqual(customLayer)
  })
})

describe('planLineToSurfaceInput — проёмы', () => {
  it('маппит PlanOpening -> Opening (offsetMm->pos, widthMm->width, ...)', () => {
    const line = gklLine({
      openings: [{ id: 'O1', type: 'door', offsetMm: 500, widthMm: 900, heightMm: 2000, label: 'Д-1' }],
    })
    const res = planLineToSurfaceInput(line)!
    expect(res.openings).toEqual([{ id: 'O1', type: 'door', pos: 500, width: 900, height: 2000, sillHeight: 0 }])
  })

  it('окно с sillHeightMm маппится в sillHeight', () => {
    const line = gklLine({
      openings: [{ id: 'O1', type: 'window', offsetMm: 500, widthMm: 1200, heightMm: 900, sillHeightMm: 900, label: 'О-1' }],
    })
    expect(planLineToSurfaceInput(line)!.openings[0].sillHeight).toBe(900)
  })

  it('без проёмов — пустой массив', () => {
    expect(planLineToSurfaceInput(gklLine())!.openings).toEqual([])
  })
})

describe('planLinesToSurfaceInputs — батч с отбрасыванием null', () => {
  it('сохраняет порядок и пропускает неприменимые линии', () => {
    const lines: PlanLine[] = [
      gklLine({ id: 'L1', label: 'П-1' }),
      gklLine({ id: 'L2', label: 'Кладка', type: 'wall_existing', spec: { material: 'brick' } }),
      gklLine({ id: 'L3', label: 'О-1', type: 'wall_lining' }),
    ]
    const res = planLinesToSurfaceInputs(lines)
    expect(res.map(r => r.id)).toEqual(['L1', 'L3'])
  })
})

describe('двойной каркас — обычный planLineToSurfaceInput не применим', () => {
  it('c115_1_ps50 и т.п. -> null из обычного переводчика (своя логика в planLineToDoubleFrameSurfaceInputs)', () => {
    expect(planLineToSurfaceInput(gklLine({ spec: { material: 'gkl', subtype: 'c115_1_ps50' } }))).toBeNull()
    expect(planLineToSurfaceInput(gklLine({ spec: { material: 'gkl', subtype: 'c116_ps100' } }))).toBeNull()
  })
})

describe('planLineToDoubleFrameSurfaceInputs — разложение на суб-поверхности', () => {
  it('не двойной каркас / не wall_new / не gkl -> null', () => {
    expect(planLineToDoubleFrameSurfaceInputs(gklLine({ spec: { material: 'gkl', subtype: 'ps75' } }))).toBeNull()
    expect(planLineToDoubleFrameSurfaceInputs(gklLine({ type: 'wall_lining', spec: { material: 'gkl', subtype: 'c115_1_ps50' } }))).toBeNull()
    expect(planLineToDoubleFrameSurfaceInputs(gklLine({ spec: { material: 'brick', subtype: 'c115_1_ps50' } }))).toBeNull()
  })

  it('С115.1 -> ровно 2 суб-поверхности (сторона А, сторона Б), 2 слоя каждая', () => {
    const res = planLineToDoubleFrameSurfaceInputs(gklLine({ spec: { material: 'gkl', subtype: 'c115_1_ps50' } }))!
    expect(res).toHaveLength(2)
    expect(res[0].label).toContain('сторона А')
    expect(res[0].gklLayers).toBe(2)
    expect(res[1].label).toContain('сторона Б')
    expect(res[1].gklLayers).toBe(2)
  })

  it('С115.2 -> 3 суб-поверхности (+ разделитель)', () => {
    const res = planLineToDoubleFrameSurfaceInputs(gklLine({ spec: { material: 'gkl', subtype: 'c115_2_ps75' } }))!
    expect(res).toHaveLength(3)
    expect(res[2].label).toContain('разделитель')
    expect(res[2].gklLayers).toBe(1)
  })

  it('С115.3 -> 3 суб-поверхности (+ доп. слой Б), сторона Б капается до 2 слоёв', () => {
    const res = planLineToDoubleFrameSurfaceInputs(gklLine({ spec: { material: 'gkl', subtype: 'c115_3_ps100' } }))!
    expect(res).toHaveLength(3)
    expect(res[1].label).toContain('сторона Б')
    expect(res[1].gklLayers).toBe(2) // капается — CalcResult поддерживает максимум 2 слоя
    expect(res[2].label).toContain('доп. слой Б')
    expect(res[2].gklLayers).toBe(1)
  })

  it('С116 -> 2 суб-поверхности, как С115.1 (зазор не влияет на раскрой)', () => {
    const res = planLineToDoubleFrameSurfaceInputs(gklLine({ spec: { material: 'gkl', subtype: 'c116_ps50', gapMm: 150 } }))!
    expect(res).toHaveLength(2)
  })

  it('спецификации листов пробрасываются из layerA1/A2/B1/B2/B3', () => {
    const custom = { material: 'gvl' as const, subtype: null, thickness: 10, sheetWidth: 1200, sheetLength: 2500 }
    const res = planLineToDoubleFrameSurfaceInputs(gklLine({
      spec: {
        material: 'gkl', subtype: 'c115_3_ps50',
        layerA1: custom, layerB3: custom,
      },
    }))!
    expect(res[0].layer1).toEqual(custom)     // сторона А, 1-й слой
    expect(res[2].layer1).toEqual(custom)     // доп. слой Б использует layerB3
  })

  it('без layerA1/A2/B1/B2 — DEFAULT_BOARD_SPEC', () => {
    const res = planLineToDoubleFrameSurfaceInputs(gklLine({ spec: { material: 'gkl', subtype: 'c115_1_ps50' } }))!
    expect(res[0].layer1).toEqual(DEFAULT_BOARD_SPEC)
    expect(res[1].layer2).toEqual(DEFAULT_BOARD_SPEC)
  })

  it('id суб-поверхностей уникальны и содержат id исходной линии', () => {
    const res = planLineToDoubleFrameSurfaceInputs(gklLine({ id: 'L9', spec: { material: 'gkl', subtype: 'c115_2_ps75' } }))!
    const ids = res.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach(id => expect(id).toContain('L9'))
  })
})

describe('planLinesToSurfaceInputs — раскладывает двойной каркас в батче', () => {
  it('линия С115.2 в списке разворачивается в 3 записи, соседние линии не трогаются', () => {
    const lines: PlanLine[] = [
      gklLine({ id: 'L1', label: 'П-1' }),
      gklLine({ id: 'L2', label: 'Двойной', spec: { material: 'gkl', subtype: 'c115_2_ps75' } }),
      gklLine({ id: 'L3', label: 'О-1', type: 'wall_lining' }),
    ]
    const res = planLinesToSurfaceInputs(lines)
    expect(res.map(r => r.id)).toEqual(['L1', 'L2__A', 'L2__B', 'L2__SEP', 'L3'])
  })
})
