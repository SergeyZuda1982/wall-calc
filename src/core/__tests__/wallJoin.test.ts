import { describe, it, expect } from 'vitest'
import { computeWallJoins, type WallForJoin } from '../wallJoin'

// scaleMmPx = 10 (как дефолт в FloorPlan), т.е. 1px = 10мм
// B — капитальная стена 200мм толщиной (halfPx=10), горизонтальная, ось y=50, x: 0..200
// A — перегородка 100мм толщиной (halfPx=5), примыкает СВЕРХУ (со стороны y<50)
//
// Именно так реально работает snapPoint(): он ставит конечную точку A НЕ на ось B,
// а сразу на БЛИЖНЮЮ ГРАНЬ B (см. FloorPlan.tsx snapPoint, комментарий
// "T-примыкание: снап к БЛИЖНЕМУ РЕБРУ стены (не к оси!)").
// Грань B со стороны y<50 — это y = 50 - halfPx(B) = 40.
describe('computeWallJoins — T-стык с учётом толщины стены', () => {
  it('распознаёт T-стык, когда конец линии стоит на ГРАНИ (а не оси) толстой стены', () => {
    const B: WallForJoin = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, createdIndex: 0 }
    const A: WallForJoin = { id: 'A', x1: 100, y1: 40, x2: 100, y2: 0, halfPx: 5, createdIndex: 1 }
    // A.y1=40 — это ровно грань B (50 - halfPx(B)=10), а не ось (50)

    const res = computeWallJoins([B, A])
    const ja = res.get('A')!
    // Конец end1 (x1,y1) A физически упирается в грань B → должен считаться "в стыке",
    // т.е. торец (cap) НЕ рисуется на этом конце
    expect(ja.cap1).toBe(false)
  })

  it('для сравнения: если бы конец стоял на ОСИ B (старое поведение), тоже находит T-стык', () => {
    const B: WallForJoin = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, createdIndex: 0 }
    const A: WallForJoin = { id: 'A', x1: 100, y1: 50, x2: 100, y2: 0, halfPx: 5, createdIndex: 1 }

    const res = computeWallJoins([B, A])
    const ja = res.get('A')!
    expect(ja.cap1).toBe(false)
  })

  it('не находит T-стык, если конец A далеко от B (за пределами допуска)', () => {
    const B: WallForJoin = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, createdIndex: 0 }
    const A: WallForJoin = { id: 'A', x1: 100, y1: 20, x2: 100, y2: 0, halfPx: 5, createdIndex: 1 }

    const res = computeWallJoins([B, A])
    const ja = res.get('A')!
    expect(ja.cap1).toBe(true)
  })

  it('самокоррекция: конец случайно "заведён" ВНУТРЬ тела стены (не на грань и не на ось) — всё равно примыкает и корректно обрезается до грани', () => {
    const B: WallForJoin = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, createdIndex: 0 }
    // A.y1 = 45 — на 5px внутрь тела B (грань — y=40, ось — y=50), классическая
    // "случайно заехал на монолит" ситуация из описания пользователя
    const A: WallForJoin = { id: 'A', x1: 100, y1: 45, x2: 100, y2: 0, halfPx: 5, createdIndex: 1 }

    const res = computeWallJoins([B, A])
    const ja = res.get('A')!
    expect(ja.cap1).toBe(false)
    // Итоговая скорректированная точка (p1p/p1m по side±) должна лежать
    // ровно на грани B (y=40), а не там, где пользователь случайно кликнул (y=45)
    expect(ja.p1p.y).toBeCloseTo(40, 5)
    expect(ja.p1m.y).toBeCloseTo(40, 5)
  })
})
