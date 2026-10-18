import { describe, it, expect } from 'vitest'
import { wallAreaByBoundary } from '../laborPriceTiers'
import { flatProfile } from '../profileGeometry'
import type { Opening } from '../../types'

const ceil = (pts: [number, number][]) => pts.map(([x, y]) => ({ x, y }))

describe('wallAreaByBoundary', () => {
  it('косая перегородка Сергея: 5700, 4800→5300, отметка 3000', () => {
    const r = wallAreaByBoundary(ceil([[0, 4800], [5700, 5300]]), flatProfile(5700, 0), 5700, 3000)
    expect(r.gross.belowM2).toBeCloseTo(17.1, 6)
    expect(r.gross.aboveM2).toBeCloseTo(11.685, 6)
  })
  it('прямоугольная стена ниже отметки целиком', () => {
    const r = wallAreaByBoundary(flatProfile(4000, 2500), flatProfile(4000, 0), 4000, 3000)
    expect(r.gross.belowM2).toBeCloseTo(10, 6)
    expect(r.gross.aboveM2).toBe(0)
  })
  it('отметка пересекает уклон: 2000→4000, длина 4000, отметка 3000', () => {
    const r = wallAreaByBoundary(ceil([[0, 2000], [4000, 4000]]), flatProfile(4000, 0), 4000, 3000)
    // всего 12 м²; выше отметки треугольник 2000×1000/2 = 1 м²
    expect(r.gross.aboveM2).toBeCloseTo(1, 6)
    expect(r.gross.belowM2).toBeCloseTo(11, 6)
  })
  it('пол с уклоном: отметка режет и пол, и потолок', () => {
    const r = wallAreaByBoundary(flatProfile(4000, 4000), ceil([[0, 0], [4000, 2000]]), 4000, 1000)
    const total = 4000 * (4000 - 1000) / 1e6
    expect(r.gross.belowM2 + r.gross.aboveM2).toBeCloseTo(total, 6)
  })
  it('проём вычитается из своей зоны, пересекающий отметку делится', () => {
    const op: Opening = { id: 'o', type: 'door', pos: 1000, width: 1000, height: 2100, sillHeight: 1500 } as Opening
    const r = wallAreaByBoundary(flatProfile(4000, 4000), flatProfile(4000, 0), 4000, 3000, [op])
    // проём 1500..3600: ниже 1500 мм, выше 600 мм по высоте
    expect(r.openings.belowM2).toBeCloseTo(1.5, 6)
    expect(r.openings.aboveM2).toBeCloseTo(0.6, 6)
    expect(r.net.belowM2).toBeCloseTo(12 - 1.5, 6)
    expect(r.net.aboveM2).toBeCloseTo(4 - 0.6, 6)
  })
})
