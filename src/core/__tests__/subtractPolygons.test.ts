import { describe, it, expect } from 'vitest'
import { subtractPolygons, polygonArea, pointInPolygon } from '../geometry2d'

// 23.07.2026 — фаза 2 плана "2D-упаковка с вырезами" (TASKS.md). Обёртка
// над polygon-clipping для вычитания проёмов из кандидата-листа.

describe('subtractPolygons — без пересечения', () => {
  it('вырез не задевает заготовку — результат = исходный полигон без изменений', () => {
    const subject = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 2500 }, { x: 0, y: 2500 }]
    const hole = [{ x: 2000, y: 0 }, { x: 2200, y: 0 }, { x: 2200, y: 500 }, { x: 2000, y: 500 }]
    const result = subtractPolygons(subject, [hole])
    expect(result).toHaveLength(1)
    expect(polygonArea(result[0])).toBeCloseTo(1200 * 2500, 3)
  })
})

describe('subtractPolygons — вырез задевает угол (Г-образный кусок)', () => {
  it('прямоугольный вырез из угла — площадь = исходная минус площадь пересечения', () => {
    const subject = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 2500 }, { x: 0, y: 2500 }]
    // Вырез в верхнем правом углу: 400×600
    const hole = [{ x: 800, y: 1900 }, { x: 1200, y: 1900 }, { x: 1200, y: 2500 }, { x: 800, y: 2500 }]
    const result = subtractPolygons(subject, [hole])
    expect(result).toHaveLength(1)
    expect(polygonArea(result[0])).toBeCloseTo(1200 * 2500 - 400 * 600, 3)
    // Точка в вырезанном углу больше НЕ внутри результата
    expect(pointInPolygon({ x: 1000, y: 2200 }, [result[0]])).toBe(false)
    // Точка в оставшемся материале — внутри
    expect(pointInPolygon({ x: 400, y: 1000 }, [result[0]])).toBe(true)
  })
})

describe('subtractPolygons — проём делит заготовку на 2 отдельных куска', () => {
  it('проём, пересекающий заготовку насквозь по всей высоте посередине — 2 отдельных полигона', () => {
    const subject = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 2500 }, { x: 0, y: 2500 }]
    const hole = [{ x: 500, y: -10 }, { x: 700, y: -10 }, { x: 700, y: 2510 }, { x: 500, y: 2510 }]
    const result = subtractPolygons(subject, [hole])
    expect(result).toHaveLength(2)
    const areas = result.map(polygonArea).sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(500 * 2500, 3)   // левый кусок 0..500
    expect(areas[1]).toBeCloseTo(500 * 2500, 3)   // правый кусок 700..1200
  })
})

describe('subtractPolygons — проём-остров (окно), полностью внутри заготовки', () => {
  it('дыра вшивается мостом в один простой контур — площадь = исходная минус площадь окна', () => {
    const subject = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 2500 }, { x: 0, y: 2500 }]
    const hole = [{ x: 400, y: 1000 }, { x: 800, y: 1000 }, { x: 800, y: 1400 }, { x: 400, y: 1400 }]
    const result = subtractPolygons(subject, [hole])
    expect(result).toHaveLength(1) // не распадается — дыра пришита мостом
    expect(polygonArea(result[0])).toBeCloseTo(1200 * 2500 - 400 * 400, 3)
    // Точка внутри окна — снаружи материала
    expect(pointInPolygon({ x: 600, y: 1200 }, [result[0]])).toBe(false)
    // Точка вокруг окна (материал) — внутри
    expect(pointInPolygon({ x: 100, y: 100 }, [result[0]])).toBe(true)
    expect(pointInPolygon({ x: 1100, y: 2400 }, [result[0]])).toBe(true)
  })
})

describe('subtractPolygons — несколько проёмов сразу', () => {
  it('вычитает объединение всех переданных вырезов за один вызов', () => {
    const subject = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 2500 }, { x: 0, y: 2500 }]
    const holeA = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }]
    const holeB = [{ x: 1000, y: 2300 }, { x: 1200, y: 2300 }, { x: 1200, y: 2500 }, { x: 1000, y: 2500 }]
    const result = subtractPolygons(subject, [holeA, holeB])
    expect(result).toHaveLength(1)
    expect(polygonArea(result[0])).toBeCloseTo(1200 * 2500 - 200 * 200 - 200 * 200, 3)
  })
})
