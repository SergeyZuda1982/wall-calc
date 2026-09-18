import { describe, it, expect } from 'vitest'
import { calcProjectMaterialsSummary } from '../calcProjectMaterialsSummary'
import { buildPositions } from '../buildPositions'
import { calcResults } from '../calcResults'
import { flatProfile } from '../profileGeometry'
import { DEFAULT_BOARD_SPEC } from '../../types'
import type { WallEntry } from '../../store/useProjectStore'
import type { Ceiling, PlanLine, Room } from '../../types'
import type { CeilingSpecFull } from '../../data/ceilingData'

function singleWall(id: string, label: string, length = 4000, height = 2700): WallEntry {
  const { positions } = buildPositions(length, 600, 600, [])
  const cp = flatProfile(length, height)
  const fp = flatProfile(length, 0)
  const result = calcResults(positions, cp, fp, length, [], 'both', 500, 2, DEFAULT_BOARD_SPEC, DEFAULT_BOARD_SPEC, [], 2)
  return {
    id, label, kind: 'single',
    input: {
      wallType: 'c112', profileType: 'ps50', profileThickness: '06', abutment: 'both',
      length, height, step: 600, firstStud: 600, openings: [], communications: [],
      customOverlap: null, layer1: DEFAULT_BOARD_SPEC, layer2: DEFAULT_BOARD_SPEC, plywoodInserts: [],
    },
    result, doubleInput: null, doubleResult: null, positions,
  }
}

// Помещение 4000×5000мм = 20м², периметр 18м (тот же фикстур, что и calcCeiling.test.ts)
const CEILING_SPEC: CeilingSpecFull = {
  type: 'p112', layers: 1, material: 'gsp', thickness: 12.5, stepC: 600,
  areaSqm: 20, perimeterM: 18, roomLengthMm: 5000, roomWidthMm: 4000, sheetLengthMm: 2500,
  slabGapMm: 300, // без него calcCeiling уходит в fallback-режим (см. calcCeiling.test.ts) — там нет rawProfilePieces
}
const CEILING_P19: CeilingSpecFull = { ...CEILING_SPEC, type: 'p19' }

function ceiling(id: string, label: string, spec: CeilingSpecFull): Ceiling {
  // Прямоугольный контур 5000×4000 px=мм — только для source-группировки по
  // видам работ, calcCeiling сам по себе площадь/периметр берёт из spec.
  // startWallSideIndex обязателен для buildCeilingSurfaceInputs (см. calcProjectSheetLayout.ts).
  return {
    id, label, ceilingSpec: spec, startWallSideIndex: 0,
    outer: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }],
  }
}

function wallLine(id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<PlanLine> = {}): PlanLine {
  return {
    id, x1, y1, x2, y2, type: 'wall_existing', lengthMm: Math.hypot(x2 - x1, y2 - y1),
    heightMm: 2700, label: id, ...extra,
  } as PlanLine
}

function squareRoom(overrides: Partial<Room> = {}): { room: Room, lines: PlanLine[] } {
  const top = wallLine('top', 0, 0, 4000, 0)
  const right = wallLine('right', 4000, 0, 4000, 3000)
  const bottom = wallLine('bottom', 4000, 3000, 0, 3000)
  const left = wallLine('left', 0, 3000, 0, 0)
  const room: Room = {
    id: 'r1', lineIds: ['top', 'right', 'bottom', 'left'], areaM2: 12, perimeterMm: 14000, label: 'Комната 1',
    ...overrides,
  }
  return { room, lines: [top, right, bottom, left] }
}

describe('calcProjectMaterialsSummary — пустой проект', () => {
  it('не падает, возвращает пустые группы и предупреждение "нечего считать"', () => {
    const out = calcProjectMaterialsSummary([], [], [], [], [], 1)
    expect(out.totalRows).toBe(0)
    expect(out.warnings.some(w => w.includes('считать нечего'))).toBe(true)
    // предупреждение про плитку — всегда, даже в пустом проекте (архитектурное ограничение v1)
    expect(out.warnings.some(w => w.includes('Плитка'))).toBe(true)
  })
})

describe('calcProjectMaterialsSummary — одна стена', () => {
  const out = calcProjectMaterialsSummary([singleWall('w1', 'Стена 1')], [], [], [], [], 1)

  it('профиль ПС50/ПН50 есть, с источником "стены"', () => {
    const ps = out.groups.find(g => g.title === 'Профиль')!.rows.find(r => r.label === 'ПС 50×50')
    expect(ps).toBeDefined()
    expect(ps!.qty).toBeGreaterThan(0)
    expect(ps!.sources).toContain('стены')
    expect(ps!.sources).not.toContain('потолки')
  })

  it('ГКЛ-лист (12.5мм) есть, источник "стены"', () => {
    const sheet = out.groups.find(g => g.title === 'ГКЛ-листы')!.rows[0]
    expect(sheet).toBeDefined()
    expect(sheet.qty).toBeGreaterThan(0)
    expect(sheet.sources).toContain('стены')
  })

  it('крепёж (саморез обшивки) есть', () => {
    const screws = out.groups.find(g => g.title === 'Крепёж и подвесы')!.rows
      .find(r => r.label.includes('TN/MN/XTN'))
    expect(screws).toBeDefined()
    expect(screws!.qty).toBeGreaterThan(0)
  })

  it('без комнат — отделочных материалов нет', () => {
    expect(out.groups.find(g => g.title === 'Отделочные материалы')!.rows).toHaveLength(0)
  })
})

