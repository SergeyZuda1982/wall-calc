import { describe, it, expect } from 'vitest'
import type { PlanLine, Room } from '../../types'
import { calcRoomMaterials, wallFinishAreaM2 } from '../calcRoomMaterials'

function wall(id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<PlanLine> = {}): PlanLine {
  return {
    id, x1, y1, x2, y2, type: 'wall_existing', lengthMm: Math.hypot(x2 - x1, y2 - y1),
    heightMm: 2700, label: id, ...extra,
  } as PlanLine
}

// Квадратная комната 0..4000 x 0..3000 (px=мм здесь для простоты, 1px=1мм),
// периметр обходится по часовой стрелке (см. wallSideToRoom.test.ts — этот
// обход даёт сторону A каждой стены смотрящей внутрь).
function squareRoom(overrides: Partial<Room> = {}): { room: Room, lines: PlanLine[] } {
  const top = wall('top', 0, 0, 4000, 0)
  const right = wall('right', 4000, 0, 4000, 3000)
  const bottom = wall('bottom', 4000, 3000, 0, 3000)
  const left = wall('left', 0, 3000, 0, 0)
  const room: Room = {
    id: 'r1', lineIds: ['top', 'right', 'bottom', 'left'], areaM2: 12, perimeterMm: 14000, label: 'Комната 1',
    ...overrides,
  }
  return { room, lines: [top, right, bottom, left] }
}

describe('wallFinishAreaM2', () => {
  it('длина×высота без проёмов', () => {
    const w = wall('w', 0, 0, 3000, 0, { heightMm: 2700 })
    expect(wallFinishAreaM2(w)).toBeCloseTo(3 * 2.7, 5)
  })

  it('вычитает площадь проёмов', () => {
    const w = wall('w', 0, 0, 3000, 0, {
      heightMm: 2700,
      openings: [{ id: 'o1', type: 'door', offsetMm: 500, widthMm: 900, heightMm: 2100, label: 'Д-1' }],
    })
    expect(wallFinishAreaM2(w)).toBeCloseTo(3 * 2.7 - 0.9 * 2.1, 5)
  })

  it('не уходит в минус, если проёмы "больше" стены (защита от мусорных данных)', () => {
    const w = wall('w', 0, 0, 500, 0, {
      heightMm: 500,
      openings: [{ id: 'o1', type: 'door', offsetMm: 0, widthMm: 900, heightMm: 2100, label: 'Д-1' }],
    })
    expect(wallFinishAreaM2(w)).toBe(0)
  })
})

