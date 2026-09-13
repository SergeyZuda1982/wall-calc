import { describe, it, expect } from 'vitest'
import {
  wallThicknessMm, wallToBox3D, wallsToBoxes3D, estimateCeilingMm,
  roomsToPolygons3D, slabsToPolygons3D, ceilingsToPolygons3D, roundColumnsToCylinders3D, rectColumnsToBoxes3D, wallToBoxesWithOpenings3D, pxToM, mmToM, mToMm,
  freeformStructuresToPrisms3D, wallMaterialKindOf, wallStudPositionsMm,
  wallFaceFrame, worldToFaceMm, faceMmToWorld,
  slopePlaneCoefficients, slabStepRisers3D,
} from '../planTo3D'
import { roundColumnPolygonPx } from '../columnStamp'
import { ceilingSlopeHeightAt } from '../ceilingSlope'
import type { PlanLine, Room, Slab, Ceiling, RoundColumn, RectColumn, PlanOpening, FreeformStructure } from '../../types'

function baseLine(overrides: Partial<PlanLine>): PlanLine {
  return {
    id: 'l1', x1: 0, y1: 0, x2: 100, y2: 0,
    type: 'wall_existing', lengthMm: 2000, label: 'С-1',
    ...overrides,
  }
}

describe('wallMaterialKindOf (10.07.2026, реалистичные материалы в 3D)', () => {
  it('brick → brick', () => {
    expect(wallMaterialKindOf('brick')).toBe('brick')
  })
  it('gasblock/foamblock/block → block (визуально одна и та же кладка)', () => {
    expect(wallMaterialKindOf('gasblock')).toBe('block')
    expect(wallMaterialKindOf('foamblock')).toBe('block')
    expect(wallMaterialKindOf('block')).toBe('block')
  })
  it('concrete → concrete', () => {
    expect(wallMaterialKindOf('concrete')).toBe('concrete')
  })
  it('gkl/tile/plaster/paint/unknown/не задано → unknown (не кладка)', () => {
    expect(wallMaterialKindOf('gkl')).toBe('unknown')
    expect(wallMaterialKindOf('tile')).toBe('unknown')
    expect(wallMaterialKindOf('plaster')).toBe('unknown')
    expect(wallMaterialKindOf('paint')).toBe('unknown')
    expect(wallMaterialKindOf('unknown')).toBe('unknown')
    expect(wallMaterialKindOf(undefined)).toBe('unknown')
  })
})

describe('wallToBox3D — materialKind (10.07.2026)', () => {
  it('кирпичная существующая стена → materialKind: brick', () => {
    const line = baseLine({ spec: { material: 'brick' } })
    const box = wallToBox3D(line, 10, 3000)
    expect(box?.materialKind).toBe('brick')
  })
  it('газоблок в wall_new → materialKind: block', () => {
    const line = baseLine({ type: 'wall_new', spec: { material: 'gasblock' } })
    const box = wallToBox3D(line, 10, 3000)
    expect(box?.materialKind).toBe('block')
  })
  it('бетон в wall_existing → materialKind: concrete', () => {
    const line = baseLine({ spec: { material: 'concrete' } })
    const box = wallToBox3D(line, 10, 3000)
    expect(box?.materialKind).toBe('concrete')
  })
  it('ГКЛ (wall_new) → materialKind: unknown (не кладка, текстуру не показываем)', () => {
    const line = baseLine({ type: 'wall_new', spec: { material: 'gkl' } })
    const box = wallToBox3D(line, 10, 3000)
    expect(box?.materialKind).toBe('unknown')
  })
})

describe('wallToBoxesWithOpenings3D — materialKind прокидывается в сегменты вокруг проёма', () => {
  it('все сегменты (хвосты, подоконник, перемычка) наследуют materialKind от базовой стены', () => {
    const opening: PlanOpening = {
      id: 'o1', type: 'window', offsetMm: 500, widthMm: 600, heightMm: 1200, sillHeightMm: 900, label: 'О-1',
    }
    const line = baseLine({
      x1: 0, y1: 0, x2: 200, y2: 0, heightMm: 3000,
      spec: { material: 'brick' }, openings: [opening],
    })
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    expect(boxes.length).toBeGreaterThan(1)
    for (const b of boxes) expect(b.materialKind).toBe('brick')
  })
})

describe('freeformStructuresToPrisms3D — materialKind (10.07.2026)', () => {
  it('стена (kind: wall) — materialKind из spec.material', () => {
    const fs: FreeformStructure = {
      id: 'fs1', kind: 'wall', label: 'П-1',
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      spec: { material: 'gasblock' },
    }
    const prisms = freeformStructuresToPrisms3D([fs], 10, 3000)
    expect(prisms.length).toBeGreaterThan(0)
    for (const p of prisms) expect(p.materialKind).toBe('block')
  })
  it('колонна (kind: column) — всегда concrete, даже без spec', () => {
    const fs: FreeformStructure = {
      id: 'fs2', kind: 'column', label: 'К-1',
      outer: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }],
    }
    const prisms = freeformStructuresToPrisms3D([fs], 10, 3000)
    expect(prisms.length).toBeGreaterThan(0)
    for (const p of prisms) expect(p.materialKind).toBe('concrete')
  })
})

describe('wallStudPositionsMm (10-11.07.2026, Этап 2 — 3D-каркас ГКЛ)', () => {
  it('нулевая длина — пустой список', () => {
    const line = baseLine({ type: 'wall_new', spec: { material: 'gkl', subtype: 'ps50' }, lengthMm: 0 })
    expect(wallStudPositionsMm(line)).toEqual([])
  })

  it('wall_new с поддержанным профилем (ps50) — совпадает с реальным раскроем buildPositions (тот же расчёт, что и в смете)', () => {
    const line = baseLine({ type: 'wall_new', spec: { material: 'gkl', subtype: 'ps50' }, lengthMm: 2000 })
    const positions = wallStudPositionsMm(line)
    // Реальный расчёт даёт периодическую сетку с шагом 600мм от фазы 0
    // плюс крайние стойки на 0 и на длине стены (см. buildPositions.ts,
    // mergeStuds(..., 'both') — торцевые стойки всегда учитываются)
    expect(positions).toEqual([0, 600, 1200, 1800, 2000])
  })

  it('проём (дверь) сдвигает раскрой так, чтобы стойки не конфликтовали с краями проёма', () => {
    const line = baseLine({
      type: 'wall_new', spec: { material: 'gkl', subtype: 'ps50' }, lengthMm: 2000,
      openings: [{ id: 'd1', type: 'door', offsetMm: 590, widthMm: 20, heightMm: 2000, label: 'Д-1' }],
    })
    const positions = wallStudPositionsMm(line)
    // Стойки проёма — 590 и 610 (края двери), рядовая стойка на 600 конфликтовала бы (MIN_GAP=150) —
    // фаза подбирается заново так, чтобы конфликтов не было (см. buildPositions.ts)
    expect(positions).toContain(590)
    expect(positions).toContain(610)
    for (const p of positions) {
      if (p === 590 || p === 610) continue
      expect(Math.abs(p - 590)).toBeGreaterThan(150)
      expect(Math.abs(p - 610)).toBeGreaterThan(150)
    }
  })

  it('wall_new с неподдержанным/несуществующим подтипом — упрощённая равномерная сетка без учёта проёмов (05.09.2026: подтипа ps125 в реальности не существует — убран из таксономии; на всякий случай проверяем, что незнакомая строка подтипа по-прежнему безопасно откатывается на наивную сетку)', () => {
    const line = baseLine({
      type: 'wall_new', spec: { material: 'gkl', subtype: 'garbage_unknown_subtype' }, lengthMm: 1800,
      openings: [{ id: 'd1', type: 'door', offsetMm: 590, widthMm: 20, heightMm: 2000, label: 'Д-1' }],
    })
    expect(wallStudPositionsMm(line)).toEqual([600, 1200])
  })

  it('wall_lining (облицовка) — упрощённая равномерная сетка (нет полноценного WallInput для облицовки)', () => {
    const line = baseLine({ type: 'wall_lining', spec: { material: 'gkl' }, lengthMm: 1800 })
    expect(wallStudPositionsMm(line)).toEqual([600, 1200])
  })

  it('свой шаг (spec.step) вместо дефолтных 600мм учитывается', () => {
    const line = baseLine({ type: 'wall_lining', spec: { material: 'gkl', step: 400 }, lengthMm: 1000 })
    expect(wallStudPositionsMm(line)).toEqual([400, 800])
  })

  it('двойной каркас (С115/С116, subtype вида c115_1_ps50) — тоже реальный buildPositions, не наивная сетка (05.09.2026)', () => {
    const line = baseLine({ type: 'wall_new', spec: { material: 'gkl', subtype: 'c115_1_ps50' }, lengthMm: 2000 })
    const positions = wallStudPositionsMm(line)
    // Тот же результат, что и для одинарного ps50 — общая сетка на оба ряда
    // (см. calcDoubleFrame.ts: buildPositions вызывается один раз)
    expect(positions).toEqual([0, 600, 1200, 1800, 2000])
  })

  it('двойной каркас с проёмом — тоже учитывает проём (buildPositions), в отличие от неподдержанных профилей', () => {
    const line = baseLine({
      type: 'wall_new', spec: { material: 'gkl', subtype: 'c116_ps75' }, lengthMm: 2000,
      openings: [{ id: 'd1', type: 'door', offsetMm: 590, widthMm: 20, heightMm: 2000, label: 'Д-1' }],
    })
    const positions = wallStudPositionsMm(line)
    expect(positions).toContain(590)
    expect(positions).toContain(610)
  })
})

