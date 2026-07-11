import { describe, it, expect } from 'vitest'
import { clipRectBySlopedTop, polygonArea, polygonPerimeter, polygonSides, insideSegments, pointInPolygon, arcFromChordAndSagitta, arcLengthFromSagitta, sampleArcPoints, sagittaFromRadius, infiniteLineIntersection, openingOffsetFromClick } from '../geometry2d'

describe('polygonArea', () => {
  it('площадь прямоугольника', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(50)
  })

  it('площадь треугольника', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }])).toBe(25)
  })

  it('меньше 3 точек — площадь 0', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0)
  })
})

describe('polygonPerimeter', () => {
  it('периметр прямоугольника', () => {
    expect(polygonPerimeter([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(30)
  })

  it('периметр треугольника 3-4-5', () => {
    expect(polygonPerimeter([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }])).toBeCloseTo(12, 6)
  })

  it('меньше 2 точек — периметр 0', () => {
    expect(polygonPerimeter([{ x: 0, y: 0 }])).toBe(0)
  })

  it('порядок обхода (по часовой/против) не влияет на результат', () => {
    const cw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]
    const ccw = [...cw].reverse()
    expect(polygonPerimeter(ccw)).toBe(polygonPerimeter(cw))
  })
})

describe('polygonSides', () => {
  it('прямоугольник даёт 4 стороны в порядке обхода с правильной длиной', () => {
    const sides = polygonSides([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])
    expect(sides).toHaveLength(4)
    expect(sides.map(s => s.lengthMm)).toEqual([10, 5, 10, 5])
    expect(sides.map(s => s.index)).toEqual([0, 1, 2, 3])
  })

  it('последняя сторона замыкает контур на первую точку', () => {
    const sides = polygonSides([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }])
    expect(sides).toHaveLength(3)
    expect(sides[2].start).toEqual({ x: 0, y: 5 })
    expect(sides[2].end).toEqual({ x: 0, y: 0 })
  })

  it('стороны короче 1мм пропускаются (дубль точки при обводке)', () => {
    const sides = polygonSides([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 10, y: 0 }, { x: 0, y: 5 }])
    expect(sides).toHaveLength(3)
  })

  it('меньше 2 точек — пустой список', () => {
    expect(polygonSides([{ x: 0, y: 0 }])).toEqual([])
    expect(polygonSides([])).toEqual([])
  })
})

describe('scanlineCrossings / insideSegments / pointInPolygon', () => {
  const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]

  it('прямоугольник: одна горизонталь даёт один отрезок во всю ширину', () => {
    expect(insideSegments([rect], 2, 'y')).toEqual([[0, 10]])
  })

  it('прямоугольник: вертикаль даёт один отрезок во всю высоту', () => {
    expect(insideSegments([rect], 5, 'x')).toEqual([[0, 5]])
  })

  it('линия по касательной к вершине не даёт лишних пересечений', () => {
    // y=5 — верхняя грань, полуоткрытый интервал не должен её задеть
    expect(insideSegments([rect], 5, 'y')).toEqual([])
  })

  // L-образный контур (объединение двух прямоугольников без общей перегородки):
  // большой 10×10 с вырезанным углом 5×5 сверху справа
  const lShape = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 },
    { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 },
  ]

  it('L-образный контур: низкая горизонталь — один отрезок во всю ширину', () => {
    expect(insideSegments([lShape], 2, 'y')).toEqual([[0, 10]])
  })

  it('L-образный контур: высокая горизонталь — отрезок только по узкой части', () => {
    expect(insideSegments([lShape], 8, 'y')).toEqual([[0, 5]])
  })

  it('L-образный контур: точка в вырезанном углу — снаружи', () => {
    expect(pointInPolygon({ x: 8, y: 8 }, [lShape])).toBe(false)
  })

  it('L-образный контур: точка в основной части — внутри', () => {
    expect(pointInPolygon({ x: 2, y: 2 }, [lShape])).toBe(true)
  })

  // Прямоугольник 10×10 с квадратной дыркой 2×2 по центру (шахта/короб)
  const hole = [{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }]
  const withHole = [rect.map(p => ({ x: p.x, y: p.y * 2 })), hole] // растянем rect до 10×10

  it('контур с дыркой: горизонталь через дырку даёт два отрезка', () => {
    expect(insideSegments(withHole, 5, 'y')).toEqual([[0, 4], [6, 10]])
  })

  it('контур с дыркой: точка внутри дырки — снаружи материала', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, withHole)).toBe(false)
  })

  it('контур с дыркой: точка рядом с дыркой — внутри материала', () => {
    expect(pointInPolygon({ x: 1, y: 1 }, withHole)).toBe(true)
  })
})

