import { describe, it, expect } from 'vitest'
import {
  flatProfile, normalizeProfile, sortProfile,
  interpolateY, interpolateYLeft, studHeightAt, studHeightAtLeft,
  maxStudHeight, integrateHeight, profilePathLength,
} from '../profileGeometry'

// ─── flatProfile / sortProfile ───────────────────────────────────────────────

describe('flatProfile', () => {
  it('даёт две точки на одном уровне', () => {
    expect(flatProfile(5000, 2700)).toEqual([{ x: 0, y: 2700 }, { x: 5000, y: 2700 }])
  })
})

describe('sortProfile', () => {
  it('сортирует точки по x', () => {
    const sorted = sortProfile([{ x: 3000, y: 1 }, { x: 0, y: 2 }, { x: 1500, y: 3 }])
    expect(sorted.map(p => p.x)).toEqual([0, 1500, 3000])
  })
})

// ─── interpolateY ─────────────────────────────────────────────────────────────

describe('interpolateY', () => {
  it('плоская линия: y constant везде', () => {
    const p = flatProfile(6000, 2700)
    expect(interpolateY(p, 0)).toBe(2700)
    expect(interpolateY(p, 3000)).toBe(2700)
    expect(interpolateY(p, 6000)).toBe(2700)
  })

  it('линейный скос: середина = среднее', () => {
    const p = [{ x: 0, y: 2400 }, { x: 4000, y: 3200 }]
    expect(interpolateY(p, 2000)).toBeCloseTo(2800)
    expect(interpolateY(p, 0)).toBe(2400)
    expect(interpolateY(p, 4000)).toBe(3200)
  })

  it('за пределами диапазона — клампится к крайним точкам', () => {
    const p = [{ x: 1000, y: 2700 }, { x: 5000, y: 3000 }]
    expect(interpolateY(p, -500)).toBe(2700)
    expect(interpolateY(p, 9000)).toBe(3000)
  })

  it('ломаная (ровно-скос-ровно): три сегмента', () => {
    const p = [{ x: 0, y: 2400 }, { x: 2000, y: 2400 }, { x: 4000, y: 3200 }, { x: 6000, y: 3200 }]
    expect(interpolateY(p, 1000)).toBe(2400)   // первый ровный участок
    expect(interpolateY(p, 3000)).toBeCloseTo(2800) // середина ската
    expect(interpolateY(p, 5000)).toBe(3200)   // второй ровный участок
  })

  it('вертикальная ступень (одинаковый x, разный y): на стыке берётся правая точка', () => {
    const p = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 300 }, { x: 4000, y: 300 }]
    expect(interpolateY(p, 1999)).toBeCloseTo(0)
    expect(interpolateY(p, 2000)).toBe(300)
    expect(interpolateY(p, 2001)).toBeCloseTo(300)
  })
})

// ─── interpolateYLeft (фикс 20.07.2026: точки перегиба с одинаковым x без +1мм) ─

describe('interpolateYLeft', () => {
  // Точки перегиба (потолок/пол) теперь можно задавать напрямую с одинаковым x
  // (например 2500/3600 затем 2500/3000 для балки), без искусственного сдвига
  // на +1мм. interpolateYLeft — левая (до перепада) сторона стыка, в отличие
  // от interpolateY, которая всегда даёт правую (после перепада).
  const p = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 300 }, { x: 4000, y: 300 }]

  it('на самом стыке (x=2000) даёт ЛЕВУЮ (до перепада) точку — наоборот от interpolateY', () => {
    expect(interpolateYLeft(p, 2000)).toBe(0)
    expect(interpolateY(p, 2000)).toBe(300)
  })

  it('вне стыка совпадает с interpolateY (нет разницы, если x не на скачке)', () => {
    expect(interpolateYLeft(p, 1999)).toBeCloseTo(interpolateY(p, 1999))
    expect(interpolateYLeft(p, 2001)).toBeCloseTo(interpolateY(p, 2001))
    expect(interpolateYLeft(p, 0)).toBe(interpolateY(p, 0))
    expect(interpolateYLeft(p, 4000)).toBe(interpolateY(p, 4000))
  })

  it('без вертикальной ступени (обычный уклон) — тоже совпадает с interpolateY', () => {
    const slope = [{ x: 0, y: 2400 }, { x: 4000, y: 3200 }]
    expect(interpolateYLeft(slope, 2000)).toBeCloseTo(interpolateY(slope, 2000))
  })
})

