import { describe, it, expect } from 'vitest'
import {
  EMPTY_DRAFT, addSegment, drawClick, endChain, undoLast, openEnds, draftStatus, assembleLoop, chainToDraft,
  type DraftState, type Seg,
} from '../contourSegments'
import { contourAreaMm2, validateContour } from '../calcContourLayout'

const P = (x: number, y: number) => ({ x, y })
const click = (d: DraftState, ...pts: Array<[number, number]>) => pts.reduce((s, [x, y]) => drawClick(s, P(x, y)), d)

describe('правила клика', () => {
  it('первый клик ставит начало, второй проводит линию и продолжает цепочку', () => {
    let d = click(EMPTY_DRAFT, [0, 0])
    expect(d.pending).toEqual({ p: P(0, 0), auto: false })
    d = click(d, [1000, 0])
    expect(d.segments).toHaveLength(1)
    expect(d.pending).toEqual({ p: P(1000, 0), auto: true })
  })
  it('клик в начало поднимает «перо»: следующая линия начинается где угодно', () => {
    let d = click(EMPTY_DRAFT, [0, 0], [1000, 0], [1000, 0])
    expect(d.pending).toBeNull()
    expect(d.segments).toHaveLength(1)
    d = click(d, [5000, 5000], [6000, 5000])        // отдельная линия, не от конца первой
    expect(d.segments).toHaveLength(2)
    expect(d.segments[1].a).toEqual(P(5000, 5000))
  })
  it('endChain', () => {
    expect(endChain(click(EMPTY_DRAFT, [0, 0], [10, 0])).pending).toBeNull()
  })
  it('нулевая линия и дубликат игнорируются', () => {
    const d = addSegment(EMPTY_DRAFT, P(0, 0), P(0.2, 0))
    expect(d.segments).toHaveLength(0)
    const d2 = addSegment(addSegment(EMPTY_DRAFT, P(0, 0), P(100, 0)), P(100, 0), P(0, 0))
    expect(d2.segments).toHaveLength(1)
  })
})

describe('правая кнопка — убрать последнюю точку', () => {
  it('одинокое начало: пропадает', () => {
    expect(undoLast(click(EMPTY_DRAFT, [0, 0]))).toEqual(EMPTY_DRAFT)
  })
  it('цепочка из трёх точек откатывается по одной', () => {
    let d = click(EMPTY_DRAFT, [0, 0], [100, 0], [100, 100])   // 2 линии, начало у (100,100)
    d = undoLast(d)
    expect(d.segments).toHaveLength(1)
    expect(d.pending).toEqual({ p: P(100, 0), auto: true })
    d = undoLast(d)
    expect(d.segments).toHaveLength(0)
    expect(d.pending).toEqual({ p: P(0, 0), auto: false })
    d = undoLast(d)
    expect(d).toEqual(EMPTY_DRAFT)
  })
  it('после «поднять перо» убирает последнюю линию целиком', () => {
    const d = undoLast(click(EMPTY_DRAFT, [0, 0], [100, 0], [100, 0]))
    expect(d.segments).toHaveLength(0)
    expect(d.pending).toBeNull()
  })
  it('на пустом ничего не ломается', () => {
    expect(undoLast(EMPTY_DRAFT)).toEqual(EMPTY_DRAFT)
  })
})

