import { describe, it, expect } from 'vitest'
import { calcLining } from '../calcLining'
import type { LiningInput, Communication } from '../../types'
import { DEFAULT_BOARD_SPEC } from '../../types'

const base: LiningInput = {
  liningType: 'c625',
  profileType: 'ps75',
  profileThickness: '06',
  gklLayers: 1,
  length: 6160,
  height: 2700,
  step: 600,
  hangerStep: 1000,
  abutment: 'both',
  openings: [],
  communications: [],
  layer1: DEFAULT_BOARD_SPEC,
  layer2: DEFAULT_BOARD_SPEC,
  plywoodInserts: [],
}

const positions12 = [0, 600, 1200, 1800, 2400, 3000, 3600, 4200, 4800, 5400, 6000, 6160]

const comm = (bottom: number, top: number): Communication => ({
  id: 'c1', pos: 1100, width: 200, bottom, top,
})

describe('calcLining — транзитные коммуникации (14.07.2026)', () => {
  it('запас > 400мм: стойка на позиции коммуникации остаётся (не door/window), режется двумя кусками', () => {
    const input = { ...base, communications: [comm(1200, 1800)] } // запас = 2700-1800=900
    const res = calcLining(input, positions12)
    const affected = res.studInfos.find(s => s.pos === 1200)!
    expect(affected.isAbove).toBe(true)
    expect(affected.communicationId).toBe('c1')
    expect(affected.kind).toBe('middle')

    const below = res.rawPieces.stud.find(p => p.label.includes('Под коммуникацией'))
    const above = res.rawPieces.stud.find(p => p.label.includes('Над коммуникацией'))
    expect(below?.length).toBe(1200)
    expect(above?.length).toBe(900)

    const lintels = res.rawPieces.pn.filter(p => p.role === 'lintel')
    expect(lintels).toHaveLength(2)
  })

  it('запас ≤ 400мм: только нижний кусок и одна (нижняя) перемычка', () => {
    const input = { ...base, communications: [comm(1200, 2400)] } // запас = 300
    const res = calcLining(input, positions12)
    const above = res.rawPieces.stud.find(p => p.label.includes('Над коммуникацией'))
    expect(above).toBeUndefined()

    const lintels = res.rawPieces.pn.filter(p => p.role === 'lintel')
    expect(lintels).toHaveLength(1)
  })

  it('guideRail включает перемычки коммуникаций (ширина+400 каждая)', () => {
    const withComm = calcLining({ ...base, communications: [comm(1200, 1800)] }, positions12)
    const withoutComm = calcLining(base, positions12)
    // 2 перемычки по (200+400)=600мм = 1200мм = 1.2м
    expect(withComm.guideRail - withoutComm.guideRail).toBeCloseTo(1.2, 3)
  })
})
