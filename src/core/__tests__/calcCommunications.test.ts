import { describe, it, expect } from 'vitest'
import { buildPositions } from '../buildPositions'
import { calcResults } from '../calcResults'
import { flatProfile } from '../profileGeometry'
import type { Communication } from '../../types'

// ─── Хелпер ──────────────────────────────────────────────────────────────────
// Стена 6000×2700, шаг 600 → стойки на 600/1200/1800/... — коммуникация
// шириной 200мм в диапазоне (1100,1300) задевает стойку на 1200.

function calc(communications: Communication[], height = 2700) {
  const l = 6000
  const step = 600
  const { positions } = buildPositions(l, step, step, [])
  return calcResults(
    positions, flatProfile(l, height), flatProfile(l, 0), l,
    [], 'both', 500, 1, undefined, undefined, [], 2, communications,
  )
}

const comm = (bottom: number, top: number): Communication => ({
  id: 'c1', pos: 1100, width: 200, bottom, top,
})

describe('calcResults — транзитные коммуникации (14.07.2026)', () => {
  it('запас над коммуникацией > 400мм: стойка на её позиции остаётся, режется двумя кусками', () => {
    const r = calc([comm(1200, 1800)]) // потолок 2700, запас = 2700-1800=900 > 400
    const affected = r.studInfos.find(s => s.pos === 1200)
    expect(affected).toBeTruthy()
    expect(affected!.isAbove).toBe(true)
    expect(affected!.communicationId).toBe('c1')
    expect(affected!.kind).toBe('middle') // НЕ door/window — стойка не заменяется

    // Кусок под коммуникацией всегда, кусок над — раз запас>400
    const belowPiece = r.rawPieces.ps.find(p => p.label.includes('Под коммуникацией'))
    const abovePiece = r.rawPieces.ps.find(p => p.label.includes('Над коммуникацией'))
    expect(belowPiece?.length).toBe(1200)
    expect(abovePiece?.length).toBe(900) // 2700-1800

    // Обе перемычки (нижняя+верхняя), формула ширина+400 = 600 каждая
    const lintels = r.rawPieces.pn.filter(p => p.role === 'lintel')
    expect(lintels).toHaveLength(2)
    for (const l of lintels) expect(l.length).toBe(600)
  })

  it('запас над коммуникацией ≤ 400мм: только нижняя перемычка и нижний кусок', () => {
    const r = calc([comm(1200, 2400)]) // запас = 2700-2400=300 ≤ 400
    const affected = r.studInfos.find(s => s.pos === 1200)!
    expect(affected.isAbove).toBe(true)

    const abovePiece = r.rawPieces.ps.find(p => p.label.includes('Над коммуникацией'))
    expect(abovePiece).toBeUndefined()

    const lintels = r.rawPieces.pn.filter(p => p.role === 'lintel')
    expect(lintels).toHaveLength(1)
    expect(lintels[0].length).toBe(600)
  })

  it('cwTotal учитывает обе части (под+над) коммуникации, а не полную высоту стойки', () => {
    const withComm = calc([comm(1200, 1800)])
    const withoutComm = calc([])
    // Рядовая стойка целиком (2700мм) заменяется на 1200+900=2100мм —
    // материала должно стать МЕНЬШЕ на разницу (2700-2100=600мм = 0.6м)
    expect(withoutComm.cwTotal - withComm.cwTotal).toBeCloseTo(0.6, 3)
  })

  it('коммуникация не попадающая ни на одну стойку: перемычки всё равно считаются (по позиции, не по стойке), но студ не режется', () => {
    const r = calc([{ id: 'c2', pos: 250, width: 50, bottom: 1000, top: 1500 }])
    // Диапазон (250,300) не содержит ни одной стойки сетки (300/600/...) —
    // ни одна стойка не размечается communicationId.
    expect(r.studInfos.some(s => s.communicationId)).toBe(false)
    // Но перемычка (обрамление проёма под коммуникацию) считается по самой
    // коммуникации, а не по попаданию стойки — она нужна независимо.
    expect(r.rawPieces.pn.filter(p => p.role === 'lintel')).toHaveLength(2)
  })
})
