import { describe, it, expect } from 'vitest'
import { computeWallJoins, buildWallsForJoin, computeJoinAngles, defaultCategory, rectColumnExposedFraction, roundColumnExposedFraction, columnExposedPerimeterFraction, type WallForJoin, type Pt } from '../wallJoin'
import { roundColumnPolygonPx } from '../columnStamp'
import type { PlanLine, RectColumn, RoundColumn, SpiralStaircase, StraightRunStaircase, StaircaseSegment } from '../../types'

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

  it('линия с дугой (sagittaMm) — тело дуги НЕ добавляется, но два тонких "уса" по касательным в концах добавляются', () => {
    const walls = buildWallsForJoin([line({ sagittaMm: 50 })], 10)
    expect(walls).toHaveLength(2)
    expect(walls.map(w => w.id).sort()).toEqual(['__arctan_L1_end', '__arctan_L1_start'])
    walls.forEach(w => {
      expect(w.halfPx).toBeCloseTo(0.01) // COLUMN_EDGE_HALF_PX — почти нулевая толщина
      expect(w.category).toBe(defaultCategory('wall_new'))
    })
  })

  it('"ус" в начале дуги содержит ТОЧНО точку (x1,y1) хорды — прямая стена может к ней приложиться', () => {
    const walls = buildWallsForJoin([line({ x1: 0, y1: 0, x2: 300, y2: 0, sagittaMm: 50 })], 10)
    const start = walls.find(w => w.id === '__arctan_L1_start')!
    const hitsChordStart = (w: WallForJoin) =>
      (Math.abs(w.x1 - 0) < 0.5 && Math.abs(w.y1 - 0) < 0.5) ||
      (Math.abs(w.x2 - 0) < 0.5 && Math.abs(w.y2 - 0) < 0.5)
    expect(hitsChordStart(start)).toBe(true)
  })

  it('"ус" в конце дуги содержит ТОЧНО точку (x2,y2) хорды', () => {
    const walls = buildWallsForJoin([line({ x1: 0, y1: 0, x2: 300, y2: 0, sagittaMm: 50 })], 10)
    const end = walls.find(w => w.id === '__arctan_L1_end')!
    const hitsChordEnd = (w: WallForJoin) =>
      (Math.abs(w.x1 - 300) < 0.5 && Math.abs(w.y1 - 0) < 0.5) ||
      (Math.abs(w.x2 - 300) < 0.5 && Math.abs(w.y2 - 0) < 0.5)
    expect(hitsChordEnd(end)).toBe(true)
  })

  it('дуга с ВЫРОЖДЕННОЙ (нулевой) стрелой — ведёт себя как обычная прямая стена (один WallForJoin, не "усы")', () => {
    const walls = buildWallsForJoin([line({ sagittaMm: 0 })], 10)
    expect(walls).toHaveLength(1)
    expect(walls[0].id).toBe('L1')
  })

  it('прямая стена, встречающая дугу РОВНО в её начале — получает T/L-стык (не плоский торец)', () => {
    // Прямая стена начинается точно в (0,0) — конце хорды дуговой стены — и
    // уходит в сторону, перпендикулярно касательной в этой точке.
    const arc = line({ id: 'ARC', x1: 0, y1: 0, x2: 300, y2: 0, sagittaMm: 50 })
    const straight = line({ id: 'STR', x1: 0, y1: 0, x2: 0, y2: -200 })
    const walls = buildWallsForJoin([arc, straight], 10)
    const res = computeWallJoins(walls)
    const jw = res.get('STR')!
    expect(jw.cap1).toBe(false) // стык распознан — торец не рисуется
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

describe('buildWallsForJoin — КРУГЛЫЕ колонны (11.09.2026, объект в Ростове, ∅550мм)', () => {
  function line(overrides: Partial<PlanLine> = {}): PlanLine {
    return {
      id: 'L1', x1: 0, y1: 0, x2: 300, y2: 0,
      type: 'wall_new', lengthMm: 3000, label: 'П-1',
      spec: { material: 'gkl', subtype: 'ps75' },
      ...overrides,
    } as PlanLine
  }

  it('круглая колонна добавляет 24 грани (аппроксимация многоугольником), капитальные, почти нулевой толщины', () => {
    const col: RoundColumn = { id: 'rc1', cx: 500, cy: 500, diameterMm: 300, label: 'Колонна 1' }
    const walls = buildWallsForJoin([], 10, [], [col])
    expect(walls).toHaveLength(24)
    walls.forEach(w => {
      expect(w.id).toContain('rc1')
      expect(w.category).toBe('capital')
      expect(w.halfPx).toBeCloseTo(0.01)
    })
  })

  it('без круглых колонн (дефолт []) — тот же результат, что и раньше (обратная совместимость)', () => {
    const walls = buildWallsForJoin([line()], 10)
    expect(walls).toHaveLength(1)
  })

  it('круглая колонна с явной category — пробрасывается как есть', () => {
    const col: RoundColumn = { id: 'rc1', cx: 0, cy: 0, diameterMm: 300, label: 'К1', category: 'mutable' }
    const walls = buildWallsForJoin([], 10, [], [col])
    expect(walls.every(w => w.category === 'mutable')).toBe(true)
  })

  it('несколько круглых колонн — id граней не пересекаются между колоннами', () => {
    const cols: RoundColumn[] = [
      { id: 'rcA', cx: 0, cy: 0, diameterMm: 300, label: 'A' },
      { id: 'rcB', cx: 1000, cy: 0, diameterMm: 300, label: 'B' },
    ]
    const walls = buildWallsForJoin([], 10, [], cols)
    expect(walls).toHaveLength(48)
    const ids = new Set(walls.map(w => w.id))
    expect(ids.size).toBe(48)
  })

  it('прямоугольная и круглая колонна одновременно — id граней не пересекаются между ними', () => {
    const rect: RectColumn = { id: 'rect1', cx: -500, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'Прям.' }
    const round: RoundColumn = { id: 'round1', cx: 500, cy: 0, diameterMm: 300, label: 'Кругл.' }
    const walls = buildWallsForJoin([], 10, [rect], [round])
    expect(walls).toHaveLength(4 + 24)
    const ids = new Set(walls.map(w => w.id))
    expect(ids.size).toBe(4 + 24)
  })

  it('линия и круглая колонна вместе — стена реально стыкуется через computeWallJoins (не проходит насквозь)', () => {
    const col: RoundColumn = { id: 'rc1', cx: 0, cy: 0, diameterMm: 300, label: 'Колонна 1' } // радиус 15px при scale=10
    // Стена должна упираться в СЕРЕДИНУ одного из 24 рёбер многоугольника
    // (не в вершину — вершина одновременно принадлежит двум рёбрам и там
    // T-стык не распознаётся, см. границы t в computeWallJoins), и идти от
    // неё наружу вдоль того же радиального направления.
    const poly = roundColumnPolygonPx(0, 0, 300, 10)
    const mid = { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[1].y) / 2 }
    const dirLen = Math.hypot(mid.x, mid.y)
    const ux = mid.x / dirLen, uy = mid.y / dirLen
    const wall = line({
      id: 'W1', x1: mid.x, y1: mid.y,
      x2: mid.x + 200 * ux, y2: mid.y + 200 * uy,
    })
    const walls = buildWallsForJoin([wall], 10, [], [col])
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

describe('computeWallJoins — реальный узел с объекта (KONSPEKT.md 12.07.2026, C-1/C-2, 123.49°)', () => {
  it('250мм + 125мм, обе стены стыкуются в END2, острый угол — без самопересечения полигона', () => {
    // Точные координаты из консольного дампа "∠ Углы" на реальном плане:
    // C-1 (широкая, block/250, halfPx=15.16) и C-2 (узкая, block/125,
    // halfPx=7.58) сходятся в одной точке, обе именно вторым концом (end2) —
    // это единственная комбинация из всех, что реально встретилась на
    // практике и до сих пор не была явно протестирована (все синтетические
    // тесты выше стыковали через end1-end1).
    const A: WallForJoin = { id: 'A', x1: 12748, y1: 9413, x2: 11187, y2: 9413, halfPx: 15.16, createdIndex: 0 }
    const B: WallForJoin = { id: 'B', x1: 10115, y1: 11034, x2: 11187, y2: 9413, halfPx: 7.58, createdIndex: 1 }
    const res = computeWallJoins([A, B])
    const ja = res.get('A')!, jb = res.get('B')!

    expect(ja.cap2).toBe(false) // join найден на этом конце
    expect(jb.cap2).toBe(false)
    // Общая митр-грань — ОБЯЗАНА совпадать у обеих стен побитово (иначе
    // между ними останется щель или нахлёст на плане).
    expect(ja.p2p).toEqual(jb.p2p)
    expect(ja.p2m).toEqual(jb.p2m)

    function segCross(a1: {x:number,y:number}, a2: {x:number,y:number}, b1: {x:number,y:number}, b2: {x:number,y:number}) {
      const cross = (o: {x:number,y:number}, a: {x:number,y:number}, b: {x:number,y:number}) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
      const d1 = cross(b1, b2, a1), d2 = cross(b1, b2, a2)
      const d3 = cross(a1, a2, b1), d4 = cross(a1, a2, b2)
      return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    }
    for (const jw of [ja, jb]) {
      expect(segCross(jw.p1p, jw.p2p, jw.p2m, jw.p1m)).toBe(false)
      expect(segCross(jw.p2p, jw.p2m, jw.p1m, jw.p1p)).toBe(false)
    }

    const angles = computeJoinAngles([A, B])
    expect(angles).toHaveLength(1)
    expect(angles[0].angleDeg).toBeCloseTo(123.49, 1)
  })
})

describe('columnExposedPerimeterFraction (15.09.2026 — по просьбе Сергея: отделка/чек-лист колонны только по открытой части периметра, закрытая внутри перегородок часть не считается)', () => {
  function wall(overrides: Partial<WallForJoin> = {}): WallForJoin {
    return { id: 'w', x1: 0, y1: 0, x2: 0, y2: 0, halfPx: 10, createdIndex: 0, ...overrides }
  }

  it('нет ни одной стены рядом — периметр полностью открыт (1)', () => {
    const edges: [Pt, Pt][] = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]]
    expect(columnExposedPerimeterFraction(edges, [])).toBe(1)
  })

  it('одна грань, стена касается её СЕРЕДИНЫ — закрыт участок ровно на толщину стены (2×halfPx)', () => {
    const edges: [Pt, Pt][] = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]]
    // конец стены ровно в точке (50,0) — середина грани; halfPx=10 → закрыто [40,60], открыто 80 из 100
    const otherWalls = [wall({ x1: 50, y1: 0, x2: 50, y2: -50, halfPx: 10 })]
    expect(columnExposedPerimeterFraction(edges, otherWalls)).toBeCloseTo(0.8, 6)
  })

  it('несколько граней — закрыта только ОДНА, остальные полностью открыты (взвешенное по длине)', () => {
    const edges: [Pt, Pt][] = [
      [{ x: 0, y: 0 }, { x: 100, y: 0 }],   // будет частично закрыта
      [{ x: 0, y: 100 }, { x: 100, y: 100 }], // полностью открыта
    ]
    const otherWalls = [wall({ x1: 50, y1: 0, x2: 50, y2: -50, halfPx: 10 })]
    // Грань 1: открыто 80 из 100. Грань 2: открыто 100 из 100. Итого 180/200 = 0.9
    expect(columnExposedPerimeterFraction(edges, otherWalls)).toBeCloseTo(0.9, 6)
  })

  it('стена подходит СОВСЕМ БЛИЗКО к вершине грани — всё равно засчитывается (нет исключения по краю, в отличие от T-стыка — см. комментарий у функции)', () => {
    const edges: [Pt, Pt][] = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]]
    const otherWalls = [wall({ x1: 1, y1: 0, x2: 1, y2: -50, halfPx: 10 })] // s=1, у самого края
    // Закрыто [0,11] (клэмп слева), открыто 89 из 100
    expect(columnExposedPerimeterFraction(edges, otherWalls)).toBeCloseTo(0.89, 6)
  })

  it('стена рядом, но не КАСАЕТСЯ оси грани (перпендикулярное расстояние больше её толщины) — не засчитывается', () => {
    const edges: [Pt, Pt][] = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]]
    const otherWalls = [wall({ x1: 50, y1: 500, x2: 50, y2: 600, halfPx: 10 })] // далеко по перпендикуляру
    expect(columnExposedPerimeterFraction(edges, otherWalls)).toBe(1)
  })

  it('две стены с ПЕРЕСЕКАЮЩИМИСЯ закрытыми интервалами на одной грани — объединяются, не вычитаются дважды', () => {
    const edges: [Pt, Pt][] = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]]
    // Обе стены закрывают пересекающиеся участки: [35,55] и [45,65] → объединение [35,65], закрыто 30, открыто 70
    const otherWalls = [
      wall({ id: 'w1', x1: 45, y1: 0, x2: 45, y2: -50, halfPx: 10 }),
      wall({ id: 'w2', x1: 55, y1: 0, x2: 55, y2: -50, halfPx: 10 }),
    ]
    expect(columnExposedPerimeterFraction(edges, otherWalls)).toBeCloseTo(0.7, 6)
  })

  it('стена перекрывает грань ПОЛНОСТЬЮ (толще самой грани) — открытая часть клэмпится в 0, не в отрицательное число', () => {
    const edges: [Pt, Pt][] = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]]
    const otherWalls = [wall({ x1: 50, y1: 0, x2: 50, y2: -50, halfPx: 1000 })]
    expect(columnExposedPerimeterFraction(edges, otherWalls)).toBe(0)
  })

  it('список граней пуст — по соглашению открыт полностью (1), не деление на ноль', () => {
    expect(columnExposedPerimeterFraction([], [])).toBe(1)
  })
})

