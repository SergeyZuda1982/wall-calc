import { describe, it, expect } from 'vitest'
import { clipRectBySlopedTop, polygonArea, arcFromChordAndSagitta, arcLengthFromSagitta, sampleArcPoints } from '../geometry2d'

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
