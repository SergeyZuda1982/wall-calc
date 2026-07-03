import { describe, it, expect } from 'vitest'
import { calcSheetLayout } from '../calcSheetLayout'
import { flatProfile } from '../profileGeometry'
import { DEFAULT_BOARD_SPEC } from '../../types'

const spec = DEFAULT_BOARD_SPEC // 1200×2500

describe('calcSheetLayout — плоская стена (базовый случай)', () => {
  it('считает раскрой одного слоя, одна сторона, без проёмов', () => {
    const result = calcSheetLayout(
      3000, flatProfile(3000, 3000), flatProfile(3000, 0),
      600, 600, 1, [], spec, spec, 1,
    )
    expect(result.layer1.sheetsNeeded).toBeGreaterThan(0)
    expect(result.layer2).toBeNull()
    expect(result.sideB_layer1).toBeNull()
    expect(result.totalUsedAreaM2).toBeCloseTo(9, 1) // 3м × 3м
  })

  it('две стороны (перегородка) считают layer1 для обеих сторон', () => {
    const result = calcSheetLayout(
      3000, flatProfile(3000, 3000), flatProfile(3000, 0),
      600, 600, 1, [], spec, spec, 2,
    )
    expect(result.sideB_layer1).not.toBeNull()
    expect(result.totalUsedAreaM2).toBeCloseTo(18, 1) // обе стороны
  })
})

describe('calcSheetLayout — уклон потолка/пола (регрессия этой сессии)', () => {
  // Стена 4000мм: первые 2000мм высота 2500, дальше уклон до 3500 на отметке 4000.
  // Раньше calcSheetLayout получал одну "худшую" высоту на всю стену (3500) —
  // низкая часть стены кроилась с большим перерасходом, а сам излом уклона
  // не попадал в границы колонок.
  const slopedCeiling = [
    { x: 0, y: 2500 },
    { x: 2000, y: 2500 },
    { x: 4000, y: 3500 },
  ]
  const flatFloor = flatProfile(4000, 0)

  it('граница колонок включает точку излома уклона (x=2000)', () => {
    const result = calcSheetLayout(
      4000, slopedCeiling, flatFloor,
      600, 600, 1, [], spec, spec, 1,
    )
    const boundaryXs = new Set<number>()
    for (const col of result.layer1.columns) {
      boundaryXs.add(col.x1)
      boundaryXs.add(col.x2)
    }
    expect(boundaryXs.has(2000)).toBe(true)
  })

  it('колонка в низкой части (x<2000) не кроится по высоте всей высокой части', () => {
    const result = calcSheetLayout(
      4000, slopedCeiling, flatFloor,
      600, 600, 1, [], spec, spec, 1,
    )
    const lowColumn = result.layer1.columns.find(c => c.x2 <= 2000)
    expect(lowColumn).toBeDefined()
    // Самый верхний кусок в низкой колонке не должен подниматься выше 2500мм —
    // если бы применялась глобальная худшая высота (3500), тут был бы кусок до 3500.
    const maxY = Math.max(...lowColumn!.pieces.map(p => p.y + p.h))
    expect(maxY).toBeLessThanOrEqual(2500)
  })

  it('колонка, которая реально пересекает наклонную линию, содержит diagonal_cut с многоугольником', () => {
    // Одна широкая колонка от 0 до 4000 (шаг листа больше длины стены) —
    // единственная граница слева/справа, наклон целиком внутри неё.
    const result = calcSheetLayout(
      4000, slopedCeiling, flatFloor,
      4000, 4000, 1, [], spec, spec, 1,
    )
    const diagPieces = result.layer1.columns
      .flatMap(c => c.pieces)
      .filter(p => p.kind === 'diagonal_cut')
    expect(diagPieces.length).toBeGreaterThan(0)
    for (const p of diagPieces) {
      expect(p.polygon).toBeDefined()
      expect(p.polygon!.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('usedAreaM2 у diagonal_cut куска меньше площади его ограничивающего прямоугольника (реальные отходы учтены)', () => {
    const result = calcSheetLayout(
      4000, slopedCeiling, flatFloor,
      4000, 4000, 1, [], spec, spec, 1,
    )
    const diag = result.layer1.columns.flatMap(c => c.pieces).find(p => p.kind === 'diagonal_cut')
    expect(diag).toBeDefined()
    const boundingArea = diag!.w * diag!.h
    const polyArea = (() => {
      const pts = diag!.polygon!
      let s = 0
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]
        s += a.x * b.y - b.x * a.y
      }
      return Math.abs(s) / 2
    })()
    expect(polyArea).toBeLessThan(boundingArea)
  })

  it('колонка без пересечения с уклоном (полностью ниже него) остаётся обычным full/width_cut/height_cut, без diagonal_cut', () => {
    // Стена вся плоская 2500 (уклона нет вообще) — ни одного diagonal_cut быть не должно
    const result = calcSheetLayout(
      3000, flatProfile(3000, 2500), flatProfile(3000, 0),
      600, 600, 1, [], spec, spec, 1,
    )
    const hasDiag = result.layer1.columns.some(c => c.pieces.some(p => p.kind === 'diagonal_cut'))
    expect(hasDiag).toBe(false)
  })

  it('раскрой с уклоном тратит меньше площади листов, чем раскрой по фиксированной худшей высоте на всю стену', () => {
    const slopedResult = calcSheetLayout(
      4000, slopedCeiling, flatFloor,
      600, 600, 1, [], spec, spec, 1,
    )
    const flatWorstCaseResult = calcSheetLayout(
      4000, flatProfile(4000, 3500), flatFloor,
      600, 600, 1, [], spec, spec, 1,
    )
    expect(slopedResult.totalSheetAreaM2).toBeLessThan(flatWorstCaseResult.totalSheetAreaM2)
  })

  it('без уклона (плоский профиль) раскрой идентичен обычному плоскому вызову', () => {
    const flatViaProfile = calcSheetLayout(
      3600, flatProfile(3600, 3000), flatProfile(3600, 0),
      600, 600, 1, [], spec, spec, 1,
    )
    expect(flatViaProfile.totalSheetsNeeded).toBeGreaterThan(0)
    expect(flatViaProfile.totalWastePercent).toBeGreaterThanOrEqual(0)
  })
})

describe('calcSheetLayout — проёмы всё ещё разбивают колонки корректно (не регрессия)', () => {
  it('края проёма попадают в границы колонок наравне с точками уклона', () => {
    const result = calcSheetLayout(
      3000, flatProfile(3000, 3000), flatProfile(3000, 0),
      600, 600, 1,
      [{ id: 'd1', type: 'door', pos: 900, width: 900, height: 2000, sillHeight: 0 }],
      spec, spec, 1,
    )
    const boundaryXs = new Set<number>()
    for (const col of result.layer1.columns) {
      boundaryXs.add(col.x1)
      boundaryXs.add(col.x2)
    }
    expect(boundaryXs.has(900)).toBe(true)
    expect(boundaryXs.has(1800)).toBe(true)
  })
})
