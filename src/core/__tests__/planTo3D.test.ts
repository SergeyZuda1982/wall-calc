import { describe, it, expect } from 'vitest'
import {
  wallThicknessMm, wallToBox3D, wallsToBoxes3D, estimateCeilingMm,
  roomsToPolygons3D, pxToM, mmToM,
} from '../planTo3D'
import type { PlanLine, Room } from '../../types'

function baseLine(overrides: Partial<PlanLine>): PlanLine {
  return {
    id: 'l1', x1: 0, y1: 0, x2: 100, y2: 0,
    type: 'wall_existing', lengthMm: 2000, label: 'С-1',
    ...overrides,
  }
}

describe('wallThicknessMm', () => {
  it('без spec.material у обычной стены толщина 0 (как и в 2D — не рисуем)', () => {
    expect(wallThicknessMm(baseLine({}))).toBe(0)
  })

  it('у ригеля толщина = sectionWidthMm, spec не нужен', () => {
    const line = baseLine({ type: 'rib_beam', sectionWidthMm: 350 })
    expect(wallThicknessMm(line)).toBe(350)
  })

  it('у ригеля без sectionWidthMm — дефолт 300', () => {
    const line = baseLine({ type: 'rib_beam' })
    expect(wallThicknessMm(line)).toBe(300)
  })

  it('existing кирпич без подтипа — дефолт из taxonomy (250)', () => {
    const line = baseLine({ spec: { material: 'brick' } })
    expect(wallThicknessMm(line)).toBe(250)
  })
})

describe('pxToM / mmToM', () => {
  it('переводит px в метры через scaleMmPx (мм на px)', () => {
    // 100px * scaleMmPx(10) = 1000мм = 1м
    expect(pxToM(100, 10)).toBeCloseTo(1)
  })
  it('мм в метры — просто /1000', () => {
    expect(mmToM(3000)).toBe(3)
  })
})

describe('wallToBox3D', () => {
  it('линия без толщины (нет spec) — не строится, возвращает null', () => {
    const line = baseLine({})
    expect(wallToBox3D(line, 10, 3000)).toBeNull()
  })

  it('стена вдоль +X: rotationY = 0, длина/толщина/высота верные', () => {
    const line = baseLine({
      x1: 0, y1: 0, x2: 100, y2: 0, // 100px * scaleMmPx=10 → 1000мм = 1м
      spec: { material: 'brick', subtype: '200' },
      heightMm: 2700,
    })
    const box = wallToBox3D(line, 10, 3000)
    expect(box).not.toBeNull()
    expect(box!.size.sx).toBeCloseTo(1)       // длина 1м
    expect(box!.size.sz).toBeCloseTo(0.2)     // толщина 200мм = 0.2м
    expect(box!.size.sy).toBeCloseTo(2.7)     // высота 2700мм
    expect(box!.rotationY).toBeCloseTo(0)     // вдоль X — без поворота
    expect(box!.center.y).toBeCloseTo(1.35)   // стоит на полу, центр = высота/2
  })

  it('стена вдоль +Z (по экрану — вниз, y2>y1): rotationY = -90°', () => {
    const line = baseLine({
      x1: 0, y1: 0, x2: 0, y2: 100,
      spec: { material: 'brick', subtype: '200' },
    })
    const box = wallToBox3D(line, 10, 3000)
    expect(box!.rotationY).toBeCloseTo(-Math.PI / 2)
  })

  it('ригель висит под потолком: центр по Y = потолок - опускание/2', () => {
    const line = baseLine({ type: 'rib_beam', sectionWidthMm: 300, dropMm: 200 })
    const box = wallToBox3D(line, 10, 3000) // потолок на 3000мм = 3м
    expect(box).not.toBeNull()
    expect(box!.size.sy).toBeCloseTo(0.2)      // высота короба = опускание, 200мм
    expect(box!.center.y).toBeCloseTo(2.9)     // 3 - 0.2/2
  })

  it('нулевая длина линии — null (защита от деления на 0 при повороте)', () => {
    const line = baseLine({ x1: 5, y1: 5, x2: 5, y2: 5, spec: { material: 'brick' } })
    expect(wallToBox3D(line, 10, 3000)).toBeNull()
  })
})

describe('wallsToBoxes3D', () => {
  it('пропускает линии без толщины, строит остальные', () => {
    const lines: PlanLine[] = [
      baseLine({ id: 'a', spec: { material: 'brick', subtype: '200' } }),
      baseLine({ id: 'b' }), // без spec — пропущена
      baseLine({ id: 'c', type: 'rib_beam' }),
    ]
    const boxes = wallsToBoxes3D(lines, 10)
    expect(boxes.map(b => b.id)).toEqual(['a', 'c'])
  })
})

describe('estimateCeilingMm', () => {
  it('без wall_existing — дефолт 3000', () => {
    expect(estimateCeilingMm([baseLine({ type: 'wall_new', heightMm: 2500 })])).toBe(3000)
  })
  it('берёт максимум heightMm среди wall_existing', () => {
    const lines: PlanLine[] = [
      baseLine({ id: 'a', heightMm: 3200 }),
      baseLine({ id: 'b', heightMm: 2800 }),
    ]
    expect(estimateCeilingMm(lines)).toBe(3200)
  })
})

describe('roomsToPolygons3D', () => {
  it('замкнутый треугольник из 3 линий → полигон в метрах', () => {
    const lines: PlanLine[] = [
      baseLine({ id: 'a', x1: 0, y1: 0, x2: 100, y2: 0 }),
      baseLine({ id: 'b', x1: 100, y1: 0, x2: 100, y2: 100 }),
      baseLine({ id: 'c', x1: 100, y1: 100, x2: 0, y2: 0 }),
    ]
    const rooms: Room[] = [
      { id: 'r1', lineIds: ['a', 'b', 'c'], areaM2: 5, perimeterMm: 300, label: 'Колонна', isColumn: true },
    ]
    const polys = roomsToPolygons3D(rooms, lines, 10)
    expect(polys).toHaveLength(1)
    expect(polys[0].isColumn).toBe(true)
    expect(polys[0].points.length).toBeGreaterThanOrEqual(3)
    expect(polys[0].points[0]).toEqual({ x: 0, z: 0 })
  })

  it('меньше 3 линий периметра — контур пропущен', () => {
    const lines: PlanLine[] = [baseLine({ id: 'a' })]
    const rooms: Room[] = [{ id: 'r1', lineIds: ['a'], areaM2: 0, perimeterMm: 0, label: 'X' }]
    expect(roomsToPolygons3D(rooms, lines, 10)).toHaveLength(0)
  })
})