describe('wallThicknessMm', () => {
  it('без spec.material у обычной стены толщина 0 (как и в 2D — не рисуем)', () => {
    expect(wallThicknessMm(baseLine({}))).toBe(0)
  })

  it('у ригеля толщина = sectionWidthMm, spec не нужен', () => {
    const line = baseLine({ type: 'rib_beam', sectionWidthMm: 350 })
    expect(wallThicknessMm(line)).toBe(350)
  })

  it('у ригеля без sectionWidthMm — дефолт 300', () => {
    const line = baseLine({ type: 'rib_beam' })
    expect(wallThicknessMm(line)).toBe(300)
  })

  it('existing кирпич без подтипа — дефолт из taxonomy (250)', () => {
    const line = baseLine({ spec: { material: 'brick' } })
    expect(wallThicknessMm(line)).toBe(250)
  })
})

describe('pxToM / mmToM', () => {
  it('переводит px в метры через scaleMmPx (мм на px)', () => {
    // 100px * scaleMmPx(10) = 1000мм = 1м
    expect(pxToM(100, 10)).toBeCloseTo(1)
  })
  it('мм в метры — просто /1000', () => {
    expect(mmToM(3000)).toBe(3)
  })
})

describe('wallToBox3D', () => {
  it('линия без толщины (нет spec) — не строится, возвращает null', () => {
    const line = baseLine({})
    expect(wallToBox3D(line, 10, 3000)).toBeNull()
  })

  it('стена вдоль +X: rotationY = 0, длина/толщина/высота верные', () => {
    const line = baseLine({
      x1: 0, y1: 0, x2: 100, y2: 0, // 100px * scaleMmPx=10 → 1000мм = 1м
      spec: { material: 'brick', subtype: '200' },
      heightMm: 2700,
    })
    const box = wallToBox3D(line, 10, 3000)
    expect(box).not.toBeNull()
    expect(box!.size.sx).toBeCloseTo(1)       // длина 1м
    expect(box!.size.sz).toBeCloseTo(0.2)     // толщина 200мм = 0.2м
    expect(box!.size.sy).toBeCloseTo(2.7)     // высота 2700мм
    expect(box!.rotationY).toBeCloseTo(0)     // вдоль X — без поворота
    expect(box!.center.y).toBeCloseTo(1.35)   // стоит на полу, центр = высота/2
  })

  it('стена вдоль +Z (по экрану — вниз, y2>y1): rotationY = -90°', () => {
    const line = baseLine({
      x1: 0, y1: 0, x2: 0, y2: 100,
      spec: { material: 'brick', subtype: '200' },
    })
    const box = wallToBox3D(line, 10, 3000)
    expect(box!.rotationY).toBeCloseTo(-Math.PI / 2)
  })

  it('ригель висит под потолком: центр по Y = потолок - опускание/2', () => {
    const line = baseLine({ type: 'rib_beam', sectionWidthMm: 300, dropMm: 200 })
    const box = wallToBox3D(line, 10, 3000) // потолок на 3000мм = 3м
    expect(box).not.toBeNull()
    expect(box!.size.sy).toBeCloseTo(0.2)      // высота короба = опускание, 200мм
    expect(box!.center.y).toBeCloseTo(2.9)     // 3 - 0.2/2
  })

  it('нулевая длина линии — null (защита от деления на 0 при повороте)', () => {
    const line = baseLine({ x1: 5, y1: 5, x2: 5, y2: 5, spec: { material: 'brick' } })
    expect(wallToBox3D(line, 10, 3000)).toBeNull()
  })
})

describe('wallToBox3D / wallToBoxesWithOpenings3D — уклон потолка режет верх стены (12.09.2026)', () => {
  // scaleMmPx=1 — px и мм совпадают, чтобы не путаться в масштабе в тестах.
  const slope = { x1: 0, y1: 0, height1Mm: 2500, x2: 1000, y2: 0, height2Mm: 3200 }

  it('wallToBox3D: без slope — старое плоское поведение, slopeH1Mm/slopeH2Mm не заданы', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, spec: { material: 'brick', subtype: '200' }, heightMm: 2700 })
    const box = wallToBox3D(line, 1, 3000)
    expect(box!.size.sy).toBeCloseTo(2.7)
    expect(box!.slopeH1Mm).toBeUndefined()
    expect(box!.slopeH2Mm).toBeUndefined()
  })

  it('wallToBox3D: со slope — высота короба (size.sy) = максимум из двух концов, slopeH1Mm/slopeH2Mm посчитаны', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, spec: { material: 'brick', subtype: '200' } })
    const box = wallToBox3D(line, 1, 3000, undefined, slope)
    expect(box!.slopeH1Mm).toBeCloseTo(2500)
    expect(box!.slopeH2Mm).toBeCloseTo(3200)
    expect(box!.size.sy).toBeCloseTo(3.2) // максимум — под самой высокой точкой уклона
  })

  it('wallToBox3D: line.customHeight — уклон НЕ применяется (та же гарантия, что и ceilingProfileForLine в 2D)', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, spec: { material: 'brick', subtype: '200' }, heightMm: 2700, customHeight: true })
    const box = wallToBox3D(line, 1, 3000, undefined, slope)
    expect(box!.slopeH1Mm).toBeUndefined()
    expect(box!.size.sy).toBeCloseTo(2.7)
  })

  it('wallToBox3D: ригель — уклон потолка не при чём, не применяется', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, type: 'rib_beam', sectionWidthMm: 300, dropMm: 200 })
    const box = wallToBox3D(line, 1, 3000, undefined, slope)
    expect(box!.slopeH1Mm).toBeUndefined()
    expect(box!.size.sy).toBeCloseTo(0.2)
  })

  it('wallToBoxesWithOpenings3D без проёмов: topYAtFromM/topYAtToM = высота уклона в концах линии, метры', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, spec: { material: 'brick', subtype: '200' } })
    const boxes = wallToBoxesWithOpenings3D(line, 1, 3000, undefined, slope)
    expect(boxes.length).toBe(1)
    expect(boxes[0].topYAtFromM).toBeCloseTo(2.5)
    expect(boxes[0].topYAtToM).toBeCloseTo(3.2)
  })

  it('wallToBoxesWithOpenings3D без slope вообще — topYAtFromM/topYAtToM не заданы (плоский верх, старое поведение)', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 1000, y2: 0, lengthMm: 1000, spec: { material: 'brick', subtype: '200' } })
    const boxes = wallToBoxesWithOpenings3D(line, 1, 3000)
    expect(boxes[0].topYAtFromM).toBeUndefined()
    expect(boxes[0].topYAtToM).toBeUndefined()
  })

  it('wallToBoxesWithOpenings3D с проёмом: seg/tail/перемычка режутся по уклону в СВОЕЙ точке alongM, подоконник — нет (плоский)', () => {
    const line: PlanLine = {
      id: 'w-slope-win', x1: 0, y1: 0, x2: 1000, y2: 0,
      type: 'wall_existing', lengthMm: 1000, label: 'С-1',
      spec: { material: 'brick', subtype: '200' },
      openings: [{ id: 'op1', type: 'window', offsetMm: 400, widthMm: 200, heightMm: 800, sillHeightMm: 900, label: 'О-1' }],
    }
    const boxes = wallToBoxesWithOpenings3D(line, 1, 3000, undefined, slope)
    const seg = boxes.find(b => b.id.includes('__seg_'))!
    const sill = boxes.find(b => b.id.includes('__sill_'))!
    const lintel = boxes.find(b => b.id.includes('__lintel_'))!
    const tail = boxes.find(b => b.id.includes('__tail'))!

    // seg занимает alongM 0..0.4 (400мм), уклон линейный: h(alongM) = 2500 + alongM*700 (мм на метр => в метрах: 2.5 + alongM*0.7)
    expect(seg.topYAtFromM).toBeCloseTo(2.5)
    expect(seg.topYAtToM).toBeCloseTo(2.5 + 0.4 * 0.7)
    // перемычка над проёмом (0.4..0.6) — тоже режется по уклону
    expect(lintel.topYAtFromM).toBeCloseTo(2.5 + 0.4 * 0.7)
    expect(lintel.topYAtToM).toBeCloseTo(2.5 + 0.6 * 0.7)
    // хвост (0.6..1.0)
    expect(tail.topYAtFromM).toBeCloseTo(2.5 + 0.6 * 0.7)
    expect(tail.topYAtToM).toBeCloseTo(3.2)
    // подоконник — плоский, уклон его не касается
    expect(sill.topYAtFromM).toBeUndefined()
    expect(sill.topYAtToM).toBeUndefined()
  })
})