describe('studHeightAtLeft', () => {
  it('балка на потолке (перепад в обе стороны, x одинаковый без +1мм): высота слева от балки — до перепада', () => {
    // Потолок: 2500 до x=2000, скачком до 2000, снова 2500 после x=2500 —
    // то есть балка/ригель шириной 500мм с просадкой потолка на 500мм.
    const ceiling = [
      { x: 0, y: 2500 }, { x: 2000, y: 2500 },
      { x: 2000, y: 2000 },
      { x: 2500, y: 2000 }, { x: 2500, y: 2500 },
      { x: 4000, y: 2500 },
    ]
    const floor = flatProfile(4000, 0)
    expect(studHeightAtLeft(2000, ceiling, floor)).toBe(2500) // до балки
    expect(studHeightAt(2000, ceiling, floor)).toBe(2000)     // после балки (правая часть стыка)
    expect(studHeightAtLeft(2500, ceiling, floor)).toBe(2000) // конец балки, до подъёма
    expect(studHeightAt(2500, ceiling, floor)).toBe(2500)     // после подъёма
  })
})

// ─── studHeightAt ─────────────────────────────────────────────────────────────

describe('studHeightAt', () => {
  it('плоский потолок и пол: высота = h везде, как раньше', () => {
    const ceiling = flatProfile(6160, 3600)
    const floor = flatProfile(6160, 0)
    expect(studHeightAt(0, ceiling, floor)).toBe(3600)
    expect(studHeightAt(3000, ceiling, floor)).toBe(3600)
    expect(studHeightAt(6160, ceiling, floor)).toBe(3600)
  })

  it('мансардный скос потолка: высота линейно растёт', () => {
    const ceiling = [{ x: 0, y: 2000 }, { x: 4000, y: 3000 }]
    const floor = flatProfile(4000, 0)
    expect(studHeightAt(0, ceiling, floor)).toBe(2000)
    expect(studHeightAt(2000, ceiling, floor)).toBeCloseTo(2500)
    expect(studHeightAt(4000, ceiling, floor)).toBe(3000)
  })

  it('ступень в полу: высота скачком уменьшается за порогом', () => {
    const ceiling = flatProfile(4000, 3000)
    const floor = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 300 }, { x: 4000, y: 300 }]
    expect(studHeightAt(1000, ceiling, floor)).toBe(3000)
    expect(studHeightAt(3000, ceiling, floor)).toBe(2700) // на 300мм меньше за ступенью
  })
})

// ─── maxStudHeight ────────────────────────────────────────────────────────────

describe('maxStudHeight', () => {
  it('плоская стена: максимум = h', () => {
    const ceiling = flatProfile(6000, 2700)
    const floor = flatProfile(6000, 0)
    expect(maxStudHeight(ceiling, floor, 6000)).toBe(2700)
  })

  it('мансардный скос: максимум — высокий край', () => {
    const ceiling = [{ x: 0, y: 2000 }, { x: 4000, y: 3500 }]
    const floor = flatProfile(4000, 0)
    expect(maxStudHeight(ceiling, floor, 4000)).toBe(3500)
  })

  it('пик ровно в точке перепада (виден только со стороны interpolateYLeft): не теряется', () => {
    // Потолок поднимается 2000→3500 к x=1000, ровно в x=1000 балка резко
    // роняет высоту обратно до 2000 (дубль x=1000 без +1мм). Пик 3500
    // достигается ТОЛЬКО подходя к x=1000 слева по скату — если проверять
    // высоту в каждой точке профиля только "справа" (interpolateY), пик
    // будет пропущен (увидим высоту ПОСЛЕ балки, 2000, а не пик).
    const ceiling = [{ x: 0, y: 2000 }, { x: 1000, y: 3500 }, { x: 1000, y: 2000 }, { x: 2000, y: 2000 }]
    const floor = flatProfile(2000, 0)
    expect(maxStudHeight(ceiling, floor, 2000)).toBe(3500)
  })
})

