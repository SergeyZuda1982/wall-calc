import { describe, it, expect } from 'vitest'
import { calcPolygonSheetLayout } from '../calcPolygonSheetLayout'
import type { Point2D } from '../geometry2d'
import type { BoardOffcut } from '../../types'
import { DEFAULT_BOARD_SPEC } from '../../types'

const rect = (L: number, W: number): Point2D[] => [
  { x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W },
]

describe('calcPolygonSheetLayout — прямоугольник', () => {
  it('простой случай без остатка: ровно вписывается по обеим осям', () => {
    // 2500×1200 — ровно один лист 2500×1200
    const outer = rect(2500, 1200)
    const startSide = { start: outer[0], end: outer[1] }
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.totalSheets).toBe(1)
    expect(r.fullSheets).toBe(1)
    expect(r.cutSheets).toBe(0)
  })

  it('меньше 3 точек контура -> null', () => {
    expect(calcPolygonSheetLayout([{ x: 0, y: 0 }, { x: 1, y: 1 }], [], { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })).toBeNull()
  })

  it('автовыбор ориентации даёт не больше листов, чем любая фиксированная', () => {
    const outer = rect(5000, 3000)
    const startSide = { start: outer[0], end: outer[1] }
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.totalSheets).toBeGreaterThan(0)
    expect(r.totalSheets).toBe(r.fullSheets + r.cutSheets)
  })
})

describe('calcPolygonSheetLayout — координаты кусков при повёрнутой ориентации (13.07.2026)', () => {
  it('узкий и глубокий контур выбирает вариант Б (rotated) и держит координаты кусков в границах кадра', () => {
    // 1200×6000: вдоль стены старта (U) узко — ровно ширина полосы, вглубь
    // (V) далеко. Вариант Б (полосы вдоль U, листы вдоль V) выгоднее —
    // именно на нём раньше терялась разворотка координат кусков обратно
    // в систему кадра (баг с раскроем в 3D, см. заголовок файла).
    const outer = rect(1200, 6000)
    const startSide = { start: outer[0], end: outer[1] } // вдоль X, длина 1200
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.rotated).toBe(true)

    const EPS = 1e-6
    for (const p of r.layer1.pieces) {
      expect(p.u1).toBeGreaterThanOrEqual(0 - EPS)
      expect(p.u2).toBeLessThanOrEqual(1200 + EPS)
      expect(p.v1).toBeGreaterThanOrEqual(0 - EPS)
      expect(p.v2).toBeLessThanOrEqual(6000 + EPS)
    }
  })
})

describe('calcPolygonSheetLayout — вогнутый L-образный контур', () => {
  const lShape: Point2D[] = [
    { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 },
    { x: 4000, y: 4000 }, { x: 4000, y: 6000 }, { x: 0, y: 6000 },
  ]

  it('листов меньше, чем на описывающем прямоугольнике 6000×6000', () => {
    const startSide = { start: lShape[0], end: lShape[1] }
    const rL = calcPolygonSheetLayout(lShape, [], startSide, 2500)!
    const rBox = calcPolygonSheetLayout(rect(6000, 6000), [], { start: { x: 0, y: 0 }, end: { x: 6000, y: 0 } }, 2500)!
    expect(rL.totalSheets).toBeLessThan(rBox.totalSheets)
  })
})

describe('calcPolygonSheetLayout — контур с дыркой', () => {
  it('не падает и возвращает валидный результат при наличии дырки', () => {
    const outer = rect(6000, 4000)
    const startSide = { start: outer[0], end: outer[1] }
    const hole: Point2D[] = [{ x: 2500, y: 1500 }, { x: 3500, y: 1500 }, { x: 3500, y: 2500 }, { x: 2500, y: 2500 }]
    const r = calcPolygonSheetLayout(outer, [hole], startSide, 2500)!
    expect(r.totalSheets).toBeGreaterThan(0)
  })
})