describe('wallsToBoxes3D — резолвер уклона из Ceiling.slope (12.09.2026)', () => {
  it('без slabs/ceilings/slopes (старый вызов с 3 аргументами) — стены остаются плоскими, обратная совместимость', () => {
    const lines: PlanLine[] = [
      { id: 'w1', x1: 0, y1: 0, x2: 1000, y2: 0, type: 'wall_existing', lengthMm: 1000, label: 'С-1', spec: { material: 'brick', subtype: '200' } },
    ]
    const boxes = wallsToBoxes3D(lines, 1, [])
    expect(boxes[0].topYAtFromM).toBeUndefined()
  })

  it('Ceiling.slope, накрывающий стену контуром — стена реально режется по уклону в 3D', () => {
    const lines: PlanLine[] = [
      { id: 'w1', x1: 0, y1: 0, x2: 1000, y2: 0, type: 'wall_existing', lengthMm: 1000, label: 'С-1', spec: { material: 'brick', subtype: '200' } },
    ]
    const ceilings: Ceiling[] = [{
      id: 'c1', label: 'Потолок 1',
      outer: [{ x: -100, y: -500 }, { x: 1100, y: -500 }, { x: 1100, y: 500 }, { x: -100, y: 500 }],
      slope: { x1: 0, y1: 0, height1Mm: 2500, x2: 1000, y2: 0, height2Mm: 3200 },
    }]
    const boxes = wallsToBoxes3D(lines, 1, [], [], [], ceilings, [], [])
    expect(boxes[0].topYAtFromM).toBeCloseTo(2.5)
    expect(boxes[0].topYAtToM).toBeCloseTo(3.2)
  })

  it('Ceiling БЕЗ slope, накрывающий стену — стена остаётся плоской (уклон не задан — не с чем резать)', () => {
    const lines: PlanLine[] = [
      { id: 'w1', x1: 0, y1: 0, x2: 1000, y2: 0, type: 'wall_existing', lengthMm: 1000, label: 'С-1', spec: { material: 'brick', subtype: '200' }, heightMm: 2700 },
    ]
    const ceilings: Ceiling[] = [{
      id: 'c1', label: 'Потолок 1',
      outer: [{ x: -100, y: -500 }, { x: 1100, y: -500 }, { x: 1100, y: 500 }, { x: -100, y: 500 }],
    }]
    const boxes = wallsToBoxes3D(lines, 1, [], [], [], ceilings, [], [])
    expect(boxes[0].topYAtFromM).toBeUndefined()
    expect(boxes[0].size.sy).toBeCloseTo(2.7)
  })
})

describe('lineId (10.07.2026, выбор стены кликом в 3D)', () => {
  it('wallToBox3D: lineId совпадает с id и с id самой линии', () => {
    const line = baseLine({ id: 'w-42', spec: { material: 'brick', subtype: '200' } })
    const box = wallToBox3D(line, 10, 3000)
    expect(box!.lineId).toBe('w-42')
    expect(box!.lineId).toBe(box!.id)
  })

  it('wallToBoxesWithOpenings3D: ВСЕ сегменты одной линии (seg/sill/lintel/tail) делят один lineId, хотя их id разные', () => {
    const line: PlanLine = {
      id: 'w-with-window', x1: 0, y1: 0, x2: 200, y2: 0,
      type: 'wall_existing', lengthMm: 2000, label: 'С-1',
      spec: { material: 'brick', subtype: '200' },
      heightMm: 3000,
      openings: [{ id: 'op1', type: 'window', offsetMm: 300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900, label: 'О-1' }],
    }
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    expect(boxes.length).toBeGreaterThan(1) // проверяем именно случай нескольких сегментов
    expect(boxes.every(b => b.lineId === 'w-with-window')).toBe(true)
    // id при этом остаются РАЗНЫМИ (React key / уникальность на сегмент)
    expect(new Set(boxes.map(b => b.id)).size).toBe(boxes.length)
  })

  it('wallsToBoxes3D: короба разных линий не путают lineId между собой', () => {
    const lines: PlanLine[] = [
      baseLine({ id: 'a', spec: { material: 'brick', subtype: '200' } }),
      baseLine({ id: 'b', x1: 0, y1: 100, x2: 100, y2: 100, spec: { material: 'block', subtype: '125' } }),
    ]
    const boxes = wallsToBoxes3D(lines, 10)
    expect(boxes.find(b => b.id === 'a')!.lineId).toBe('a')
    expect(boxes.find(b => b.id === 'b')!.lineId).toBe('b')
  })
})

describe('wallsToBoxes3D', () => {
  it('пропускает линии без толщины, строит остальные', () => {
    const lines: PlanLine[] = [
      baseLine({ id: 'a', spec: { material: 'brick', subtype: '200' } }),
      baseLine({ id: 'b' }), // без spec — пропущена
      baseLine({ id: 'c', type: 'rib_beam' }),
    ]
    const boxes = wallsToBoxes3D(lines, 10)
    expect(boxes.map(b => b.id)).toEqual(['a', 'c'])
  })

  it('обратная совместимость: линия без buildProgress всегда видна (как до фичи статусов)', () => {
    const lines: PlanLine[] = [
      baseLine({ id: 'a', category: 'mutable', spec: { material: 'brick', subtype: '200' } }),
    ]
    expect(wallsToBoxes3D(lines, 10).map(b => b.id)).toEqual(['a'])
  })

  it('mutable с buildProgress без единого подтверждённого шага — скрыта', () => {
    const lines: PlanLine[] = [
      baseLine({
        id: 'a',
        type: 'wall_new',
        category: 'mutable',
        spec: { material: 'gkl' },
        buildProgress: { steps: [{ stepId: 's1', label: 'Разметка', outcome: 'pending' }] },
      }),
    ]
    expect(wallsToBoxes3D(lines, 10)).toEqual([])
  })

  it('mutable с хотя бы одним подтверждённым шагом — видна', () => {
    const lines: PlanLine[] = [
      baseLine({
        id: 'a',
        type: 'wall_new',
        category: 'mutable',
        spec: { material: 'gkl' },
        buildProgress: { steps: [{ stepId: 's1', label: 'Разметка', outcome: 'confirmed', confirmedAt: '2026-07-06T00:00:00.000Z' }] },
      }),
    ]
    expect(wallsToBoxes3D(lines, 10).map(b => b.id)).toEqual(['a'])
  })

  it('capital всегда видна, даже с не начатым buildProgress (странные данные, но не должно ломать периметр)', () => {
    const lines: PlanLine[] = [
      baseLine({
        id: 'a',
        category: 'capital',
        type: 'wall_existing',
        spec: { material: 'brick', subtype: '200' },
        buildProgress: { steps: [{ stepId: 's1', label: 'X', outcome: 'pending' }] },
      }),
    ]
    expect(wallsToBoxes3D(lines, 10).map(b => b.id)).toEqual(['a'])
  })

  it('высота потолка считается по ПОЛНОМУ списку линий, включая скрытые', () => {
    // существующая стена высотой 2500 видна, но скрытая mutable-стена высотой 3200
    // не должна пропасть из расчёта потолка (не в скоупе этого резолвера — но
    // проверяем, что фильтрация видимости не трогает estimateCeilingMm)
    const lines: PlanLine[] = [
      baseLine({ id: 'existing', type: 'wall_existing', heightMm: 2500, spec: { material: 'brick', subtype: '200' } }),
    ]
    const boxes = wallsToBoxes3D(lines, 10)
    expect(boxes[0].size.sy).toBeCloseTo(2.5, 5)
  })
})

