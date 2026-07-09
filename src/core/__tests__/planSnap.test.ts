import { describe, it, expect } from 'vitest'
import { snapPoint, snapOrtho } from '../planSnap'
import type { PlanLine } from '../../types'

// scaleMmPx = 10 (как дефолт в FloorPlan), т.е. 1px = 10мм
function blockWall(id: string, x1: number, y1: number, x2: number, y2: number, subtypeMm: string): PlanLine {
  return {
    id, x1, y1, x2, y2, type: 'wall_existing', lengthMm: 0, label: id,
    spec: { material: 'block', subtype: subtypeMm },
  }
}

describe('snapPoint — угловые точки граней (не только ось)', () => {
  it('снапится к углу ГРАНИ на конце стены, а не к оси, когда курсор ближе к грани', () => {
    // Вертикальная стена 125мм (halfPx = 6.25), ось x=100, от y=0 до y=100.
    // Пользователь целится в нижний правый угол (грань справа от оси, на торце) —
    // именно так, как в реальном сценарии: пристыковать новую перегородку к грани
    // блочной стены, а не к её оси.
    const wall = blockWall('B', 100, 0, 100, 100, '125')
    const cursor = { x: 106, y: 100 } // рядом с реальным углом грани (106.25, 100)

    const res = snapPoint(cursor.x, cursor.y, [wall], 10)
    expect(res.snapped).toBe(true)
    expect(res.x).toBeCloseTo(106.25, 5)
    expect(res.y).toBeCloseTo(100, 5)
    // НЕ должно утянуть на ось (100, 100)
    expect(res.x).not.toBeCloseTo(100, 1)
  })

  it('снапится к ПРОТИВОПОЛОЖНОЙ грани, когда курсор с другой стороны оси', () => {
    const wall = blockWall('B', 100, 0, 100, 100, '125')
    const cursor = { x: 94, y: 100 } // рядом с левым углом грани (93.75, 100)

    const res = snapPoint(cursor.x, cursor.y, [wall], 10)
    expect(res.snapped).toBe(true)
    expect(res.x).toBeCloseTo(93.75, 5)
  })

  it('привязка к оси по-прежнему доступна, когда курсор ближе к оси, чем к граням', () => {
    const wall = blockWall('B', 100, 0, 100, 100, '125')
    const cursor = { x: 101, y: 100 } // почти точно на оси

    const res = snapPoint(cursor.x, cursor.y, [wall], 10)
    expect(res.snapped).toBe(true)
    expect(res.x).toBeCloseTo(100, 5)
  })

  it('для линии нулевой толщины (например, wall_new без материала) грань совпадает с осью — курсор притягивается к телу линии, а не к отдельным граням', () => {
    const wall: PlanLine = { id: 'Z', x1: 0, y1: 0, x2: 100, y2: 0, type: 'wall_new', lengthMm: 1000, label: 'Z' }
    // Курсор точно у самого конца оси, вне тела (x<0) — единственный валидный
    // кандидат тут — привязка к концу оси, т.к. граней у нулевой толщины нет
    const res = snapPoint(-3, 3, [wall], 10)
    expect(res.snapped).toBe(true)
    expect(res.x).toBeCloseTo(0, 5)
    expect(res.y).toBeCloseTo(0, 5)
  })
})

describe('snapPoint — коллинеарное примыкание к торцу (баг: "флэш"-поправка промахивалась мимо угла)', () => {
  it('стыковка НОВОЙ толстой стены встык (по оси) со старой тонкой — без лишнего сдвига на полтолщины новой стены', () => {
    // Существующая блочная стена 125мм, вертикальная, от (100,0) до (100,100).
    // Пользователь достраивает перегородку СВЕРХУ, продолжая её по той же оси
    // (реальный сценарий: разрыв в блочной стене под проём/примыкание, который
    // нужно зашить новой конструкцией). Новая стена — 200мм (halfPx=10).
    // refDir — реальное смещение курсора в px с начала рисования (не единичный
    // вектор направления: в живом коде это x-drawing.x1/y-drawing.y1 в px).
    const wall = blockWall('B', 100, 0, 100, 100, '125')
    const refDir = { dx: 0, dy: -40 } // рисует вверх, вдоль той же оси (коллинеарно)
    const newHalfThicknessPx = 10 // 200мм / 2 / scale(10)

    // Курсор целится точно в правый угол грани верхнего торца (106.25, 0)
    const res = snapPoint(106, 0, [wall], 10, undefined, 24, refDir, newHalfThicknessPx)
    expect(res.snapped).toBe(true)
    // Должно попасть РОВНО на грань старой стены (106.25), а НЕ на
    // грань+лишний отступ на halfThickness новой стены (116.25) — раньше
    // "флэш"-поправка ошибочно добавляла именно этот лишний отступ здесь.
    expect(res.x).toBeCloseTo(106.25, 5)
    expect(res.x).not.toBeCloseTo(116.25, 1)
  })

  it('для сравнения: настоящее боковое ("бок о бок") прилегание — поправка на полтолщины новой стены по-прежнему работает', () => {
    // Существующая стена ГОРИЗОНТАЛЬНАЯ, курсор приближается сбоку СРЕДИ тела
    // линии (не с торца) — это и есть случай "новую стену ведут вплотную
    // рядом", для которого поправка была изначально задумана.
    const wall = blockWall('B', 0, 100, 200, 100, '125') // halfPx = 6.25
    const refDir = { dx: 40, dy: 0 } // новая стена идёт вдоль той же оси, СБОКУ (не с торца)
    const newHalfThicknessPx = 10 // 200мм новая стена

    // Курсор где-то в середине тела линии (x=100, т.е. t=0.5 — не зажато)
    const res = snapPoint(100, 108, [wall], 10, undefined, 24, refDir, newHalfThicknessPx)
    expect(res.snapped).toBe(true)
    // Грань старой стены на y=106.25, плюс поправка на halfThickness новой (10) = 116.25
    expect(res.y).toBeCloseTo(116.25, 5)
  })
})

describe('snapOrtho', () => {
  it('привязывает угол к шагу 45°', () => {
    const res = snapOrtho(0, 0, 100, 5)
    expect(res.y).toBeCloseTo(0, 5) // почти горизонталь → защёлкивается на 0°
  })
})
