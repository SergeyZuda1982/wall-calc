import { describe, it, expect } from 'vitest'
import { roomToCeilingSeed } from '../roomToCeilingSeed'
import type { Room, PlanLine } from '../../types'

/** Прямоугольная петля 4 линий (в px), scale мм/px передаётся отдельно —
 *  как и у Slab/Ceiling, координаты PlanLine — в px холста, не в мм. */
function rectRoomLines(wPx: number, hPx: number): PlanLine[] {
  return [
    { id: 'l1', x1: 0, y1: 0, x2: wPx, y2: 0, type: 'wall_existing', lengthMm: 0, label: 'l1' },
    { id: 'l2', x1: wPx, y1: 0, x2: wPx, y2: hPx, type: 'wall_existing', lengthMm: 0, label: 'l2' },
    { id: 'l3', x1: wPx, y1: hPx, x2: 0, y2: hPx, type: 'wall_existing', lengthMm: 0, label: 'l3' },
    { id: 'l4', x1: 0, y1: hPx, x2: 0, y2: 0, type: 'wall_existing', lengthMm: 0, label: 'l4' },
  ]
}

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: 'r1', lineIds: ['l1', 'l2', 'l3', 'l4'],
    areaM2: 12, perimeterMm: 14000, label: 'Кухня',
    ...overrides,
  }
}

describe('roomToCeilingSeed', () => {
  it('берёт areaSqm/perimeterM из самого Room (не пересчитывает по контуру)', () => {
    // Room.areaM2/perimeterMm — источник истины (актуализируются в
    // FloorPlan.tsx при правке стен), контур нужен только для превью.
    const lines = rectRoomLines(400, 300) // 4000×3000мм при scale=10
    const r = room({ areaM2: 12, perimeterMm: 14000 })
    const seed = roomToCeilingSeed(r, lines, 10)
    expect(seed).not.toBeNull()
    expect(seed!.areaSqm).toBe(12)
    expect(seed!.perimeterM).toBe(14)
  })

  it('roomId прокидывается в seed — по нему CeilingCalc.tsx узнаёт источник', () => {
    const lines = rectRoomLines(400, 300)
    const seed = roomToCeilingSeed(room({ id: 'room-xyz' }), lines, 10)
    expect(seed!.roomId).toBe('room-xyz')
  })

  it('outerMm — контур помещения переведён из px в мм через scaleMmPerPx (регрессия: раньше отдавались сырые px)', () => {
    const lines = rectRoomLines(400, 300) // px
    const seed = roomToCeilingSeed(room(), lines, 10)! // scale 10 мм/px
    expect(seed.zones[0].outerMm).toEqual([
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }, { x: 0, y: 0 },
    ])
  })

  it('меньше 3 точек контура (разомкнутый/удалённый периметр) — возвращает null', () => {
    const lines = rectRoomLines(400, 300).slice(0, 2)
    expect(roomToCeilingSeed(room({ lineIds: ['l1', 'l2'] }), lines, 10)).toBeNull()
  })

  it('holesCount всегда 0 — у Room пока нет концепции вырезов', () => {
    const lines = rectRoomLines(400, 300)
    const seed = roomToCeilingSeed(room(), lines, 10)!
    expect(seed.holesCount).toBe(0)
    expect(seed.zones[0].holesMm).toEqual([])
  })

  it('одна зона, названная по Room.label', () => {
    const lines = rectRoomLines(400, 300)
    const seed = roomToCeilingSeed(room({ label: 'Спальня' }), lines, 10)!
    expect(seed.zones).toHaveLength(1)
    expect(seed.zones[0].label).toBe('Спальня')
    expect(seed.label).toBe('Спальня')
  })
})