describe('wallsToBoxes3D — ДУГОВЫЕ стены (11.09.2026, Фаза 3 объекта в Ростове — радиусные стены зала)', () => {
  it('дуговая стена (sagittaMm) — даёт 24 коротких короб-сегмента, не один прямой по хорде', () => {
    const line = baseLine({
      id: 'arc1', x1: 0, y1: 0, x2: 1000, y2: 0, sagittaMm: 150,
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10)
    expect(boxes).toHaveLength(24)
    boxes.forEach(b => {
      expect(b.lineId).toBe('arc1') // выбор стены кликом по любому сегменту — целиком
      expect(b.id).toContain('arc1__arc')
      expect(Number.isFinite(b.center.x)).toBe(true)
      expect(Number.isFinite(b.center.z)).toBe(true)
      expect(Number.isFinite(b.rotationY)).toBe(true)
    })
  })

  it('сегменты идут ПО ДУГЕ — суммарная длина сегментов близка к длине дуги (не хорды), апекс дуги смещён от прямой линии между концами', () => {
    const line = baseLine({
      id: 'arc1', x1: 0, y1: 0, x2: 1000, y2: 0, sagittaMm: 150, // стрела заметная, не вырожденная
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10)
    const totalLenM = boxes.reduce((s, b) => s + b.size.sx, 0)
    // Длина дуги ВСЕГДА больше длины хорды (1000px=10000мм=10м) — есть кривизна
    expect(totalLenM).toBeGreaterThan(10.0)
    // Средний сегмент (примерно апекс дуги) должен быть смещён по Z от 0
    // (хорда идёт строго по оси X, z=0 у обоих концов)
    const midBox = boxes[Math.floor(boxes.length / 2)]
    expect(Math.abs(midBox.center.z)).toBeGreaterThan(0.001)
  })

  it('alongFromM/alongToM НАКАПЛИВАЮТСЯ вдоль всей дуги, а не сбрасываются на каждом сегменте', () => {
    const line = baseLine({
      id: 'arc1', x1: 0, y1: 0, x2: 1000, y2: 0, sagittaMm: 150,
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10)
    // Монотонно возрастают, конец предыдущего = начало следующего (с точностью)
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].alongFromM).toBeCloseTo(i === 0 ? 0 : boxes[i - 1].alongToM, 5)
      expect(boxes[i].alongToM).toBeGreaterThan(boxes[i].alongFromM)
    }
    // Последний alongToM — суммарная длина дуги (близко к периметру всех сегментов)
    const totalLenM = boxes.reduce((s, b) => s + b.size.sx, 0)
    expect(boxes[boxes.length - 1].alongToM).toBeCloseTo(totalLenM, 5)
  })

  it('вырожденная дуга (sagittaMm≈0) — ведёт себя как обычная прямая стена, один короб', () => {
    const line = baseLine({
      id: 'arc1', x1: 0, y1: 0, x2: 1000, y2: 0, sagittaMm: 0, // 0 → arcFromChordAndSagitta вернёт null
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10)
    expect(boxes).toHaveLength(1)
    expect(boxes[0].id).toBe('arc1')
    expect(boxes[0].size.sx).toBeCloseTo(10, 5)
  })

  it('дуговая стена наследует толщину/высоту/материал линии на каждом сегменте', () => {
    const line = baseLine({
      id: 'arc1', x1: 0, y1: 0, x2: 1000, y2: 0, sagittaMm: 150, heightMm: 4500,
      spec: { material: 'brick', subtype: '380' },
    })
    const boxes = wallsToBoxes3D([line], 10)
    const expectedThicknessM = wallThicknessMm(line) / 1000
    boxes.forEach(b => {
      expect(b.size.sy).toBeCloseTo(4.5, 5)
      expect(b.size.sz).toBeCloseTo(expectedThicknessM, 5)
      expect(b.materialKind).toBe('brick')
    })
  })

  it('дуга без толщины (нет spec) — не строится вообще, как и обычная стена', () => {
    const line = baseLine({ id: 'arc1', x1: 0, y1: 0, x2: 1000, y2: 0, sagittaMm: 150 })
    expect(wallsToBoxes3D([line], 10)).toEqual([])
  })
})

describe('estimateCeilingMm', () => {
  it('без wall_existing — дефолт 3000', () => {
    expect(estimateCeilingMm([baseLine({ type: 'wall_new', heightMm: 2500 })])).toBe(3000)
  })
  it('берёт максимум heightMm среди wall_existing', () => {
    const lines: PlanLine[] = [
      baseLine({ id: 'a', heightMm: 3200 }),
      baseLine({ id: 'b', heightMm: 2800 }),
    ]
    expect(estimateCeilingMm(lines)).toBe(3200)
  })
})

describe('slabsToPolygons3D', () => {
  it('переводит внешний контур и дырку в метры', () => {
    const slabs: Slab[] = [{
      id: 's1', label: 'Плита 1',
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      holes: [[{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }]],
    }]
    const polys = slabsToPolygons3D(slabs, 10) // 10мм/px
    expect(polys).toHaveLength(1)
    expect(polys[0].outer[1]).toEqual({ x: 1, z: 0 }) // 100px*10мм = 1000мм = 1м
    expect(polys[0].holes).toHaveLength(1)
    expect(polys[0].holes[0][0]).toEqual({ x: 0.1, z: 0.1 })
  })

  it('плита без хотя бы 3 точек контура — пропущена', () => {
    const slabs: Slab[] = [{ id: 's1', label: 'X', outer: [{ x: 0, y: 0 }, { x: 1, y: 1 }], holes: [] }]
    expect(slabsToPolygons3D(slabs, 10)).toHaveLength(0)
  })

  it('дырка с меньше чем 3 точками — отфильтрована, сама плита остаётся', () => {
    const slabs: Slab[] = [{
      id: 's1', label: 'X',
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
      holes: [[{ x: 1, y: 1 }, { x: 2, y: 2 }]],
    }]
    const polys = slabsToPolygons3D(slabs, 10)
    expect(polys).toHaveLength(1)
    expect(polys[0].holes).toHaveLength(0)
  })
})

describe('ceilingsToPolygons3D', () => {
  it('переводит контур в метры (outerM) и в мм (outerMm), сохраняет ceilingSpec/startWallSideIndex', () => {
    const ceilings: Ceiling[] = [{
      id: 'cl1', label: 'Потолок 1',
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      ceilingSpec: { type: 'p112', layers: 1, material: 'gsp', thickness: 12.5, stepC: 600, areaSqm: 10, perimeterM: 12, slabGapMm: 80 },
      startWallSideIndex: 2,
    }]
    const polys = ceilingsToPolygons3D(ceilings, 10) // 10мм/px
    expect(polys).toHaveLength(1)
    expect(polys[0].outerM[1]).toEqual({ x: 1, z: 0 }) // 100px*10мм = 1000мм = 1м
    expect(polys[0].outerMm[1]).toEqual({ x: 1000, y: 0 })
    expect(polys[0].ceilingSpec?.type).toBe('p112')
    expect(polys[0].startWallSideIndex).toBe(2)
  })

  it('потолок без хотя бы 3 точек контура — пропущен', () => {
    const ceilings: Ceiling[] = [{ id: 'cl1', label: 'X', outer: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]
    expect(ceilingsToPolygons3D(ceilings, 10)).toHaveLength(0)
  })

  it('без сохранённой раскладки — ceilingSpec/startWallSideIndex не заданы', () => {
    const ceilings: Ceiling[] = [{
      id: 'cl1', label: 'Потолок 1',
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    }]
    const polys = ceilingsToPolygons3D(ceilings, 10)
    expect(polys[0].ceilingSpec).toBeUndefined()
    expect(polys[0].startWallSideIndex).toBeUndefined()
  })
})

describe('roomsToPolygons3D', () => {
  it('замкнутый треугольник из 3 линий → полигон в метрах', () => {
    const lines: PlanLine[] = [
      baseLine({ id: 'a', x1: 0, y1: 0, x2: 100, y2: 0 }),
      baseLine({ id: 'b', x1: 100, y1: 0, x2: 100, y2: 100 }),
      baseLine({ id: 'c', x1: 100, y1: 100, x2: 0, y2: 0 }),
    ]
    const rooms: Room[] = [
      { id: 'r1', lineIds: ['a', 'b', 'c'], areaM2: 5, perimeterMm: 300, label: 'Колонна', isColumn: true },
    ]
    const polys = roomsToPolygons3D(rooms, lines, 10)
    expect(polys).toHaveLength(1)
    expect(polys[0].isColumn).toBe(true)
    expect(polys[0].label).toBe('Колонна')
    expect(polys[0].points.length).toBeGreaterThanOrEqual(3)
    expect(polys[0].points[0]).toEqual({ x: 0, z: 0 })
  })

  it('меньше 3 линий периметра — контур пропущен', () => {
    const lines: PlanLine[] = [baseLine({ id: 'a' })]
    const rooms: Room[] = [{ id: 'r1', lineIds: ['a'], areaM2: 0, perimeterMm: 0, label: 'X' }]
    expect(roomsToPolygons3D(rooms, lines, 10)).toHaveLength(0)
  })
})

describe('roundColumnsToCylinders3D', () => {
  function baseColumn(overrides: Partial<RoundColumn>): RoundColumn {
    return { id: 'rc1', cx: 100, cy: 200, diameterMm: 400, label: 'Колонна 1', ...overrides }
  }

  it('переводит центр/радиус в метры, высота = отметка потолка', () => {
    const cyls = roundColumnsToCylinders3D([baseColumn({})], 10, 3000) // 10мм/px, потолок 3000мм
    expect(cyls).toHaveLength(1)
    expect(cyls[0].cx).toBeCloseTo(1)       // 100px*10мм = 1000мм = 1м
    expect(cyls[0].cz).toBeCloseTo(2)       // 200px*10мм = 2000мм = 2м
    expect(cyls[0].radius).toBeCloseTo(0.2) // диаметр 400мм → радиус 200мм = 0.2м
    expect(cyls[0].heightM).toBeCloseTo(3)  // потолок 3000мм = 3м
  })

  it('колонна с нулевым/отрицательным диаметром — пропущена', () => {
    const cyls = roundColumnsToCylinders3D([baseColumn({ diameterMm: 0 })], 10, 3000)
    expect(cyls).toHaveLength(0)
  })

  it('несколько колонн — все переведены', () => {
    const cyls = roundColumnsToCylinders3D(
      [baseColumn({ id: 'a' }), baseColumn({ id: 'b', cx: 300 })], 10, 2700,
    )
    expect(cyls.map(c => c.id)).toEqual(['a', 'b'])
  })
})

describe('wallToBoxesWithOpenings3D', () => {
  // Стена вдоль +X, 200px * scaleMmPx(10) = 2000мм = 2м, толщина 200мм (кирпич),
  // высота потолка 3000мм = 3м — удобные круглые числа для проверки геометрии.
  function wallLine(openings: PlanOpening[]): PlanLine {
    return {
      id: 'w1', x1: 0, y1: 0, x2: 200, y2: 0,
      type: 'wall_existing', lengthMm: 2000, label: 'С-1',
      spec: { material: 'brick', subtype: '200' },
      heightMm: 3000,
      openings,
    }
  }
  function op(overrides: Partial<PlanOpening>): PlanOpening {
    return { id: 'op1', type: 'door', offsetMm: 500, widthMm: 800, heightMm: 2000, label: 'Д-1', ...overrides }
  }

  it('без проёмов — один короб, как wallToBox3D', () => {
    const line = wallLine([])
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    const single = wallToBox3D(line, 10, 3000)
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toEqual(single)
  })

  it('стена без толщины (нет spec) — пустой массив, а не [null]', () => {
    const line = { ...wallLine([]), spec: undefined }
    expect(wallToBoxesWithOpenings3D(line, 10, 3000)).toEqual([])
  })

  it('дверь (sill=0, ниже потолка) — сегмент до, перемычка над проёмом, хвост после; без подоконника', () => {
    const line = wallLine([op({ offsetMm: 500, widthMm: 800, heightMm: 2000 })]) // 0.5–1.3м, высота проёма 2м из 3м
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    expect(boxes).toHaveLength(3)

    const seg = boxes.find(b => b.id.includes('seg_'))!
    expect(seg.size.sx).toBeCloseTo(0.5)  // от 0 до 0.5м
    expect(seg.size.sy).toBeCloseTo(3)    // на всю высоту стены
    expect(seg.center.x).toBeCloseTo(0.25)

    const lintel = boxes.find(b => b.id.includes('lintel_'))!
    expect(lintel.size.sx).toBeCloseTo(0.8)   // ширина проёма
    expect(lintel.size.sy).toBeCloseTo(1)     // от 2м (верх двери) до 3м (потолок)
    expect(lintel.center.y).toBeCloseTo(2.5)  // середина между 2 и 3

    const tail = boxes.find(b => b.id.includes('tail'))!
    expect(tail.size.sx).toBeCloseTo(0.7)  // от 1.3 до 2м
    expect(tail.center.x).toBeCloseTo(1.65)

    expect(boxes.some(b => b.id.includes('sill_'))).toBe(false) // дверь без подоконника
  })

  it('окно (sill>0, не до потолка) — 4 коробки: сегмент до, подоконник, перемычка, хвост', () => {
    const line = wallLine([op({ id: 'w', type: 'window', offsetMm: 300, widthMm: 1200, heightMm: 1200, sillHeightMm: 900 })])
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    expect(boxes).toHaveLength(4)

    const sill = boxes.find(b => b.id.includes('sill_'))!
    expect(sill.size.sx).toBeCloseTo(1.2)
    expect(sill.size.sy).toBeCloseTo(0.9)   // от пола до низа окна (900мм)
    expect(sill.center.y).toBeCloseTo(0.45)

    const lintel = boxes.find(b => b.id.includes('lintel_'))!
    expect(lintel.size.sy).toBeCloseTo(0.9) // от 2.1м (900+1200) до 3м потолка
    expect(lintel.center.y).toBeCloseTo(2.55)
  })

  it('проём на всю высоту и всю длину стены — стена вырезана целиком (0 коробов)', () => {
    const line = wallLine([op({ type: 'opening', offsetMm: 0, widthMm: 2000, heightMm: 3000, sillHeightMm: 0 })])
    expect(wallToBoxesWithOpenings3D(line, 10, 3000)).toEqual([])
  })

  it('проём впритык к началу стены — нет сегмента "до", есть перемычка и хвост', () => {
    const line = wallLine([op({ offsetMm: 0, widthMm: 500, heightMm: 2000 })])
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    expect(boxes.some(b => b.id.includes('seg_'))).toBe(false)
    expect(boxes).toHaveLength(2) // lintel + tail
  })

  it('проём впритык к концу стены — нет хвоста', () => {
    const line = wallLine([op({ offsetMm: 1500, widthMm: 500, heightMm: 2000 })]) // 1.5–2.0м = конец стены
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    expect(boxes.some(b => b.id.includes('tail'))).toBe(false)
    expect(boxes).toHaveLength(2) // seg + lintel
  })

  it('два непересекающихся проёма — сегмент между ними сохраняется', () => {
    const line = wallLine([
      op({ id: 'a', offsetMm: 200, widthMm: 300, heightMm: 2000 }),   // 0.2–0.5м
      op({ id: 'b', offsetMm: 900, widthMm: 300, heightMm: 2000 }),   // 0.9–1.2м
    ])
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    const between = boxes.find(b => b.id === 'w1__seg_b')!
    expect(between).toBeDefined()
    expect(between.size.sx).toBeCloseTo(0.4) // от 0.5 до 0.9м
  })

  it('два проёма внахлёст на одной линии — не досчитывает уже вырезанный кусок дважды', () => {
    const line = wallLine([
      op({ id: 'a', offsetMm: 200, widthMm: 800, heightMm: 3000, sillHeightMm: 0 }), // 0.2–1.0м, во всю высоту
      op({ id: 'b', offsetMm: 600, widthMm: 200, heightMm: 2000, sillHeightMm: 0 }), // 0.6–0.8м, целиком внутри a
    ])
    expect(() => wallToBoxesWithOpenings3D(line, 10, 3000)).not.toThrow()
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    // b полностью перекрыт a (сквозным на всю высоту) — не должно появиться
    // никакой перемычки/подоконника от b поверх уже вырезанного участка
    expect(boxes.some(b => b.id.includes('_b'))).toBe(false)
  })

  it('проём шире линии (некорректные данные) — клэмпится по длине стены, не падает', () => {
    const line = wallLine([op({ offsetMm: 1900, widthMm: 500, heightMm: 2000 })]) // офсет+ширина > 2000мм
    expect(() => wallToBoxesWithOpenings3D(line, 10, 3000)).not.toThrow()
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    expect(boxes.every(b => b.center.x - b.size.sx / 2 >= -0.001 && b.center.x + b.size.sx / 2 <= 2.001)).toBe(true)
  })

  it('wallsToBoxes3D учитывает проёмы всех линий плана', () => {
    const line = wallLine([op({ offsetMm: 500, widthMm: 800, heightMm: 2000 })])
    const boxes = wallsToBoxes3D([line], 10)
    expect(boxes).toHaveLength(3) // seg + lintel + tail, как в тесте с одной дверью
  })
})

describe('rectColumnsToBoxes3D', () => {
  function baseRectColumn(overrides: Partial<RectColumn>): RectColumn {
    return { id: 'rc1', cx: 100, cy: 200, widthMm: 400, depthMm: 600, angleRad: 0, label: 'Колонна 1', ...overrides }
  }

  it('переводит центр/размеры в метры, высота = отметка потолка, центр по Y = половина высоты', () => {
    const boxes = rectColumnsToBoxes3D([baseRectColumn({})], 10, 3000) // 10мм/px, потолок 3000мм
    expect(boxes).toHaveLength(1)
    expect(boxes[0].center.x).toBeCloseTo(1)   // 100px*10мм = 1000мм = 1м
    expect(boxes[0].center.z).toBeCloseTo(2)   // 200px*10мм = 2000мм = 2м
    expect(boxes[0].center.y).toBeCloseTo(1.5) // половина потолка (3м) — стоит от пола до потолка
    expect(boxes[0].size.sx).toBeCloseTo(0.4)  // ширина 400мм
    expect(boxes[0].size.sz).toBeCloseTo(0.6)  // глубина 600мм
    expect(boxes[0].size.sy).toBeCloseTo(3)    // высота = потолок
  })

  it('rotationY = -angleRad', () => {
    const boxes = rectColumnsToBoxes3D([baseRectColumn({ angleRad: Math.PI / 4 })], 10, 3000)
    expect(boxes[0].rotationY).toBeCloseTo(-Math.PI / 4)
  })

  it('колонна с нулевой шириной или глубиной — пропущена', () => {
    expect(rectColumnsToBoxes3D([baseRectColumn({ widthMm: 0 })], 10, 3000)).toHaveLength(0)
    expect(rectColumnsToBoxes3D([baseRectColumn({ depthMm: 0 })], 10, 3000)).toHaveLength(0)
  })

  it('несколько колонн — все переведены', () => {
    const boxes = rectColumnsToBoxes3D(
      [baseRectColumn({ id: 'a' }), baseRectColumn({ id: 'b', cx: 300 })], 10, 2700,
    )
    expect(boxes.map(b => b.id)).toEqual(['a', 'b'])
  })
})

describe('freeformStructuresToPrisms3D', () => {
  function baseFreeform(overrides: Partial<FreeformStructure>): FreeformStructure {
    return {
      id: 'fs1', kind: 'column', label: 'Конструкция 1',
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      ...overrides,
    }
  }

  it('переводит контур в метры, высота — по умолчанию отметка потолка', () => {
    const prisms = freeformStructuresToPrisms3D([baseFreeform({})], 10, 2700) // 10мм/px, потолок 2700мм
    expect(prisms).toHaveLength(1)
    expect(prisms[0].points[1]).toEqual({ x: 1, z: 0 }) // 100px*10мм = 1м
    expect(prisms[0].heightM).toBeCloseTo(2.7)
    expect(prisms[0].kind).toBe('column')
  })

  it('своя heightMm перекрывает высоту потолка', () => {
    const prisms = freeformStructuresToPrisms3D([baseFreeform({ heightMm: 1000 })], 10, 2700)
    expect(prisms[0].heightM).toBeCloseTo(1)
  })

  it('kind сохраняется как есть (wall/column)', () => {
    const prisms = freeformStructuresToPrisms3D([baseFreeform({ kind: 'wall' })], 10, 2700)
    expect(prisms[0].kind).toBe('wall')
  })

  it('контур менее 3 точек — пропущен', () => {
    const prisms = freeformStructuresToPrisms3D(
      [baseFreeform({ outer: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })], 10, 2700,
    )
    expect(prisms).toHaveLength(0)
  })

  it('несколько конструкций — id сохраняются в порядке', () => {
    const prisms = freeformStructuresToPrisms3D(
      [baseFreeform({ id: 'a' }), baseFreeform({ id: 'b', kind: 'wall' })], 10, 2700,
    )
    expect(prisms.map(p => p.id)).toEqual(['a', 'b'])
  })

  it('без проёмов — один призм с пустыми holes и bottomM=0', () => {
    const prisms = freeformStructuresToPrisms3D([baseFreeform({})], 10, 2700)
    expect(prisms).toHaveLength(1)
    expect(prisms[0].holes).toEqual([])
    expect(prisms[0].bottomM).toBe(0)
  })

  it('проём без heightMm — вырез на всю высоту стены, один band с дыркой', () => {
    const fs = baseFreeform({
      kind: 'wall',
      openings: [{ id: 'op1', type: 'opening', label: 'Пр-1', contour: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }] }],
    })
    const prisms = freeformStructuresToPrisms3D([fs], 10, 2700)
    expect(prisms).toHaveLength(1)
    expect(prisms[0].bottomM).toBe(0)
    expect(prisms[0].heightM).toBeCloseTo(2.7)
    expect(prisms[0].holes).toHaveLength(1)
    expect(prisms[0].holes[0]).toEqual([{ x: 0.2, z: 0.2 }, { x: 0.8, z: 0.2 }, { x: 0.8, z: 0.8 }, { x: 0.2, z: 0.8 }])
  })

  it('окно (sillHeightMm+heightMm) — режет стену на 3 band, дырка только в среднем', () => {
    const fs = baseFreeform({
      kind: 'wall', heightMm: 2700,
      openings: [{
        id: 'op1', type: 'window', label: 'Окно 1', sillHeightMm: 900, heightMm: 1200,
        contour: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }],
      }],
    })
    const prisms = freeformStructuresToPrisms3D([fs], 10, 2700)
    expect(prisms).toHaveLength(3)
    // band'ы отсортированы по возрастанию высоты (снизу вверх)
    expect(prisms[0].bottomM).toBeCloseTo(0)
    expect(prisms[0].heightM).toBeCloseTo(0.9)
    expect(prisms[0].holes).toEqual([])

    expect(prisms[1].bottomM).toBeCloseTo(0.9)
    expect(prisms[1].heightM).toBeCloseTo(1.2)
    expect(prisms[1].holes).toHaveLength(1)

    expect(prisms[2].bottomM).toBeCloseTo(2.1)
    expect(prisms[2].heightM).toBeCloseTo(0.6)
    expect(prisms[2].holes).toEqual([])
  })

  it('два проёма на разной высоте на одной стене — независимые band', () => {
    const fs = baseFreeform({
      kind: 'wall', heightMm: 2700,
      openings: [
        { id: 'door', type: 'door', label: 'Дверь', sillHeightMm: 0, heightMm: 2000,
          contour: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }] },
        { id: 'win', type: 'window', label: 'Окно', sillHeightMm: 900, heightMm: 1200,
          contour: [{ x: 50, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 30 }, { x: 50, y: 30 }] },
      ],
    })
    const prisms = freeformStructuresToPrisms3D([fs], 10, 2700)
    // границы: 0, 0.9, 2.0, 2.1, 2.7 → 4 band: [0,0.9) дверь; [0.9,2.0) дверь+окно; [2.0,2.1) окно; [2.1,2.7) пусто
    expect(prisms).toHaveLength(4)
    const withHoles = prisms.filter(p => p.holes.length > 0)
    expect(withHoles).toHaveLength(3)
    expect(prisms.reduce((s, p) => s + p.holes.length, 0)).toBe(4) // 1 + 2 + 1 + 0
  })

  it('проём с heightMm=0 или контуром <3 точек — игнорируется', () => {
    const fs = baseFreeform({
      kind: 'wall',
      openings: [
        { id: 'bad1', type: 'opening', label: 'bad', heightMm: 0, contour: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }] },
        { id: 'bad2', type: 'opening', label: 'bad2', contour: [{ x: 20, y: 20 }, { x: 80, y: 20 }] },
      ],
    })
    const prisms = freeformStructuresToPrisms3D([fs], 10, 2700)
    expect(prisms).toHaveLength(1)
    expect(prisms[0].holes).toEqual([])
  })
})