describe('buildWallsForJoin — ЛЕСТНИЦЫ (20.09.2026, Фаза 4 объекта в Ростове, стыковка со стенами клетки)', () => {
  function line(overrides: Partial<PlanLine> = {}): PlanLine {
    return {
      id: 'L1', x1: 0, y1: 0, x2: 300, y2: 0,
      type: 'wall_new', lengthMm: 3000, label: 'П-1',
      spec: { material: 'gkl', subtype: 'ps75' },
      ...overrides,
    } as PlanLine
  }
  function staircase(overrides: Partial<SpiralStaircase> = {}): SpiralStaircase {
    return {
      id: 'st1', kind: 'spiral', cx: 0, cy: 0,
      innerRadiusMm: 200, outerRadiusMm: 150, // 150мм — та же величина, что и "диаметр 300" у круглой колонны в тестах выше
      startAngleRad: 0, totalAngleRad: Math.PI * 2,
      targetRiserMm: 170, treadThicknessMm: 30, label: 'Лестница',
      ...overrides,
    }
  }

  it('лестница добавляет 24 грани по ВНЕШНЕМУ контуру (аппроксимация многоугольником), капитальные, почти нулевой толщины', () => {
    const st = staircase({ outerRadiusMm: 150 }) // radius=150мм → diameterMm=300, тот же случай, что и у круглой колонны выше
    const walls = buildWallsForJoin([], 10, [], [], [st])
    expect(walls).toHaveLength(24)
    walls.forEach(w => {
      expect(w.id).toContain('st1')
      expect(w.category).toBe('capital')
      expect(w.halfPx).toBeCloseTo(0.01)
    })
  })

  it('innerRadiusMm НЕ участвует в стыковке — только outerRadiusMm (ступени/внутренняя стойка не примыкают к стене)', () => {
    const stSmallInner = staircase({ innerRadiusMm: 0, outerRadiusMm: 150 })
    const stBigInner = staircase({ innerRadiusMm: 140, outerRadiusMm: 150 })
    const wallsSmall = buildWallsForJoin([], 10, [], [], [stSmallInner])
    const wallsBig = buildWallsForJoin([], 10, [], [], [stBigInner])
    // Геометрия граней идентична независимо от innerRadiusMm
    expect(wallsSmall.map(w => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })))
      .toEqual(wallsBig.map(w => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })))
  })

  it('без лестниц (дефолт []) — тот же результат, что и раньше (обратная совместимость)', () => {
    const walls = buildWallsForJoin([line()], 10)
    expect(walls).toHaveLength(1)
  })

  it('лестница с явной category — пробрасывается как есть', () => {
    const st = staircase({ category: 'mutable' })
    const walls = buildWallsForJoin([], 10, [], [], [st])
    expect(walls.every(w => w.category === 'mutable')).toBe(true)
  })

  it('несколько лестниц — id граней не пересекаются между собой', () => {
    const sts = [staircase({ id: 'stA', cx: 0, cy: 0 }), staircase({ id: 'stB', cx: 1000, cy: 0 })]
    const walls = buildWallsForJoin([], 10, [], [], sts)
    expect(walls).toHaveLength(48)
    const ids = new Set(walls.map(w => w.id))
    expect(ids.size).toBe(48)
  })

  it('лестницы, круглые И прямоугольные колонны одновременно — id граней не пересекаются ни у одной пары', () => {
    const rect: RectColumn = { id: 'rect1', cx: -500, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'Прям.' }
    const round: RoundColumn = { id: 'round1', cx: 500, cy: 0, diameterMm: 300, label: 'Кругл.' }
    const st = staircase({ id: 'st1', cx: 0, cy: 1000 })
    const walls = buildWallsForJoin([], 10, [rect], [round], [st])
    expect(walls).toHaveLength(4 + 24 + 24)
    const ids = new Set(walls.map(w => w.id))
    expect(ids.size).toBe(4 + 24 + 24)
  })

  it('стена лестничной клетки реально стыкуется с внешним контуром лестницы через computeWallJoins (не проходит насквозь)', () => {
    const st = staircase({ outerRadiusMm: 150 }) // radius=150px при scale=10 (диаметр 300мм)
    // Та же логика, что и у теста с круглой колонной: стена должна упираться
    // в СЕРЕДИНУ одного из 24 рёбер многоугольника (не в вершину).
    const poly = roundColumnPolygonPx(0, 0, 300, 10)
    const mid = { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[1].y) / 2 }
    const dirLen = Math.hypot(mid.x, mid.y)
    const ux = mid.x / dirLen, uy = mid.y / dirLen
    const wall = line({
      id: 'W1', x1: mid.x, y1: mid.y,
      x2: mid.x + 200 * ux, y2: mid.y + 200 * uy,
    })
    const walls = buildWallsForJoin([wall], 10, [], [], [st])
    const res = computeWallJoins(walls)
    const jw = res.get('W1')!
    expect(jw.cap1).toBe(false) // T-стык распознан, торец не рисуется
  })
})

