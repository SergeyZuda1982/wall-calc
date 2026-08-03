import { describe, it, expect } from 'vitest'
import {
  openingLocalPolygon,
  openingWorldPolygon,
  openingShapePolygon,
  polygonArea,
  pointInPolygon,
  type OpeningShape,
} from '../geometry2d'

// 23.07.2026 — фундамент под полноценную 2D-упаковку листов ГКЛ с
// произвольными вырезами (см. TASKS.md, план по фазам). Проём по умолчанию
// прямоугольный (обратная совместимость); OpeningShape нужен только когда
// вырез отличается от прямоугольника — косой срез, радиус (арка/скруглённый
// угол) или их смесь на одном контуре.

describe('openingLocalPolygon — без shape (прямоугольник, обратная совместимость)', () => {
  it('возвращает прямоугольник bounding box, без shape', () => {
    const poly = openingLocalPolygon(1000, 2100)
    expect(poly).toEqual([
      { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 2100 }, { x: 0, y: 2100 },
    ])
    expect(polygonArea(poly)).toBe(1000 * 2100)
  })
})

describe('openingShapePolygon — косой срез угла (все рёбра прямые)', () => {
  it('срезанный верхний правый угол — площадь меньше прямоугольника на площадь треугольника среза', () => {
    // Прямоугольник 1000×2100 со срезанным верхним правым углом на 200×300
    const shape: OpeningShape = {
      points: [
        { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1800 }, { x: 800, y: 2100 }, { x: 0, y: 2100 },
      ],
    }
    const poly = openingShapePolygon(shape)
    expect(poly).toHaveLength(5) // рёбра все прямые — вершины не дискретизируются
    const fullRectArea = 1000 * 2100
    const cutTriangleArea = (200 * 300) / 2
    expect(polygonArea(poly)).toBeCloseTo(fullRectArea - cutTriangleArea, 6)
  })
})

describe('openingShapePolygon — радиусный вырез (дуга по хорде и стреле)', () => {
  it('дуга (положительная или отрицательная стрела) меняет площадь по сравнению с прямой хордой — выбираем знак, дающий выпуклую наружу арку, и проверяем, что она РЕАЛЬНО добавляет материал', () => {
    const straightShape: OpeningShape = {
      points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1800 }, { x: 500, y: 2100 }, { x: 0, y: 1800 }],
    }
    const straightArea = polygonArea(openingShapePolygon(straightShape))
    // Знак стрелы, дающей выпуклую (площадь растёт) арку, зависит от направления
    // обхода ребра — не гадаем, а берём тот из двух знаков, что увеличивает площадь.
    const withSagitta = (sagitta: number) => polygonArea(openingShapePolygon({
      ...straightShape,
      edges: [{}, {}, { sagitta }, {}, {}],
    }))
    const areaPlus = withSagitta(250)
    const areaMinus = withSagitta(-250)
    const outwardArea = Math.max(areaPlus, areaMinus)
    expect(outwardArea).toBeGreaterThan(straightArea)
    // И противоположный знак — вогнутая внутрь арка — площадь МЕНЬШЕ прямой хорды.
    const inwardArea = Math.min(areaPlus, areaMinus)
    expect(inwardArea).toBeLessThan(straightArea)
  })

  it('нулевая/не заданная стрела ребра — сторона остаётся прямой (не добавляет точек)', () => {
    const shape: OpeningShape = {
      points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 2100 }, { x: 0, y: 2100 }],
      edges: [{ sagitta: 0 }, undefined as any, {}, {}],
    }
    const poly = openingShapePolygon(shape)
    expect(poly).toHaveLength(4)
  })
})

describe('openingShapePolygon — смешанный контур (косой + радиусный на одном вырезе)', () => {
  it('строится без ошибок, замкнутый контур содержит все прямые вершины плюс точки дуги', () => {
    const shape: OpeningShape = {
      points: [
        { x: 0, y: 0 },       // низ-лево (прямой)
        { x: 1000, y: 0 },    // низ-право (прямой)
        { x: 1000, y: 1700 }, // верх-право ДО среза (прямой)
        { x: 800, y: 2000 },  // срезанный угол (прямой, косой срез)
        { x: 200, y: 2000 },  // начало арки сверху (прямой)
        { x: 0, y: 1700 },    // конец арки — низ-лево-верх (прямой)
      ],
      edges: [{}, {}, {}, {}, { sagitta: 150 }, {}], // арка между точками 4 и 5
    }
    expect(() => openingShapePolygon(shape)).not.toThrow()
    const poly = openingShapePolygon(shape)
    expect(poly.length).toBeGreaterThan(shape.points.length) // дуга добавила промежуточные точки
    // Все 6 исходных прямых вершин должны присутствовать в результате как есть
    for (const p of shape.points) {
      expect(poly.some(q => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9)).toBe(true)
    }
  })
})

describe('openingWorldPolygon — сдвиг в мировые координаты стены', () => {
  it('без shape — прямоугольник, сдвинутый на (pos, sillHeight)', () => {
    const poly = openingWorldPolygon(500, 300, 1000, 2100)
    expect(poly).toEqual([
      { x: 500, y: 300 }, { x: 1500, y: 300 }, { x: 1500, y: 2400 }, { x: 500, y: 2400 },
    ])
  })

  it('точка внутри исходного локального проёма остаётся внутри мирового контура после сдвига', () => {
    const shape: OpeningShape = {
      points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1800 }, { x: 500, y: 2100 }, { x: 0, y: 1800 }],
      edges: [{}, {}, {}, { sagitta: 150 }, {}],
    }
    const world = openingWorldPolygon(500, 300, 1000, 2100, shape)
    expect(pointInPolygon({ x: 500 + 500, y: 300 + 900 }, [world])).toBe(true) // центр проёма
    expect(pointInPolygon({ x: 500 - 10, y: 300 + 900 }, [world])).toBe(false) // левее проёма — снаружи
  })
})