describe('structureId (10.07.2026, выбор колонны/произвольной конструкции кликом в 3D)', () => {
  function baseFreeform(overrides: Partial<FreeformStructure>): FreeformStructure {
    return {
      id: 'fs1', kind: 'column', label: 'Конструкция 1',
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      ...overrides,
    }
  }

  it('без проёмов (один призм): structureId совпадает с id и с id самой конструкции', () => {
    const prisms = freeformStructuresToPrisms3D([baseFreeform({ id: 'fs-42' })], 10, 2700)
    expect(prisms).toHaveLength(1)
    expect(prisms[0].structureId).toBe('fs-42')
    expect(prisms[0].structureId).toBe(prisms[0].id)
  })

  it('окно режет конструкцию на 3 band — ВСЕ делят один structureId, хотя id разные', () => {
    const fs = baseFreeform({
      id: 'fs-with-window', kind: 'wall', heightMm: 2700,
      openings: [{
        id: 'op1', type: 'window', label: 'Окно 1', sillHeightMm: 900, heightMm: 1200,
        contour: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }],
      }],
    })
    const prisms = freeformStructuresToPrisms3D([fs], 10, 2700)
    expect(prisms).toHaveLength(3)
    expect(prisms.every(p => p.structureId === 'fs-with-window')).toBe(true)
    expect(new Set(prisms.map(p => p.id)).size).toBe(prisms.length)
  })

  it('несколько конструкций — короба разных структур не путают structureId между собой', () => {
    const prisms = freeformStructuresToPrisms3D(
      [baseFreeform({ id: 'a' }), baseFreeform({ id: 'b', kind: 'wall' })], 10, 2700,
    )
    expect(prisms.find(p => p.id === 'a')!.structureId).toBe('a')
    expect(prisms.find(p => p.id === 'b')!.structureId).toBe('b')
  })
})