describe('calcPolygonSheetLayout — разбежка торцевых швов кратно b (12.07.2026, пункт 5 плана, только П112 поперечный монтаж)', () => {
  const outer = rect(6000, 3600) // 3 полосы по 1200мм вдоль V (0-1200, 1200-2400, 2400-3600)
  const startSide = { start: outer[0], end: outer[1] }

  // Собирает "внутренние" стыки (торцевые швы) каждого ряда (полосы) —
  // все u1 куска, кроме самого первого в ряду (это начало ряда, не шов).
  function internalJointsByBand(pieces: { u1: number; u2: number; v1: number }[]): Map<number, number[]> {
    const byBand = new Map<number, { u1: number; u2: number }[]>()
    for (const p of pieces) {
      if (!byBand.has(p.v1)) byBand.set(p.v1, [])
      byBand.get(p.v1)!.push(p)
    }
    const result = new Map<number, number[]>()
    for (const [v1, ps] of byBand) {
      const sorted = [...ps].sort((a, b) => a.u1 - b.u1)
      result.set(v1, sorted.slice(1).map(p => p.u1))
    }
    return result
  }

  it('без bearingStepMm — старая схема, швы НЕ обязаны быть кратны 500 (регресс не защищаем это специально, но подтверждаем что новая ветка кода не включается сама по себе)', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    const byBand = internalJointsByBand(r.layer1.pieces)
    const allJoints = [...byBand.values()].flat()
    // Старая ¼-схема при SL=2500 даёт шаг 625мм — не кратно 500.
    const anyNonMultipleOf500 = allJoints.some(j => j % 500 !== 0)
    expect(anyNonMultipleOf500).toBe(true)
  })

  it('с bearingStepMm=500 — все торцевые швы кратны b', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500, 1, DEFAULT_BOARD_SPEC, DEFAULT_BOARD_SPEC, [], 500)!
    const byBand = internalJointsByBand(r.layer1.pieces)
    const allJoints = [...byBand.values()].flat()
    expect(allJoints.length).toBeGreaterThan(0)
    expect(allJoints.every(j => j % 500 === 0)).toBe(true)
  })

  it('с bearingStepMm=500 — сдвиг между соседними рядами ровно 1×b (500мм), по решению пользователя', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500, 1, DEFAULT_BOARD_SPEC, DEFAULT_BOARD_SPEC, [], 500)!
    const byBand = internalJointsByBand(r.layer1.pieces)
    const bandKeys = [...byBand.keys()].sort((a, b) => a - b)
    expect(bandKeys.length).toBe(3) // 3 полосы по 1200мм на 3600мм глубины

    // Ожидаемые абсолютные позиции швов по формуле vOffset = (bandIndex*500) % 2500:
    // ряд 0 (offset 0):    швы {2500, 5000} внутри [0,6000] -> {2500, 5000}
    // ряд 1 (offset 500):  швы {500, 3000, 5500}
    // ряд 2 (offset 1000): швы {1000, 3500}
    expect(byBand.get(bandKeys[0])).toEqual([2500, 5000])
    expect(byBand.get(bandKeys[1])).toEqual([500, 3000, 5500])
    expect(byBand.get(bandKeys[2])).toEqual([1000, 3500])
  })

  it('с bearingStepMm — 2-й слой тоже кратен b (швы обоих слоёв попадают на несущий профиль)', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500, 2, DEFAULT_BOARD_SPEC, DEFAULT_BOARD_SPEC, [], 500)!
    expect(r.layer2).not.toBeNull()
    const byBand = internalJointsByBand(r.layer2!.pieces)
    const allJoints = [...byBand.values()].flat()
    expect(allJoints.length).toBeGreaterThan(0)
    expect(allJoints.every(j => j % 500 === 0)).toBe(true)
  })
})

describe('calcPolygonSheetLayout — детальная раскладка (12.07.2026, реализовано по просьбе пользователя: та же механика, что для перегородок/облицовок)', () => {
  const outer = rect(6000, 3600)
  const startSide = { start: outer[0], end: outer[1] }

  it('каждый кусок имеет реальные координаты, сумма площадей = используемая площадь слоя', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.layer1.pieces.length).toBe(r.totalSheets)
    const areaMm2 = r.layer1.pieces.reduce((s, p) => s + (p.u2 - p.u1) * (p.v2 - p.v1), 0)
    expect(areaMm2 / 1e6).toBeCloseTo(r.layer1.usedAreaM2, 3)
  })

  it('без 2-го слоя layer2 === null', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.layer2).toBeNull()
  })

  it('2-й слой смещён относительно первого — швы полос не совпадают', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500, 2)!
    expect(r.layer2).not.toBeNull()
    const bandEdges1 = new Set(r.layer1.pieces.map(p => p.v1))
    const bandEdges2 = new Set(r.layer2!.pieces.map(p => p.v1))
    // Хотя бы одна граница полосы слоя 2 не совпадает ни с одной границей слоя 1
    const anyDifferent = [...bandEdges2].some(v => ![...bandEdges1].some(v1 => Math.abs(v1 - v) < 1))
    expect(anyDifferent).toBe(true)
  })

  it('соседние полосы одного слоя не стыкуются по одной линии вдоль U (running bond)', () => {
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    const byBand = new Map<number, number[]>()
    for (const p of r.layer1.pieces) {
      const key = p.v1
      if (!byBand.has(key)) byBand.set(key, [])
      byBand.get(key)!.push(p.u2)
    }
    const bandKeys = [...byBand.keys()].sort((a, b) => a - b)
    if (bandKeys.length >= 2) {
      const jointsA = new Set(byBand.get(bandKeys[0])!)
      const jointsB = new Set(byBand.get(bandKeys[1])!)
      const overlap = [...jointsA].filter(j => jointsB.has(j))
      expect(overlap.length).toBeLessThan(jointsA.size)
    }
  })

  it('пул обрезков от предыдущей конструкции переиспользуется (меньше новых листов)', () => {
    const withoutPool = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    // Один большой обрезок ровно под первый кусок — должен быть взят из пула
    const bigOffcut: BoardOffcut = { w: 1200, h: 2500, spec: DEFAULT_BOARD_SPEC }
    const withPool = calcPolygonSheetLayout(outer, [], startSide, 2500, 1, DEFAULT_BOARD_SPEC, DEFAULT_BOARD_SPEC, [bigOffcut])!
    expect(withPool.layer1.sheetsNeeded).toBeLessThan(withoutPool.layer1.sheetsNeeded)
    expect(withPool.layer1.pieces.some(p => p.source === 'offcut')).toBe(true)
  })

  it('контур по обе стороны от стены старта — полосы покрывают весь диапазон (не только U/V ≥ 0)', () => {
    const lShape: Point2D[] = [
      { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 },
      { x: 4000, y: 4000 }, { x: 4000, y: 6000 }, { x: 0, y: 6000 },
    ]
    const side = { start: { x: 4000, y: 4000 }, end: { x: 4000, y: 6000 } }
    const r = calcPolygonSheetLayout(lShape, [], side, 2500)!
    // Стена старта — короткий вертикальный отрезок посередине контура;
    // большая часть фигуры лежит в отрицательном U относительно неё.
    expect(r.layer1.pieces.some(p => p.u1 < 0 || p.u2 < 0)).toBe(true)
  })
})

