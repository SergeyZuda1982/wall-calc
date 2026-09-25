import { describe, it, expect } from 'vitest'
import {
  ceilingSlopeHeightAt,
  ceilingProfileForLine,
  buildCeilingSlopeResolver,
  buildCeilingProfilesByLineId,
  ceilingSlopeHeightAtPoint,
  buildEffectiveCeilingSlopeResolver,
  effectiveCeilingSlopeHeightAtPoint,
  areaUnderProfileM2,
  resolveRibBeamDropMm,
  ceilingMaterialForRoom,
  virtualSlabsFromLevelAbove,
} from '../ceilingSlope'
import type { CeilingSlope, PlanLine, Room, Slab, Ceiling } from '../../types'

function line(overrides: Partial<PlanLine> = {}): PlanLine {
  return {
    id: 'L1', x1: 0, y1: 0, x2: 1000, y2: 0,
    type: 'wall_new', lengthMm: 10000, label: 'П-1',
    spec: { material: 'gkl', subtype: 'ps50' },
    ...overrides,
  } as PlanLine
}

function globalSlope(overrides: Partial<CeilingSlope> = {}): CeilingSlope {
  return {
    id: 'S1', label: 'Уклон', x1: 0, y1: 0, x2: 1000, y2: 0,
    height1Mm: 3000, height2Mm: 4000,
    ...overrides,
  }
}

describe('ceilingSlopeHeightAt', () => {
  it('в опорных точках возвращает заданную высоту', () => {
    const s = globalSlope()
    expect(ceilingSlopeHeightAt(s, 0, 0)).toBe(3000)
    expect(ceilingSlopeHeightAt(s, 1000, 0)).toBe(4000)
  })

  it('линейная интерполяция между опорными точками', () => {
    const s = globalSlope()
    expect(ceilingSlopeHeightAt(s, 500, 0)).toBe(3500)
    expect(ceilingSlopeHeightAt(s, 250, 0)).toBe(3250)
  })

  it('экстраполирует за пределы отрезка p1-p2 (плоскость продолжается)', () => {
    const s = globalSlope()
    expect(ceilingSlopeHeightAt(s, 2000, 0)).toBe(5000)
    expect(ceilingSlopeHeightAt(s, -1000, 0)).toBe(2000)
  })

  it('постоянна в направлении, перпендикулярном p1->p2', () => {
    const s = globalSlope()
    expect(ceilingSlopeHeightAt(s, 500, 999)).toBe(3500)
    expect(ceilingSlopeHeightAt(s, 500, -999)).toBe(3500)
  })

  it('вырожденный случай (p1 === p2) — возвращает height1Mm', () => {
    const s = globalSlope({ x2: 0, y2: 0 })
    expect(ceilingSlopeHeightAt(s, 999, 999)).toBe(3000)
  })
})

describe('ceilingProfileForLine', () => {
  it('без уклона — undefined (линия остаётся плоской)', () => {
    expect(ceilingProfileForLine(line(), undefined)).toBeUndefined()
  })

  it('прямая линия под уклоном — профиль из двух точек по факт. высотам на концах', () => {
    // Линия идёт вдоль x от x=200 до x=700 (мировые px), уклон 3000->4000 на [0,1000]
    const l = line({ x1: 200, y1: 0, x2: 700, y2: 0, lengthMm: 5000 })
    const s = globalSlope()
    const profile = ceilingProfileForLine(l, s)
    expect(profile).toEqual([
      { x: 0, y: 3200 },
      { x: 5000, y: 3700 },
    ])
  })

  it('дуга (sagittaMm задан) — уклон не применяется, undefined', () => {
    const l = line({ sagittaMm: 300 })
    expect(ceilingProfileForLine(l, globalSlope())).toBeUndefined()
  })

  it('линия нулевой длины — undefined', () => {
    const l = line({ lengthMm: 0 })
    expect(ceilingProfileForLine(l, globalSlope())).toBeUndefined()
  })
})