// ─── integrateHeight (площадь под профилем) ──────────────────────────────────

describe('integrateHeight', () => {
  it('плоская стена: площадь = l × h (как раньше)', () => {
    const ceiling = flatProfile(5000, 2700)
    const floor = flatProfile(5000, 0)
    expect(integrateHeight(ceiling, floor, 0, 5000)).toBe(5000 * 2700)
  })

  it('линейный скос: площадь трапеции = среднее × длина', () => {
    const ceiling = [{ x: 0, y: 2000 }, { x: 4000, y: 3000 }]
    const floor = flatProfile(4000, 0)
    // трапеция: (2000+3000)/2 × 4000 = 10 000 000
    expect(integrateHeight(ceiling, floor, 0, 4000)).toBeCloseTo(10_000_000)
  })

  it('частичный участок: интеграл по [from,to] меньше полного', () => {
    const ceiling = flatProfile(6000, 3000)
    const floor = flatProfile(6000, 0)
    expect(integrateHeight(ceiling, floor, 0, 3000)).toBe(3000 * 3000)
  })
})

// ─── normalizeProfile ─────────────────────────────────────────────────────────

describe('normalizeProfile', () => {
  it('меньше 2 точек → плоский профиль на fallbackY', () => {
    expect(normalizeProfile(undefined, 5000, 2700)).toEqual(flatProfile(5000, 2700))
    expect(normalizeProfile([{ x: 100, y: 200 }], 5000, 2700)).toEqual(flatProfile(5000, 2700))
  })

  it('сортирует точки и принудительно ставит края на 0 и l', () => {
    const input = [{ x: 3000, y: 100 }, { x: -500, y: 50 }, { x: 7000, y: 200 }]
    const result = normalizeProfile(input, 5000, 0)
    expect(result[0].x).toBe(0)
    expect(result[result.length - 1].x).toBe(5000)
  })

  it('зажимает промежуточные точки в [0, l]', () => {
    const input = [{ x: 0, y: 0 }, { x: -100, y: 10 }, { x: 9000, y: 20 }, { x: 5000, y: 0 }]
    const result = normalizeProfile(input, 5000, 0)
    expect(result.every(p => p.x >= 0 && p.x <= 5000)).toBe(true)
  })
})

describe('profilePathLength', () => {
  it('плоский профиль → длина = горизонтальная проекция', () => {
    const flat = [{ x: 0, y: 2700 }, { x: 5000, y: 2700 }]
    expect(profilePathLength(flat, 0, 5000)).toBeCloseTo(5000)
  })

  it('скос 45° → длина = горизонталь × √2', () => {
    // перепад 1000мм на 1000мм → гипотенуза = 1000√2
    const sloped = [{ x: 0, y: 2000 }, { x: 1000, y: 3000 }]
    expect(profilePathLength(sloped, 0, 1000)).toBeCloseTo(1000 * Math.SQRT2, 3)
  })

  it('ступень: горизонталь + вертикаль', () => {
    // 0→1000 горизонталь (1000мм), 1000→1000 вертикаль (500мм), 1000→2000 горизонталь (1000мм)
    const step = [{ x: 0, y: 2000 }, { x: 1000, y: 2000 }, { x: 1000, y: 2500 }, { x: 2000, y: 2500 }]
    expect(profilePathLength(step, 0, 2000)).toBeCloseTo(2500, 1)
  })

  it('undefined профиль → горизонтальная проекция', () => {
    expect(profilePathLength(undefined, 0, 4000)).toBeCloseTo(4000)
  })

  it('подотрезок внутри профиля', () => {
    const flat = [{ x: 0, y: 2700 }, { x: 6000, y: 2700 }]
    expect(profilePathLength(flat, 1000, 4000)).toBeCloseTo(3000)
  })
})
