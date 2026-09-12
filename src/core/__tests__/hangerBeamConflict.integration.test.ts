import { describe, it, expect } from 'vitest'
import { calcCeiling } from '../calcCeiling'
import type { CeilingSpecFull } from '../../data/ceilingData'
import type { PlanLine } from '../../types'
import { ribBeamsToBeamObstacles } from '../ribBeamsToBeamObstacles'
import { findHangerBeamConflicts, countConflictingHangers, suggestConflictFreeStepGeneric } from '../hangerBeamConflict'

function ribBeam(x1: number, y1: number, x2: number, y2: number, sectionWidthMm = 300): PlanLine {
  return {
    id: `rb-${x1}-${y1}`, type: 'rib_beam', lengthMm: 0, label: '',
    x1, y1, x2, y2, sectionWidthMm,
  } as PlanLine
}

describe('сквозной сценарий: ригели с плана -> calcCeiling (полигон) -> конфликты подвеса', () => {
  // Тот же сценарий, что репорт с объекта: зал ~8.4×5м, ригели поперёк
  // короткой стороны (перпендикулярно направлению шага подвеса a),
  // сечение 300мм, шаг между ригелями ~1400мм. Масштаб плана 1px = 10мм.
  const scaleMmPerPx = 10
  // Контур в мм: 8400×5000, в px это /10 = 840×500
  const outerMm = [
    { x: 0, y: 0 },
    { x: 8400, y: 0 },
    { x: 8400, y: 5000 },
    { x: 0, y: 5000 },
  ]
  const startSide = { start: { x: 0, y: 0 }, end: { x: 8400, y: 0 } }

  // Ригели поперёк короткой стороны -> идут вдоль V (от 0 до 5000мм по Y),
  // на позициях U (вдоль длины) 700, 2120, 3510, 4930, 6340, 7760 — px = /10.
  const ribPositionsMm = [700, 2120, 3510, 4930, 6340, 7760]
  const lines: PlanLine[] = ribPositionsMm.map(pos =>
    ribBeam(pos / scaleMmPerPx, 0, pos / scaleMmPerPx, 500, 300),
  )

  const beams = ribBeamsToBeamObstacles(lines, outerMm, startSide, scaleMmPerPx)

  it('все 6 ригелей распознаны как axis=length (блокируют позиции вдоль U/длины)', () => {
    expect(beams).toHaveLength(6)
    expect(beams.every(b => b.axis === 'length')).toBe(true)
    expect(beams.map(b => b.posMm)).toEqual(ribPositionsMm)
  })

  const BASE: CeilingSpecFull = {
    type: 'p112', layers: 1, material: 'gsp', thickness: 12.5,
    stepC: 600, areaSqm: 42, perimeterM: 26.8,
    roomLengthMm: 8400, roomWidthMm: 5000, sheetLengthMm: 2500,
    slabGapMm: 500, bearingAlongLength: true,
  }
  const polygonInput = { outerMm, holesMm: [], startSide }

  it('дефолтный шаг подвеса 1000мм конфликтует с ригелями (то, из-за чего на объекте подбирали шаг вручную)', () => {
    const res = calcCeiling({ ...BASE, stepA: 1000 }, polygonInput)
    expect(res.polygonFrame).not.toBeNull()
    const points = res.polygonFrame!.hangerPoints.map(p => ({ lengthMm: p.x, widthMm: p.y }))
    const conflicts = findHangerBeamConflicts(points, beams, 50)
    expect(conflicts.length).toBeGreaterThan(0)
  })

  it('suggestConflictFreeStepGeneric через реальный calcCeiling находит бесконфликтный шаг рядом с 850мм', () => {
    const suggestion = suggestConflictFreeStepGeneric(850, step => {
      const res = calcCeiling({ ...BASE, stepA: step }, polygonInput)
      const geo = res.polygonFrame
      if (!geo) return 0
      return countConflictingHangers(
        findHangerBeamConflicts(geo.hangerPoints.map(p => ({ lengthMm: p.x, widthMm: p.y })), beams, 50),
      )
    })
    expect(suggestion).not.toBeNull()
    expect(suggestion!.conflictingHangers).toBe(0)

    // Прогоняем ещё раз честно тем же путём, что и "Применить" в UI —
    // убеждаемся, что предложенный шаг реально даёт 0 конфликтов.
    const res = calcCeiling({ ...BASE, stepA: suggestion!.stepMm }, polygonInput)
    const points = res.polygonFrame!.hangerPoints.map(p => ({ lengthMm: p.x, widthMm: p.y }))
    expect(findHangerBeamConflicts(points, beams, 50)).toHaveLength(0)
  })
})