describe('buildWallsForJoin — МАРШЕВАЯ ЛЕСТНИЦА (23.09.2026, стыковка со стенами клетки)', () => {
  function line(overrides: Partial<PlanLine> = {}): PlanLine {
    return {
      id: 'L1', x1: 0, y1: 0, x2: 300, y2: 0,
      type: 'wall_new', lengthMm: 3000, label: 'П-1',
      spec: { material: 'gkl', subtype: 'ps75' },
      ...overrides,
    } as PlanLine
  }
  function flight(overrides: Partial<Extract<StaircaseSegment, { kind: 'flight' }>> = {}): StaircaseSegment {
    return { kind: 'flight', id: 'f1', x1: 0, y1: 0, x2: 0, y2: 300, widthMm: 1000, ...overrides }
  }
  function landing(overrides: Partial<Extract<StaircaseSegment, { kind: 'landing' }>> = {}): StaircaseSegment {
    return { kind: 'landing', id: 'l1', cx: 0, cy: 300, widthMm: 1000, depthMm: 1200, angleRad: 0, thicknessMm: 200, ...overrides }
  }
  function straightRun(overrides: Partial<StraightRunStaircase> = {}): StraightRunStaircase {
    return {
      id: 'sr1', kind: 'straight_run',
      segments: [flight()],
      targetRiserMm: 170, treadThicknessMm: 30, label: 'Лестница',
      ...overrides,
    }
  }

  it('один флайт добавляет 4 грани, капитальные, почти нулевой толщины', () => {
    const st = straightRun({ segments: [flight()] })
    const walls = buildWallsForJoin([], 10, [], [], [st])
    expect(walls).toHaveLength(4)
    walls.forEach(w => {
      expect(w.id).toContain('sr1')
      expect(w.category).toBe('capital')
      expect(w.halfPx).toBeCloseTo(0.01)
    })
  })

  it('флайт+площадка — 8 граней, id по сегментам не пересекаются', () => {
    const st = straightRun({ segments: [flight(), landing()] })
    const walls = buildWallsForJoin([], 10, [], [], [st])
    expect(walls).toHaveLength(8)
    const ids = new Set(walls.map(w => w.id))
    expect(ids.size).toBe(8)
  })

  it('без лестниц (дефолт []) — маршевая не ломает обратную совместимость', () => {
    const walls = buildWallsForJoin([line()], 10)
    expect(walls).toHaveLength(1)
  })

  it('несколько маршевых лестниц — id граней не пересекаются между собой', () => {
    const sts = [straightRun({ id: 'srA' }), straightRun({ id: 'srB', segments: [flight(), landing()] })]
    const walls = buildWallsForJoin([], 10, [], [], sts)
    expect(walls).toHaveLength(4 + 8)
    const ids = new Set(walls.map(w => w.id))
    expect(ids.size).toBe(4 + 8)
  })

  it('винтовая и маршевая одновременно — id граней не пересекаются ни у одной пары', () => {
    const spiral: SpiralStaircase = {
      id: 'sp1', kind: 'spiral', cx: 2000, cy: 2000,
      innerRadiusMm: 200, outerRadiusMm: 150,
      startAngleRad: 0, totalAngleRad: Math.PI * 2,
      targetRiserMm: 170, treadThicknessMm: 30, label: 'Винтовая',
    }
    const sr = straightRun({ segments: [flight(), landing()] })
    const walls = buildWallsForJoin([], 10, [], [], [spiral, sr])
    expect(walls).toHaveLength(24 + 8)
    const ids = new Set(walls.map(w => w.id))
    expect(ids.size).toBe(24 + 8)
  })

  it('стена клетки, упирающаяся в БОКОВОЙ край флайта, получает T-стык (не проходит насквозь)', () => {
    // Флайт: центральная линия (0,0)->(0,300), ширина 1000мм=100px при scale=10 →
    // боковая грань флайта проходит по x = -50 (левая сторона, px).
    const st = straightRun({ segments: [flight({ x1: 0, y1: 0, x2: 0, y2: 300, widthMm: 1000 })] })
    const wall = line({ id: 'W1', x1: -50, y1: 150, x2: -250, y2: 150 }) // упирается в середину боковой грани
    const walls = buildWallsForJoin([wall], 10, [], [], [st])
    const res = computeWallJoins(walls)
    const jw = res.get('W1')!
    expect(jw.cap1).toBe(false) // T-стык распознан, торец не рисуется
  })

  it('стена клетки, упирающаяся в край ПЛОЩАДКИ, получает T-стык', () => {
    const st = straightRun({ segments: [flight(), landing({ cx: 0, cy: 300, widthMm: 1000, depthMm: 1200, angleRad: 0 })] })
    // Площадка: центр (0,300)px, ширина 100px, глубина 120px, angleRad=0 →
    // как у RectColumn: правая грань по x=+50.
    const wall = line({ id: 'W2', x1: 50, y1: 300, x2: 250, y2: 300 })
    const walls = buildWallsForJoin([wall], 10, [], [], [st])
    const res = computeWallJoins(walls)
    const jw = res.get('W2')!
    expect(jw.cap1).toBe(false)
  })
})