describe('buildCeilingSlopeResolver / buildCeilingProfilesByLineId', () => {
  it('нет уклонов — резолвер всегда undefined, карта профилей пустая', () => {
    const resolve = buildCeilingSlopeResolver([line()], [], [])
    expect(resolve(line())).toBeUndefined()
    expect(buildCeilingProfilesByLineId([line()], [], [], [], []).size).toBe(0)
  })

  it('глобальный уклон (без roomId) применяется ко всем линиям', () => {
    const l1 = line({ id: 'L1' })
    const l2 = line({ id: 'L2', x1: 0, y1: 500, x2: 1000, y2: 500 })
    const s = globalSlope()
    const map = buildCeilingProfilesByLineId([l1, l2], [], [], [s], [])
    expect(map.get('L1')).toBeDefined()
    expect(map.get('L2')).toBeDefined()
  })

  it('уклон, привязанный к комнате, применяется только к линиям внутри неё', () => {
    // Комната-квадрат 0,0 - 2000,2000 из 4 линий периметра.
    const perim: PlanLine[] = [
      { id: 'R1', x1: 0, y1: 0, x2: 2000, y2: 0, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
      { id: 'R2', x1: 2000, y1: 0, x2: 2000, y2: 2000, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
      { id: 'R3', x1: 2000, y1: 2000, x2: 0, y2: 2000, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
      { id: 'R4', x1: 0, y1: 2000, x2: 0, y2: 0, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
    ]
    const room: Room = { id: 'ROOM1', lineIds: ['R1', 'R2', 'R3', 'R4'], areaM2: 4, perimeterMm: 8000, label: 'Комната' }

    const inside = line({ id: 'IN', x1: 500, y1: 500, x2: 1500, y2: 500 })
    const outside = line({ id: 'OUT', x1: 3000, y1: 3000, x2: 4000, y2: 3000 })

    const roomSlope = globalSlope({ id: 'S_ROOM', roomId: 'ROOM1', height1Mm: 2500, height2Mm: 3000 })
    const allLines = [...perim, inside, outside]
    const map = buildCeilingProfilesByLineId(allLines, [], [], [roomSlope], [room])

    expect(map.get('IN')).toBeDefined()
    expect(map.get('OUT')).toBeUndefined()
  })

  it('уклон комнаты перекрывает глобальный уклон для линий внутри неё', () => {
    const perim: PlanLine[] = [
      { id: 'R1', x1: 0, y1: 0, x2: 2000, y2: 0, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
      { id: 'R2', x1: 2000, y1: 0, x2: 2000, y2: 2000, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
      { id: 'R3', x1: 2000, y1: 2000, x2: 0, y2: 2000, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
      { id: 'R4', x1: 0, y1: 2000, x2: 0, y2: 0, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
    ]
    const room: Room = { id: 'ROOM1', lineIds: ['R1', 'R2', 'R3', 'R4'], areaM2: 4, perimeterMm: 8000, label: 'Комната' }
    const inside = line({ id: 'IN', x1: 500, y1: 500, x2: 1500, y2: 500, lengthMm: 1000 })

    const roomSlope = globalSlope({ id: 'S_ROOM', roomId: 'ROOM1', x1: 500, y1: 0, x2: 1500, y2: 0, height1Mm: 2500, height2Mm: 2500 })
    const globalOne = globalSlope({ id: 'S_GLOBAL', height1Mm: 9999, height2Mm: 9999 })

    const resolve = buildCeilingSlopeResolver([...perim, inside], [roomSlope, globalOne], [room])
    expect(resolve(inside)?.id).toBe('S_ROOM')

    const profile = ceilingProfileForLine(inside, resolve(inside))
    expect(profile).toEqual([{ x: 0, y: 2500 }, { x: 1000, y: 2500 }])
  })

  it('customHeight:true — уклон не применяется, линия остаётся плоской на своей heightMm', () => {
    const slope = globalSlope({ height1Mm: 4500, height2Mm: 5500 })
    const fixed = line({ id: 'FIXED', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, heightMm: 3000, customHeight: true })
    const normal = line({ id: 'NORM', x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, heightMm: 3000 })

    expect(ceilingProfileForLine(fixed, slope)).toBeUndefined()
    expect(ceilingProfileForLine(normal, slope)).toEqual([{ x: 0, y: 4500 }, { x: 1000, y: 5500 }])
  })
})

describe('ceilingSlopeHeightAtPoint', () => {
  const perim: PlanLine[] = [
    { id: 'R1', x1: 0, y1: 0, x2: 2000, y2: 0, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
    { id: 'R2', x1: 2000, y1: 0, x2: 2000, y2: 2000, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
    { id: 'R3', x1: 2000, y1: 2000, x2: 0, y2: 2000, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
    { id: 'R4', x1: 0, y1: 2000, x2: 0, y2: 0, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
  ]
  const room: Room = { id: 'ROOM1', lineIds: ['R1', 'R2', 'R3', 'R4'], areaM2: 4, perimeterMm: 8000, label: 'Комната' }

  it('нет уклонов вообще — undefined', () => {
    expect(ceilingSlopeHeightAtPoint({ x: 1000, y: 1000 }, perim, [], [room])).toBeUndefined()
  })

  it('точка внутри комнаты с уклоном комнаты — берёт уклон комнаты', () => {
    const roomSlope = globalSlope({ id: 'S_ROOM', roomId: 'ROOM1', x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 2500, height2Mm: 4500 })
    const h = ceilingSlopeHeightAtPoint({ x: 1000, y: 500 }, perim, [roomSlope], [room])
    expect(h).toBe(3500) // середина отрезка 0..2000 -> середина 2500..4500
  })

  it('точка вне всех комнат с уклоном — падает на глобальный уклон', () => {
    const roomSlope = globalSlope({ id: 'S_ROOM', roomId: 'ROOM1', height1Mm: 9999, height2Mm: 9999 })
    const global = globalSlope({ id: 'S_GLOBAL', x1: 3000, y1: 3000, x2: 4000, y2: 3000, height1Mm: 3000, height2Mm: 3000 })
    const h = ceilingSlopeHeightAtPoint({ x: 3500, y: 3000 }, perim, [roomSlope, global], [room])
    expect(h).toBe(3000)
  })
})

describe('buildEffectiveCeilingSlopeResolver / effectiveCeilingSlopeHeightAtPoint (07.09.2026 — наклон Плиты/Потолка приоритетнее зоны «Задать уклон»)', () => {
  function slab(overrides: Partial<Slab> = {}): Slab {
    return {
      id: 'SLAB1', label: 'Плита', outer: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], holes: [],
      ...overrides,
    }
  }
  function ceiling(overrides: Partial<Ceiling> = {}): Ceiling {
    return {
      id: 'CEIL1', label: 'Потолок', outer: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }],
      ...overrides,
    }
  }
  const zoneSlope = globalSlope({ height1Mm: 9999, height2Mm: 9999 }) // заведомо другое значение — легко отличить источник

  it('нарисованная Плита с наклоном приоритетнее зоны «Задать уклон», даже если зона тоже покрывает линию', () => {
    const sl = slab({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 5000 } })
    const resolve = buildEffectiveCeilingSlopeResolver([line()], [sl], [], [zoneSlope], [])
    const l = line({ x1: 0, y1: 0, x2: 1000, y2: 0 }) // середина x=500 -> высота Плиты (3500), минус толщина плиты по умолчанию (200) = 3300
    expect(ceilingSlopeHeightAt(resolve(l)!, 500, 0)).toBe(3300)
  })

  it('Плита без наклона (slope не задан) НЕ считается источником — падает на зону уклона', () => {
    const sl = slab() // без .slope
    const resolve = buildEffectiveCeilingSlopeResolver([line()], [sl], [], [zoneSlope], [])
    const l = line({ x1: 0, y1: 0, x2: 1000, y2: 0 })
    expect(resolve(l)).toBe(zoneSlope)
  })

  it('нет ни Плиты/Потолка над линией, ни зоны — undefined', () => {
    const resolve = buildEffectiveCeilingSlopeResolver([line()], [], [], [], [])
    expect(resolve(line())).toBeUndefined()
  })

  it('Плита приоритетнее Потолка (структурная плита — то, до чего реально должна доходить перегородка)', () => {
    const sl = slab({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 3000 } })
    const cl = ceiling({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 2700, height2Mm: 2700 } })
    const resolve = buildEffectiveCeilingSlopeResolver([line()], [sl], [cl], [], [])
    const l = line({ x1: 0, y1: 0, x2: 1000, y2: 0 })
    // от Плиты (3000 минус толщина по умолчанию 200 = 2800), не от Потолка (2700 — у Потолка толщина не вычитается)
    expect(ceilingSlopeHeightAt(resolve(l)!, 0, 0)).toBe(2800)
  })

  it('линия ВНЕ контура Плиты — Плита не применяется, работает обычный резолвер по зоне', () => {
    const sl = slab({ outer: [{ x: 5000, y: 5000 }, { x: 6000, y: 5000 }, { x: 6000, y: 6000 }, { x: 5000, y: 6000 }], slope: { x1: 5000, y1: 5000, x2: 6000, y2: 5000, height1Mm: 1000, height2Mm: 1000 } })
    const resolve = buildEffectiveCeilingSlopeResolver([line()], [sl], [], [zoneSlope], [])
    const l = line({ x1: 0, y1: 0, x2: 1000, y2: 0 }) // далеко от Плиты (5000..6000)
    expect(resolve(l)).toBe(zoneSlope)
  })

  it('effectiveCeilingSlopeHeightAtPoint — та же приоритезация для точки (колонны)', () => {
    const sl = slab({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 5000 } })
    const h = effectiveCeilingSlopeHeightAtPoint({ x: 500, y: 500 }, [], [sl], [], [zoneSlope], [])
    expect(h).toBe(3300) // 3500 (уклон в точке) минус толщина плиты по умолчанию 200
  })

  describe('Slab.thicknessMm (20.09.2026 — перегородка должна доходить до НИЖНЕЙ грани плиты, не до верхней)', () => {
    it('без thicknessMm — вычитается DEFAULT_SLAB_THICKNESS_MM (200)', () => {
      const sl = slab({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 3000 } })
      const h = effectiveCeilingSlopeHeightAtPoint({ x: 0, y: 0 }, [], [sl], [], [], [])
      expect(h).toBe(2800)
    })

    it('с заданным thicknessMm — вычитается именно оно, не дефолт', () => {
      const sl = slab({ thicknessMm: 300, slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 3000 } })
      const h = effectiveCeilingSlopeHeightAtPoint({ x: 0, y: 0 }, [], [sl], [], [], [])
      expect(h).toBe(2700)
    })

    it('тонкая плита (thicknessMm мал) — вычитается меньше, высота ближе к верху плиты', () => {
      const sl = slab({ thicknessMm: 50, slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 3000 } })
      const h = effectiveCeilingSlopeHeightAtPoint({ x: 0, y: 0 }, [], [sl], [], [], [])
      expect(h).toBe(2950)
    })

    it('у Потолка (Ceiling) такое вычитание НЕ применяется — это уже готовая/подвесная поверхность, а не сырая плита', () => {
      const cl = ceiling({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 2700, height2Mm: 2700 } })
      const h = effectiveCeilingSlopeHeightAtPoint({ x: 0, y: 0 }, [], [], [cl], [], [])
      expect(h).toBe(2700) // ровно как задано, без вычета
    })
  })

  describe('resolveRibBeamDropMm (13.09.2026 — авторасчёт опускания ригеля по уклону плиты, объект в Ростове)', () => {
    it('targetBottomMm задан, есть уклон над серединой ригеля — опускание = высота плиты в середине минус targetBottomMm', () => {
      // height1Mm/height2Mm сдвинуты на +200 (толщина плиты по умолчанию) относительно
      // "низа" плиты, который реально нужен здесь (3000→5000) — сама функция вычитает
      // эту толщину один раз внутри effectiveCeilingSlopeHeightAtPoint (ceilingSlope.ts).
      const sl = slab({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3200, height2Mm: 5200 } })
      // Ригель от x=0 до x=1000 -> середина x=500 -> низ плиты в середине 3500 (как в тесте выше)
      const drop = resolveRibBeamDropMm(0, 0, 1000, 0, 3450, 200, [], [sl], [], [], [])
      expect(drop).toBe(3500 - 3450) // 50
    })

    it('targetBottomMm НЕ задан (undefined) — откат на manualDropMm, уклон не считается вообще', () => {
      const sl = slab({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 5000 } })
      const drop = resolveRibBeamDropMm(0, 0, 1000, 0, undefined, 200, [], [sl], [], [], [])
      expect(drop).toBe(200)
    })

    it('targetBottomMm задан, но НЕТ применимого уклона в этой точке — откат на manualDropMm', () => {
      const drop = resolveRibBeamDropMm(0, 0, 1000, 0, 3450, 200, [], [], [], [], [])
      expect(drop).toBe(200)
    })

    it('targetBottomMm отрицательный — трактуется как некорректный ввод, откат на manualDropMm', () => {
      const sl = slab({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 5000 } })
      const drop = resolveRibBeamDropMm(0, 0, 1000, 0, -50, 200, [], [sl], [], [], [])
      expect(drop).toBe(200)
    })

    it('результат клэмпится снизу нулём — если targetBottomMm выше самой плиты в этой точке (некорректная настройка, не должно уйти в минус)', () => {
      const sl = slab({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 5000 } })
      const drop = resolveRibBeamDropMm(0, 0, 1000, 0, 9999, 200, [], [sl], [], [], [])
      expect(drop).toBe(0)
    })

    it('округляется до целого мм', () => {
      const sl = slab({ slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 3000, height2Mm: 3001 } }) // высота в середине 3000.25
      const drop = resolveRibBeamDropMm(0, 0, 1000, 0, 2000, 200, [], [sl], [], [], [])
      expect(Number.isInteger(drop)).toBe(true)
    })

    it('разные ригели под РАЗНЫМИ участками наклонной плиты получают РАЗНОЕ опускание, но одинаковый желаемый низ (сценарий Сергея — общая нижняя отметка 3450 при плите 3800→5500)', () => {
      const sl = slab({ outer: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 }, { x: 0, y: 1000 }], slope: { x1: 0, y1: 0, x2: 4000, y2: 0, height1Mm: 3800, height2Mm: 5500 } })
      const targetBottomMm = 3450
      const dropNearFlatEnd = resolveRibBeamDropMm(0, 500, 200, 500, targetBottomMm, 999, [], [sl], [], [], [])
      const dropNearHighEnd = resolveRibBeamDropMm(3800, 500, 4000, 500, targetBottomMm, 999, [], [sl], [], [], [])
      expect(dropNearFlatEnd).toBeLessThan(dropNearHighEnd) // ригель у высокого края опускается сильнее
      expect(dropNearFlatEnd).toBeGreaterThan(0)
    })
  })

  describe('ceilingMaterialForRoom (15.09.2026 — чек-лист последующих работ подстраивается под материал потолка)', () => {
    const perim: PlanLine[] = [
      { id: 'R1', x1: 0, y1: 0, x2: 2000, y2: 0, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
      { id: 'R2', x1: 2000, y1: 0, x2: 2000, y2: 2000, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
      { id: 'R3', x1: 2000, y1: 2000, x2: 0, y2: 2000, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
      { id: 'R4', x1: 0, y1: 2000, x2: 0, y2: 0, type: 'wall_existing', lengthMm: 2000, label: '' } as PlanLine,
    ]
    const room: Room = { id: 'ROOM1', lineIds: ['R1', 'R2', 'R3', 'R4'], areaM2: 4, perimeterMm: 8000, label: 'Комната' }

    it('комната накрыта Ceiling-зоной с материалом — возвращает этот материал', () => {
      const cl = { id: 'cl1', label: 'Потолок 1', outer: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], material: 'suspended' } as Ceiling
      expect(ceilingMaterialForRoom(room, perim, [cl])).toBe('suspended')
    })

    it('Ceiling-зона БЕЗ материала (свободная обводка «обвести потолок») — не даёт ответа', () => {
      const cl = { id: 'cl1', label: 'Потолок 1', outer: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }] } as Ceiling
      expect(ceilingMaterialForRoom(room, perim, [cl])).toBeUndefined()
    })

    it('комната НЕ накрыта никакой Ceiling-зоной — undefined', () => {
      const cl = { id: 'cl1', label: 'Потолок далеко', outer: [{ x: 5000, y: 5000 }, { x: 6000, y: 5000 }, { x: 6000, y: 6000 }, { x: 5000, y: 6000 }], material: 'gkl' } as Ceiling
      expect(ceilingMaterialForRoom(room, perim, [cl])).toBeUndefined()
    })

    it('незамкнутый/не найденный контур комнаты — undefined, не падает', () => {
      const brokenRoom: Room = { id: 'ROOM1', lineIds: ['NOPE'], areaM2: 4, perimeterMm: 8000, label: 'Комната' }
      const cl = { id: 'cl1', label: 'Потолок 1', outer: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], material: 'gkl' } as Ceiling
      expect(ceilingMaterialForRoom(brokenRoom, perim, [cl])).toBeUndefined()
    })

    it('несколько зон — берётся ПЕРВАЯ накрывающая комнату', () => {
      const clA = { id: 'clA', label: 'A', outer: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], material: 'rough' } as Ceiling
      const clB = { id: 'clB', label: 'B', outer: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], material: 'stretch' } as Ceiling
      expect(ceilingMaterialForRoom(room, perim, [clA, clB])).toBe('rough')
    })

    it('25.09.2026 — Room.ceilingMaterial (быстрое меню по ПКМ) приоритетнее накрывающей Ceiling-зоны', () => {
      const roomWithMaterial: Room = { ...room, ceilingMaterial: 'stretch' }
      const cl = { id: 'cl1', label: 'Потолок 1', outer: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], material: 'gkl' } as Ceiling
      expect(ceilingMaterialForRoom(roomWithMaterial, perim, [cl])).toBe('stretch')
    })

    it('25.09.2026 — Room.ceilingMaterial работает и БЕЗ какой-либо Ceiling-зоны вовсе', () => {
      const roomWithMaterial: Room = { ...room, ceilingMaterial: 'suspended' }
      expect(ceilingMaterialForRoom(roomWithMaterial, perim, [])).toBe('suspended')
    })
  })
})

