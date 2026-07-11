import { describe, it, expect } from 'vitest'
import { calcCeiling } from '../calcCeiling'
import type { CeilingSpecFull } from '../../data/ceilingData'
import { calcP112FrameGeometry, resolveFrameParams } from '../calcP112Frame'

// Помещение 4000×5000мм = 20м², периметр 18м
const BASE: CeilingSpecFull = {
  type: 'p112',
  layers: 1,
  material: 'gsp',
  thickness: 12.5,
  stepC: 600,
  areaSqm: 20,
  perimeterM: 18,
  roomLengthMm: 5000,
  roomWidthMm: 4000,
  sheetLengthMm: 2500,
}

describe('calcCeiling — П112.1, fallback без slabGapMm (20м², шаг 600мм)', () => {
  const res = calcCeiling(BASE)

  it('есть предупреждение — нет зазора до плиты, расчёт по среднему расходу', () => {
    expect(res.warnings.length).toBeGreaterThan(0)
    expect(res.warnings[0]).toContain('среднему расходу')
  })

  it('площадь и периметр переданы корректно', () => {
    expect(res.areaSqm).toBe(20)
    expect(res.perimeterM).toBe(18)
  })

  it('ПП 60×27 — 64 пог.м (3.2 × 20)', () => {
    const item = res.materials.find(m => m.name === 'Профиль ПП 60×27')
    expect(item).toBeDefined()
    expect(item!.qty).toBe(64)
  })

  it('Подвесы прямые — 26 шт (1.3 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('Подвес прямой'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(26)
  })

  it('Дюбели анкерные — 26 шт (1.3 × 20)', () => {
    const item = res.materials.find(m => m.name === 'Дюбель анкерный')
    expect(item).toBeDefined()
    expect(item!.qty).toBe(26)
  })

  it('ГСП 12.5мм — 20 м²', () => {
    const item = res.materials.find(m => m.name.includes('ГСП'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(20)
  })

  it('Шуруп TN 25мм — 340 шт (17 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('TN 25'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(340)
  })

  it('Соединитель двухуровневый — 46 шт (ceil(2.3 × 20))', () => {
    const item = res.materials.find(m => m.name.includes('двухуровневый'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(46)
  })

  it('Лента разделительная — по периметру 18 пог.м', () => {
    const item = res.materials.find(m => m.name.includes('разделительная'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(18)
  })
})

describe('calcCeiling — П112, точная геометрия (с slabGapMm)', () => {
  const PRECISE: CeilingSpecFull = { ...BASE, slabGapMm: 50, stepB: 900, bearingAlongLength: true }
  const res = calcCeiling(PRECISE)
  const expectedGeo = calcP112FrameGeometry(5000, 4000, 600, 900, 50, true)

  it('нет предупреждения о fallback', () => {
    expect(res.warnings.find(w => w.includes('среднему расходу'))).toBeUndefined()
  })

  it('несущий профиль — по geometrии (bearingTotalLm)', () => {
    const item = res.materials.find(m => m.name.includes('несущий, верхний'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(Math.ceil(expectedGeo.bearingTotalLm))
  })

  it('основной профиль — по геометрии (mainTotalLm)', () => {
    const item = res.materials.find(m => m.name.includes('основной, нижний'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(Math.ceil(expectedGeo.mainTotalLm))
  })

  it('соединитель двухуровневый — по пересечениям рядов', () => {
    const item = res.materials.find(m => m.name.includes('двухуровневый'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(expectedGeo.connectorsTotal)
  })

  it('подвесы — по факту (bearingCount × hangersPerBearing), не по среднему расходу', () => {
    const item = res.materials.find(m => m.name.includes('Подвес прямой ПП'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(expectedGeo.hangersTotal)
  })

  it('анкер-клин — по числу подвесов', () => {
    const item = res.materials.find(m => m.name.includes('Анкер-клин'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(expectedGeo.hangersTotal)
  })

  it('зазор 50мм → обычный прямой подвес (не тяга)', () => {
    const item = res.materials.find(m => m.name.includes('Тяга'))
    expect(item).toBeUndefined()
  })

  it('большой зазор до плиты → материал "Тяга", не "Подвес прямой"', () => {
    const far = calcCeiling({ ...PRECISE, slabGapMm: 700 })
    const rod = far.materials.find(m => m.name.includes('Тяга'))
    expect(rod).toBeDefined()
    const direct = far.materials.find(m => m.name === 'Подвес прямой ПП 60×27')
    expect(direct).toBeUndefined()
  })

  it('layoutMode не задан → как раньше (user), совпадает с явным layoutMode:"user"', () => {
    const withDefault = calcCeiling(PRECISE)
    const withUser = calcCeiling({ ...PRECISE, layoutMode: 'user' })
    expect(withDefault.materials).toEqual(withUser.materials)
  })

  it('layoutMode:"knauf" использует stepB/stepA по официальной таблице, а не PRECISE.stepB', () => {
    const withKnauf = calcCeiling({ ...PRECISE, layoutMode: 'knauf' })
    const frameParams = resolveFrameParams({ stepC: PRECISE.stepC, layoutMode: 'knauf' })
    const expectedKnaufGeo = calcP112FrameGeometry(
      5000, 4000, PRECISE.stepC, frameParams.stepB, 50, true, 'knauf',
      { stepA: frameParams.stepA, wallOffsetMainMm: frameParams.wallOffsetMainMm, wallOffsetBearingMm: frameParams.wallOffsetBearingMm },
    )
    const item = withKnauf.materials.find(m => m.name.includes('несущий, верхний'))
    expect(item!.qty).toBe(Math.ceil(expectedKnaufGeo.bearingTotalLm))
    expect(withKnauf.materials).not.toEqual(res.materials)
    // c=600 вне официальной таблицы (только 800/1000/1200) -> должно быть предупреждение
    expect(withKnauf.warnings.some(w => w.includes('таблиц'))).toBe(true)
  })

  it('layoutMode:"knauf" с mountDirection:"lengthwise" даёт stepB=400 (не 500)', () => {
    const withLengthwise = calcCeiling({ ...PRECISE, layoutMode: 'knauf', mountDirection: 'lengthwise', loadClass: 0.5 })
    const withCrosswise = calcCeiling({ ...PRECISE, layoutMode: 'knauf', mountDirection: 'crosswise', loadClass: 0.5 })
    expect(withLengthwise.materials).not.toEqual(withCrosswise.materials)
  })
})

describe('calcCeiling — П112.2 двухслойный', () => {
  const res = calcCeiling({ ...BASE, layers: 2 })

  it('ГСП 12.5мм — 40 м² (2 слоя)', () => {
    const item = res.materials.find(m => m.name.includes('ГСП'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(40)
  })

  it('Шуруп TN 25мм — 180 шт (9 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('TN 25'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(180)
  })

  it('Шуруп TN 35мм — 340 шт (17 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('TN 35'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(340)
  })
})

describe('calcCeiling — П113.1 (одноуровневый)', () => {
  const res = calcCeiling({ ...BASE, type: 'p113', stepC: 800 })

  it('ПП 60×27 — 58 пог.м (2.9 × 20)', () => {
    const item = res.materials.find(m => m.name === 'Профиль ПП 60×27')
    expect(item).toBeDefined()
    expect(item!.qty).toBe(58)
  })

  it('ПН 28×27 — по периметру 18 пог.м', () => {
    const item = res.materials.find(m => m.name.includes('ПН 28×27'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(18)
  })

  it('Соединитель одноуровневый — 34 шт (ceil(1.7 × 20))', () => {
    const item = res.materials.find(m => m.name.includes('одноуровневый'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(34)
  })

  it('Шуруп TN 25мм — 460 шт (23 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('TN 25'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(460)
  })
})

describe('calcCeiling — П131.1', () => {
  const res = calcCeiling({ ...BASE, type: 'p131', stepC: 500 })

  it('ПН профиль — 16 пог.м (0.8 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('ПН 50'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(16)
  })

  it('ПС несущий — 38 пог.м (1.9 × 20)', () => {
    const item = res.materials.find(m => m.name.includes('ПС несущий'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(38)
  })

  it('нет подвесов', () => {
    const item = res.materials.find(m => m.name.includes('Подвес'))
    expect(item).toBeUndefined()
  })
})

describe('calcCeiling — П19 заглушка', () => {
  const res = calcCeiling({ ...BASE, type: 'p19' })

  it('нет материалов', () => {
    expect(res.materials).toHaveLength(0)
  })

  it('есть предупреждение', () => {
    expect(res.warnings.length).toBeGreaterThan(0)
    expect(res.warnings[0]).toContain('П19')
  })
})

describe('calcCeilingSheetLayout — раскрой 5000×4000мм', () => {
  const res = calcCeiling(BASE)
  const layout = res.sheetLayout!

  it('layout существует', () => {
    expect(layout).not.toBeNull()
  })

  it('sheetW = 1200, sheetL = 2500', () => {
    expect(layout.sheetW).toBe(1200)
    expect(layout.sheetL).toBe(2500)
  })

  it('stepB = 500мм', () => {
    expect(layout.stepB).toBe(500)
  })

  it('stepA = 1150мм (шаг подвесов, П112, c=600)', () => {
    expect(layout.stepA).toBe(1150)
  })

  // Лист 1200×2500: длинная сторона (2500) вдоль длины помещения (5000мм)
  // colCount = ceil(5000/2500) = 2 колонки по длине
  // rowCount = ceil(4000/1200) = 4 ряда по ширине (последний резаный: 4000%1200=400мм)
  it('colCount = 2 (5000 / 2500 → 2 колонки по длине)', () => {
    expect(layout.colCount).toBe(2)
  })

  it('rowCount = 4 (4000 / 1200 → 4 ряда по ширине)', () => {
    expect(layout.rowCount).toBe(4)
  })

  it('totalSheets = 8', () => {
    expect(layout.totalSheets).toBe(8)
  })

  it('fullSheets = 6 (2 полных колонки × 3 полных ряда)', () => {
    // 4000 % 1200 = 400 → последний ряд резаный → fullRows = 3
    // 5000 % 2500 = 0 → fullCols = 2
    expect(layout.fullSheets).toBe(6)
  })

  it('cutSheets = 2 (нижний ряд резаный)', () => {
    expect(layout.cutSheets).toBe(2)
  })
})

describe('calcCeilingSheetLayout — раскрой 2500×2400мм (автоориентация → 2 целых)', () => {
  const spec: CeilingSpecFull = { ...BASE, roomLengthMm: 2500, roomWidthMm: 2400,
    sheetLengthMm: 2500, areaSqm: 6, perimeterM: 9.8 }
  const res = calcCeiling(spec)
  const layout = res.sheetLayout!

  // Оба варианта:
  // Вариант А (длина 2500 по X): ceil(2500/2500)=1 кол × ceil(2400/1200)=2 ряда = 2 листа, 0 резаных
  // Вариант Б (ширина 2400 по X): ceil(2400/2500)=1 кол × ceil(2500/1200)=3 ряда = 3 листа, 1 резаный
  // → выбираем Вариант А: 2 листа, не повёрнут
  it('totalSheets = 2 (автовыбор лучшей ориентации)', () => {
    expect(layout.totalSheets).toBe(2)
  })

  it('fullSheets = 2 — оба целые', () => {
    expect(layout.fullSheets).toBe(2)
  })

  it('cutSheets = 0', () => {
    expect(layout.cutSheets).toBe(0)
  })

  it('rotated = false (лист вдоль длины 2500мм)', () => {
    expect(layout.rotated).toBeFalsy()
  })
})

describe('calcCeilingSheetLayout — раскрой 2400×2500мм (автоориентация разворачивает лист)', () => {
  // Те же размеры но переставлены местами
  const spec: CeilingSpecFull = { ...BASE, roomLengthMm: 2400, roomWidthMm: 2500,
    sheetLengthMm: 2500, areaSqm: 6, perimeterM: 9.8 }
  const res = calcCeiling(spec)
  const layout = res.sheetLayout!

  // Вариант А (длина 2400 по X): ceil(2400/2500)=1 кол × ceil(2500/1200)=3 ряда = 3 листа
  // Вариант Б (ширина 2500 по X): ceil(2500/2500)=1 кол × ceil(2400/1200)=2 ряда = 2 листа ✓
  // → выбираем Вариант Б: повёрнут
  it('totalSheets = 2 (автоповорот экономит лист)', () => {
    expect(layout.totalSheets).toBe(2)
  })

  it('fullSheets = 2', () => {
    expect(layout.fullSheets).toBe(2)
  })

  it('cutSheets = 0', () => {
    expect(layout.cutSheets).toBe(0)
  })

  it('rotated = true (повёрнут для экономии)', () => {
    expect(layout.rotated).toBe(true)
  })
})

describe('calcCeiling — с polygonInput (пункт 6, контур произвольной формы)', () => {
  // Тот же прямоугольник 5000×4000, но заданный контуром + стеной старта,
  // а не roomLengthMm/roomWidthMm — материалы каркаса должны совпасть с
  // прямоугольным точным расчётом (см. calcPolygonP112Frame.test.ts).
  const outer = [
    { x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 },
  ]
  const startSide = { start: outer[0], end: outer[1] }
  const spec: CeilingSpecFull = {
    type: 'p112', layers: 1, material: 'gsp', thickness: 12.5,
    stepC: 600, areaSqm: 20, perimeterM: 18, slabGapMm: 80, sheetLengthMm: 2500,
    roomLengthMm: 0, roomWidthMm: 0,
  }
  const res = calcCeiling(spec, { outerMm: outer, holesMm: [], startSide })

  it('нет предупреждения про "средний расход" — использована точная геометрия по контуру', () => {
    expect(res.warnings.some(w => w.includes('среднему расходу'))).toBe(false)
  })

  it('polygonFrame заполнен, sheetLayout (прямоугольный) — null', () => {
    expect(res.polygonFrame).not.toBeNull()
    expect(res.sheetLayout).toBeNull()
    expect(res.polygonSheetLayout).not.toBeNull()
  })

  it('материалы каркаса посчитаны (несущий/основной профиль, крабы, подвесы)', () => {
    expect(res.materials.find(m => m.name.includes('несущий'))?.qty).toBeGreaterThan(0)
    expect(res.materials.find(m => m.name.includes('основной'))?.qty).toBeGreaterThan(0)
    expect(res.materials.find(m => m.name.includes('Соединитель двухуровневый'))?.qty).toBeGreaterThan(0)
  })

  it('без polygonInput (тот же spec) считается по среднему расходу — есть warning', () => {
    const fallback = calcCeiling(spec)
    expect(fallback.warnings.some(w => w.includes('среднему расходу'))).toBe(true)
    expect(fallback.polygonFrame).toBeNull()
  })
})
