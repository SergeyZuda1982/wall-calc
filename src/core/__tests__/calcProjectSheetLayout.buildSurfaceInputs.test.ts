import { describe, it, expect } from 'vitest'
import { buildSurfaceInputs } from '../calcProjectSheetLayout'
import { buildPositions } from '../buildPositions'
import { calcResults } from '../calcResults'
import { calcDoubleFrame } from '../calcDoubleFrame'
import { flatProfile } from '../profileGeometry'
import { DEFAULT_BOARD_SPEC } from '../../types'
import type { WallEntry } from '../../store/useProjectStore'

function singleWall(id: string, label: string, length = 4000, height = 2700): WallEntry {
  const { positions } = buildPositions(length, 600, 600, [])
  const cp = flatProfile(length, height)
  const fp = flatProfile(length, 0)
  const result = calcResults(positions, cp, fp, length, [], 'both', 500, 2, DEFAULT_BOARD_SPEC, DEFAULT_BOARD_SPEC, [], 2)
  return {
    id, label, kind: 'single',
    input: {
      wallType: 'c112', profileType: 'ps50', profileThickness: '06', abutment: 'both',
      length, height, step: 600, firstStud: 600, openings: [], communications: [],
      customOverlap: null, layer1: DEFAULT_BOARD_SPEC, layer2: DEFAULT_BOARD_SPEC, plywoodInserts: [],
    },
    result, doubleInput: null, doubleResult: null, positions,
  }
}

function doubleWall(id: string, label: string, length = 4000, height = 2700): WallEntry {
  const doubleInput = {
    dfType: 'c115_1' as const, profileType: 'ps50' as const, abutment: 'both' as const,
    length, height, step: 600, firstStud: 600, openings: [], overlap: 500,
    layerA1: DEFAULT_BOARD_SPEC, layerA2: DEFAULT_BOARD_SPEC,
    layerB1: DEFAULT_BOARD_SPEC, layerB2: DEFAULT_BOARD_SPEC,
  }
  const doubleResult = calcDoubleFrame(doubleInput)
  const { positions } = buildPositions(length, 600, 600, [])
  return {
    id, label, kind: 'double',
    input: null, result: null, doubleInput, doubleResult, positions,
  }
}

describe('buildSurfaceInputs — одинарные стены (базовое покрытие, ранее не тестировалось)', () => {
  it('одна стена С112 (2 слоя, sides:2) даёт одну поверхность', () => {
    const out = buildSurfaceInputs([singleWall('w1', 'А1')], [])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'w1', gklLayers: 2, sides: 2, wallL: 4000 })
  })

  it('стена без positions/result пропускается', () => {
    const broken: WallEntry = { id: 'w2', label: 'А2', kind: 'single', input: null, result: null, doubleInput: null, doubleResult: null, positions: [] }
    expect(buildSurfaceInputs([broken], [])).toHaveLength(0)
  })

  it('несколько стен сохраняют порядок добавления', () => {
    const out = buildSurfaceInputs([singleWall('w1', 'А1'), singleWall('w2', 'А2')], [])
    expect(out.map(s => s.id)).toEqual(['w1', 'w2'])
  })
})

describe('buildSurfaceInputs — двойной каркас С115/С116 (01.09.2026)', () => {
  it('один двойной каркас даёт ДВЕ поверхности (сторона А + сторона Б), sides:1 каждая', () => {
    const out = buildSurfaceInputs([doubleWall('w1', 'Б1')], [])
    expect(out).toHaveLength(2)
    expect(out.every(s => s.sides === 1)).toBe(true)
    expect(out.map(s => s.id)).toEqual(['w1_A', 'w1_B'])
  })

  it('обе стороны используют одну и ту же длину/шаг/firstStud (общая сетка стоек)', () => {
    const [a, b] = buildSurfaceInputs([doubleWall('w1', 'Б1')], [])
    expect(a.wallL).toBe(b.wallL)
    expect(a.step).toBe(b.step)
    expect(a.firstStud).toBe(b.firstStud)
  })

  it('одинарные и двойные стены смешиваются в одном списке без потерь', () => {
    const out = buildSurfaceInputs([singleWall('w1', 'А1'), doubleWall('w2', 'Б1')], [])
    expect(out).toHaveLength(3) // 1 одинарная + 2 стороны двойной
    expect(out.map(s => s.id)).toEqual(['w1', 'w2_A', 'w2_B'])
  })

  it('двойной каркас без doubleResult (не рассчитан) пропускается', () => {
    const w = doubleWall('w1', 'Б1')
    const broken = { ...w, doubleResult: null }
    expect(buildSurfaceInputs([broken], [])).toHaveLength(0)
  })
})
