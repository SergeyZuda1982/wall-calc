import { describe, it, expect } from 'vitest'
import {
  buildPositions,
  buildFromPhase,
  buildOpeningStuds,
  mergeStuds,
  MIN_GAP,
} from '../buildPositions'
import type { Opening } from '../../types'

// ─── Хелпер ──────────────────────────────────────────────────────────────────

function door(pos: number, width: number): Opening {
  return { id: `d${pos}`, type: 'door', pos, width, height: 2100, sillHeight: 0 }
}
function window_(pos: number, width: number): Opening {
  return { id: `w${pos}`, type: 'window', pos, width, height: 1200, sillHeight: 900 }
}

// ─── buildOpeningStuds ────────────────────────────────────────────────────────

describe('buildOpeningStuds', () => {
  it('возвращает две стойки для одного дверного проёма', () => {
    const studs = buildOpeningStuds([door(100, 900)])
    expect(studs).toHaveLength(2)
    expect(studs.map(s => s.pos)).toEqual([100, 1000])
    expect(studs.every(s => s.kind === 'door')).toBe(true)
  })

  it('возвращает стойки kind=window для оконного проёма', () => {
    const studs = buildOpeningStuds([window_(500, 1200)])
    expect(studs.every(s => s.kind === 'window')).toBe(true)
    expect(studs.map(s => s.pos)).toEqual([500, 1700])
  })

  it('пропускает проём с нулевой шириной', () => {
    const studs = buildOpeningStuds([{ ...door(100, 0) }])
    expect(studs).toHaveLength(0)
  })

  it('два проёма → четыре стойки', () => {
    const studs = buildOpeningStuds([door(100, 900), window_(2000, 1200)])
    expect(studs).toHaveLength(4)
  })
})

// ─── mergeStuds ──────────────────────────────────────────────────────────────

describe('mergeStuds', () => {
  it('всегда добавляет крайние стойки 0 и l', () => {
    const result = mergeStuds([], [], 3000, 'both')
    expect(result.map(s => s.pos)).toEqual([0, 3000])
  })

  it('крайние стойки kind=wall при abutment=both', () => {
    const result = mergeStuds([], [], 3000, 'both')
    expect(result[0].kind).toBe('wall')
    expect(result[result.length - 1].kind).toBe('wall')
  })

  it('крайние стойки kind=free при abutment=none', () => {
    const result = mergeStuds([], [], 3000, 'none')
    expect(result[0].kind).toBe('free')
    expect(result[result.length - 1].kind).toBe('free')
  })

  it('abutment=left: левая wall, правая free', () => {
    const result = mergeStuds([], [], 3000, 'left')
    expect(result[0].kind).toBe('wall')
    expect(result[result.length - 1].kind).toBe('free')
  })

  it('рядовая стойка получает kind=middle', () => {
    const result = mergeStuds([600, 1200, 1800, 2400], [], 3000, 'both')
    const middles = result.filter(s => s.kind === 'middle')
    expect(middles.map(s => s.pos)).toEqual([600, 1200, 1800, 2400])
  })

  it('стойка проёма вытесняет рядовую на той же позиции', () => {
    const openingStuds = [{ pos: 1000, kind: 'door' as const }]
    const result = mergeStuds([1000], openingStuds, 3000, 'both')
    const at1000 = result.filter(s => s.pos === 1000)
    expect(at1000).toHaveLength(1)
    expect(at1000[0].kind).toBe('door')
  })

  it('результат всегда отсортирован по pos', () => {
    const studs = buildOpeningStuds([door(1500, 900)])
    const result = mergeStuds([600, 1200, 2400], studs, 3000, 'both')
    const positions = result.map(s => s.pos)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})

// ─── buildPositions ───────────────────────────────────────────────────────────

describe('buildPositions', () => {
  it('без проёмов — сетка от first до l с шагом s', () => {
    const { positions } = buildPositions(3000, 600, 0, [])
    expect(positions).toEqual([0, 600, 1200, 1800, 2400, 3000])
  })

  it('крайние стойки всегда 0 и l', () => {
    const { positions } = buildPositions(6160, 600, 0, [])
    expect(positions[0]).toBe(0)
    expect(positions[positions.length - 1]).toBe(6160)
  })

  it('торцевые стойки проёма всегда присутствуют', () => {
    const d = door(1000, 900)
    const { positions } = buildPositions(5000, 600, 0, [d])
    expect(positions).toContain(1000)
    expect(positions).toContain(1900)
  })

  it('шаг 400 — рядовые на 400, 800, 1200...', () => {
    const { positions } = buildPositions(2400, 400, 0, [])
    expect(positions).toEqual([0, 400, 800, 1200, 1600, 2000, 2400])
  })

  it('алгоритм убирает конфликты когда возможен сдвиг', () => {
    // Дверь ширина 1000мм на pos=100 (торцевые на 100 и 1100), шаг 600.
    // При фазе 0: рядовая на 600 → расстояние до 1100 = 500 > MIN_GAP, до 100 = 500 > MIN_GAP,
    // НО: рядовая на 600 — нет конфликта тут. Конфликт в том что 600-100=500 ok,
    // но рядовая 600 к 1100: 600-100=500 OK. Тест подтверждён node-скриптом:
    // phase=0 → 1 конфликт (стойка 600, до торцевой 100 → 500 OK, но вторая торцевая 1100: 600-1100=500 OK).
    // Ждать: phase=260 → 0 конфликтов. Рядовые: 260, 860, 1460...
    // Это единственный кейс со step=600 где алгоритм находит фазу с нулём конфликтов.
    const d: Opening = { id: 'd', type: 'door', pos: 100, width: 1000, height: 2100, sillHeight: 0 }
    const { positions } = buildPositions(6000, 600, 0, [d])
    const regulars = positions.filter(p => p !== 0 && p !== 6000 && p !== 100 && p !== 1100)
    // После оптимизации — ноль конфликтов достижим, проверяем что алгоритм его нашёл
    const conflicts = regulars.filter(p => Math.abs(p - 100) <= MIN_GAP || Math.abs(p - 1100) <= MIN_GAP)
    expect(conflicts).toHaveLength(0)
  })

  it('алгоритм возвращает phase — фазу использованной сетки', () => {
    const { phase } = buildPositions(3000, 600, 0, [])
    expect(typeof phase).toBe('number')
    expect(phase).toBeGreaterThanOrEqual(0)
    expect(phase).toBeLessThan(600)
  })
})

// ─── buildFromPhase ───────────────────────────────────────────────────────────

describe('buildFromPhase', () => {
  it('phase=300, step=600 → первая рядовая на 300', () => {
    const { positions } = buildFromPhase(3000, 600, 300, [])
    expect(positions).toContain(300)
    expect(positions).toContain(900)
    expect(positions).toContain(1500)
  })

  it('возвращает нормализованную фазу (phase mod step)', () => {
    const { phase } = buildFromPhase(3000, 600, 700, [])
    expect(phase).toBe(100) // 700 mod 600 = 100
  })

  it('при ручном сдвиге стойки НЕ удаляются даже при конфликте', () => {
    // сдвинули гребёнку вплотную к торцевой проёма
    const d = door(1000, 900)
    const { positions } = buildFromPhase(5000, 600, 950, [d]) // рядовая на 950 — до двери 50мм < MIN_GAP
    expect(positions).toContain(950) // стойка остаётся
    expect(positions).toContain(1000) // торцевая тоже
  })
})