describe('calcRoomMaterials', () => {
  it('пол/потолок без finishProgress на стенах: только 2 источника (пол+потолок)', () => {
    const { room, lines } = squareRoom({
      floorProgress: { steps: [{ stepId: 's1', label: 'Стяжка', materialKind: 'screed', materialThicknessMm: 50, outcome: 'pending' }] },
    })
    const result = calcRoomMaterials(room, lines)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].materialKind).toBe('screed')
    expect(result.lines[0].areaM2).toBe(12)
  })

  it('стены с finishProgressA (грунтовка) — попадают в смету только со стороны, смотрящей в комнату', () => {
    const { room, lines } = squareRoom()
    lines[0].finishProgressA = { steps: [{ stepId: 's1', label: 'Грунтовка', materialKind: 'priming', outcome: 'pending' }] } // top, сторона A смотрит внутрь
    lines[0].finishProgressB = { steps: [{ stepId: 's1', label: 'Грунтовка', materialKind: 'priming', outcome: 'pending' }] } // сторона B смотрит НАРУЖУ — не должна попасть
    const result = calcRoomMaterials(room, lines)
    expect(result.lines).toHaveLength(1) // не 2 — только сторона A учтена
    expect(result.lines[0].source).toContain('сторона A')
  })

  it('пул складывает одинаковый материал с разных поверхностей (пол-грунтовка + стена-грунтовка)', () => {
    const { room, lines } = squareRoom({
      floorProgress: { steps: [{ stepId: 's1', label: 'Грунтовка', materialKind: 'priming', outcome: 'pending' }] },
    })
    lines[0].finishProgressA = { steps: [{ stepId: 's1', label: 'Грунтовка', materialKind: 'priming', outcome: 'pending' }] }
    const result = calcRoomMaterials(room, lines)
    expect(result.lines).toHaveLength(2) // 2 отдельные строки...
    expect(Object.keys(result.pooled)).toEqual(['priming']) // ...но 1 позиция в пуле
    const pooledMass = result.pooled.priming!.totalMass
    const sumOfLines = result.lines.reduce((s, l) => s + l.totalMass, 0)
    expect(pooledMass).toBeCloseTo(sumOfLines, 10)
  })

  it('общая стена между двумя комнатами (сценарий пользователя): каждая комната видит СВОЮ сторону, материал не задваивается', () => {
    // Комната слева 0..3000, справа 3000..6000 (px=мм), общая стена x=3000
    const sharedWall = wall('shared', 3000, 0, 3000, 3000, { heightMm: 2700 })
    sharedWall.finishProgressA = { steps: [{ stepId: 's1', label: 'Штукатурка', materialKind: 'plaster_gypsum', materialThicknessMm: 15, outcome: 'pending' }] }
    sharedWall.finishProgressB = { steps: [{ stepId: 's1', label: 'Плитка (санузел)', materialKind: undefined, outcome: 'pending' }] }

    const leftTop = wall('lt', 0, 0, 3000, 0)
    const leftBottom = wall('lb', 3000, 3000, 0, 3000)
    const leftOuter = wall('lo', 0, 3000, 0, 0)
    const roomLeft: Room = { id: 'left', lineIds: ['lt', 'shared', 'lb', 'lo'], areaM2: 9, perimeterMm: 12000, label: 'Слева' }

    const rightTop = wall('rt', 3000, 0, 6000, 0)
    const rightOuter = wall('ro', 6000, 0, 6000, 3000)
    const rightBottom = wall('rb', 6000, 3000, 3000, 3000)
    const roomRight: Room = { id: 'right', lineIds: ['rt', 'ro', 'rb', 'shared'], areaM2: 9, perimeterMm: 12000, label: 'Справа' }

    const allLines = [sharedWall, leftTop, leftBottom, leftOuter, rightTop, rightOuter, rightBottom]

    const resultLeft = calcRoomMaterials(roomLeft, allLines)
    const resultRight = calcRoomMaterials(roomRight, allLines)

    // Слева должна увидеть штукатурку общей стены, справа — не должна (плитка без materialKind не считается здесь)
    const leftHasPlaster = resultLeft.lines.some(l => l.materialKind === 'plaster_gypsum')
    const rightHasPlaster = resultRight.lines.some(l => l.materialKind === 'plaster_gypsum')
    expect(leftHasPlaster).toBe(true)
    expect(rightHasPlaster).toBe(false) // не задвоилось на вторую комнату
  })

  it('шаг без materialKind (например Плитка — считает TileCalc отдельно) не попадает в смету материалов', () => {
    const { room, lines } = squareRoom()
    lines[0].finishProgressA = {
      steps: [
        { stepId: 's1', label: 'Грунтовка', materialKind: 'priming', outcome: 'pending' },
        { stepId: 's2', label: 'Плитка', outcome: 'pending' }, // без materialKind
      ],
    }
    const result = calcRoomMaterials(room, lines)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].materialKind).toBe('priming')
  })

  it('пустая комната (ничего не запланировано) — пустой результат, не падает', () => {
    const { room, lines } = squareRoom()
    const result = calcRoomMaterials(room, lines)
    expect(result.lines).toHaveLength(0)
    expect(Object.keys(result.pooled)).toHaveLength(0)
  })
})
