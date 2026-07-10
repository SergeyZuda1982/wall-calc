import { describe, it, expect } from 'vitest'
import { calcCeilingGrid } from '../ceilingGridGeometry'

describe('calcCeilingGrid', () => {
  it('несущий профиль идёт вдоль length при bearingAlongLength=true, расставлен по width', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    // bearingSegments расставлены поперёк width (2800/900 -> 900,1800,2700)
    expect(grid.bearingSegments.length).toBe(3)
    // каждый несущий сегмент тянется по всей length (0..4000) вдоль X
    for (const seg of grid.bearingSegments) {
      expect(seg.x1).toBe(0)
      expect(seg.x2).toBe(4000)
      expect(seg.z1).toBe(seg.z2) // прямая линия поперёк
    }
  })

  it('основной профиль перпендикулярен несущему и расставлен вдоль length с шагом stepC', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    for (const seg of grid.mainSegments) {
      expect(seg.z1).toBe(0)
      expect(seg.z2).toBe(2800)
      expect(seg.x1).toBe(seg.x2)
    }
    // 4000/600: 600,1200,1800,2400,3000,3600 -> зазор до стены 400 (>250) -> последний подтянут
    expect(grid.mainSegments.length).toBeGreaterThan(0)
  })

  it('bearingAlongLength=false — оси меняются местами', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: false,
    })
    // теперь несущий идёт вдоль Z (width), расставлен по X (length)
    for (const seg of grid.bearingSegments) {
      expect(seg.z1).toBe(0)
      expect(seg.z2).toBe(2800)
      expect(seg.x1).toBe(seg.x2)
    }
  })

  it('точки крабов = пересечения несущих и основных линий (декартово произведение позиций)', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    expect(grid.crabPoints.length).toBe(grid.bearingSegments.length * grid.mainSegments.length)
  })

  it('точки подвесов — подмножество позиций основного профиля (строго на оси), не независимая сетка', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    const hangersPerBearing = grid.hangerPoints.length / grid.bearingSegments.length
    expect(Number.isInteger(hangersPerBearing)).toBe(true)
    expect(hangersPerBearing).toBeGreaterThan(0)
    // каждая X-координата подвеса обязана совпадать с X-координатой одной
    // из линий основного профиля (mainSegments) — это и есть суть фикса
    // 10.07.2026: подвес физически стоит в точке пересечения основной/
    // несущий, а не на своей отдельной сетке.
    const mainXs = new Set(grid.mainSegments.map(s => s.x1))
    const hangerXsForFirstBearing = grid.hangerPoints
      .slice(0, hangersPerBearing)
      .map(p => p.x)
    for (const x of hangerXsForFirstBearing) {
      expect(mainXs.has(x)).toBe(true)
    }
  })

  it('stepA задаёт максимально допустимый шаг подвесов, не обязательный — при мелком шаге c и крупном a подвес ставится не на КАЖДОМ основном профиле', () => {
    const grid = calcCeilingGrid({
      lengthMm: 6000, widthMm: 2800, stepB: 900, stepC: 300, bearingAlongLength: true, stepA: 900,
    })
    const mainCountAlongA = grid.mainSegments.length
    const hangersPerBearing = grid.hangerPoints.length / grid.bearingSegments.length
    // при c=300 (частый основной профиль) и a=900 (втрое реже) большинство
    // узлов основного профиля остаётся без своего подвеса — это ожидаемо:
    // подвес лишь держит СЛЕДУЮЩИЙ узел в пределах допустимого шага a, не
    // обязан стоять на каждом.
    expect(hangersPerBearing).toBeLessThan(mainCountAlongA)
  })

  it('нулевые размеры помещения -> пустая сетка, без исключений', () => {
    const grid = calcCeilingGrid({ lengthMm: 0, widthMm: 0, stepB: 600, stepC: 600, bearingAlongLength: true })
    expect(grid.bearingSegments).toEqual([])
    expect(grid.mainSegments).toEqual([])
    expect(grid.crabPoints).toEqual([])
    expect(grid.hangerPoints).toEqual([])
  })
})