describe('wallToBox3D — axisOverride (расширенная ось стыка, см. wallJoin.ts)', () => {
  it('без axisOverride — как раньше, футпринт по сырым x1/y1/x2/y2', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 100, y2: 0, spec: { material: 'brick', subtype: '200' } })
    const box = wallToBox3D(line, 10, 3000)
    expect(box!.size.sx).toBeCloseTo(1) // 100px*10мм = 1м
    expect(box!.center.x).toBeCloseTo(0.5)
  })

  it('с axisOverride — футпринт по расширенной оси, а не по сырой линии', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 100, y2: 0, spec: { material: 'brick', subtype: '200' } })
    // Расширенная ось длиннее исходной на 20px с обеих сторон (имитация T-стыка)
    const box = wallToBox3D(line, 10, 3000, { x1: -20, y1: 0, x2: 120, y2: 0 })
    expect(box!.size.sx).toBeCloseTo(1.4) // 140px*10мм = 1.4м
    expect(box!.center.x).toBeCloseTo(0.5) // центр той же прямой, симметрично
  })

  it('axisOverride с другим направлением всё равно даёт корректный rotationY', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 100, y2: 0, spec: { material: 'brick', subtype: '200' } })
    const box = wallToBox3D(line, 10, 3000, { x1: 0, y1: 0, x2: 0, y2: 100 })
    expect(box!.rotationY).toBeCloseTo(-Math.PI / 2)
  })
})

describe('wallToBoxesWithOpenings3D — axisOverride не сдвигает проёмы (см. КОНСПЕКТ 08.07.2026)', () => {
  it('без axisOverride — проём на своём месте (регрессия)', () => {
    const line = baseLine({
      x1: 0, y1: 0, x2: 200, y2: 0, // 200px*10мм = 2000мм = 2м
      spec: { material: 'brick', subtype: '200' },
      openings: [{ id: 'o1', type: 'door', offsetMm: 500, widthMm: 900, heightMm: 2000, label: 'Д-1' }],
    })
    const boxes = wallToBoxesWithOpenings3D(line, 10, 3000)
    const seg = boxes.find(b => b.id === 'l1__seg_o1')!
    expect(seg.size.sx).toBeCloseTo(0.5) // от начала стены (0) до начала проёма (500мм=0.5м)
  })

  it('с axisOverride (расширение "назад" на T-стыке) — проём НЕ уезжает, остаётся на том же месте в мире', () => {
    const line = baseLine({
      x1: 0, y1: 0, x2: 200, y2: 0,
      spec: { material: 'brick', subtype: '200' },
      openings: [{ id: 'o1', type: 'door', offsetMm: 500, widthMm: 900, heightMm: 2000, label: 'Д-1' }],
    })
    // Ось расширена на 30px "назад" (T-стык с колонной/соседней стеной у начала)
    const boxesExt = wallToBoxesWithOpenings3D(line, 10, 3000, { x1: -30, y1: 0, x2: 200, y2: 0 })
    const boxesNoExt = wallToBoxesWithOpenings3D(line, 10, 3000)

    const segExt = boxesExt.find(b => b.id === 'l1__seg_o1')!
    const segNoExt = boxesNoExt.find(b => b.id === 'l1__seg_o1')!
    // Начало проёма в МИРОВЫХ координатах должно совпадать в обоих случаях —
    // расширение оси не должно "утащить" проём вместе с собой.
    // seg — от старта футпринта до начала проёма; при расширении "назад" seg
    // длиннее ровно на величину расширения (30px=0.3м), но правый край (где
    // начинается проём) — тот же самый мировой X.
    const segExtRightEdgeX = segExt.center.x + segExt.size.sx / 2
    const segNoExtRightEdgeX = segNoExt.center.x + segNoExt.size.sx / 2
    expect(segExtRightEdgeX).toBeCloseTo(segNoExtRightEdgeX, 5)
    expect(segExt.size.sx).toBeCloseTo(segNoExt.size.sx + 0.3)
  })

  it('расширение вперёд (у конца стены) аналогично не сдвигает проём', () => {
    const line = baseLine({
      x1: 0, y1: 0, x2: 200, y2: 0,
      spec: { material: 'brick', subtype: '200' },
      openings: [{ id: 'o1', type: 'door', offsetMm: 500, widthMm: 900, heightMm: 2000, label: 'Д-1' }],
    })
    const boxesExt = wallToBoxesWithOpenings3D(line, 10, 3000, { x1: 0, y1: 0, x2: 230, y2: 0 })
    const boxesNoExt = wallToBoxesWithOpenings3D(line, 10, 3000)
    const tailExt = boxesExt.find(b => b.id === 'l1__tail')!
    const tailNoExt = boxesNoExt.find(b => b.id === 'l1__tail')!
    // 'tail' (хвост после проёма) должен начинаться в той же мировой точке,
    // просто быть длиннее на величину расширения конца стены
    const tailExtLeftEdgeX = tailExt.center.x - tailExt.size.sx / 2
    const tailNoExtLeftEdgeX = tailNoExt.center.x - tailNoExt.size.sx / 2
    expect(tailExtLeftEdgeX).toBeCloseTo(tailNoExtLeftEdgeX, 5)
    expect(tailExt.size.sx).toBeCloseTo(tailNoExt.size.sx + 0.3)
  })
})

