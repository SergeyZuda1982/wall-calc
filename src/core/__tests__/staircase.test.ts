import { describe, it, expect } from 'vitest'
import {
  resolveStaircaseSteps,
  spiralStepAngles,
  spiralStepSectorPx,
  resolveStraightRunSteps,
  flightStepRectPx,
  mmToPx,
} from '../staircase'

describe('resolveStaircaseSteps', () => {
  it('делит перепад высоты на целое число ступеней ближайшее к целевому подступёнку', () => {
    // 3000мм при целевом 170мм → 17.6 → округление до 18 ступеней, факт. подступёнок 166.67
    const r = resolveStaircaseSteps(3000, 170)
    expect(r.stepCount).toBe(18)
    expect(r.actualRiserMm).toBeCloseTo(3000 / 18, 6)
  })

  it('ровно делится без остатка', () => {
    const r = resolveStaircaseSteps(3400, 170)
    expect(r.stepCount).toBe(20)
    expect(r.actualRiserMm).toBeCloseTo(170, 6)
  })

  it('минимум одна ступень даже при огромном целевом подступёнке', () => {
    const r = resolveStaircaseSteps(500, 10000)
    expect(r.stepCount).toBe(1)
    expect(r.actualRiserMm).toBeCloseTo(500, 6)
  })

  it('вырожденный случай — нулевая/отрицательная высота или подступёнок', () => {
    expect(resolveStaircaseSteps(0, 170)).toEqual({ stepCount: 0, actualRiserMm: 0 })
    expect(resolveStaircaseSteps(-100, 170)).toEqual({ stepCount: 0, actualRiserMm: 0 })
    expect(resolveStaircaseSteps(3000, 0)).toEqual({ stepCount: 0, actualRiserMm: 0 })
    expect(resolveStaircaseSteps(3000, -170)).toEqual({ stepCount: 0, actualRiserMm: 0 })
  })
})

describe('spiralStepAngles', () => {
  it('равномерно делит угловой диапазон на N шагов подряд без разрывов', () => {
    const ranges = spiralStepAngles(0, Math.PI * 2, 4)
    expect(ranges).toHaveLength(4)
    expect(ranges[0].angleFromRad).toBeCloseTo(0, 9)
    expect(ranges[0].angleToRad).toBeCloseTo(Math.PI / 2, 9)
    expect(ranges[3].angleToRad).toBeCloseTo(Math.PI * 2, 9)
    // Конец каждого шага стыкуется с началом следующего — без зазора/нахлёста
    for (let i = 0; i < ranges.length - 1; i++) {
      expect(ranges[i].angleToRad).toBeCloseTo(ranges[i + 1].angleFromRad, 9)
    }
  })

  it('поддерживает отрицательный (обратный) общий угол — обход против часовой', () => {
    const ranges = spiralStepAngles(0, -Math.PI, 2)
    expect(ranges[0].angleFromRad).toBeCloseTo(0, 9)
    expect(ranges[0].angleToRad).toBeCloseTo(-Math.PI / 2, 9)
    expect(ranges[1].angleToRad).toBeCloseTo(-Math.PI, 9)
  })

  it('stepCount 0 или отрицательный — пустой массив', () => {
    expect(spiralStepAngles(0, Math.PI, 0)).toEqual([])
    expect(spiralStepAngles(0, Math.PI, -3)).toEqual([])
  })
})

describe('spiralStepSectorPx', () => {
  it('кольцевой сектор: все внешние точки на outerRadius, все внутренние — на innerRadius', () => {
    const cx = 100, cy = 100, inner = 20, outer = 80
    const pts = spiralStepSectorPx(cx, cy, inner, outer, 0, Math.PI / 6, 4)
    // 5 точек внешней дуги + 5 точек внутренней дуги (arcSegments=4 → 5 узлов на дугу)
    expect(pts).toHaveLength(10)
    const distFromCenter = (p: { x: number; y: number }) => Math.hypot(p.x - cx, p.y - cy)
    for (let i = 0; i <= 4; i++) expect(distFromCenter(pts[i])).toBeCloseTo(outer, 6)
    for (let i = 5; i <= 9; i++) expect(distFromCenter(pts[i])).toBeCloseTo(inner, 6)
  })

  it('внутренняя дуга сходится в одну точку при innerRadius=0 (клин без центральной стойки)', () => {
    const pts = spiralStepSectorPx(0, 0, 0, 50, 0, Math.PI / 4, 4)
    // 5 точек внешней дуги + 1 точка центра
    expect(pts).toHaveLength(6)
    expect(pts[5]).toEqual({ x: 0, y: 0 })
  })

  it('первая и последняя точка внешней дуги соответствуют угловым границам', () => {
    const pts = spiralStepSectorPx(0, 0, 10, 100, Math.PI / 3, Math.PI / 2, 4)
    expect(pts[0].x).toBeCloseTo(100 * Math.cos(Math.PI / 3), 6)
    expect(pts[0].y).toBeCloseTo(100 * Math.sin(Math.PI / 3), 6)
    expect(pts[4].x).toBeCloseTo(100 * Math.cos(Math.PI / 2), 6)
    expect(pts[4].y).toBeCloseTo(100 * Math.sin(Math.PI / 2), 6)
  })
})

