import { describe, it, expect } from 'vitest'
import { calcCeilingGrid, calcCeilingGridP113, clipCeilingGridToPolygon, calcCeilingSheetRects, type CeilingGridResult } from '../ceilingGridGeometry'
import type { Point2D } from '../geometry2d'

describe('calcCeilingGrid', () => {
  it('несущий профиль идёт вдоль length при bearingAlongLength=true, расставлен по width', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    // bearingSegments расставлены поперёк width (2800/900 -> 900,1800,2700)
    expect(grid.bearingSegments.length).toBe(3)
    // каждый несущий сегмент тянется по всей length (0..4000) вдоль X
    for (const seg of grid.bearingSegments) {
      expect(seg.x1).toBe(0)
      expect(seg.x2).toBe(4000)
      expect(seg.z1).toBe(seg.z2) // прямая линия поперёк
    }
  })

  it('основной профиль перпендикулярен несущему и расставлен вдоль length с шагом stepC', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    for (const seg of grid.mainSegments) {
      expect(seg.z1).toBe(0)
      expect(seg.z2).toBe(2800)
      expect(seg.x1).toBe(seg.x2)
    }
    // 4000/600: 600,1200,1800,2400,3000,3600 -> зазор до стены 400 (>250) -> последний подтянут
    expect(grid.mainSegments.length).toBeGreaterThan(0)
  })

  it('bearingAlongLength=false — оси меняются местами', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: false,
    })
    // теперь несущий идёт вдоль Z (width), расставлен по X (length)
    for (const seg of grid.bearingSegments) {
      expect(seg.z1).toBe(0)
      expect(seg.z2).toBe(2800)
      expect(seg.x1).toBe(seg.x2)
    }
  })

  it('точки крабов = пересечения несущих и основных линий (декартово произведение позиций)', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    expect(grid.crabPoints.length).toBe(grid.bearingSegments.length * grid.mainSegments.length)
  })

  it('точки подвесов — подмножество позиций несущего профиля (строго на оси), не независимая сетка (12.07.2026: подвес крепится к ОСНОВНОМУ, снэп по несущему — было наоборот)', () => {
    const grid = calcCeilingGrid({
      lengthMm: 4000, widthMm: 2800, stepB: 900, stepC: 600, bearingAlongLength: true,
    })
    const hangersPerMain = grid.hangerPoints.length / grid.mainSegments.length
    expect(Number.isInteger(hangersPerMain)).toBe(true)
    expect(hangersPerMain).toBeGreaterThan(0)
    // каждая Z-координата подвеса обязана совпадать с Z-координатой одной
    // из линий несущего профиля (bearingSegments) — подвес физически стоит
    // в точке пересечения основной/несущий, а не на своей отдельной сетке.
    const bearingZs = new Set(grid.bearingSegments.map(s => s.z1))
    const hangerZsForFirstMain = grid.hangerPoints
      .slice(0, hangersPerMain)
      .map(p => p.z)
    for (const z of hangerZsForFirstMain) {
      expect(bearingZs.has(z)).toBe(true)
    }
  })

  it('stepA задаёт максимально допустимый шаг подвесов, не обязательный — при мелком шаге b и крупном a подвес ставится не на КАЖДОМ несущем профиле', () => {
    const grid = calcCeilingGrid({
      lengthMm: 2800, widthMm: 6000, stepB: 300, stepC: 900, bearingAlongLength: true, stepA: 900,
    })
    const bearingCountAlongB = grid.bearingSegments.length
    const hangersPerMain = grid.hangerPoints.length / grid.mainSegments.length
    // при b=300 (частый несущий профиль) и a=900 (втрое реже) большинство
    // узлов несущего профиля остаётся без своего подвеса — это ожидаемо:
    // подвес лишь держит СЛЕДУЮЩИЙ узел в пределах допустимого шага a, не
    // обязан стоять на каждом.
    expect(hangersPerMain).toBeLessThan(bearingCountAlongB)
  })

  it('нулевые размеры помещения -> пустая сетка, без исключений', () => {
    const grid = calcCeilingGrid({ lengthMm: 0, widthMm: 0, stepB: 600, stepC: 600, bearingAlongLength: true })
    expect(grid.bearingSegments).toEqual([])
    expect(grid.mainSegments).toEqual([])
    expect(grid.crabPoints).toEqual([])
    expect(grid.hangerPoints).toEqual([])
  })
})

