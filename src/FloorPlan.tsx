/**
 * FloorPlan — план объекта.
 *
 * Режимы:
 *   draw    — рисование линий (с опцией прямых углов)
 *   select  — выбор / перемещение линии целиком или за конец
 *   contour — выделение линий для периметра
 *   scale   — установка масштаба
 *
 * Новое:
 *   - ⊾ Прямой угол: кнопка-тогл, снапает к 0°/90°/45°
 *   - // Параллельная: копирует выбранную линию со смещением
 *   - Перемещение: drag линии целиком или за концевую точку
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Stage, Layer, Line, Circle, Text, Rect, Group } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useProjectStore } from './store/useProjectStore'
import type { PlanLine, PlanLineType, PlanView, PlanContour } from './types'

// ─── Константы ───────────────────────────────────────────────────────────────

const CANVAS_H  = 520
const SNAP_PX   = 18
const DRAG_THRESHOLD = 4  // px — минимум для начала drag

const LINE_COLORS: Record<PlanLineType, string> = {
  wall_new:      '#e53935',
  wall_lining:   '#1e88e5',
  wall_existing: '#78909c',
  ceiling:       '#8e24aa',
  floor:         '#6d4c41',
}
const LINE_LABELS: Record<PlanLineType, string> = {
  wall_new:      'Перегородка',
  wall_lining:   'Облицовка',
  wall_existing: 'Сущ. стена',
  ceiling:       'Потолок',
  floor:         'Пол',
}
const LINE_WIDTH: Record<PlanLineType, number> = {
  wall_new: 4, wall_lining: 3, wall_existing: 5, ceiling: 2, floor: 2,
}
const HAS_SIDE_VIEW: PlanLineType[] = ['wall_new', 'wall_lining', 'floor']

type Mode = 'draw' | 'select' | 'contour' | 'scale'

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}
function lineLengthMm(x1: number, y1: number, x2: number, y2: number, s: number) {
  return Math.round(dist(x1, y1, x2, y2) * s)
}

/** Снап к ближайшей концевой точке линий */
function snapPoint(x: number, y: number, lines: PlanLine[], excludeId?: string) {
  let best = { x, y, snapped: false, d: SNAP_PX }
  for (const l of lines) {
    if (l.id === excludeId) continue
    for (const [px, py] of [[l.x1, l.y1], [l.x2, l.y2]] as [number, number][]) {
      const d = dist(x, y, px, py)
      if (d < best.d) best = { x: px, y: py, snapped: true, d }
    }
  }
  return best
}

/** Прямой угол: снапаем к 0°/90°/45° от стартовой точки */
function snapOrtho(x1: number, y1: number, x: number, y: number): { x: number; y: number } {
  const dx = x - x1
  const dy = y - y1
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  const len   = Math.sqrt(dx * dx + dy * dy)
  // Ближайший из 0, 45, 90, 135, 180, -135, -90, -45
  const snapped = Math.round(angle / 45) * 45
  const rad = snapped * Math.PI / 180
  return { x: x1 + Math.cos(rad) * len, y: y1 + Math.sin(rad) * len }
}

/** Площадь по формуле Гаусса */
function polygonAreaM2(points: { x: number; y: number }[], scaleMmPx: number): number {
  const n = points.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }
  return Math.abs(area) / 2 * (scaleMmPx / 1000) ** 2
}

/** Упорядоченные точки контура */
function extractContourPoints(lineIds: string[], lines: PlanLine[]) {
  const sel = lineIds.map(id => lines.find(l => l.id === id)).filter(Boolean) as PlanLine[]
  if (sel.length < 3) return []
  const pts: { x: number; y: number }[] = []
  let current = sel[0]
  const used = new Set([current.id])
  pts.push({ x: current.x1, y: current.y1 }, { x: current.x2, y: current.y2 })
  let prevEnd = { x: current.x2, y: current.y2 }
  for (let i = 1; i < sel.length; i++) {
    const next = sel.find(l => !used.has(l.id) && (
      (Math.abs(l.x1 - prevEnd.x) < 2 && Math.abs(l.y1 - prevEnd.y) < 2) ||
      (Math.abs(l.x2 - prevEnd.x) < 2 && Math.abs(l.y2 - prevEnd.y) < 2)
    ))
    if (!next) break
    used.add(next.id)
    if (Math.abs(next.x1 - prevEnd.x) < 2 && Math.abs(next.y1 - prevEnd.y) < 2) {
      prevEnd = { x: next.x2, y: next.y2 }
    } else {
      prevEnd = { x: next.x1, y: next.y1 }
    }
    pts.push(prevEnd)
  }
  return pts
}