describe('calcProjectMaterialsSummary — потолок П112', () => {
  const out = calcProjectMaterialsSummary([], [], [ceiling('c1', 'Потолок 1', CEILING_SPEC)], [], [], 1)

  it('профиль ПП 60×27 есть, источник "потолки"', () => {
    const pp = out.groups.find(g => g.title === 'Профиль')!.rows.find(r => r.label === 'ПП 60×27')
    expect(pp).toBeDefined()
    expect(pp!.sources).toBe('потолки — ' + pp!.qty)
  })

  it('подвесы и лента попадают в крепёж (П112 имеет подвесы)', () => {
    const fastenerLabels = out.groups.find(g => g.title === 'Крепёж и подвесы')!.rows.map(r => r.label)
    expect(fastenerLabels).toContain('Подвесы')
    expect(fastenerLabels).toContain('Лента уплотнительная')
  })

  it('нет предупреждения про П19 (это П112)', () => {
    expect(out.warnings.some(w => w.includes('П19'))).toBe(false)
  })
})

describe('calcProjectMaterialsSummary — потолок П19 (многоуровневый)', () => {
  it('исключён из сметы, есть явное предупреждение с названием потолка', () => {
    const out = calcProjectMaterialsSummary([], [], [ceiling('c1', 'Коридор', CEILING_P19)], [], [], 1)
    expect(out.warnings.some(w => w.includes('Коридор') && w.includes('П19'))).toBe(true)
    const pp = out.groups.find(g => g.title === 'Профиль')!.rows.find(r => r.label === 'ПП 60×27')
    expect(pp).toBeUndefined()
  })
})

describe('calcProjectMaterialsSummary — стена + потолок вместе (общий пул листов/профиля)', () => {
  const out = calcProjectMaterialsSummary(
    [singleWall('w1', 'Стена 1')], [],
    [ceiling('c1', 'Потолок 1', CEILING_SPEC)],
    [], [], 1,
  )

  it('ГКЛ 12.5мм — один суммарный ряд, источник указывает оба вида работ', () => {
    const sheetRows = out.groups.find(g => g.title === 'ГКЛ-листы')!.rows
      .filter(r => r.label.includes('12.5'))
    expect(sheetRows).toHaveLength(1)
    expect(sheetRows[0].sources).toContain('стены')
    expect(sheetRows[0].sources).toContain('потолки')
  })

  it('ПП 60×27 (только потолок) и ПС 50×50 (только стена) — разные строки, не смешаны', () => {
    const profileRows = out.groups.find(g => g.title === 'Профиль')!.rows
    const pp = profileRows.find(r => r.label === 'ПП 60×27')
    const ps = profileRows.find(r => r.label === 'ПС 50×50')
    expect(pp).toBeDefined()
    expect(ps).toBeDefined()
    expect(pp!.sources).not.toContain('стены')
    expect(ps!.sources).not.toContain('потолки')
  })
})

describe('calcProjectMaterialsSummary — комната с отделкой (грунтовка)', () => {
  it('попадает в группу "Отделочные материалы", источник — 1 помещение', () => {
    const { room, lines } = squareRoom({
      floorProgress: { steps: [{ stepId: 's1', label: 'Грунтовка', materialKind: 'priming', outcome: 'pending' }] },
    } as Partial<Room>)
    const out = calcProjectMaterialsSummary([], [], [], [room], lines, 1)
    const finishRows = out.groups.find(g => g.title === 'Отделочные материалы')!.rows
    expect(finishRows).toHaveLength(1)
    expect(finishRows[0].qty).toBeGreaterThan(0)
    expect(finishRows[0].sources).toContain('1 помещение')
  })

  it('колонна (isColumn) не попадает в отделочные материалы', () => {
    const { room, lines } = squareRoom({
      isColumn: true,
      floorProgress: { steps: [{ stepId: 's1', label: 'Грунтовка', materialKind: 'priming', outcome: 'pending' }] },
    } as Partial<Room>)
    const out = calcProjectMaterialsSummary([], [], [], [room], lines, 1)
    expect(out.groups.find(g => g.title === 'Отделочные материалы')!.rows).toHaveLength(0)
  })
})