describe('areaUnderProfileM2 (07.09.2026 — площадь под наклонным профилем, была ошибка в сводной таблице плана)', () => {
  it('2-точечный линейный профиль — площадь трапеции = length × средняя высота', () => {
    // 6970мм длина, 4500→5200мм (тот самый случай из скриншота Сергея)
    const areaM2 = areaUnderProfileM2([{ x: 0, y: 4500 }, { x: 6970, y: 5200 }])
    expect(areaM2).toBeCloseTo(6.97 * ((4500 + 5200) / 2) / 1000, 5)
  })

  it('плоский профиль (h1===h2) — обычный прямоугольник, length × height', () => {
    const areaM2 = areaUnderProfileM2([{ x: 0, y: 3000 }, { x: 5000, y: 3000 }])
    expect(areaM2).toBeCloseTo(5 * 3, 6)
  })

  it('профиль из 3+ точек — сумма трапеций по сегментам', () => {
    const areaM2 = areaUnderProfileM2([{ x: 0, y: 3000 }, { x: 1000, y: 4000 }, { x: 2000, y: 3000 }])
    // (0-1000: (3000+4000)/2*1000) + (1000-2000: (4000+3000)/2*1000) = 3.5+3.5 = 7 м²
    expect(areaM2).toBeCloseTo(7, 6)
  })

  it('вырожденный профиль (1 точка или пусто) — площадь 0, не падает', () => {
    expect(areaUnderProfileM2([])).toBe(0)
    expect(areaUnderProfileM2([{ x: 0, y: 3000 }])).toBe(0)
  })
})

