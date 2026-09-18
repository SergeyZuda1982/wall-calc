import { describe, it, expect } from 'vitest'
import { calcCeilingBorder } from '../calcCeilingBorder'
import { BAR_LENGTH } from '../cutList'
import type { CeilingBorder } from '../../types'

// Реальный объект пользователя (16.09.2026, кинотеатр "Ростов", план
// "2 эт_ потолок.pdf"): 5 из 6 переходов между ступенями — с опуском 250мм.
// Прямой борт "от края до края" ~15м (как описал пользователь), путь без
// поворотов — 2 точки.
const STRAIGHT_15M: CeilingBorder = {
  id: 'b1',
  label: 'Борт 1',
  path: [{ x: 0, y: 0 }, { x: 15000, y: 0 }], // px здесь = мм 1:1 для простоты теста
  jointType: 'p112_p113_angle_connector',
  dropMm: 250,
  shelfDepthMm: 125,
  stepCMm: 600,
  sheetLengthMm: 2500,
}

describe('calcCeilingBorder — прямой борт 15м, опуск 250, полка 125, stepC 600', () => {
  const res = calcCeilingBorder(STRAIGHT_15M)

  it('длина пути = 15м, без внутренних углов', () => {
    expect(res.pathLengthM).toBeCloseTo(15, 6)
    expect(res.cornerCount).toBe(0)
  })

  it('соединители расставлены с шагом ~stepC, включая оба конца', () => {
    // 15000 / 600 = 25 интервалов ровно → 26 позиций
    expect(res.connectorCount).toBe(26)
  })

  it('вертикальный профиль 60×27: по одному на соединитель, упакован в прутки 3м', () => {
    const item = res.materials.find(m => m.name.includes('ПП 60×27'))
    expect(item).toBeDefined()
    // 3000мм пруток / 250мм опуск = 12 отрезков на пруток; 26 отрезков → 3 прутка
    expect(Math.floor(BAR_LENGTH / 250)).toBe(12)
    expect(item!.qty).toBe(3)
  })

  it('угловых соединителей 26, LN = 26×4', () => {
    const connectors = res.materials.find(m => m.name.startsWith('Соединитель угловой'))
    const ln = res.materials.find(m => m.name.includes('LN'))
    expect(connectors!.qty).toBe(26)
    expect(ln!.qty).toBe(26 * 4)
  })

  it('TN = число вертикальных отрезков × 3', () => {
    const tn = res.materials.find(m => m.name.includes('TN'))
    expect(tn!.qty).toBe(26 * 3)
  })

  it('верхний профиль 27×28 по всей длине пути, упакован в прутки 3м', () => {
    const item = res.materials.find(m => m.name.includes('ПНП 27×28'))
    expect(item).toBeDefined()
    // 15000 / 3000 = 5 прутков ровно
    expect(item!.qty).toBe(5)
  })

  it('лист ГКЛ борта: полоса 375мм (250+125) укладывается в 1200мм листа 3 дорожками', () => {
    const sheet = res.materials.find(m => m.name.includes('ГКЛ-лист'))
    expect(sheet).toBeDefined()
    // lanesPerSheet = floor(1200/375) = 3; покрытие за лист = 2500×3=7500мм
    // 15000 / 7500 = 2 листа ровно
    expect(sheet!.qty).toBe(2)
  })

  it('предупреждает про площадной (не точный) раскрой обшивки и про клей-пену', () => {
    expect(res.warnings.some(w => w.includes('БЕЗ точной'))).toBe(true)
    expect(res.warnings.some(w => w.includes('клей-пен'))).toBe(true)
  })
})

describe('calcCeilingBorder — Г-образный путь (1 внутренний угол)', () => {
  const L_SHAPED: CeilingBorder = {
    ...STRAIGHT_15M,
    path: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }],
  }
  const res = calcCeilingBorder(L_SHAPED)

  it('длина пути = сумма отрезков (6 + 4 = 10м), один внутренний угол', () => {
    expect(res.pathLengthM).toBeCloseTo(10, 6)
    expect(res.cornerCount).toBe(1)
  })

  it('вершина угла не задвоена: соединители = (10 интервалов на 6м + 6-7 на 4м) без двойного счёта общей точки', () => {
    // 6000/600=10 интервалов →11 позиций; 4000/600≈6.67→округление до 7 интервалов→8 позиций
    // итог: 11 + (8-1) = 18 (минус 1 — общая вершина угла не считается дважды)
    expect(res.connectorCount).toBe(18)
  })
})

describe('calcCeilingBorder — замкнутый борт кольцом по периметру', () => {
  // Прямоугольник 4×3м, путь явно замкнут повтором первой точки
  const RING: CeilingBorder = {
    ...STRAIGHT_15M,
    path: [
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 },
      { x: 0, y: 3000 }, { x: 0, y: 0 },
    ],
  }
  const res = calcCeilingBorder(RING)

  it('длина пути = периметр 14м, 3 внутренних угла (последняя точка = первая, не считается 4-м углом)', () => {
    expect(res.pathLengthM).toBeCloseTo(14, 6)
    expect(res.cornerCount).toBe(3)
  })

  it('точка стыка (конец=начало) не задвоена в счёте соединителей', () => {
    // проверяем это косвенно: сумма позиций по 4 отрезкам минус 4 общие вершины
    // (включая точку замыкания) должна быть меньше, чем если бы каждый отрезок
    // считался независимо
    const independentSum =
      (Math.round(4000 / 600) + 1) * 2 + (Math.round(3000 / 600) + 1) * 2
    expect(res.connectorCount).toBeLessThan(independentSum)
  })
})

describe('calcCeilingBorder — граничные случаи', () => {
  it('пустой/вырожденный путь — не падает, возвращает предупреждение', () => {
    const res = calcCeilingBorder({ ...STRAIGHT_15M, path: [{ x: 0, y: 0 }] })
    expect(res.pathLengthM).toBe(0)
    expect(res.materials).toEqual([])
    expect(res.warnings.length).toBeGreaterThan(0)
  })

  it('опуск больше стандартного прутка — предупреждает, не падает', () => {
    const res = calcCeilingBorder({ ...STRAIGHT_15M, dropMm: 3500 })
    expect(res.warnings.some(w => w.includes('сращивания'))).toBe(true)
  })

  it('полоса шире листа (опуск+полка > 1200) — предупреждает, не даёт 0/NaN листов', () => {
    const res = calcCeilingBorder({ ...STRAIGHT_15M, dropMm: 900, shelfDepthMm: 500 })
    const sheet = res.materials.find(m => m.name.includes('ГКЛ-лист'))
    expect(sheet!.qty).toBeGreaterThan(0)
    expect(Number.isFinite(sheet!.qty)).toBe(true)
    expect(res.warnings.some(w => w.includes('больше ширины листа'))).toBe(true)
  })
})
