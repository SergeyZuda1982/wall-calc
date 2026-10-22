/**
 * contourSegments.ts — рисование контура ОТДЕЛЬНЫМИ ЛИНИЯМИ в любом порядке
 * (вкладка «Контур потолка»). Пользователь проводит линии по одной, как на плане;
 * когда концы линий сходятся в замкнутую фигуру, из них собирается контур
 * (ContourVertex[] из calcContourLayout.ts) и дальше всё работает как раньше.
 *
 * Правила рисования (как в «Линии» в САПР):
 *  — клик без начала: ставит начальную точку (pending, auto = false);
 *  — клик при начале: проводит линию от начала до точки; конец становится новым
 *    началом (цепочка, auto = true), чтобы длинный контур рисовался в одно движение;
 *  — клик в самом начале (или Esc, или кнопка) — «поднять перо»: цепочка закончена,
 *    следующую линию можно начать где угодно;
 *  — правая кнопка: убирает последнюю точку (см. undoLast).
 *
 * Система координат — как в calcContourLayout.ts (мм, Y вверх). Стрела линии
 * (sag) относится к направлению от a к b: > 0 — выгиб влево.
 */

import type { ContourVertex, Pt } from './calcContourLayout'

export interface Seg { a: Pt; b: Pt; sag?: number }
export interface Pending { p: Pt; auto: boolean }
export interface DraftState { segments: Seg[]; pending: Pending | null }

export const EMPTY_DRAFT: DraftState = { segments: [], pending: null }

const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y)
const MIN_LEN = 1

/** Совпадение концов с допуском (мм). */
export const JOIN_TOL = 1

export function addSegment(d: DraftState, a: Pt, b: Pt): DraftState {
  if (dist(a, b) < MIN_LEN) return d
  const dup = d.segments.some(s =>
    (dist(s.a, a) < JOIN_TOL && dist(s.b, b) < JOIN_TOL) || (dist(s.a, b) < JOIN_TOL && dist(s.b, a) < JOIN_TOL))
  if (dup) return { ...d, pending: { p: { ...b }, auto: true } }
  return { segments: [...d.segments, { a: { ...a }, b: { ...b } }], pending: { p: { ...b }, auto: true } }
}

/** Клик в режиме рисования (точка уже привязана к сетке/концам). */
export function drawClick(d: DraftState, p: Pt): DraftState {
  if (!d.pending) return { ...d, pending: { p: { ...p }, auto: false } }
  if (dist(d.pending.p, p) < JOIN_TOL) return { ...d, pending: null }
  return addSegment(d, d.pending.p, p)
}

/** Закончить цепочку: следующая линия начнётся с новой точки. */
export function endChain(d: DraftState): DraftState {
  return d.pending ? { ...d, pending: null } : d
}

/**
 * Правая кнопка: убрать последнюю точку.
 *  — стоит одинокое начало (не продолжение линии) — убираем его;
 *  — стоит начало-продолжение — убираем последнюю линию, начало откатывается к её началу;
 *  — начала нет — убираем последнюю линию.
 */
export function undoLast(d: DraftState): DraftState {
  if (d.pending && !d.pending.auto) return { ...d, pending: null }
  if (d.segments.length === 0) return { segments: [], pending: null }
  const last = d.segments[d.segments.length - 1]
  const rest = d.segments.slice(0, -1)
  if (d.pending) {
    const prev = rest[rest.length - 1]
    const chained = !!prev && dist(prev.b, last.a) < JOIN_TOL
    return { segments: rest, pending: { p: { ...last.a }, auto: chained } }
  }
  return { segments: rest, pending: null }
}

/** Концы линий, к которым не подходит вторая линия (контур в этих местах разомкнут). */
export function openEnds(segs: Seg[]): Pt[] {
  const nodes = clusterNodes(segs)
  return nodes.filter(n => n.degree === 1).map(n => n.p)
}

interface Node { p: Pt; degree: number; segs: Array<{ seg: number; end: 'a' | 'b' }> }

function clusterNodes(segs: Seg[]): Node[] {
  const nodes: Node[] = []
  const put = (p: Pt, seg: number, end: 'a' | 'b') => {
    let n = nodes.find(x => dist(x.p, p) < JOIN_TOL)
    if (!n) { n = { p, degree: 0, segs: [] }; nodes.push(n) }
    n.degree++
    n.segs.push({ seg, end })
  }
  segs.forEach((s, i) => { put(s.a, i, 'a'); put(s.b, i, 'b') })
  return nodes
}

export interface DraftStatus {
  /** Собранный замкнутый контур или null. */
  loop: ContourVertex[] | null
  openEnds: number
  /** Что мешает собрать контур (для подсказки). */
  problem: string | null
}

/** Собирает замкнутый контур из линий, если они образуют ровно один цикл (в любом порядке и направлении). */
export function assembleLoop(segs: Seg[]): ContourVertex[] | null {
  return draftStatus(segs).loop
}

export function draftStatus(segs: Seg[]): DraftStatus {
  if (segs.length === 0) return { loop: null, openEnds: 0, problem: null }
  const nodes = clusterNodes(segs)
  const ends = nodes.filter(n => n.degree === 1).length
  if (nodes.some(n => n.degree > 2)) return { loop: null, openEnds: ends, problem: 'В одной точке сходятся больше двух линий' }
  if (ends > 0) return { loop: null, openEnds: ends, problem: null }
  if (segs.length < 3) return { loop: null, openEnds: 0, problem: null }

  // обход цикла
  const used = new Array(segs.length).fill(false)
  const out: ContourVertex[] = []
  let cur = { seg: 0, from: 'a' as 'a' | 'b' }
  for (let k = 0; k < segs.length; k++) {
    const s = segs[cur.seg]
    used[cur.seg] = true
    const forward = cur.from === 'a'
    const start = forward ? s.a : s.b
    const end = forward ? s.b : s.a
    const sag = (s.sag ?? 0) * (forward ? 1 : -1)
    out.push(sag ? { x: start.x, y: start.y, sag } : { x: start.x, y: start.y })
    // следующая линия — другая в узле конца
    const node = nodes.find(n => dist(n.p, end) < JOIN_TOL)!
    const nxt = node.segs.find(x => x.seg !== cur.seg)
    if (!nxt) return { loop: null, openEnds: 0, problem: 'Линии не образуют замкнутый контур' }
    cur = { seg: nxt.seg, from: nxt.end }
    if (k < segs.length - 1 && used[cur.seg]) return { loop: null, openEnds: 0, problem: 'Линии образуют несколько отдельных фигур' }
  }
  if (used.some(u => !u)) return { loop: null, openEnds: 0, problem: 'Линии образуют несколько отдельных фигур' }
  return { loop: out, openEnds: 0, problem: null }
}

/** Незамкнутая цепочка вершин старой версии → набор линий (миграция сохранённого состояния). */
export function chainToDraft(vs: Array<{ x: number; y: number }>): DraftState {
  const segments: Seg[] = []
  for (let i = 0; i + 1 < vs.length; i++) {
    if (dist(vs[i], vs[i + 1]) >= MIN_LEN) segments.push({ a: { x: vs[i].x, y: vs[i].y }, b: { x: vs[i + 1].x, y: vs[i + 1].y } })
  }
  const last = vs[vs.length - 1]
  return { segments, pending: last ? { p: { x: last.x, y: last.y }, auto: vs.length >= 2 } : null }
}
