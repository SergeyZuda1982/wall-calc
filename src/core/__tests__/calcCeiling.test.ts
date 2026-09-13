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
    const item = res.materials.find(m => m.name.includes('несущий, нижний'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(Math.ceil(expectedGeo.bearingTotalLm))
  })

  it('основной профиль — по геометрии (mainTotalLm)', () => {
    const item = res.materials.find(m => m.name.includes('основной, верхний'))
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
    const item = withKnauf.materials.find(m => m.name.includes('несущий, нижний'))
    expect(item!.qty).toBe(Math.ceil(expectedKnaufGeo.bearingTotalLm))
    expect(withKnauf.materials).not.toEqual(res.materials)
    // 11.07.2026: c=600 раньше ошибочно считался вне официальной таблицы
    // (тогда покрывались только 800/1000/1200) — после сверки по фото
    // документа таблица покрывает весь диапазон c=500..1200, поэтому для
    // c=600 предупреждения больше быть не должно (см. ceilingData.ts).
    expect(withKnauf.warnings.some(w => w.includes('таблиц'))).toBe(false)
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

// 11.09.2026: BASE уже содержит roomLengthMm/roomWidthMm (5000×4000) — для
// П131 (в отличие от П112, которому ещё нужен slabGapMm) этого достаточно,
// чтобы считать точную геометрию каркаса вместо старой нормы на м²
// (см. calcP131Frame.ts). Fallback на норму м² теперь проверяется отдельным
// блоком ниже, со спецификацией БЕЗ размеров помещения.
//
// ⚠️ Сечение ПС/ПН подбирается автоматически по офиц. таблице Кнауф
// (P131_MAX_SPAN_MM) — НЕ привязано к layers напрямую. Для пролёта
// B=4000мм (roomWidthMm) при layers=1: ПС50 (до 3000 спар.) и ПС75
// (до 3750 спар.) недостаточно, первое подходящее — ПС100 спаренный
// (до 4250мм) — см. selectP131ProfileConfig.
describe('calcCeiling — П131, точная геометрия каркаса (roomLengthMm/roomWidthMm заданы)', () => {
  const res = calcCeiling({ ...BASE, type: 'p131', stepC: 500 })
  // pnAlongLength по умолчанию true -> A = roomLengthMm = 5000 (ПН вдоль
  // длины, 2 рейки), B = roomWidthMm = 4000 (пролёт, который перекрывает ПС).
  // psPositions вдоль A=5000 с шагом 500: 500,1000,...,4500 -> 9 профилей.
  // B=4000 -> подобран ПС100 спаренный (см. шапку блока).

  it('подобрано ПС100 спаренный (пролёт 4000мм требует его — 50 и 75 не хватает)', () => {
    expect(res.p131ProfileSelection).toEqual({ widthMm: 100, paired: true, maxSpanMm: 4250 })
  })

  it('ПН профиль — 10 пог.м (2 рейки × 5000мм), сечение 100мм по подбору', () => {
    const item = res.materials.find(m => m.name.includes('Профиль ПН'))
    expect(item).toBeDefined()
    expect(item!.name).toContain('100')
    expect(item!.qty).toBe(10)
  })

  it('ПС несущий — 72 пог.м (9 профилей × 4000мм × 2, спаренный)', () => {
    const item = res.materials.find(m => m.name.includes('Профиль ПС'))
    expect(item).toBeDefined()
    expect(item!.name).toContain('спаренный')
    expect(item!.qty).toBe(72)
  })

  it('удлинитель профиля — 20 шт (9 ПС × 2 × 1 + 2 ПН × 1, пролёты длиннее хлыста 3000мм)', () => {
    const item = res.materials.find(m => m.name.includes('Удлинитель'))
    expect(item).toBeDefined()
    expect(item!.qty).toBe(20)
  })

  it('нет предупреждения о превышении предела (4000мм ≤ 4250мм для ПС100 спаренного)', () => {
    expect(res.warnings.some(w => w.includes('превышает максимально допустимый'))).toBe(false)
  })

  it('нет подвесов', () => {
    const item = res.materials.find(m => m.name.includes('Подвес'))
    expect(item).toBeUndefined()
  })

  it('раскрой профиля заполнен (main = ПС, bearing = ПН)', () => {
    expect(res.profileCutList).not.toBeNull()
    expect(res.profileCutList!.main.totalBars).toBeGreaterThan(0)
    expect(res.profileCutList!.bearing.totalBars).toBeGreaterThan(0)
  })
})

describe('calcCeiling — П131, предупреждение при пролёте вне таблицы (даже ПС100 спаренный не тянет)', () => {
  it('layers=1, пролёт 4251мм (на 1мм больше максимума 4250) — предупреждение есть', () => {
    const res = calcCeiling({ ...BASE, type: 'p131', stepC: 500, roomWidthMm: 4251 } as CeilingSpecFull)
    expect(res.warnings.some(w => w.includes('4250'))).toBe(true)
    expect(res.p131ProfileSelection).toBeNull()
  })

  it('layers=1, пролёт 4250мм (ровно максимум) — предупреждения нет', () => {
    const res = calcCeiling({ ...BASE, type: 'p131', stepC: 500, roomWidthMm: 4250 } as CeilingSpecFull)
    expect(res.warnings.some(w => w.includes('превышает максимально допустимый'))).toBe(false)
    expect(res.p131ProfileSelection).not.toBeNull()
  })

  it('layers=2 — предел ниже, чем layers=1 (тяжелее обшивка): пролёт 3751мм уже превышает', () => {
    const res = calcCeiling({ ...BASE, type: 'p131', stepC: 500, roomWidthMm: 3751, layers: 2 } as CeilingSpecFull)
    expect(res.warnings.some(w => w.includes('3750'))).toBe(true)
    expect(res.p131ProfileSelection).toBeNull()
  })

  it('layers=2, тот же пролёт 3751мм при layers=1 — ещё в пределах (предупреждения нет)', () => {
    const res = calcCeiling({ ...BASE, type: 'p131', stepC: 500, roomWidthMm: 3751, layers: 1 } as CeilingSpecFull)
    expect(res.warnings.some(w => w.includes('превышает максимально допустимый'))).toBe(false)
    expect(res.p131ProfileSelection).not.toBeNull()
  })
})

describe('calcCeiling — П131, fallback без размеров помещения (норма на м²)', () => {
  const { roomLengthMm: _l, roomWidthMm: _w, ...baseNoRoom } = BASE
  const res = calcCeiling({ ...baseNoRoom, type: 'p131', stepC: 500 } as CeilingSpecFull)

  it('есть предупреждение — нет размеров помещения, расчёт по среднему расходу', () => {
    expect(res.warnings.some(w => w.includes('среднему расходу'))).toBe(true)
  })

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

  it('раскрой профиля не считается в fallback-режиме (нет размеров для геометрии)', () => {
    expect(res.profileCutList).toBeNull()
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

  // 19.07.2026: лист идёт вдоль ОСНОВНОГО профиля — при дефолте (несущий
  // вдоль length=5000) это значит лист вдоль width=4000, не вдоль length.
  // colCount = ceil(4000/2500) = 2 колонки по ширине (1 целая 2500 + 1 резаная 1500)
  // rowCount = ceil(5000/1200) = 5 рядов по длине (4 целых по 1200 + 1 резаный 200мм)
  it('colCount = 2 (4000 / 2500 → 2 колонки по ширине, вдоль основного)', () => {
    expect(layout.colCount).toBe(2)
  })

  it('rowCount = 5 (5000 / 1200 → 5 рядов по длине)', () => {
    expect(layout.rowCount).toBe(5)
  })

  it('totalSheets = 10', () => {
    expect(layout.totalSheets).toBe(10)
  })

  it('fullSheets = 4 (1 полная колонка × 4 полных ряда)', () => {
    // 5000 % 1200 = 200 → последний ряд резаный → fullRows = 4
    // 4000 % 2500 = 1500 → последняя колонка резаная → fullCols = 1
    expect(layout.fullSheets).toBe(4)
  })

  it('cutSheets = 6', () => {
    expect(layout.cutSheets).toBe(6)
  })
})

describe('calcCeilingSheetLayout — раскрой 2500×2400мм (несущий вдоль length по дефолту → лист вдоль ОСНОВНОГО, то есть вдоль width)', () => {
  const spec: CeilingSpecFull = { ...BASE, roomLengthMm: 2500, roomWidthMm: 2400,
    sheetLengthMm: 2500, areaSqm: 6, perimeterM: 9.8 }
  const res = calcCeiling(spec)
  const layout = res.sheetLayout!

  // 19.07.2026 (уточнение от пользователя, см. calcCeilingSheetLayout выше):
  // лист идёт вдоль ОСНОВНОГО профиля, то есть ПЕРПЕНДИКУЛЯРНО несущему —
  // при дефолте (несущий вдоль length=2500) лист вдоль width=2400:
  // ceil(2400/2500)=1 кол (обрезной, 2400<2500) × ceil(2500/1200)=3 ряда
  // (2 целых по 1200 + 1 резаный 100мм) = 3 листа, все резаные (0 целых)
  it('totalSheets = 3', () => {
    expect(layout.totalSheets).toBe(3)
  })

  it('fullSheets = 0', () => {
    expect(layout.fullSheets).toBe(0)
  })

  it('cutSheets = 3', () => {
    expect(layout.cutSheets).toBe(3)
  })

  it('rotated = true (лист вдоль width=2400, не вдоль length=2500)', () => {
    expect(layout.rotated).toBe(true)
  })
})

describe('calcCeilingSheetLayout — раскрой 2400×2500мм (19.07.2026: ориентация — лист вдоль ОСНОВНОГО, торец на несущий, не наоборот)', () => {
  // Те же размеры но переставлены местами. bearingAlongLength не задан ->
  // дефолт true (несущий вдоль length=2400) -> лист вдоль ОСНОВНОГО, то есть
  // вдоль width=2500 — НЕ по выбору "что выгоднее по отходам", а строго по
  // направлению основного профиля (уточнение пользователя 19.07.2026,
  // прямое исправление предыдущей версии этого же фикса от того же дня,
  // где было перепутано местами несущий/основной — см. комментарий-объяснение
  // у calcCeilingSheetLayout).
  const spec: CeilingSpecFull = { ...BASE, roomLengthMm: 2400, roomWidthMm: 2500,
    sheetLengthMm: 2500, areaSqm: 6, perimeterM: 9.8 }
  const res = calcCeiling(spec)
  const layout = res.sheetLayout!

  // Длина листа вдоль roomWidthMm=2500 (повёрнут относительно "как считалось
  // бы вдоль length"): ceil(2500/2500)=1 кол × ceil(2400/1200)=2 ряда =
  // 2 листа, оба целые, 0 резаных
  it('totalSheets = 2', () => {
    expect(layout.totalSheets).toBe(2)
  })

  it('fullSheets = 2', () => {
    expect(layout.fullSheets).toBe(2)
  })

  it('cutSheets = 0', () => {
    expect(layout.cutSheets).toBe(0)
  })

  it('rotated = true (несущий вдоль length по дефолту — лист вдоль width, т.е. вдоль основного)', () => {
    expect(layout.rotated).toBe(true)
  })

  it('bearingAlongLength=false — несущий вдоль width, лист (вдоль основного) идёт вдоль length', () => {
    const flippedSpec: CeilingSpecFull = { ...spec, bearingAlongLength: false }
    const flippedLayout = calcCeiling(flippedSpec).sheetLayout!
    // Длина листа вдоль roomLengthMm=2400: ceil(2400/2500)=1 кол (резаный) ×
    // ceil(2500/1200)=3 ряда (2 целых + 1 резаный) = 3 листа, 0 целых, 3 резаных
    expect(flippedLayout.rotated).toBeFalsy()
    expect(flippedLayout.totalSheets).toBe(3)
    expect(flippedLayout.cutSheets).toBe(3)
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

  it('РЕГРЕСС 15.07.2026: layers=2 учитывается в раскрое по контуру (было — всегда 1 слой, gklLayers жёстко захардкожен)', () => {
    const specL1 = { ...spec, layers: 1 as const }
    const specL2 = { ...spec, layers: 2 as const }
    const resL1 = calcCeiling(specL1, { outerMm: outer, holesMm: [], startSide })
    const resL2 = calcCeiling(specL2, { outerMm: outer, holesMm: [], startSide })
    expect(resL1.polygonSheetLayout?.layer2).toBeNull()
    expect(resL2.polygonSheetLayout?.layer2).not.toBeNull()
    // Второй слой той же площади — примерно вдвое больше листов нужно
    expect(resL2.polygonSheetLayout!.totalSheetsNeeded).toBeGreaterThan(resL1.polygonSheetLayout!.totalSheetsNeeded)
  })
})

describe('calcCeiling — с polygonInput, П113 (13.07.2026, calcPolygonP113Frame подключён)', () => {
  // Тот же прямоугольник 5000×4000, что и в блоке для П112 выше — сверяем
  // материалы полигональной ветки с прямоугольной точной геометрией П113
  // (hasPreciseGeometryP113, calcP113Frame.ts) — на прямоугольнике оба пути
  // должны давать одинаковые метры/штуки профиля и соединителей.
  const outer = [
    { x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 },
  ]
  const startSide = { start: outer[0], end: outer[1] }
  const polygonSpec: CeilingSpecFull = {
    type: 'p113', layers: 1, material: 'gsp', thickness: 12.5,
    stepC: 600, areaSqm: 20, perimeterM: 18, slabGapMm: 80, sheetLengthMm: 2500,
    roomLengthMm: 0, roomWidthMm: 0,
  }
  const rectSpec: CeilingSpecFull = {
    ...polygonSpec, roomLengthMm: 5000, roomWidthMm: 4000,
  }
  const resPolygon = calcCeiling(polygonSpec, { outerMm: outer, holesMm: [], startSide })
  const resRect = calcCeiling(rectSpec)

  it('нет предупреждения про "средний расход" — использована точная геометрия по контуру', () => {
    expect(resPolygon.warnings.some(w => w.includes('среднему расходу'))).toBe(false)
  })

  it('polygonFrame заполнен, прямоугольный sheetLayout — null', () => {
    expect(resPolygon.polygonFrame).not.toBeNull()
    expect(resPolygon.sheetLayout).toBeNull()
  })

  it('метки материалов — одноуровневая система П113 (не "двухуровневый")', () => {
    expect(resPolygon.materials.some(m => m.name.includes('Соединитель одноуровневый'))).toBe(true)
    expect(resPolygon.materials.some(m => m.name.includes('Соединитель двухуровневый'))).toBe(false)
    expect(resPolygon.materials.find(m => m.name.includes('основной'))?.name).toContain('сплошной')
    expect(resPolygon.materials.find(m => m.name.includes('несущий'))?.name).toContain('вставки')
  })

  it('на прямоугольнике даёт те же метры/штуки, что и точная rect-геометрия (hasPreciseGeometryP113)', () => {
    const byName = (r: typeof resPolygon, needle: string) => r.materials.find(m => m.name.includes(needle))?.qty
    expect(byName(resPolygon, 'основной')).toBe(byName(resRect, 'основной'))
    expect(byName(resPolygon, 'несущий')).toBe(byName(resRect, 'несущий'))
    expect(byName(resPolygon, 'одноуровневый')).toBe(byName(resRect, 'одноуровневый'))
    expect(byName(resPolygon, 'Анкер-клин')).toBe(byName(resRect, 'Анкер-клин'))
  })

  it('без polygonInput (тот же spec, roomLengthMm/roomWidthMm=0) — не полигональная ветка, polygonFrame пуст', () => {
    // roomLengthMm/roomWidthMm у polygonSpec — 0, поэтому без polygonInput ни
    // hasPolygonGeometryP113, ни hasPreciseGeometryP113 не активны — уходит в
    // средний расход на м² (fallback), но это не предмет данного теста, важно
    // только что полигональная геометрия не подставляется случайно.
    const fallback = calcCeiling(polygonSpec)
    expect(fallback.polygonFrame).toBeNull()
  })
})

// ─── Нониус-подвес + уклонное перекрытие (03.09.2026) ────────────────────────
// Реальный кейс пользователя: второй этаж, косая несущая плита, опуск
// 2000-2700мм вдоль длины помещения, система крепления — нониус-подвес.

describe('calcCeiling — П112, уклонное перекрытие + нониус-подвес (реальный кейс объекта)', () => {
  const SLOPE: CeilingSpecFull = {
    ...BASE, stepB: 900, bearingAlongLength: true,
    hangerSystem: 'nonius', slopeGapMinMm: 2000, slopeGapMaxMm: 2700, slopeAxis: 'length',
  }
  const res = calcCeiling(SLOPE)

  it('точная геометрия сработала без slabGapMm (одних slope-полей достаточно)', () => {
    expect(res.warnings.some(w => w.includes('среднему расходу'))).toBe(false)
  })

  it('в смете есть строки нониус-подвеса (верхняя/нижняя часть, удлинитель, шплинт) — не одна усреднённая строка тяги', () => {
    const names = res.materials.map(m => m.name)
    expect(names.some(n => n.includes('нижняя часть'))).toBe(true)
    expect(names.some(n => n.includes('удлинитель'))).toBe(true)
    expect(names.some(n => n.includes('Шплинт'))).toBe(true)
    expect(names.some(n => n.includes('Тяга'))).toBe(false) // knauf_rod-строк быть не должно
  })

  it('количество нижних частей нониуса = общему числу подвесов (по одной на каждый)', () => {
    const geo = calcP112FrameGeometry(
      SLOPE.roomLengthMm!, SLOPE.roomWidthMm!, SLOPE.stepC, resolveFrameParams({
        stepC: SLOPE.stepC, layoutMode: 'user', userStepB: SLOPE.stepB,
      }).stepB, 2000, true, 'user', { stepA: undefined },
    )
    const bottomLine = res.materials.find(m => m.name.includes('нижняя часть'))
    expect(bottomLine?.qty).toBe(geo.hangersTotal)
  })

  it('без указания системы (по умолчанию knauf_rod) при том же уклоне видно предупреждение про опуск >1000мм', () => {
    const defaultSystem = calcCeiling({ ...SLOPE, hangerSystem: undefined })
    expect(defaultSystem.warnings.some(w => w.includes('1000мм'))).toBe(true)
  })
})
