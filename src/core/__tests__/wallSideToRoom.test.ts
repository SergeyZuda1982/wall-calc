import { describe, it, expect } from 'vitest'
import type { PlanLine } from '../../types'
import { wallSideFacingRoom, wallSideFacingRoomLines } from '../wallSideToRoom'

function wall(id: string, x1: number, y1: number, x2: number, y2: number): PlanLine {
  return { id, x1, y1, x2, y2, type: 'wall_existing', lengthMm: Math.hypot(x2 - x1, y2 - y1), label: id } as PlanLine
}

// Квадратная комната 0..400 x 0..400 (px), обход ПО ЧАСОВОЙ стрелке в
// экранных координатах (Y вниз): верх слева→направо, право сверху→вниз,
// низ справа→налево, лево снизу→вверх. Это стандартный CW-обход по часовой
// в Y-down экране = внутренность полигона всегда СПРАВА от хода каждой стороны.
const room = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }]

describe('wallSideFacingRoom — геометрическая корректность (регрессия/новая фича 20.07.2026)', () => {
  it('верхняя стена (0,0)→(400,0), обход слева-направо: комната ниже линии — сторона B (нормаль A уходит вверх, наружу)', () => {
    const top = wall('top', 0, 0, 400, 0)
    // normal A = (-dy, dx)/len = (0, 400)/400 = (0,1) → вниз (в комнату, y растёт вниз)
    // Значит для ЭТОЙ линии сторона A должна смотреть В комнату.
    expect(wallSideFacingRoom(top, room)).toBe('A')
  })

  it('нижняя стена, обход справа-налево (400,400)→(0,400): нормаль A должна указывать вверх, в комнату', () => {
    const bottom = wall('bottom', 400, 400, 0, 400)
    // dx=-400,dy=0 → normal A=(-dy,dx)/len=(0,-400)/400=(0,-1) → вверх, в комнату (комната выше линии, y<400)
    expect(wallSideFacingRoom(bottom, room)).toBe('A')
  })

  it('правая стена, обход сверху-вниз (400,0)→(400,400): нормаль A должна указывать влево, в комнату', () => {
    const right = wall('right', 400, 0, 400, 400)
    // dx=0,dy=400 → normal A=(-dy,dx)/len=(-400,0)/400=(-1,0) → влево, в комнату (комната левее, x<400)
    expect(wallSideFacingRoom(right, room)).toBe('A')
  })

  it('левая стена, обход снизу-вверх (0,400)→(0,0): нормаль A должна указывать вправо, в комнату', () => {
    const left = wall('left', 0, 400, 0, 0)
    expect(wallSideFacingRoom(left, room)).toBe('A')
  })

  it('та же стена, развёрнутая в обратном направлении (x1↔x2) — сторона переворачивается на противоположную', () => {
    const top = wall('top', 0, 0, 400, 0)
    const topReversed = wall('top', 400, 0, 0, 0)
    expect(wallSideFacingRoom(top, room)).not.toBe(wallSideFacingRoom(topReversed, room))
  })

  it('общая стена между двумя соседними комнатами — противоположные стороны для каждой', () => {
    // Комната слева 0..300x0..300, комната справа 300..600x0..300, общая стена x=300
    const roomLeft = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }]
    const roomRight = [{ x: 300, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 300 }]
    const sharedWall = wall('shared', 300, 0, 300, 300)
    const sideForLeft = wallSideFacingRoom(sharedWall, roomLeft)
    const sideForRight = wallSideFacingRoom(sharedWall, roomRight)
    expect(sideForLeft).not.toBeNull()
    expect(sideForRight).not.toBeNull()
    expect(sideForLeft).not.toBe(sideForRight) // разные стороны — не задвоится и не потеряется материал
  })

  it('стена, не граничащая с комнатой вообще (далеко в стороне) — не определяется однозначно (null)', () => {
    const farAway = wall('far', 1000, 1000, 1400, 1000)
    expect(wallSideFacingRoom(farAway, room)).toBeNull()
  })

  it('вырожденная линия (нулевая длина) — null, не падает', () => {
    const degenerate = wall('deg', 100, 100, 100, 100)
    expect(wallSideFacingRoom(degenerate, room)).toBeNull()
  })

  it('wallSideFacingRoomLines собирает полигон из lineIds так же корректно, как явный массив точек', () => {
    const top = wall('top', 0, 0, 400, 0)
    const right = wall('right', 400, 0, 400, 400)
    const bottom = wall('bottom', 400, 400, 0, 400)
    const left = wall('left', 0, 400, 0, 0)
    const all = [top, right, bottom, left]
    expect(wallSideFacingRoomLines(top, ['top', 'right', 'bottom', 'left'], all)).toBe('A')
  })
})
