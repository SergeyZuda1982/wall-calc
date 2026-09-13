import { describe, it, expect } from 'vitest'
import { reverseLineDirection } from '../lineReverse'
import type { PlanLine } from '../../types'

function baseLine(overrides: Partial<PlanLine>): PlanLine {
  return {
    id: 'l1', x1: 0, y1: 0, x2: 100, y2: 0,
    type: 'wall_lining', lengthMm: 2000, label: 'О-1',
    spec: { material: 'gkl', subtype: 'frame_ps50' },
    ...overrides,
  }
}

describe('reverseLineDirection', () => {
  it('меняет местами x1/y1 и x2/y2', () => {
    const line = baseLine({ x1: 10, y1: 20, x2: 90, y2: 20 })
    const patch = reverseLineDirection(line)
    expect(patch).toMatchObject({ x1: 90, y1: 20, x2: 10, y2: 20 })
  })

  it('зеркалит offsetMm проёмов вдоль длины линии', () => {
    const line = baseLine({
      lengthMm: 2000,
      openings: [{ id: 'o1', type: 'door', offsetMm: 300, widthMm: 800, heightMm: 2100, label: 'Д-1' }],
    })
    const patch = reverseLineDirection(line)
    // новый offset = length - offset - width = 2000-300-800 = 900
    expect(patch.openings?.[0].offsetMm).toBe(900)
    expect(patch.openings?.[0].widthMm).toBe(800)
  })

  it('меняет местами fastenerStart/fastenerEnd', () => {
    const line = baseLine({
      fastenerStart: { type: 'dowel_6x40', stepMm: 400 },
      fastenerEnd: { type: 'metal_screw', stepMm: 300 },
    })
    const patch = reverseLineDirection(line)
    expect(patch.fastenerStart).toEqual({ type: 'metal_screw', stepMm: 300 })
    expect(patch.fastenerEnd).toEqual({ type: 'dowel_6x40', stepMm: 400 })
  })

  it('облицовка (sides=1): зеркалит outline finishZonesA, но НЕ трогает finishZonesB/buildProgress meaning', () => {
    const line = baseLine({
      lengthMm: 2000,
      finishZonesA: [{ id: 'z1', outline: [{ x: 100, y: 0 }, { x: 300, y: 500 }], progress: { steps: [] } }],
      buildProgress: { steps: [{ stepId: 's1', label: 'Обшивка', meaning3D: 'sheet_a', outcome: 'confirmed' }] },
    })
    const patch = reverseLineDirection(line)
    expect(patch.finishZonesA?.[0].outline).toEqual([{ x: 1900, y: 0 }, { x: 1700, y: 500 }])
    expect(patch.buildProgress).toBeUndefined()   // для sides===1 не трогаем
  })

  it('двусторонняя стена (sides=2): меняет местами finishZonesA/B и sheet_a/sheet_b', () => {
    const line = baseLine({
      type: 'wall_new',
      spec: { material: 'gkl', subtype: 'frame_ps50' },
      lengthMm: 2000,
      finishZonesA: [{ id: 'za', outline: [{ x: 100, y: 0 }], progress: { steps: [] } }],
      finishZonesB: [{ id: 'zb', outline: [{ x: 400, y: 0 }], progress: { steps: [] } }],
      buildProgress: {
        steps: [
          { stepId: 's1', label: 'A', meaning3D: 'sheet_a', outcome: 'confirmed' },
          { stepId: 's2', label: 'B', meaning3D: 'sheet_b', outcome: 'pending' },
        ],
      },
    })
    const patch = reverseLineDirection(line)
    // бывшая B (зеркалённая) становится новой A, и наоборот
    expect(patch.finishZonesA?.[0].id).toBe('zb')
    expect(patch.finishZonesA?.[0].outline).toEqual([{ x: 1600, y: 0 }])
    expect(patch.finishZonesB?.[0].id).toBe('za')
    expect(patch.finishZonesB?.[0].outline).toEqual([{ x: 1900, y: 0 }])
    expect(patch.buildProgress?.steps[0].meaning3D).toBe('sheet_b')
    expect(patch.buildProgress?.steps[1].meaning3D).toBe('sheet_a')
  })
})
