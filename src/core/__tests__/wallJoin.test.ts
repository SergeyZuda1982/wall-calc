import { describe, it, expect } from 'vitest'
import { computeWallJoins, buildWallsForJoin, computeJoinAngles, defaultCategory, type WallForJoin } from '../wallJoin'
import type { PlanLine, RectColumn } from '../../types'

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

describe('computeWallJoins — грань колонны (halfPx≈0) как main в T-стыке', () => {
  // Грань прямоугольной колонны участвует в join как капитальная "стена"
  // почти нулевой толщины (см. FloorPlan.tsx, COLUMN_EDGE_HALF_PX) — сама
  // грань физическая плоскость, а не толстая стена. Проверяем, что T-стык
  // работает под ЛЮБЫМ углом (не только 90°), включая острые углы из
  // реального кейса пользователя (07.07.2026: диагональная перегородка
  // подходит к грани колонны почти по касательной).
  const COLUMN_EDGE_HALF_PX = 0.01

  function buildColumnAttach(faceLen: number, angleDeg: number, wallLen = 1200) {
    const angle = angleDeg * Math.PI / 180
    // Грань колонны — горизонтальный отрезок капитальной "толщины" ~0
    const face: WallForJoin = {
      id: 'FACE', x1: 0, y1: 0, x2: faceLen, y2: 0,
      halfPx: COLUMN_EDGE_HALF_PX, createdIndex: -1000, category: 'capital',
    }
    // Стена подходит к середине грани под заданным углом (мутабельная)
    const midX = faceLen / 2
    const wall: WallForJoin = {
      id: 'WALL', x1: midX, y1: 0,
      x2: midX + wallLen * Math.cos(angle), y2: wallLen * Math.sin(angle),
      halfPx: 75, createdIndex: 0, category: 'mutable',
    }
    return computeWallJoins([face, wall]).get('WALL')!
  }

  it('распознаёт T-стык под прямым углом (90°) — обычный случай', () => {
    const jw = buildColumnAttach(300, 90)
    expect(jw.cap1).toBe(false)
  })

  it('распознаёт T-стык под очень острым углом (5°, почти по касательной к грани)', () => {
    const jw = buildColumnAttach(300, 5)
    expect(jw.cap1).toBe(false)
    expect(isSimpleQuad(jw)).toBe(true)
  })

  it('широкий перебор углов (включая почти касательные 2° и 178°) — без самопересечения', () => {
    const angles = [2, 5, 10, 20, 45, 60, 90, 120, 150, 170, 178]
    for (const ang of angles) {
      const jw = buildColumnAttach(300, ang)
      expect(isSimpleQuad(jw)).toBe(true)
    }
  })

  it('короткая грань колонны (100мм) + острый угол — тоже без самопересечения', () => {
    const jw = buildColumnAttach(100, 8)
    expect(isSimpleQuad(jw)).toBe(true)
  })

  it('капитал (грань колонны) не обрезается изменяемой стеной, даже если стена "main" по порядку аргументов', () => {
    // Грань колонны идёт ВТОРЫМ аргументом — проверяем симметрично: колонна
    // не должна оказаться "attached" стороной ни при каком порядке.
    const face: WallForJoin = { id: 'FACE', x1: 0, y1: 0, x2: 300, y2: 0, halfPx: COLUMN_EDGE_HALF_PX, createdIndex: -1000, category: 'capital' }
    const wall: WallForJoin = { id: 'WALL', x1: 150, y1: 0, x2: 150, y2: 1200, halfPx: 75, createdIndex: 0, category: 'mutable' }
    const res = computeWallJoins([wall, face]) // порядок изменён
    const jFace = res.get('FACE')!
    // Грань колонны — прямая линия шириной 300мм, стена примыкает к её середине под 90°.
    // У грани не должно быть T-стыка по своей оси (она не "обрезается" стеной):
    expect(jFace.cap1).toBe(true)
    expect(jFace.cap2).toBe(true)
  })
})