describe('calcCeilingGridP113 (13.07.2026, одноуровневая система — см. calcP113Frame.ts)', () => {
  it('основной профиль сплошной, идёт вдоль length при mainAlongLength=true, расставлен по width', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    for (const seg of grid.mainSegments) {
      expect(seg.x1).toBe(0)
      expect(seg.x2).toBe(4000)
      expect(seg.z1).toBe(seg.z2)
    }
    expect(grid.mainSegments.length).toBeGreaterThan(0)
  })

  it('несущий профиль — короткие вставки: сумма длин в одном ряду = полному пролёту width', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    // Все вставки несущего идут вдоль Z (x1===x2, короткая длина по z),
    // в отличие от П112, где несущий сплошной на всю ширину помещения.
    for (const seg of grid.bearingSegments) {
      expect(seg.x1).toBe(seg.x2)
      expect(seg.z2 - seg.z1).toBeGreaterThan(0)
    }
    // группируем по alongA (x1) — сумма длин в одной группе должна дать 2800
    const byX = new Map<number, number>()
    for (const seg of grid.bearingSegments) {
      byX.set(seg.x1, (byX.get(seg.x1) ?? 0) + (seg.z2 - seg.z1))
    }
    expect(byX.size).toBeGreaterThan(0)
    for (const total of byX.values()) {
      expect(total).toBeCloseTo(2800, 6)
    }
  })

  it('число коротких кусков несущего в одном ряду = mainSegments.length + 1 (крайние у стен + между рядами)', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    const byX = new Map<number, number>()
    for (const seg of grid.bearingSegments) {
      byX.set(seg.x1, (byX.get(seg.x1) ?? 0) + 1)
    }
    for (const piecesInRow of byX.values()) {
      expect(piecesInRow).toBe(grid.mainSegments.length + 1)
    }
  })

  it('mainAlongLength=false — оси меняются местами (основной вдоль Z)', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: false,
    })
    for (const seg of grid.mainSegments) {
      expect(seg.z1).toBe(0)
      expect(seg.z2).toBe(2800)
      expect(seg.x1).toBe(seg.x2)
    }
  })

  it('точки соединителей = decartово произведение позиций (mainCount × bearingRowCount)', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    const bearingRowCount = new Set(grid.bearingSegments.map(s => s.x1)).size
    expect(grid.crabPoints.length).toBe(grid.mainSegments.length * bearingRowCount)
  })

  it('подвесы — на основном профиле (по числу mainSegments рядов), позиции подмножество несущего', () => {
    const grid = calcCeilingGridP113({
      lengthMm: 4000, widthMm: 2800, stepB: 500, stepC: 600, mainAlongLength: true,
    })
    const hangersPerMain = grid.hangerPoints.length / grid.mainSegments.length
    expect(Number.isInteger(hangersPerMain)).toBe(true)
    expect(hangersPerMain).toBeGreaterThan(0)
    const bearingXs = new Set(grid.bearingSegments.map(s => s.x1))
    for (const p of grid.hangerPoints) {
      expect(bearingXs.has(p.x)).toBe(true)
    }
  })

  it('нулевые размеры помещения -> пустая сетка, без исключений', () => {
    const grid = calcCeilingGridP113({ lengthMm: 0, widthMm: 0, stepB: 500, stepC: 600, mainAlongLength: true })
    expect(grid.bearingSegments).toEqual([])
    expect(grid.mainSegments).toEqual([])
    expect(grid.crabPoints).toEqual([])
    expect(grid.hangerPoints).toEqual([])
  })
})

