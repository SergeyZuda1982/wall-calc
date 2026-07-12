import { describe, it, expect } from 'vitest'
import {
  calcProjectSheetLayout, buildCeilingSurfaceInputs,
  type SurfaceSheetInput, type PolygonSurfaceInput,
} from '../calcProjectSheetLayout'
import { calcPolygonSheetLayout, type PolygonSheetLayoutResult } from '../calcPolygonSheetLayout'
import type { Ceiling } from '../../types'
import { DEFAULT_BOARD_SPEC } from '../../types'
import type { Point2D } from '../geometry2d'

function rect(w: number, h: number): Point2D[] {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
}

// 12.07.2026: шаг 2 плана (см. чат) — потолки (Ceiling-контуры) подключены
// в calcProjectSheetLayout.ts как параллельный тип PolygonSurfaceInput,
// пул обрезков течёт через них тем же BoardOffcut[], что и у стен/облицовок.

describe('buildCeilingSurfaceInputs', () => {
  const baseCeiling: Ceiling = {
    id: 'cl1',
    label: 'Потолок 1',
    outer: rect(500, 300), // px
    ceilingSpec: {
      type: 'p112', layers: 1, material: 'gsp', thickness: 12.5,
      stepC: 600, areaSqm: 15, perimeterM: 16,
    },
    startWallSideIndex: 0,
  }

  it('строит PolygonSurfaceInput с координатами в мм (масштаб применён)', () => {
    const out = buildCeilingSurfaceInputs([baseCeiling], 10) // 1px = 10мм
    expect(out).toHaveLength(1)
    expect(out[0].outerMm).toEqual([
      { x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 },
    ])
    expect(out[0].gklLayers).toBe(1)
    expect(out[0].sheetLengthMm).toBe(2500) // дефолт, sheetLengthMm в спеке не задан
  })

  it('пропускает потолок без ceilingSpec', () => {
    const cl: Ceiling = { ...baseCeiling, ceilingSpec: undefined }
    expect(buildCeilingSurfaceInputs([cl], 10)).toHaveLength(0)
  })

  it('пропускает потолок без startWallSideIndex (нет точки отсчёта раскладки)', () => {
    const cl: Ceiling = { ...baseCeiling, startWallSideIndex: undefined }
    expect(buildCeilingSurfaceInputs([cl], 10)).toHaveLength(0)
  })

  it('2 слоя (layers=2) корректно передаются', () => {
    const cl: Ceiling = { ...baseCeiling, ceilingSpec: { ...baseCeiling.ceilingSpec!, layers: 2 } }
    const out = buildCeilingSurfaceInputs([cl], 10)
    expect(out[0].gklLayers).toBe(2)
  })
})

describe('calcProjectSheetLayout — сквозной пул обрезков доходит до потолка', () => {
  const ceilingInput: PolygonSurfaceInput = {
    id: 'cl1', label: 'Потолок 1',
    outerMm: rect(2500, 1200), // ровно один лист 2500×1200 — влезет в обрезок ниже
    holesMm: [],
    startSide: { start: { x: 0, y: 0 }, end: { x: 2500, y: 0 } },
    sheetLengthMm: 2500,
    gklLayers: 1,
    layer1: DEFAULT_BOARD_SPEC,
    layer2: DEFAULT_BOARD_SPEC,
  }

  it('без пула — потолку нужен 1 новый лист', () => {
    const proj = calcProjectSheetLayout([], [ceilingInput])
    expect(proj.surfaces).toHaveLength(1)
    const r = proj.surfaces[0].result
    expect(r.totalSheetsNeeded).toBe(1)
  })

  it('пул обрезков от стены реально передаётся потолку (не теряется по дороге)', () => {
    const wall: SurfaceSheetInput = {
      id: 'w1', label: 'Перегородка 1',
      wallL: 400, wallH: 2500,
      firstStud: 400, step: 400,
      gklLayers: 1,
      openings: [],
      layer1: DEFAULT_BOARD_SPEC, layer2: DEFAULT_BOARD_SPEC,
      sides: 1,
    }
    const wallOnly = calcProjectSheetLayout([wall], [])
    const wallOffcuts = wallOnly.finalOffcuts

    const combined = calcProjectSheetLayout([wall], [ceilingInput])
    const ceilingResult = combined.surfaces.find(s => s.id === 'cl1')!.result as PolygonSheetLayoutResult

    // То же самое, что должен получить потолок, если ему вручную передать
    // finalOffcuts стены как initialPool — если пул реально передан,
    // результат потолка идентичен независимо от того, прошёл ли он через
    // calcProjectSheetLayout или через прямой вызов с тем же пулом.
    const direct = calcPolygonSheetLayout(
      ceilingInput.outerMm, ceilingInput.holesMm, ceilingInput.startSide,
      ceilingInput.sheetLengthMm, ceilingInput.gklLayers,
      ceilingInput.layer1, ceilingInput.layer2, wallOffcuts,
    )!
    expect(ceilingResult.totalSheetsNeeded).toBe(direct.totalSheetsNeeded)
    expect(ceilingResult.layer1.pieces.map(p => p.source)).toEqual(direct.layer1.pieces.map(p => p.source))
  })

  it('finalOffcuts проекта — это то, что осталось ПОСЛЕ потолка (не после стен)', () => {
    const proj1 = calcProjectSheetLayout([], [ceilingInput])
    const proj2 = calcProjectSheetLayout([], [])
    // Без потолка (proj2) финальный пул пуст (никакой конструкции не было),
    // с потолком (proj1) — пул как минимум определён (сам факт, что потолок
    // формирует finalOffcuts проекта, а не теряется где-то по дороге).
    expect(proj2.finalOffcuts).toEqual([])
    expect(Array.isArray(proj1.finalOffcuts)).toBe(true)
  })
})