describe('arcFromChordAndSagitta', () => {
  it('полуокружность: L=H=5 → R=5, центр на середине хорды, sweep=π', () => {
    // Хорда (-5,0)-(5,0), стрела +5 (выгиб влево от направления x1→x2, т.е. вниз на экране)
    const arc = arcFromChordAndSagitta(-5, 0, 5, 0, 5)
    expect(arc).not.toBeNull()
    expect(arc!.radius).toBeCloseTo(5, 6)
    expect(arc!.cx).toBeCloseTo(0, 6)
    expect(arc!.cy).toBeCloseTo(0, 6)
    expect(arc!.sweep).toBeCloseTo(Math.PI, 6)
    expect(arc!.arcLength).toBeCloseTo(5 * Math.PI, 6)
  })

  it('четверть окружности: R=10 → L=R·sin45°, H=R·(1-cos45°), sweep=π/2', () => {
    const R = 10
    const L = R * Math.sin(Math.PI / 4)
    const H = R * (1 - Math.cos(Math.PI / 4))
    const arc = arcFromChordAndSagitta(-L, 0, L, 0, H)
    expect(arc).not.toBeNull()
    expect(arc!.radius).toBeCloseTo(R, 4)
    expect(arc!.sweep).toBeCloseTo(Math.PI / 2, 4)
    expect(arc!.arcLength).toBeCloseTo(R * Math.PI / 2, 4)
  })

  it('sagitta=0 — дуги нет (null), линия прямая', () => {
    expect(arcFromChordAndSagitta(0, 0, 10, 0, 0)).toBeNull()
  })

  it('вырожденная хорда (совпадающие точки) — null', () => {
    expect(arcFromChordAndSagitta(5, 5, 5, 5, 3)).toBeNull()
  })

  it('знак sagitta не меняет радиус/длину дуги, только сторону выгиба (центр)', () => {
    const pos = arcFromChordAndSagitta(0, 0, 10, 0, 4)!
    const neg = arcFromChordAndSagitta(0, 0, 10, 0, -4)!
    expect(pos.radius).toBeCloseTo(neg.radius, 6)
    expect(pos.arcLength).toBeCloseTo(neg.arcLength, 6)
    // Центры — по разные стороны хорды (зеркально)
    expect(pos.cy).toBeCloseTo(-neg.cy, 6)
  })

  it('R соответствует формуле R=(L²+H²)/2H для случайных значений', () => {
    const cases: Array<[number, number]> = [[100, 20], [300, 5], [50, 80]]
    for (const [chord, H] of cases) {
      const arc = arcFromChordAndSagitta(0, 0, chord, 0, H)!
      const L = chord / 2
      const expectedR = (L * L + H * H) / (2 * H)
      expect(arc.radius).toBeCloseTo(expectedR, 6)
    }
  })

  it('глубокая дуга (H > L, "больше полуокружности") — sweep > π', () => {
    // H=80 намного больше половины хорды 50 (L=25) — глубокая дуга
    const arc = arcFromChordAndSagitta(0, 0, 50, 0, 80)!
    expect(arc.sweep).toBeGreaterThan(Math.PI)
  })

  it('каждая точка дуги реально на расстоянии radius от центра (sampleArcPoints)', () => {
    const arc = arcFromChordAndSagitta(10, 20, 130, 45, 37)!
    const pts = sampleArcPoints(arc, 16)
    for (const p of pts) {
      const d = Math.hypot(p.x - arc.cx, p.y - arc.cy)
      expect(d).toBeCloseTo(arc.radius, 4)
    }
    // Первая и последняя точки — это сами концы хорды
    expect(pts[0].x).toBeCloseTo(10, 3)
    expect(pts[0].y).toBeCloseTo(20, 3)
    expect(pts[pts.length - 1].x).toBeCloseTo(130, 3)
    expect(pts[pts.length - 1].y).toBeCloseTo(45, 3)
  })
})

