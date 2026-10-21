/**
 * ContourCanvas.tsx — холст вкладки «Контур потолка»: рисование контура мышью/пальцем
 * по сетке с привязкой, перетаскивание вершин, выбор сторон, масштаб (колесо, щипок),
 * панорама и оверлей раскладки листов. Вся геометрия — core/calcContourLayout.ts
 * и core/contourEdit.ts; здесь только ввод и отрисовка (SVG в экранных пикселях).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { edgeArc, tessellate, toWorld, type ContourLayoutResult, type ContourVertex, type Pt } from '../core/calcContourLayout'
import { distanceToEdge, isCCW, snapPoint } from '../core/contourEdit'
import { C } from './calcTheme'

export type ContourTool = 'draw' | 'edit' | 'sheets'
export type Selection = { kind: 'vertex' | 'edge'; index: number } | null

interface View { s: number; tx: number; ty: number }

export interface ContourCanvasProps {
  vertices: ContourVertex[]
  closed: boolean
  tool: ContourTool
  selection: Selection
  refEdge: number
  /** Шаг сетки привязки, мм (0 — без привязки). */
  grid: number
  ortho: boolean
  layout: ContourLayoutResult | null
  selectedSheet: number | null
  /** Меняется — холст вписывает контур в окно. */
  fitSignal: number
  onAddVertex: (p: Pt) => void
  onClose: () => void
  onDragStart: () => void
  onDragVertex: (i: number, p: Pt) => void
  onSelect: (s: Selection) => void
  onSelectSheet: (id: number) => void
}

