import { describe, it, expect } from 'vitest'
import { offsetPolyline, cornerAllowance } from '../calcOffsetPolyline'

// Ниша под пожарный шкаф (чистовые размеры, y — глубина от плоскости 4000).
// Возврат 223 + фаска 177×177 до глубины 400, дальше участки 1900 / 1873 / 4000.
const chain = [
  { x: 0, y: 0 },
  { x: 0, y: 223 },
  { x: 177, y: 400 },
  { x: 177 + 1900, y: 400 },
  { x: 177 + 1900 + 177, y: 223 },
  { x: 177 + 1900 + 177 + 1873, y: 223 },
  { x: 177 + 1900 + 177 + 1873 + 177, y: 0 },
  { x: 177 + 1900 + 177 + 1873 + 177 + 4000, y: 0 },
]

describe('offsetPolyline', () => {
  it('прямой угол, разные толщины: западающий угол даёт +t соседа', () => {
    const r = offsetPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], [25, 12.5])
    expect(r.vertices[0].kind).toBe('concave')
    expect(r.segments[0].endDelta).toBeCloseTo(12.5, 6)
    expect(r.segments[1].startDelta).toBeCloseTo(25, 6)
  })

  it('прямой угол, выступающий: профиль короче на толщину соседа', () => {
    const r = offsetPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -100 }], [22, 22])
    expect(r.vertices[0].kind).toBe('convex')
    expect(r.segments[0].endDelta).toBeCloseTo(-22, 6)
  })

  it('совпадает с формулой t·tan(θ/2) при равной толщине (скос 45°)', () => {
    const r = offsetPolyline(chain, Array(7).fill(22))
    const a = cornerAllowance(22, 45)
    expect(a).toBeCloseTo(9.113, 2)
    // участки: 0 возврат, 1 фаска, 2 run 1900, 3 скос 45°, 4 run 1873, 5 скос 177×223, 6 run 4000
    expect(r.segments[2].startDelta).toBeCloseTo(-a, 6)
    expect(r.segments[2].endDelta).toBeCloseTo(-a, 6)
    expect(r.segments[2].profileLength).toBeCloseTo(1900 - 2 * a, 6)
    expect(r.segments[1].profileLength).toBeCloseTo(177 * Math.SQRT2 - 2 * a, 6)
  })

  it('участки 1873 и 4000 на ниши с обшивкой 22 мм', () => {
    const r = offsetPolyline(chain, Array(7).fill(22))
    const a45 = cornerAllowance(22, 45)
    const aSl = cornerAllowance(22, (Math.atan2(223, 177) * 180) / Math.PI)
    expect(r.segments[4].profileLength).toBeCloseTo(1873 + a45 - aSl, 6)
    expect(r.segments[6].startDelta).toBeCloseTo(aSl, 6)
    expect(r.segments[6].profileLength).toBeCloseTo(4000 + aSl, 6)
    expect(r.warnings).toEqual([])
  })

  it('чистовые длины не меняются, профиль смещён вглубь тела на толщину', () => {
    const r = offsetPolyline(chain, Array(7).fill(22))
    expect(r.segments[2].cleanLength).toBeCloseTo(1900, 9)
    expect(r.segments[2].profileStart.y).toBeCloseTo(400 - 22, 9)
    expect(r.segments[4].profileStart.y).toBeCloseTo(223 - 22, 9)
  })

  it('на одной прямой с разной толщиной получается уступ', () => {
    const r = offsetPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], [12.5, 25])
    expect(r.vertices[0].kind).toBe('jog')
    expect(r.segments[0].profileEnd.y).toBeCloseTo(-12.5, 9)
    expect(r.segments[1].profileStart.y).toBeCloseTo(-25, 9)
  })

  it('предупреждает о вырожденном участке', () => {
    const r = offsetPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -50 }, { x: 40, y: -50 }, { x: 40, y: 0 }], [22, 22, 22, 22])
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})
