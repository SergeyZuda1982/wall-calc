import { describe, it, expect } from 'vitest'
import { buildCutList, pnPieces, psPieces, BAR_LENGTH } from '../cutList'
import { calcStudMaterial } from '../calcStudMaterial'
import type { Piece } from '../cutList'

// ─── buildCutList ─────────────────────────────────────────────────────────────

describe('buildCutList', () => {
  it('пустой список → 0 прутков', () => {
    const result = buildCutList([])
    expect(result.totalBars).toBe(0)
    expect(result.totalWaste).toBe(0)
  })

  it('один кусок 2700мм → один пруток, остаток 300мм', () => {
    const pieces: Piece[] = [{ length: 2700, role: 'stud', label: 'Стойка', mustBeWhole: false }]
    const result = buildCutList(pieces)
    expect(result.totalBars).toBe(1)
    expect(result.bars[0].waste).toBe(300)
  })

  it('три куска по 1000мм → один пруток 3000мм (остаток 0)', () => {
    const pieces: Piece[] = Array(3).fill(null).map(() => ({
      length: 1000, role: 'floor' as const, label: '1000', mustBeWhole: false
    }))
    const result = buildCutList(pieces)
    expect(result.totalBars).toBe(1)
    expect(result.totalWaste).toBe(0)
  })

  it('четыре куска по 1000мм → два прутка', () => {
    const pieces: Piece[] = Array(4).fill(null).map(() => ({
      length: 1000, role: 'floor' as const, label: '1000', mustBeWhole: false
    }))
    const result = buildCutList(pieces)
    expect(result.totalBars).toBe(2)
  })

  it('FFD: большой кусок + маленький вместе в один пруток, крупный отдельно', () => {
    // 2800 + 100 = 2900 ≤ 3000, помещаются в один пруток
    // 500 → второй пруток
    const pieces: Piece[] = [
      { length: 500, role: 'floor', label: '500', mustBeWhole: false },
      { length: 2800, role: 'stud', label: '2800', mustBeWhole: false },
      { length: 100, role: 'ceiling', label: '100', mustBeWhole: false },
    ]
    const result = buildCutList(pieces)
    expect(result.totalBars).toBe(2)
  })

  it('totalWaste = сумма остатков всех прутков', () => {
    const pieces: Piece[] = [
      { length: 1500, role: 'stud', label: '1500', mustBeWhole: false },
      { length: 1500, role: 'stud', label: '1500', mustBeWhole: false },
      { length: 1500, role: 'stud', label: '1500', mustBeWhole: false },
    ]
    const result = buildCutList(pieces)
    // 1500+1500 в первый пруток (0 остаток), 1500 во второй (1500 остаток)
    expect(result.totalWaste).toBe(1500)
    expect(result.bars.reduce((s, b) => s + b.waste, 0)).toBe(result.totalWaste)
  })

  it('BAR_LENGTH = 3000', () => {
    expect(BAR_LENGTH).toBe(3000)
  })

  it('два куска mustBeWhole=true по 2900 → два прутка (нельзя в один)', () => {
    const pieces: Piece[] = [
      { length: 2900, role: 'lintel', label: 'Перемычка', mustBeWhole: true },
      { length: 2900, role: 'lintel', label: 'Перемычка', mustBeWhole: true },
    ]
    const result = buildCutList(pieces)
    expect(result.totalBars).toBe(2)
  })
})

// ─── pnPieces ─────────────────────────────────────────────────────────────────

