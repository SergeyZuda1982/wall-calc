import { describe, it, expect } from 'vitest'
import { calcCeilingProfileCutListP112, calcCeilingProfileCutListP113 } from '../ceilingCutList'
import { BAR_LENGTH } from '../cutList'

// 05.09.2026 — запрос пользователя: остатки профиля потолка, как у
// стен/облицовки. calcCeilingCutList просто раскладывает одинаковые (П112)
// или разной длины (П113, короткие вставки несущего) куски по пруткам
// 3000мм через уже существующий FFD-упаковщик buildCutList (cutList.ts).

describe('calcCeilingProfileCutListP112', () => {
  it('куски короче прутка — упаковываются несколько в один прутoк', () => {
    // 6 кусков по 1000мм основного -> помещается по 3 в прутoк -> 2 прутка, без остатка
    const { main } = calcCeilingProfileCutListP112(1000, 6, 2000, 1)
    expect(main.totalBars).toBe(2)
    expect(main.totalWaste).toBe(0)
  })

  it('кусок длиннее прутка — режется на сегменты ≤3000мм, каждый кусок целиком', () => {
    // Один кусок 4200мм -> 3000 + 1200 (2 сегмента от одного физического куска)
    const { main } = calcCeilingProfileCutListP112(4200, 1, 1000, 1)
    const allLengths = main.bars.flatMap(b => b.pieces.map(p => p.piece.length)).sort((a, b) => b - a)
    expect(allLengths).toEqual(expect.arrayContaining([3000, 1200]))
    for (const len of allLengths) expect(len).toBeLessThanOrEqual(BAR_LENGTH)
  })

  it('несущий считается отдельным пулом от основного (не смешиваются в одном прутке)', () => {
    const { main, bearing } = calcCeilingProfileCutListP112(1500, 2, 1500, 2)
    // оба пула по 2 куска 1500мм -> по одному прутку на каждый пул (3000 без остатка)
    expect(main.totalBars).toBe(1)
    expect(bearing.totalBars).toBe(1)
    expect(main.totalWaste).toBe(0)
    expect(bearing.totalWaste).toBe(0)
  })

  it('суммарная длина кусков = суммарная длина использованного профиля (без потерь материала)', () => {
    const { main } = calcCeilingProfileCutListP112(1730, 5, 1000, 1)
    const totalPieces = main.bars.reduce((s, b) => s + b.pieces.reduce((s2, p) => s2 + p.piece.length, 0), 0)
    expect(totalPieces).toBe(1730 * 5)
  })
})

describe('calcCeilingProfileCutListP113', () => {
  it('несущий — разные длины вставок, повторяются на каждом ряду', () => {
    const segments = [1400, 1400, 1400] // 3 вставки на ряд
    const { bearing } = calcCeilingProfileCutListP113(4000, 2, segments, 2) // 2 ряда
    const totalPieces = bearing.bars.reduce((s, b) => s + b.pieces.length, 0)
    expect(totalPieces).toBe(segments.length * 2) // 3 вставки × 2 ряда = 6 кусков
  })

  it('основной считается так же, как у П112 (сплошной, одна длина)', () => {
    const { main } = calcCeilingProfileCutListP113(1000, 6, [500], 1)
    expect(main.totalBars).toBe(2) // 6×1000 -> по 3 в прутoк -> 2 прутка
    expect(main.totalWaste).toBe(0)
  })
})
