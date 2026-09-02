import { describe, it, expect } from 'vitest'
import { wallToDbRow, wallFromDbRow } from '../projectCloud'
import { buildPositions } from '../../core/buildPositions'
import { calcResults } from '../../core/calcResults'
import { calcDoubleFrame } from '../../core/calcDoubleFrame'
import { flatProfile } from '../../core/profileGeometry'
import { DEFAULT_BOARD_SPEC } from '../../types'
import type { WallEntry } from '../../store/useProjectStore'

function singleWall(): WallEntry {
  const length = 4000, height = 2700
  const { positions } = buildPositions(length, 600, 600, [])
  const cp = flatProfile(length, height), fp = flatProfile(length, 0)
  const result = calcResults(positions, cp, fp, length, [], 'both', 500, 2, DEFAULT_BOARD_SPEC, DEFAULT_BOARD_SPEC, [], 2)
  return {
    id: 'w1', label: 'А1', kind: 'single',
    input: {
      wallType: 'c112', profileType: 'ps50', profileThickness: '06', abutment: 'both',
      length, height, step: 600, firstStud: 600, openings: [], communications: [],
      customOverlap: null, layer1: DEFAULT_BOARD_SPEC, layer2: DEFAULT_BOARD_SPEC, plywoodInserts: [],
    },
    result, doubleInput: null, doubleResult: null, positions,
  }
}

function doubleWall(): WallEntry {
  const length = 4000, height = 2700
  const doubleInput = {
    dfType: 'c115_3' as const, profileType: 'ps75' as const, abutment: 'both' as const,
    length, height, step: 600, firstStud: 600, openings: [], overlap: 500,
    layerA1: DEFAULT_BOARD_SPEC, layerA2: DEFAULT_BOARD_SPEC,
    layerB1: DEFAULT_BOARD_SPEC, layerB2: DEFAULT_BOARD_SPEC, layerB3: DEFAULT_BOARD_SPEC,
    gapMm: 200,
  }
  const doubleResult = calcDoubleFrame(doubleInput)
  const { positions } = buildPositions(length, 600, 600, [])
  return { id: 'w2', label: 'Б1', kind: 'double', input: null, result: null, doubleInput, doubleResult, positions }
}

describe('wallToDbRow / wallFromDbRow — сериализация стены для облака (01.09.2026)', () => {
  it('одинарная стена сериализуется БЕЗ обёртки — как раньше (обратная совместимость со старыми строками БД)', () => {
    const w = singleWall()
    const row = wallToDbRow(w, 'proj1')
    expect(row.input).toBe(w.input) // не завёрнуто в { kind: ... }
    expect(row.result).toBe(w.result)
    expect((row.input as any).kind).toBeUndefined()
  })

  it('одинарная стена — полный round-trip восстанавливает исходные данные', () => {
    const w = singleWall()
    const row = wallToDbRow(w, 'proj1')
    const restored = wallFromDbRow(row)
    expect(restored.kind).toBe('single')
    expect(restored.input).toEqual(w.input)
    expect(restored.result).toEqual(w.result)
    expect(restored.doubleInput).toBeNull()
    expect(restored.doubleResult).toBeNull()
    expect(restored.positions).toEqual(w.positions)
  })

  it('двойной каркас сериализуется с обёрткой { kind: "double" } в тех же JSONB-колонках', () => {
    const w = doubleWall()
    const row = wallToDbRow(w, 'proj1')
    expect((row.input as any).kind).toBe('double')
    expect((row.result as any).kind).toBe('double')
  })

  it('двойной каркас — полный round-trip восстанавливает doubleInput/doubleResult', () => {
    const w = doubleWall()
    const row = wallToDbRow(w, 'proj1')
    const restored = wallFromDbRow(row)
    expect(restored.kind).toBe('double')
    expect(restored.input).toBeNull()
    expect(restored.result).toBeNull()
    expect(restored.doubleInput).toEqual(w.doubleInput)
    expect(restored.doubleResult).toEqual(w.doubleResult)
  })

  it('старая строка БД без kind (легаси, до 01.09.2026) читается как single', () => {
    const legacyRow = { id: 'old1', label: 'А1', input: singleWall().input, result: singleWall().result, positions: [0, 4000] }
    const restored = wallFromDbRow(legacyRow)
    expect(restored.kind).toBe('single')
    expect(restored.input).toEqual(legacyRow.input)
  })
})