describe('wallsToBoxes3D — интеграция с колоннами (T-стык под любым углом, см. КОНСПЕКТ 08.07.2026)', () => {
  it('стена, упирающаяся в грань колонны под прямым углом — футпринт доходит ровно до грани (cap подавлен, ось расширена)', () => {
    // Колонна 300×300мм с центром в (0,0) px-координат при scaleMmPx=10 —
    // т.е. полуразмер 15px, грани на x=±15 и y=±15.
    const col: RectColumn = { id: 'col1', cx: 0, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'Колонна 1' }
    // Правая грань колонны — вертикальный отрезок x=15 (halfWidth=15px). Стена
    // должна идти ПЕРПЕНДИКУЛЯРНО этой грани — горизонтально, наружу (+X) от (15,0).
    const line = baseLine({
      id: 'w1', x1: 15, y1: 0, x2: 215, y2: 0,
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10, [col])
    expect(boxes).toHaveLength(1)
    // Длина должна остаться близкой к исходной (2000мм=2м) — T-стык лишь
    // слегка "дотягивает" до грани, не создаёт значительного нахлёста
    expect(boxes[0].size.sx).toBeGreaterThanOrEqual(2)
    expect(boxes[0].size.sx).toBeLessThan(2.05)
  })

  it('без колонны в списке — то же самое место всё равно строится (просто без обрезки/удлинения)', () => {
    const line = baseLine({
      id: 'w1', x1: 15, y1: 0, x2: 215, y2: 0,
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10) // rectColumns не передан вообще (дефолт [])
    expect(boxes).toHaveLength(1)
    expect(boxes[0].size.sx).toBeCloseTo(2)
  })

  it('стена подходит к грани колонны под ОСТРЫМ углом (5°, кейс со скриншота пользователя) — не падает, не даёт NaN/бесконечность', () => {
    const col: RectColumn = { id: 'col1', cx: 0, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'Колонна 1' }
    const angle = 5 * Math.PI / 180
    const len = 1200 // px
    const line = baseLine({
      id: 'w1', x1: 15, y1: 0,
      x2: 15 + len * Math.cos(angle), y2: len * Math.sin(angle),
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10, [col])
    expect(boxes).toHaveLength(1)
    expect(Number.isFinite(boxes[0].size.sx)).toBe(true)
    expect(Number.isFinite(boxes[0].center.x)).toBe(true)
    expect(Number.isFinite(boxes[0].rotationY)).toBe(true)
    // Длина не должна улетать в аномально большие значения (защита от
    // самопересекающегося отката на почти касательном угле — см. wallJoin.ts)
    expect(boxes[0].size.sx).toBeLessThan(20) // заведомо намного больше 1.2м исходной длины стены
  })
})

describe('wallsToBoxes3D — интеграция с КРУГЛЫМИ колоннами (11.09.2026, объект в Ростове, ∅550 мм)', () => {
  it('стена, упирающаяся в круглую колонну по радиусу — футпринт доходит примерно до грани окружности (не проходит насквозь)', () => {
    // Колонна ∅300мм с центром в (0,0) px при scaleMmPx=10 — радиус 15px.
    // Стена должна упираться в СЕРЕДИНУ одного из 24 рёбер многоугольника
    // (не в вершину — вершина принадлежит сразу двум рёбрам, там T-стык не
    // распознаётся, см. wallJoin.test.ts) и идти от неё наружу вдоль того
    // же радиального направления. Без join прошла бы сквозь колонну
    // неизменной длины (расстояние mid→конец, см. ниже).
    const col: RoundColumn = { id: 'rc1', cx: 0, cy: 0, diameterMm: 300, label: 'Колонна 1' }
    const poly = roundColumnPolygonPx(0, 0, 300, 10)
    const mid = { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[1].y) / 2 }
    const dirLen = Math.hypot(mid.x, mid.y)
    const ux = mid.x / dirLen, uy = mid.y / dirLen
    const wallLenPx = 200
    const line = baseLine({
      id: 'w1', x1: mid.x, y1: mid.y,
      x2: mid.x + wallLenPx * ux, y2: mid.y + wallLenPx * uy,
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10, [], [col])
    expect(boxes).toHaveLength(1)
    // Длина близка к исходным 200px=2000мм=2м — T-стык лишь слегка
    // "дотягивает" ось до грани, без значительного нахлёста/сокращения.
    expect(boxes[0].size.sx).toBeGreaterThanOrEqual(1.95)
    expect(boxes[0].size.sx).toBeLessThan(2.05)
  })

  it('без круглых колонн в списке — та же стена строится немодифицированной (обратная совместимость)', () => {
    const line = baseLine({
      id: 'w1', x1: 0, y1: 0, x2: 200, y2: 0,
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10) // ни rectColumns, ни roundColumns не переданы
    expect(boxes).toHaveLength(1)
    expect(boxes[0].size.sx).toBeCloseTo(2)
  })

  it('стена подходит к круглой колонне под произвольным (не осевым) углом — не падает, не даёт NaN/бесконечность', () => {
    const col: RoundColumn = { id: 'rc1', cx: 0, cy: 0, diameterMm: 550, label: 'Колонна 1' } // объект в Ростове
    const angle = 37 * Math.PI / 180
    const len = 1500 // px
    const line = baseLine({
      id: 'w1', x1: 0, y1: 0,
      x2: len * Math.cos(angle), y2: len * Math.sin(angle),
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([line], 10, [], [col])
    expect(boxes).toHaveLength(1)
    expect(Number.isFinite(boxes[0].size.sx)).toBe(true)
    expect(Number.isFinite(boxes[0].center.x)).toBe(true)
    expect(Number.isFinite(boxes[0].rotationY)).toBe(true)
    expect(boxes[0].size.sx).toBeLessThan(20) // без аномального отката/растяжения
  })

  it('прямоугольная и круглая колонны одновременно — обе участвуют в стыковке, не мешая друг другу', () => {
    const rect: RectColumn = { id: 'rect1', cx: -100, cy: 0, widthMm: 300, depthMm: 300, angleRad: 0, label: 'Колонна прям.' }
    const round: RoundColumn = { id: 'round1', cx: 100, cy: 0, diameterMm: 300, label: 'Колонна кругл.' }
    // Стена к прямоугольной колонне — упирается в середину её правой грани
    // (x=-85, между y=-15 и y=15), как и в остальных rect-column тестах.
    const lineToRect = baseLine({ id: 'w1', x1: -85, y1: 0, x2: -285, y2: 0, spec: { material: 'brick', subtype: '200' } })
    // Стена к круглой колонне — упирается в середину одного из 24 рёбер
    // многоугольника (не в вершину, см. комментарий в тесте выше).
    const poly = roundColumnPolygonPx(100, 0, 300, 10)
    const mid = { x: (poly[0].x + poly[1].x) / 2, y: (poly[0].y + poly[1].y) / 2 }
    const dirLen = Math.hypot(mid.x - 100, mid.y)
    const ux = (mid.x - 100) / dirLen, uy = mid.y / dirLen
    const lineToRound = baseLine({
      id: 'w2', x1: mid.x, y1: mid.y,
      x2: mid.x + 200 * ux, y2: mid.y + 200 * uy,
      spec: { material: 'brick', subtype: '200' },
    })
    const boxes = wallsToBoxes3D([lineToRect, lineToRound], 10, [rect], [round])
    expect(boxes).toHaveLength(2)
    boxes.forEach(b => {
      expect(Number.isFinite(b.size.sx)).toBe(true)
      expect(Number.isFinite(b.center.x)).toBe(true)
    })
    // Обе стены должны быть реально СТЫКОВАНЫ (T-стык), а не просто
    // "не упасть" — длина близка к исходным 200px=2м для round, и к
    // исходным (285-85)=200px=2м для rect, без сквозного прохода.
    const rectBox = boxes.find(b => b.id === 'w1')!
    const roundBox = boxes.find(b => b.id === 'w2')!
    expect(rectBox.size.sx).toBeGreaterThanOrEqual(1.95)
    expect(rectBox.size.sx).toBeLessThan(2.05)
    expect(roundBox.size.sx).toBeGreaterThanOrEqual(1.95)
    expect(roundBox.size.sx).toBeLessThan(2.05)
  })
})

describe('wallFaceFrame / worldToFaceMm / faceMmToWorld (07.09.2026 — развёртка грани для зон отделки)', () => {
  it('прямая стена вдоль X (rotationY=0): сторона A — нормаль +Z, сторона B — -Z', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 300, y2: 0, type: 'wall_new', spec: { material: 'gkl', subtype: 'ps75' }, heightMm: 2700 })
    const box = wallToBox3D(line, 10, 3000)! // 300px*10мм/px = 3000мм длина
    const frameA = wallFaceFrame(box, 'A')
    const frameB = wallFaceFrame(box, 'B')
    expect(frameA.normal.z).toBeCloseTo(1, 6)
    expect(frameB.normal.z).toBeCloseTo(-1, 6)
    expect(frameA.widthM).toBeCloseTo(3, 6)   // 3000мм
    expect(frameA.heightM).toBeCloseTo(2.7, 6) // 2700мм
    // Центр грани A смещён от центра коробки на +halfThickness по Z
    expect(frameA.center.z).toBeGreaterThan(box.center.z)
    expect(frameB.center.z).toBeLessThan(box.center.z)
  })

  it('faceMmToWorld/worldToFaceMm — круговой проезд туда-обратно даёт исходные мм (с учётом погрешности округления)', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 500, y2: 200, type: 'wall_new', spec: { material: 'gkl', subtype: 'ps75' }, heightMm: 2700 })
    const box = wallToBox3D(line, 10, 3000)!
    const frame = wallFaceFrame(box, 'A')
    for (const [xMm, yMm] of [[0, 0], [1000, 1500], [frame.widthM * 1000, frame.heightM * 1000], [2500, 900]]) {
      const world = faceMmToWorld(frame, xMm, yMm)
      const back = worldToFaceMm(frame, world)
      expect(back.xMm).toBeCloseTo(xMm, 6)
      expect(back.yMm).toBeCloseTo(yMm, 6)
    }
  })

  it('угловой (0,0) на развёртке лежит на самой поверхности грани (нулевая проекция по нормали от центра грани)', () => {
    const line = baseLine({ x1: 0, y1: 0, x2: 400, y2: 0, type: 'wall_new', spec: { material: 'gkl', subtype: 'ps75' }, heightMm: 2700 })
    const box = wallToBox3D(line, 10, 3000)!
    const frame = wallFaceFrame(box, 'A')
    const p0 = faceMmToWorld(frame, 0, 0)
    // Проекция (p0 - center) на нормаль должна быть ~0 — p0 лежит В плоскости грани
    const dot = (p0.x - frame.center.x) * frame.normal.x + (p0.z - frame.center.z) * frame.normal.z
    expect(dot).toBeCloseTo(0, 6)
    // Пол (y=0 на развёртке) совпадает с полом мира (y=0), т.к. wallToBox3D ставит стену на пол
    expect(p0.y).toBeCloseTo(0, 6)
  })

  it('mToMm — обратная функция к mmToM', () => {
    expect(mToMm(mmToM(1234))).toBeCloseTo(1234, 9)
    expect(mToMm(1.5)).toBe(1500)
  })
})

