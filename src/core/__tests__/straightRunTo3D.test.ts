import { describe, it, expect } from 'vitest'
import { straightRunStaircasesToTreads3D, mmToM, pxToM } from '../planTo3D'
import type { StraightRunStaircase, StaircaseSegment } from '../../types'

const scaleMmPx = 10 // 10мм на 1px

function baseStaircase(segments: StaircaseSegment[], overrides: Partial<StraightRunStaircase> = {}): StraightRunStaircase {
  return {
    id: 'sr1', kind: 'straight_run', segments,
    targetRiserMm: 170, treadThicknessMm: 30, label: 'Маршевая',
    ...overrides,
  }
}

function flight(x1: number, y1: number, x2: number, y2: number, widthMm = 1000): StaircaseSegment {
  return { kind: 'flight', id: `f_${x1}_${y1}`, x1, y1, x2, y2, widthMm }
}
function landing(cx: number, cy: number, widthMm = 1000, depthMm = 1000): StaircaseSegment {
  return { kind: 'landing', id: `l_${cx}_${cy}`, cx, cy, widthMm, depthMm, angleRad: 0, thicknessMm: 30 }
}

describe('straightRunStaircasesToTreads3D', () => {
  it('один марш: 20 ступеней (3400/170), высота растёт равномерно', () => {
    // Марш длиной 2000px (=20000мм при scale=10), высота задаётся через
    // явную площадку в конце на нужной высоте — здесь просто через
    // customHeight-эквивалент: используем ceilingMm=3400 без слоёв (потолок = слоёв нет → ceilingMm)
    const st = baseStaircase([flight(0, 0, 2000, 0)])
    const treads = straightRunStaircasesToTreads3D([st], scaleMmPx, 3400)
    expect(treads).toHaveLength(20)
    expect(treads[0].id).toBe('sr1')
    expect(treads[0].topY).toBeCloseTo(mmToM(170), 6)
    expect(treads[19].topY).toBeCloseTo(mmToM(3400), 6)
    expect(treads[0].thicknessM).toBeCloseTo(mmToM(30), 6)
  })

  it('марш + площадка + марш: площадка НЕ поднимает уровень, второй марш продолжает с той же высоты', () => {
    const st = baseStaircase([
      flight(0, 0, 1000, 0),   // короче первого случая — меньше ступеней
      landing(1000, -500, 1000, 1000),
      flight(1000, -1000, 2000, -1000),
    ])
    const treads = straightRunStaircasesToTreads3D([st], scaleMmPx, 3400)
    // Есть хотя бы одна площадка среди результатов (постоянная высота участок)
    const topYs = treads.map(t => t.topY)
    // Верх последней ступени должен достигать полной высоты (3400мм)
    expect(Math.max(...topYs)).toBeCloseTo(mmToM(3400), 3)
  })

  it('площадка включена в результат как отдельный элемент (не тред-ступень) на высоте предыдущего сегмента', () => {
    const st = baseStaircase([
      flight(0, 0, 1000, 0),
      landing(1000, -500, 1000, 1000),
    ])
    const treads = straightRunStaircasesToTreads3D([st], scaleMmPx, 2000)
    // Последний элемент — площадка (толщина 30мм, а не treadThicknessMm лестницы если отличается)
    const last = treads[treads.length - 1]
    expect(last.thicknessM).toBeCloseTo(mmToM(30), 6)
    // Площадка прямоугольная — 4 угла (rectColumnCornersPx)
    expect(last.points).toHaveLength(4)
  })

  it('без сегментов — пусто, не падает; только площадка (без маршей) — рендерится сама площадка, без ступеней', () => {
    expect(straightRunStaircasesToTreads3D([baseStaircase([])], scaleMmPx, 3000)).toEqual([])
    const onlyLanding = baseStaircase([landing(0, 0)])
    const treads = straightRunStaircasesToTreads3D([onlyLanding], scaleMmPx, 3000)
    // Площадка всё равно рендерится (плоская платформа на нулевой высоте,
    // ступеней в ней нет — resolveStraightRunSteps даёт stepsPerFlight=[0]
    // для единственного "марша нулевой длины", но общее totalStepCount от
    // высоты этажа не нулевое, поэтому вырожденной лестница НЕ считается)
    expect(treads).toHaveLength(1)
    expect(treads[0].topY).toBeCloseTo(0, 6)
  })

  it('несколько лестниц — независимые id, не смешиваются', () => {
    const a = baseStaircase([flight(0, 0, 1000, 0)], { id: 'a' })
    const b = baseStaircase([flight(0, 500, 1000, 500)], { id: 'b' })
    const treads = straightRunStaircasesToTreads3D([a, b], scaleMmPx, 1700) // 1700/170=10 ступеней каждой
    expect(treads.filter(t => t.id === 'a')).toHaveLength(10)
    expect(treads.filter(t => t.id === 'b')).toHaveLength(10)
  })

  it('низ (bottomElevationMm) сдвигает всю лестницу вверх, ступени всё ещё растут от него', () => {
    const st = baseStaircase([flight(0, 0, 1000, 0)], { bottomElevationMm: 500 })
    const treads = straightRunStaircasesToTreads3D([st], scaleMmPx, 2200) // (2200-500)/170 = 10
    expect(treads).toHaveLength(10)
    expect(treads[0].topY).toBeCloseTo(mmToM(500 + 170), 6)
  })

  it('ступени марша занимают позиции вдоль направления, координаты в метрах согласованы с pxToM', () => {
    const st = baseStaircase([flight(0, 0, 1000, 0)])
    const treads = straightRunStaircasesToTreads3D([st], scaleMmPx, 1700) // 10 ступеней, длина маршрута 1000px/10=100px на ступень
    // Первая ступень: x от 0 до 100px → метры
    const xs = treads[0].points.map(p => p.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(pxToM(0, scaleMmPx), 6)
    expect(xs[xs.length - 1]).toBeCloseTo(pxToM(100, scaleMmPx), 6)
  })
})
