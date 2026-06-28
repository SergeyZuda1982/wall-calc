/**
 * FloorPlan — план объекта. Рефакторинг UI: три колонки.
 *
 * Левая панель: список типов конструкций, инструменты, дерево конструкций
 * Центр: тулбар + холст + таблица конструкций
 * Правая панель: параметры выбранной конструкции (появляется при выборе)
 *
 * Логика рисования/редактирования — без изменений.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Stage, Layer, Line, Circle, Text, Rect, Group } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useProjectStore } from './store/useProjectStore'
import type { PlanLine, PlanLineType, PlanLineSpec, PlanView, PlanContour } from './types'
import { getLineVisual, getContourFill } from './data/constructionTaxonomy'
import ConstructionSpecSelector from './components/ConstructionSpecSelector'

// ─── Константы ───────────────────────────────────────────────────────────────

const CANVAS_H   = 520
const SNAP_PX    = 18
const DRAG_THRESHOLD = 4

const LINE_COLORS: Record<PlanLineType, string> = {
  wall_new:      '#e53935',
  wall_lining:   '#1e88e5',
  wall_existing: '#78909c',
  ceiling:       '#8e24aa',
  floor:         '#6d4c41',
}
const LINE_LABELS: Record<PlanLineType, string> = {
  wall_new:      'Перегородки',
  wall_lining:   'Облицовка стен',
  wall_existing: 'Сущ. конструкции',
  ceiling:       'Потолки',
  floor:         'Полы',
}
const LINE_LABELS_SHORT: Record<PlanLineType, string> = {
  wall_new:      'Перегородка',
  wall_lining:   'Облицовка',
  wall_existing: 'Сущ. конструкция',
  ceiling:       'Потолок',
  floor:         'Пол',
}
const LINE_ICONS: Record<PlanLineType, string> = {
  wall_new:      '▧',
  wall_lining:   '▤',
  ceiling:       '▨',
  floor:         '▦',
  wall_existing: '▩',
}
const LINE_WIDTH: Record<PlanLineType, number> = {
  wall_new: 4, wall_lining: 3, wall_existing: 5, ceiling: 2, floor: 2,
}
const HAS_SIDE_VIEW: PlanLineType[] = ['wall_new', 'wall_lining', 'floor']

type Mode = 'draw' | 'select' | 'contour' | 'scale' | 'erase'

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}
function lineLengthMm(x1: number, y1: number, x2: number, y2: number, s: number) {
  return Math.round(dist(x1, y1, x2, y2) * s)
}

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

function snapOrtho(x1: number, y1: number, x: number, y: number): { x: number; y: number } {
  const dx = x - x1
  const dy = y - y1
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  const len   = Math.sqrt(dx * dx + dy * dy)
  const snapped = Math.round(angle / 45) * 45
  const rad = snapped * Math.PI / 180
  return { x: x1 + Math.cos(rad) * len, y: y1 + Math.sin(rad) * len }
}

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

/**
 * Размерная линия в чертёжном стиле (засечки, длина в мм).
 * offsetPx — расстояние от оси линии до размерной линии.
 */
function DimLineShapes({ x1, y1, x2, y2, lengthMm, offsetPx, dimColor }: {
  x1: number; y1: number; x2: number; y2: number
  lengthMm: number; offsetPx: number; dimColor: string
}) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx*dx + dy*dy)
  if (len < 24) return null
  // Правая нормаль: (dy/len, -dx/len) → для горизонтальных линий указывает вверх
  const nx = dy / len, ny = -dx / len
  const d1x = x1 + nx * offsetPx, d1y = y1 + ny * offsetPx
  const d2x = x2 + nx * offsetPx, d2y = y2 + ny * offsetPx
  // Засечки ±5px вдоль направления линии
  const tx = dx / len * 5, ty = dy / len * 5
  const mx = (d1x + d2x) / 2, my = (d1y + d2y) / 2
  return (
    <>
      <Line points={[d1x, d1y, d2x, d2y]} stroke={dimColor} strokeWidth={1} listening={false} />
      <Line points={[d1x - tx, d1y - ty, d1x + tx, d1y + ty]} stroke={dimColor} strokeWidth={1} listening={false} />
      <Line points={[d2x - tx, d2y - ty, d2x + tx, d2y + ty]} stroke={dimColor} strokeWidth={1} listening={false} />
      <Text x={mx - 30} y={my - 13} width={60} text={`${lengthMm}`} fontSize={9} fill={dimColor} align="center" listening={false} />
    </>
  )
}

/** Генерирует список [x1,y1,x2,y2] для 45° штриховки внутри AABB прямоугольника. */
function calcHatch(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx2: number, dy2: number, step: number): number[][] {
  const minX = Math.min(ax, bx, cx, dx2)
  const maxX = Math.max(ax, bx, cx, dx2)
  const minY = Math.min(ay, by, cy, dy2)
  const maxY = Math.max(ay, by, cy, dy2)
  const result: number[][] = []
  // Линии x − y = c (45° к горизонтали, направление ↘)
  for (let c = minX - maxY - step; c <= maxX - minY + step; c += step) {
    const pts: [number, number][] = []
    const tryAdd = (x: number, y: number) => {
      if (x >= minX - 0.5 && x <= maxX + 0.5 && y >= minY - 0.5 && y <= maxY + 0.5)
        pts.push([x, y])
    }
    tryAdd(minX, minX - c)
    tryAdd(maxX, maxX - c)
    tryAdd(minY + c, minY)
    tryAdd(maxY + c, maxY)
    const unique: [number, number][] = []
    for (const p of pts) {
      if (!unique.some(u => Math.abs(u[0] - p[0]) < 0.5 && Math.abs(u[1] - p[1]) < 0.5)) unique.push(p)
    }
    if (unique.length >= 2) result.push([unique[0][0], unique[0][1], unique[1][0], unique[1][1]])
  }
  return result
}

// Генерация имени конструкции (П-1, П-2, О-1...)
const TYPE_PREFIX: Record<PlanLineType, string> = {
  wall_new: 'П', wall_lining: 'О', wall_existing: 'С', ceiling: 'Пт', floor: 'Пл',
}

function genLabel(type: PlanLineType, lines: PlanLine[]): string {
  const prefix = TYPE_PREFIX[type]
  const count = lines.filter(l => l.type === type).length + 1
  return `${prefix}-${count}`
}

// ─── Стили ───────────────────────────────────────────────────────────────────

const LEFT_W = 220
const RIGHT_W = 300

const leftPanelStyle: React.CSSProperties = {
  width: LEFT_W,
  minWidth: LEFT_W,
  maxWidth: LEFT_W,
  flexShrink: 0,
  background: '#1e2433',
  color: '#cdd6f4',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  borderRight: '1px solid #2a3045',
}

const rightPanelStyle: React.CSSProperties = {
  width: RIGHT_W,
  minWidth: RIGHT_W,
  maxWidth: RIGHT_W,
  flexShrink: 0,
  background: '#fff',
  borderLeft: '1px solid #e0e4ee',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: '#6c7a99',
  letterSpacing: 1.2,
  textTransform: 'uppercase' as const,
  padding: '12px 14px 5px',
}

