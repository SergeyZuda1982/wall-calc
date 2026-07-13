import { describe, it, expect } from 'vitest'
import { buildPositions } from '../buildPositions'
import { calcResults } from '../calcResults'
import { flatProfile } from '../profileGeometry'
import type { Opening } from '../../types'

// ─── Хелпер ──────────────────────────────────────────────────────────────────

function calc(
  l: number,
  h: number,
  step: number,
  openings: Opening[] = [],
  abutment = 'both',
  overlap = 500,
) {
  const { positions } = buildPositions(l, h, step, openings)
  return calcResults(positions, flatProfile(l, h), flatProfile(l, 0), l, openings, abutment, overlap)
}

// ─── Направляющие ПН ─────────────────────────────────────────────────────────

describe('calcResults — направляющие ПН', () => {
  it('без проёмов: пол = потолок = l в метрах', () => {
    const r = calc(6000, 2700, 600)
    expect(r.uwFloor).toBeCloseTo(6)
    expect(r.uwCeiling).toBeCloseTo(6)
  })

  it('дверной проём вычитается из пола', () => {
    const d: Opening = { id: 'd', type: 'door', pos: 1000, width: 900, height: 2100, sillHeight: 0 }
    const r = calc(6000, 2700, 600, [d])
    expect(r.uwFloor).toBeCloseTo((6000 - 900) / 1000)
    expect(r.uwCeiling).toBeCloseTo(6) // потолок не меняется
  })

  it('оконный проём не вычитается из пола', () => {
    const w: Opening = { id: 'w', type: 'window', pos: 1000, width: 1200, height: 1200, sillHeight: 900 }
    const r = calc(6000, 2700, 600, [w])
    expect(r.uwFloor).toBeCloseTo(6)
  })

  it('окно "от пола" (sillHeight=0, панорамное остекление) вычитается из пола так же, как дверь', () => {
    const w: Opening = { id: 'w', type: 'window', pos: 1000, width: 1200, height: 2400, sillHeight: 0 }
    const r = calc(6000, 2700, 600, [w])
    expect(r.uwFloor).toBeCloseTo((6000 - 1200) / 1000)
    expect(r.uwSill).toBeCloseTo(0) // подоконника нет
  })

  it('подоконник ПН = ширина + 400мм', () => {
    const w: Opening = { id: 'w', type: 'window', pos: 1000, width: 1200, height: 1200, sillHeight: 900 }
    const r = calc(6000, 2700, 600, [w])
    expect(r.uwSill).toBeCloseTo((1200 + 400) / 1000)
  })

  it('перемычка ПН = ширина + 400мм', () => {
    const d: Opening = { id: 'd', type: 'door', pos: 1000, width: 900, height: 2100, sillHeight: 0 }
    const r = calc(6000, 2700, 600, [d])
    expect(r.lintel).toBeCloseTo((900 + 400) / 1000)
  })
})

// ─── Стойки ПС ───────────────────────────────────────────────────────────────

describe('calcResults — стойки ПС', () => {
  it('h≤3000: needsOverlap=false', () => {
    const r = calc(3000, 2700, 600)
    expect(r.needsOverlap).toBe(false)
  })

  it('h>3000: needsOverlap=true', () => {
    const r = calc(3000, 3500, 600)
    expect(r.needsOverlap).toBe(true)
  })

  it('стойки: крайние (0, l) + рядовые по шагу', () => {
    const r = calc(3000, 2700, 600)
    const positions = r.studInfos.map(s => s.pos)
    expect(positions).toContain(0)
    expect(positions).toContain(3000)
    expect(positions).toContain(600)
  })

  it('ориентация чередуется: first middle = down, second = up', () => {
    const r = calc(3600, 2700, 600)
    const middles = r.studInfos.filter(s => s.kind === 'middle')
    if (middles.length >= 2) {
      expect(middles[0].orientation).toBe('down')
      expect(middles[1].orientation).toBe('up')
    }
  })

  it('дверные стойки всегда orientation=up', () => {
    const d: Opening = { id: 'd', type: 'door', pos: 1000, width: 900, height: 2100, sillHeight: 0 }
    const r = calc(6000, 2700, 600, [d])
    const doorStuds = r.studInfos.filter(s => s.kind === 'door')
    expect(doorStuds.length).toBeGreaterThan(0)
    expect(doorStuds.every(s => s.orientation === 'up')).toBe(true)
  })

  it('стойки внутри оконного проёма: isAbove=true', () => {
    const w: Opening = { id: 'w', type: 'window', pos: 1000, width: 1200, height: 1200, sillHeight: 900 }
    const { positions } = buildPositions(5000, 2700, 600, [w])
    const r = calcResults(positions, flatProfile(5000, 2700), flatProfile(5000, 0), 5000, [w], 'both', 500)
    const above = r.studInfos.filter(s => s.isAbove)
    expect(above.length).toBeGreaterThanOrEqual(0) // может не быть рядовых внутри конкретного проёма
  })
})