describe('mmToPx', () => {
  it('делит на масштаб мм/px, 0 при нулевом масштабе (защита от деления на 0)', () => {
    expect(mmToPx(1000, 10)).toBe(100)
    expect(mmToPx(1000, 0)).toBe(0)
  })
})

describe('resolveStraightRunSteps', () => {
  it('распределяет ступени пропорционально длине маршей, сумма точно равна общему числу', () => {
    // 3400мм / 170мм = 20 ступеней. Марши длиной 3000 и 1500 px (2:1)
    const r = resolveStraightRunSteps(3400, 170, [3000, 1500])
    expect(r.totalStepCount).toBe(20)
    expect(r.actualRiserMm).toBeCloseTo(170, 6)
    expect(r.stepsPerFlight.reduce((a, b) => a + b, 0)).toBe(20)
    // Первый марш вдвое длиннее — должен получить примерно вдвое больше ступеней
    expect(r.stepsPerFlight[0]).toBeGreaterThan(r.stepsPerFlight[1])
  })

  it('метод наибольших остатков — сумма точная даже когда деление не круглое', () => {
    // 10 ступеней на 3 марша равной длины — 10/3 не делится ровно
    const r = resolveStraightRunSteps(1700, 170, [1000, 1000, 1000])
    expect(r.stepsPerFlight.reduce((a, b) => a + b, 0)).toBe(10)
    expect(r.stepsPerFlight.every(n => n === 3 || n === 4)).toBe(true)
  })

  it('марш нулевой длины получает 0 ступеней, остальные — всё равно точную сумму', () => {
    const r = resolveStraightRunSteps(3400, 170, [3000, 0])
    expect(r.stepsPerFlight[1]).toBe(0)
    expect(r.stepsPerFlight[0]).toBe(20)
  })

  it('пустой список маршей или вырожденная высота/подступёнок — пустой/нулевой результат', () => {
    expect(resolveStraightRunSteps(3400, 170, [])).toEqual({ totalStepCount: 0, actualRiserMm: 0, stepsPerFlight: [] })
    const r = resolveStraightRunSteps(0, 170, [1000, 1000])
    expect(r.totalStepCount).toBe(0)
    expect(r.stepsPerFlight).toEqual([0, 0])
  })

  it('все марши нулевой суммарной длины — 0 ступеней каждому, без деления на 0', () => {
    const r = resolveStraightRunSteps(3400, 170, [0, 0])
    expect(r.stepsPerFlight).toEqual([0, 0])
  })
})

describe('flightStepRectPx', () => {
  it('ступень занимает свою долю длины марша, во всю ширину, симметрично осевой линии', () => {
    // Марш вдоль оси X от (0,0) до (1000,0), ширина 200px, 5 ступеней
    const rect = flightStepRectPx(0, 0, 1000, 0, 200, 2, 5) // 3-я ступень (index 2): [400..600]
    const xs = rect.map(p => p.x).sort((a, b) => a - b)
    const ys = rect.map(p => p.y).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(400, 6)
    expect(xs[xs.length - 1]).toBeCloseTo(600, 6)
    expect(ys[0]).toBeCloseTo(-100, 6)
    expect(ys[ys.length - 1]).toBeCloseTo(100, 6)
  })

  it('первая и последняя ступень стыкуются без зазора/нахлёста с соседними', () => {
    const stepCount = 4
    for (let i = 0; i < stepCount - 1; i++) {
      const a = flightStepRectPx(0, 0, 800, 0, 100, i, stepCount)
      const b = flightStepRectPx(0, 0, 800, 0, 100, i + 1, stepCount)
      // "верхний" край ступени i (большие x) совпадает с "нижним" краем ступени i+1
      const aMaxX = Math.max(...a.map(p => p.x))
      const bMinX = Math.min(...b.map(p => p.x))
      expect(aMaxX).toBeCloseTo(bMinX, 6)
    }
  })

  it('работает для марша под произвольным углом (не только вдоль осей)', () => {
    // Марш по диагонали (0,0)→(300,400), длина 500
    const rect = flightStepRectPx(0, 0, 300, 400, 100, 0, 5) // первая ступень: [0..100] вдоль марша
    // Все 4 точки должны быть на расстоянии ровно 50px (half-width) от осевой линии
    const dirX = 300 / 500, dirY = 400 / 500
    rect.forEach(p => {
      // Проекция на перпендикуляр = расстояние от оси
      const perpDist = Math.abs(p.x * (-dirY) + p.y * dirX)
      expect(perpDist).toBeCloseTo(50, 6)
    })
  })

  it('вырожденный марш (нулевая длина) не падает — возвращает точку вместо NaN', () => {
    const rect = flightStepRectPx(5, 5, 5, 5, 100, 0, 4)
    rect.forEach(p => { expect(p.x).toBe(5); expect(p.y).toBe(5) })
  })
})