describe('virtualSlabsFromLevelAbove (20.09.2026 — монолитное перекрытие: низ плиты этажа выше = потолок текущего этажа)', () => {
  const outer = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }]

  it('нет этажа выше — пустой массив', () => {
    const levels = [{ elevationMm: 0, floorPlan: { slabs: [] } }]
    expect(virtualSlabsFromLevelAbove(0, levels)).toEqual([])
  })

  it('этаж выше есть, но на нём нет плит — пустой массив', () => {
    const levels = [{ elevationMm: 0, floorPlan: { slabs: [] } }, { elevationMm: 3600, floorPlan: { slabs: [] } }]
    expect(virtualSlabsFromLevelAbove(0, levels)).toEqual([])
  })

  it('плоская плита этажа выше (без уклона) — высота = gapMm между этажами в каждой точке', () => {
    const aboveSlab: Slab = { id: 'SL2', label: 'Плита 2', outer, holes: [] }
    const levels = [
      { elevationMm: 0, floorPlan: { slabs: [] } },
      { elevationMm: 3600, floorPlan: { slabs: [aboveSlab] } },
    ]
    const [virt] = virtualSlabsFromLevelAbove(0, levels)
    expect(virt.slope).toBeDefined()
    expect(ceilingSlopeHeightAt(virt.slope!, 0, 0)).toBe(3600)
    expect(ceilingSlopeHeightAt(virt.slope!, 1500, 1500)).toBe(3600) // плоская — везде одинаково
  })

  it('плита этажа выше СО своим уклоном — уклон переносится со сдвигом на gapMm', () => {
    const aboveSlab: Slab = { id: 'SL2', label: 'Плита 2', outer, holes: [], slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 100, height2Mm: 300 } }
    const levels = [
      { elevationMm: 0, floorPlan: { slabs: [] } },
      { elevationMm: 3600, floorPlan: { slabs: [aboveSlab] } },
    ]
    const [virt] = virtualSlabsFromLevelAbove(0, levels)
    expect(ceilingSlopeHeightAt(virt.slope!, 0, 0)).toBe(3700)   // 3600 + 100
    expect(ceilingSlopeHeightAt(virt.slope!, 2000, 0)).toBe(3900) // 3600 + 300
  })

  it('берётся БЛИЖАЙШИЙ этаж выше, а не любой (если их несколько)', () => {
    const near: Slab = { id: 'near', label: 'Плита близкая', outer, holes: [] }
    const far: Slab = { id: 'far', label: 'Плита далёкая', outer, holes: [] }
    const levels = [
      { elevationMm: 0, floorPlan: { slabs: [] } },
      { elevationMm: 3600, floorPlan: { slabs: [near] } },
      { elevationMm: 7200, floorPlan: { slabs: [far] } },
    ]
    const virt = virtualSlabsFromLevelAbove(0, levels)
    expect(virt.map(s => s.id)).toEqual(['near__above'])
    expect(ceilingSlopeHeightAt(virt[0].slope!, 0, 0)).toBe(3600) // не 7200
  })

  it('интеграция с effectiveCeilingSlopeHeightAtPoint — толщина плиты вычитается и для виртуальной (та же slopeFromCoveringEntity)', () => {
    const aboveSlab: Slab = { id: 'SL2', label: 'Плита 2', outer, holes: [], thicknessMm: 300 }
    const levels = [
      { elevationMm: 0, floorPlan: { slabs: [] } },
      { elevationMm: 3600, floorPlan: { slabs: [aboveSlab] } },
    ]
    const virt = virtualSlabsFromLevelAbove(0, levels)
    const h = effectiveCeilingSlopeHeightAtPoint({ x: 1000, y: 1000 }, [], virt, [], [], [])
    expect(h).toBe(3300) // 3600 минус толщина 300
  })

  it('своя Плита/Потолок текущего этажа (с уклоном) в приоритете над плитой этажа выше', () => {
    const ownSlope: Slab = { id: 'own', label: 'Своя плита', outer, holes: [], slope: { x1: 0, y1: 0, x2: 2000, y2: 0, height1Mm: 2800, height2Mm: 2800 } }
    const aboveSlab: Slab = { id: 'SL2', label: 'Плита 2', outer, holes: [] }
    const levels = [
      { elevationMm: 0, floorPlan: { slabs: [ownSlope] } },
      { elevationMm: 3600, floorPlan: { slabs: [aboveSlab] } },
    ]
    const virtual = virtualSlabsFromLevelAbove(0, levels)
    const h = effectiveCeilingSlopeHeightAtPoint({ x: 1000, y: 1000 }, [], [ownSlope, ...virtual], [], [], [])
    expect(h).toBe(2600) // 2800 минус дефолтная толщина 200 — от СВОЕЙ плиты, не от 3600-200=3400 этажа выше
  })
})