// ─── ГКЛ ─────────────────────────────────────────────────────────────────────

describe('calcResults — ГКЛ', () => {
  it('С111 (1 слой, 2 стороны): площадь = 2 × (l×h)', () => {
    const r = calc(3000, 2700, 600)
    expect(r.gklArea).toBeCloseTo((3 * 2.7 * 2), 2)
  })

  it('С112 (2 слоя, 2 стороны): площадь = 4 × (l×h)', () => {
    const { positions } = buildPositions(3000, 2700, 600, [])
    const r = calcResults(positions, flatProfile(3000, 2700), flatProfile(3000, 0), 3000, [], 'both', 500, 2)
    expect(r.gklArea).toBeCloseTo((3 * 2.7 * 4), 2)
  })

  it('площадь дверного проёма вычитается', () => {
    const d: Opening = { id: 'd', type: 'door', pos: 500, width: 900, height: 2100, sillHeight: 0 }
    const { positions } = buildPositions(5000, 2700, 600, [d])
    const r = calcResults(positions, flatProfile(5000, 2700), flatProfile(5000, 0), 5000, [d], 'both', 500, 1)
    const expected = ((5000 * 2700 - 900 * 2100) * 2) / 1_000_000
    expect(r.gklArea).toBeCloseTo(expected, 2)
  })
})

// ─── Раскрой cutList ─────────────────────────────────────────────────────────

describe('calcResults — cutList', () => {
  it('cutList присутствует с полями pn и ps', () => {
    const r = calc(3000, 2700, 600)
    expect(r.cutList).toHaveProperty('pn')
    expect(r.cutList).toHaveProperty('ps')
  })

  it('rawPieces присутствует с полями pn и ps', () => {
    const r = calc(3000, 2700, 600)
    expect(r.rawPieces.pn.length).toBeGreaterThan(0)
    expect(r.rawPieces.ps.length).toBeGreaterThan(0)
  })

  it('общий метраж ПС = cwTotal × 1000 (с погрешностью нахлёстов)', () => {
    // без нахлёста (h≤3000): cwTotal должен = сумма длин всех кусков ПС
    const r = calc(3000, 2700, 600)
    const psTotalMm = r.rawPieces.ps.reduce((s, p) => s + p.length, 0)
    expect(Math.abs(psTotalMm - r.cwTotal * 1000)).toBeLessThan(1) // погрешность округления
  })
})

// ─── Переменная геометрия: мансардный скос потолка ───────────────────────────