const NICE = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
const HIT_VERTEX_PX = 16
const HIT_EDGE_PX = 10
const MOVE_PX = 5

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export default function ContourCanvas(props: ContourCanvasProps) {
  const { vertices, closed, tool, selection, refEdge, grid, ortho, layout, selectedSheet, fitSignal } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 560 })
  const sizeRef = useRef(size)
  const [measured, setMeasured] = useState(false)
  const [view, setView] = useState<View>({ s: 0.05, tx: 120, ty: 480 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [hover, setHover] = useState<Pt | null>(null)
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const g = useRef({
    mode: 'none' as 'none' | 'pan' | 'drag' | 'pinch',
    startX: 0, startY: 0, moved: false, vertex: -1, dragBegan: false,
    startView: view, d0: 1, mid0: { x: 0, y: 0 },
  })
  const propsRef = useRef(props)
  propsRef.current = props

  // ── размер ──
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => {
      const w = Math.max(el.clientWidth, 280)
      const next = { w, h: w < 520 ? 440 : 580 }
      sizeRef.current = next
      setSize(next)
      setMeasured(true)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── вписать ──
  useEffect(() => {
    const { w, h } = sizeRef.current
    const vs = propsRef.current.vertices
    if (vs.length === 0) {
      const s = (w - 80) / 8000
      setView({ s, tx: 40, ty: h - 40 })
      return
    }
    const pts = vs.length >= 3 ? tessellate(vs, 5) : vs
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) }
    const bw = Math.max(x1 - x0, 500), bh = Math.max(y1 - y0, 500)
    const s = Math.min((w - 230) / bw, (h - 110) / bh)
    setView({ s, tx: (w - bw * s) / 2 - x0 * s, ty: (h + bh * s) / 2 + y0 * s })
  }, [fitSignal, measured])

  // ── колесо мыши: масштаб вокруг курсора ──
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      const v = viewRef.current
      const k = Math.exp(-e.deltaY * 0.0015)
      const s2 = Math.min(Math.max(v.s * k, 0.002), 2)
      const wx = (sx - v.tx) / v.s, wy = -(sy - v.ty) / v.s
      setView({ s: s2, tx: sx - wx * s2, ty: sy + wy * s2 })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const toS = (p: Pt) => ({ x: view.tx + p.x * view.s, y: view.ty - p.y * view.s })
  const toW = (sx: number, sy: number): Pt => ({ x: (sx - view.tx) / view.s, y: -(sy - view.ty) / view.s })

  const localXY = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const n = vertices.length
  const snapAt = (sp: { x: number; y: number }, forDrag: boolean) => {
    const w = toW(sp.x, sp.y)
    const prev = !forDrag && !closed && n > 0 ? vertices[n - 1] : null
    return snapPoint(w, {
      grid, ortho: ortho && !forDrag, prev,
      vertices: forDrag ? [] : vertices, vertexTol: HIT_VERTEX_PX / view.s,
    })
  }

  const hitVertex = (sp: { x: number; y: number }) => {
    let best = -1, bd = HIT_VERTEX_PX
    vertices.forEach((v, i) => {
      const s = toS(v)
      const d = Math.hypot(s.x - sp.x, s.y - sp.y)
      if (d <= bd) { best = i; bd = d }
    })
    return best
  }
  const hitEdge = (sp: { x: number; y: number }) => {
    if (n < 2) return -1
    const w = toW(sp.x, sp.y)
    let best = -1, bd = HIT_EDGE_PX / view.s
    const count = closed ? n : n - 1
    for (let i = 0; i < count; i++) {
      const d = distanceToEdge(vertices, i, w)
      if (d <= bd) { best = i; bd = d }
    }
    return best
  }

  // ── полигоны листов (экранные) ──
  const sheetPolys = useMemo(() => {
    if (!layout || !layout.frame || tool !== 'sheets') return []
    const f = layout.frame
    return layout.sheets.map(sh => {
      const toScr = (u: number, v: number) => {
        const w = toWorld(f, { x: sh.u0 + u, y: sh.v0 + v })
        return { x: view.tx + w.x * view.s, y: view.ty - w.y * view.s }
      }
      const piece = (sh.status === 'full'
        ? [[0, 0], [sh.w, 0], [sh.w, sh.h], [0, sh.h]]
        : sh.outline.map(p => [p.u, p.v])).map(([u, v]) => toScr(u, v))
      const cell = [[0, 0], [sh.w, 0], [sh.w, sh.h], [0, sh.h]].map(([u, v]) => toScr(u, v))
      const cx = piece.reduce((s, p) => s + p.x, 0) / piece.length
      const cy = piece.reduce((s, p) => s + p.y, 0) / piece.length
      return { id: sh.id, full: sh.status === 'full', piece, cell, cx, cy }
    })
  }, [layout, view, tool])

  // ── события указателя ──
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = localXY(e)
    ptrs.current.set(e.pointerId, p)
    const st = g.current
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()]
      st.mode = 'pinch'
      st.d0 = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1)
      st.mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      st.startView = view
      st.moved = true
      return
    }
    st.mode = 'none'; st.startX = p.x; st.startY = p.y; st.moved = false; st.vertex = -1; st.dragBegan = false
    st.startView = view
    if (tool === 'edit') {
      const vi = hitVertex(p)
      if (vi >= 0) { st.mode = 'drag'; st.vertex = vi; props.onSelect({ kind: 'vertex', index: vi }) }
    }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = localXY(e)
    const st = g.current
    const pressed = ptrs.current.has(e.pointerId)
    if (pressed) ptrs.current.set(e.pointerId, p)
    if (st.mode === 'pinch') {
      if (ptrs.current.size >= 2) {
        const [a, b] = [...ptrs.current.values()]
        const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const sv = st.startView
        const s2 = Math.min(Math.max(sv.s * (d / st.d0), 0.002), 2)
        const wx = (st.mid0.x - sv.tx) / sv.s, wy = -(st.mid0.y - sv.ty) / sv.s
        setView({ s: s2, tx: mid.x - wx * s2, ty: mid.y + wy * s2 })
      }
      return
    }
    if (pressed && ptrs.current.size === 1) {
      const dx = p.x - st.startX, dy = p.y - st.startY
      if (!st.moved && Math.hypot(dx, dy) > MOVE_PX) st.moved = true
      if (!st.moved) return
      if (st.mode === 'drag') {
        if (!st.dragBegan) { propsRef.current.onDragStart(); st.dragBegan = true }
        const sn = snapAt(p, true)
        propsRef.current.onDragVertex(st.vertex, { x: sn.x, y: sn.y })
      } else {
        st.mode = 'pan'
        setView({ ...st.startView, tx: st.startView.tx + dx, ty: st.startView.ty + dy })
      }
      return
    }
    if (tool === 'draw' && !closed) { const sn = snapAt(p, false); setHover({ x: sn.x, y: sn.y }) }
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = localXY(e)
    const st = g.current
    const had = ptrs.current.size
    ptrs.current.delete(e.pointerId)
    if (st.mode === 'pinch') { if (ptrs.current.size === 0) st.mode = 'none'; return }
    const wasDrag = st.mode === 'drag'
    st.mode = 'none'
    if (st.moved || had !== 1) return
    if (wasDrag) return
    if (tool === 'draw') {
      if (closed) return
      const sn = snapAt(p, false)
      if (sn.kind === 'vertex') {
        if (sn.vertexIndex === 0 && n >= 3) props.onClose()
        return
      }
      props.onAddVertex({ x: sn.x, y: sn.y })
    } else if (tool === 'edit') {
      const vi = hitVertex(p)
      if (vi >= 0) return props.onSelect({ kind: 'vertex', index: vi })
      const ei = hitEdge(p)
      props.onSelect(ei >= 0 ? { kind: 'edge', index: ei } : null)
    } else {
      const w = toW(p.x, p.y)
      void w
      for (let i = sheetPolys.length - 1; i >= 0; i--) {
        if (pointInPoly(p, sheetPolys[i].piece)) { props.onSelectSheet(sheetPolys[i].id); return }
      }
    }
  }

  const onPointerLeave = () => { if (ptrs.current.size === 0) setHover(null) }

  // ── сетка ──
  const minor = NICE.find(v => v * view.s >= 14) ?? NICE[NICE.length - 1]
  const wx0 = toW(0, 0).x, wx1 = toW(size.w, 0).x
  const wy1 = toW(0, 0).y, wy0 = toW(0, size.h).y
  const gridLines: React.ReactNode[] = []
  {
    const major = minor * 5
    let count = 0
    for (let x = Math.floor(wx0 / minor) * minor; x <= wx1 && count < 400; x += minor, count++) {
      const sx = view.tx + x * view.s
      const mj = Math.abs(x / major - Math.round(x / major)) < 1e-6
      gridLines.push(<line key={'x' + x} x1={sx} y1={0} x2={sx} y2={size.h} stroke={mj ? '#cbd5e1' : '#eceff3'} strokeWidth={mj ? 1 : 0.7} />)
    }
    count = 0
    for (let y = Math.floor(wy0 / minor) * minor; y <= wy1 && count < 400; y += minor, count++) {
      const sy = view.ty - y * view.s
      const mj = Math.abs(y / major - Math.round(y / major)) < 1e-6
      gridLines.push(<line key={'y' + y} x1={0} y1={sy} x2={size.w} y2={sy} stroke={mj ? '#cbd5e1' : '#eceff3'} strokeWidth={mj ? 1 : 0.7} />)
    }
  }

  // ── рёбра ──
  const ccw = useMemo(() => (n >= 3 ? isCCW(vertices) : true), [vertices, n])
  const edges = useMemo(() => {
    const count = closed ? n : Math.max(n - 1, 0)
    return Array.from({ length: count }, (_, i) => {
      const a = vertices[i], b = vertices[(i + 1) % n]
      const arc = edgeArc(a, b, a.sag ?? 0)
      const pts: Pt[] = [{ x: a.x, y: a.y }]
      let label: Pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      if (arc) {
        const segs = 56
        for (let k = 1; k < segs; k++) {
          const ang = arc.a0 + (arc.sweep * k) / segs
          pts.push({ x: arc.cx + arc.R * Math.cos(ang), y: arc.cy + arc.R * Math.sin(ang) })
        }
        const am = arc.a0 + arc.sweep / 2
        label = { x: arc.cx + arc.R * Math.cos(am), y: arc.cy + arc.R * Math.sin(am) }
      }
      pts.push({ x: b.x, y: b.y })
      // подпись — снаружи от контура (внутренность слева от обхода при ccw)
      const dx = b.x - a.x, dy = b.y - a.y
      const dl = Math.hypot(dx, dy) || 1
      const outSign = ccw ? -1 : 1
      const out = { x: outSign * (-dy / dl), y: outSign * (dx / dl) }
      const text = arc
        ? `R ${Math.round(arc.R)} · f ${Math.round(Math.abs(a.sag ?? 0))}`
        : String(Math.round(Math.hypot(b.x - a.x, b.y - a.y)))
      return { i, pts, arc: !!arc, label, text, out }
    })
  }, [vertices, closed, n, ccw])

  const fillPath = useMemo(() => {
    if (!closed || n < 3) return ''
    return tessellate(vertices, 2).map((p, k) => `${k ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + ' Z'
  }, [vertices, closed, n])

  const pathD = (pts: Pt[]) => pts.map((p, k) => { const s = toS(p); return `${k ? 'L' : 'M'}${s.x.toFixed(1)},${s.y.toFixed(1)}` }).join(' ')
  const fillD = fillPath
    ? fillPath.replace(/([ML])(-?[\d.eE+-]+),(-?[\d.eE+-]+)/g, (_m, c, x, y) => { const s = toS({ x: +x, y: +y }); return `${c}${s.x.toFixed(1)},${s.y.toFixed(1)}` })
    : ''

  // масштабная линейка
  const barLen = [100, 200, 500, 1000, 2000, 5000, 10000].find(v => v * view.s >= 70) ?? 10000
  const lastV = n > 0 ? vertices[n - 1] : null
  const hoverInfo = tool === 'draw' && !closed && hover && lastV
    ? { len: Math.round(Math.hypot(hover.x - lastV.x, hover.y - lastV.y)), ang: Math.round((Math.atan2(hover.y - lastV.y, hover.x - lastV.x) * 180) / Math.PI) }
    : null
  const closeHot = tool === 'draw' && !closed && n >= 3 && hover && Math.hypot(hover.x - vertices[0].x, hover.y - vertices[0].y) * view.s <= HIT_VERTEX_PX

  const halo: React.CSSProperties = { paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3.5, strokeLinejoin: 'round' }

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <svg ref={svgRef} width={size.w} height={size.h}
        style={{ display: 'block', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, touchAction: 'none', cursor: tool === 'draw' ? 'crosshair' : 'default', userSelect: 'none' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp} onPointerLeave={onPointerLeave}>
        {gridLines}
        {fillD && <path d={fillD} fill="rgba(59,130,246,0.07)" fillRule="evenodd" />}

        {tool === 'sheets' && sheetPolys.map(sp => (
          <g key={sp.id}>
            <polygon points={sp.cell.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#9ca3af" strokeWidth={0.8} strokeDasharray="4 3" />
            <polygon points={sp.piece.map(p => `${p.x},${p.y}`).join(' ')}
              fill={sp.full ? 'rgba(96,165,250,0.35)' : 'rgba(251,146,60,0.45)'}
              stroke={sp.id === selectedSheet ? '#111827' : '#6b7280'} strokeWidth={sp.id === selectedSheet ? 2.5 : 0.8} />
            <text x={sp.cx} y={sp.cy + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#111827" style={halo}>{sp.id}</text>
          </g>
        ))}

        {edges.map(ed => {
          const isSel = selection?.kind === 'edge' && selection.index === ed.i
          const isRef = ed.i === refEdge && closed
          const col = isSel ? '#f59e0b' : isRef ? '#059669' : ed.arc ? '#1d4ed8' : '#374151'
          const base = toS(ed.label)
          // экранный вектор «наружу»: ось Y экрана направлена вниз
          const textW = ed.text.length * 6.4
          let k = 1
          // если подпись снаружи не помещается в окне — ставим её с внутренней стороны
          const outX = base.x + ed.out.x * 12
          if ((ed.out.x < -0.35 && outX - textW < 4) || (ed.out.x > 0.35 && outX + textW > size.w - 4)) k = -1
          const mid = { x: base.x + k * ed.out.x * 12, y: base.y - k * ed.out.y * 12 }
          const ox = k * ed.out.x
          const anchor = ox < -0.35 ? 'end' : ox > 0.35 ? 'start' : 'middle'
          const a = toS(ed.pts[0]), b = toS(ed.pts[ed.pts.length - 1])
          const showLabel = Math.hypot(a.x - b.x, a.y - b.y) > 46 && (tool !== 'sheets' || isRef)
          return (
            <g key={ed.i}>
              <path d={pathD(ed.pts)} fill="none" stroke={col} strokeWidth={isSel ? 3.4 : isRef ? 3 : 2} />
              {showLabel && (
                <text x={mid.x} y={mid.y + 4} textAnchor={anchor} fontSize={11} fill={isRef ? '#047857' : '#111827'} style={halo}>
                  {ed.text}
                </text>
              )}
            </g>
          )
        })}

        {tool === 'draw' && !closed && lastV && hover && (
          <g>
            <line x1={toS(lastV).x} y1={toS(lastV).y} x2={toS(hover).x} y2={toS(hover).y} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="6 4" />
            <circle cx={toS(hover).x} cy={toS(hover).y} r={closeHot ? 10 : 5} fill={closeHot ? 'rgba(5,150,105,0.25)' : 'rgba(37,99,235,0.25)'} stroke={closeHot ? '#059669' : '#2563eb'} />
            {hoverInfo && (
              <text x={toS(hover).x + 10} y={toS(hover).y - 10} fontSize={11} fill="#1e3a8a" style={halo}>
                {closeHot ? 'замкнуть' : `${hoverInfo.len} мм · ${hoverInfo.ang}°`}
              </text>
            )}
          </g>
        )}

        {vertices.map((v, i) => {
          const s = toS(v)
          const sel = selection?.kind === 'vertex' && selection.index === i
          return (
            <g key={i}>
              <circle cx={s.x} cy={s.y} r={sel ? 8 : 5.5} fill={i === 0 ? '#059669' : sel ? '#f59e0b' : '#fff'} stroke="#111827" strokeWidth={1.6} />
              <text x={s.x + 9} y={s.y - 9} fontSize={11} fontWeight={600} fill="#111827" style={halo}>{i + 1}</text>
            </g>
          )
        })}

        {n === 0 && tool === 'draw' && (
          <text x={size.w / 2} y={size.h / 2} textAnchor="middle" fontSize={14} fill={C.muted}>
            Нажмите на сетку, чтобы поставить первую вершину
          </text>
        )}

        <g>
          <line x1={14} y1={size.h - 16} x2={14 + barLen * view.s} y2={size.h - 16} stroke="#111827" strokeWidth={2} />
          <line x1={14} y1={size.h - 21} x2={14} y2={size.h - 11} stroke="#111827" strokeWidth={2} />
          <line x1={14 + barLen * view.s} y1={size.h - 21} x2={14 + barLen * view.s} y2={size.h - 11} stroke="#111827" strokeWidth={2} />
          <text x={18 + barLen * view.s} y={size.h - 12} fontSize={11} fill="#111827" style={halo}>{barLen >= 1000 ? `${barLen / 1000} м` : `${barLen} мм`}</text>
          <text x={size.w - 8} y={size.h - 12} fontSize={11} textAnchor="end" fill={C.muted} style={halo}>сетка {minor} мм</text>
        </g>
      </svg>
    </div>
  )
}
