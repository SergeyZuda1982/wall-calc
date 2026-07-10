import { describe, it, expect } from 'vitest'
import { snapPoint, snapOrtho, getFlushCandidates } from '../planSnap'
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

describe('snapPoint — флюш-грань при коллинеарном продолжении ДРУГОЙ толщины (10.07.2026, живой кейс: три отрезка одной оси 250/150/250мм с общей левой гранью)', () => {
  it('новая стена ТОНЬШЕ старой — курсор, наведённый чуть дальше от видимого угла (внутрь тела старой стены), даёт ось, при которой грань новой стены совпадёт со старой', () => {
    // Нижняя стена 250мм (halfPx=12.5), вертикальная, от (100,300) до (100,100).
    // Новая стена — 150мм (halfPx=7.5). Видимый левый угол грани на верхнем
    // торце — (87.5, 100). Правильная ось для новой (более тонкой) стены,
    // чтобы её ЛЕВАЯ грань совпала с левой гранью старой — 87.5+7.5=95.
    const wall = blockWall('bottom', 100, 300, 100, 100, '250')
    const res = snapPoint(94, 100, [wall], 10, undefined, 24, undefined, 7.5)
    expect(res.snapped).toBe(true)
    expect(res.x).toBeCloseTo(95, 5)
    expect(res.y).toBeCloseTo(100, 5)
  })

  it('новая стена ТОЛЩЕ старой — тот же принцип в обратную сторону', () => {
    // Стена 125мм (halfPx=6.25), новая — 200мм (halfPx=10). Видимый правый
    // угол грани — (106.25, 0). Ось для более толстой новой стены, чтобы её
    // правая грань совпала со старой — 106.25-10=96.25.
    const wall = blockWall('B', 100, 0, 100, 100, '125')
    const res = snapPoint(97, 0, [wall], 10, undefined, 24, undefined, 10)
    expect(res.snapped).toBe(true)
    expect(res.x).toBeCloseTo(96.25, 5)
  })

  it('видимый угол по-прежнему точно достижим, если целиться РОВНО в него — Фикс 1 не пострадал', () => {
    // Тот же живой кейс (250мм старая / 150мм новая), но курсор целится
    // ровно в видимый угол (87.5) — должен попасть именно туда, а не быть
    // принудительно утянут на флюш-точку (95): у пользователя должна
    // остаться свобода прицельно попасть в реальный видимый угол, если он
    // того хочет (например, для стены с намеренно другой геометрией стыка).
    const wall = blockWall('bottom', 100, 300, 100, 100, '250')
    const res = snapPoint(88, 100, [wall], 10, undefined, 24, undefined, 7.5)
    expect(res.snapped).toBe(true)
    expect(res.x).toBeCloseTo(87.5, 5)
  })

  it('толщина новой стены совпадает со старой — флюш-кандидат совпадает с "сырым" углом, поведение не меняется', () => {
    const wall = blockWall('bottom', 100, 300, 100, 100, '250')
    const res = snapPoint(88, 100, [wall], 10, undefined, 24, undefined, 12.5)
    expect(res.snapped).toBe(true)
    expect(res.x).toBeCloseTo(87.5, 5)
  })

  it('толщина новой стены ещё неизвестна (самый первый клик, newHalfThicknessPx=0) — только "сырой" угол, как раньше', () => {
    const wall = blockWall('bottom', 100, 300, 100, 100, '250')
    const res = snapPoint(89, 100, [wall], 10)
    expect(res.snapped).toBe(true)
    expect(res.x).toBeCloseTo(87.5, 5)
    expect(res.x).not.toBeCloseTo(95, 1)
  })
})

describe('getFlushCandidates (10.07.2026, точки для визуального маркера флюш-снапа)', () => {
  it('возвращает 4 точки для одной стены другой толщины', () => {
    const wall = blockWall('bottom', 100, 300, 100, 100, '250')
    const points = getFlushCandidates([wall], 10, 7.5)
    expect(points).toHaveLength(4)
    // Одна из них — та самая (95,100), что и в snapPoint-тесте выше
    expect(points.some(p => Math.abs(p.x - 95) < 1e-6 && Math.abs(p.y - 100) < 1e-6)).toBe(true)
  })

  it('толщина совпадает — пустой список (маркер не нужен, нечего подсказывать)', () => {
    const wall = blockWall('bottom', 100, 300, 100, 100, '250')
    expect(getFlushCandidates([wall], 10, 12.5)).toEqual([])
  })

  it('newHalfThicknessPx=0 (толщина ещё не выбрана) — пустой список', () => {
    const wall = blockWall('bottom', 100, 300, 100, 100, '250')
    expect(getFlushCandidates([wall], 10, 0)).toEqual([])
  })

  it('линия нулевой толщины (например, окраска стены — wall_lining/paint) — пропускается', () => {
    const zeroLine: PlanLine = {
      id: 'z', x1: 0, y1: 0, x2: 100, y2: 0, type: 'wall_lining', lengthMm: 0, label: 'z',
      spec: { material: 'paint' },
    }
    expect(getFlushCandidates([zeroLine], 10, 7.5)).toEqual([])
  })

  it('excludeId исключает конкретную линию из результата', () => {
    const wall = blockWall('bottom', 100, 300, 100, 100, '250')
    expect(getFlushCandidates([wall], 10, 7.5, 'bottom')).toEqual([])
  })

  it('несколько линий — точки собираются со всех подходящих', () => {
    const a = blockWall('a', 100, 300, 100, 100, '250')
    const b = blockWall('b', 300, 300, 300, 100, '250')
    expect(getFlushCandidates([a, b], 10, 7.5)).toHaveLength(8)
  })
})

describe('snapOrtho', () => {
  it('привязывает угол к шагу 45°', () => {
    const res = snapOrtho(0, 0, 100, 5)
    expect(res.y).toBeCloseTo(0, 5) // почти горизонталь → защёлкивается на 0°
  })
})
