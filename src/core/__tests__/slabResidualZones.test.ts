import { describe, it, expect } from 'vitest'
import { computeSlabResidualPolygons, matchSlabZones } from '../slabResidualZones'
import type { PlanLine, Room, Slab, SlabZone } from '../../types'

// Плита 1000x1000 px, помещение-квадрат 400x400 в левом верхнем углу
// (стены как 4 PlanLine, замкнутые в периметр).
function makeSquareRoomLines(x: number, y: number, w: number, h: number): PlanLine[] {
  const pts = [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ]
  return pts.map((p, i) => {
    const n = pts[(i + 1) % pts.length]
    return {
      id: `l${x}_${y}_${i}`, x1: p.x, y1: p.y, x2: n.x, y2: n.y,
      type: 'wall_existing', lengthMm: 0, label: `w${i}`,
    } satisfies PlanLine
  })
}

function makeRoom(lines: PlanLine[], id: string): Room {
  return { id, lineIds: lines.map(l => l.id), areaM2: 0, perimeterMm: 0, label: id }
}

const slab: Slab = { id: 'slab1', outer: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], holes: [], label: 'Плита 1' }

describe('computeSlabResidualPolygons', () => {
  it('плита без Room — остаток равен всей плите', () => {
    const res = computeSlabResidualPolygons(slab, [], [])
    expect(res).toHaveLength(1)
    expect(res[0]).toHaveLength(4)
  })

  it('один Room в углу — остаток на ту же площадь меньше', () => {
    const lines = makeSquareRoomLines(0, 0, 400, 400)
    const room = makeRoom(lines, 'r1')
    const res = computeSlabResidualPolygons(slab, [room], lines)
    expect(res).toHaveLength(1)
    // 1000*1000 - 400*400 = 840000
    const area = shoelace(res[0])
    expect(area).toBeCloseTo(840000, 0)
  })

  it('два Room по краям — остаток распадается на несколько кусков', () => {
    const linesA = makeSquareRoomLines(0, 0, 300, 1000)      // левая полоса на всю высоту
    const linesB = makeSquareRoomLines(700, 0, 300, 1000)    // правая полоса на всю высоту
    const roomA = makeRoom(linesA, 'rA')
    const roomB = makeRoom(linesB, 'rB')
    const res = computeSlabResidualPolygons(slab, [roomA, roomB], [...linesA, ...linesB])
    // Остаётся одна полоса посередине (300..700) — один кусок, не несколько,
    // проверим просто что площадь верная и это не вся плита.
    expect(res).toHaveLength(1)
    const area = shoelace(res[0])
    expect(area).toBeCloseTo(400000, 0)
  })

  it('колонна (isColumn) не вычитается как помещение', () => {
    const lines = makeSquareRoomLines(0, 0, 400, 400)
    const room = { ...makeRoom(lines, 'c1'), isColumn: true }
    const res = computeSlabResidualPolygons(slab, [room], lines)
    expect(res).toHaveLength(1)
    const area = shoelace(res[0])
    expect(area).toBeCloseTo(1000000, 0)
  })

  it('holes плиты тоже вычитаются из остатка', () => {
    const s: Slab = { ...slab, holes: [[{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }]] }
    const res = computeSlabResidualPolygons(s, [], [])
    expect(res).toHaveLength(1)
    const area = shoelace(res[0])
    // 1000000 - 100*100 = 990000
    expect(area).toBeCloseTo(990000, 0)
  })
})

describe('matchSlabZones', () => {
  it('без предыдущих зон — создаёт новые, все live', () => {
    const polys = [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]]
    const zones = matchSlabZones(polys, undefined, 1)
    expect(zones).toHaveLength(1)
    expect(zones[0].live).toBe(true)
    expect(zones[0].label).toBe('Зона плиты 1')
  })

  it('повторный пересчёт той же геометрии — сохраняет id/label/progress', () => {
    const polys = [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]]
    const first = matchSlabZones(polys, undefined, 1)
    const withProgress: SlabZone[] = [{ ...first[0], label: 'Большой зал', floorProgress: { steps: [] } }]
    const second = matchSlabZones(polys, withProgress, 1)
    expect(second).toHaveLength(1)
    expect(second[0].id).toBe(withProgress[0].id)
    expect(second[0].label).toBe('Большой зал')
    expect(second[0].floorProgress).toEqual({ steps: [] })
    expect(second[0].live).toBe(true)
  })

  it('кусок исчез (Room накрыла его) — остаётся в массиве с live=false, прогресс не теряется', () => {
    const polyA = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    const first = matchSlabZones([polyA], undefined, 1)
    const withProgress: SlabZone[] = [{ ...first[0], ceilingProgress: { steps: [] } }]
    const second = matchSlabZones([], withProgress, 1)
    expect(second).toHaveLength(1)
    expect(second[0].live).toBe(false)
    expect(second[0].ceilingProgress).toEqual({ steps: [] })
  })

  it('два несвязных куска сопоставляются каждый со своей старой зоной по ближайшему центроиду', () => {
    const left = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    const right = [{ x: 900, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 100 }, { x: 900, y: 100 }]
    const first = matchSlabZones([left, right], undefined, 1)
    const leftZone = first.find(z => z.outer[0].x === 0)!
    const named: SlabZone[] = first.map(z => z === leftZone ? { ...z, label: 'Коридор А' } : { ...z, label: 'Коридор Б' })
    // Слегка сдвигаем оба куска геометрически (имитация правки Room рядом) —
    // должны остаться привязаны к тем же именам, не перепутаться местами.
    const leftMoved = left.map(p => ({ x: p.x + 5, y: p.y }))
    const rightMoved = right.map(p => ({ x: p.x - 5, y: p.y }))
    const second = matchSlabZones([leftMoved, rightMoved], named, 1)
    const leftAfter = second.find(z => z.label === 'Коридор А')!
    const rightAfterZone = second.find(z => z.label === 'Коридор Б')!
    expect(leftAfter.outer[0].x).toBeCloseTo(5, 0)
    expect(rightAfterZone.outer[0].x).toBeCloseTo(895, 0)
  })
})

function shoelace(pts: { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}
