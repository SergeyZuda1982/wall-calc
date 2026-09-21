import { describe, it, expect } from 'vitest'
import { spiralStaircasesToTreads3D, mmToM, pxToM } from '../planTo3D'
import type { Staircase } from '../../types'

function baseStaircase(overrides: Partial<Staircase> = {}): Staircase {
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

describe('spiralStaircasesToTreads3D', () => {
  it('строит по одной ступени на шаг, растущей по высоте, при ручной высоте (customHeight)', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3400 }) // 3400/170 = 20 ступеней ровно
    const { treads } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    expect(treads).toHaveLength(20)
    expect(treads[0].topY).toBeCloseTo(mmToM(170), 6)
    expect(treads[19].topY).toBeCloseTo(mmToM(3400), 6)
    expect(treads[0].thicknessM).toBeCloseTo(mmToM(30), 6)
    // Все id ступеней указывают на родительскую лестницу (для клика/выделения)
    expect(treads.every(t => t.id === 'st1')).toBe(true)
  })

  it('строит центральную стойку при innerRadiusMm > 0, от bottomElevationMm до верха', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3400, bottomElevationMm: 100, innerRadiusMm: 250 })
    const { posts } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    expect(posts).toHaveLength(1)
    expect(posts[0].radius).toBeCloseTo(mmToM(250), 6)
    expect(posts[0].bottomY).toBeCloseTo(mmToM(100), 6)
    expect(posts[0].topY).toBeCloseTo(mmToM(100 + 3400), 6)
  })

  it('без центральной стойки (innerRadiusMm=0) — нет столба, но ступени всё равно строятся клином', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3400, innerRadiusMm: 0 })
    const { treads, posts } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    expect(posts).toHaveLength(0)
    expect(treads.length).toBeGreaterThan(0)
    // Клиновидная ступень сходится в центре — последняя точка контура совпадает с центром лестницы (в метрах)
    const last = treads[0].points[treads[0].points.length - 1]
    expect(last.x).toBeCloseTo(pxToM(st.cx, scaleMmPx), 6)
    expect(last.z).toBeCloseTo(pxToM(st.cy, scaleMmPx), 6)
  })

  it('по умолчанию (без customHeight) верх лестницы = ceilingMm, если нет накрывающей плиты/потолка/уклона', () => {
    const st = baseStaircase() // без customHeight, без bottomElevationMm
    const { treads } = spiralStaircasesToTreads3D([st], scaleMmPx, 3400) // 3400/170 = 20 ровно
    expect(treads).toHaveLength(20)
    expect(treads[19].topY).toBeCloseTo(mmToM(3400), 6)
  })

  it('вырожденная лестница (targetRiserMm<=0) — молча пропускается, без ступеней/столба', () => {
    const st = baseStaircase({ customHeight: true, heightMm: 3000, targetRiserMm: 0 })
    const { treads, posts } = spiralStaircasesToTreads3D([st], scaleMmPx, 3000)
    expect(treads).toHaveLength(0)
    expect(posts).toHaveLength(0)
  })

  it('несколько лестниц на плане — независимые наборы ступеней, свои id', () => {
    const st1 = baseStaircase({ id: 'a', customHeight: true, heightMm: 1700, cx: 0, cy: 0 })
    const st2 = baseStaircase({ id: 'b', customHeight: true, heightMm: 1700, cx: 500, cy: 500 })
    const { treads } = spiralStaircasesToTreads3D([st1, st2], scaleMmPx, 3000)
    expect(treads.filter(t => t.id === 'a')).toHaveLength(10)
    expect(treads.filter(t => t.id === 'b')).toHaveLength(10)
  })
})
