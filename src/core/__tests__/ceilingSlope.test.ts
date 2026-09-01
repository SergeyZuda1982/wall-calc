import { describe, it, expect } from 'vitest'
import {
  ceilingSlopeHeightAt,
  ceilingProfileForLine,
  buildCeilingSlopeResolver,
  buildCeilingProfilesByLineId,
} from '../ceilingSlope'
import type { CeilingSlope, PlanLine, Room } from '../../types'

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
    expect(buildCeilingProfilesByLineId([line()], [], []).size).toBe(0)
  })

  it('глобальный уклон (без roomId) применяется ко всем линиям', () => {
    const l1 = line({ id: 'L1' })
    const l2 = line({ id: 'L2', x1: 0, y1: 500, x2: 1000, y2: 500 })
    const s = globalSlope()
    const map = buildCeilingProfilesByLineId([l1, l2], [s], [])
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
    const map = buildCeilingProfilesByLineId(allLines, [roomSlope], [room])

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
})
