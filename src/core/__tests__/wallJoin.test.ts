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

describe('computeWallJoins — приоритет категорий (слой 2): капитал не уступает изменяемой', () => {
  it('капитал (периметр) НЕ обрезается, даже если его конец геометрически лёг на тело mutable-стены', () => {
    // B — mutable (перегородка), A — capital (периметр), конец A на грани B
    const B: WallForJoin = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, createdIndex: 0, category: 'mutable' }
    const A: WallForJoin = { id: 'A', x1: 100, y1: 40, x2: 100, y2: 0, halfPx: 5, createdIndex: 1, category: 'capital' }

    const res = computeWallJoins([B, A])
    const ja = res.get('A')!
    // Капитал не должен считаться "attached" — торец остаётся как есть
    expect(ja.cap1).toBe(true)
  })

  it('изменяемая по-прежнему нормально обрезается о капитал (обычный сценарий: перегородка примыкает к периметру)', () => {
    // B — capital (периметр), A — mutable (перегородка), конец A на грани B
    const B: WallForJoin = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, createdIndex: 0, category: 'capital' }
    const A: WallForJoin = { id: 'A', x1: 100, y1: 40, x2: 100, y2: 0, halfPx: 5, createdIndex: 1, category: 'mutable' }

    const res = computeWallJoins([B, A])
    const ja = res.get('A')!
    expect(ja.cap1).toBe(false)
  })

  it('между двумя capital (например, две грани колонны) приоритет не мешает обычному T-стыку', () => {
    const B: WallForJoin = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, createdIndex: 0, category: 'capital' }
    const A: WallForJoin = { id: 'A', x1: 100, y1: 40, x2: 100, y2: 0, halfPx: 5, createdIndex: 1, category: 'capital' }

    const res = computeWallJoins([B, A])
    const ja = res.get('A')!
    expect(ja.cap1).toBe(false)
  })

  it('между двумя mutable (перегородка к перегородке) приоритет не мешает обычному T-стыку', () => {
    const B: WallForJoin = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, createdIndex: 0, category: 'mutable' }
    const A: WallForJoin = { id: 'A', x1: 100, y1: 40, x2: 100, y2: 0, halfPx: 5, createdIndex: 1, category: 'mutable' }

    const res = computeWallJoins([B, A])
    const ja = res.get('A')!
    expect(ja.cap1).toBe(false)
  })

  it('без category (undefined, старые данные до слоя 1) — работает как раньше, без приоритета', () => {
    const B: WallForJoin = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, createdIndex: 0 }
    const A: WallForJoin = { id: 'A', x1: 100, y1: 40, x2: 100, y2: 0, halfPx: 5, createdIndex: 1 }

    const res = computeWallJoins([B, A])
    const ja = res.get('A')!
    expect(ja.cap1).toBe(false)
  })
})

/** Проверка, что четырёхугольник (p1p,p2p,p2m,p1m) не самопересекается —
 *  знак векторного произведения на всех вершинах контура должен совпадать. */
function isSimpleQuad(jw: { p1p: { x: number; y: number }; p2p: { x: number; y: number }; p2m: { x: number; y: number }; p1m: { x: number; y: number } }): boolean {
  const pts = [jw.p1p, jw.p2p, jw.p2m, jw.p1m]
  let sign0 = 0
  for (let i = 0; i < 4; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % 4], p2 = pts[(i + 2) % 4]
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x)
    if (i === 0) sign0 = Math.sign(cross)
    else if (Math.abs(cross) > 1e-6 && Math.sign(cross) !== sign0) return false
  }
  return true
}

describe('computeWallJoins — L-стык не перекручивается на короткой "ступеньке" под острым углом', () => {
  // Реальный кейс с объекта: диагональная перегородка подходит к главной
  // стене не в одну точку, а через короткую перпендикулярную "ступеньку"
  // (см. KONSPEKT.md). Раньше митровый стык на короткой стене под острым
  // углом мог "утянуть" угловую точку назад за другой конец той же стены —
  // получалась перекрученная (самопересекающаяся) заливка.
  function buildStep(stepLen: number, angleDeg: number) {
    const angle = angleDeg * Math.PI / 180
    const C: WallForJoin = { id: 'C', x1: 0, y1: 0, x2: 0, y2: 3000, halfPx: 75, createdIndex: 0, category: 'capital' }
    const B: WallForJoin = { id: 'B', x1: 0, y1: 1000, x2: stepLen, y2: 1000, halfPx: 75, createdIndex: 1, category: 'mutable' }
    const A: WallForJoin = {
      id: 'A', x1: stepLen, y1: 1000,
      x2: stepLen + 1200 * Math.cos(angle), y2: 1000 + 1200 * Math.sin(angle),
      halfPx: 75, createdIndex: 2, category: 'mutable',
    }
    return computeWallJoins([C, B, A]).get('B')!
  }

  it('короткая ступенька (80мм) под острым углом (10°) — раньше ломалось, теперь простой четырёхугольник', () => {
    expect(isSimpleQuad(buildStep(80, 10))).toBe(true)
  })

  it('широкий перебор длин ступеньки и углов — ни один случай не даёт самопересечения', () => {
    const steps = [30, 50, 80, 100, 150, 200, 300, 500]
    const angles = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 170]
    for (const step of steps) {
      for (const ang of angles) {
        expect(isSimpleQuad(buildStep(step, ang))).toBe(true)
      }
    }
  })

  it('обычная нормальная ступенька (150мм, 30°) — как на фото пользователя, четырёхугольник простой', () => {
    expect(isSimpleQuad(buildStep(150, 30))).toBe(true)
  })

  it('нормальный "не короткий" случай (300мм, 45°) даёт полноценный митр (не откат на fallback)', () => {
    // Тут защита не должна срабатывать вообще — стена достаточно длинная
    const jw = buildStep(300, 45)
    // Ось должна быть продлена (митр применился), а не остаться "голой" 300мм
    const axLen = Math.hypot(jw.ax2 - jw.ax1, jw.ay2 - jw.ay1)
    expect(axLen).toBeGreaterThan(300)
  })
})
