import { describe, it, expect } from 'vitest'
import { duplicateFloorPlanGeometry, type IdGen } from '../duplicateFloorPlan'
import { DEFAULT_FLOOR_PLAN } from '../../types'
import type { FloorPlan, PlanLine, Room, PlanContour } from '../../types'

/** Предсказуемый счётчик id вместо Date.now()/Math.random — для сравнений в тестах */
function makeCountingIdGen(): IdGen {
  const counters: Record<string, number> = {}
  return (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1
    return `${prefix}${counters[prefix]}`
  }
}

function line(overrides: Partial<PlanLine>): PlanLine {
  return { id: 'l1', x1: 0, y1: 0, x2: 100, y2: 0, type: 'wall_existing', lengthMm: 1000, label: 'С-1', ...overrides }
}

describe('duplicateFloorPlanGeometry', () => {
  it('линии получают новые id (со старым id в хвосте, для отладки)', () => {
    const src: FloorPlan = { ...DEFAULT_FLOOR_PLAN, lines: [line({ id: 'A' }), line({ id: 'B' })] }
    const copy = duplicateFloorPlanGeometry(src, makeCountingIdGen())
    expect(copy.lines.map(l => l.id)).toEqual(['pl1_A', 'pl2_B'])
    expect(copy.lines[0].id).not.toBe('A')
  })

  it('Room.lineIds переносятся на НОВЫЕ id линий, а не остаются старыми (сам баг)', () => {
    const src: FloorPlan = {
      ...DEFAULT_FLOOR_PLAN,
      lines: [line({ id: 'A' }), line({ id: 'B' }), line({ id: 'C' }), line({ id: 'D' })],
      rooms: [{ id: 'room1', lineIds: ['A', 'B', 'C', 'D'], areaM2: 10, perimeterMm: 4000, label: 'Помещение 1' } as Room],
    }
    const copy = duplicateFloorPlanGeometry(src, makeCountingIdGen())
    expect(copy.rooms).toHaveLength(1)
    expect(copy.rooms[0].id).not.toBe('room1')
    // ключевая проверка: lineIds должны совпадать с ключами новых линий, а не со старыми 'A'..'D'
    expect(copy.rooms[0].lineIds).toEqual(copy.lines.map(l => l.id))
    expect(copy.rooms[0].lineIds).not.toContain('A')
  })

  it('PlanContour.lineIds тоже переносятся на новые id (та же логика, что у rooms)', () => {
    const src: FloorPlan = {
      ...DEFAULT_FLOOR_PLAN,
      lines: [line({ id: 'A' }), line({ id: 'B' })],
      contours: [{ id: 'c1', lineIds: ['A', 'B'], areaM2: 5, type: 'wall_existing', label: 'Контур 1' } as PlanContour],
    }
    const copy = duplicateFloorPlanGeometry(src, makeCountingIdGen())
    expect(copy.contours[0].lineIds).toEqual(copy.lines.map(l => l.id))
  })

  it('lineId, которого не было среди линий (битые данные) — тихо отфильтровывается, без исключения', () => {
    const src: FloorPlan = {
      ...DEFAULT_FLOOR_PLAN,
      lines: [line({ id: 'A' })],
      rooms: [{ id: 'room1', lineIds: ['A', 'GHOST'], areaM2: 1, perimeterMm: 100, label: 'X' } as Room],
    }
    const copy = duplicateFloorPlanGeometry(src, makeCountingIdGen())
    expect(copy.rooms[0].lineIds).toEqual(['pl1_A']) // 'GHOST' просто выпал, без падения
  })

  it('slabs/roundColumns/rectColumns получают новые id (не пересекаются с исходным этажом)', () => {
    const src: FloorPlan = {
      ...DEFAULT_FLOOR_PLAN,
      slabs: [{ id: 'srcSlab', outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], holes: [], label: 'Плита 1' }],
      roundColumns: [{ id: 'srcRoundCol', cx: 0, cy: 0, diameterMm: 400, label: 'Колонна 1' }],
      rectColumns: [{ id: 'srcRectCol', cx: 0, cy: 0, widthMm: 400, depthMm: 400, angleRad: 0, label: 'Колонна 2' }],
    }
    const copy = duplicateFloorPlanGeometry(src, makeCountingIdGen())
    expect(copy.slabs[0].id).not.toBe('srcSlab')
    expect(copy.roundColumns[0].id).not.toBe('srcRoundCol')
    expect(copy.rectColumns[0].id).not.toBe('srcRectCol')
    // геометрия/параметры при этом не меняются — только id
    expect(copy.roundColumns[0].diameterMm).toBe(400)
    expect(copy.rectColumns[0].widthMm).toBe(400)
  })

  it('пустой план — не падает, возвращает пустые массивы', () => {
    const copy = duplicateFloorPlanGeometry(DEFAULT_FLOOR_PLAN, makeCountingIdGen())
    expect(copy.lines).toEqual([])
    expect(copy.rooms).toEqual([])
    expect(copy.slabs).toEqual([])
  })

  it('несколько rooms — id каждой линии используется ровно один раз (нет коллизий в карте)', () => {
    const src: FloorPlan = {
      ...DEFAULT_FLOOR_PLAN,
      lines: [line({ id: 'A' }), line({ id: 'B' }), line({ id: 'C' }), line({ id: 'D' })],
      rooms: [
        { id: 'r1', lineIds: ['A', 'B'], areaM2: 1, perimeterMm: 100, label: 'R1' } as Room,
        { id: 'r2', lineIds: ['C', 'D'], areaM2: 1, perimeterMm: 100, label: 'R2' } as Room,
      ],
    }
    const copy = duplicateFloorPlanGeometry(src, makeCountingIdGen())
    const [newA, newB, newC, newD] = copy.lines.map(l => l.id)
    expect(copy.rooms[0].lineIds).toEqual([newA, newB])
    expect(copy.rooms[1].lineIds).toEqual([newC, newD])
  })
})
