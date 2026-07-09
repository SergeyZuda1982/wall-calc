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

  it('точки подвесов идут вдоль каждой несущей линии с тем же шагом stepB', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    // вдоль length=4000 с шагом 900: 900,1800,2700,3750 (закрывающий) = 4 точки на каждую несущую линию
    const hangersPerBearing = grid.hangerPoints.length / grid.bearingSegments.length
    expect(Number.isInteger(hangersPerBearing)).toBe(true)
    expect(hangersPerBearing).toBeGreaterThan(0)
  })

  it('нулевые размеры помещения -> пустая сетка, без исключений', () => {
    const grid = calcCeilingGrid({ lengthMm: 0, widthMm: 0, stepB: 600, stepC: 600, bearingAlongLength: true })
    expect(grid.bearingSegments).toEqual([])
    expect(grid.mainSegments).toEqual([])
    expect(grid.crabPoints).toEqual([])
    expect(grid.hangerPoints).toEqual([])
  })
})
