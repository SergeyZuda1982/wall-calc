import { describe, it, expect } from 'vitest'
import { calcCeiling } from '../calcCeiling'
import { calcCeilingBorder } from '../calcCeilingBorder'
import { calcMultiLevelCeiling } from '../calcMultiLevelCeiling'
import type { CeilingSpecFull } from '../../data/ceilingData'
import type { CeilingBorder } from '../../types'

// Два соседних уровня П19 (упрощённо — реальный объект 6 ступеней, здесь
// для теста берём 2 соседние), оба П112, разные площади.
const LEVEL_1: CeilingSpecFull = {
  type: 'p112', layers: 1, material: 'gsp', thickness: 12.5, stepC: 600,
  areaSqm: 30, perimeterM: 22, roomLengthMm: 6000, roomWidthMm: 5000, sheetLengthMm: 2500,
}
const LEVEL_2: CeilingSpecFull = {
  type: 'p112', layers: 1, material: 'gsp', thickness: 12.5, stepC: 600,
  areaSqm: 8, perimeterM: 12, roomLengthMm: 4000, roomWidthMm: 2000, sheetLengthMm: 2500,
}
const BORDER: CeilingBorder = {
  id: 'b1', label: 'Борт 1→2',
  path: [{ x: 0, y: 0 }, { x: 15000, y: 0 }],
  jointType: 'p112_p113_angle_connector',
  dropMm: 250, shelfDepthMm: 125, stepCMm: 600, sheetLengthMm: 2500,
}

describe('calcMultiLevelCeiling — 2 уровня + 1 борт (сквозной сценарий)', () => {
  const level1Result = calcCeiling(LEVEL_1)
  const level2Result = calcCeiling(LEVEL_2)
  const borderResult = calcCeilingBorder(BORDER)

  const res = calcMultiLevelCeiling(
    [
      { label: 'Ступень 1', result: level1Result },
      { label: 'Ступень 2', result: level2Result },
    ],
    [{ label: 'Борт 1→2', result: borderResult }],
  )

  it('суммарная площадь = сумма площадей уровней', () => {
    expect(res.totalAreaSqm).toBeCloseTo(38, 6)
    expect(res.levels).toEqual([
      { label: 'Ступень 1', areaSqm: 30 },
      { label: 'Ступень 2', areaSqm: 8 },
    ])
  })

  it('суммарная длина бортов = длина пути борта', () => {
    expect(res.totalBorderLengthM).toBeCloseTo(15, 6)
    expect(res.borders).toEqual([{ label: 'Борт 1→2', pathLengthM: 15 }])
  })

  it('материалы обоих уровней и борта присутствуют в общем списке', () => {
    const connector = res.materials.find(m => m.name.startsWith('Соединитель угловой'))
    expect(connector).toBeDefined()
    expect(connector!.qty).toBe(26) // как и в calcCeilingBorder.test.ts для того же борта

    // хотя бы один материал уровня (лист ГКЛ) присутствует
    const gklLevel = res.materials.find(m => m.name.includes('ГКЛ') && !m.name.includes('борт'))
    expect(gklLevel).toBeDefined()
  })

  it('одноимённые материалы с одинаковой единицей суммируются в одну строку', () => {
    // считаем вручную: сколько раз имя+единица встречается по отдельности
    const rawItems = [...level1Result.materials, ...level2Result.materials, ...borderResult.materials]
    const byKey = new Map<string, number>()
    for (const it of rawItems) {
      const key = `${it.name}__${it.unit}`
      byKey.set(key, (byKey.get(key) ?? 0) + it.qty)
    }
    for (const item of res.materials) {
      const key = `${item.name}__${item.unit}`
      expect(item.qty).toBeCloseTo(byKey.get(key)!, 6)
    }
    // и наоборот — ни одна пара name+unit не потерялась и не задвоилась
    expect(res.materials.length).toBe(byKey.size)
  })

  it('предупреждения помечены источником в квадратных скобках', () => {
    expect(res.warnings.length).toBeGreaterThan(0)
    expect(res.warnings.every(w => w.startsWith('['))).toBe(true)
    expect(res.warnings.some(w => w.startsWith('[Борт 1→2]'))).toBe(true)
  })

  it('порядок материалов — по первому появлению (уровень 1 → уровень 2 → борт)', () => {
    const firstLevel1Name = level1Result.materials[0].name
    const firstOverallName = res.materials[0].name
    expect(firstOverallName).toBe(firstLevel1Name)
  })
})

describe('calcMultiLevelCeiling — без бортов (один уровень, вырожденный случай)', () => {
  it('работает и без бортов вообще (borders по умолчанию пуст)', () => {
    const level1Result = calcCeiling(LEVEL_1)
    const res = calcMultiLevelCeiling([{ label: 'Ступень 1', result: level1Result }])
    expect(res.totalAreaSqm).toBeCloseTo(30, 6)
    expect(res.totalBorderLengthM).toBe(0)
    expect(res.borders).toEqual([])
  })
})

describe('calcMultiLevelCeiling — граничный случай', () => {
  it('без единого уровня — кидает ошибку (как combineCeilingSeeds для пустых зон)', () => {
    expect(() => calcMultiLevelCeiling([])).toThrow()
  })
})