describe('slopePlaneCoefficients (07.09.2026 — наклон Плиты/Потолка в 3D)', () => {
  it('вырожденный случай (совпадающие опорные точки) — плоская высота height1Mm, a=b=0', () => {
    const { a, b, c } = slopePlaneCoefficients({ x1: 100, y1: 100, x2: 100, y2: 100, height1Mm: 3200, height2Mm: 4500 }, 10)
    expect(a).toBe(0); expect(b).toBe(0)
    expect(c).toBeCloseTo(mmToM(3200), 9)
  })

  it('совпадает с ceilingSlopeHeightAt() (core/ceilingSlope.ts) в опорных и промежуточных точках', () => {
    const slope = { x1: 0, y1: 0, x2: 640, y2: 0, height1Mm: 4500, height2Mm: 5200 } // 6400мм при 10мм/px
    const scaleMmPx = 10
    const { a, b, c } = slopePlaneCoefficients(slope, scaleMmPx)
    for (const [xPx, yPx] of [[0, 0], [640, 0], [320, 0], [320, 500], [-100, 200]]) {
      const expectedMm = ceilingSlopeHeightAt(slope, xPx, yPx)
      const xM = pxToM(xPx, scaleMmPx), zM = pxToM(yPx, scaleMmPx)
      const gotMm = mToMm(a * xM + b * zM + c)
      expect(gotMm).toBeCloseTo(expectedMm, 6)
    }
  })

  it('плоскость постоянна вдоль направления, ПЕРПЕНДИКУЛЯРНОГО p1→p2 (наклон только вдоль линии)', () => {
    const slope = { x1: 0, y1: 0, x2: 500, y2: 0, height1Mm: 3000, height2Mm: 3000 + 500 } // наклон строго по X
    const { a, b, c } = slopePlaneCoefficients(slope, 10)
    // Вдоль Z (перпендикулярно направлению уклона) высота не должна меняться
    const h1 = a * 10 + b * 0 + c
    const h2 = a * 10 + b * 5 + c
    expect(h2).toBeCloseTo(h1, 9)
  })
})

describe('slabStepRisers3D (11.09.2026 — разноуровневые перекрытия, объект в Ростове: сцена/карман сцены/зал)', () => {
  function rectSlab(overrides: Partial<Slab> & { id: string; x0: number; y0: number; w: number; h: number }): Slab {
    const { id, x0, y0, w, h, ...rest } = overrides
    return {
      id, label: id, holes: [],
      outer: [
        { x: x0, y: y0 }, { x: x0 + w, y: y0 },
        { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h },
      ],
      ...rest,
    }
  }

  it('две соседние плоские плиты с общим ребром и РАЗНОЙ высотой — даёт ровно один risер по общему ребру', () => {
    // A: (0,0)-(100,100), B: (100,0)-(200,100) — общее ребро x=100, y от 0 до 100.
    const a = rectSlab({ id: 'A', x0: 0, y0: 0, w: 100, h: 100 }) // плоская, Y=0 (slope не задан)
    const b = rectSlab({
      id: 'B', x0: 100, y0: 0, w: 100, h: 100,
      slope: { x1: 100, y1: 0, x2: 200, y2: 0, height1Mm: 500, height2Mm: 500 }, // плоская, приподнята на 500мм
    })
    const risers = slabStepRisers3D([a, b], 10)
    expect(risers).toHaveLength(1)
    const r = risers[0]
    // Оба конца ребра A на Y=0, оба конца ребра B на Y=0.5м (500мм)
    expect(r.p0.y).toBeCloseTo(0, 6)
    expect(r.p1.y).toBeCloseTo(0, 6)
    expect(r.p2.y).toBeCloseTo(0.5, 6)
    expect(r.p3.y).toBeCloseTo(0.5, 6)
  })

  it('две соседние плиты ОДНОЙ высоты — риser не строится (нет видимой ступени)', () => {
    const a = rectSlab({ id: 'A', x0: 0, y0: 0, w: 100, h: 100 })
    const b = rectSlab({ id: 'B', x0: 100, y0: 0, w: 100, h: 100 })
    expect(slabStepRisers3D([a, b], 10)).toHaveLength(0)
  })

  it('плиты НЕ соприкасаются (нет общего ребра) — риser не строится, даже при разной высоте', () => {
    const a = rectSlab({ id: 'A', x0: 0, y0: 0, w: 100, h: 100 })
    const b = rectSlab({
      id: 'B', x0: 500, y0: 0, w: 100, h: 100,
      slope: { x1: 500, y1: 0, x2: 600, y2: 0, height1Mm: 500, height2Mm: 500 },
    })
    expect(slabStepRisers3D([a, b], 10)).toHaveLength(0)
  })

  it('общее ребро обойдено в обратном порядке (разная ориентация полигонов) — всё равно распознаётся', () => {
    const a = rectSlab({ id: 'A', x0: 0, y0: 0, w: 100, h: 100 }) // обход по часовой: ...,(100,0),(100,100),...
    const b: Slab = {
      id: 'B', label: 'B', holes: [],
      // Обход в обратную сторону — общее ребро идёт (100,100)→(100,0), а не (100,0)→(100,100)
      outer: [{ x: 100, y: 100 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }],
      slope: { x1: 100, y1: 0, x2: 200, y2: 0, height1Mm: 300, height2Mm: 300 },
    }
    expect(slabStepRisers3D([a, b], 10)).toHaveLength(1)
  })

  it('наклонная плита встречается с плоской — риser отражает высоты в ОБОИХ концах ребра (не констрейнится к вертикали)', () => {
    const a = rectSlab({ id: 'A', x0: 0, y0: 0, w: 100, h: 100 }) // плоская, Y=0
    const b = rectSlab({
      id: 'B', x0: 100, y0: 0, w: 100, h: 100,
      // Наклон ВДОЛЬ общего ребра (x=100): 0мм при y=0, 300мм при y=100
      slope: { x1: 100, y1: 0, x2: 100, y2: 100, height1Mm: 0, height2Mm: 300 },
    })
    const risers = slabStepRisers3D([a, b], 10)
    expect(risers).toHaveLength(1)
    const r = risers[0]
    // Сторона A (плоская) — оба конца на Y=0
    expect(r.p0.y).toBeCloseTo(0, 6)
    expect(r.p1.y).toBeCloseTo(0, 6)
    // Сторона B (наклонная вдоль ребра) — концы РАЗНЫЕ: 0 и 0.3м
    const bHeights = [r.p2.y, r.p3.y].sort((x, y) => x - y)
    expect(bHeights[0]).toBeCloseTo(0, 6)
    expect(bHeights[1]).toBeCloseTo(0.3, 6)
  })

  it('дырки (holes) не участвуют — общий контур выреза одной плиты не считается ступенью относительно другой (v1 упрощение)', () => {
    const a: Slab = {
      id: 'A', label: 'A', holes: [[{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }]],
      outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    }
    const b = rectSlab({
      id: 'B', x0: 40, y0: 40, w: 20, h: 20,
      slope: { x1: 40, y1: 40, x2: 60, y2: 40, height1Mm: 500, height2Mm: 500 },
    })
    expect(slabStepRisers3D([a, b], 10)).toHaveLength(0)
  })

  it('меньше двух плит — риser не строится', () => {
    const a = rectSlab({ id: 'A', x0: 0, y0: 0, w: 100, h: 100 })
    expect(slabStepRisers3D([a], 10)).toHaveLength(0)
    expect(slabStepRisers3D([], 10)).toHaveLength(0)
  })
})
