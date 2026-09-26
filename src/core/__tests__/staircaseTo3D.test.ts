import { describe, it, expect } from 'vitest'
import { spiralStaircasesToTreads3D, mmToM, pxToM } from '../planTo3D'
import type { SpiralStaircase } from '../../types'

function baseStaircase(overrides: Partial<SpiralStaircase> = {}): SpiralStaircase {
  return {
    id: 'st1',
    kind: 'spiral',
    cx: 0,
    cy: 0,
    innerRadiusMm: 200,
    outerRadiusMm: 1400,
    startAngleRad: 0,
    totalAngleRad: Math.PI * 2, // полный оборот
    targetRiserMm: 170,
    treadThicknessMm: 30,
    label: 'Лестница',
    ...overrides,
  }
}

const scaleMmPx = 10 // 10мм на 1px

describe('spiralStaircasesToTreads3D (23.09.2026 — монолитная модель, без отдельной центральной стойки)', () => {
  it('строит по одной ступени на шаг, растущей по высоте, при ручной высоте (customHeight)', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3400 }) // 3400/170 = 20 ступеней ровно
    const { treads } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    expect(treads).toHaveLength(20)
    expect(treads[0].topY).toBeCloseTo(mmToM(170), 6)
    expect(treads[19].topY).toBeCloseTo(mmToM(3400), 6)
    // Все id ступеней указывают на родительскую лестницу (для клика/выделения)
    expect(treads.every(t => t.id === 'st1')).toBe(true)
  })

  it('каждая ступень несёт bottomYAtPoint — свою высоту низа на каждую точку контура (нет константной thicknessM)', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3400, bottomElevationMm: 100 })
    const { treads } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    treads.forEach(t => {
      expect(t.bottomYAtPoint).toBeDefined()
      expect(t.bottomYAtPoint!.length).toBe(t.points.length)
      expect(t.thicknessM).toBe(0)
    })
  })

  it('bottomYAtPoint — линейная функция угла: в начале лестницы (θ=startAngleRad) ровно bottomElevationMm, в конце (θ=startAngleRad+totalAngleRad) ровно верх лестницы', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3400, bottomElevationMm: 100, startAngleRad: 0, totalAngleRad: Math.PI * 2 })
    const { treads } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    // Первая точка контура первой ступени — на θ=startAngleRad (см. spiralStepSectorPointsWithAngle)
    expect(treads[0].bottomYAtPoint![0]).toBeCloseTo(mmToM(100), 5)
    // Последняя ступень: первая точка её внешней дуги (индекс 0) на θ=последнего angleFrom,
    // близко к концу оборота — проверим через саму последнюю точку внешней дуги (индекс 4, arcSegments=4),
    // которая ровно на θ=angleToRad последней ступени = startAngleRad+totalAngleRad (конец лестницы)
    const last = treads[treads.length - 1]
    expect(last.bottomYAtPoint![4]).toBeCloseTo(mmToM(100 + 3400), 5)
  })

  it('соседние ступени стыкуются по нижней грани БЕЗ зазора — общая угловая граница даёт одинаковую высоту', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3400 })
    const { treads } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    // Точка 4 (конец внешней дуги, arcSegments=4 по умолчанию) ступени i и
    // точка 0 (начало внешней дуги) ступени i+1 — один и тот же угол θ,
    // должны иметь одинаковую высоту низа.
    for (let i = 0; i < treads.length - 1; i++) {
      expect(treads[i].bottomYAtPoint![4]).toBeCloseTo(treads[i + 1].bottomYAtPoint![0], 9)
    }
  })

  it('без центральной стойки (innerRadiusMm=0) — контур всё равно клин, bottomYAtPoint покрывает и точку центра', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3400, innerRadiusMm: 0 })
    const { treads } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    expect(treads.length).toBeGreaterThan(0)
    // Клиновидная ступень сходится в центре — последняя точка контура совпадает с центром лестницы (в метрах)
    const last = treads[0].points[treads[0].points.length - 1]
    expect(last.x).toBeCloseTo(pxToM(st.cx, scaleMmPx), 6)
    expect(last.z).toBeCloseTo(pxToM(st.cy, scaleMmPx), 6)
    expect(treads[0].bottomYAtPoint!.length).toBe(treads[0].points.length)
  })

  it('innerRadiusMm > 0 БОЛЬШЕ НЕ создаёт отдельную сущность-столб — только treads, без posts на выходе', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3400, bottomElevationMm: 100, innerRadiusMm: 250 })
    const result = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    expect(result).not.toHaveProperty('posts')
    expect(result.treads.length).toBeGreaterThan(0)
  })

  it('по умолчанию (без customHeight) верх лестницы = ceilingMm, если нет накрывающей плиты/потолка/уклона', () => {
    const st = baseStaircase() // без customHeight, без bottomElevationMm
    const { treads } = spiralStaircasesToTreads3D([st], scaleMmPx, 3400) // 3400/170 = 20 ровно
    expect(treads).toHaveLength(20)
    expect(treads[19].topY).toBeCloseTo(mmToM(3400), 6)
  })

  it('вырожденная лестница (targetRiserMm<=0) — молча пропускается, без ступеней', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3000, targetRiserMm: 0 })
    const { treads } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    expect(treads).toHaveLength(0)
  })

  it('несколько лестниц на плане — независимые наборы ступеней, свои id', () => {
    const st1 = baseStaircase({ id: 'a', customHeight: true, heightMm: 1700, cx: 0, cy: 0 })
    const st2 = baseStaircase({ id: 'b', customHeight: true, heightMm: 1700, cx: 500, cy: 500 })
    const { treads } = spiralStaircasesToTreads3D([st1, st2], scaleMmPx, 3000)
    expect(treads.filter(t => t.id === 'a')).toHaveLength(10)
    expect(treads.filter(t => t.id === 'b')).toHaveLength(10)
  })
})