describe('defaultCategory', () => {
  it('wall_existing и rib_beam — capital', () => {
    expect(defaultCategory('wall_existing')).toBe('capital')
    expect(defaultCategory('rib_beam')).toBe('capital')
  })
  it('всё остальное — mutable', () => {
    expect(defaultCategory('wall_new')).toBe('mutable')
    expect(defaultCategory('wall_lining')).toBe('mutable')
    expect(defaultCategory('ceiling')).toBe('mutable')
    expect(defaultCategory('floor')).toBe('mutable')
  })
})

describe('buildWallsForJoin — сборка входа для computeWallJoins из линий + колонн', () => {
  function line(overrides: Partial<PlanLine> = {}): PlanLine {
    return {
      id: 'L1', x1: 0, y1: 0, x2: 300, y2: 0,
      type: 'wall_new', lengthMm: 3000, label: 'П-1',
      spec: { material: 'gkl', subtype: 'ps75' }, // thicknessMm ~125 -> ~12.5px при scale=10, >3px
      ...overrides,
    } as PlanLine
  }

  it('линия без spec (толщина 0) — пропускается', () => {
    const walls = buildWallsForJoin([line({ spec: undefined })], 10)
    expect(walls).toHaveLength(0)
  })

  it('линия с дугой (sagittaMm) — пропускается (join для дуг пока не считаем)', () => {
    const walls = buildWallsForJoin([line({ sagittaMm: 50 })], 10)
    expect(walls).toHaveLength(0)
  })

  it('нулевая длина линии — пропускается', () => {
    const walls = buildWallsForJoin([line({ x1: 0, y1: 0, x2: 0, y2: 0 })], 10)
    expect(walls).toHaveLength(0)
  })

  it('обычная линия попадает в список с category по умолчанию (defaultCategory)', () => {
    const walls = buildWallsForJoin([line()], 10)
    expect(walls).toHaveLength(1)
    expect(walls[0].id).toBe('L1')
    expect(walls[0].category).toBe('mutable') // wall_new
  })

  it('явная category на линии переопределяет дефолт', () => {
    const walls = buildWallsForJoin([line({ category: 'capital' })], 10)
    expect(walls[0].category).toBe('capital')
  })

  it('без колонн (дефолт []) — тот же результат, что и раньше (обратная совместимость)', () => {
    const walls = buildWallsForJoin([line()], 10)
    expect(walls).toHaveLength(1)
  })

  it('прямоугольная колонна добавляет ровно 4 грани, капитальные, почти нулевой толщины', () => {
    const col: RectColumn = { id: 'col1', cx: 500, cy: 500, widthMm: 300, depthMm: 300, angleRad: 0, label: 'Колонна 1' }
    const walls = buildWallsForJoin([], 10, [col])
    expect(walls).toHaveLength(4)
    walls.forEach(w => {
      expect(w.id).toContain('col1')
      expect(w.category).toBe('capital')
      expect(w.halfPx).toBeCloseTo(0.01)
    })
  })

  it('колонна с явной category (например mutable, гипотетически) — пробрасывается как есть', () => {
    const col: RectColumn = { id: 'col1', cx: 0, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'К1', category: 'mutable' }
    const walls = buildWallsForJoin([], 10, [col])
    expect(walls.every(w => w.category === 'mutable')).toBe(true)
  })

  it('несколько колонн — id граней не пересекаются между колоннами', () => {
    const cols: RectColumn[] = [
      { id: 'colA', cx: 0, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'A' },
      { id: 'colB', cx: 1000, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'B' },
    ]
    const walls = buildWallsForJoin([], 10, cols)
    expect(walls).toHaveLength(8)
    const ids = new Set(walls.map(w => w.id))
    expect(ids.size).toBe(8)
  })

  it('линии и колонны вместе — стена реально стыкуется с гранью колонны через computeWallJoins', () => {
    const col: RectColumn = { id: 'col1', cx: 0, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'Колонна 1' }
    // Правая грань колонны — вертикальный отрезок x=15 (halfWidth=15px), от y=-15 до y=15.
    // Стена должна идти ПЕРПЕНДИКУЛЯРНО этой грани — горизонтально, наружу (+X) от (15,0).
    const wall = line({ id: 'W1', x1: 15, y1: 0, x2: 215, y2: 0 })
    const walls = buildWallsForJoin([wall], 10, [col])
    const res = computeWallJoins(walls)
    const jw = res.get('W1')!
    expect(jw.cap1).toBe(false) // T-стык распознан, торец не рисуется
  })
})

