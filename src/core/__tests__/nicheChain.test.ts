import { describe, it, expect } from 'vitest'
import { analyzeNiche, exampleNiche, mirrorAppend, nichePoints, sanitizeNiche, validateNiche } from '../nicheChain'

describe('nicheChain', () => {
  it('пример: 13 участков, цепочка симметрична и приходит на плоскость стены', () => {
    const m = exampleNiche(1, 22)
    expect(m.segs).toHaveLength(13)
    const p = nichePoints(m)
    expect(p[0]).toEqual({ x: 0, y: 0 })
    expect(p[p.length - 1].y).toBe(0)
    expect(p[p.length - 1].x).toBeCloseTo(2 * (177 + 1900 + 177 + 1873 + 177) + 4000, 9)
  })

  it('полная ниша: участок 4000 удлиняется на оба западающих угла', () => {
    const a = analyzeNiche(exampleNiche(1, 22))
    const run4000 = a.rows[6]
    expect(run4000.kind).toBe('run')
    expect(run4000.cleanLength).toBe(4000)
    expect(run4000.profileLength).toBeCloseTo(4000 + 2 * 10.6, 0)
    expect(a.warnings).toEqual([])
  })

  it('глубина профиля: участок 1900 на 400−t, 1873 на 223−t, 4000 на −t', () => {
    const a = analyzeNiche(exampleNiche(2, 12.5))
    expect(a.rows[2].profileDepthStart).toBeCloseTo(375, 9)
    expect(a.rows[4].profileDepthStart).toBeCloseTo(198, 9)
    expect(a.rows[6].profileDepthStart).toBeCloseTo(-25, 9)
  })

  it('разное число слоёв на соседних участках считается без формулы tan', () => {
    const m = exampleNiche(1, 12.5)
    m.segs[2].layers = 2
    const a = analyzeNiche(m)
    expect(a.rows[2].thickness).toBe(25)
    expect(a.rows[2].profileDepthStart).toBeCloseTo(375, 9)
  })

  it('зеркало меняет порядок и глубины', () => {
    const m = mirrorAppend({ startDepth: 0, segs: [{ along: 100, depth: 50, layers: 1, board: 12.5 }] })
    expect(m.segs).toHaveLength(2)
    expect(m.segs[1]).toMatchObject({ along: 100, depth: 0 })
  })

  it('зеркало склеивает центральный участок и не склеивает разную обшивку', () => {
    const a = mirrorAppend({ startDepth: 0, segs: [{ along: 100, depth: 0, layers: 1, board: 12.5 }] })
    expect(a.segs).toEqual([{ along: 200, depth: 0, layers: 1, board: 12.5 }])
    const b = mirrorAppend({ startDepth: 0, segs: [{ along: 100, depth: 30, layers: 1, board: 12.5 }] })
    expect(b.segs).toHaveLength(2)
  })

  it('валидация ловит нулевой и отрицательный участки', () => {
    expect(validateNiche({ startDepth: 0, segs: [{ along: 0, depth: 0, layers: 1, board: 12.5 }] })).toMatch(/нулевой/)
    expect(validateNiche({ startDepth: 0, segs: [{ along: -5, depth: 0, layers: 1, board: 12.5 }] })).toMatch(/отриц/)
    expect(validateNiche(exampleNiche())).toBeNull()
  })

  it('sanitize: мусор превращается в пример, лишние поля отбрасываются', () => {
    expect(sanitizeNiche(null).segs).toHaveLength(13)
    const s = sanitizeNiche({ startDepth: 5, segs: [{ along: 'x', depth: 10, layers: 3 }] })
    expect(s).toEqual({ startDepth: 5, segs: [{ along: 0, depth: 10, layers: 3, board: 12.5 }] })
  })
})
