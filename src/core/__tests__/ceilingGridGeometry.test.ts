import { describe, it, expect } from 'vitest'
import { calcCeilingGrid, calcCeilingGridP113 } from '../ceilingGridGeometry'

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

  it('точки подвесов — подмножество позиций несущего профиля (строго на оси), не независимая сетка (12.07.2026: подвес крепится к ОСНОВНОМУ, снэп по несущему — было наоборот)', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    const hangersPerMain = grid.hangerPoints.length / grid.mainSegments.length
    expect(Number.isInteger(hangersPerMain)).toBe(true)
    expect(hangersPerMain).toBeGreaterThan(0)
    // каждая Z-координата подвеса обязана совпадать с Z-координатой одной
    // из линий несущего профиля (bearingSegments) — подвес физически стоит
    // в точке пересечения основной/несущий, а не на своей отдельной сетке.
    const bearingZs = new Set(grid.bearingSegments.map(s => s.z1))
    const hangerZsForFirstMain = grid.hangerPoints
      .slice(0, hangersPerMain)
      .map(p => p.z)
    for (const z of hangerZsForFirstMain) {
      expect(bearingZs.has(z)).toBe(true)
    }
  })

  it('stepA задаёт максимально допустимый шаг подвесов, не обязательный — при мелком шаге b и крупном a подвес ставится не на КАЖДОМ несущем профиле', () => {
    const grid = calcCeilingGrid({
      lengthMm: 2800, widthMm: 6000, stepB: 300, stepC: 900, bearingAlongLength: true, stepA: 900,
    })
    const bearingCountAlongB = grid.bearingSegments.length
    const hangersPerMain = grid.hangerPoints.length / grid.mainSegments.length
    // при b=300 (частый несущий профиль) и a=900 (втрое реже) большинство
    // узлов несущего профиля остаётся без своего подвеса — это ожидаемо:
    // подвес лишь держит СЛЕДУЮЩИЙ узел в пределах допустимого шага a, не
    // обязан стоять на каждом.
    expect(hangersPerMain).toBeLessThan(bearingCountAlongB)
  })

  it('нулевые размеры помещения -> пустая сетка, без исключений', () => {
    const grid = calcCeilingGrid({ lengthMm: 0, widthMm: 0, stepB: 600, stepC: 600, bearingAlongLength: true })
    expect(grid.bearingSegments).toEqual([])
    expect(grid.mainSegments).toEqual([])
    expect(grid.crabPoints).toEqual([])
    expect(grid.hangerPoints).toEqual([])
  })
})

describe('calcCeilingGridP113 (13.07.2026, одноуровневая система — см. calcP113Frame.ts)', () => {
  it('основной профиль сплошной, идёт вдоль length при mainAlongLength=true, расставлен по width', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    for (const seg of grid.mainSegments) {
      expect(seg.x1).toBe(0)
      expect(seg.x2).toBe(4000)
      expect(seg.z1).toBe(seg.z2)
    }
    expect(grid.mainSegments.length).toBeGreaterThan(0)
  })

  it('несущий профиль — короткие вставки: сумма длин в одном ряду = полному пролёту width', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    // Все вставки несущего идут вдоль Z (x1===x2, короткая длина по z),
    // в отличие от П112, где несущий сплошной на всю ширину помещения.
    for (const seg of grid.bearingSegments) {
      expect(seg.x1).toBe(seg.x2)
      expect(seg.z2 - seg.z1).toBeGreaterThan(0)
    }
    // группируем по alongA (x1) — сумма длин в одной группе должна дать 2800
    const byX = new Map<number, number>()
    for (const seg of grid.bearingSegments) {
      byX.set(seg.x1, (byX.get(seg.x1) ?? 0) + (seg.z2 - seg.z1))
    }
    expect(byX.size).toBeGreaterThan(0)
    for (const total of byX.values()) {
      expect(total).toBeCloseTo(2800, 6)
    }
  })

  it('число коротких кусков несущего в одном ряду = mainSegments.length + 1 (крайние у стен + между рядами)', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    const byX = new Map<number, number>()
    for (const seg of grid.bearingSegments) {
      byX.set(seg.x1, (byX.get(seg.x1) ?? 0) + 1)
    }
    for (const piecesInRow of byX.values()) {
      expect(piecesInRow).toBe(grid.mainSegments.length + 1)
    }
  })

  it('mainAlongLength=false — оси меняются местами (основной вдоль Z)', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: false,
    })
    for (const seg of grid.mainSegments) {
      expect(seg.z1).toBe(0)
      expect(seg.z2).toBe(2800)
      expect(seg.x1).toBe(seg.x2)
    }
  })

  it('точки соединителей = decartово произведение позиций (mainCount × bearingRowCount)', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    const bearingRowCount = new Set(grid.bearingSegments.map(s => s.x1)).size
    expect(grid.crabPoints.length).toBe(grid.mainSegments.length * bearingRowCount)
  })

  it('подвесы — на основном профиле (по числу mainSegments рядов), позиции подмножество несущего', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    const hangersPerMain = grid.hangerPoints.length / grid.mainSegments.length
    expect(Number.isInteger(hangersPerMain)).toBe(true)
    expect(hangersPerMain).toBeGreaterThan(0)
    const bearingXs = new Set(grid.bearingSegments.map(s => s.x1))
    for (const p of grid.hangerPoints) {
      expect(bearingXs.has(p.x)).toBe(true)
    }
  })

  it('нулевые размеры помещения -> пустая сетка, без исключений', () => {
    const grid = calcCeilingGridP113({ lengthMm: 0, widthMm: 0, stepB: 500, stepC: 600, mainAlongLength: true })
    expect(grid.bearingSegments).toEqual([])
    expect(grid.mainSegments).toEqual([])
    expect(grid.crabPoints).toEqual([])
    expect(grid.hangerPoints).toEqual([])
  })
})