function fmtArea(m2: number) {
  return m2 < 0.01 ? '<0.01 м²' : `${m2.toFixed(2)} м²`
}

function fmtLen(mm: number) {
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)}м` : `${mm}мм`
}

// ─── Компонент ───────────────────────────────────────────────────────────────

type DragState =
  | { kind: 'line';  id: string; startPx: number; startPy: number; origX1: number; origY1: number; origX2: number; origY2: number }
  | { kind: 'end1';  id: string; startPx: number; startPy: number }
  | { kind: 'end2';  id: string; startPx: number; startPy: number }
  | null

export default function FloorPlan() {
  const {
    floorPlan, addPlanLine, updatePlanLine, removePlanLine,
    setFloorPlanScale, clearFloorPlan,
    addContour, removeContour,
  } = useProjectStore()

  const lines     = floorPlan?.lines    ?? []
  const contours  = floorPlan?.contours ?? []
  const scaleMmPx = floorPlan?.scaleMmPerPx ?? 10

  // ── UI-состояние ──────────────────────────────────────────────────────────
  const [planView, setPlanView]         = useState<PlanView>('top')
  const [mode, setMode]                 = useState<Mode>('draw')
  const [drawType, setDrawType]         = useState<PlanLineType>('wall_new')
  const [orthoMode, setOrthoMode]       = useState(false)        // ⊾ прямой угол
  const [drawing, setDrawing]           = useState<{ x1: number; y1: number } | null>(null)
  const [cursor, setCursor]             = useState<{ x: number; y: number } | null>(null)
  const [selectedId, setSelected]       = useState<string | null>(null)
  const [contourIds, setContourIds]     = useState<string[]>([])
  const [contourType, setContourType]   = useState<PlanLineType>('ceiling')
  const [contourLabel, setContourLabel] = useState('')

  // Параллельная линия
  const [showParallelDialog, setShowParallelDialog] = useState(false)
  const [parallelDist, setParallelDist]             = useState('100')

  // Перемещение (drag)
  const dragRef = useRef<DragState>(null)
  const dragMovedRef = useRef(false)  // отличаем клик от drag

  // Масштаб
  const [scaleStep, setScaleStep]           = useState<0 | 1 | 2>(0)
  const [scalePt1, setScalePt1]             = useState<{ x: number; y: number } | null>(null)
  const [scalePt2, setScalePt2]             = useState<{ x: number; y: number } | null>(null)
  const [scaleMmInput, setScaleMmInput]     = useState('')
  const [showScaleDialog, setShowScaleDialog] = useState(false)

  // Адаптивная ширина
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef     = useRef<any>(null)
  const [canvasW, setCanvasW] = useState(820)
  useEffect(() => {
    function update() {
      if (containerRef.current) setCanvasW(containerRef.current.offsetWidth)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // ── Позиция из события ────────────────────────────────────────────────────
  function getPos(e: KonvaEventObject<MouseEvent | TouchEvent>): { x: number; y: number } | null {
    const stage = e.target.getStage()
    if (!stage) return null
    const te = e.evt as TouchEvent
    if (te.touches?.length > 0) {
      const rect = stage.container().getBoundingClientRect()
      return { x: te.touches[0].clientX - rect.left, y: te.touches[0].clientY - rect.top }
    }
    return stage.getPointerPosition()
  }

  /** Применяем снап точки + ортогональность если включена */
  function applySnap(x: number, y: number, excludeId?: string): { x: number; y: number } {
    const snapped = snapPoint(x, y, lines, excludeId)
    if (orthoMode && drawing && !snapped.snapped) {
      return snapOrtho(drawing.x1, drawing.y1, snapped.x, snapped.y)
    }
    return snapped
  }

  // ── Превью длины ─────────────────────────────────────────────────────────
  function previewLabel(x2: number, y2: number) {
    if (!drawing) return ''
    const mm = lineLengthMm(drawing.x1, drawing.y1, x2, y2, scaleMmPx)
    if (mm < 10) return ''
    return fmtLen(mm)
  }

  // ── Движение (mouse + touch) ──────────────────────────────────────────────
  function handleMove(rawX: number, rawY: number) {
    // Drag перемещения
    if (dragRef.current && mode === 'select') {
      const dr = dragRef.current
      const dx = rawX - dr.startPx
      const dy = rawY - dr.startPy
      if (!dragMovedRef.current && Math.sqrt(dx*dx + dy*dy) < DRAG_THRESHOLD) return
      dragMovedRef.current = true

      if (dr.kind === 'line') {
        const s = snapPoint(
          dr.origX1 + dx, dr.origY1 + dy, lines, dr.id
        )
        const snapDx = s.snapped ? s.x - dr.origX1 : dx
        const snapDy = s.snapped ? s.y - dr.origY1 : dy
        const newX1 = dr.origX1 + snapDx
        const newY1 = dr.origY1 + snapDy
        const newX2 = dr.origX2 + snapDx
        const newY2 = dr.origY2 + snapDy
        const lm = lineLengthMm(newX1, newY1, newX2, newY2, scaleMmPx)
        updatePlanLine(dr.id, { x1: newX1, y1: newY1, x2: newX2, y2: newY2, lengthMm: lm })
      } else if (dr.kind === 'end1') {
        const s = snapPoint(rawX, rawY, lines, dr.id)
        const l = lines.find(l => l.id === dr.id)!
        const lm = lineLengthMm(s.x, s.y, l.x2, l.y2, scaleMmPx)
        updatePlanLine(dr.id, { x1: s.x, y1: s.y, lengthMm: lm })
      } else {
        const s = snapPoint(rawX, rawY, lines, dr.id)
        const l = lines.find(l => l.id === dr.id)!
        const lm = lineLengthMm(l.x1, l.y1, s.x, s.y, scaleMmPx)
        updatePlanLine(dr.id, { x2: s.x, y2: s.y, lengthMm: lm })
      }
      return
    }
    // Превью при рисовании
    const pt = applySnap(rawX, rawY)
    setCursor({ x: pt.x, y: pt.y })
  }

  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (pos) handleMove(pos.x, pos.y)
  }, [lines, mode, drawing, orthoMode, dragRef.current])

  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    const te = e.evt as TouchEvent
    if (!te.touches.length) return
    const rect = stage.container().getBoundingClientRect()
    handleMove(te.touches[0].clientX - rect.left, te.touches[0].clientY - rect.top)
  }, [lines, mode, drawing, orthoMode, dragRef.current])

  // ── MouseDown на линии (начало drag) ─────────────────────────────────────
  function startDragLine(id: string, kind: 'line' | 'end1' | 'end2', px: number, py: number) {
    if (mode !== 'select') return
    const l = lines.find(l => l.id === id)
    if (!l) return
    dragMovedRef.current = false
    if (kind === 'line') {
      dragRef.current = { kind, id, startPx: px, startPy: py, origX1: l.x1, origY1: l.y1, origX2: l.x2, origY2: l.y2 }
    } else {
      dragRef.current = { kind, id, startPx: px, startPy: py }
    }
  }

  // ── MouseUp / TouchEnd — конец drag ──────────────────────────────────────
  const handlePointerUp = useCallback(() => {
    if (dragRef.current && !dragMovedRef.current && mode === 'select') {
      setSelected(dragRef.current.id)
    }
    dragRef.current = null
    dragMovedRef.current = false
  }, [mode])

  // ── Клик по холсту (только draw/scale/contour) ────────────────────────────
  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (dragMovedRef.current) return  // был drag — игнорируем
    const pos = getPos(e)
    if (!pos) return

    if (mode === 'scale') {
      const s = snapPoint(pos.x, pos.y, lines)
      if (scaleStep === 0) { setScalePt1({ x: s.x, y: s.y }); setScaleStep(1) }
      else if (scaleStep === 1) { setScalePt2({ x: s.x, y: s.y }); setScaleStep(2); setShowScaleDialog(true) }
      return
    }

    if (mode === 'draw') {
      const pt = applySnap(pos.x, pos.y)
      if (!drawing) {
        setDrawing({ x1: pt.x, y1: pt.y })
      } else {
        const d = dist(drawing.x1, drawing.y1, pt.x, pt.y)
        if (d < 5) { setDrawing(null); return }
        const lengthMm = lineLengthMm(drawing.x1, drawing.y1, pt.x, pt.y, scaleMmPx)
        const count = lines.filter(l => l.type === drawType).length + 1
        addPlanLine({ x1: drawing.x1, y1: drawing.y1, x2: pt.x, y2: pt.y, type: drawType, lengthMm, label: `${LINE_LABELS[drawType]} ${count}` })
        setDrawing({ x1: pt.x, y1: pt.y })
      }
      return
    }

    if (mode === 'select') { setSelected(null) }
  }, [mode, drawing, lines, scaleMmPx, drawType, scaleStep, orthoMode, addPlanLine])

  // ── Клик по линии ────────────────────────────────────────────────────────
  const handleLinePointerDown = useCallback((id: string, e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true
    const pos = getPos(e)
    if (!pos) return
    if (mode === 'select') startDragLine(id, 'line', pos.x, pos.y)
    if (mode === 'contour') {
      setContourIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }
  }, [mode, lines])

  // @ts-ignore
  const handleEndPointerDown = useCallback((id: string, end: 'end1' | 'end2', e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true
    const pos = getPos(e)
    if (!pos) return
    if (mode === 'select') startDragLine(id, end, pos.x, pos.y)
  }, [mode, lines])

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setDrawing(null); setSelected(null); setScaleStep(0); setScalePt1(null); setScalePt2(null) }
    if (e.key === 'Delete' && selectedId) { removePlanLine(selectedId); setSelected(null) }
    if (e.key === 'Shift') setOrthoMode(true)
  }, [selectedId, removePlanLine])

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Shift') setOrthoMode(false)
  }, [])

  // ── Периметр ──────────────────────────────────────────────────────────────
  function handleCloseContour() {
    if (contourIds.length < 3) return
    const pts = extractContourPoints(contourIds, lines)
    const areaM2 = polygonAreaM2(pts, scaleMmPx)
    const count = contours.filter(c => c.type === contourType).length + 1
    addContour({ lineIds: contourIds, areaM2, type: contourType, label: contourLabel.trim() || `${LINE_LABELS[contourType]} ${count}` })
    setContourIds([]); setContourLabel(''); setMode('draw')
  }

  // ── Параллельная линия ────────────────────────────────────────────────────
  function handleAddParallel() {
    const l = lines.find(l => l.id === selectedId)
    if (!l) return
    const distMm = parseFloat(parallelDist)
    if (!distMm || distMm <= 0) return
    const distPx = distMm / scaleMmPx
    // Вектор нормали
    const dx = l.x2 - l.x1; const dy = l.y2 - l.y1
    const len = Math.sqrt(dx*dx + dy*dy)
    const nx = -dy / len * distPx; const ny = dx / len * distPx
    const count = lines.filter(ln => ln.type === l.type).length + 1
    addPlanLine({
      x1: l.x1 + nx, y1: l.y1 + ny,
      x2: l.x2 + nx, y2: l.y2 + ny,
      type: l.type, lengthMm: l.lengthMm,
      label: `${LINE_LABELS[l.type]} ${count}`,
    })
    setShowParallelDialog(false)
  }

  // ── Масштаб ───────────────────────────────────────────────────────────────
  function applyScale() {
    if (!scalePt1 || !scalePt2) return
    const mm = parseFloat(scaleMmInput)
    if (!mm || mm <= 0) return
    const px = dist(scalePt1.x, scalePt1.y, scalePt2.x, scalePt2.y)
    if (px < 1) return
    setFloorPlanScale(mm / px)
    setShowScaleDialog(false); setScaleStep(0); setScalePt1(null); setScalePt2(null); setScaleMmInput('')
    setMode('draw')
  }

  function contourCentroid(c: PlanContour) {
    const pts = extractContourPoints(c.lineIds, lines)
    if (!pts.length) return null
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
  }

  const selectedLine  = lines.find(l => l.id === selectedId)
  const previewPt     = cursor ?? (drawing ? { x: drawing.x1, y: drawing.y1 } : null)
  const previewX2     = previewPt?.x ?? 0
  const previewY2     = previewPt?.y ?? 0
  const allPoints     = lines.flatMap(l => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ outline: 'none' }} tabIndex={0} onKeyDown={handleKeyDown} onKeyUp={handleKeyUp}>

      {/* ── Переключатель вид сверху / сбоку ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 10, borderRadius: 7, overflow: 'hidden', border: '1px solid #ddd', width: 'fit-content' }}>
        {([['top', '🗺 Вид сверху'], ['side', '📐 Вид сбоку']] as [PlanView, string][]).map(([v, label]) => (
          <button key={v} onClick={() => setPlanView(v)} style={{
            padding: '7px 18px', fontSize: 13, cursor: 'pointer', border: 'none',
            background: planView === v ? '#3a7bd5' : '#f5f5f5',
            color: planView === v ? '#fff' : '#555',
            fontWeight: planView === v ? 600 : 400,
          }}>{label}</button>
        ))}
      </div>

      {/* ══════════ ВИД СБОКУ ══════════ */}
      {planView === 'side' && (
        <div style={{ padding: 24, background: '#f9f9f9', border: '1px solid #eee', borderRadius: 8, color: '#888', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📐</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Вид сбоку</div>
          <div style={{ fontSize: 12 }}>Выберите конструкцию на виде сверху → нажмите "Вид сбоку"</div>
          {selectedLine && HAS_SIDE_VIEW.includes(selectedLine.type) && (
            <div style={{ marginTop: 16, padding: '10px 16px', background: '#fff', borderRadius: 6, border: `2px solid ${LINE_COLORS[selectedLine.type]}`, display: 'inline-block' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: LINE_COLORS[selectedLine.type] }}>{selectedLine.label}</div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>Длина: {fmtLen(selectedLine.lengthMm)}</div>
              <button style={{ marginTop: 8, padding: '5px 14px', fontSize: 12, borderRadius: 5, border: 'none', background: LINE_COLORS[selectedLine.type], color: '#fff', cursor: 'pointer' }}>
                Открыть расчёт →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════ ВИД СВЕРХУ ══════════ */}
      {planView === 'top' && (<>

        {/* ── Панель инструментов ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          {([['draw','✏️ Рисовать'],['select','✋ Двигать'],['contour','⬡ Периметр'],['scale','📐 Масштаб']] as [Mode,string][]).map(([m, label]) => (
            <button key={m} onClick={() => {
              setMode(m)
              setDrawing(null)
              dragRef.current = null
              dragMovedRef.current = false
              if (m !== 'select') setSelected(null)
            }}
              style={{
                padding: '5px 11px', fontSize: 12, borderRadius: 5, cursor: 'pointer', border: '1px solid #ccc',
                background: mode === m ? '#3a7bd5' : '#f5f5f5',
                color: mode === m ? '#fff' : '#333',
                fontWeight: mode === m ? 600 : 400,
              }}>{label}</button>
          ))}

          {/* ⊾ Прямой угол — только в режиме рисования */}
          {mode === 'draw' && (
            <button onClick={() => setOrthoMode(o => !o)}
              title="Прямой угол (Shift)"
              style={{
                padding: '5px 11px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                border: `2px solid ${orthoMode ? '#2d7d46' : '#ccc'}`,
                background: orthoMode ? '#e8f5e9' : '#fff',
                color: orthoMode ? '#2d7d46' : '#888',
                fontWeight: orthoMode ? 700 : 400,
              }}>⊾ 90°</button>
          )}

          <div style={{ width: 1, height: 22, background: '#ddd', margin: '0 2px' }} />

          {/* Тип линии */}
          {mode === 'draw' && (Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setDrawType(t)}
              style={{
                padding: '4px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                border: `2px solid ${LINE_COLORS[t]}`,
                background: drawType === t ? LINE_COLORS[t] : '#fff',
                color: drawType === t ? '#fff' : LINE_COLORS[t],
                fontWeight: drawType === t ? 600 : 400,
              }}>{label}</button>
          ))}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#999' }}>1px={scaleMmPx >= 10 ? `${Math.round(scaleMmPx)}мм` : `${scaleMmPx.toFixed(1)}мм`}</span>
            {lines.length > 0 && (
              <button onClick={() => { if (confirm('Очистить план?')) clearFloorPlan() }}
                style={{ padding: '4px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid #e57373', background: '#fff', color: '#e53935' }}>🗑</button>
            )}
          </div>
        </div>

        {/* ── Панель периметра ── */}
        {mode === 'contour' && (
          <div style={{ marginBottom: 8, padding: '10px 14px', background: '#f3f0ff', border: '1px solid #c5b8f5', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#5e35b1', marginBottom: 8, fontWeight: 600 }}>⬡ Тапайте по линиям чтобы выделить периметр</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {(Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
                <button key={t} onClick={() => setContourType(t)}
                  style={{ padding: '3px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: `2px solid ${LINE_COLORS[t]}`, background: contourType === t ? LINE_COLORS[t] : '#fff', color: contourType === t ? '#fff' : LINE_COLORS[t] }}>
                  {label}
                </button>
              ))}
              <input value={contourLabel} onChange={e => setContourLabel(e.target.value)}
                placeholder="Название (необязательно)"
                style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, width: 150 }} />
              <button onClick={handleCloseContour} disabled={contourIds.length < 3}
                style={{ padding: '5px 14px', fontSize: 12, borderRadius: 5, border: 'none', background: contourIds.length >= 3 ? '#5e35b1' : '#ccc', color: '#fff', fontWeight: 600, cursor: contourIds.length < 3 ? 'not-allowed' : 'pointer' }}>
                Замкнуть ({contourIds.length} лин.)
              </button>
              {contourIds.length > 0 && (
                <button onClick={() => setContourIds([])}
                  style={{ padding: '4px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid #ccc', background: '#fff', color: '#666' }}>Сбросить</button>
              )}
            </div>
          </div>
        )}

        {/* ── Подсказка ── */}
        <div style={{ fontSize: 11, color: '#999', marginBottom: 6, minHeight: 15 }}>
          {mode === 'draw'    && !drawing && `👆 Кликните — начало линии.${orthoMode ? ' ⊾ Режим прямых углов активен.' : ' Shift или ⊾ — прямые углы.'}`}
          {mode === 'draw'    &&  drawing && `👆 Кликните — конец линии.${orthoMode ? ' ⊾ 0°/45°/90°' : ''} Esc — отмена.`}
          {mode === 'select'  && !selectedId && '✋ Тяните линию чтобы переместить. Тяните за точку чтобы изменить.'}
          {mode === 'select'  &&  selectedId && '✋ Тяните. Или используйте кнопки ниже.'}
          {mode === 'contour' && '👆 Тапайте линии для выделения.'}
          {mode === 'scale'   && scaleStep === 0 && '📐 Кликните первую точку.'}
          {mode === 'scale'   && scaleStep === 1 && '📐 Кликните вторую точку.'}
        </div>

        {/* ── Холст ── */}
        <div ref={containerRef}
          style={{ border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', background: '#fafafa', cursor: mode === 'draw' ? 'crosshair' : mode === 'select' ? 'grab' : 'default', touchAction: 'none' }}>
          <Stage ref={stageRef} width={canvasW} height={CANVAS_H}
            onClick={handleStageClick} onTap={handleStageClick}
            onMouseMove={handleMouseMove} onTouchMove={handleTouchMove}
            onMouseUp={handlePointerUp} onTouchEnd={handlePointerUp}>
            <Layer>
              <Rect x={0} y={0} width={canvasW} height={CANVAS_H} fill="#fafafa" />
              {/* Сетка */}
              {Array.from({ length: Math.floor(canvasW / 50) + 1 }, (_, i) => (
                <Line key={`gv${i}`} points={[i*50,0,i*50,CANVAS_H]} stroke="#ebebeb" strokeWidth={1} />
              ))}
              {Array.from({ length: Math.floor(CANVAS_H / 50) + 1 }, (_, i) => (
                <Line key={`gh${i}`} points={[0,i*50,canvasW,i*50]} stroke="#ebebeb" strokeWidth={1} />
              ))}

              {/* Контуры */}
              {contours.map(c => {
                const pts = extractContourPoints(c.lineIds, lines)
                if (pts.length < 3) return null
                const color    = LINE_COLORS[c.type]
                const centroid = contourCentroid(c)
                return (
                  <Group key={c.id}>
                    <Line points={pts.flatMap(p => [p.x, p.y])} closed fill={color+'22'} stroke={color} strokeWidth={1.5} dash={[6,3]} />
                    {centroid && <>
                      <Text x={centroid.x-60} y={centroid.y-16} width={120} text={c.label} fontSize={11} fill={color} align="center" fontStyle="bold" />
                      <Text x={centroid.x-60} y={centroid.y-2}  width={120} text={fmtArea(c.areaM2)} fontSize={13} fill={color} align="center" fontStyle="bold" />
                    </>}
                  </Group>
                )
              })}

              {/* Линии */}
              {lines.map(l => {
                const isSelected = l.id === selectedId
                const inContour  = contourIds.includes(l.id)
                const color      = LINE_COLORS[l.type]
                const lw         = LINE_WIDTH[l.type]
                const mx         = (l.x1 + l.x2) / 2
                const my         = (l.y1 + l.y2) / 2
                const stroke     = inContour ? '#ff9800' : isSelected ? '#ff5722' : color
                return (
                  <Group key={l.id}
                    onMouseDown={e => handleLinePointerDown(l.id, e)}
                    onTouchStart={e => handleLinePointerDown(l.id, e)}>
                    {/* Широкая зона хита */}
                    <Line points={[l.x1,l.y1,l.x2,l.y2]} stroke="transparent" strokeWidth={24} hitStrokeWidth={24} />
                    {/* Видимая линия */}
                    <Line points={[l.x1,l.y1,l.x2,l.y2]} stroke={stroke} strokeWidth={inContour ? lw+3 : isSelected ? lw+2 : lw} lineCap="round" />
                    {/* Метка длины */}
                    <Text x={mx-30} y={my-16} width={60} text={fmtLen(l.lengthMm)} fontSize={10} fill={stroke} align="center" fontStyle="bold" />
                    {/* Концевые точки (drag-ручки) — только у выбранной */}
                    {isSelected && mode === 'select' ? <>
                      <Circle x={l.x1} y={l.y1} radius={9} fill="#fff" stroke={color} strokeWidth={2}
                        onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }}
                        onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }} />
                      <Circle x={l.x2} y={l.y2} radius={9} fill="#fff" stroke={color} strokeWidth={2}
                        onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }}
                        onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }} />
                    </> : <>
                      <Circle x={l.x1} y={l.y1} radius={5} fill={stroke} />
                      <Circle x={l.x2} y={l.y2} radius={5} fill={stroke} />
                    </>}
                  </Group>
                )
              })}

              {/* Превью рисования */}
              {mode === 'draw' && drawing && previewPt && (
                <>
                  <Line points={[drawing.x1,drawing.y1,previewX2,previewY2]}
                    stroke={LINE_COLORS[drawType]} strokeWidth={LINE_WIDTH[drawType]} dash={[6,4]} opacity={0.6} lineCap="round" />
                  {previewLabel(previewX2, previewY2) && (
                    <Text x={(drawing.x1+previewX2)/2-30} y={(drawing.y1+previewY2)/2-16}
                      width={60} text={previewLabel(previewX2,previewY2)}
                      fontSize={10} fill={LINE_COLORS[drawType]} align="center" fontStyle="bold" />
                  )}
                </>
              )}

              {/* Курсор снапа */}
              {cursor && mode === 'draw' && (
                <Circle x={cursor.x} y={cursor.y} radius={6}
                  stroke={LINE_COLORS[drawType]} strokeWidth={1.5} fill="rgba(255,255,255,0.7)" />
              )}

              {/* Точки масштаба */}
              {scalePt1 && <Circle x={scalePt1.x} y={scalePt1.y} radius={7} fill="#ff9800" />}
              {scalePt2 && <>
                <Circle x={scalePt2.x} y={scalePt2.y} radius={7} fill="#ff9800" />
                <Line points={[scalePt1!.x,scalePt1!.y,scalePt2.x,scalePt2.y]} stroke="#ff9800" strokeWidth={2} dash={[4,3]} />
              </>}

              {/* Точки снапа */}
              {mode === 'draw' && allPoints.map((pt,i) => (
                <Circle key={i} x={pt.x} y={pt.y} radius={3} fill="transparent" stroke="#bbb" strokeWidth={1} />
              ))}
            </Layer>
          </Stage>
        </div>

        {/* ── Панель выбранной линии ── */}
        {selectedLine && mode === 'select' && (
          <div style={{ marginTop: 8, padding: '10px 14px', background: '#fff', border: `2px solid ${LINE_COLORS[selectedLine.type]}`, borderRadius: 8, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: LINE_COLORS[selectedLine.type] }}>{LINE_LABELS[selectedLine.type]}</span>
            <span style={{ fontSize: 13 }}>{fmtLen(selectedLine.lengthMm)}</span>
            <select value={selectedLine.type} onChange={e => updatePlanLine(selectedLine.id, { type: e.target.value as PlanLineType })}
              style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #ccc' }}>
              {(Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
                <option key={t} value={t}>{label}</option>
              ))}
            </select>

            {/* Параллельная */}
            <button onClick={() => setShowParallelDialog(true)}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 5, border: '1px solid #3a7bd5', background: '#fff', color: '#3a7bd5', cursor: 'pointer' }}>
              // Параллельная
            </button>

            {HAS_SIDE_VIEW.includes(selectedLine.type) && (
              <button onClick={() => setPlanView('side')}
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 5, border: 'none', background: LINE_COLORS[selectedLine.type], color: '#fff', cursor: 'pointer' }}>
                📐 Вид сбоку →
              </button>
            )}
            <button onClick={() => { removePlanLine(selectedLine.id); setSelected(null) }}
              style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 12, borderRadius: 4, border: '1px solid #e57373', background: '#fff', color: '#e53935', cursor: 'pointer' }}>
              🗑 Удалить
            </button>
          </div>
        )}

        {/* ── Контуры ── */}
        {contours.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Замкнутые контуры:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {contours.map(c => (
                <div key={c.id} style={{ padding: '4px 12px', fontSize: 11, borderRadius: 5, border: `1.5px solid ${LINE_COLORS[c.type]}`, background: '#fff', color: LINE_COLORS[c.type], display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{c.label}</span>
                  <span>{fmtArea(c.areaM2)}</span>
                  <span onClick={() => removeContour(c.id)} style={{ cursor: 'pointer', color: '#aaa' }}>✕</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Легенда ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, fontSize: 11, color: '#666' }}>
          {(Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ display: 'inline-block', width: 18, height: 3, background: LINE_COLORS[t], borderRadius: 2 }} />
              {label}
            </span>
          ))}
        </div>

      </>)}

      {/* ── Диалог параллельной линии ── */}
      {showParallelDialog && selectedLine && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: 280, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>// Параллельная линия</div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>
              Расстояние от <b>{selectedLine.label}</b>:
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input autoFocus type="number" value={parallelDist} onChange={e => setParallelDist(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddParallel()}
                style={{ flex: 1, padding: '8px 10px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6 }} />
              <span style={{ fontSize: 13, color: '#888' }}>мм</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={handleAddParallel}
                style={{ flex: 1, padding: 8, background: '#3a7bd5', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                Добавить
              </button>
              <button onClick={() => setShowParallelDialog(false)}
                style={{ flex: 1, padding: 8, background: '#f5f5f5', color: '#333', border: '1px solid #ccc', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Диалог масштаба ── */}
      {showScaleDialog && scalePt1 && scalePt2 && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: 300, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📐 Масштаб</div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>
              Расстояние: <b>{Math.round(dist(scalePt1.x, scalePt1.y, scalePt2.x, scalePt2.y))} px</b><br />Реальная длина (мм):
            </div>
            <input autoFocus type="number" value={scaleMmInput} onChange={e => setScaleMmInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyScale()}
              placeholder="например 3000"
              style={{ width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={applyScale} style={{ flex: 1, padding: 8, background: '#3a7bd5', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Применить</button>
              <button onClick={() => { setShowScaleDialog(false); setScaleStep(0); setScalePt1(null); setScalePt2(null) }}
                style={{ flex: 1, padding: 8, background: '#f5f5f5', color: '#333', border: '1px solid #ccc', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