describe('pnPieces', () => {
  it('без проёмов: пол = l, потолок = l', () => {
    const pieces = pnPieces(3000, [])
    const floor = pieces.filter(p => p.role === 'floor')
    const ceiling = pieces.filter(p => p.role === 'ceiling')
    expect(floor.reduce((s, p) => s + p.length, 0)).toBe(3000)
    expect(ceiling.reduce((s, p) => s + p.length, 0)).toBe(3000)
  })

  it('дверной проём вырезает пол', () => {
    const pieces = pnPieces(5000, [{ type: 'door', pos: 1000, width: 900, sillHeight: 0 }])
    const floorTotal = pieces.filter(p => p.role === 'floor').reduce((s, p) => s + p.length, 0)
    expect(floorTotal).toBe(5000 - 900) // 4100
  })

  it('оконный проём НЕ вырезает пол', () => {
    const pieces = pnPieces(5000, [{ type: 'window', pos: 1000, width: 1200, sillHeight: 900 }])
    const floorTotal = pieces.filter(p => p.role === 'floor').reduce((s, p) => s + p.length, 0)
    expect(floorTotal).toBe(5000) // пол не прерывается
  })

  it('перемычка = ширина + 400мм, mustBeWhole=true', () => {
    const pieces = pnPieces(5000, [{ type: 'door', pos: 1000, width: 900, sillHeight: 0 }])
    const lintel = pieces.find(p => p.role === 'lintel')
    expect(lintel?.length).toBe(900 + 400)
    expect(lintel?.mustBeWhole).toBe(true)
  })

  it('подоконник = ширина + 400мм, mustBeWhole=true (только для окна)', () => {
    const pieces = pnPieces(5000, [{ type: 'window', pos: 1000, width: 1200, sillHeight: 900 }])
    const sill = pieces.find(p => p.role === 'sill')
    expect(sill?.length).toBe(1200 + 400)
    expect(sill?.mustBeWhole).toBe(true)
  })

  it('потолок всегда полная длина стены (без проёмов в потолке)', () => {
    const pieces = pnPieces(5000, [{ type: 'door', pos: 500, width: 900, sillHeight: 0 }])
    const ceilTotal = pieces.filter(p => p.role === 'ceiling').reduce((s, p) => s + p.length, 0)
    expect(ceilTotal).toBe(5000)
  })

  it('две двери: суммарная длина пола = l − суммарная ширина дверей', () => {
    // Сегменты 500 + 600 + 3100мм. Отрезок 3100 > BAR_LENGTH → 3000+100 = 4 куска.
    // Проверяем сумму, а не количество кусков.
    const pieces = pnPieces(6000, [
      { type: 'door', pos: 500, width: 900, sillHeight: 0 },
      { type: 'door', pos: 2000, width: 900, sillHeight: 0 },
    ])
    const floorTotal = pieces.filter(p => p.role === 'floor').reduce((s, p) => s + p.length, 0)
    expect(floorTotal).toBe(6000 - 900 - 900) // 4200
  })

  it('сегмент пола > 3000мм разбивается на куски по BAR_LENGTH', () => {
    // Одна дверь в начале → сегмент после неё = 5000−900 = 4100мм → 3000+1100
    const pieces = pnPieces(5000, [{ type: 'door', pos: 0, width: 900, sillHeight: 0 }])
    const floors = pieces.filter(p => p.role === 'floor')
    expect(floors.every(p => p.length <= BAR_LENGTH)).toBe(true)
    expect(floors.reduce((s, p) => s + p.length, 0)).toBe(4100)
  })
})

// ─── psPieces ─────────────────────────────────────────────────────────────────