describe('clipCeilingGridToPolygon', () => {
  // Ромб (повёрнутый квадрат), вписанный в bbox 4000×4000 мм — вершины
  // ровно в серединах сторон bbox. |x-2000| + |z-2000| <= 2000 — уравнение
  // границы ромба, используется ниже для проверки ожидаемых границ отрезков.
  const diamond: Point2D[] = [
    { x: 2000, y: 0 },
    { x: 4000, y: 2000 },
    { x: 2000, y: 4000 },
    { x: 0, y: 2000 },
  ]

  it('горизонтальный отрезок по самой широкой линии ромба (z=2000) не обрезается', () => {
    const grid: CeilingGridResult = {
      bearingSegments: [{ x1: 0, z1: 2000, x2: 4000, z2: 2000 }],
      mainSegments: [], crabPoints: [], hangerPoints: [],
    }
    const clipped = clipCeilingGridToPolygon(grid, diamond)
    expect(clipped.bearingSegments).toEqual([{ x1: 0, z1: 2000, x2: 4000, z2: 2000 }])
  })

  it('горизонтальный отрезок вне центра ромба обрезается по границе контура (не по bbox)', () => {
    const grid: CeilingGridResult = {
      bearingSegments: [{ x1: 0, z1: 500, x2: 4000, z2: 500 }],
      mainSegments: [], crabPoints: [], hangerPoints: [],
    }
    const clipped = clipCeilingGridToPolygon(grid, diamond)
    // на z=500: |x-2000| <= 2000-1500=500 -> x в [1500, 2500]
    expect(clipped.bearingSegments.length).toBe(1)
    expect(clipped.bearingSegments[0].x1).toBeCloseTo(1500, 5)
    expect(clipped.bearingSegments[0].x2).toBeCloseTo(2500, 5)
  })

  it('вертикальный отрезок вне центра ромба обрезается аналогично по оси Z', () => {
    const grid: CeilingGridResult = {
      bearingSegments: [], mainSegments: [{ x1: 500, z1: 0, x2: 500, z2: 4000 }], crabPoints: [], hangerPoints: [],
    }
    const clipped = clipCeilingGridToPolygon(grid, diamond)
    expect(clipped.mainSegments.length).toBe(1)
    expect(clipped.mainSegments[0].z1).toBeCloseTo(1500, 5)
    expect(clipped.mainSegments[0].z2).toBeCloseTo(2500, 5)
  })

  it('отрезок, лишь касающийся вершины ромба (вырожденный), отбрасывается целиком', () => {
    const grid: CeilingGridResult = {
      bearingSegments: [{ x1: 0, z1: 4000, x2: 4000, z2: 4000 }], // z=4000 — только вершина (2000,4000)
      mainSegments: [], crabPoints: [], hangerPoints: [],
    }
    const clipped = clipCeilingGridToPolygon(grid, diamond)
    expect(clipped.bearingSegments.length).toBe(0)
  })

  it('точки крабов/подвесов вне контура отфильтровываются, внутри — сохраняются', () => {
    const grid: CeilingGridResult = {
      bearingSegments: [], mainSegments: [],
      crabPoints: [{ x: 2000, z: 2000 }, { x: 100, z: 100 }],
      hangerPoints: [{ x: 2000, z: 1000 }, { x: 3900, z: 3900 }],
    }
    const clipped = clipCeilingGridToPolygon(grid, diamond)
    expect(clipped.crabPoints).toEqual([{ x: 2000, z: 2000 }])
    expect(clipped.hangerPoints).toEqual([{ x: 2000, z: 1000 }])
  })

  it('невыпуклый контур (Г-образная комната) режет один отрезок на несколько кусков', () => {
    // Г-образная комната 4000×4000 с вырезанным углом 2000×2000 (верхний правый)
    const lShape: Point2D[] = [
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 },
      { x: 2000, y: 2000 }, { x: 2000, y: 4000 }, { x: 0, y: 4000 },
    ]
    const grid: CeilingGridResult = {
      bearingSegments: [{ x1: 0, z1: 3000, x2: 4000, z2: 3000 }], // выше выреза — только левая половина внутри
      mainSegments: [], crabPoints: [], hangerPoints: [],
    }
    const clipped = clipCeilingGridToPolygon(grid, lShape)
    expect(clipped.bearingSegments).toEqual([{ x1: 0, z1: 3000, x2: 2000, z2: 3000 }])
  })

  it('меньше 3 точек контура — возвращает исходную сетку без изменений (защита)', () => {
    const grid: CeilingGridResult = {
      bearingSegments: [{ x1: 0, z1: 500, x2: 4000, z2: 500 }],
      mainSegments: [], crabPoints: [], hangerPoints: [],
    }
    expect(clipCeilingGridToPolygon(grid, [])).toEqual(grid)
  })
})

describe('calcCeilingSheetRects', () => {
  it('целое число листов без обрезков — все целые, сетка 2x2 для комнаты 2400x2400 и листа 1200x1200', () => {
    const rects = calcCeilingSheetRects(2400, 2400, 1200, 1200)
    expect(rects.length).toBe(4)
    expect(rects.every(r => !r.isCut)).toBe(true)
    expect(rects.every(r => r.w === 1200 && r.d === 1200)).toBe(true)
  })

  it('обрезки по правому и нижнему краю помечены isCut, размеры укорочены точно по остатку', () => {
    // комната 3000x2000, лист 1200x1200: по X — 1200,1200,600(рез); по Z — 1200,800(рез)
    const rects = calcCeilingSheetRects(3000, 2000, 1200, 1200)
    const byRow = (z: number) => rects.filter(r => r.z === z)
    const row0 = byRow(0)
    expect(row0.map(r => r.w)).toEqual([1200, 1200, 600])
    expect(row0.map(r => r.isCut)).toEqual([false, false, true])
    const row1 = byRow(1200)
    expect(row1.every(r => r.d === 800 && r.isCut)).toBe(true)
  })

  it('вырожденные входные размеры (0 или отрицательные) — пустой результат, без исключений', () => {
    expect(calcCeilingSheetRects(0, 2000, 1200, 1200)).toEqual([])
    expect(calcCeilingSheetRects(2000, 0, 1200, 1200)).toEqual([])
    expect(calcCeilingSheetRects(2000, 2000, 0, 1200)).toEqual([])
    expect(calcCeilingSheetRects(-100, 2000, 1200, 1200)).toEqual([])
  })

  it('сумма площадей листов равна площади помещения (без нахлёстов/пробелов)', () => {
    const lengthMm = 4370, widthMm = 3120, sheetL = 1200, sheetW = 2500
    const rects = calcCeilingSheetRects(lengthMm, widthMm, sheetL, sheetW)
    const totalArea = rects.reduce((sum, r) => sum + r.w * r.d, 0)
    expect(totalArea).toBeCloseTo(lengthMm * widthMm, 3)
  })
})