type DragState =
  | { kind: 'line'; id: string; startPx: number; startPy: number; origX1: number; origY1: number; origX2: number; origY2: number }
  | { kind: 'end1'; id: string; startPx: number; startPy: number }
  | { kind: 'end2'; id: string; startPx: number; startPy: number }
  | null

// ─── Компонент ───────────────────────────────────────────────────────────────

export default function FloorPlan() {
  const {
    floorPlan, addPlanLine, updatePlanLine, removePlanLine,
    setFloorPlanScale, clearFloorPlan,
    addContour, addRoom,
  } = useProjectStore()

  const lines     = floorPlan?.lines    ?? []
  const contours  = floorPlan?.contours ?? []
  const rooms     = floorPlan?.rooms    ?? []
  const scaleMmPx = floorPlan?.scaleMmPerPx ?? 10

  // ── UI-состояние ──────────────────────────────────────────────────────────
  const [planView, setPlanView]         = useState<PlanView>('top')
  const [mode, setMode]                 = useState<Mode>('draw')
  const [drawType, setDrawType]         = useState<PlanLineType>('wall_new')
  const [orthoMode, setOrthoMode]       = useState(false)
  const [drawing, setDrawing]           = useState<{ x1: number; y1: number } | null>(null)
  const [cursor, setCursor]             = useState<{ x: number; y: number } | null>(null)
  const [selectedId, setSelected]       = useState<string | null>(null)
  const [contourIds, setContourIds]     = useState<string[]>([])
  const [contourType, _setContourType]   = useState<PlanLineType>('ceiling')
  const [contourLabel, setContourLabel] = useState('')
  const [contourSpec, setContourSpec]   = useState<PlanLineSpec | undefined>(undefined)
  const [eraseIds, setEraseIds]         = useState<string[]>([])
  const [showParallelDialog, setShowParallelDialog] = useState(false)
  const [parallelDist, setParallelDist]             = useState('100')
  const [rightTab, setRightTab]         = useState<'construction' | 'finish' | 'materials' | 'calc'>('construction')
  const [hoveredId, setHoveredId]       = useState<string | null>(null)
  const [snapActive, setSnapActive]     = useState(false)
  const [inspectorId, setInspectorId]   = useState<string | null>(null)
  // Цепочка рисования периметра
  const [chainStartPt, setChainStartPt] = useState<{ x: number; y: number } | null>(null)
  const [chainLineIds, setChainLineIds] = useState<string[]>([])

  const dragRef      = useRef<DragState>(null)
  const dragMovedRef = useRef(false)
  const lineWasClickedRef = useRef(false)

  // Масштаб
  const [scaleStep, setScaleStep]             = useState<0 | 1 | 2>(0)
  const [scalePt1, setScalePt1]               = useState<{ x: number; y: number } | null>(null)
  const [scalePt2, setScalePt2]               = useState<{ x: number; y: number } | null>(null)
  const [scaleMmInput, setScaleMmInput]       = useState('')
  const [showScaleDialog, setShowScaleDialog] = useState(false)

  // Адаптивная ширина холста
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef     = useRef<any>(null)
  const [canvasW, setCanvasW] = useState(600)
  useEffect(() => {
    function update() {
      if (containerRef.current) setCanvasW(containerRef.current.offsetWidth)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // ── Переключение режима ────────────────────────────────────────────────────
  function switchMode(m: Mode) {
    setMode(m)
    setDrawing(null)
    setChainStartPt(null)
    setChainLineIds([])
    dragRef.current = null
    dragMovedRef.current = false
    if (m !== 'select') setSelected(null)
    if (m !== 'erase') setEraseIds([])
  }

  function confirmErase(ids: string[]) {
    ids.forEach(id => removePlanLine(id))
    setEraseIds([])
    switchMode('select')
  }

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

  function applySnap(x: number, y: number, excludeId?: string): { x: number; y: number } {
    const snapped = snapPoint(x, y, lines, excludeId)
    if (orthoMode && drawing && !snapped.snapped) {
      return snapOrtho(drawing.x1, drawing.y1, snapped.x, snapped.y)
    }
    return snapped
  }

  function previewLabel(x2: number, y2: number) {
    if (!drawing) return ''
    const mm = lineLengthMm(drawing.x1, drawing.y1, x2, y2, scaleMmPx)
    if (mm < 10) return ''
    return fmtLen(mm)
  }

  // ── Движение (mouse + touch) ──────────────────────────────────────────────
  function handleMove(rawX: number, rawY: number) {
    if (dragRef.current && mode === 'select') {
      const dr = dragRef.current
      const dx = rawX - dr.startPx
      const dy = rawY - dr.startPy
      if (!dragMovedRef.current && Math.sqrt(dx*dx + dy*dy) < DRAG_THRESHOLD) return
      dragMovedRef.current = true

      if (dr.kind === 'line') {
        const s = snapPoint(dr.origX1 + dx, dr.origY1 + dy, lines, dr.id)
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
    const snappedInfo = snapPoint(rawX, rawY, lines)
    // В draw-режиме: дополнительно проверяем снап к началу цепочки (замыкание)
    const snapToChainStart =
      mode === 'draw' && drawing && chainStartPt &&
      dist(rawX, rawY, chainStartPt.x, chainStartPt.y) <= SNAP_PX
    const pt = snapToChainStart
      ? { x: chainStartPt!.x, y: chainStartPt!.y, snapped: true }
      : (orthoMode && drawing && !snappedInfo.snapped)
        ? snapOrtho(drawing.x1, drawing.y1, snappedInfo.x, snappedInfo.y)
        : snappedInfo
    setCursor({ x: pt.x, y: pt.y })
    setSnapActive(snappedInfo.snapped || !!snapToChainStart)
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

  const handlePointerUp = useCallback(() => {
    if (dragRef.current && !dragMovedRef.current && mode === 'select') {
      setSelected(dragRef.current.id)
    }
    dragRef.current = null
    dragMovedRef.current = false
  }, [mode])

  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (dragMovedRef.current) return
    if (lineWasClickedRef.current) {
      lineWasClickedRef.current = false
      return
    }
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

      // Проверка: курсор снапнулся к началу цепочки → замыкание
      const closingChain =
        drawing && chainStartPt &&
        dist(pt.x, pt.y, chainStartPt.x, chainStartPt.y) <= SNAP_PX

      if (!drawing) {
        // Начало новой линии — запоминаем стартовую точку цепочки
        setDrawing({ x1: pt.x, y1: pt.y })
        if (!chainStartPt) setChainStartPt({ x: pt.x, y: pt.y })
      } else if (closingChain) {
        // Замыкание: добавляем последний отрезок до startPt
        const d = dist(drawing.x1, drawing.y1, chainStartPt!.x, chainStartPt!.y)
        if (d >= 5) {
          const lengthMm = lineLengthMm(drawing.x1, drawing.y1, chainStartPt!.x, chainStartPt!.y, scaleMmPx)
          const label = genLabel(drawType, lines)
          addPlanLine({ x1: drawing.x1, y1: drawing.y1, x2: chainStartPt!.x, y2: chainStartPt!.y, type: drawType, lengthMm, label })
        }
        // После addPlanLine lines ещё не обновились — используем chainLineIds + новая линия
        // Собираем все id цепочки через setTimeout (после ре-рендера)
        const finalLineIds = [...chainLineIds]
        // Создаём помещение если это wall_existing
        if (drawType === 'wall_existing' && finalLineIds.length >= 2) {
          setTimeout(() => {
            // Берём актуальные линии из store
            const allLines = useProjectStore.getState().floorPlan?.lines ?? []
            const chainLines = finalLineIds.map(id => allLines.find(l => l.id === id)).filter(Boolean) as PlanLine[]
            // Добавляем замыкающую линию (последняя добавленная)
            const lastLine = allLines[allLines.length - 1]
            const roomLines = lastLine ? [...chainLines, lastLine] : chainLines
            const pts = roomLines.map(l => ({ x: l.x1, y: l.y1 }))
            const area = polygonAreaM2(pts, scaleMmPx)
            const perimeter = roomLines.reduce((s, l) => s + l.lengthMm, 0)
            const count = (useProjectStore.getState().floorPlan?.rooms ?? []).length + 1
            addRoom({ lineIds: roomLines.map(l => l.id), areaM2: area, perimeterMm: perimeter, label: `Помещение ${count}` })
          }, 0)
        }
        // Сброс цепочки
        setDrawing(null)
        setChainStartPt(null)
        setChainLineIds([])
      } else {
        const d = dist(drawing.x1, drawing.y1, pt.x, pt.y)
        if (d < 5) { setDrawing(null); setChainStartPt(null); setChainLineIds([]); return }
        const lengthMm = lineLengthMm(drawing.x1, drawing.y1, pt.x, pt.y, scaleMmPx)
        const label = genLabel(drawType, lines)
        // Добавляем линию и запоминаем её id через setTimeout
        addPlanLine({ x1: drawing.x1, y1: drawing.y1, x2: pt.x, y2: pt.y, type: drawType, lengthMm, label })
        setTimeout(() => {
          const allLines = useProjectStore.getState().floorPlan?.lines ?? []
          const newLine = allLines[allLines.length - 1]
          if (newLine) setChainLineIds(prev => [...prev, newLine.id])
        }, 0)
        setDrawing({ x1: pt.x, y1: pt.y })
      }
      return
    }
    if (mode === 'select') setSelected(null)
  }, [mode, drawing, lines, scaleMmPx, drawType, scaleStep, orthoMode, addPlanLine])

  const handleLinePointerDown = useCallback((id: string, e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true
    lineWasClickedRef.current = true

    const pos = getPos(e)
    if (!pos) return

    if (mode === 'erase') {
      setEraseIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
      return
    }
    if (mode === 'contour') {
      setContourIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
      return
    }
    if (mode === 'select') {
      startDragLine(id, 'line', pos.x, pos.y)
    }
    setSelected(id)
  }, [mode, lines])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (mode === 'erase') {
        setEraseIds([])
        switchMode('select')
      } else {
        setDrawing(null); setSelected(null); setScaleStep(0); setScalePt1(null); setScalePt2(null)
      }
    }
    if (e.key === 'Delete') {
      if (mode === 'erase' && eraseIds.length > 0) {
        confirmErase(eraseIds)
      } else if (selectedId) {
        removePlanLine(selectedId)
        setSelected(null)
      }
    }
    if (e.key === 'r' || e.key === 'R') {
      if (mode === 'erase') {
        if (eraseIds.length > 0) confirmErase(eraseIds)
        else switchMode('select')
      } else {
        switchMode('erase')
      }
    }
    if (e.key === 'Shift') setOrthoMode(true)
  }, [selectedId, removePlanLine, mode, eraseIds])

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Shift') setOrthoMode(false)
  }, [])

  function handleCloseContour() {
    if (contourIds.length < 3) return
    const pts = extractContourPoints(contourIds, lines)
    const areaM2 = polygonAreaM2(pts, scaleMmPx)
    const count = contours.filter(c => c.type === contourType).length + 1
    addContour({ lineIds: contourIds, areaM2, type: contourType, label: contourLabel.trim() || `${LINE_LABELS_SHORT[contourType]} ${count}`, spec: contourSpec })
    setContourIds([]); setContourLabel(''); setContourSpec(undefined); switchMode('draw')
  }

  function handleAddParallel() {
    const l = lines.find(l => l.id === selectedId)
    if (!l) return
    const distMm = parseFloat(parallelDist)
    if (!distMm || distMm <= 0) return
    const distPx = distMm / scaleMmPx
    const dx = l.x2 - l.x1; const dy = l.y2 - l.y1
    const len = Math.sqrt(dx*dx + dy*dy)
    const nx = -dy / len * distPx; const ny = dx / len * distPx
    const label = genLabel(l.type, lines)
    addPlanLine({
      x1: l.x1 + nx, y1: l.y1 + ny,
      x2: l.x2 + nx, y2: l.y2 + ny,
      type: l.type, lengthMm: l.lengthMm,
      label,
    })
    setShowParallelDialog(false)
  }

  function applyScale() {
    if (!scalePt1 || !scalePt2) return
    const mm = parseFloat(scaleMmInput)
    if (!mm || mm <= 0) return
    const px = dist(scalePt1.x, scalePt1.y, scalePt2.x, scalePt2.y)
    if (px < 1) return
    setFloorPlanScale(mm / px)
    setShowScaleDialog(false); setScaleStep(0); setScalePt1(null); setScalePt2(null); setScaleMmInput('')
    switchMode('draw')
  }

  function contourCentroid(c: PlanContour) {
    const pts = extractContourPoints(c.lineIds, lines)
    if (!pts.length) return null
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
  }

  const selectedLine  = lines.find(l => l.id === selectedId)
  const inspectorLine = lines.find(l => l.id === inspectorId)
  const previewPt    = cursor ?? (drawing ? { x: drawing.x1, y: drawing.y1 } : null)
  const previewX2    = previewPt?.x ?? 0
  const previewY2    = previewPt?.y ?? 0
  const allPoints    = lines.flatMap(l => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }])

  // ── Статус конструкций ────────────────────────────────────────────────────
  // Статус хранится в label через суффикс или через будущие поля
  // Сейчас используем простую заглушку — все "Не начата"
  const getStatus = (_id: string) => 'none' as 'none' | 'in_progress' | 'done'
  const statusDot = (s: 'none' | 'in_progress' | 'done') =>
    s === 'done' ? '●' : s === 'in_progress' ? '◐' : '○'
  const statusColor = (s: 'none' | 'in_progress' | 'done') =>
    s === 'done' ? '#4caf50' : s === 'in_progress' ? '#ff9800' : '#bbb'

  // ── Подсчёт площади выбранной линии ───────────────────────────────────────
  function calcLineArea(l: PlanLine): number {
    // Площадь = длина × высота (если высота задана через spec или дефолт 3000мм)
    const h = 3000 // дефолт
    return Math.round(l.lengthMm * h / 1_000_000 * 100) / 100
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{ outline: 'none', display: 'flex', flexDirection: 'column', height: '100%' }}
      tabIndex={0} onKeyDown={handleKeyDown} onKeyUp={handleKeyUp}
    >
      {/* ── Шапка плана ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', background: '#fff',
        borderBottom: '1px solid #e0e4ee',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1e2433' }}>План объекта</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#888' }}>
          Масштаб: {scaleMmPx >= 10 ? `${Math.round(scaleMmPx)}мм/рх` : `${scaleMmPx.toFixed(1)}мм/рх`}
        </span>
        {/* Undo/Redo placeholders */}
        <button title="Отменить" style={toolBtnStyle(false)}>↩</button>
        <button title="Повторить" style={toolBtnStyle(false)}>↪</button>
        <button onClick={() => { }} style={{ ...toolBtnStyle(false), minWidth: 90 }}>
          Экспорт ▾
        </button>
        {lines.length > 0 && (
          <button onClick={() => { if (confirm('Очистить план?')) clearFloorPlan() }}
            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #e57373', background: '#fff', color: '#e53935', borderRadius: 5, cursor: 'pointer' }}>
            🗑
          </button>
        )}
      </div>

      {/* ── Трёхколоночный layout ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* ════════════════════ ЛЕВАЯ ПАНЕЛЬ ════════════════════ */}
        <div style={leftPanelStyle}>

          {/* Конструкции */}
          <div style={sectionHeaderStyle}>Конструкции</div>
          {(Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
            <button key={t}
              onClick={() => { setDrawType(t); switchMode('draw') }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', width: '100%', textAlign: 'left',
                borderLeft: (mode === 'draw' && drawType === t) ? `3px solid ${LINE_COLORS[t]}` : '3px solid transparent',
                borderRadius: 0,
                color: (mode === 'draw' && drawType === t) ? '#fff' : '#8a9ac8',
                backgroundColor: (mode === 'draw' && drawType === t) ? 'rgba(255,255,255,0.07)' : 'transparent',
              }}>
              <span style={{ fontSize: 15, color: LINE_COLORS[t] }}>{LINE_ICONS[t]}</span>
              <span style={{ fontSize: 12, fontWeight: (mode === 'draw' && drawType === t) ? 600 : 400 }}>{label}</span>
            </button>
          ))}

          <div style={{ height: 1, background: '#2a3045', margin: '8px 0' }} />

          {/* Инструменты */}
          <div style={sectionHeaderStyle}>Инструменты</div>
          {([
            ['draw',    '✏', 'Рисовать'],
            ['select',  '✥', 'Двигать'],
            ['contour', '⬡', 'Замкнуть контур'],
            ['scale',   '⬛', 'Масштаб'],
          ] as [Mode, string, string][]).map(([m, icon, label]) => (
            <button key={m} onClick={() => switchMode(m)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', width: '100%', textAlign: 'left',
                borderLeft: mode === m ? '3px solid #7c8fcf' : '3px solid transparent',
                color: mode === m ? '#fff' : '#8a9ac8',
                backgroundColor: mode === m ? 'rgba(255,255,255,0.07)' : 'transparent',
                fontSize: 12,
              }}>
              <span style={{ fontSize: 14, minWidth: 16, textAlign: 'center' }}>{icon}</span>
              <span style={{ fontWeight: mode === m ? 600 : 400 }}>{label}</span>
            </button>
          ))}

          {/* Параллельная и Вид сбоку */}
          {selectedLine && (
            <>
              <button onClick={() => setShowParallelDialog(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 14px', background: 'transparent', border: 'none',
                  cursor: 'pointer', width: '100%', textAlign: 'left',
                  borderLeft: '3px solid transparent', color: '#8a9ac8', fontSize: 12,
                }}>
                <span style={{ fontSize: 14, minWidth: 16, textAlign: 'center' }}>//</span>
                <span>Параллельная</span>
              </button>
              {HAS_SIDE_VIEW.includes(selectedLine.type) && (
                <button onClick={() => setPlanView(planView === 'side' ? 'top' : 'side')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 14px', background: 'transparent', border: 'none',
                    cursor: 'pointer', width: '100%', textAlign: 'left',
                    borderLeft: planView === 'side' ? '3px solid #7c8fcf' : '3px solid transparent',
                    color: planView === 'side' ? '#fff' : '#8a9ac8', fontSize: 12,
                  }}>
                  <span style={{ fontSize: 14, minWidth: 16, textAlign: 'center' }}>⊡</span>
                  <span>Вид сбоку</span>
                </button>
              )}
            </>
          )}

          <div style={{ height: 1, background: '#2a3045', margin: '8px 0' }} />

          {/* Дерево конструкций */}
          <div style={sectionHeaderStyle}>Дерево конструкций</div>
          {lines.length === 0 && (
            <div style={{ padding: '6px 14px', fontSize: 11, color: '#4a5578' }}>
              Нет конструкций
            </div>
          )}
          {lines.map((l) => {
            const isSelected = l.id === selectedId
            return (
              <button key={l.id}
                onClick={() => { setSelected(l.id); setMode('select') }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
                  padding: '7px 14px', background: isSelected ? 'rgba(255,255,255,0.09)' : 'transparent',
                  border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                  borderLeft: isSelected ? `3px solid ${LINE_COLORS[l.type]}` : '3px solid transparent',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: LINE_COLORS[l.type], flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#cdd6f4', flex: 1 }}>{l.label}</span>
                  <span style={{ fontSize: 10, color: '#4a5578' }}>{fmtLen(l.lengthMm)}</span>
                </div>
                {l.spec?.material && (
                  <span style={{ fontSize: 10, color: '#5a6a8a', paddingLeft: 16 }}>
                    {l.spec.material}{l.spec.subtype ? ` · ${l.spec.subtype}` : ''}
                  </span>
                )}
              </button>
            )
          })}

          {/* Кнопка удалить */}
          {selectedLine && (
            <div style={{ marginTop: 'auto', padding: '10px 14px', borderTop: '1px solid #2a3045' }}>
              <button onClick={() => { removePlanLine(selectedLine.id); setSelected(null) }}
                style={{
                  width: '100%', padding: '7px 14px', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                  border: '1px solid #4a2020', borderRadius: 6,
                  background: 'rgba(229,57,53,0.12)', color: '#ef9a9a', cursor: 'pointer',
                }}>
                🗑 Удалить конструкцию
              </button>
            </div>
          )}
        </div>

        {/* ════════════════════ ЦЕНТР ════════════════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#f5f7fb' }}>

          {/* ── Центральный тулбар ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 12px', background: '#fff',
            borderBottom: '1px solid #e0e4ee', flexWrap: 'wrap',
          }}>
            {/* Прямой угол */}
            <button onClick={() => { setOrthoMode(o => !o); if (mode !== 'draw') switchMode('draw') }}
              title="Прямой угол (Shift)" style={toolBtnStyle(orthoMode)}>
              ⊾ 90°
            </button>

            {/* Параллельная */}
            <button onClick={() => selectedLine && setShowParallelDialog(true)}
              disabled={!selectedLine}
              style={toolBtnStyle(false, !selectedLine)}>
              // Параллельная
            </button>

            {/* Замкнуть */}
            <button onClick={handleCloseContour}
              disabled={contourIds.length < 3}
              style={toolBtnStyle(mode === 'contour', contourIds.length < 3)}>
              ○ Замкнуть
            </button>

            {/* Вид сбоку */}
            <button onClick={() => setPlanView(planView === 'side' ? 'top' : 'side')}
              disabled={!selectedLine}
              style={toolBtnStyle(planView === 'side', !selectedLine)}>
              ⊡ Вид сбоку
            </button>

            <div style={{ width: 1, height: 20, background: '#dde', margin: '0 2px' }} />

            {/* Слои */}
            <button style={toolBtnStyle(false)}>Все слои ▾</button>

            {/* Масштаб + */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
              {mode === 'scale' && (
                <span style={{ fontSize: 11, color: '#e67e22', fontWeight: 600 }}>
                  {scaleStep === 0 ? '📐 Кликните точку 1' : '📐 Кликните точку 2'}
                </span>
              )}
              {mode === 'erase' && eraseIds.length > 0 && (
                <button onClick={() => confirmErase(eraseIds)}
                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 4, border: 'none', background: '#e53935', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                  Удалить ({eraseIds.length})
                </button>
              )}
              {mode === 'contour' && (
                <span style={{ fontSize: 11, color: '#5e35b1' }}>
                  ⬡ Выделено линий: {contourIds.length}
                </span>
              )}
            </div>
          </div>

          {/* ── Холст ── */}
          <div style={{ flex: 1, overflow: 'hidden', padding: 12, minHeight: CANVAS_H + 24 }}>
            <div ref={containerRef}
              style={{
                border: '1px solid #dde', borderRadius: 8, overflow: 'hidden', background: '#fafafa',
                cursor: mode === 'draw' ? 'crosshair' : mode === 'select' ? 'grab' : mode === 'erase' ? 'pointer' : 'default',
                touchAction: 'none',
                boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
              }}>
              <Stage ref={stageRef} width={canvasW} height={CANVAS_H}
                onClick={handleStageClick} onTap={handleStageClick}
                onMouseMove={handleMouseMove} onTouchMove={handleTouchMove}
                onMouseUp={handlePointerUp} onTouchEnd={handlePointerUp}>
                <Layer>
                  <Rect x={0} y={0} width={canvasW} height={CANVAS_H} fill="#fafafa" />
                  {/* Сетка */}
                  {Array.from({ length: Math.floor(canvasW / 50) + 1 }, (_, i) => (
                    <Line key={`gv${i}`} points={[i*50,0,i*50,CANVAS_H]} stroke="#ebebeb" strokeWidth={1} listening={false} />
                  ))}
                  {Array.from({ length: Math.floor(CANVAS_H / 50) + 1 }, (_, i) => (
                    <Line key={`gh${i}`} points={[0,i*50,canvasW,i*50]} stroke="#ebebeb" strokeWidth={1} listening={false} />
                  ))}

                  {/* Помещения (замкнутые периметры wall_existing) */}
                  {rooms.map(room => {
                    const roomLines = room.lineIds
                      .map(id => lines.find(l => l.id === id))
                      .filter(Boolean) as PlanLine[]
                    if (roomLines.length < 3) return null
                    const pts = roomLines.map(l => ({ x: l.x1, y: l.y1 }))
                    const flatPts = pts.flatMap(p => [p.x, p.y])
                    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
                    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
                    return (
                      <Group key={room.id} listening={false}>
                        <Line points={flatPts} closed fill="rgba(120,144,156,0.08)" stroke="none" listening={false} />
                        <Text x={cx - 70} y={cy - 18} width={140}
                          text={room.label} fontSize={11} fill="#78909c" align="center" fontStyle="bold" listening={false} />
                        <Text x={cx - 70} y={cy - 2} width={140}
                          text={`${room.areaM2.toFixed(1)} м²`} fontSize={13} fill="#78909c" align="center" fontStyle="bold" listening={false} />
                        <Text x={cx - 70} y={cy + 16} width={140}
                          text={`П: ${(room.perimeterMm / 1000).toFixed(1)} м`} fontSize={9} fill="#90a4ae" align="center" listening={false} />
                      </Group>
                    )
                  })}

                  {/* Контуры */}
                  {contours.map(c => {
                    const pts = extractContourPoints(c.lineIds, lines)
                    if (pts.length < 3) return null
                    const color    = LINE_COLORS[c.type]
                    const centroid = contourCentroid(c)
                    const specFill = c.spec
                      ? getContourFill(c.type, c.spec.material, c.spec.subtype)
                      : null
                    const fillColor = specFill ?? (color + '18')
                    return (
                      <Group key={c.id}>
                        <Line points={pts.flatMap(p => [p.x, p.y])} closed fill={fillColor} stroke={color} strokeWidth={1.5} dash={[6,3]} listening={false} />
                        {centroid && <>
                          <Text x={centroid.x-70} y={centroid.y-18} width={140} text={c.label} fontSize={11} fill={color} align="center" fontStyle="bold" listening={false} />
                          <Text x={centroid.x-70} y={centroid.y-3}  width={140} text={fmtArea(c.areaM2)} fontSize={13} fill={color} align="center" fontStyle="bold" listening={false} />
                          {c.spec?.material && (
                            <Text x={centroid.x-70} y={centroid.y+14} width={140}
                              text={[c.spec.material, c.spec.subtype].filter(Boolean).join(' · ')}
                              fontSize={10} fill={color + 'aa'} align="center" listening={false} />
                          )}
                        </>}
                      </Group>
                    )
                  })}

                  {/* Линии */}
                  {lines.map(l => {
                    const isSelected = l.id === selectedId
                    const inContour  = contourIds.includes(l.id)
                    const inErase    = eraseIds.includes(l.id)
                    const baseColor  = LINE_COLORS[l.type]

                    const vis       = getLineVisual(l.type, l.spec?.material, l.spec?.subtype)
                    const specColor = vis.colorOverride ?? baseColor
                    const stroke    = inErase ? '#e53935' : inContour ? '#ff9800' : isSelected ? '#ff5722' : specColor
                    const dash      = (inErase || inContour || isSelected) ? undefined : (vis.dash ?? undefined)

                    const mx = (l.x1 + l.x2) / 2
                    const my = (l.y1 + l.y2) / 2

                    // Рисуем двойную линию (трапецию) ТОЛЬКО если spec задан явно.
                    // Без spec — тонкая линия, чтобы не путать при первом рисовании.
                    const hasExplicitSpec = !!(l.spec?.material)
                    const thicknessPx = (hasExplicitSpec && vis.thicknessMm > 0) ? vis.thicknessMm / scaleMmPx : 0
                    const dx = l.x2 - l.x1, dy = l.y2 - l.y1
                    const len = Math.sqrt(dx*dx + dy*dy)
                    const useDouble = thicknessPx > 3 && len > 0 && !inErase

                    if (useDouble) {
                      const half = thicknessPx / 2
                      const nx = -dy / len * half
                      const ny =  dx / len * half
                      const hitW = Math.max(28, thicknessPx + 8)
                      // Четыре угла прямоугольника по часовой стрелке:
                      // A(x1+nx,y1+ny) → B(x2+nx,y2+ny) → C(x2-nx,y2-ny) → D(x1-nx,y1-ny)
                      const ax = l.x1+nx, ay = l.y1+ny
                      const bx = l.x2+nx, by = l.y2+ny
                      const cx = l.x2-nx, cy = l.y2-ny
                      const dx2 = l.x1-nx, dy2 = l.y1-ny
                      const fill = isSelected ? stroke + '30' : inContour ? '#ff980022' : vis.fillColor

                      return (
                        <Group key={l.id}
                          onMouseDown={e => handleLinePointerDown(l.id, e)}
                          onTouchStart={e => handleLinePointerDown(l.id, e)}
                          onMouseEnter={() => setHoveredId(l.id)}
                          onMouseLeave={() => setHoveredId(null)}>
                          <Line points={[l.x1,l.y1,l.x2,l.y2]} stroke="transparent" strokeWidth={hitW} hitStrokeWidth={hitW} />
                          {/* Заливка — замкнутый прямоугольник A→B→C→D */}
                          <Line points={[ax,ay, bx,by, cx,cy, dx2,dy2]} closed fill={fill} stroke="none" listening={false} />
                          {/* Штриховка существующих конструкций */}
                          {l.type === 'wall_existing' && (() => {
                            const hatch = calcHatch(ax, ay, bx, by, cx, cy, dx2, dy2, 8)
                            return (
                              <Group clipFunc={(ctx: any) => {
                                ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
                                ctx.lineTo(cx, cy); ctx.lineTo(dx2, dy2); ctx.closePath()
                              }} listening={false}>
                                {hatch.map((pts, i) => (
                                  <Line key={i} points={pts} stroke="#78909c" strokeWidth={0.8} opacity={0.5} listening={false} />
                                ))}
                              </Group>
                            )
                          })()}
                          {/* Две параллельных линии (стороны стены) */}
                          <Line points={[ax,ay, bx,by]} stroke={stroke} strokeWidth={vis.strokeWidth} lineCap="square" dash={dash} listening={false} />
                          <Line points={[dx2,dy2, cx,cy]} stroke={stroke} strokeWidth={vis.strokeWidth} lineCap="square" dash={dash} listening={false} />
                          {/* Метка: внутри тела если толстая стена, иначе над линией */}
                          {(() => {
                            const lineAngle = Math.atan2(dy, dx) * 180 / Math.PI
                            const rot = (lineAngle > 90 || lineAngle < -90) ? lineAngle + 180 : lineAngle
                            if (thicknessPx >= 18) {
                              return (
                                <Group x={mx} y={my} rotation={rot} listening={false}>
                                  <Text x={-35} y={-7} width={70} text={l.label} fontSize={10}
                                    fill={stroke} align="center" fontStyle="bold" listening={false} />
                                </Group>
                              )
                            }
                            return len > 40 ? (
                              <Text x={mx-40} y={my-12} width={80} text={l.label} fontSize={10}
                                fill={stroke} align="center" fontStyle="bold" listening={false} />
                            ) : null
                          })()}
                          {/* Размерная линия над стеной — только при hover или select */}
                          {!inErase && (isSelected || hoveredId === l.id) && (
                            <DimLineShapes x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                              lengthMm={l.lengthMm} offsetPx={half + 14}
                              dimColor={isSelected ? stroke : '#999'} />
                          )}
                          {/* Кружки на концах: drag-handle при select, hover-точки при наведении */}
                          {isSelected && mode === 'select' ? <>
                            <Circle x={l.x1} y={l.y1} radius={9} fill="#fff" stroke={specColor} strokeWidth={2}
                              onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }}
                              onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }} />
                            <Circle x={l.x2} y={l.y2} radius={9} fill="#fff" stroke={specColor} strokeWidth={2}
                              onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }}
                              onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }} />
                          </> : hoveredId === l.id ? <>
                            <Circle x={l.x1} y={l.y1} radius={5} fill={stroke} listening={false} />
                            <Circle x={l.x2} y={l.y2} radius={5} fill={stroke} listening={false} />
                          </> : null}
                        </Group>
                      )
                    }

                    // Одиночная линия
                    const sw = inErase ? vis.strokeWidth + 3 : inContour ? vis.strokeWidth + 2 : isSelected ? vis.strokeWidth + 2 : vis.strokeWidth
                    return (
                      <Group key={l.id}
                        opacity={inErase ? 0.55 : 1}
                        onMouseDown={e => handleLinePointerDown(l.id, e)}
                        onTouchStart={e => handleLinePointerDown(l.id, e)}
                        onMouseEnter={() => setHoveredId(l.id)}
                        onMouseLeave={() => setHoveredId(null)}>
                        <Line points={[l.x1,l.y1,l.x2,l.y2]} stroke="transparent" strokeWidth={24} hitStrokeWidth={24} />
                        <Line points={[l.x1,l.y1,l.x2,l.y2]} stroke={stroke} strokeWidth={sw} lineCap="round" dash={dash} listening={false} />
                        {inErase && (
                          <Text x={mx-9} y={my-10} text="✕" fontSize={18} fill="#e53935" fontStyle="bold" listening={false} />
                        )}
                        {!inErase && (() => {
                          const linePx = Math.sqrt((l.x2-l.x1)**2 + (l.y2-l.y1)**2)
                          return linePx > 40 ? (
                            <Text x={mx-40} y={my-12} width={80} text={l.label} fontSize={10}
                              fill={stroke} align="center" fontStyle="bold" listening={false} />
                          ) : null
                        })()}
                        {/* Размерная линия — только при hover или select */}
                        {!inErase && (isSelected || hoveredId === l.id) && (
                          <DimLineShapes x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                            lengthMm={l.lengthMm} offsetPx={sw / 2 + 14}
                            dimColor={isSelected ? stroke : '#999'} />
                        )}
                        {/* Кружки: drag-handle при select, hover-точки при наведении */}
                        {isSelected && mode === 'select' ? <>
                          <Circle x={l.x1} y={l.y1} radius={9} fill="#fff" stroke={specColor} strokeWidth={2}
                            onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }}
                            onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }} />
                          <Circle x={l.x2} y={l.y2} radius={9} fill="#fff" stroke={specColor} strokeWidth={2}
                            onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }}
                            onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }} />
                        </> : hoveredId === l.id ? <>
                          <Circle x={l.x1} y={l.y1} radius={5} fill={stroke} listening={false} />
                          <Circle x={l.x2} y={l.y2} radius={5} fill={stroke} listening={false} />
                        </> : null}
                      </Group>
                    )
                  })}

                  {/* Превью рисования */}
                  {mode === 'draw' && drawing && previewPt && (
                    <>
                      <Line points={[drawing.x1,drawing.y1,previewX2,previewY2]}
                        stroke={LINE_COLORS[drawType]} strokeWidth={LINE_WIDTH[drawType]} dash={[6,4]} opacity={0.6} lineCap="round" listening={false} />
                      {previewLabel(previewX2, previewY2) && (
                        <Text x={(drawing.x1+previewX2)/2-30} y={(drawing.y1+previewY2)/2-16}
                          width={60} text={previewLabel(previewX2,previewY2)}
                          fontSize={10} fill={LINE_COLORS[drawType]} align="center" fontStyle="bold" listening={false} />
                      )}
                    </>
                  )}

                  {/* Курсор снапа */}
                  {cursor && mode === 'draw' && (
                    snapActive ? (
                      <Circle x={cursor.x} y={cursor.y} radius={8}
                        stroke="#4caf50" strokeWidth={2} fill="rgba(76,175,80,0.15)" listening={false} />
                    ) : (
                      <Circle x={cursor.x} y={cursor.y} radius={6}
                        stroke={LINE_COLORS[drawType]} strokeWidth={1.5} fill="rgba(255,255,255,0.7)" listening={false} />
                    )
                  )}

                  {/* Точки масштаба */}
                  {scalePt1 && <Circle x={scalePt1.x} y={scalePt1.y} radius={7} fill="#ff9800" listening={false} />}
                  {scalePt2 && <>
                    <Circle x={scalePt2.x} y={scalePt2.y} radius={7} fill="#ff9800" listening={false} />
                    <Line points={[scalePt1!.x,scalePt1!.y,scalePt2.x,scalePt2.y]} stroke="#ff9800" strokeWidth={2} dash={[4,3]} listening={false} />
                  </>}

                  {/* Стартовая точка цепочки — зелёный кружок замыкания */}
                  {mode === 'draw' && chainStartPt && drawing && (
                    <Circle x={chainStartPt.x} y={chainStartPt.y} radius={7}
                      stroke="#4caf50" strokeWidth={2} fill="rgba(76,175,80,0.2)" listening={false} />
                  )}

                  {/* Точки снапа — только в draw-режиме и только не-активные */}
                  {mode === 'draw' && allPoints.map((pt, i) => (
                    <Circle key={i} x={pt.x} y={pt.y} radius={3}
                      fill="transparent" stroke="#bbb" strokeWidth={1} listening={false} />
                  ))}
                </Layer>
              </Stage>
            </div>
          </div>

          {/* ── Таблица конструкций снизу ── */}
          {lines.length > 0 && (
            <div style={{
              background: '#fff', borderTop: '1px solid #e0e4ee',
              padding: '0', flexShrink: 0, maxHeight: 240, overflowY: 'auto',
            }}>
              <div style={{ padding: '10px 16px 4px', fontSize: 13, fontWeight: 700, color: '#1e2433' }}>
                Конструкции на плане
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f5f7fb' }}>
                    <th style={thS}>№</th>
                    <th style={thS}>Тип</th>
                    <th style={thS}>Конструкция</th>
                    <th style={thS}>Длина</th>
                    <th style={thS}>Высота</th>
                    <th style={thS}>Площадь</th>
                    <th style={thS}>Статус</th>
                    <th style={thS}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const status = getStatus(l.id)
                    const isSelected = l.id === selectedId
                    return (
                      <tr key={l.id}
                        onClick={() => { setSelected(l.id); setInspectorId(l.id); setMode('select') }}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? '#eef2ff' : 'transparent',
                          borderBottom: '1px solid #f0f0f0',
                        }}>
                        <td style={tdS}>{i + 1}</td>
                        <td style={tdS}>
                          <span style={{ color: LINE_COLORS[l.type], fontWeight: 600 }}>{l.label}</span>
                        </td>
                        <td style={tdS}>
                          {LINE_LABELS_SHORT[l.type]}
                          {l.spec?.material && <span style={{ color: '#888', marginLeft: 4 }}>({l.spec.material}{l.spec.subtype ? ` ${l.spec.subtype}` : ''})</span>}
                        </td>
                        <td style={tdS}>{fmtLen(l.lengthMm)}</td>
                        <td style={tdS}>3000 мм</td>
                        <td style={tdS}>{calcLineArea(l).toFixed(2)} м²</td>
                        <td style={tdS}>
                          <span style={{ color: statusColor(status) }}>{statusDot(status)}</span>
                          {' '}Не начата
                        </td>
                        <td style={{ ...tdS, display: 'flex', gap: 4 }}>
                          <button title="Просмотр" style={iconBtnStyle} onClick={e => { e.stopPropagation(); setSelected(l.id); setInspectorId(l.id); setMode('select') }}>👁</button>
                          <button title="Открыть расчёт" style={iconBtnStyle} onClick={e => { e.stopPropagation() }}>↗</button>
                          <button title="Меню" style={iconBtnStyle} onClick={e => { e.stopPropagation() }}>⋮</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* Добавить конструкцию */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px 10px' }}>
                <button onClick={() => switchMode('draw')}
                  style={{ fontSize: 12, color: '#3a7bd5', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  + Добавить конструкцию
                </button>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11 }}>
                  <span style={{ color: '#bbb' }}>○ Не начата</span>
                  <span style={{ color: '#ff9800' }}>◐ В работе</span>
                  <span style={{ color: '#4caf50' }}>● Готова</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ════════════════════ ПРАВАЯ ПАНЕЛЬ ════════════════════ */}
        {inspectorLine && (
          <div style={rightPanelStyle}>
            {/* Заголовок правой панели */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px 10px',
              borderBottom: '1px solid #e0e4ee', background: '#fff',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e2433' }}>
                  {inspectorLine.label}
                </div>
                <button
                  onClick={() => { /* open full calc */ }}
                  style={{
                    marginTop: 6, fontSize: 11, fontWeight: 600,
                    color: '#fff', background: '#3a7bd5', border: 'none',
                    borderRadius: 5, padding: '5px 12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                  Открыть полный расчёт ↗
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button title="Дублировать" style={iconBtnStyle2} onClick={() => {}}>⧉</button>
                <button title="Удалить" style={{ ...iconBtnStyle2, color: '#e53935' }}
                  onClick={() => { removePlanLine(inspectorLine.id); setInspectorId(null); setSelected(null) }}>🗑</button>
                <button title="Закрыть" style={iconBtnStyle2} onClick={() => setInspectorId(null)}>✕</button>
              </div>
            </div>

            {/* Статус + цвет типа */}
            <div style={{ padding: '10px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: LINE_COLORS[inspectorLine.type], fontSize: 16 }}>●</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e2433' }}>{inspectorLine.label}</span>
              <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>
                {LINE_LABELS_SHORT[inspectorLine.type]}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>
                {fmtLen(inspectorLine.lengthMm)}
              </span>
            </div>

            {/* Вкладки */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e0e4ee', padding: '0 16px', marginTop: 10 }}>
              {(['construction', 'finish', 'materials', 'calc'] as const).map(tab => {
                const labels = { construction: 'Конструкция', finish: 'Отделка', materials: 'Материалы', calc: 'Расчёт' }
                return (
                  <button key={tab} onClick={() => setRightTab(tab)}
                    style={{
                      flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: rightTab === tab ? 600 : 400,
                      border: 'none', borderBottom: rightTab === tab ? `2px solid #3a7bd5` : '2px solid transparent',
                      background: 'none', cursor: 'pointer',
                      color: rightTab === tab ? '#3a7bd5' : '#888',
                    }}>
                    {labels[tab]}
                  </button>
                )
              })}
            </div>

            {/* Содержимое вкладки */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

              {rightTab === 'construction' && (
                <>
                  {/* Тип конструкции — смена через дропдаун */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Тип конструкции</div>
                    <select value={inspectorLine.type}
                      onChange={e => updatePlanLine(inspectorLine.id, { type: e.target.value as PlanLineType, spec: undefined })}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', border: '1px solid #dde', borderRadius: 5, background: '#fff' }}>
                      {(Object.entries(LINE_LABELS_SHORT) as [PlanLineType, string][]).map(([t, label]) => (
                        <option key={t} value={t}>{label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Детальный каскадный селектор */}
                  <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Конструкция / материал</div>
                    <ConstructionSpecSelector
                      planType={inspectorLine.type}
                      value={inspectorLine.spec}
                      onChange={spec => updatePlanLine(inspectorLine.id, { spec })}
                      compact
                    />
                  </div>

                  {/* Информация о выбранной конструкции */}
                  {inspectorLine.spec?.material && (() => {
                    const specMat = inspectorLine.spec.material
                    const specSub = inspectorLine.spec.subtype
                    const typeColor = LINE_COLORS[inspectorLine.type]
                    return (
                      <div style={{ padding: '10px 12px', background: typeColor + '10', borderRadius: 6, marginBottom: 12, border: `1px solid ${typeColor}30` }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: typeColor }}>
                          {LINE_LABELS_SHORT[inspectorLine.type]}
                        </div>
                        <div style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
                          Материал: <b>{specMat}</b>
                          {specSub && <span> · {specSub}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                          Длина: <b>{fmtLen(inspectorLine.lengthMm)}</b>
                          {' · '}Площадь: <b>{calcLineArea(inspectorLine).toFixed(2)} м²</b>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Имя конструкции */}
                  <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 5, fontWeight: 600 }}>Название</div>
                    <input
                      value={inspectorLine.label}
                      onChange={e => updatePlanLine(inspectorLine.id, { label: e.target.value })}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', border: '1px solid #dde', borderRadius: 5, boxSizing: 'border-box' as const }}
                    />
                  </div>

                  <div style={{ fontSize: 11, color: '#aaa', textAlign: 'center', padding: '8px 0' }}>
                    Дополнительные параметры будут доступны после выбора конструкции
                  </div>
                </>
              )}

              {rightTab === 'finish' && (
                <div style={{ padding: '10px 0' }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>Отделка для: <b>{inspectorLine.label}</b></div>
                  <div style={{ padding: 12, background: '#f5f7fb', borderRadius: 8, fontSize: 12, color: '#888', textAlign: 'center' }}>
                    Выберите тип отделки для этой конструкции
                  </div>
                  <button style={{
                    marginTop: 12, width: '100%', padding: '8px', fontSize: 12,
                    border: '1px solid #3a7bd5', borderRadius: 6, color: '#3a7bd5',
                    background: '#fff', cursor: 'pointer', fontWeight: 600,
                  }}>
                    Выбрать отделку
                  </button>
                </div>
              )}

              {rightTab === 'materials' && (
                <div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 10, fontWeight: 600 }}>
                    Параметры для расчёта
                  </div>
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
                    Длина: <b>{fmtLen(inspectorLine.lengthMm)}</b>
                  </div>
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
                    Площадь (при h=3000): <b>{calcLineArea(inspectorLine).toFixed(2)} м²</b>
                  </div>
                  {inspectorLine.spec?.material ? (
                    <div style={{ padding: 10, background: '#f5f7fb', borderRadius: 6, fontSize: 12, color: '#888' }}>
                      Нажмите «Открыть полный расчёт» для детальной спецификации материалов
                    </div>
                  ) : (
                    <div style={{ padding: 10, background: '#fff3e0', borderRadius: 6, fontSize: 12, color: '#e67e22', border: '1px solid #ffe0b2' }}>
                      ⚠️ Сначала выберите конструкцию на вкладке «Конструкция»
                    </div>
                  )}
                </div>
              )}

              {rightTab === 'calc' && (
                <div style={{ fontSize: 12, color: '#888', padding: '10px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>↗</div>
                  <div style={{ color: '#555', marginBottom: 12 }}>
                    Откройте полный расчёт для просмотра детальной спецификации
                  </div>
                  <button
                    style={{
                      width: '100%', padding: '10px', fontSize: 13, fontWeight: 600,
                      color: '#fff', background: '#3a7bd5', border: 'none',
                      borderRadius: 6, cursor: 'pointer',
                    }}
                    onClick={() => {}}>
                    Открыть полный расчёт ↗
                  </button>
                </div>
              )}
            </div>

            {/* Подсказка внизу */}
            {rightTab === 'construction' && (
              <div style={{
                padding: '10px 16px', borderTop: '1px solid #e0e4ee', background: '#f5f7fb',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: '#3a7bd5', fontWeight: 600 }}>ℹ Следующий слой: Отделка</div>
                  <div style={{ fontSize: 11, color: '#888' }}>Выберите тип отделки для этой перегородки</div>
                </div>
                <button onClick={() => setRightTab('finish')}
                  style={{ fontSize: 11, padding: '5px 10px', border: '1px solid #3a7bd5', borderRadius: 5, color: '#3a7bd5', background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Выбрать отделку
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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

// ─── Вспомогательные стили ────────────────────────────────────────────────────

function toolBtnStyle(active: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '5px 10px', fontSize: 12, borderRadius: 5, cursor: disabled ? 'not-allowed' : 'pointer',
    border: active ? '1px solid #3a7bd5' : '1px solid #dde',
    background: active ? '#eef2ff' : '#fff',
    color: disabled ? '#ccc' : active ? '#3a7bd5' : '#444',
    fontWeight: active ? 600 : 400,
    opacity: disabled ? 0.6 : 1,
  }
}

const thS: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', fontSize: 11,
  fontWeight: 600, color: '#888', borderBottom: '1px solid #eee',
}
const tdS: React.CSSProperties = {
  padding: '7px 10px', fontSize: 12, color: '#333',
}
const iconBtnStyle: React.CSSProperties = {
  padding: '2px 6px', fontSize: 13, border: 'none', background: 'transparent',
  cursor: 'pointer', color: '#888', borderRadius: 3,
}
const iconBtnStyle2: React.CSSProperties = {
  padding: '4px 7px', fontSize: 14, border: '1px solid #eee', background: '#fff',
  cursor: 'pointer', color: '#888', borderRadius: 5,
}
