import { describe, it, expect } from 'vitest'
import { findFrameCornerNodes, isRightAngle, type CornerJoinInput } from '../frameCornerNodes'

describe('isRightAngle', () => {
  it('90.0° — прямой угол', () => { expect(isRightAngle(90)).toBe(true) })
  it('88.5° — в пределах допуска 2°', () => { expect(isRightAngle(88.5)).toBe(true) })
  it('91.9° — в пределах допуска 2°', () => { expect(isRightAngle(91.9)).toBe(true) })
  it('85° — вне допуска', () => { expect(isRightAngle(85)).toBe(false) })
  it('180° (торец в торец) — не угол', () => { expect(isRightAngle(180)).toBe(false) })
  it('0° (крест/наложение) — не угол', () => { expect(isRightAngle(0)).toBe(false) })
})

describe('findFrameCornerNodes', () => {
  it('простой угол короба: два сегмента 90°, конец=начало', () => {
    // A: (0,0)-(800,0) ; B: (800,0)-(800,450) — общая точка (800,0), угол 90°
    const walls: CornerJoinInput[] = [
      { id: 'A', x1: 0, y1: 0, x2: 800, y2: 0 },
      { id: 'B', x1: 800, y1: 0, x2: 800, y2: 450 },
    ]
    const nodes = findFrameCornerNodes(walls)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ aId: 'A', aEnd: 'end2', bId: 'B', bEnd: 'end1', x: 800, y: 0 })
    expect(nodes[0].angleDeg).toBeCloseTo(90, 5)
  })

  it('замкнутый контур короба 800×450: 4 сегмента → 4 угловых узла', () => {
    const walls: CornerJoinInput[] = [
      { id: 'S1', x1: 0, y1: 0, x2: 800, y2: 0 },
      { id: 'S2', x1: 800, y1: 0, x2: 800, y2: 450 },
      { id: 'S3', x1: 800, y1: 450, x2: 0, y2: 450 },
      { id: 'S4', x1: 0, y1: 450, x2: 0, y2: 0 },
    ]
    const nodes = findFrameCornerNodes(walls)
    expect(nodes).toHaveLength(4)
    for (const n of nodes) expect(n.angleDeg).toBeCloseTo(90, 5)
  })

  it('Т-стык (конец A лежит на теле B, а не на конце B) — не угол, не L-стык вообще', () => {
    // B: (0,0)-(1000,0), A: (500,0)-(500,300) — конец A совпадает с СЕРЕДИНОЙ B,
    // не с концом — endTouchesSurface T-случай, findFrameCornerNodes проверяет
    // только конец=конец (L), поэтому этот случай не должен попасть в результат.
    const walls: CornerJoinInput[] = [
      { id: 'B', x1: 0, y1: 0, x2: 1000, y2: 0 },
      { id: 'A', x1: 500, y1: 0, x2: 500, y2: 300 },
    ]
    const nodes = findFrameCornerNodes(walls)
    expect(nodes).toHaveLength(0)
  })

  it('торец в торец по одной оси (180°) — не угол', () => {
    const walls: CornerJoinInput[] = [
      { id: 'A', x1: 0, y1: 0, x2: 500, y2: 0 },
      { id: 'B', x1: 500, y1: 0, x2: 1000, y2: 0 },
    ]
    const nodes = findFrameCornerNodes(walls)
    expect(nodes).toHaveLength(0)
  })

  it('скошенное примыкание (не 90°) — не считается углом (сейчас вне скоупа)', () => {
    // B горизонтальная, A под 60° к ней из той же точки
    const walls: CornerJoinInput[] = [
      { id: 'A', x1: 0, y1: 0, x2: 1000, y2: 0 },
      { id: 'B', x1: 0, y1: 0, x2: 500, y2: 866 }, // ~60° от A
    ]
    const nodes = findFrameCornerNodes(walls)
    expect(nodes).toHaveLength(0)
  })

  it('концы не совпадают (зазор больше допуска) — не угол', () => {
    const walls: CornerJoinInput[] = [
      { id: 'A', x1: 0, y1: 0, x2: 800, y2: 0 },
      { id: 'B', x1: 820, y1: 0, x2: 820, y2: 450 }, // зазор 20px >> JOIN_EPS=3px
    ]
    const nodes = findFrameCornerNodes(walls)
    expect(nodes).toHaveLength(0)
  })

  it('допуск совпадения точек (в пределах JOIN_EPS) — угол находится', () => {
    const walls: CornerJoinInput[] = [
      { id: 'A', x1: 0, y1: 0, x2: 800, y2: 0 },
      { id: 'B', x1: 801, y1: 1, x2: 801, y2: 450 }, // зазор ~1.4px < JOIN_EPS=3px
    ]
    const nodes = findFrameCornerNodes(walls)
    expect(nodes).toHaveLength(1)
  })

  it('крест (пересечение середин, оба конца не совпадают ни с чем) — не угол', () => {
    const walls: CornerJoinInput[] = [
      { id: 'A', x1: 0, y1: 250, x2: 1000, y2: 250 },
      { id: 'B', x1: 500, y1: 0, x2: 500, y2: 500 },
    ]
    const nodes = findFrameCornerNodes(walls)
    expect(nodes).toHaveLength(0)
  })

  it('колонна 600×600 — 4 сегмента, 4 узла (пример из спецификации)', () => {
    const walls: CornerJoinInput[] = [
      { id: 'C1', x1: 0, y1: 0, x2: 600, y2: 0 },
      { id: 'C2', x1: 600, y1: 0, x2: 600, y2: 600 },
      { id: 'C3', x1: 600, y1: 600, x2: 0, y2: 600 },
      { id: 'C4', x1: 0, y1: 600, x2: 0, y2: 0 },
    ]
    const nodes = findFrameCornerNodes(walls)
    expect(nodes).toHaveLength(4)
  })
})
