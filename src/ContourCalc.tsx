/**
 * ContourCalc.tsx — вкладка «Контур потолка» (15.10.2026).
 *
 * Потолок произвольной формы (дуги, косые стороны, уступы) рисуется мышью/пальцем
 * по сетке с привязкой. Экран считает точную площадь и периметр, раскладывает листы
 * ГКЛ от выбранной опорной стороны (как «Разметка дуги», но по всему контуру) и для
 * каждого листа выдаёт точки реза на кромках и ординаты по дугам.
 *
 * Расчёт — core/calcContourLayout.ts, правка контура — core/contourEdit.ts,
 * холст — components/ContourCanvas.tsx. Контур и настройки сохраняются в localStorage
 * (при смене вкладки не теряются). К плану и калькулятору потолков не привязан.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import ContourCanvas, { type ContourTool, type Selection } from './components/ContourCanvas'
import CalcFileButtons from './components/CalcFileButtons'
import { NumField, Toggle } from './components/calcFields'
import { C, btn, card } from './components/calcTheme'
import {
  calcContourLayout, contourAreaMm2, contourEdges, contourPerimeterMm, defaultRefEdge, edgeArc, validateContour,
  type ContourOrientation, type ContourSheet, type ContourVertex,
} from './core/calcContourLayout'
import { labelIndices, ordinateOffsets, type OffsetFrom } from './core/calcArcLayout'
import { contourToCeilingSeed } from './core/contourToCeilingSeed'
import {
  EMPTY_DRAFT, addSegment, chainToDraft, draftStatus, drawClick, endChain, undoLast, type DraftState,
} from './core/contourSegments'
import { useCeilingSeedStore } from './store/useCeilingSeedStore'
import {
  flipEdgeBulge, isBulgeInward, moveVertex, removeVertex, sagittaFromChordRadius, setEdgeBulge, setEdgeChord,
  sketchExample, splitEdge,
} from './core/contourEdit'

const STORAGE_KEY = 'wallcalc.contour.v1'
const ARC_COLORS = ['#1d4ed8', '#dc2626', '#059669', '#d97706']
const GRIDS: Array<[number, string]> = [[0, 'без'], [10, '10'], [50, '50'], [100, '100'], [250, '250'], [500, '500'], [1000, '1000']]

interface Settings {
  sheetW: number; sheetL: number; orientation: ContourOrientation
  shiftU: number; shiftV: number; stagger: number; step: number; labelStep: number
  grid: number; ortho: boolean
}
const DEFAULT_SETTINGS: Settings = {
  sheetW: 1200, sheetL: 2500, orientation: 'across', shiftU: 0, shiftV: 0, stagger: 0, step: 50, labelStep: 250, grid: 100, ortho: true,
}

interface Saved { vertices: ContourVertex[]; closed: boolean; refEdge: number | null; settings: Settings; draft: DraftState }

/** Приводит произвольные данные (localStorage / файл) к безопасному состоянию вкладки. */
// eslint-disable-next-line react-refresh/only-export-components
export function parseSaved(d: any): Saved {
  const empty: Saved = { vertices: [], closed: false, refEdge: null, settings: DEFAULT_SETTINGS, draft: EMPTY_DRAFT }
  try {
    const vertices: ContourVertex[] = Array.isArray(d.vertices)
      ? d.vertices.filter((v: ContourVertex) => Number.isFinite(v?.x) && Number.isFinite(v?.y)).map((v: ContourVertex) => ({ x: v.x, y: v.y, ...(v.sag ? { sag: v.sag } : {}) }))
      : []
    const isPt = (p: unknown): p is { x: number; y: number } => !!p && Number.isFinite((p as { x: number }).x) && Number.isFinite((p as { y: number }).y)
    const closed = !!d.closed && vertices.length >= 3
    let draft: DraftState = EMPTY_DRAFT
    if (!closed) {
      if (d.draft && Array.isArray(d.draft.segments)) {
        draft = {
          segments: d.draft.segments.filter((sg: { a: unknown; b: unknown }) => isPt(sg?.a) && isPt(sg?.b)),
          pending: isPt(d.draft.pending?.p) ? { p: d.draft.pending.p, auto: !!d.draft.pending.auto } : null,
        }
      } else if (vertices.length > 0) {
        draft = chainToDraft(vertices)   // сохранено старой версией: незамкнутая цепочка вершин
      }
    }
    return {
      vertices: closed ? vertices : [], closed,
      refEdge: Number.isInteger(d.refEdge) ? d.refEdge : null,
      settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
      draft,
    }
  } catch { return empty }
}

function loadSaved(): Saved {
  try {
    if (typeof window === 'undefined') return parseSaved({})
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? parseSaved(JSON.parse(raw)) : parseSaved({})
  } catch { return parseSaved({}) }
}

function useIsNarrow(px = 960) {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.innerWidth < px)
  useEffect(() => {
    const f = () => setV(window.innerWidth < px)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [px])
  return v
}