describe('sagittaFromRadius', () => {
  it('round-trip: H → R → H (пологая дуга)', () => {
    const chord = 2000, H = 150
    const arc = arcFromChordAndSagitta(0, 0, chord, 0, H)!
    const hBack = sagittaFromRadius(chord, arc.radius, false)
    expect(hBack).toBeCloseTo(H, 4)
  })

  it('round-trip: H → R → H (глубокая дуга)', () => {
    const chord = 500, H = 400  // H > L(=250) — уже глубокая дуга
    const arc = arcFromChordAndSagitta(0, 0, chord, 0, H)!
    const hBack = sagittaFromRadius(chord, arc.radius, true)
    expect(hBack).toBeCloseTo(H, 4)
  })

  it('R = L (половина хорды) — ровно полуокружность, H = R = L', () => {
    const chord = 1000  // L = 500
    const h = sagittaFromRadius(chord, 500, false)
    expect(h).toBeCloseTo(500, 6)
  })

  it('R < L — геометрически невозможно, null', () => {
    expect(sagittaFromRadius(1000, 400, false)).toBeNull()  // L=500 > R=400
  })

  it('одна и та же хорда, два решения (пологое и глубокое) при одном R', () => {
    const chord = 800, R = 1000  // L=400 < R — оба решения существуют
    const shallow = sagittaFromRadius(chord, R, false)!
    const deep = sagittaFromRadius(chord, R, true)!
    expect(shallow).toBeLessThan(deep)
    // Оба должны реально давать радиус R при подстановке обратно
    expect(arcFromChordAndSagitta(0, 0, chord, 0, shallow)!.radius).toBeCloseTo(R, 4)
    expect(arcFromChordAndSagitta(0, 0, chord, 0, deep)!.radius).toBeCloseTo(R, 4)
  })

  it('главный практический случай: одинаковый R при разной хорде даёт РАЗНУЮ H (не одну и ту же)', () => {
    // Ровно та проблема, из-за которой добавили эту функцию: раньше
    // ставили одну и ту же H на разных пролётах, что давало разный R.
    // Правильный путь — наоборот: один R → на каждом пролёте своя H.
    const R = 2000
    const h1 = sagittaFromRadius(3000, R, false)!  // пролёт 3000
    const h2 = sagittaFromRadius(4000, R, false)!  // пролёт 4000
    expect(h1).not.toBeCloseTo(h2, 0)
    expect(arcFromChordAndSagitta(0, 0, 3000, 0, h1)!.radius).toBeCloseTo(R, 3)
    expect(arcFromChordAndSagitta(0, 0, 4000, 0, h2)!.radius).toBeCloseTo(R, 3)
  })
})

describe('arcLengthFromSagitta', () => {

  it('sagitta=0 — просто длина хорды', () => {
    expect(arcLengthFromSagitta(1000, 0)).toBe(1000)
  })

  it('совпадает с arcFromChordAndSagitta(...).arcLength', () => {
    const len = arcLengthFromSagitta(2000, 300)
    const arc = arcFromChordAndSagitta(0, 0, 2000, 0, 300)!
    expect(len).toBeCloseTo(arc.arcLength, 6)
  })

  it('длина дуги всегда больше длины хорды (для любой ненулевой стрелы)', () => {
    expect(arcLengthFromSagitta(1000, 50)).toBeGreaterThan(1000)
    expect(arcLengthFromSagitta(1000, 900)).toBeGreaterThan(1000)
  })
})

describe('infiniteLineIntersection', () => {
  it('две перпендикулярные линии — обычное пересечение', () => {
    const p = infiniteLineIntersection(0, 0, 10, 0, 5, -5, 5, 5)
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(5, 6)
    expect(p!.y).toBeCloseTo(0, 6)
  })

  it('точка пересечения ЗА пределами обоих отрезков — всё равно находится (это и есть смысл "продлить")', () => {
    // Отрезок 1: (0,0)-(1,0). Отрезок 2: (5,-1)-(5,1). Пересечение при x=5 — далеко за концом первого отрезка.
    const p = infiniteLineIntersection(0, 0, 1, 0, 5, -1, 5, 1)
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(5, 6)
    expect(p!.y).toBeCloseTo(0, 6)
  })

  it('параллельные линии — null', () => {
    expect(infiniteLineIntersection(0, 0, 10, 0, 0, 5, 10, 5)).toBeNull()
  })

  it('совпадающие линии — null (нет однозначной точки)', () => {
    expect(infiniteLineIntersection(0, 0, 10, 0, 2, 0, 8, 0)).toBeNull()
  })

  it('наклонные линии под произвольным углом', () => {
    // y = x  и  y = -x + 10  → пересечение в (5,5)
    const p = infiniteLineIntersection(0, 0, 1, 1, 0, 10, 10, 0)
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(5, 6)
    expect(p!.y).toBeCloseTo(5, 6)
  })
})

