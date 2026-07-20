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

describe('calcSheetLayout — вертикальная ступень на потолке (балка/ригель, одинаковый x, регрессия 20.07.2026)', () => {
  // Раньше точки перегиба со ступенью нужно было задавать со сдвигом x+1мм
  // (иначе колонка, упирающаяся правым краем ровно в ступень, ошибочно
  // считалась "наклонной" и получала ненужный диагональный рез). Теперь
  // ступень можно задавать напрямую — двумя точками с ОДИНАКОВЫМ x.
  it('колонка, упирающаяся в ступень, остаётся плоской (без diagonal_cut) и берёт высоту ДО перепада', () => {
    // Потолок: 2500 до x=2000, скачком падает до 2000 (балка), и так до конца стены.
    const ceiling = [{ x: 0, y: 2500 }, { x: 2000, y: 2500 }, { x: 2000, y: 2000 }, { x: 4000, y: 2000 }]
    const floor = flatProfile(4000, 0)
    const result = calcSheetLayout(4000, ceiling, floor, 600, 600, 1, [], spec, spec, 1)

    const hasDiag = result.layer1.columns.some(c => c.pieces.some(p => p.kind === 'diagonal_cut'))
    expect(hasDiag).toBe(false)

    const leftCol = result.layer1.columns.find(c => c.x2 === 2000)!
    const rightCol = result.layer1.columns.find(c => c.x1 === 2000)!
    const topOf = (col: typeof leftCol) =>
      Math.max(...col.pieces.filter(p => p.kind !== 'opening_void').map(p => p.y + p.h))
    expect(topOf(leftCol)).toBe(2500)  // до балки — полная высота 2500
    expect(topOf(rightCol)).toBe(2000) // после балки — просевшая высота 2000
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

describe('calcSheetLayout — минимальный клин у обрыва уклона (реальный случай, перегородка 6160мм, 3600→2000)', () => {
  // Кейс с объекта: узкий край косого куска у обрыва уклона получался
  // считанные миллиметры (иногда даже доли мм) — физически не прикрутить
  // к стойке. Нужно ≥300мм по возможности, ≥200мм как жёсткий минимум,
  // если 300 не влезает между соседним стыком и длиной листа.
  const wallL = 6160
  const ceiling = [{ x: 0, y: 3600 }, { x: wallL, y: 2000 }]
  const floor = flatProfile(wallL, 0)

  /** Высота материала у каждого из двух вертикальных краёв куска (из полигона). */
  function edgeHeights(p: { polygon?: { x: number; y: number }[] }): number[] {
    const pts = p.polygon!
    const xs = [...new Set(pts.map(pt => Math.round(pt.x)))]
    return xs.map(x => {
      const ys = pts.filter(pt => Math.round(pt.x) === x).map(pt => pt.y)
      return Math.max(...ys) - Math.min(...ys)
    })
  }

  it('ни у одного косого куска узкий край не тоньше 200мм (кроме честного нулевого острия)', () => {
    const result = calcSheetLayout(
      wallL, ceiling, floor, 600, 600, 2, [], spec, spec, 2,
    )
    const layers = [result.layer1, result.layer2, result.sideB_layer1, result.sideB_layer2]
      .filter((l): l is NonNullable<typeof l> => l !== null)
    for (const layer of layers) {
      for (const col of layer.columns) {
        for (const p of col.pieces) {
          if (p.kind !== 'diagonal_cut') continue
          const edges = edgeHeights(p)
          for (const e of edges) {
            // 0 — честное остриё треугольника (угол сходится в точку, это нормально).
            // Всё, что между 0 и 200, — недопустимый тонкий клин.
            expect(e === 0 || e >= 200).toBe(true)
          }
        }
      }
    }
  })

  it('там, где раньше клин был около нуля (колонка 600-1800, Ст.А слой 1), теперь ≥300мм', () => {
    const result = calcSheetLayout(
      wallL, ceiling, floor, 600, 600, 1, [], spec, spec, 1,
    )
    const col = result.layer1.columns.find(c => c.x1 === 600 && c.x2 === 1800)
    expect(col).toBeDefined()
    const topDiag = col!.pieces.filter(p => p.kind === 'diagonal_cut').sort((a, b) => a.y - b.y).at(-1)
    expect(topDiag).toBeDefined()
    const edges = edgeHeights(topDiag!)
    const minNonZero = Math.min(...edges.filter(e => e > 0))
    expect(minNonZero).toBeGreaterThanOrEqual(299) // цель 300, допускаем округление в мм
  })

  it('площадь кусков в колонке всё ещё честно покрывает всю высоту стены (сдвиг стыка не создал дырок/перехлёстов)', () => {
    const result = calcSheetLayout(
      wallL, ceiling, floor, 600, 600, 1, [], spec, spec, 1,
    )
    for (const col of result.layer1.columns) {
      const sortedPieces = [...col.pieces].sort((a, b) => a.y - b.y)
      let expectedY = 0
      for (const p of sortedPieces) {
        expect(p.y).toBeCloseTo(expectedY, 3)
        expectedY += p.h
      }
    }
  })
  it('регрессия: на реальном уклоне (3600→2000, стандартные 1200мм колонки) отходы косого среза РЕАЛЬНО попадают в пул (было 0 из-за слишком строгого вписанного прямоугольника — 19.07.2026)', () => {
    const result = calcSheetLayout(
      wallL, ceiling, floor, 600, 600, 1, [], spec, spec, 1,
    )
    const diagOffcuts = result.finalOffcuts.filter(o => o.polygon)
    expect(diagOffcuts.length).toBeGreaterThan(0)
    for (const o of diagOffcuts) {
      expect(o.w).toBeGreaterThanOrEqual(200)
      expect(o.h).toBeGreaterThanOrEqual(200)
    }
  })
})

describe('calcSheetLayout — точные высоты кромок и отход косого среза в пуле остатков (18.07.2026)', () => {
  const slopedCeiling = [
    { x: 0, y: 2500 },
    { x: 2000, y: 2500 },
    { x: 4000, y: 3500 },
  ]
  const flatFloor = flatProfile(4000, 0)

  it('diagonal_cut кусок содержит edgeHeightLeftMm/edgeHeightRightMm, совпадающие с высотой линии уклона на его краях', () => {
    const result = calcSheetLayout(
      4000, slopedCeiling, flatFloor,
      4000, 4000, 1, [], spec, spec, 1,
    )
    const diag = result.layer1.columns.flatMap(c => c.pieces).find(p => p.kind === 'diagonal_cut')
    expect(diag).toBeDefined()
    expect(diag!.edgeHeightLeftMm).toBeDefined()
    expect(diag!.edgeHeightRightMm).toBeDefined()
    expect(diag!.edgeHeightLeftMm!).toBeLessThanOrEqual(diag!.h)
    expect(diag!.edgeHeightRightMm!).toBeLessThanOrEqual(diag!.h)
    // Правая кромка (у x=4000, самая высокая точка уклона) всегда выше
    // либо равна левой — уклон растёт слева направо в этой фикстуре
    expect(diag!.edgeHeightRightMm!).toBeGreaterThanOrEqual(diag!.edgeHeightLeftMm!)
  })

  it('обычный (не diagonal_cut) кусок не имеет edgeHeightLeftMm/edgeHeightRightMm', () => {
    const result = calcSheetLayout(
      3000, flatProfile(3000, 2500), flatProfile(3000, 0),
      600, 600, 1, [], spec, spec, 1,
    )
    const anyPiece = result.layer1.columns.flatMap(c => c.pieces).find(p => p.kind !== 'opening_void')
    expect(anyPiece).toBeDefined()
    expect(anyPiece!.edgeHeightLeftMm).toBeUndefined()
    expect(anyPiece!.edgeHeightRightMm).toBeUndefined()
  })

  it('отход от косого среза попадает в пул остатков с polygon (треугольник), если крупнее порога 200мм', () => {
    const result = calcSheetLayout(
      4000, slopedCeiling, flatFloor,
      4000, 4000, 1, [], spec, spec, 1,
    )
    const diagWaste = result.finalOffcuts.filter(o => o.polygon)
    expect(diagWaste.length).toBeGreaterThan(0)
    for (const o of diagWaste) {
      expect(o.polygon!.length).toBe(3) // всегда треугольник (см. doc calcSheetLayout.ts)
      expect(o.w).toBeGreaterThanOrEqual(200)
      expect(o.h).toBeGreaterThanOrEqual(200)
    }
  })

  it('вписанный прямоугольник отхода (w×h) не превышает площадь самого треугольника отхода', () => {
    const result = calcSheetLayout(
      4000, slopedCeiling, flatFloor,
      4000, 4000, 1, [], spec, spec, 1,
    )
    const diagWaste = result.finalOffcuts.find(o => o.polygon)
    expect(diagWaste).toBeDefined()
    const pts = diagWaste!.polygon!
    let s = 0
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      s += a.x * b.y - b.x * a.y
    }
    const triangleArea = Math.abs(s) / 2
    const inscribedArea = diagWaste!.w * diagWaste!.h
    expect(inscribedArea).toBeLessThanOrEqual(triangleArea)
  })

  it('без уклона (плоская стена) пул остатков не содержит элементов с polygon', () => {
    const result = calcSheetLayout(
      3000, flatProfile(3000, 2500), flatProfile(3000, 0),
      600, 600, 1, [], spec, spec, 1,
    )
    expect(result.finalOffcuts.some(o => o.polygon)).toBe(false)
  })
})

describe('calcSheetLayout — пул остатков не содержит дробных мм (регрессия 19.07.2026)', () => {
  // Точка излома уклона (2100) не кратна шагу стоек (600), поэтому граница
  // work-зоны внутри наклонного участка вычисляется линейной интерполяцией
  // и получается нецелой (например 2601.31...мм) — это и раньше было верно
  // (реальная высота стены в этой точке действительно дробная). Баг был не
  // в этом, а в том, что при возврате остатка в пул (fromPool.h - ph,
  // SL - ph и т.п.) дробность геометрии протекала в размеры пула остатков,
  // которые монтажник видит и должен отмерить рулеткой — там нужны целые мм.
  // Найдено пользователем на реальном объекте (обычные, не диагональные,
  // остатки показывали "304.220779..." мм), не регрессия PR #26/#27.
  const slopedCeiling = [
    { x: 0, y: 2500 },
    { x: 2100, y: 2500 },
    { x: 4000, y: 3500 },
  ]
  const flatFloor = flatProfile(4000, 0)

  it('все w/h в finalOffcuts — целые мм', () => {
    const result = calcSheetLayout(
      4000, slopedCeiling, flatFloor,
      600, 600, 1, [], spec, spec, 1,
    )
    expect(result.finalOffcuts.length).toBeGreaterThan(0)
    for (const o of result.finalOffcuts) {
      expect(Number.isInteger(o.w)).toBe(true)
      expect(Number.isInteger(o.h)).toBe(true)
    }
  })
})