describe('computeJoinAngles — угол узла в градусах (см. KONSPEKT.md 11.07.2026)', () => {
  it('прямой угол (90°) — две перпендикулярные стены, стык конец=конец', () => {
    const A: WallForJoin = { id: 'A', x1: 0, y1: 0, x2: 200, y2: 0, halfPx: 10, createdIndex: 0 }
    const B: WallForJoin = { id: 'B', x1: 200, y1: 0, x2: 200, y2: 200, halfPx: 10, createdIndex: 1 }
    const angles = computeJoinAngles([A, B])
    expect(angles).toHaveLength(1)
    expect(angles[0].angleDeg).toBeCloseTo(90, 5)
    expect(angles[0].x).toBeCloseTo(200, 5)
    expect(angles[0].y).toBeCloseTo(0, 5)
  })

  it('коллинеарное продолжение — угол 180°', () => {
    const A: WallForJoin = { id: 'A', x1: 0, y1: 0, x2: 200, y2: 0, halfPx: 10, createdIndex: 0 }
    const B: WallForJoin = { id: 'B', x1: 200, y1: 0, x2: 400, y2: 0, halfPx: 10, createdIndex: 1 }
    const angles = computeJoinAngles([A, B])
    expect(angles).toHaveLength(1)
    expect(angles[0].angleDeg).toBeCloseTo(180, 5)
  })

  it('острый угол (45°) — воспроизводит форму узла из реального кейса (объект, 11.07.2026)', () => {
    // A — горизонтальная, B — диагональная под 45° от того же узла
    const A: WallForJoin = { id: 'A', x1: 0, y1: 0, x2: 300, y2: 0, halfPx: 12.5, createdIndex: 0 }
    const B: WallForJoin = {
      id: 'B', x1: 0, y1: 0,
      x2: -180 * Math.SQRT1_2, y2: 180 * Math.SQRT1_2,
      halfPx: 12.5, createdIndex: 1,
    }
    const angles = computeJoinAngles([A, B])
    expect(angles).toHaveLength(1)
    expect(angles[0].angleDeg).toBeCloseTo(135, 3) // угол между направлениями "наружу" от узла
  })

  it('разная толщина стен не влияет на угол — считается только по осям', () => {
    const A: WallForJoin = { id: 'A', x1: 0, y1: 0, x2: 200, y2: 0, halfPx: 6.25, createdIndex: 0 } // 125мм при 10мм/px
    const B: WallForJoin = { id: 'B', x1: 200, y1: 0, x2: 200, y2: 200, halfPx: 12.5, createdIndex: 1 } // 250мм
    const angles = computeJoinAngles([A, B])
    expect(angles).toHaveLength(1)
    expect(angles[0].angleDeg).toBeCloseTo(90, 5)
  })

  it('нет общей точки — угол не находится', () => {
    const A: WallForJoin = { id: 'A', x1: 0, y1: 0, x2: 200, y2: 0, halfPx: 10, createdIndex: 0 }
    const B: WallForJoin = { id: 'B', x1: 500, y1: 0, x2: 500, y2: 200, halfPx: 10, createdIndex: 1 }
    expect(computeJoinAngles([A, B])).toHaveLength(0)
  })

  it('грань колонны тоже участвует (buildWallsForJoin) — угол между стеной и гранью колонны', () => {
    const col: RectColumn = { id: 'col1', cx: 0, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'К1' }
    const wall = {
      id: 'W1', x1: 15, y1: 0, x2: 215, y2: 0,
      type: 'wall_new', lengthMm: 2000, label: 'W1',
      spec: { material: 'gkl', subtype: 'ps75' },
    } as PlanLine
    const walls = buildWallsForJoin([wall], 10, [col])
    const angles = computeJoinAngles(walls)
    // грань колонны, к которой примыкает стена перпендикулярно — угол 90°
    expect(angles.some(a => a.angleDeg > 89 && a.angleDeg < 91)).toBe(true)
  })
})