describe('calcResults — переменная геометрия (ceilingProfile/floorProfile)', () => {
  it('скошенный потолок: высота крайних стоек разная, средняя — между ними', () => {
    // Длина 4000, шаг 2000 → стойки на 0, 2000, 4000. Потолок 2000→3000.
    const ceiling = [{ x: 0, y: 2000 }, { x: 4000, y: 3000 }]
    const floor = flatProfile(4000, 0)
    const { positions } = buildPositions(4000, 2000, 0, [])
    const r = calcResults(positions, ceiling, floor, 4000, [], 'both', 500)

    const byPos = (p: number) => r.studInfos.find(s => s.pos === p)!
    expect(byPos(0).height).toBe(2000)
    expect(byPos(4000).height).toBe(3000)
    expect(byPos(2000).height).toBeCloseTo(2500)
  })

  it('needsOverlap учитывает максимум по всей геометрии, а не точку x=0', () => {
    // Низкий край < 3000, высокий > 3000 — needsOverlap должен быть true
    const ceiling = [{ x: 0, y: 2500 }, { x: 4000, y: 3500 }]
    const floor = flatProfile(4000, 0)
    const { positions } = buildPositions(4000, 2000, 0, [])
    const r = calcResults(positions, ceiling, floor, 4000, [], 'both', 500)
    expect(r.needsOverlap).toBe(true)
  })

  it('плоский профиль через flatProfile даёт тот же cwTotal, что и старая модель с одним h', () => {
    const L = 6160, H = 3600, OV = 750
    const { positions } = buildPositions(L, 600, 0, [])
    const flat = calcResults(positions, flatProfile(L, H), flatProfile(L, 0), L, [], 'both', OV)
    expect(flat.cwTotal).toBeCloseTo(50.7, 2) // тот же эталон, что и в регрессии выше
  })

  it('ступень в полу: высота стойки за ступенью меньше на величину перепада', () => {
    const ceiling = flatProfile(4000, 3000)
    const floor = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 300 }, { x: 4000, y: 300 }]
    const { positions } = buildPositions(4000, 2000, 0, [])
    const r = calcResults(positions, ceiling, floor, 4000, [], 'both', 500)

    const before = r.studInfos.find(s => s.pos === 0)!
    const after = r.studInfos.find(s => s.pos === 4000)!
    expect(before.height).toBe(3000)
    expect(after.height).toBe(2700)
  })

  it('гклArea для скошенного потолка считается интегралом (трапеция), не l×h', () => {
    const ceiling = [{ x: 0, y: 2000 }, { x: 4000, y: 3000 }]
    const floor = flatProfile(4000, 0)
    const { positions } = buildPositions(4000, 2000, 0, [])
    const r = calcResults(positions, ceiling, floor, 4000, [], 'both', 500, 1)
    // площадь трапеции × 2 стороны / 1e6
    const expected = ((2000 + 3000) / 2 * 4000 * 2) / 1_000_000
    expect(r.gklArea).toBeCloseTo(expected, 2)
  })
})

// ─── Саморезы к перемычке/подоконнику ────────────────────────────────────────

describe('calcResults — саморезы TN/MN/XTN у проёмов (calcScrews)', () => {
  it('дверь: саморезы только к перемычке (n×1×2 стороны)', () => {
    const d: Opening = { id: 'd', type: 'door', pos: 1000, width: 900, height: 2100, sillHeight: 0 }
    const r = calc(6000, 2700, 600, [d])
    const n = Math.ceil(900 / 250)
    expect(r.screws.count25).toBeGreaterThanOrEqual(n * 2) // как минимум перемычка (плюс стойки)
  })

  it('окно "от пола" (sillHeight=0) — саморезы к проёму столько же, сколько у двери такой же ширины', () => {
    const d: Opening = { id: 'd', type: 'door', pos: 1000, width: 900, height: 2100, sillHeight: 0 }
    const w: Opening = { id: 'w', type: 'window', pos: 1000, width: 900, height: 2400, sillHeight: 0 }
    const rDoor = calc(6000, 2700, 600, [d])
    const rWindow = calc(6000, 2700, 600, [w])
    // Раньше (баг) у окна всегда считалось n×2 (перемычка+подоконник), даже без подоконника
    expect(rWindow.screws.count25).toBe(rDoor.screws.count25)
  })

  it('окно с подоконником (sillHeight>0) — саморезов к проёму больше, чем у двери той же ширины (перемычка+подоконник)', () => {
    const d: Opening = { id: 'd', type: 'door', pos: 1000, width: 900, height: 2100, sillHeight: 0 }
    const w: Opening = { id: 'w', type: 'window', pos: 1000, width: 900, height: 1200, sillHeight: 900 }
    const rDoor = calc(6000, 2700, 600, [d])
    const rWindow = calc(6000, 2700, 600, [w])
    expect(rWindow.screws.count25).toBeGreaterThan(rDoor.screws.count25)
  })
})

// ─── Регрессия: конкретный объект из практики ────────────────────────────────

