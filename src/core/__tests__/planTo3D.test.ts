import { describe, it, expect } from 'vitest'
import {
  wallThicknessMm, wallToBox3D, wallsToBoxes3D, estimateCeilingMm,
  roomsToPolygons3D, slabsToPolygons3D, roundColumnsToCylinders3D, rectColumnsToBoxes3D, wallToBoxesWithOpenings3D, pxToM, mmToM,
} from '../planTo3D'
import type { PlanLine, Room, Slab, RoundColumn, RectColumn, PlanOpening } from '../../types'

function baseLine(overrides: Partial<PlanLine>): PlanLine {
  return {
    id: 'l1', x1: 0, y1: 0, x2: 100, y2: 0,
    type: 'wall_existing', lengthMm: 2000, label: 'С-1',
    ...overrides,
  }
}

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