describe('psPieces', () => {
  const opening = { id: 'w1', height: 1200, sillHeight: 900 }

  it('h≤3000: одна стойка = один кусок длиной h', () => {
    const studs = [{ kind: 'middle', isAbove: false, openingId: null, orientation: 'up' }]
    const pieces = psPieces(studs, 2700, 500, [])
    expect(pieces).toHaveLength(1)
    expect(pieces[0].length).toBe(2700)
    expect(pieces[0].role).toBe('stud')
  })

  it('h>3000: две части — 3000 и (h−3000+overlap)', () => {
    const studs = [{ kind: 'middle', isAbove: false, openingId: null, orientation: 'up' }]
    const pieces = psPieces(studs, 3500, 500, [])
    expect(pieces).toHaveLength(2)
    const lengths = pieces.map(p => p.length).sort((a, b) => a - b)
    expect(lengths).toEqual([1000, 3000]) // 3500−3000+500=1000
  })

  it('стойка внутри оконного проёма: два коротких куска (над + под)', () => {
    // h=3000, проём height=1200 sillH=900 → above=3000-1200-900=900, below=900
    const studs = [{ kind: 'middle', isAbove: true, openingId: 'w1', orientation: 'up' }]
    const pieces = psPieces(studs, 3000, 500, [opening])
    expect(pieces).toHaveLength(2)
    const above = pieces.find(p => p.label.includes('Над'))
    const below = pieces.find(p => p.label.includes('Под'))
    expect(above?.length).toBe(900) // h − height − sillH
    expect(below?.length).toBe(900) // sillH
  })

  it('пять стоек h=2700 → пять кусков по 2700', () => {
    const studs = Array(5).fill({ kind: 'middle', isAbove: false, openingId: null, orientation: 'up' })
    const pieces = psPieces(studs, 2700, 500, [])
    expect(pieces).toHaveLength(5)
    expect(pieces.every(p => p.length === 2700)).toBe(true)
  })

  // ─── Регрессия: wall-стойка с h>3000 пропадала из раскроя ────────────────
  // Баг: psPieces клала ОДИН кусок длиной h (>3000) в раскрой для kind='wall',
  // а buildCutList тихо отбрасывает куски длиннее прутка (3000мм) —
  // в итоге крайние wall-стойки исчезали из раскроя и из суммарного метража.

  it('wall h>3000: два куска торец в торец (3000 + остаток), сумма = h', () => {
    const studs = [{ kind: 'wall', isAbove: false, openingId: null, orientation: 'down' }]
    const pieces = psPieces(studs, 3600, 750, [])
    expect(pieces).toHaveLength(2)
    expect(pieces.every(p => p.length <= BAR_LENGTH)).toBe(true)
    expect(pieces.reduce((s, p) => s + p.length, 0)).toBe(3600)
  })

  it('никакой кусок psPieces не длиннее прутка (инвариант для всех kind)', () => {
    const studs = [
      { kind: 'wall', isAbove: false, openingId: null, orientation: 'down' },
      { kind: 'wall', isAbove: false, openingId: null, orientation: 'down' },
      { kind: 'middle', isAbove: false, openingId: null, orientation: 'up' },
      { kind: 'free', isAbove: false, openingId: null, orientation: 'up' },
      { kind: 'free', isAbove: false, openingId: null, orientation: 'down' },
    ]
    const pieces = psPieces(studs, 3600, 750, [])
    expect(pieces.every(p => p.length <= BAR_LENGTH)).toBe(true)
  })

  it('сценарий пользователя: 6160×3600, both, overlap=750, 12 стоек — ни одна стойка не теряется', () => {
    // 2 wall (3600 каждая) + 10 middle (3600+750=4350 каждая) = 7200 + 43500 = 50700мм
    const studs = [
      { kind: 'wall', isAbove: false, openingId: null, orientation: 'down' },
      ...Array(10).fill({ kind: 'middle', isAbove: false, openingId: null, orientation: 'up' }),
      { kind: 'wall', isAbove: false, openingId: null, orientation: 'down' },
    ]
    const pieces = psPieces(studs, 3600, 750, [])
    const total = pieces.reduce((s, p) => s + p.length, 0)
    expect(total).toBe(50700)

    const cutResult = buildCutList(pieces)
    // Сумма уложенных кусков + отходы должна равняться полному метражу закупленных прутков
    const usedPlusWaste = cutResult.totalBars * BAR_LENGTH
    const actuallyPlaced = pieces.reduce((s, p) => s + p.length, 0)
    expect(usedPlusWaste).toBe(actuallyPlaced + cutResult.totalWaste)
  })

  // ─── Регрессия: соединительный кусок free считался как part2+overlap+overlapUp (1850) ────
  // вместо overlap+overlapUp (1250). Из-за этого сумма кусков раскроя (5450) расходилась
  // с calcStudMaterial().length (4850) — раскрой требовал на 600мм больше металла, чем
  // показывал итоговый метраж.

  it('free h=3600 overlap=750: соединительный кусок = 1250мм (НЕ 1850)', () => {
    const studs = [{ kind: 'free', isAbove: false, openingId: null, orientation: 'up' }]
    const pieces = psPieces(studs, 3600, 750, [])
    const connector = pieces.find(p => p.label.includes('соед.'))
    expect(connector?.length).toBe(1250)
  })

  it('free: сумма кусков psPieces совпадает с calcStudMaterial().length для разных h/overlap', () => {
    const cases: [number, number][] = [[3600, 750], [4200, 750], [3500, 500], [4500, 1000]]
    for (const [h, overlap] of cases) {
      const studs = [{ kind: 'free', isAbove: false, openingId: null, orientation: 'up' }]
      const pieces = psPieces(studs, h, overlap, [])
      const sum = pieces.reduce((s, p) => s + p.length, 0)
      const { length } = calcStudMaterial(h, 'free', overlap, 'up')
      expect(sum).toBe(length)
    }
  })
})
