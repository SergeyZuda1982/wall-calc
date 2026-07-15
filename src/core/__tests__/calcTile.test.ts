import { describe, it, expect } from 'vitest'
import { calcTile, calcTileLayout } from '../calcTile'
import type { TileInput } from '../../types'

function baseInput(overrides: Partial<TileInput> = {}): TileInput {
  return {
    surfaceMode: 'floor',
    lengthMm: 3000,
    heightMm: 2000,
    tileWidthMm: 600,
    tileHeightMm: 600,
    tileThicknessMm: 8,
    seamMm: 2,
    layoutMode: 'grid',
    offsetRowPercent: 50,
    wastePercent: 10,
    areaPerBoxM2: 1.44,
    adhesiveKgPerM2: 4,
    groutDensityGCm3: 1.6,
    ...overrides,
  }
}

describe('calcTileLayout — раскладка "сеткой" (grid)', () => {
  it('ровно укладывающаяся плитка без подрезки (кратные размеры)', () => {
    // 3000/602 = 4.98 -> 5 колонок с обрезкой последней, разберём точно ниже
    const input = baseInput({ lengthMm: 1204, heightMm: 1204, tileWidthMm: 600, tileHeightMm: 600, seamMm: 2 })
    const layout = calcTileLayout(input)
    // (600+2)*2 = 1204 ровно -> 2 целые плитки по каждой оси, без подрезки
    expect(layout.rows).toBe(2)
    expect(layout.cols).toBe(2)
    expect(layout.pieces.every(p => !p.isCut)).toBe(true)
    expect(layout.cutSizes.length).toBe(0)
  })

  it('некратный размер поверхности даёт подрезку по правому/нижнему краю', () => {
    const input = baseInput({ lengthMm: 1000, heightMm: 1000, tileWidthMm: 600, tileHeightMm: 600, seamMm: 2 })
    const layout = calcTileLayout(input)
    // Шаг 602: первая плитка 0..600 (целая), вторая 602..1000 = 398мм (подрезка)
    expect(layout.cols).toBe(2)
    expect(layout.rows).toBe(2)
    const cutPieces = layout.pieces.filter(p => p.isCut)
    expect(cutPieces.length).toBeGreaterThan(0)
    // Угловой кусок обрезан и по ширине, и по высоте
    const corner = layout.pieces.find(p => p.row === 1 && p.col === 1)
    expect(corner?.w).toBeCloseTo(398, 0)
    expect(corner?.h).toBeCloseTo(398, 0)
  })

  it('плитки не выходят за границы поверхности [0, lengthMm]x[0, heightMm]', () => {
    const input = baseInput({ lengthMm: 2735, heightMm: 1490, tileWidthMm: 333, tileHeightMm: 333, seamMm: 3 })
    const layout = calcTileLayout(input)
    for (const p of layout.pieces) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + p.w).toBeLessThanOrEqual(input.lengthMm + 1e-6)
      expect(p.y + p.h).toBeLessThanOrEqual(input.heightMm + 1e-6)
    }
  })
})

describe('calcTileLayout — раскладка "кирпичиком" (brick)', () => {
  it('чётные (по факту вторые) ряды сдвинуты и дают подрезку по краям даже при кратной поверхности', () => {
    const input = baseInput({
      lengthMm: 1204, heightMm: 1204, tileWidthMm: 600, tileHeightMm: 600, seamMm: 2,
      layoutMode: 'brick', offsetRowPercent: 50,
    })
    const layout = calcTileLayout(input)
    // Первый ряд (row=0) — без сдвига, 2 целые плитки, без подрезки
    const row0 = layout.pieces.filter(p => p.row === 0)
    expect(row0.every(p => !p.isCut)).toBe(true)
    // Второй ряд (row=1) — сдвинут на 300мм (50% от 600) -> первый кусок
    // обрезан слева (300мм), появляется дополнительный кусок справа
    const row1 = layout.pieces.filter(p => p.row === 1)
    expect(row1.some(p => p.isCut)).toBe(true)
    expect(row1.length).toBeGreaterThanOrEqual(row0.length)
  })

  it('offsetRowPercent=0 в brick-режиме эквивалентен grid (сдвига фактически нет)', () => {
    const gridInput = baseInput({ layoutMode: 'grid' })
    const brickInput = baseInput({ layoutMode: 'brick', offsetRowPercent: 0 })
    const gridLayout = calcTileLayout(gridInput)
    const brickLayout = calcTileLayout(brickInput)
    expect(brickLayout.pieces.length).toBe(gridLayout.pieces.length)
  })
})

describe('calcTile — материалы (площадь, коробки, клей, затирка)', () => {
  it('площадь и площадь с запасом считаются от геометрии поверхности напрямую', () => {
    const input = baseInput({ lengthMm: 3000, heightMm: 2000, wastePercent: 10 })
    const result = calcTile(input)
    expect(result.areaM2).toBeCloseTo(6, 6)          // 3м×2м
    expect(result.areaWithWasteM2).toBeCloseTo(6.6, 6) // +10%
  })

  it('коробки считаются от площади с запасом, округление вверх', () => {
    const input = baseInput({ lengthMm: 3000, heightMm: 2000, wastePercent: 10, areaPerBoxM2: 1.44 })
    const result = calcTile(input)
    // 6.6 / 1.44 = 4.5833... -> 5 коробок
    expect(result.boxesCount).toBe(5)
  })

  it('клей считается по площади БЕЗ запаса (расход клея на м² уже задан с учётом реалий монтажа)', () => {
    const input = baseInput({ lengthMm: 3000, heightMm: 2000, wastePercent: 10, adhesiveKgPerM2: 4 })
    const result = calcTile(input)
    expect(result.adhesiveKg).toBeCloseTo(24, 6) // 6м² × 4кг/м²
  })

  it('затирка — стандартная формула (A+B)/(A×B) × шов × глубина × плотность, проверочная точка 300×300/3мм/8мм/1.6', () => {
    const input = baseInput({
      lengthMm: 1000, heightMm: 1000, tileWidthMm: 300, tileHeightMm: 300,
      seamMm: 3, tileThicknessMm: 8, groutDensityGCm3: 1.6, wastePercent: 0,
    })
    const result = calcTile(input)
    // (300+300)/(300*300) * 3 * 8 * 1.6 = 0.006667*3*8*1.6 = 0.256 кг/м²
    // площадь 1м² -> итог 0.256кг
    expect(result.groutKg).toBeCloseTo(0.256, 3)
  })

  it('целых плиток к покупке считается через площадь+запас / площадь плитки, а не через число кусков раскладки', () => {
    const input = baseInput({ lengthMm: 3000, heightMm: 2000, tileWidthMm: 600, tileHeightMm: 600, wastePercent: 10 })
    const result = calcTile(input)
    // areaWithWasteM2=6.6, площадь плитки 0.36м² -> 6.6/0.36=18.33 -> 19
    expect(result.tilesWholeEquivalent).toBe(19)
  })

  it('памятка резов (cutSizes) сгруппирована и отсортирована по убыванию количества', () => {
    const input = baseInput({ lengthMm: 1000, heightMm: 1000, tileWidthMm: 600, tileHeightMm: 600, seamMm: 2 })
    const result = calcTile(input)
    expect(result.layout.cutSizes.length).toBeGreaterThan(0)
    for (let i = 1; i < result.layout.cutSizes.length; i++) {
      expect(result.layout.cutSizes[i - 1].count).toBeGreaterThanOrEqual(result.layout.cutSizes[i].count)
    }
  })
})
