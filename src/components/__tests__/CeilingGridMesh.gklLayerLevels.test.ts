import { describe, it, expect } from 'vitest'
import { calcGklLevelM, calcGklLayerLevelsM } from '../CeilingGridMesh'
import { mmToM } from '../../core/planTo3D'

// 05.09.2026 — репорт пользователя: выбор "2 слоя" в калькуляторе потолка
// никак не менял 3D-превью (всегда рисовался один слой 12.5мм). Добавлена
// calcGklLayerLevelsM — центры Y для N стопкой уложенных слоёв реальной
// толщины (2-й слой ниже 1-го, ближе к комнате).

describe('calcGklLayerLevelsM', () => {
  it('один слой 12.5мм даёт тот же уровень, что и старый calcGklLevelM', () => {
    const levels = calcGklLayerLevelsM(0, 'p112', [12.5])
    expect(levels).toHaveLength(1)
    expect(levels[0]).toBeCloseTo(calcGklLevelM(0, 'p112'), 6)
  })

  it('два слоя одной толщины: второй ровно на толщину ниже первого', () => {
    const [l1, l2] = calcGklLayerLevelsM(0, 'p112', [12.5, 12.5])
    expect(l1 - l2).toBeCloseTo(mmToM(12.5), 6)
  })

  it('разная толщина слоёв — расстояние между центрами = среднее их толщин', () => {
    const [l1, l2] = calcGklLayerLevelsM(0, 'p112', [12.5, 9.5])
    expect(l1 - l2).toBeCloseTo(mmToM(12.5 / 2 + 9.5 / 2), 6)
  })

  it('П113 (одноуровневая система) — тот же принцип стека, другая базовая высота', () => {
    const levels = calcGklLevelM(0, 'p113')
    const [l1] = calcGklLayerLevelsM(0, 'p113', [12.5])
    expect(l1).toBeCloseTo(levels, 6)
  })
})