describe('clipRectBySlopedTop', () => {

  it('линия целиком выше прямоугольника — реза нет, прямоугольник как есть', () => {
    const poly = clipRectBySlopedTop(0, 100, 0, 50, 200, 200)
    expect(polygonArea(poly)).toBeCloseTo(100 * 50, 6)
  })

  it('линия целиком ниже прямоугольника — материала нет', () => {
    const poly = clipRectBySlopedTop(0, 100, 50, 100, 10, 10)
    expect(poly.length).toBe(0)
  })

  it('линия ровно совпадает с верхней гранью — прямоугольник без изменений', () => {
    const poly = clipRectBySlopedTop(0, 100, 0, 50, 50, 50)
    expect(polygonArea(poly)).toBeCloseTo(100 * 50, 6)
  })

  it('трапеция — линия входит слева, выходит через верхнюю грань справа', () => {
    // Прямоугольник 100×50, линия идёт от y=30 (x=0) до y=70 (x=100).
    // Пересекает верхнюю грань (y=50) при x=50 (лин. интерполяция 30→70).
    // Слева от x=50 материал ограничен линией (трапеция высотой 30..50),
    // справа от x=50 линия уже выше прямоугольника — доступна полная высота 50.
    const poly = clipRectBySlopedTop(0, 100, 0, 50, 30, 70)
    const leftPart = ((30 + 50) / 2) * 50   // трапеция 0..50 по x, высота 30→50
    const rightPart = 50 * 50               // прямоугольник 50..100 по x, высота 50
    expect(polygonArea(poly)).toBeCloseTo(leftPart + rightPart, 3)
  })

  it('треугольник — линия входит в левый нижний угол', () => {
    // topAtX1=0 (линия ровно на уровне низа слева), topAtX2=50 (поднимается
    // к верху справа, ровно совпадая с верхом прямоугольника y2=50).
    const poly = clipRectBySlopedTop(0, 100, 0, 50, 0, 50)
    // Это прямой треугольник: (0,0)-(100,0)-(100,50)
    const expectedArea = (100 * 50) / 2
    expect(polygonArea(poly)).toBeCloseTo(expectedArea, 3)
  })

  it('площадь монотонно растёт по мере роста высоты линии', () => {
    const areas = [0, 20, 40, 60, 80, 100].map(topH => {
      const poly = clipRectBySlopedTop(0, 100, 0, 50, topH, topH)
      return polygonArea(poly)
    })
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i]).toBeGreaterThanOrEqual(areas[i - 1])
    }
  })

  it('вырожденный случай x2<=x1 — пустой массив, не падает', () => {
    expect(clipRectBySlopedTop(10, 10, 0, 50, 30, 70)).toEqual([])
    expect(clipRectBySlopedTop(20, 10, 0, 50, 30, 70)).toEqual([])
  })
})

describe('openingOffsetFromClick', () => {
  // Горизонтальная линия 0..1000px, 1000px == 5000мм (масштаб не участвует
  // в самой функции — она работает в px по осям x1..x2, мм только у длины)
  const x1 = 0, y1 = 0, x2 = 1000, y2 = 0, lengthMm = 5000

  it('клик точно в середине линии — проём центрируется по клику', () => {
    // клик в px=500 (середина) → 2500мм от начала; проём 900мм → офсет 2500-450=2050
    const offset = openingOffsetFromClick(x1, y1, x2, y2, lengthMm, 500, 0, 900)
    expect(offset).toBeCloseTo(2050)
  })

  it('клик рядом с началом линии — офсет прижимается к 0, не уходит в минус', () => {
    // клик в px=10 → 50мм от начала; проём 900мм центрированный ушёл бы в минус — clamp к 0
    const offset = openingOffsetFromClick(x1, y1, x2, y2, lengthMm, 10, 0, 900)
    expect(offset).toBe(0)
  })

  it('клик рядом с концом линии — офсет прижимается к (длина - ширина), не выходит за стену', () => {
    const offset = openingOffsetFromClick(x1, y1, x2, y2, lengthMm, 995, 0, 900)
    expect(offset).toBeCloseTo(lengthMm - 900)
  })

  it('клик НЕ на самой линии (сбоку) — всё равно проецируется на её ось', () => {
    // клик в (500, 300) — далеко в стороне по Y, но проекция на ось X та же (500px)
    const offset = openingOffsetFromClick(x1, y1, x2, y2, lengthMm, 500, 300, 900)
    expect(offset).toBeCloseTo(2050)
  })

  it('не зависит от направления линии — та же точка на развёрнутой линии (x1,x2 поменяны местами) даёт симметричный офсет', () => {
    // та же физическая точка проёма, но линия начерчена с другого конца —
    // офсет должен получиться таким, чтобы проём оказался в том же месте
    const offsetReversed = openingOffsetFromClick(x2, y2, x1, y1, lengthMm, 500, 0, 900)
    // от конца (x2=1000) до клика (500) — тоже 500px = 2500мм, симметрично середине
    expect(offsetReversed).toBeCloseTo(2050)
  })

  it('ширина проёма больше самой линии — null (стена слишком короткая)', () => {
    expect(openingOffsetFromClick(x1, y1, x2, y2, lengthMm, 500, 0, 6000)).toBeNull()
  })

  it('вырожденная линия (нулевой длины в px) — null, не делится на 0', () => {
    expect(openingOffsetFromClick(100, 100, 100, 100, 5000, 100, 100, 900)).toBeNull()
  })
})