describe('сборка контура из отдельных линий', () => {
  const seg = (a: [number, number], b: [number, number], sag?: number): Seg => ({ a: P(...a), b: P(...b), ...(sag ? { sag } : {}) })
  const rectSegs = [seg([0, 0], [4000, 0]), seg([4000, 0], [4000, 3000]), seg([4000, 3000], [0, 3000]), seg([0, 3000], [0, 0])]

  it('цепочка по порядку', () => {
    const loop = assembleLoop(rectSegs)!
    expect(loop).toHaveLength(4)
    expect(contourAreaMm2(loop) / 1e6).toBeCloseTo(12, 6)
  })
  it('линии в любом порядке и с любым направлением (как в вашем эскизе: низ, правая, левая, верх)', () => {
    const shuffled = [rectSegs[0], seg([4000, 3000], [4000, 0]), seg([0, 0], [0, 3000]), rectSegs[2]]
    const loop = assembleLoop(shuffled)!
    expect(loop).toHaveLength(4)
    expect(contourAreaMm2(loop) / 1e6).toBeCloseTo(12, 6)
    expect(validateContour(loop)).toBeNull()
  })
  it('разомкнутые концы считаются', () => {
    const open = rectSegs.slice(0, 3)
    expect(assembleLoop(open)).toBeNull()
    expect(openEnds(open)).toHaveLength(2)
    expect(draftStatus(open).openEnds).toBe(2)
  })
  it('замыкание срабатывает именно последней линией', () => {
    let d = EMPTY_DRAFT
    d = addSegment(d, P(0, 0), P(4000, 0)); d = endChain(d)
    d = addSegment(d, P(4000, 3000), P(0, 3000)); d = endChain(d)
    expect(assembleLoop(d.segments)).toBeNull()
    d = addSegment(d, P(4000, 0), P(4000, 3000)); d = endChain(d)
    expect(assembleLoop(d.segments)).toBeNull()
    d = addSegment(d, P(0, 3000), P(0, 0))
    expect(assembleLoop(d.segments)).not.toBeNull()
  })
  it('дуга, заданная в обратном направлении, даёт ту же площадь', () => {
    // нижняя сторона — дуга вверх (внутрь) 600 мм: от (0,0) к (4000,0) sag > 0 = влево = вверх
    const fwd = [seg([0, 0], [4000, 0], 600), rectSegs[1], rectSegs[2], rectSegs[3]]
    // та же дуга, но линия проведена справа налево: влево от направления (4000,0)→(0,0) — вниз, значит sag < 0
    const rev = [seg([4000, 0], [0, 0], -600), rectSegs[1], rectSegs[2], rectSegs[3]]
    const a = contourAreaMm2(assembleLoop(fwd)!)
    const b = contourAreaMm2(assembleLoop(rev)!)
    expect(b).toBeCloseTo(a, 3)
    expect(a).toBeLessThan(12e6)
  })
  it('три линии в одной точке — понятная причина', () => {
    const st = draftStatus([...rectSegs, seg([0, 0], [-1000, -1000])])
    expect(st.loop).toBeNull()
    expect(st.problem).toMatch(/больше двух/)
  })
  it('две отдельные фигуры не склеиваются', () => {
    const far = rectSegs.map(s => seg([s.a.x + 10000, s.a.y], [s.b.x + 10000, s.b.y]))
    const st = draftStatus([...rectSegs, ...far])
    expect(st.loop).toBeNull()
    expect(st.problem).toMatch(/нескольк/)
  })
  it('допуск 1 мм: конец, не дотянутый на полмиллиметра, всё равно соединяется', () => {
    const near = [rectSegs[0], seg([4000.4, 0], [4000, 3000]), rectSegs[2], rectSegs[3]]
    expect(assembleLoop(near)).not.toBeNull()
  })
  it('пустой набор и две линии', () => {
    expect(draftStatus([]).loop).toBeNull()
    expect(assembleLoop(rectSegs.slice(0, 2))).toBeNull()
  })
})

describe('миграция старой незамкнутой цепочки', () => {
  it('цепочка вершин → линии, начало у последней вершины', () => {
    const d = chainToDraft([P(0, 0), P(100, 0), P(100, 100)])
    expect(d.segments).toHaveLength(2)
    expect(d.pending).toEqual({ p: P(100, 100), auto: true })
  })
  it('одна вершина → только начало', () => {
    expect(chainToDraft([P(5, 5)])).toEqual({ segments: [], pending: { p: P(5, 5), auto: false } })
  })
})
