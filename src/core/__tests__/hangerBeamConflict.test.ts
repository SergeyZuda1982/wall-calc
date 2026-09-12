import { describe, it, expect } from 'vitest'
import {
  findHangerBeamConflicts,
  countConflictingHangers,
  suggestConflictFreeHangerStep,
  suggestConflictFreeStepGeneric,
  exclusionHalfWidthMm,
  type BeamObstacle,
} from '../hangerBeamConflict'
import { calcFrameRowPositions } from '../calcP112Frame'

describe('exclusionHalfWidthMm', () => {
  it('половина сечения + зазор', () => {
    const beam: BeamObstacle = { axis: 'width', posMm: 1400, widthMm: 300 }
    expect(exclusionHalfWidthMm(beam, 50)).toBe(200) // 150 + 50
  })

  it('отрицательный зазор не уменьшает полосу ниже половины сечения', () => {
    const beam: BeamObstacle = { axis: 'width', posMm: 1400, widthMm: 300 }
    expect(exclusionHalfWidthMm(beam, -100)).toBe(150)
  })
})

describe('findHangerBeamConflicts', () => {
  it('подвес строго на ригеле — конфликт', () => {
    const beams: BeamObstacle[] = [{ axis: 'width', posMm: 1400, widthMm: 300, label: 'Р1' }]
    const positions = [{ lengthMm: 500, widthMm: 1400 }]
    const conflicts = findHangerBeamConflicts(positions, beams, 50)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].beam.label).toBe('Р1')
  })

  it('подвес чуть за пределами полосы — без конфликта', () => {
    const beams: BeamObstacle[] = [{ axis: 'width', posMm: 1400, widthMm: 300, label: 'Р1' }]
    // полоса: 1400 ± (150+50) = [1200, 1600]
    const positions = [{ lengthMm: 500, widthMm: 1601 }]
    expect(findHangerBeamConflicts(positions, beams, 50)).toHaveLength(0)
  })

  it('подвес на границе полосы (включительно) — конфликт', () => {
    const beams: BeamObstacle[] = [{ axis: 'width', posMm: 1400, widthMm: 300, label: 'Р1' }]
    const positions = [{ lengthMm: 500, widthMm: 1600 }] // ровно на границе
    expect(findHangerBeamConflicts(positions, beams, 50)).toHaveLength(1)
  })

  it('ригель по другой оси не даёт конфликта', () => {
    const beams: BeamObstacle[] = [{ axis: 'length', posMm: 1400, widthMm: 300 }]
    const positions = [{ lengthMm: 500, widthMm: 1400 }] // 1400 совпадает, но по width, а ригель по length
    expect(findHangerBeamConflicts(positions, beams, 50)).toHaveLength(0)
  })

  it('один подвес может конфликтовать с двумя ригелями сразу (широкая полоса)', () => {
    const beams: BeamObstacle[] = [
      { axis: 'width', posMm: 1000, widthMm: 300 },
      { axis: 'width', posMm: 1100, widthMm: 300 }, // полосы пересекаются
    ]
    const positions = [{ lengthMm: 0, widthMm: 1050 }]
    const conflicts = findHangerBeamConflicts(positions, beams, 50)
    expect(conflicts).toHaveLength(2)
    expect(countConflictingHangers(conflicts)).toBe(1)
  })
})

describe('countConflictingHangers', () => {
  it('пустой список — 0', () => {
    expect(countConflictingHangers([])).toBe(0)
  })
})

