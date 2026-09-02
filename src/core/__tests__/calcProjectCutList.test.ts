import { describe, it, expect } from 'vitest'
import { calcProjectCutList } from '../calcProjectCutList'
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

describe('calcProjectCutList — одинарная стена (базовое покрытие)', () => {
  it('даёт пул ps_50/pn_50 с кусками из stud/rail', () => {
    const out = calcProjectCutList([singleWall('w1', 'А1')], [])
    expect(out.pools.ps_50).toBeDefined()
    expect(out.pools.pn_50).toBeDefined()
    expect(out.pools.ps_50!.pieces.length).toBeGreaterThan(0)
  })
})

describe('calcProjectCutList — двойной каркас С115/С116 (01.09.2026)', () => {
  it('оба ряда (frameA+frameB) попадают в ОДИН общий пул того же профиля', () => {
    const dw = doubleWall('w1', 'Б1')
    const out = calcProjectCutList([dw], [])
    const expectedPs = dw.doubleResult!.frameA.rawPieces.ps.length + dw.doubleResult!.frameB.rawPieces.ps.length
    const expectedPn = dw.doubleResult!.frameA.rawPieces.pn.length + dw.doubleResult!.frameB.rawPieces.pn.length
    expect(out.pools.ps_50!.pieces.length).toBe(expectedPs)
    expect(out.pools.pn_50!.pieces.length).toBe(expectedPn)
  })

  it('одинарная и двойная стена одного профиля объединяются в общий пул раскроя (экономия обрезков)', () => {
    const single = singleWall('w1', 'А1')
    const double = doubleWall('w2', 'Б1')
    const combined = calcProjectCutList([single, double], [])
    const separateSingle = calcProjectCutList([single], [])
    const separateDouble = calcProjectCutList([double], [])
    expect(combined.pools.ps_50!.pieces.length).toBe(
      separateSingle.pools.ps_50!.pieces.length + separateDouble.pools.ps_50!.pieces.length,
    )
  })

  it('двойной каркас без doubleResult не даёт кусков (не падает)', () => {
    const dw = doubleWall('w1', 'Б1')
    const broken = { ...dw, doubleResult: null }
    const out = calcProjectCutList([broken], [])
    expect(out.pools.ps_50).toBeUndefined()
  })
})