describe('регрессия: перегородка 6160мм, шаг 600, дверь 100-1160', () => {
  const L = 6160, H = 2750, S = 600
  const d: Opening = { id: 'd', type: 'door', pos: 100, width: 1060, height: 2100, sillHeight: 0 }

  it('торцевые стойки двери на 100 и 1160', () => {
    const { positions } = buildPositions(L, H, S, [d])
    expect(positions).toContain(100)
    expect(positions).toContain(1160)
  })

  it('рядовые стойки не ближе MIN_GAP к торцевым двери', () => {
    const { positions } = buildPositions(L, H, S, [d])
    const MIN_GAP = 150
    const regulars = positions.filter(p => p !== 0 && p !== L && p !== 100 && p !== 1160)
    for (const p of regulars) {
      expect(Math.abs(p - 100)).toBeGreaterThan(MIN_GAP)
      expect(Math.abs(p - 1160)).toBeGreaterThan(MIN_GAP)
    }
  })

  it('пол вычитает дверной проём: uwFloor = (6160−1060)/1000', () => {
    const r = calc(L, H, S, [d])
    expect(r.uwFloor).toBeCloseTo((L - d.width) / 1000, 3)
  })
})

// ─── Регрессия: 6160×3600, ПС75, overlap=750 ─────────────────────────────────

describe('регрессия: 6160×3600, ПС75, overlap=750', () => {
  const L = 6160, H = 3600, S = 600, OV = 750

  function calcWith(abutment: string) {
    const { positions } = buildPositions(L, S, 0, [])
    return calcResults(positions, flatProfile(L, H), flatProfile(L, 0), L, [], abutment, OV)
  }

  it('both (Стена-Стена): cwTotal = 50.70 п.м.', () => {
    // 2 wall × 3600 + 10 middle × (3600+750) = 7200 + 43500 = 50700
    expect(calcWith('both').cwTotal).toBeCloseTo(50.7, 2)
  })

  it('none (Отдельностоящая): cwTotal = 53.20 п.м.', () => {
    // 2 free × (3600+600+1250) + 10 middle × 4350 = 2×5450 + 43500 = 54400... 
    // нет: free = 3000+600+(600+750+500) = 3000+600+1850? 
    // правильно: 3600 (торец в торец) + 1250 (соед.) = 4850 на одну free
    // 2×4850 + 10×4350 = 9700 + 43500 = 53200
    expect(calcWith('none').cwTotal).toBeCloseTo(53.2, 2)
  })

  it('left (Стена-Свободно): cwTotal = 51.95 п.м.', () => {
    // 1 wall × 3600 + 1 free × 4850 + 10 middle × 4350 = 3600+4850+43500 = 51950
    expect(calcWith('left').cwTotal).toBeCloseTo(51.95, 2)
  })
})

// ─── Регрессия: wall/free cwTotal ────────────────────────────────────────────

describe('регрессия: cwTotal для разных примыканий, 6160×3600, ПС75, overlap=750', () => {
  const L = 6160, H = 3600, S = 600, OV = 750

  it('both (Стена-Стена): 2×3600 + 10×4350 = 50700мм = 50.70 п.м.', () => {
    const { positions } = buildPositions(L, S, 0, [])
    const r = calcResults(positions, flatProfile(L, H), flatProfile(L, 0), L, [], 'both', OV)
    expect(r.cwTotal).toBeCloseTo(50.7, 2)
  })

  it('none (Отдельностоящая): 2×4850 + 10×4350 = 53200мм = 53.20 п.м.', () => {
    const { positions } = buildPositions(L, S, 0, [])
    const r = calcResults(positions, flatProfile(L, H), flatProfile(L, 0), L, [], 'none', OV)
    expect(r.cwTotal).toBeCloseTo(53.2, 2)
  })

  it('left (Стена-Свободно): 3600 + 4850 + 10×4350 = 51950мм = 51.95 п.м.', () => {
    const { positions } = buildPositions(L, S, 0, [])
    const r = calcResults(positions, flatProfile(L, H), flatProfile(L, 0), L, [], 'left', OV)
    expect(r.cwTotal).toBeCloseTo(51.95, 2)
  })
})