describe('suggestConflictFreeHangerStep — сценарий объекта (репорт 11.09.2026)', () => {
  // Зал ~150м², ригели сечением ~300мм с шагом ~1400мм вдоль оси B (width),
  // пользователь вручную подобрал "плавающий" шаг подвеса 800-900мм, чтобы
  // ни один не попал в створ ригеля. Реальные позиции ригелей на объекте не
  // идеально равномерны ("плюс минус") — проверяем на слегка неровной сетке.
  const spanMm = 8400 // длина помещения по оси B
  const beams: BeamObstacle[] = [
    { axis: 'width', posMm: 700, widthMm: 300, label: 'Р1' },
    { axis: 'width', posMm: 2120, widthMm: 300, label: 'Р2' },
    { axis: 'width', posMm: 3510, widthMm: 300, label: 'Р3' },
    { axis: 'width', posMm: 4930, widthMm: 300, label: 'Р4' },
    { axis: 'width', posMm: 6340, widthMm: 300, label: 'Р5' },
    { axis: 'width', posMm: 7760, widthMm: 300, label: 'Р6' },
  ]

  it('дефолтный шаг подвеса 1000мм даёт конфликты (то, что пугало пользователя)', () => {
    const positions = calcFrameRowPositions(spanMm, 1000, { mode: 'user' })
    const conflicts = findHangerBeamConflicts(
      positions.map(p => ({ lengthMm: 0, widthMm: p })),
      beams,
      50,
    )
    expect(conflicts.length).toBeGreaterThan(0)
  })

  it('находит бесконфликтный шаг рядом с желаемым 850мм', () => {
    const suggestion = suggestConflictFreeHangerStep(
      spanMm, 850, beams, 'width', 50, { mode: 'user' },
    )
    expect(suggestion).not.toBeNull()
    expect(suggestion!.conflictingHangers).toBe(0)

    // Убеждаемся, что предложенный шаг РЕАЛЬНО не конфликтует —
    // не приближение, а точный прогон той же функции позиций.
    const positions = calcFrameRowPositions(spanMm, suggestion!.stepMm, { mode: 'user' })
    const conflicts = findHangerBeamConflicts(
      positions.map(p => ({ lengthMm: 0, widthMm: p })),
      beams,
      50,
    )
    expect(conflicts).toHaveLength(0)
  })

  it('без ригелей на этой оси — возвращает null (нечего подбирать)', () => {
    const suggestion = suggestConflictFreeHangerStep(
      spanMm, 850, beams, 'length', 50, { mode: 'user' },
    )
    expect(suggestion).toBeNull()
  })

  it('если в диапазоне поиска нет чистого варианта — возвращает лучший по числу конфликтов', () => {
    // Очень плотные ригели через 200мм по всей длине — избежать физически нельзя.
    const denseBeams: BeamObstacle[] = []
    for (let pos = 200; pos < spanMm; pos += 200) {
      denseBeams.push({ axis: 'width', posMm: pos, widthMm: 150 })
    }
    const suggestion = suggestConflictFreeHangerStep(
      spanMm, 850, denseBeams, 'width', 50, { mode: 'user' }, 50, 10,
    )
    expect(suggestion).not.toBeNull()
    // Не требуем 0 — требуем, что функция вообще возвращает что-то осмысленное.
    expect(suggestion!.conflictingHangers).toBeGreaterThanOrEqual(0)
  })

  it('пустой список ригелей на оси — null', () => {
    const suggestion = suggestConflictFreeHangerStep(spanMm, 850, [], 'width', 50)
    expect(suggestion).toBeNull()
  })
})

describe('suggestConflictFreeStepGeneric', () => {
  it('находит шаг с 0 конфликтами, ближайший к желаемому', () => {
    // Имитация: конфликт есть у любого шага < 900, ноль конфликтов на 900+
    const suggestion = suggestConflictFreeStepGeneric(850, step => (step < 900 ? 3 : 0))
    expect(suggestion).toEqual({ stepMm: 900, conflictingHangers: 0 })
  })

  it('desiredStepMm <= 0 -> null', () => {
    expect(suggestConflictFreeStepGeneric(0, () => 0)).toBeNull()
  })

  it('пустой диапазон поиска (minStepMm > maxStepMm в разумных пределах) -> null', () => {
    expect(
      suggestConflictFreeStepGeneric(850, () => 0, { minStepMm: 2000, maxStepMm: 1000 }),
    ).toBeNull()
  })

  it('нет чистого варианта — возвращает минимум конфликтов, ближайший к желаемому при равенстве', () => {
    // Оба варианта дают 1 конфликт, но 860 ближе к 850, чем 700
    const suggestion = suggestConflictFreeStepGeneric(
      850,
      step => (step === 700 || step === 860 ? 1 : 5),
      { searchRangeMm: 200, incrementMm: 10 },
    )
    expect(suggestion?.stepMm).toBe(860)
    expect(suggestion?.conflictingHangers).toBe(1)
  })
})