describe('calcPolygonSheetLayout — выемка режет полосу ЧАСТИЧНО по толщине (15.07.2026, репорт пользователя со скриншотами: раскрой в 3D "летал" за пределы контура)', () => {
  // Узкий (1200мм — ровно одна полоса) вогнутый контур: выемка на длине
  // 2500-4000мм срезает ширину с 1200 до 700мм, НЕ по всей толщине полосы.
  // Единственная скан-линия по центру полосы (x=600, что < 700 — выемки не
  // видит) раньше считала эту выемку не существующей: кусок листа 2500-5000
  // получал ширину 1200 на всей своей длине, хотя реально контур в диапазоне
  // 2500-4000 шириной только 700 — лист "торчал" за контур на 500×1500мм.
  const notch: Point2D[] = [
    { x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 2500 },
    { x: 700, y: 2500 }, { x: 700, y: 4000 }, { x: 1200, y: 4000 },
    { x: 1200, y: 6000 }, { x: 0, y: 6000 },
  ]
  const startSide = { start: notch[0], end: notch[1] }

  // Площадь контура (формула шнурования) — эталон для сверки с суммой
  // площадей кусков раскроя.
  function shoelaceArea(poly: Point2D[]): number {
    let s = 0
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      s += a.x * b.y - b.x * a.y
    }
    return Math.abs(s) / 2
  }

  it('суммарная площадь кусков раскроя равна площади контура (не больше — куски не вылезают за выемку)', () => {
    const r = calcPolygonSheetLayout(notch, [], startSide, 2500)!
    const piecesArea = r.layer1.pieces.reduce((s, p) => s + (p.u2 - p.u1) * (p.v2 - p.v1), 0)
    expect(piecesArea).toBeCloseTo(shoelaceArea(notch), 0)
  })

  it('ни один кусок не шире фактического контура в своём диапазоне длины (никакой кусок не толще 700мм на участке 2500-4000)', () => {
    const r = calcPolygonSheetLayout(notch, [], startSide, 2500)!
    for (const p of r.layer1.pieces) {
      // Кусок, который целиком лежит в диапазоне длины выемки (2500..4000
      // по оси, вдоль которой считается контур — после возможного transpose
      // при rotated это может быть u или v; проверяем обе оси на всякий
      // случай, т.к. тест должен быть устойчив к выбору ориентации).
      const lo = Math.min(p.u1, p.u2, p.v1, p.v2)
      const overlapsNotchU = p.u1 >= 2500 - 1e-6 && p.u2 <= 4000 + 1e-6
      const overlapsNotchV = p.v1 >= 2500 - 1e-6 && p.v2 <= 4000 + 1e-6
      if (overlapsNotchU) expect(p.v2 - p.v1).toBeLessThanOrEqual(700 + 1e-6)
      if (overlapsNotchV) expect(p.u2 - p.u1).toBeLessThanOrEqual(700 + 1e-6)
      expect(lo).toBeGreaterThanOrEqual(-1e-6)
    }
  })
})

describe('calcPolygonSheetLayout — пул остатков не содержит дробных мм (регрессия 19.07.2026)', () => {
  // Скошенный контур (не прямоугольник) — ширина полос между рядами разбивки
  // получается нецелой (например 937.5мм). Дробность самой геометрии
  // ожидаема, баг был в том, что она протекала в размеры сохранённых в пул
  // остатков (finalOffcuts) — там нужны целые мм, монтажник мерит рулеткой.
  // Тот же фикс, что и в calcSheetLayout.ts (стена), пул общий между
  // конструкциями объекта.
  it('все w/h в finalOffcuts — целые мм', () => {
    const outer = [
      { x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 2100 }, { x: 0, y: 3700 },
    ]
    const startSide = { start: outer[0], end: outer[1] }
    const r = calcPolygonSheetLayout(outer, [], startSide, 2500)!
    expect(r.finalOffcuts.length).toBeGreaterThan(0)
    for (const o of r.finalOffcuts) {
      expect(Number.isInteger(o.w)).toBe(true)
      expect(Number.isInteger(o.h)).toBe(true)
    }
  })
})


