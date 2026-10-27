import { describe, it, expect } from 'vitest'
import { calcInclined, inclinedEdgeTable, validateInclined } from '../calcInclinedArc'
import { geometryFromChordSagitta, bandGeometry, calcArcLayout, arcV } from '../calcArcLayout'

const IN = { chord: 20860, sagitta: 1900, drop: 1200, shift: 2250 }

describe('calcInclined — наклонная цилиндрическая поверхность', () => {
  const r = calcInclined(IN)
  it('длина стойки 2550 и углы', () => {
    expect(r.rulingLength).toBeCloseTo(2550, 6)
    expect(r.sinA).toBeCloseTo(1200 / 2550, 9)
    expect(r.cosA).toBeCloseTo(2250 / 2550, 9)
    expect(r.angleDeg).toBeCloseTo(28.0725, 3)
  })
  it('радиус и длина дуги в плане', () => {
    expect(r.planRadius).toBeCloseTo(29577.6, 1)
    expect(r.planArcLength).toBeCloseTo(21318.5, 1)
  })
  it('развёртка: длина кромки, стрелы, радиус, площадь', () => {
    expect(r.devChord).toBeCloseTo(20963.1, 0)
    expect(r.sagittaAcross).toBeCloseTo(894.1, 1)
    expect(r.devSagitta).toBeCloseTo(1676.5, 1)
    expect(r.devRadius).toBeCloseTo(33604, -1)
    expect(r.areaM2).toBeCloseTo(53.456, 2)
  })
  it('стрелы сходятся: (s·sinα)² + (s·cosα)² = s²', () => {
    expect(r.sagittaAcross ** 2 + r.devSagitta ** 2).toBeCloseTo(1900 ** 2, 3)
  })
  it('вертикальная поверхность (смещение 0) отклоняется', () => {
    expect(validateInclined({ ...IN, shift: 0 })).not.toBeNull()
    expect(validateInclined(IN)).toBeNull()
  })
})

describe('inclinedEdgeTable', () => {
  const r = calcInclined(IN)
  const t = inclinedEdgeTable(IN, 1000)
  it('концы на хорде развёртки (w = 0), середина = стрела развёртки', () => {
    expect(t[0].u).toBe(0)
    expect(t[0].w).toBeCloseTo(0, 1)
    expect(t[t.length - 1].u).toBeCloseTo(r.devChord, 0)
    expect(t[t.length - 1].w).toBeCloseTo(0, 1)
    const mid = inclinedEdgeTable(IN, r.devChord / 2)[1]
    expect(mid.w).toBeCloseTo(r.devSagitta, 0)
    expect(mid.x).toBeCloseTo(IN.chord / 2, 0)
  })
  it('точное положение близко к окружности развёртки (≤ 1.5 мм)', () => {
    const S = r.devSagitta, C = r.devChord, Rd = r.devRadius
    for (const p of t) {
      const wc = S - Rd + Math.sqrt(Rd * Rd - (p.u - C / 2) ** 2)
      expect(Math.abs(p.w - wc)).toBeLessThan(1.5)
    }
  })
})

describe('bandGeometry — полоса между двумя сдвинутыми дугами', () => {
  const r = calcInclined(IN)
  const base = geometryFromChordSagitta(r.devChord, r.devSagitta)
  const g = bandGeometry(base, r.rulingLength)
  it('нижняя кромка = верхняя + L внутри хорды и ничего за её пределами', () => {
    for (const u of [0, 3000, r.devChord / 2, 17000, r.devChord]) {
      expect(arcV(g, 1, u) - arcV(g, 0, u)).toBeCloseTo(r.rulingLength, 6)
    }
    expect(arcV(g, 1, -10)).toBe(-Infinity)
    expect(arcV(g, 1, r.devChord + 10)).toBe(-Infinity)
  })
  it('раскладка: листы только внутри полосы, лишних нет', () => {
    const lay = calcArcLayout({
      geometry: g, sheetWidth: 1200, sheetLength: 2500, orientation: 'along',
      shiftU: 0, shiftV: 0, stagger: 0, step: 50,
    })
    expect(lay.sheets.length).toBeGreaterThan(0)
    for (const sh of lay.sheets) {
      expect(sh.cuts[0].status).not.toBe('full') // не целиком под верхней кромкой
      expect(sh.cuts[1].status).not.toBe('none') // и не целиком над нижней
    }
    // площадь полосы по раскладке: под нижней кромкой минус под верхней, по листам полосы
    const band = lay.sheets.reduce((a, sh) => a + sh.cuts[1].keptAreaM2 - sh.cuts[0].keptAreaM2, 0)
    expect(band).toBeCloseTo(r.areaM2, 0)
    expect(Math.abs(band - r.areaM2) / r.areaM2).toBeLessThan(0.003)
  })
})