describe('rectColumnExposedFraction / roundColumnExposedFraction (15.09.2026)', () => {
  function baseRect(overrides: Partial<RectColumn> = {}): RectColumn {
    return { id: 'rc1', cx: 0, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'К1', ...overrides }
  }
  function wallLine(overrides: Partial<PlanLine> = {}): PlanLine {
    return {
      id: 'w1', x1: 0, y1: 0, x2: 0, y2: 0,
      type: 'wall_existing', lengthMm: 1000, label: '',
      spec: { material: 'brick', subtype: '200' },
      ...overrides,
    } as PlanLine
  }

  it('прямоугольная колонна без соседних стен — открыта полностью (1)', () => {
    expect(rectColumnExposedFraction(baseRect(), [], 10)).toBe(1)
  })

  it('прямоугольная колонна 300×300 (scale=10 → грани по 30px) — одна грань частично закрыта стеной 200мм (halfPx=10) точно по её середине', () => {
    // Грань 1 (правая, x=15) идёт от (15,-15) до (15,15) — середина (15,0).
    const wall = wallLine({ x1: 35, y1: 0, x2: 15, y2: 0 })
    const frac = rectColumnExposedFraction(baseRect(), [wall], 10)
    // Грань 1: открыто 30-20=10 из 30. Остальные 3 грани по 30 открыты полностью.
    // Итого (10+30+30+30)/120 = 100/120 = 5/6
    expect(frac).toBeCloseTo(5 / 6, 6)
  })

  it('прямоугольная колонна, ОБСТРОЕННАЯ перегородками со всех 4 сторон (толстыми, шире каждой грани) — открытая доля близка к 0', () => {
    const walls = [
      wallLine({ id: 'wTop', x1: 0, y1: -15, x2: 0, y2: -100 }),
      wallLine({ id: 'wRight', x1: 15, y1: 0, x2: 100, y2: 0 }),
      wallLine({ id: 'wBottom', x1: 0, y1: 15, x2: 0, y2: 100 }),
      wallLine({ id: 'wLeft', x1: -15, y1: 0, x2: -100, y2: 0 }),
    ].map(w => ({ ...w, spec: { material: 'brick', subtype: '380' } })) // halfPx=19 > 15 (половина грани) — полное перекрытие
    const frac = rectColumnExposedFraction(baseRect(), walls, 10)
    expect(frac).toBeLessThan(0.01)
  })

  it('круглая колонна без соседних стен — открыта полностью (1)', () => {
    const rc: RoundColumn = { id: 'round1', cx: 0, cy: 0, diameterMm: 300, label: 'К1' }
    expect(roundColumnExposedFraction(rc, [], 10)).toBe(1)
  })

  it('круглая колонна с одной прилегающей стеной — открытая доля СТРОГО между 0 и 1 (частично закрыта)', () => {
    const rc: RoundColumn = { id: 'round1', cx: 0, cy: 0, diameterMm: 300, label: 'К1' }
    // Стена должна упираться в СЕРЕДИНУ одного из 24 рёбер многоугольника, а
    // не в вершину (та же оговорка, что и в arcEndTangents-тестах — вершина
    // на границе t=0/1 сразу двух граней, исключается из T-детекции).
    const poly = roundColumnPolygonPx(0, 0, 300, 10)
    const mid = { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[1].y) / 2 }
    const dirLen = Math.hypot(mid.x, mid.y)
    const ux = mid.x / dirLen, uy = mid.y / dirLen
    const wall = wallLine({ x1: mid.x + 20 * ux, y1: mid.y + 20 * uy, x2: mid.x, y2: mid.y, spec: { material: 'brick', subtype: '200' } })
    const frac = roundColumnExposedFraction(rc, [wall], 10)
    expect(frac).toBeGreaterThan(0)
    expect(frac).toBeLessThan(1)
  })
})
