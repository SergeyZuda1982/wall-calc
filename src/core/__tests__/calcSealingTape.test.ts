import { describe, it, expect } from 'vitest'
import { calcSealingTape, calcDoubleFrameTapeStrips } from '../calcSealingTape'

describe('calcSealingTape', () => {
  it('без пристенных стоек — только ПН потолок + ПН пол', () => {
    const studInfos = [
      { kind: 'free', height: 3000 },
      { kind: 'middle', height: 3000 },
      { kind: 'free', height: 3000 },
    ]
    const res = calcSealingTape(6000, 6000, studInfos)
    expect(res.tapeLm).toBe(12) // (6000+6000)/1000, стойки не 'wall' — не считаются
  })

  it('одна пристенная стойка (abutment left) добавляет её высоту', () => {
    const studInfos = [
      { kind: 'wall', height: 3000 },
      { kind: 'middle', height: 3000 },
      { kind: 'free', height: 3000 },
    ]
    const res = calcSealingTape(6000, 6000, studInfos)
    expect(res.tapeLm).toBe(15) // 6+6+3
  })

  it('обе пристенные стойки (abutment both) суммируются', () => {
    const studInfos = [
      { kind: 'wall', height: 3000 },
      { kind: 'middle', height: 3000 },
      { kind: 'wall', height: 2800 }, // разная высота (скат потолка)
    ]
    const res = calcSealingTape(6000, 6000, studInfos)
    expect(res.tapeLm).toBe(17.8) // 6+6+3+2.8
  })

  it('дверные/оконные торцевые стойки (kind door/window) ленту не получают', () => {
    const studInfos = [
      { kind: 'door', height: 3000 },
      { kind: 'window', height: 3000 },
      { kind: 'middle', height: 3000 },
    ]
    const res = calcSealingTape(4000, 4000, studInfos)
    expect(res.tapeLm).toBe(8) // только направляющие, door/window не 'wall'
  })

  it('пустой список стоек — только направляющие', () => {
    expect(calcSealingTape(1000, 900, []).tapeLm).toBe(1.9)
  })

  it('пол короче потолка (дверной разрыв) — считает как передано, без пересчёта', () => {
    const res = calcSealingTape(6000, 5100, [{ kind: 'wall', height: 3000 }])
    expect(res.tapeLm).toBe(14.1) // 6+5.1+3
  })
})

describe('calcDoubleFrameTapeStrips', () => {
  it('считает количество отрезков по шагу (число стоек по длине)', () => {
    expect(calcDoubleFrameTapeStrips(3000, 600)).toBe(6) // floor(3000/600)+1 = 6
  })

  it('длина меньше шага — минимум 1 отрезок', () => {
    expect(calcDoubleFrameTapeStrips(300, 600)).toBe(1)
  })

  it('некратная длина округляется вниз перед +1', () => {
    expect(calcDoubleFrameTapeStrips(3250, 600)).toBe(6) // floor(5.41)+1=6
  })

  it('нулевая или отрицательная длина/шаг -> 0', () => {
    expect(calcDoubleFrameTapeStrips(0, 600)).toBe(0)
    expect(calcDoubleFrameTapeStrips(3000, 0)).toBe(0)
    expect(calcDoubleFrameTapeStrips(-100, 600)).toBe(0)
  })
})