const fmt = (x: number, d = 2) => x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })

// ─── Чертёж листа ───────────────────────────────────────────────────────────

function SheetDrawing({ sheet, labelStep }: { sheet: ContourSheet; labelStep: number }) {
  const { w, h } = sheet
  const fs = Math.max(w, h) / 55
  const pad = fs * 3
  const y = (v: number) => h - v
  const lines: React.ReactNode[] = []
  for (let u = 0; u <= w + 1e-6; u += 50) {
    const major = u % 250 === 0
    lines.push(<line key={'u' + u} x1={u} y1={0} x2={u} y2={h} stroke={major ? '#9ca3af' : '#e5e7eb'} strokeWidth={major ? fs / 18 : fs / 40} />)
  }
  for (let v = 0; v <= h + 1e-6; v += 50) {
    const major = v % 250 === 0
    lines.push(<line key={'v' + v} x1={0} y1={y(v)} x2={w} y2={y(v)} stroke={major ? '#9ca3af' : '#e5e7eb'} strokeWidth={major ? fs / 18 : fs / 40} />)
  }
  const piece = sheet.status === 'full' ? [{ u: 0, v: 0 }, { u: w, v: 0 }, { u: w, v: h }, { u: 0, v: h }] : sheet.outline
  const halo: React.CSSProperties = { paintOrder: 'stroke', stroke: '#fff', strokeWidth: fs / 4, strokeLinejoin: 'round' }
  return (
    <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} style={{ width: '100%', maxHeight: 720, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8 }}>
      <polygon points={piece.map(p => `${p.u},${y(p.v)}`).join(' ')} fill="rgba(96,165,250,0.18)" />
      {lines}
      <rect x={0} y={0} width={w} height={h} fill="none" stroke="#111827" strokeWidth={fs / 12} />
      <polygon points={piece.map(p => `${p.u},${y(p.v)}`).join(' ')} fill="none" stroke="#374151" strokeWidth={fs / 9} strokeLinejoin="round" />
      {sheet.arcs.map((arc, k) => {
        const col = ARC_COLORS[k % ARC_COLORS.length]
        const labeled = labelIndices(arc.rows.map(r => r.pos), labelStep)
        return (
          <g key={arc.edge}>
            <polyline points={arc.path.map(p => `${p.u},${y(p.v)}`).join(' ')} fill="none" stroke={col} strokeWidth={fs / 8} />
            {arc.rows.map((r, i) => r.vals.map((val, j) => {
              const u = arc.axis === 'u' ? r.pos : val
              const v = arc.axis === 'u' ? val : r.pos
              return (
                <g key={`${i}-${j}`}>
                  <circle cx={u} cy={y(v)} r={fs / 6} fill={col} />
                  {labeled.has(i) && (
                    <text x={u} y={y(v) + (arc.axis === 'u' ? (k % 2 === 0 ? fs * 1.4 : -fs * 0.6) : -fs * 0.5)} dx={arc.axis === 'v' ? fs * 0.6 : 0}
                      fontSize={fs} textAnchor={arc.axis === 'u' ? 'middle' : 'start'} fill={col} fontWeight={600} style={halo}>{val}</text>
                  )}
                </g>
              )
            }))}
          </g>
        )
      })}
      {sheet.corners.map((c, i) => (
        <g key={i}>
          <circle cx={c.u} cy={y(c.v)} r={fs / 4.5} fill="#111827" />
          <text x={c.u + (c.u > w / 2 ? -fs * 0.7 : fs * 0.7)} y={y(c.v) + (c.v > h / 2 ? fs * 1.3 : -fs * 0.6)} fontSize={fs} fontWeight={700}
            textAnchor={c.u > w / 2 ? 'end' : 'start'} fill="#111827" style={halo}>{i + 1}</text>
        </g>
      ))}
      <text x={w / 2} y={h + pad * 0.75} fontSize={fs} textAnchor="middle" fill={C.muted}>
        низ листа — со стороны опоры · клетка 50 мм (жирная — 250) · {w}×{h} мм
      </text>
    </svg>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', fontSize: 12, borderBottom: `1px solid ${C.border}` }
const td: React.CSSProperties = { padding: '4px 10px', borderBottom: '1px solid #f0f1f3' }

function copyText(text: string, done: () => void) {
  navigator.clipboard?.writeText(text).then(done).catch(() => { /* буфер недоступен */ })
}

function SheetTables({ sheet, labelStep, sideName }: { sheet: ContourSheet; labelStep: number; sideName: (e: number) => string }) {
  const [copied, setCopied] = useState('')
  const [offFrom, setOffFrom] = useState<OffsetFrom>('top')
  const flash = (k: string) => { setCopied(k); setTimeout(() => setCopied(''), 1500) }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
      {sheet.status === 'full' && <div style={{ fontSize: 13, color: C.muted }}>Лист целиком внутри контура — резать не надо.</div>}
      {sheet.corners.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <b style={{ fontSize: 13 }}>Точки реза на листе, мм</b>
            <button style={btn} onClick={() => copyText(
              ['№\tот левой\tот нижней\tдалее', ...sheet.corners.map((c, i) => `${i + 1}\t${c.u}\t${c.v}\t${c.toNext < 0 ? 'кромка листа' : sideName(c.toNext)}`)].join('\n'),
              () => flash('c'))}>{copied === 'c' ? '✓ Скопировано' : 'Копировать'}</button>
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'auto', maxHeight: 280 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#f9fafb' }}><th style={th}>№</th><th style={th}>От левой кромки</th><th style={th}>От нижней кромки</th><th style={th}>Дальше по линии</th></tr></thead>
              <tbody>
                {sheet.corners.map((c, i) => (
                  <tr key={i}>
                    <td style={td}>{i + 1}</td><td style={td}>{c.u}</td><td style={td}>{c.v}</td>
                    <td style={{ ...td, color: C.muted }}>{c.toNext < 0 ? 'по кромке листа' : sideName(c.toNext)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {sheet.arcs.length > 0 && (
        <div style={{ width: 240 }}>
          <Toggle value={offFrom} onChange={setOffFrom} options={[['top', 'От дальней линии'], ['bottom', 'От ближней']]} />
        </div>
      )}
      {sheet.arcs.map((arc, k) => {
        const labeled = labelIndices(arc.rows.map(r => r.pos), labelStep)
        const col = ARC_COLORS[k % ARC_COLORS.length]
        const posHead = arc.axis === 'u' ? 'От левой кромки' : 'От нижней кромки'
        const valHead = arc.axis === 'u' ? 'до реза от нижней кромки' : 'до реза от левой кромки'
        // «дальняя» линия — с наибольшей отметкой (выше на листе при axis 'u', правее при 'v')
        const offs = ordinateOffsets(arc.rows.map(r => (r.vals.length ? r.vals[0] : null)), offFrom)
        const offHead = offFrom === 'top' ? '↓ от дальней линии' : '↑ от ближней линии'
        return (
          <div key={arc.edge}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <b style={{ fontSize: 13, color: col }}>Ординаты: {sideName(arc.edge)}, мм</b>
              <button style={btn} onClick={() => copyText(
                [`${posHead}\t${valHead}\t${offHead}`, ...arc.rows.map((r, i) => `${r.pos}\t${r.vals.join(' / ')}\t${offs.offsets[i] ?? ''}`)].join('\n'),
                () => flash('a' + arc.edge))}>{copied === 'a' + arc.edge ? '✓ Скопировано' : 'Копировать'}</button>
            </div>
            {offs.top !== null && (
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 6, lineHeight: 1.5 }}>
                Дальняя линия {offs.top}, ближняя {offs.bottom}, между ними {offs.span} мм. Проведите их поперёк листа и мерьте внутри столбец «{offHead}».
              </div>
            )}
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'auto', maxHeight: 340 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                  <th style={th}>{posHead}</th>
                  <th style={{ ...th, color: col }}>{valHead}</th>
                  <th style={{ ...th, color: col, fontStyle: 'italic' }}>{offHead}</th>
                </tr></thead>
                <tbody>
                  {arc.rows.map((r, i) => {
                    const major = labeled.has(i)
                    return (
                      <tr key={i} style={{ background: major ? '#f3f4f6' : '#fff', fontWeight: major ? 600 : 400 }}>
                        <td style={td}>{r.pos}</td>
                        <td style={{ ...td, color: col }}>{r.vals.join(' / ')}</td>
                        <td style={{ ...td, color: col, fontStyle: 'italic' }}>{offs.offsets[i] ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Экран ──────────────────────────────────────────────────────────────────

export default function ContourCalc() {
  const [init] = useState(loadSaved)
  const narrow = useIsNarrow()
  const [vertices, setVertices] = useState<ContourVertex[]>(init.vertices)
  const [closed, setClosed] = useState(init.closed)
  const [draft, setDraft] = useState<DraftState>(init.draft)
  const [lenIn, setLenIn] = useState(0)
  const [angIn, setAngIn] = useState(0)
  const [startX, setStartX] = useState(0)
  const [startY, setStartY] = useState(0)
  const [refEdgeState, setRefEdgeState] = useState<number | null>(init.refEdge)
  const [settings, setSettings] = useState<Settings>(init.settings)
  const [tool, setTool] = useState<ContourTool>(init.closed ? 'edit' : 'draw')
  const [selection, setSelection] = useState<Selection>(null)
  const [selectedSheet, setSelectedSheet] = useState<number | null>(null)
  const [fitSignal, setFitSignal] = useState(0)
  const [history, setHistory] = useState<Array<{ vertices: ContourVertex[]; closed: boolean; draft: DraftState }>>([])
  const [arcInput, setArcInput] = useState<'sagitta' | 'radius'>('sagitta')
  const lastEdit = useRef('')
  const setS = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }))

  const n = vertices.length
  const snapshot = () => setHistory(h => [...h.slice(-59), { vertices, closed, draft }])
  const commit = (nv: ContourVertex[], nClosed = closed) => {
    snapshot(); lastEdit.current = ''
    setVertices(nv); setClosed(nClosed)
  }
  /** Правка числового поля: одна запись в истории на серию нажатий. */
  const commitField = (key: string, nv: ContourVertex[]) => {
    if (lastEdit.current !== key) { snapshot(); lastEdit.current = key }
    setVertices(nv)
  }
  const undo = () => {
    setHistory(h => {
      if (!h.length) return h
      const last = h[h.length - 1]
      setVertices(last.vertices); setClosed(last.closed); setDraft(last.draft); setSelection(null)
      return h.slice(0, -1)
    })
    lastEdit.current = ''
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ vertices, closed, refEdge: refEdgeState, settings, draft }))
    } catch { /* хранилище недоступно */ }
  }, [vertices, closed, refEdgeState, settings, draft])

  const applySaved = (d: unknown) => {
    const v = parseSaved(d)
    setVertices(v.vertices); setClosed(v.closed); setDraft(v.draft); setRefEdgeState(v.refEdge); setSettings(v.settings)
    setTool(v.closed ? 'edit' : 'draw'); setSelection(null); setSelectedSheet(null); setHistory([]); setFitSignal(x => x + 1)
  }

  const edgeCount = closed ? n : Math.max(n - 1, 0)
  const refEdge = closed && n >= 3 ? (refEdgeState !== null && refEdgeState < n ? refEdgeState : defaultRefEdge(vertices)) : 0

  const error = useMemo(() => (closed && n >= 3 ? validateContour(vertices) : null), [vertices, closed, n])
  const areaM2 = closed && !error ? contourAreaMm2(vertices) / 1e6 : 0
  const perimeterM = closed && !error ? contourPerimeterMm(vertices) / 1000 : 0
  const edgesInfo = useMemo(() => (n >= 3 ? contourEdges(vertices) : []), [vertices, n])

  const layout = useMemo(() => {
    if (!closed || n < 3 || error || tool !== 'sheets') return null
    return calcContourLayout({
      vertices, refEdge, sheetWidth: settings.sheetW, sheetLength: settings.sheetL, orientation: settings.orientation,
      shiftU: settings.shiftU, shiftV: settings.shiftV, stagger: settings.stagger, step: settings.step,
    })
  }, [vertices, closed, n, error, tool, refEdge, settings])

  const sheets = layout?.sheets ?? []
  const sel = sheets.find(s => s.id === selectedSheet) ?? null
  const selIdx = sel ? sheets.indexOf(sel) : -1
  const sideName = (e: number) => {
    const info = edgesInfo[e]
    return info?.radius !== null && info ? `дуга, сторона ${e + 1}` : `прямая, сторона ${e + 1}`
  }

  const sizeErr = !(settings.sheetW > 0 && settings.sheetL > 0) ? 'Размер листа должен быть больше 0'
    : !(settings.step >= 5) ? 'Шаг отметок не меньше 5 мм'
      : !(settings.labelStep >= settings.step) ? 'Шаг подписей не меньше шага отметок' : null

  // ── действия ──
  /** Состояние линий изменилось: если они замкнулись в корректную фигуру — собираем контур. */
  const applyDraft = (nd: DraftState) => {
    const st = draftStatus(nd.segments)
    snapshot(); lastEdit.current = ''
    if (st.loop && validateContour(st.loop) === null) {
      setVertices(st.loop); setClosed(true); setDraft(EMPTY_DRAFT)
      setRefEdgeState(null); setSelection(null); setTool('edit'); setFitSignal(x => x + 1)
    } else {
      setDraft(nd)
    }
  }
  const drawAt = (p: { x: number; y: number }) => { if (!closed) applyDraft(drawClick(draft, p)) }
  /** Правая кнопка мыши при рисовании: убрать последнюю точку (в истории — «Отменить» вернёт). */
  const undoLastPoint = () => { if (!closed) applyDraft(undoLast(draft)) }
  const finishLine = () => { if (draft.pending) setDraft(endChain(draft)) }
  const addByDimensions = () => {
    if (!draft.pending || !(lenIn > 0)) return
    const r = (angIn * Math.PI) / 180
    const a = draft.pending.p
    applyDraft(addSegment(draft, a, { x: Math.round((a.x + lenIn * Math.cos(r)) * 100) / 100, y: Math.round((a.y + lenIn * Math.sin(r)) * 100) / 100 }))
  }
  const draftInfo = useMemo(() => {
    const st = draftStatus(draft.segments)
    const loopErr = st.loop ? validateContour(st.loop) : null
    return { ...st, loopErr }
  }, [draft.segments])

  // Esc — закончить цепочку (поднять «перо»)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tool === 'draw') setDraft(d => endChain(d))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool])

  const clearAll = () => {
    if ((n > 0 || draft.segments.length > 0) && !window.confirm('Очистить контур?')) return
    snapshot(); setDraft(EMPTY_DRAFT)
    commit([], false); setSelection(null); setRefEdgeState(null); setSelectedSheet(null); setTool('draw'); setFitSignal(x => x + 1)
  }
  const loadExample = () => {
    setDraft(EMPTY_DRAFT)
    commit(sketchExample(), true); setSelection(null); setRefEdgeState(null); setSelectedSheet(null); setTool('edit'); setFitSignal(x => x + 1)
  }
  const chooseTool = (t: ContourTool) => {
    if (t === 'draw' && closed) return
    if (t !== 'draw' && !closed) return
    setTool(t); setSelection(null)
    if (t === 'sheets' && !selectedSheet) setSelectedSheet(1)
  }

  /** Передать контур в калькулятор потолков: App сам переключит вкладку, когда появится семя. */
  const sendToCeilingCalc = () => {
    const seed = contourToCeilingSeed(vertices, { refEdge })
    if (seed) useCeilingSeedStore.getState().setSeed(seed)
  }

  const selEdge = selection?.kind === 'edge' ? selection.index : -1
  const selVertex = selection?.kind === 'vertex' ? selection.index : -1

  const edgeEditor = () => {
    if (selEdge < 0 || selEdge >= n) return null
    const i = selEdge
    const a = vertices[i], b = vertices[(i + 1) % n]
    const chord = Math.hypot(b.x - a.x, b.y - a.y)
    const sag = Math.abs(a.sag ?? 0)
    const arc = edgeArc(a, b, a.sag ?? 0)
    const inward = closed && n >= 3 ? isBulgeInward(vertices, i) : true
    return (
      <div style={{ ...card, padding: 12, marginTop: 10, borderColor: '#f59e0b' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Сторона {i + 1} <span style={{ fontWeight: 400, color: C.muted }}>(от вершины {i + 1} к {((i + 1) % n) + 1})</span></div>
        <Toggle value={arc ? 'arc' : 'straight'} options={[['straight', 'Прямая'], ['arc', 'Дуга']]} onChange={v => {
          if (v === 'straight') commit(setEdgeBulge(vertices, i, 0, true))
          else if (!arc) commit(setEdgeBulge(vertices, i, Math.max(10, Math.round((chord * 0.08) / 10) * 10), true))
        }} />
        <div style={{ margin: '10px 0' }}>
          <NumField label="Длина хорды" suffix="мм" value={chord} step={10}
            onChange={v => commitField(`chord-${i}`, setEdgeChord(vertices, i, v))} />
        </div>
        {arc && (
          <>
            <Toggle value={arcInput} options={[['sagitta', 'Стрела'], ['radius', 'Радиус']]} onChange={setArcInput} />
            <div style={{ margin: '10px 0 8px' }}>
              {arcInput === 'sagitta'
                ? <NumField label="Стрела дуги" suffix="мм" value={sag} step={10}
                  onChange={v => commitField(`sag-${i}`, setEdgeBulge(vertices, i, v, inward))} />
                : <NumField label="Радиус дуги" suffix="мм" value={arc.R} step={100}
                  onChange={v => {
                    const hh = sagittaFromChordRadius(chord, v)
                    if (hh !== null) commitField(`rad-${i}`, setEdgeBulge(vertices, i, hh, inward))
                  }} />}
            </div>
            <Toggle value={inward ? 'in' : 'out'} options={[['in', 'Выгиб внутрь'], ['out', 'Выгиб наружу']]}
              onChange={v => { if ((v === 'in') !== inward) commit(flipEdgeBulge(vertices, i)) }} />
            <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
              R = {Math.round(arc.R)} мм · длина дуги {Math.round(arc.len)} мм · стрела не больше {Math.round(chord / 2)} мм
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {closed && <button style={btn} onClick={() => setRefEdgeState(i)} disabled={i === refEdge}>{i === refEdge ? '✓ Опорная' : 'Сделать опорной'}</button>}
          <button style={btn} onClick={() => {
            commit(splitEdge(vertices, i), closed)
            setRefEdgeState(r => (r !== null && r > i ? r + 1 : r))
          }}>Разделить пополам</button>
        </div>
      </div>
    )
  }

  const vertexEditor = () => {
    if (selVertex < 0 || selVertex >= n) return null
    const i = selVertex
    const v = vertices[i]
    return (
      <div style={{ ...card, padding: 12, marginTop: 10, borderColor: '#f59e0b' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Вершина {i + 1}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumField label="X" suffix="мм" value={v.x} step={10} onChange={x => commitField(`vx-${i}`, moveVertex(vertices, i, { x, y: v.y }))} />
          <NumField label="Y (вверх)" suffix="мм" value={v.y} step={10} onChange={y => commitField(`vy-${i}`, moveVertex(vertices, i, { x: v.x, y }))} />
        </div>
        <button style={{ ...btn, marginTop: 10, color: C.danger, borderColor: C.danger }} disabled={closed ? n <= 3 : n <= 1}
          onClick={() => {
            commit(removeVertex(vertices, i)); setSelection(null)
            setRefEdgeState(r => (r !== null && r < i ? r : null))
          }}>Удалить вершину</button>
      </div>
    )
  }

  const hint = tool === 'draw'
    ? 'Рисуйте линии по одной, в любом порядке: нажатие — начало, второе нажатие — конец. Следующая линия продолжает цепочку; чтобы начать новую в другом месте — нажмите ещё раз в последней точке, клавишу Esc или «Закончить линию». Когда линии образуют замкнутую фигуру, контур соберётся сам. Правая кнопка мыши — убрать последнюю точку. «Править» и «Листы» откроются после замыкания.'
    : tool === 'edit'
      ? 'Тяните вершину, чтобы переместить. Нажмите на сторону — сделать её дугой, задать длину, стрелу, радиус или опорной.'
      : 'Нажмите на лист, чтобы увидеть точки реза и ординаты по дугам.'

  const leftPanel = (
    <div style={{ ...card, padding: 16, width: narrow ? 'auto' : 330, flexShrink: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: C.text }}>✏️ Контур потолка</div>
      <div style={{ marginBottom: 10 }}><CalcFileButtons kind="contour" getData={() => ({ vertices, closed, refEdge: refEdgeState, settings, draft })} onLoad={applySaved} /></div>

      <Toggle value={tool} onChange={chooseTool} options={[['draw', '✏️ Рисовать'], ['edit', '✋ Править'], ['sheets', '🧱 Листы']]} />
      <div style={{ fontSize: 12, color: C.muted, margin: '8px 0 10px', lineHeight: 1.45 }}>{hint}</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button style={btn} onClick={undo} disabled={!history.length}>↶ Отменить</button>
        <button style={btn} onClick={() => setFitSignal(x => x + 1)}>⤢ Вписать</button>
        {tool === 'draw' && !closed && draft.pending && <button style={{ ...btn, color: '#fff', background: C.accent, borderColor: C.accent }} onClick={finishLine}>✂ Закончить линию</button>}
        <button style={btn} onClick={clearAll} disabled={n === 0 && draft.segments.length === 0 && !draft.pending}>🗑 Очистить</button>
      </div>
      {n === 0 && draft.segments.length === 0 && !draft.pending && <button style={{ ...btn, width: '100%', marginBottom: 10 }} onClick={loadExample}>Пример с эскиза (размеры условные)</button>}

      {tool === 'draw' && !closed && (
        <div style={{ ...card, padding: 12, marginBottom: 12, background: '#f8fafc' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Линия по размерам</div>
          {draft.pending ? (
            <>
              <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>
                От точки ({Math.round(draft.pending.p.x)}; {Math.round(draft.pending.p.y)}). Угол: 0° — вправо, 90° — вверх, 180° — влево, 270° — вниз.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <NumField label="Длина" suffix="мм" value={lenIn} step={10} onChange={setLenIn} />
                <NumField label="Угол" suffix="°" value={angIn} step={5} onChange={setAngIn} />
              </div>
              <button style={{ ...btn, marginTop: 8 }} disabled={!(lenIn > 0)} onClick={addByDimensions}>Провести линию</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>Начало линии — нажатием на холст или координатами:</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <NumField label="X" suffix="мм" value={startX} step={100} onChange={setStartX} />
                <NumField label="Y (вверх)" suffix="мм" value={startY} step={100} onChange={setStartY} />
              </div>
              <button style={{ ...btn, marginTop: 8 }} onClick={() => applyDraft(drawClick(draft, { x: startX, y: startY }))}>Поставить начало</button>
            </>
          )}
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Привязка при рисовании</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
        {GRIDS.map(([v, l]) => (
          <button key={v} onClick={() => setS({ grid: v })} style={{
            ...btn, padding: '5px 8px', fontSize: 12,
            borderColor: settings.grid === v ? C.accent : C.border, background: settings.grid === v ? C.accentLight : '#fff',
            color: settings.grid === v ? C.accent : C.text, fontWeight: settings.grid === v ? 600 : 400,
          }}>{l}</button>
        ))}
        <span style={{ fontSize: 12, color: C.muted, alignSelf: 'center' }}>мм</span>
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: C.text, marginBottom: 6 }}>
        <input type="checkbox" checked={settings.ortho} onChange={e => setS({ ortho: e.target.checked })} />
        Прямые углы (только вдоль осей)
      </label>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12 }}>Косую сторону проведите от конца до конца уже нарисованных линий (концы притягивают курсор) или задайте длиной и углом.</div>

      {edgeEditor()}
      {vertexEditor()}

      {n >= 2 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '14px 0 6px' }}>Стороны</div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 210, overflow: 'auto' }}>
            {Array.from({ length: edgeCount }, (_, i) => {
              const a = vertices[i], b = vertices[(i + 1) % n]
              const arc = edgeArc(a, b, a.sag ?? 0)
              const len = arc ? arc.len : Math.hypot(b.x - a.x, b.y - a.y)
              const on = selEdge === i
              return (
                <div key={i} onClick={() => { setTool(t => (t === 'draw' ? 'edit' : t)); if (tool !== 'sheets') setSelection({ kind: 'edge', index: i }) }}
                  style={{ display: 'flex', gap: 8, padding: '5px 9px', fontSize: 12.5, cursor: 'pointer', background: on ? '#fef3c7' : '#fff', borderBottom: '1px solid #f0f1f3' }}>
                  <b style={{ width: 22 }}>{i + 1}</b>
                  <span style={{ flex: 1 }}>{Math.round(len)} мм{arc ? ` · дуга R ${Math.round(arc.R)}` : ''}</span>
                  {closed && i === refEdge && <span style={{ color: C.ok, fontWeight: 600 }}>опора</span>}
                </div>
              )
            })}
          </div>
        </>
      )}

      {closed && n >= 3 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '14px 0 6px' }}>Раскладка листов</div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: C.muted, marginBottom: 10 }}>
            Опорная сторона (от неё идёт сетка листов)
            <select value={refEdge} onChange={e => setRefEdgeState(parseInt(e.target.value, 10))}
              style={{ padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6 }}>
              {Array.from({ length: n }, (_, i) => <option key={i} value={i}>Сторона {i + 1}{edgesInfo[i]?.radius ? ' (дуга)' : ''} · {Math.round(edgesInfo[i]?.chord ?? 0)} мм</option>)}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <NumField label="Ширина листа" suffix="мм" value={settings.sheetW} step={10} onChange={v => setS({ sheetW: v })} />
            <NumField label="Длина листа" suffix="мм" value={settings.sheetL} step={10} onChange={v => setS({ sheetL: v })} />
          </div>
          <Toggle value={settings.orientation} onChange={v => setS({ orientation: v, ...(v === 'across' ? { stagger: 0 } : {}) })}
            options={[['across', 'Поперёк опоры'], ['along', 'Вдоль опоры']]} />
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '12px 0 6px' }}>Сдвиг раскладки</div>
          <NumField label="Вдоль опорной стороны" suffix="мм" value={settings.shiftU} step={50} onChange={v => setS({ shiftU: v })} />
          <div style={{ display: 'flex', gap: 4, margin: '4px 0 8px' }}>
            <button style={btn} onClick={() => setS({ shiftU: settings.shiftU - 50 })}>−50</button>
            <button style={btn} onClick={() => setS({ shiftU: settings.shiftU + 50 })}>+50</button>
          </div>
          <NumField label="От опорной стороны внутрь" suffix="мм" value={settings.shiftV} step={50} onChange={v => setS({ shiftV: v })} />
          <div style={{ display: 'flex', gap: 4, margin: '4px 0 8px' }}>
            <button style={btn} onClick={() => setS({ shiftV: settings.shiftV - 50 })}>−50</button>
            <button style={btn} onClick={() => setS({ shiftV: settings.shiftV + 50 })}>+50</button>
            <button style={btn} onClick={() => setS({ shiftU: 0, shiftV: 0 })}>Сброс</button>
          </div>
          {settings.orientation === 'along' && (
            <>
              <NumField label="Смещение рядов вразбежку" suffix="мм" value={settings.stagger} step={50} onChange={v => setS({ stagger: v })} />
              <div style={{ display: 'flex', gap: 6, margin: '4px 0 8px' }}>
                {[0, 600, 1250].map(v => <button key={v} style={btn} onClick={() => setS({ stagger: v })}>{v}</button>)}
              </div>
            </>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '10px 0 6px' }}>Отметки по дугам</div>
          <NumField label="Шаг отметок вдоль кромки" suffix="мм" value={settings.step} step={25} onChange={v => setS({ step: v })} />
          <div style={{ height: 8 }} />
          <NumField label="Шаг подписей на чертеже и жирных строк" suffix="мм" value={settings.labelStep} step={25} onChange={v => setS({ labelStep: v })} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {[25, 50, 100, 250].map(v => <button key={v} style={btn} onClick={() => setS({ labelStep: v })}>{v}</button>)}
          </div>
          {sizeErr && <div style={{ marginTop: 10, padding: 8, background: '#fef2f2', color: C.danger, borderRadius: 6, fontSize: 12.5 }}>{sizeErr}</div>}
        </>
      )}
    </div>
  )

  const stat = (label: string, value: string, unit?: string, color?: string) => (
    <div style={{ ...card, padding: '10px 14px', minWidth: 120 }}>
      <div style={{ fontSize: 11.5, color: C.muted }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? C.text }}>{value}{unit && <span style={{ fontSize: 12, fontWeight: 400, color: C.muted }}> {unit}</span>}</div>
    </div>
  )

  const rightPanel = (
    <div style={{ flex: narrow ? 'none' : 1, minWidth: 0, width: narrow ? '100%' : undefined, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...card, padding: 10 }}>
        <ContourCanvas
          vertices={vertices} closed={closed} tool={tool} selection={selection} refEdge={refEdge}
          grid={settings.grid} ortho={settings.ortho} layout={layout} selectedSheet={selectedSheet} fitSignal={fitSignal}
          draft={draft} onDrawClick={drawAt} onUndoLast={undoLastPoint}
          onDragStart={() => { snapshot(); lastEdit.current = '' }}
          onDragVertex={(i, p) => setVertices(vs => moveVertex(vs, i, p))}
          onSelect={setSelection} onSelectSheet={setSelectedSheet}
        />
        {tool === 'sheets' && (
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
            Листы считаются по клеткам сетки, обрезки повторно не используются (запас по закупке — по факту раскладки). Голубой — лист целиком внутри контура, оранжевый — лист режется. Пунктир — полный лист (1200×2500), заливка — часть листа внутри контура.
          </div>
        )}
      </div>

      {error && <div style={{ padding: 10, background: '#fef2f2', color: C.danger, borderRadius: 8, fontSize: 13 }}>{error}</div>}
      {!closed && draft.segments.length > 0 && (
        <div style={{ padding: 10, background: draftInfo.problem || draftInfo.loopErr ? '#fef2f2' : '#fffbeb', color: draftInfo.problem || draftInfo.loopErr ? C.danger : '#92400e', borderRadius: 8, fontSize: 13 }}>
          {draftInfo.problem ?? draftInfo.loopErr ?? `Линий: ${draft.segments.length}. Незамкнутых концов: ${draftInfo.openEnds} (жёлтые точки). Контур соберётся сам, когда линии сомкнутся в фигуру; точки линий притягиваются друг к другу.`}
        </div>
      )}

      {closed && !error && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {stat('Площадь потолка', fmt(areaM2), 'м²', C.accent)}
          {stat('Периметр', fmt(perimeterM), 'м')}
          {stat('Сторон', String(n), '', undefined)}
          {layout && !layout.error && (
            <>
              {stat('Листов в раскладке', String(layout.sheetCount), 'шт')}
              {stat('Целых', String(layout.fullCount), 'шт', C.ok)}
              {stat('Резаных', String(layout.cutCount), 'шт', C.warn)}
              {stat('Площадь листов', fmt(layout.sheetAreaM2), 'м²')}
              {stat('Обрезки', fmt(layout.wasteM2), 'м²')}
            </>
          )}
        </div>
      )}
      {closed && !error && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tool !== 'sheets' && (
            <button style={{ ...btn, background: C.accent, color: '#fff', borderColor: C.accent, padding: '9px 16px', fontSize: 13.5 }}
              onClick={() => chooseTool('sheets')}>Раскладка листов →</button>
          )}
          <button style={{ ...btn, padding: '9px 16px', fontSize: 13.5, borderColor: C.ok, color: C.ok, fontWeight: 600 }}
            title="Передать контур, площадь и периметр на вкладку «Потолки»"
            onClick={sendToCeilingCalc}>→ В калькулятор потолков</button>
        </div>
      )}
      {layout?.error && <div style={{ padding: 10, background: '#fef2f2', color: C.danger, borderRadius: 8, fontSize: 13 }}>{layout.error}</div>}

      {tool === 'sheets' && layout && !layout.error && sel && !sizeErr && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <button style={btn} disabled={selIdx <= 0} onClick={() => setSelectedSheet(sheets[selIdx - 1].id)}>◀</button>
            <b style={{ fontSize: 14 }}>Лист №{sel.id}</b>
            <button style={btn} disabled={selIdx >= sheets.length - 1} onClick={() => setSelectedSheet(sheets[selIdx + 1].id)}>▶</button>
            <span style={{ fontSize: 12, color: C.muted }}>
              ряд {sel.row + 1}, {sel.w}×{sel.h} мм, в контуре {fmt(sel.areaM2, 3)} м² · {sel.status === 'full' ? 'целый' : 'резать'}
            </span>
          </div>
          <SheetDrawing sheet={sel} labelStep={settings.labelStep} />
          <SheetTables sheet={sel} labelStep={settings.labelStep} sideName={sideName} />
        </div>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', gap: 20, padding: narrow ? 10 : 20, background: C.bg, minHeight: '100%', flexWrap: narrow ? 'nowrap' : 'wrap', flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'stretch' : 'flex-start' }}>
      {narrow ? <>{rightPanel}{leftPanel}</> : <>{leftPanel}{rightPanel}</>}
    </div>
  )
}
