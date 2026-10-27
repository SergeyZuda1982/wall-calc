import { describe, it, expect } from 'vitest'
import { buildInclinedSurface3D } from '../inclinedArc3D'
import { calcInclined } from '../calcInclinedArc'

const IN = { chord: 20860, sagitta: 1900, drop: 1200, shift: 2250 }

describe('buildInclinedSurface3D', () => {
  const s = buildInclinedSurface3D(IN)!
  const n = s.cols
  const top = (c: number) => [s.topEdge[c * 3], s.topEdge[c * 3 + 1], s.topEdge[c * 3 + 2]]
  const bot = (c: number) => [s.bottomEdge[c * 3], s.bottomEdge[c * 3 + 1], s.bottomEdge[c * 3 + 2]]
  it('невалидный вход даёт null', () => {
    expect(buildInclinedSurface3D({ ...IN, shift: 0 })).toBeNull()
  })
  it('верхняя кромка: концы на хорде (Z=0), центр на стреле 1.9 м, всё на Y=0', () => {
    expect(top(0)[2]).toBeCloseTo(0, 6)
    expect(top(n)[2]).toBeCloseTo(0, 6)
    expect(top(n / 2)[2]).toBeCloseTo(1.9, 4)
    expect(top(n / 2)[0]).toBeCloseTo(0, 6)
    expect(top(0)[0]).toBeCloseTo(-10.43, 4)
    for (let c = 0; c <= n; c++) expect(top(c)[1]).toBe(0)
  })
  it('нижняя кромка = верхняя, сдвинутая на (опуск вниз, смещение по Z)', () => {
    for (const c of [0, n / 4, n / 2, n]) {
      expect(bot(c)[1]).toBeCloseTo(-1.2, 6)
      expect(bot(c)[2] - top(c)[2]).toBeCloseTo(2.25, 6)
      expect(bot(c)[0]).toBeCloseTo(top(c)[0], 6)
    }
  })
  it('стойка между кромками имеет длину 2.55 м', () => {
    const L = Math.hypot(s.studs[3] - s.studs[0], s.studs[4] - s.studs[1], s.studs[5] - s.studs[2])
    expect(L).toBeCloseTo(2.55, 4)
  })
  it('стоек столько же, сколько точек таблицы с шагом 400 (≈ 53 + 1)', () => {
    const r = calcInclined(IN)
    expect(s.studCount).toBe(Math.ceil(r.devChord / 400) + 1)
    expect(s.studs.length).toBe(s.studCount * 6)
  })
  it('сетка: число вершин и треугольников, индексы в пределах', () => {
    expect(s.positions.length).toBe((s.rows + 1) * (s.cols + 1) * 3)
    expect(s.indices.length).toBe(s.rows * s.cols * 6)
    expect(Math.max(...s.indices)).toBe((s.rows + 1) * (s.cols + 1) - 1)
  })
  it('просадка: у краёв нижняя кромка ниже на edgeDroop, в центре нет', () => {
    const d = buildInclinedSurface3D({ ...IN, edgeDroop: 30 })!
    expect(d.bottomEdge[1]).toBeCloseTo(-1.23, 6)
    expect(d.bottomEdge[(n / 2) * 3 + 1]).toBeCloseTo(-1.2, 6)
    expect(d.bottomEdge[n * 3 + 1]).toBeCloseTo(-1.23, 6)
  })
  it('габариты: ширина = хорда, глубина = опуск, вынос по Z = стрела + смещение', () => {
    expect(s.size[0]).toBeCloseTo(20.86, 6)
    expect(s.size[1]).toBeCloseTo(1.2, 6)
    expect(s.size[2]).toBeCloseTo(1.9 + 2.25, 4)
  })
})
