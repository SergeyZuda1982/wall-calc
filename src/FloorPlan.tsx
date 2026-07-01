/**
 * FloorPlan — план объекта. Рефакторинг UI: три колонки.
 *
 * Левая панель: список типов конструкций, инструменты, дерево конструкций
 * Центр: тулбар + холст + таблица конструкций
 * Правая панель: параметры выбранной конструкции (появляется при выборе)
 *
 * Логика рисования/редактирования — без изменений.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Line, Circle, Text, Rect, Group, Image as KonvaImage } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useProjectStore } from './store/useProjectStore'
import { useIsMobile } from './hooks/useIsMobile'
import type { PlanLine, PlanLineType, PlanLineSpec, PlanView, PlanContour, PlanOpening } from './types'
import { getLineVisual, getContourFill, TAXONOMY } from './data/constructionTaxonomy'
import ConstructionSpecSelector from './components/ConstructionSpecSelector'
import { computeWallJoins } from './core/wallJoin'
import type { WallForJoin } from './core/wallJoin'
import { renderPdfPageToImage, getPdfPageCount } from './core/pdfBackground'

// ─── Константы ───────────────────────────────────────────────────────────────

const CANVAS_H   = 520
const SNAP_SCREEN_PX = 24   // порог снапа в экранных пикселях (увеличен для тач-устройств — нет hover перед тапом)
const CHAIN_SNAP_SCREEN_PX = 34   // ещё более терпимый порог для продолжения цепочки от конца предыдущей линии
const DRAG_THRESHOLD = 4

const LINE_COLORS: Record<PlanLineType, string> = {
  wall_new:      '#e53935',
  wall_lining:   '#1e88e5',
  wall_existing: '#78909c',
  ceiling:       '#8e24aa',
  floor:         '#6d4c41',
}
const LINE_LABELS_SHORT: Record<PlanLineType, string> = {
  wall_new:      'Перегородка',
  wall_lining:   'Облицовка',
  wall_existing: 'Сущ. конструкция',
  ceiling:       'Потолок',
  floor:         'Пол',
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

function snapPoint(
  x: number, y: number, lines: PlanLine[], scaleMmPx: number,
  excludeId?: string, threshPx = SNAP_SCREEN_PX,
) {
  let best = { x, y, snapped: false, d: Infinity }
  for (const l of lines) {
    if (l.id === excludeId) continue
    // Концы линии
    for (const [px, py] of [[l.x1, l.y1], [l.x2, l.y2]] as [number, number][]) {
      const d = dist(x, y, px, py)
      if (d <= threshPx && d < best.d) best = { x: px, y: py, snapped: true, d }
    }
    // T-примыкание: снап к БЛИЖНЕМУ РЕБРУ стены (не к оси!) — именно туда
    // физически упирается примыкающая перегородка. Длина при этом сразу
    // получается "в свету" (до грани, не до центра), без отдельной коррекции.
    const dx = l.x2 - l.x1, dy = l.y2 - l.y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len > 1) {
      const ux = dx / len, uy = dy / len
      let t = ((x - l.x1) * dx + (y - l.y1) * dy) / (len * len)
      t = Math.max(0, Math.min(1, t))
      const axisX = l.x1 + t * dx, axisY = l.y1 + t * dy

      const vis = getLineVisual(l.type, l.spec?.material, l.spec?.subtype)
      const halfThicknessPx = vis.thicknessMm > 0 ? (vis.thicknessMm / 2) / scaleMmPx : 0

      // Нормаль к оси линии; определяем с какой стороны от оси кликнули,
      // чтобы выбрать БЛИЖНЮЮ грань (ту, с которой приближается курсор)
      const nx = -uy, ny = ux
      const side = (x - axisX) * nx + (y - axisY) * ny
      const faceSign = side >= 0 ? 1 : -1
      const faceX = axisX + faceSign * nx * halfThicknessPx
      const faceY = axisY + faceSign * ny * halfThicknessPx

      const d = dist(x, y, faceX, faceY)
      const bodyThresh = threshPx + halfThicknessPx
      // Кандидат валиден относительно СВОЕГО порога (учитывает толщину ИМЕННО этой стены),
      // а не относительно best.d, который мог уже сжаться из-за другой, не относящейся линии
      if (d <= bodyThresh && d < best.d) best = { x: faceX, y: faceY, snapped: true, d }
    }
  }
  if (!best.snapped) return { x, y, snapped: false, d: threshPx }
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

interface WallAxisSegment { ax1: number; ay1: number; ax2: number; ay2: number; capStart: boolean; capEnd: boolean }
interface OpeningRenderInfo { x: number; y: number; opening: PlanOpening }

/**
 * Разбивает ось стены на сплошные сегменты, исключая проёмы (двери/окна).
 * fax1/fay1/fax2/fay2 — уже расширенная под wall-join ось (для заливки/стыков),
 * l.x1/l.y1 — исходное (не расширенное) начало линии, от которого отсчитывается
 * offsetMm каждого проёма. cap1/cap2 — нужны ли торцы на истинных свободных концах.
 */
function computeOpeningSegments(
  fax1: number, fay1: number, fax2: number, fay2: number,
  origX1: number, origY1: number,
  ux: number, uy: number, scaleMmPx: number,
  openings: PlanOpening[] | undefined,
  cap1: boolean, cap2: boolean,
): { segments: WallAxisSegment[]; gaps: OpeningRenderInfo[] } {
  if (!openings || openings.length === 0) {
    return { segments: [{ ax1: fax1, ay1: fay1, ax2: fax2, ay2: fay2, capStart: cap1, capEnd: cap2 }], gaps: [] }
  }
  const sorted = openings.slice().sort((a, b) => a.offsetMm - b.offsetMm)
  const segments: WallAxisSegment[] = []
  const gaps: OpeningRenderInfo[] = []

  let curX = fax1, curY = fay1
  let curCap = cap1

  for (const op of sorted) {
    const startPx = op.offsetMm / scaleMmPx
    const endPx = (op.offsetMm + op.widthMm) / scaleMmPx
    const gapStartX = origX1 + ux * startPx, gapStartY = origY1 + uy * startPx
    const gapEndX   = origX1 + ux * endPx,   gapEndY   = origY1 + uy * endPx

    segments.push({ ax1: curX, ay1: curY, ax2: gapStartX, ay2: gapStartY, capStart: curCap, capEnd: true })
    gaps.push({ x: (gapStartX + gapEndX) / 2, y: (gapStartY + gapEndY) / 2, opening: op })

    curX = gapEndX; curY = gapEndY; curCap = true
  }
  segments.push({ ax1: curX, ay1: curY, ax2: fax2, ay2: fay2, capStart: curCap, capEnd: cap2 })

  // Отбрасываем вырожденные (нулевой длины) сегменты — проём впритык к концу стены
  return { segments: segments.filter(s => dist(s.ax1, s.ay1, s.ax2, s.ay2) > 0.5), gaps }
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

/** Ray casting — точка внутри полигона */
function pointInPolygon(px: number, py: number, pts: { x: number; y: number }[]): boolean {
  let inside = false
  const n = pts.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x, yi = pts[i].y
    const xj = pts[j].x, yj = pts[j].y
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
      inside = !inside
  }
  return inside
}

// ─── Компонент ───────────────────────────────────────────────────────────────

export default function FloorPlan() {
  const {
    floorPlan, addPlanLine, updatePlanLine, removePlanLine,
    setFloorPlanScale, clearFloorPlan,
    addContour, addRoom, updateRoom, removeRoom, updateContour,
    setBackgroundImage, updateBackgroundImage,
  } = useProjectStore()

  const lines     = floorPlan?.lines    ?? []
  const contours  = floorPlan?.contours ?? []
  const rooms     = floorPlan?.rooms    ?? []
  const scaleMmPx = floorPlan?.scaleMmPerPx ?? 10

  // ── UI-состояние ──────────────────────────────────────────────────────────
  const [planView, setPlanView]         = useState<PlanView>('top')
  const [mode, setMode]                 = useState<Mode>('draw')
  const [drawType, setDrawType]         = useState<PlanLineType>('wall_new')
  const [drawSpec, setDrawSpec]         = useState<PlanLineSpec | null>(null)
  const [drawHeightMm, setDrawHeightMm] = useState('3000')
  const [expandedMaterial, setExpandedMaterial] = useState<string | null>(null)
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
  const [inspectorRoomId, setInspectorRoomId] = useState<string | null>(null)
  // Цепочка рисования периметра
  const [chainStartPt, setChainStartPt] = useState<{ x: number; y: number } | null>(null)
  const [chainLineIds, setChainLineIds] = useState<string[]>([])

  const dragRef      = useRef<DragState>(null)
  const dragMovedRef = useRef(false)
  const lineWasClickedRef = useRef(false)
  const panStartRef  = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null)
  // Touch: панорама одним пальцем (когда не рисуем/не двигаем линию) и pinch-zoom двумя
  const touchPanRef   = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null)
  const pinchRef       = useRef<{ dist: number; scale: number; midX: number; midY: number } | null>(null)

  // Зум и панорамирование
  const [stageScale, setStageScale] = useState(1)
  const [stagePos,   setStagePos]   = useState({ x: 0, y: 0 })
  const [spaceDown,  setSpaceDown]  = useState(false)

  // Рефы для stagePos/stageScale — всегда актуальны внутри колбэков без пересоздания
  const stagePosRef   = useRef(stagePos)
  const stageScaleRef = useRef(stageScale)
  stagePosRef.current   = stagePos
  stageScaleRef.current = stageScale
  const modeRef = useRef(mode)
  modeRef.current = mode

  // Масштаб
  const [scaleStep, setScaleStep]             = useState<0 | 1 | 2>(0)
  const [scalePt1, setScalePt1]               = useState<{ x: number; y: number } | null>(null)
  const [scalePt2, setScalePt2]               = useState<{ x: number; y: number } | null>(null)
  const [scaleMmInput, setScaleMmInput]       = useState('')
  const [showScaleDialog, setShowScaleDialog] = useState(false)
  // Уточнение масштаба по уже начерченной линии
  const [recalInput, setRecalInput]           = useState('')
  // Добавление проёма (дверь/окно) на выбранной линии
  const [openingType, setOpeningType]         = useState<'door' | 'window'>('door')
  const [openingOffset, setOpeningOffset]     = useState('')
  const [openingWidth, setOpeningWidth]       = useState('')
  const [openingHeight, setOpeningHeight]     = useState('2000')
  const [openingSill, setOpeningSill]         = useState('900')

  // ── Подложка PDF ──────────────────────────────────────────────────────────
  const [bgImageEl, setBgImageEl]       = useState<HTMLImageElement | null>(null)
  const [bgUploading, setBgUploading]   = useState(false)
  const [bgError, setBgError]           = useState<string | null>(null)
  const [bgPendingFile, setBgPendingFile] = useState<File | null>(null)
  const [bgPageCount, setBgPageCount]   = useState(1)
  const [bgPageInput, setBgPageInput]   = useState('1')
  const bgFileInputRef = useRef<HTMLInputElement>(null)

  // Загружаем HTMLImageElement из dataUrl при изменении подложки в сторе
  useEffect(() => {
    const url = floorPlan?.backgroundImage?.dataUrl
    if (!url) { setBgImageEl(null); return }
    const img = new window.Image()
    img.onload = () => setBgImageEl(img)
    img.src = url
  }, [floorPlan?.backgroundImage?.dataUrl])

  const handleBgFileSelected = useCallback(async (file: File) => {
    setBgError(null)
    try {
      const count = await getPdfPageCount(file)
      if (count > 1) {
        setBgPendingFile(file)
        setBgPageCount(count)
        setBgPageInput('1')
      } else {
        setBgUploading(true)
        const res = await renderPdfPageToImage(file, 1)
        setBackgroundImage({
          dataUrl: res.dataUrl, x: 0, y: 0,
          width: res.width, height: res.height,
          opacity: 0.6, locked: true,
        })
        setBgUploading(false)
      }
    } catch (err) {
      setBgError('Не удалось прочитать PDF. Проверьте файл.')
      setBgUploading(false)
    }
  }, [setBackgroundImage])

  const handleBgConfirmPage = useCallback(async () => {
    if (!bgPendingFile) return
    const page = Math.min(Math.max(parseInt(bgPageInput) || 1, 1), bgPageCount)
    setBgUploading(true)
    setBgError(null)
    try {
      const res = await renderPdfPageToImage(bgPendingFile, page)
      setBackgroundImage({
        dataUrl: res.dataUrl, x: 0, y: 0,
        width: res.width, height: res.height,
        opacity: 0.6, locked: true,
      })
    } catch {
      setBgError('Не удалось отрендерить страницу.')
    }
    setBgUploading(false)
    setBgPendingFile(null)
  }, [bgPendingFile, bgPageInput, bgPageCount, setBackgroundImage])

  // Адаптивная ширина холста
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef     = useRef<any>(null)
  const [canvasW, setCanvasW] = useState(600)

  // ── Мобильная адаптация ──
  const isMobile = useIsMobile()
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false)
  const [mobileRightOpen, setMobileRightOpen] = useState(false)
  useEffect(() => {
    function update() {
      if (containerRef.current) setCanvasW(containerRef.current.offsetWidth)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Space — режим панорамирования
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); setSpaceDown(true) } }
    const up   = (e: KeyboardEvent) => { if (e.code === 'Space') { setSpaceDown(false); panStartRef.current = null } }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
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
    if (isMobile && m === 'draw') setMobileLeftOpen(false)
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
    const sp = stagePosRef.current
    const sc = stageScaleRef.current
    const te = e.evt as TouchEvent
    if (te.touches?.length > 0) {
      const rect = stage.container().getBoundingClientRect()
      const sx = te.touches[0].clientX - rect.left
      const sy = te.touches[0].clientY - rect.top
      return { x: (sx - sp.x) / sc, y: (sy - sp.y) / sc }
    }
    const pos = stage.getPointerPosition()
    if (!pos) return null
    return { x: (pos.x - sp.x) / sc, y: (pos.y - sp.y) / sc }
  }

  function applySnap(x: number, y: number, excludeId?: string): { x: number; y: number } {
    const thresh = SNAP_SCREEN_PX / stageScaleRef.current
    const snapped = snapPoint(x, y, lines, scaleMmPx, excludeId, thresh)
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
        const thresh = SNAP_SCREEN_PX / stageScaleRef.current
        const s = snapPoint(dr.origX1 + dx, dr.origY1 + dy, lines, scaleMmPx, dr.id, thresh)
        const snapDx = s.snapped ? s.x - dr.origX1 : dx
        const snapDy = s.snapped ? s.y - dr.origY1 : dy
        const newX1 = dr.origX1 + snapDx
        const newY1 = dr.origY1 + snapDy
        const newX2 = dr.origX2 + snapDx
        const newY2 = dr.origY2 + snapDy
        const lm = lineLengthMm(newX1, newY1, newX2, newY2, scaleMmPx)
        updatePlanLine(dr.id, { x1: newX1, y1: newY1, x2: newX2, y2: newY2, lengthMm: lm })
      } else if (dr.kind === 'end1') {
        const thresh = SNAP_SCREEN_PX / stageScaleRef.current
        const s = snapPoint(rawX, rawY, lines, scaleMmPx, dr.id, thresh)
        const l = lines.find(l => l.id === dr.id)!
        const lm = lineLengthMm(s.x, s.y, l.x2, l.y2, scaleMmPx)
        updatePlanLine(dr.id, { x1: s.x, y1: s.y, lengthMm: lm })
      } else {
        const thresh = SNAP_SCREEN_PX / stageScaleRef.current
        const s = snapPoint(rawX, rawY, lines, scaleMmPx, dr.id, thresh)
        const l = lines.find(l => l.id === dr.id)!
        const lm = lineLengthMm(l.x1, l.y1, s.x, s.y, scaleMmPx)
        updatePlanLine(dr.id, { x2: s.x, y2: s.y, lengthMm: lm })
      }
      return
    }
    const snapThresh = SNAP_SCREEN_PX / stageScaleRef.current
    const snappedInfo = snapPoint(rawX, rawY, lines, scaleMmPx, undefined, snapThresh)
    // В draw-режиме: дополнительно проверяем снап к началу цепочки (замыкание)
    const snapToChainStart =
      mode === 'draw' && drawing && chainStartPt &&
      dist(rawX, rawY, chainStartPt.x, chainStartPt.y) <= snapThresh
    const pt = snapToChainStart
      ? { x: chainStartPt!.x, y: chainStartPt!.y, snapped: true }
      : (orthoMode && drawing && !snappedInfo.snapped)
        ? snapOrtho(drawing.x1, drawing.y1, snappedInfo.x, snappedInfo.y)
        : snappedInfo
    setCursor({ x: pt.x, y: pt.y })
    setSnapActive(snappedInfo.snapped || !!snapToChainStart)
  }
  const handleMoveRef = useRef(handleMove)
  handleMoveRef.current = handleMove

  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    const sp = stage.getPointerPosition()
    if (!sp) return
    // Панорамирование
    if (panStartRef.current) {
      setStagePos({ x: panStartRef.current.sx + sp.x - panStartRef.current.x, y: panStartRef.current.sy + sp.y - panStartRef.current.y })
      return
    }
    const pos = stagePosRef.current; const sc = stageScaleRef.current
    handleMove((sp.x - pos.x) / sc, (sp.y - pos.y) / sc)
  }, [lines, mode, drawing, orthoMode, dragRef.current])

  function touchDist(t1: Touch, t2: Touch) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
  }
  function touchMid(t1: Touch, t2: Touch) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 }
  }

  // ── Нативные DOM touch-обработчики на контейнере холста ──
  // (надёжнее чем Konva-делегирование событий на мобильных — события не теряются)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function onTouchStartNative(te: TouchEvent) {
      const rect = el!.getBoundingClientRect()

      if (te.touches.length === 2) {
        touchPanRef.current = null
        const m = touchMid(te.touches[0], te.touches[1])
        pinchRef.current = {
          dist: touchDist(te.touches[0], te.touches[1]),
          scale: stageScaleRef.current,
          midX: m.x, midY: m.y,
        }
        return
      }

      if (te.touches.length === 1) {
        // Не начинаем панораму если уже идёт драг линии/точки или мы рисуем
        if (modeRef.current !== 'draw' && !dragRef.current) {
          const sx = te.touches[0].clientX - rect.left
          const sy = te.touches[0].clientY - rect.top
          touchPanRef.current = { x: sx, y: sy, sx: stagePosRef.current.x, sy: stagePosRef.current.y }
        }
      }
    }

    function onTouchMoveNative(te: TouchEvent) {
      const rect = el!.getBoundingClientRect()

      // Pinch-zoom двумя пальцами
      if (te.touches.length === 2 && pinchRef.current) {
        te.preventDefault()
        const d = touchDist(te.touches[0], te.touches[1])
        const m = touchMid(te.touches[0], te.touches[1])
        const ratio = d / pinchRef.current.dist
        const newScale = Math.min(Math.max(pinchRef.current.scale * ratio, 0.1), 20)
        const mx = m.x - rect.left
        const my = m.y - rect.top
        const worldX = (mx - stagePosRef.current.x) / stageScaleRef.current
        const worldY = (my - stagePosRef.current.y) / stageScaleRef.current
        setStageScale(newScale)
        setStagePos({ x: mx - worldX * newScale, y: my - worldY * newScale })
        return
      }

      // Панорама одним пальцем
      if (te.touches.length === 1 && touchPanRef.current) {
        te.preventDefault()
        const sx = te.touches[0].clientX - rect.left
        const sy = te.touches[0].clientY - rect.top
        setStagePos({
          x: touchPanRef.current!.sx + sx - touchPanRef.current!.x,
          y: touchPanRef.current!.sy + sy - touchPanRef.current!.y,
        })
        return
      }

      // Иначе — рисование / драг линии одним пальцем (через Konva-логику)
      if (te.touches.length === 1) {
        const sx = te.touches[0].clientX - rect.left
        const sy = te.touches[0].clientY - rect.top
        const pos = stagePosRef.current; const sc = stageScaleRef.current
        handleMoveRef.current((sx - pos.x) / sc, (sy - pos.y) / sc)
      }
    }

    function onTouchEndNative(te: TouchEvent) {
      if (te.touches.length < 2) pinchRef.current = null
      if (te.touches.length === 0) {
        touchPanRef.current = null
        handlePointerUpRef.current()
      }
    }

    el.addEventListener('touchstart', onTouchStartNative, { passive: true })
    el.addEventListener('touchmove', onTouchMoveNative, { passive: false })
    el.addEventListener('touchend', onTouchEndNative, { passive: true })
    el.addEventListener('touchcancel', onTouchEndNative, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStartNative)
      el.removeEventListener('touchmove', onTouchMoveNative)
      el.removeEventListener('touchend', onTouchEndNative)
      el.removeEventListener('touchcancel', onTouchEndNative)
    }
  }, [])

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
    panStartRef.current = null
    if (dragRef.current && !dragMovedRef.current && mode === 'select') {
      setSelected(dragRef.current.id)
    }
    dragRef.current = null
    dragMovedRef.current = false
  }, [mode])
  const handlePointerUpRef = useRef(handlePointerUp)
  handlePointerUpRef.current = handlePointerUp

  // ── Зум колёсиком ─────────────────────────────────────────────────────────
  function handleWheel(e: KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const sp = stage.getPointerPosition()
    if (!sp) return
    const SCALE_BY = 1.12
    const newScale = e.evt.deltaY < 0
      ? Math.min(stageScale * SCALE_BY, 20)
      : Math.max(stageScale / SCALE_BY, 0.1)
    const mouseWorldX = (sp.x - stagePos.x) / stageScale
    const mouseWorldY = (sp.y - stagePos.y) / stageScale
    setStageScale(newScale)
    setStagePos({ x: sp.x - mouseWorldX * newScale, y: sp.y - mouseWorldY * newScale })
  }

  // ── Начало панорамирования (Space + ЛКМ, или СКМ) ─────────────────────────
  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceDown)) {
      const sp = stageRef.current?.getPointerPosition()
      if (sp) panStartRef.current = { x: sp.x, y: sp.y, sx: stagePos.x, sy: stagePos.y }
      e.evt.preventDefault()
    }
  }

  // ── ПКМ — отмена текущего действия ─────────────────────────────────────
  function handleStageContextMenu(e: KonvaEventObject<MouseEvent>) {
    e.evt.preventDefault()
    if (mode === 'draw') {
      setDrawing(null)
      setChainStartPt(null)
      setChainLineIds([])
    }
  }

  // ── Ограничение черчения внутри периметра ─────────────────────────────────
  function isPointAllowed(x: number, y: number, type: PlanLineType): boolean {
    if (type === 'wall_existing') return true
    // При обводке подложки (кальки) геометрия уже задана исходным чертежом —
    // ограничение "только внутри замкнутого периметра" не нужно
    if (floorPlan?.backgroundImage) return true
    if (rooms.length === 0) return true
    return rooms.some(room => {
      const pts = extractContourPoints(room.lineIds, lines)
      return pts.length >= 3 && pointInPolygon(x, y, pts)
    })
  }

  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (dragMovedRef.current) return
    if (lineWasClickedRef.current) {
      lineWasClickedRef.current = false
      return
    }
    // Только ЛКМ (для мышиных событий)
    if ('button' in e.evt && e.evt.button !== 0) return

    const pos = getPos(e)
    if (!pos) return

    if (mode === 'scale') {
      // Снап к существующим линиям не нужен — калибруемся по точкам на подложке/чертеже
      if (scaleStep === 0) { setScalePt1({ x: pos.x, y: pos.y }); setScaleStep(1) }
      else if (scaleStep === 1) { setScalePt2({ x: pos.x, y: pos.y }); setScaleStep(2); setShowScaleDialog(true) }
      return
    }

    if (mode === 'draw') {
      const pt = applySnap(pos.x, pos.y)
      const snapThresh = SNAP_SCREEN_PX / stageScaleRef.current

      // Проверка: курсор снапнулся к началу цепочки → замыкание
      const closingChain =
        drawing && chainStartPt &&
        dist(pt.x, pt.y, chainStartPt.x, chainStartPt.y) <= snapThresh

      if (!drawing) {
        // ── Shift+клик на endpoint → переактивация линии ─────────────────
        const shiftHeld = 'shiftKey' in e.evt && e.evt.shiftKey
        if (shiftHeld) {
          const hitLine = lines.find(l =>
            dist(pt.x, pt.y, l.x2, l.y2) <= snapThresh ||
            dist(pt.x, pt.y, l.x1, l.y1) <= snapThresh
          )
          if (hitLine) {
            const hitEnd2 = dist(pt.x, pt.y, hitLine.x2, hitLine.y2) <= snapThresh
            const anchor = hitEnd2
              ? { x: hitLine.x1, y: hitLine.y1 }
              : { x: hitLine.x2, y: hitLine.y2 }
            removePlanLine(hitLine.id)
            const newChainIds = chainLineIds.filter(id => id !== hitLine.id)
            setChainLineIds(newChainIds)
            if (chainLineIds[0] === hitLine.id) {
              const newFirst = newChainIds.length > 0
                ? lines.find(l => l.id === newChainIds[0])
                : null
              setChainStartPt(newFirst ? { x: newFirst.x1, y: newFirst.y1 } : anchor)
            }
            setDrawing({ x1: anchor.x, y1: anchor.y })
            return
          }
        }

        if (!isPointAllowed(pt.x, pt.y, drawType)) return  // вне периметра

        // Если кликнули рядом с концом последней линии цепочки — продолжаем её точно
        // от её координат (порог шире обычного снапа — тач без hover промахивается чаще)
        const chainSnapThresh = CHAIN_SNAP_SCREEN_PX / stageScaleRef.current
        const lastChainLine = chainLineIds.length > 0
          ? lines.find(l => l.id === chainLineIds[chainLineIds.length - 1])
          : null
        const continuingChain = lastChainLine &&
          dist(pos.x, pos.y, lastChainLine.x2, lastChainLine.y2) <= chainSnapThresh

        if (continuingChain) {
          setDrawing({ x1: lastChainLine!.x2, y1: lastChainLine!.y2 })
          return
        }

        setChainStartPt({ x: pt.x, y: pt.y })
        setChainLineIds([])
        setDrawing({ x1: pt.x, y1: pt.y })

      } else if (closingChain) {
        // Замыкание: добавляем последний отрезок до chainStartPt (если нужен)
        const d = dist(drawing.x1, drawing.y1, chainStartPt!.x, chainStartPt!.y)
        let allLineIds = [...chainLineIds]

        if (d >= 5) {
          const lengthMm = lineLengthMm(drawing.x1, drawing.y1, chainStartPt!.x, chainStartPt!.y, scaleMmPx)
          const label = genLabel(drawType, lines)
          const closingId = addPlanLine({
            x1: drawing.x1, y1: drawing.y1,
            x2: chainStartPt!.x, y2: chainStartPt!.y,
            type: drawType, lengthMm, label,
            spec: drawSpec ?? undefined,
            heightMm: parseFloat(drawHeightMm) || 3000,
          })
          allLineIds = [...allLineIds, closingId]
        }

        // Создаём помещение из wall_existing-цепочки
        if (drawType === 'wall_existing' && allLineIds.length >= 3) {
          const finalIds = allLineIds
          setTimeout(() => {
            const storeLines = useProjectStore.getState().floorPlan?.lines ?? []
            const roomLines = finalIds
              .map(id => storeLines.find(l => l.id === id))
              .filter(Boolean) as PlanLine[]
            if (roomLines.length < 3) return
            const pts = extractContourPoints(finalIds, storeLines)
            const area = polygonAreaM2(pts.length >= 3 ? pts : roomLines.map(l => ({ x: l.x1, y: l.y1 })), scaleMmPx)
            const perimeter = roomLines.reduce((s, l) => s + l.lengthMm, 0)
            const count = (useProjectStore.getState().floorPlan?.rooms ?? []).length + 1
            addRoom({ lineIds: finalIds, areaM2: area, perimeterMm: perimeter, label: `Помещение ${count}` })
          }, 0)
        }

        setDrawing(null)
        setChainStartPt(null)
        setChainLineIds([])

      } else {
        if (!isPointAllowed(pt.x, pt.y, drawType)) return  // вне периметра
        const lengthMm = lineLengthMm(drawing.x1, drawing.y1, pt.x, pt.y, scaleMmPx)
        if (lengthMm < 10) { setDrawing(null); return }  // < 10мм — не линия, случайный клик
        const label = genLabel(drawType, lines)
        const newId = addPlanLine({
          x1: drawing.x1, y1: drawing.y1, x2: pt.x, y2: pt.y, type: drawType, lengthMm, label,
          spec: drawSpec ?? undefined, heightMm: parseFloat(drawHeightMm) || 3000,
        })
        setChainLineIds(prev => [...prev, newId])
        // Конец линии — НЕ автостарт следующей, ждём нового клика пользователя
        setDrawing(null)
      }
      return
    }
    if (mode === 'select') setSelected(null)
  }, [mode, drawing, lines, scaleMmPx, drawType, drawSpec, drawHeightMm, scaleStep, orthoMode, addPlanLine, removePlanLine])

  const handleLinePointerDown = useCallback((id: string, e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    // В режимах рисования/калибровки клик по уже нарисованной линии — это не выбор
    // этой линии, а попытка прицелиться T-снапом в её ось. Не перехватываем —
    // даём клику дойти до Stage, иначе коммит новой точки никогда не сработает.
    if (mode === 'draw' || mode === 'scale') return

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
      spec: l.spec,
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

  /**
   * Глобальная перекалибровка по уже начерченной линии:
   * пользователь указывает точный реальный размер одной линии —
   * масштаб всего плана пересчитывается, и lengthMm/areaM2/perimeterMm
   * у ВСЕХ линий, помещений и контуров обновляются под новый масштаб.
   * Координаты (x1,y1,x2,y2) не трогаются — меняется только масштаб
   * перевода px→мм и производные от него величины.
   */
  function recalibrateByLine(lineId: string, exactMm: number) {
    const target = lines.find(l => l.id === lineId)
    if (!target || exactMm <= 0) return
    const px = dist(target.x1, target.y1, target.x2, target.y2)
    if (px < 1) return
    const newScale = exactMm / px

    // Локально пересчитанные длины — используем их же для площадей помещений/контуров
    const newLengths = new Map<string, number>()
    for (const l of lines) {
      newLengths.set(l.id, lineLengthMm(l.x1, l.y1, l.x2, l.y2, newScale))
    }

    setFloorPlanScale(newScale)
    for (const l of lines) {
      updatePlanLine(l.id, { lengthMm: newLengths.get(l.id)! })
    }
    for (const room of rooms) {
      const pts = extractContourPoints(room.lineIds, lines)
      const area = polygonAreaM2(pts.length >= 3 ? pts : room.lineIds.map(id => {
        const l = lines.find(x => x.id === id); return l ? { x: l.x1, y: l.y1 } : { x: 0, y: 0 }
      }), newScale)
      const perimeter = room.lineIds.reduce((s, id) => s + (newLengths.get(id) ?? 0), 0)
      updateRoom(room.id, { areaM2: area, perimeterMm: perimeter })
    }
    for (const c of contours) {
      const pts = extractContourPoints(c.lineIds, lines)
      if (pts.length < 3) continue
      const area = polygonAreaM2(pts, newScale)
      updateContour(c.id, { areaM2: area })
    }
  }

  /** Следующий порядковый номер проёма данного типа (Д-N / О-N) — сквозная нумерация по всему плану */
  function nextOpeningLabel(type: 'door' | 'window'): string {
    const prefix = type === 'door' ? 'Д' : 'О'
    let maxN = 0
    for (const l of lines) {
      for (const op of l.openings ?? []) {
        if (op.type !== type) continue
        const m = op.label.match(/-(\d+)$/)
        if (m) maxN = Math.max(maxN, parseInt(m[1]))
      }
    }
    return `${prefix}-${maxN + 1}`
  }

  function addOpening(
    lineId: string, type: 'door' | 'window',
    offsetMm: number, widthMm: number, heightMm: number, sillHeightMm?: number,
  ) {
    const line = lines.find(l => l.id === lineId)
    if (!line) return
    if (offsetMm < 0 || widthMm <= 0 || heightMm <= 0 || offsetMm + widthMm > line.lengthMm) return
    const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const label = nextOpeningLabel(type)
    const opening: PlanOpening = { id, type, offsetMm, widthMm, heightMm, label }
    if (type === 'window' && sillHeightMm !== undefined) opening.sillHeightMm = sillHeightMm
    updatePlanLine(lineId, { openings: [...(line.openings ?? []), opening] })
  }

  function removeOpening(lineId: string, openingId: string) {
    const line = lines.find(l => l.id === lineId)
    if (!line) return
    updatePlanLine(lineId, { openings: (line.openings ?? []).filter(o => o.id !== openingId) })
  }

  function contourCentroid(c: PlanContour) {
    const pts = extractContourPoints(c.lineIds, lines)
    if (!pts.length) return null
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
  }

  const selectedLine  = lines.find(l => l.id === selectedId)

  // На мобильном — при выборе линии авто-открыть правую шторку, при снятии выбора — закрыть
  useEffect(() => {
    if (!isMobile) return
    if (selectedLine) { setMobileRightOpen(true); setMobileLeftOpen(false) }
    else setMobileRightOpen(false)
  }, [selectedId, isMobile])
  const inspectorLine = lines.find(l => l.id === inspectorId)
  const previewPt    = cursor ?? (drawing ? { x: drawing.x1, y: drawing.y1 } : null)
  const previewX2    = previewPt?.x ?? 0
  const previewY2    = previewPt?.y ?? 0
  // allPoints убраны — snap-точки на холсте не рисуются

  // ── Wall join: скорректированные точки для стыков ────────────────────────
  const wallJoins = useMemo(() => {
    const walls: WallForJoin[] = []
    lines.forEach((l, idx) => {
      const vis = getLineVisual(l.type, l.spec?.material, l.spec?.subtype)
      const hasSpec = !!(l.spec?.material)
      const thicknessPx = hasSpec && vis.thicknessMm > 0 ? vis.thicknessMm / scaleMmPx : 0
      if (thicknessPx <= 3) return
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1
      if (Math.sqrt(dx * dx + dy * dy) < 1) return
      walls.push({
        id: l.id,
        x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
        halfPx: thicknessPx / 2,
        createdIndex: idx,
      })
    })
    return computeWallJoins(walls)
  }, [lines, scaleMmPx])

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
    // Площадь = длина × высота стены, минус площадь проёмов (двери/окна по их
    // СОБСТВЕННОЙ высоте, не высоте стены) — материал на них не идёт
    const h = l.heightMm ?? 3000
    const openingsAreaM2 = (l.openings ?? []).reduce((s, op) => s + (op.widthMm * op.heightMm) / 1_000_000, 0)
    return Math.round((l.lengthMm * h / 1_000_000 - openingsAreaM2) * 100) / 100
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
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        {isMobile && (
          <button onClick={() => { setMobileLeftOpen(o => !o); setMobileRightOpen(false) }}
            title="Конструкции" style={{
              ...toolBtnStyle(mobileLeftOpen), padding: '6px 10px', fontSize: 16,
            }}>
            ☰
          </button>
        )}
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1e2433' }}>План объекта</span>
        <div style={{ flex: 1 }} />
        {!isMobile && (
          <span style={{ fontSize: 12, color: '#888' }}>
            Масштаб: {scaleMmPx >= 10 ? `${Math.round(scaleMmPx)}мм/рх` : `${scaleMmPx.toFixed(1)}мм/рх`}
          </span>
        )}
        {/* Undo/Redo placeholders */}
        {!isMobile && <button title="Отменить" style={toolBtnStyle(false)}>↩</button>}
        {!isMobile && <button title="Повторить" style={toolBtnStyle(false)}>↪</button>}
        <button onClick={() => { }} style={{ ...toolBtnStyle(false), minWidth: isMobile ? 0 : 90, padding: isMobile ? '6px 10px' : undefined }}>
          {isMobile ? '⬇' : 'Экспорт ▾'}
        </button>
        {lines.length > 0 && (
          <button onClick={() => { if (confirm('Очистить план?')) clearFloorPlan() }}
            style={{ padding: '5px 10px', fontSize: 12, border: '1px solid #e57373', background: '#fff', color: '#e53935', borderRadius: 5, cursor: 'pointer' }}>
            🗑
          </button>
        )}
        {isMobile && selectedLine && (
          <button onClick={() => { setMobileRightOpen(o => !o); setMobileLeftOpen(false) }}
            title="Параметры" style={{
              ...toolBtnStyle(mobileRightOpen), padding: '6px 10px', fontSize: 16,
            }}>
            ⚙
          </button>
        )}
      </div>


      {/* ── Трёхколоночный layout ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>

        {/* Затемнение фона при открытой шторке на мобильном */}
        {isMobile && (mobileLeftOpen || mobileRightOpen) && (
          <div onClick={() => { setMobileLeftOpen(false); setMobileRightOpen(false) }}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 20,
            }} />
        )}

        {/* ════════════════════ ЛЕВАЯ ПАНЕЛЬ ════════════════════ */}
        <div style={isMobile ? {
          ...leftPanelStyle,
          position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 21,
          transform: mobileLeftOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.22s ease',
          boxShadow: mobileLeftOpen ? '4px 0 16px rgba(0,0,0,0.25)' : 'none',
        } : leftPanelStyle}>

          {/* Конструкции — дерево материалов */}
          {([
            { label: 'Существующие стены', type: 'wall_existing' as PlanLineType },
            { label: 'Перегородки',        type: 'wall_new'      as PlanLineType },
            { label: 'Облицовки',          type: 'wall_lining'   as PlanLineType },
            { label: 'Потолки',            type: 'ceiling'        as PlanLineType },
            { label: 'Полы',               type: 'floor'          as PlanLineType },
          ]).map(({ label, type }) => {
            const nodes = TAXONOMY[type] ?? []
            return (
              <div key={type}>
                <div style={{ ...sectionHeaderStyle, color: LINE_COLORS[type] }}>{label}</div>
                {nodes.map(node => {
                  const hasChildren = (node.children?.length ?? 0) > 0
                  const expandKey = `${type}:${node.value}`
                  const isExpanded = expandedMaterial === expandKey
                  const visL1 = getLineVisual(type, node.value)
                  const nodeColor = visL1.colorOverride ?? LINE_COLORS[type]
                  const isActiveL1 = mode === 'draw' && drawType === type && drawSpec?.material === node.value
                  return (
                    <div key={node.value}>
                      <button
                        onClick={() => {
                          if (hasChildren) {
                            setExpandedMaterial(isExpanded ? null : expandKey)
                            setDrawType(type)
                          } else {
                            setDrawType(type)
                            setDrawSpec({ material: node.value })
                            setExpandedMaterial(null)
                            switchMode('draw')
                          }
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 14px', background: 'transparent', border: 'none',
                          cursor: 'pointer', width: '100%', textAlign: 'left', borderRadius: 0,
                          borderLeft: (isActiveL1 && !hasChildren) ? `3px solid ${nodeColor}` : '3px solid transparent',
                          color: isActiveL1 ? '#fff' : '#8a9ac8',
                          backgroundColor: isActiveL1 ? 'rgba(255,255,255,0.07)' : 'transparent',
                        }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: nodeColor, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, flex: 1, fontWeight: isActiveL1 ? 600 : 400 }}>{node.label}</span>
                        {hasChildren && <span style={{ fontSize: 10, color: '#4a5578' }}>{isExpanded ? '▴' : '▾'}</span>}
                      </button>
                      {hasChildren && isExpanded && node.children!.map(child => {
                        const visSub = getLineVisual(type, node.value, child.value)
                        const subColor = visSub.colorOverride ?? LINE_COLORS[type]
                        const isActiveSub = isActiveL1 && drawSpec?.subtype === child.value
                        return (
                          <button key={child.value}
                            onClick={() => {
                              setDrawType(type)
                              setDrawSpec({
                                material: node.value, subtype: child.value,
                                boardSubtype: drawSpec?.material === node.value ? drawSpec?.boardSubtype : 'standard',
                                layers: drawSpec?.material === node.value ? drawSpec?.layers : 1,
                              })
                              setExpandedMaterial(null)
                              switchMode('draw')
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 14px 6px 28px', background: 'transparent', border: 'none',
                              cursor: 'pointer', width: '100%', textAlign: 'left', borderRadius: 0,
                              borderLeft: isActiveSub ? `3px solid ${subColor}` : '3px solid transparent',
                              color: isActiveSub ? '#fff' : '#7a8ab0',
                              backgroundColor: isActiveSub ? 'rgba(255,255,255,0.06)' : 'transparent',
                            }}>
                            <span style={{ width: 6, height: 6, borderRadius: 1, background: subColor, flexShrink: 0, opacity: 0.8 }} />
                            <span style={{ fontSize: 11, fontWeight: isActiveSub ? 600 : 400 }}>{child.label}</span>
                          </button>
                        )
                      })}

                      {/* Тип листа + кол-во слоёв — только для ГКЛ, после выбора профиля/монтажа */}
                      {node.value === 'gkl' && isActiveL1 && drawSpec?.subtype && (
                        <div style={{ padding: '6px 14px 8px 28px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 10, color: '#7a8ab0', minWidth: 50 }}>Лист:</span>
                            <select
                              value={drawSpec.boardSubtype ?? 'standard'}
                              onChange={e => setDrawSpec({ ...drawSpec, boardSubtype: e.target.value as PlanLineSpec['boardSubtype'] })}
                              style={{ flex: 1, fontSize: 11, padding: '3px 5px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff' }}>
                              <option value="standard">Стандарт ГКЛ</option>
                              <option value="moisture">Влагостойкий ГКЛВ</option>
                              <option value="fire">Огнестойкий ГКЛО</option>
                              <option value="moisture_fire">Влагоогнестойкий ГКЛВО</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 10, color: '#7a8ab0', minWidth: 50 }}>Слоёв:</span>
                            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                              {([1, 2] as const).map(n => (
                                <button key={n}
                                  onClick={() => setDrawSpec({ ...drawSpec, layers: n })}
                                  style={{
                                    flex: 1, fontSize: 11, padding: '3px 0', borderRadius: 4,
                                    border: '1px solid #3a4060', cursor: 'pointer',
                                    background: (drawSpec.layers ?? 1) === n ? '#7c8fcf' : 'transparent',
                                    color: (drawSpec.layers ?? 1) === n ? '#fff' : '#8a9ac8',
                                  }}>
                                  {n} слой{n === 2 ? 'я' : ''}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

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

          <div style={{ height: 1, background: '#2a3045', margin: '8px 0' }} />

          {/* Подложка PDF */}
          <div style={sectionHeaderStyle}>Подложка (PDF)</div>
          <input ref={bgFileInputRef} type="file" accept="application/pdf" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleBgFileSelected(f); e.target.value = '' }} />

          {!floorPlan?.backgroundImage && !bgPendingFile && (
            <button onClick={() => bgFileInputRef.current?.click()} disabled={bgUploading}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px', background: 'transparent', border: 'none',
                cursor: bgUploading ? 'default' : 'pointer', width: '100%', textAlign: 'left',
                color: '#8a9ac8', fontSize: 12,
              }}>
              <span style={{ fontSize: 14, minWidth: 16, textAlign: 'center' }}>📄</span>
              <span>{bgUploading ? 'Загрузка…' : 'Загрузить PDF'}</span>
            </button>
          )}

          {bgPendingFile && (
            <div style={{ padding: '6px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#8a9ac8' }}>Страница (1–{bgPageCount}):</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" min={1} max={bgPageCount} value={bgPageInput}
                  onChange={e => setBgPageInput(e.target.value)}
                  style={{ width: 50, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff' }} />
                <button onClick={handleBgConfirmPage} disabled={bgUploading}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#7c8fcf', color: '#fff', cursor: 'pointer' }}>
                  {bgUploading ? '…' : 'Загрузить'}
                </button>
                <button onClick={() => setBgPendingFile(null)}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: 'none', background: 'transparent', color: '#8a9ac8', cursor: 'pointer' }}>
                  Отмена
                </button>
              </div>
            </div>
          )}

          {floorPlan?.backgroundImage && (
            <div style={{ padding: '6px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#8a9ac8', minWidth: 56 }}>Прозр.</span>
                <input type="range" min={0.1} max={1} step={0.05}
                  value={floorPlan.backgroundImage.opacity}
                  onChange={e => updateBackgroundImage({ opacity: parseFloat(e.target.value) })}
                  style={{ flex: 1 }} />
              </div>
              <button onClick={() => switchMode('scale')}
                style={{ fontSize: 11, padding: '6px 10px', borderRadius: 4, border: '1px solid #3a4060', background: mode === 'scale' ? '#7c8fcf' : 'transparent', color: '#fff', cursor: 'pointer' }}>
                📐 Откалибровать масштаб
              </button>
              <button onClick={() => { if (window.confirm('Удалить подложку?')) setBackgroundImage(null) }}
                style={{ fontSize: 11, padding: '6px 10px', borderRadius: 4, border: '1px solid #3a4060', background: 'transparent', color: '#e57373', cursor: 'pointer' }}>
                Удалить подложку
              </button>
            </div>
          )}

          {bgError && (
            <div style={{ padding: '4px 14px', fontSize: 11, color: '#e57373' }}>{bgError}</div>
          )}

          <div style={{ height: 1, background: '#2a3045', margin: '8px 0' }} />

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

          {/* Высота для новых конструкций — применяется ко всем линиям при рисовании */}
          <div style={{ padding: '4px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#8a9ac8', whiteSpace: 'nowrap' }}>Высота:</span>
            <input type="number" value={drawHeightMm}
              onChange={e => setDrawHeightMm(e.target.value)}
              style={{ width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff' }} />
            <span style={{ fontSize: 11, color: '#8a9ac8' }}>мм</span>
          </div>

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
            <div ref={containerRef}
              style={{
                border: '1px solid #dde', borderRadius: 8, overflow: 'hidden', background: '#fafafa',
                cursor: spaceDown ? (panStartRef.current ? 'grabbing' : 'grab')
                  : mode === 'draw' ? 'crosshair' : mode === 'select' ? 'default' : mode === 'erase' ? 'pointer' : 'default',
                touchAction: 'none',
                boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
              }}>
              <Stage ref={stageRef} width={canvasW} height={CANVAS_H}
                scaleX={stageScale} scaleY={stageScale}
                x={stagePos.x} y={stagePos.y}
                onClick={handleStageClick} onTap={handleStageClick}
                onMouseDown={handleStageMouseDown}
                onContextMenu={handleStageContextMenu}
                onMouseMove={handleMouseMove}
                onMouseUp={handlePointerUp}
                onWheel={handleWheel}>
                <Layer>
                  {/* Фон и сетка — адаптивные к zoom/pan */}
                  {(() => {
                    const x0 = -stagePos.x / stageScale - 100
                    const y0 = -stagePos.y / stageScale - 100
                    const x1 = (canvasW - stagePos.x) / stageScale + 100
                    const y1 = (CANVAS_H - stagePos.y) / stageScale + 100
                    const step = 50
                    const lw = 1 / stageScale
                    const gx0 = Math.floor(x0 / step) * step
                    const gy0 = Math.floor(y0 / step) * step
                    const vLines = []
                    const hLines = []
                    for (let x = gx0; x <= x1; x += step)
                      vLines.push(<Line key={`gv${x}`} points={[x, y0, x, y1]} stroke="#ebebeb" strokeWidth={lw} listening={false} />)
                    for (let y = gy0; y <= y1; y += step)
                      hLines.push(<Line key={`gh${y}`} points={[x0, y, x1, y]} stroke="#ebebeb" strokeWidth={lw} listening={false} />)
                    return [
                      <Rect key="bg" x={x0} y={y0} width={x1-x0} height={y1-y0} fill="#fafafa" listening={false} />,
                      ...vLines, ...hLines
                    ]
                  })()}

                  {/* Подложка PDF — под линиями, над сеткой */}
                  {floorPlan?.backgroundImage && bgImageEl && (() => {
                    const bg = floorPlan.backgroundImage!
                    return (
                      <KonvaImage
                        image={bgImageEl}
                        x={bg.x} y={bg.y}
                        width={bg.width} height={bg.height}
                        opacity={bg.opacity}
                        listening={false}
                      />
                    )
                  })()}

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
                    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x))
                    const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y))
                    const clickable = mode === 'select'
                    return (
                      <Group key={room.id} listening={clickable}>
                        <Line points={flatPts} closed fill="rgba(120,144,156,0.08)" stroke="none"
                          listening={clickable}
                          onClick={clickable ? (e) => { e.cancelBubble = true; setInspectorRoomId(room.id); setInspectorId(null) } : undefined}
                          onTap={clickable ? (e) => { e.cancelBubble = true; setInspectorRoomId(room.id); setInspectorId(null) } : undefined} />
                        {room.isColumn && (
                          <Group listening={false} clipFunc={ctx => {
                            ctx.beginPath()
                            pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
                            ctx.closePath()
                          }}>
                            {(() => {
                              const step = 14
                              const diag = (maxX - minX) + (maxY - minY)
                              const strokes = []
                              for (let d = -diag; d < diag; d += step) {
                                strokes.push(
                                  <Line key={d}
                                    points={[minX + d, minY, minX + d + (maxY - minY), maxY]}
                                    stroke="#78909c" strokeWidth={1} listening={false} />
                                )
                              }
                              return strokes
                            })()}
                          </Group>
                        )}
                        <Text x={cx - 70} y={cy - 18} width={140}
                          text={room.isColumn ? (room.label || 'Колонна') : room.label} fontSize={11} fill="#78909c" align="center" fontStyle="bold" listening={false} />
                        <Text x={cx - 70} y={cy - 2} width={140}
                          text={`${room.areaM2.toFixed(1)} м²`} fontSize={13} fill="#78909c" align="center" fontStyle="bold" listening={false} />
                        {!room.isColumn && (
                          <Text x={cx - 70} y={cy + 16} width={140}
                            text={`П: ${(room.perimeterMm / 1000).toFixed(1)} м`} fontSize={9} fill="#90a4ae" align="center" listening={false} />
                        )}
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
                      const hitW = Math.max(28, thicknessPx + 8)
                      const fill = isSelected ? stroke + '30' : inContour ? '#ff980022' : vis.fillColor
                      const sw = vis.strokeWidth

                      // ── Wall join: берём скорректированные точки если есть ──
                      const jw = wallJoins.get(l.id)

                      const fax1 = jw ? jw.ax1 : l.x1, fay1 = jw ? jw.ay1 : l.y1
                      const fax2 = jw ? jw.ax2 : l.x2, fay2 = jw ? jw.ay2 : l.y2
                      const cap1 = jw ? jw.cap1 : true
                      const cap2 = jw ? jw.cap2 : true
                      const ux = dx / len, uy = dy / len

                      // ── Разбивка на сегменты вокруг проёмов (дверей/окон) ──
                      const { segments, gaps } = computeOpeningSegments(
                        fax1, fay1, fax2, fay2, l.x1, l.y1, ux, uy, scaleMmPx, l.openings, cap1, cap2,
                      )

                      return (
                        <Group key={l.id}
                          onMouseDown={e => handleLinePointerDown(l.id, e)}
                          onTouchStart={e => handleLinePointerDown(l.id, e)}
                          onMouseEnter={() => setHoveredId(l.id)}
                          onMouseLeave={() => setHoveredId(null)}>
                          {/* Хитзона по оси — на всю линию, включая проёмы (чтобы клик попадал) */}
                          <Line points={[l.x1,l.y1,l.x2,l.y2]} stroke="transparent" strokeWidth={hitW} hitStrokeWidth={hitW} />

                          {segments.map((seg, si) => {
                            const sdx = seg.ax2-seg.ax1, sdy = seg.ay2-seg.ay1
                            const slen = Math.sqrt(sdx*sdx+sdy*sdy)
                            const snx = slen > 0 ? -sdy/slen*half : 0
                            const sny = slen > 0 ?  sdx/slen*half : 0
                            const sAx=seg.ax1+snx, sAy=seg.ay1+sny
                            const sBx=seg.ax2+snx, sBy=seg.ay2+sny
                            const sCx=seg.ax2-snx, sCy=seg.ay2-sny
                            const sDx=seg.ax1-snx, sDy=seg.ay1-sny
                            const sp1p = { x: sAx, y: sAy }, sp2p = { x: sBx, y: sBy }
                            const sp1m = { x: sDx, y: sDy }, sp2m = { x: sCx, y: sCy }
                            return (
                              <Group key={si}>
                                {/* Заливка сегмента */}
                                <Line points={[sAx,sAy, sBx,sBy, sCx,sCy, sDx,sDy]} closed fill={fill} stroke="none" listening={false} />
                                {/* Штриховка существующих конструкций */}
                                {l.type === 'wall_existing' && (() => {
                                  const hatch = calcHatch(sAx, sAy, sBx, sBy, sCx, sCy, sDx, sDy, 8)
                                  return (
                                    <Group clipFunc={(ctx: any) => {
                                      ctx.beginPath(); ctx.moveTo(sAx, sAy); ctx.lineTo(sBx, sBy)
                                      ctx.lineTo(sCx, sCy); ctx.lineTo(sDx, sDy); ctx.closePath()
                                    }} listening={false}>
                                      {hatch.map((pts, i) => (
                                        <Line key={i} points={pts} stroke="#78909c" strokeWidth={0.8} opacity={0.5} listening={false} />
                                      ))}
                                    </Group>
                                  )
                                })()}
                                {/* Граничные линии сегмента */}
                                <Line points={[sp1p.x,sp1p.y, sp2p.x,sp2p.y]} stroke={stroke} strokeWidth={sw} lineCap="butt" dash={dash} listening={false} />
                                <Line points={[sp1m.x,sp1m.y, sp2m.x,sp2m.y]} stroke={stroke} strokeWidth={sw} lineCap="butt" dash={dash} listening={false} />
                                {/* Торцы — на свободных концах ИЛИ на краях проёма */}
                                {seg.capStart && <Line points={[sp1p.x,sp1p.y, sp1m.x,sp1m.y]} stroke={stroke} strokeWidth={sw} lineCap="square" listening={false} />}
                                {seg.capEnd   && <Line points={[sp2p.x,sp2p.y, sp2m.x,sp2m.y]} stroke={stroke} strokeWidth={sw} lineCap="square" listening={false} />}
                              </Group>
                            )
                          })}

                          {/* Подписи проёмов (Д-1 / О-1) в разрыве */}
                          {gaps.map(g => (
                            <Text key={g.opening.id} x={g.x-40} y={g.y-7} width={80}
                              text={g.opening.label} fontSize={10} fill={stroke}
                              align="center" fontStyle="bold" listening={false} />
                          ))}

                          {/* Метка */}
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
                          {/* Размерная линия — только при hover или select */}
                          {!inErase && (isSelected || hoveredId === l.id) && (
                            <DimLineShapes x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                              lengthMm={l.lengthMm} offsetPx={half + 14}
                              dimColor={isSelected ? stroke : '#999'} />
                          )}
                          {/* Прозрачная хитзона для drag-handle при select */}
                          {isSelected && mode === 'select' && <>
                            <Circle x={l.x1} y={l.y1} radius={12} fill="transparent" stroke="transparent"
                              onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }}
                              onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }} />
                            <Circle x={l.x2} y={l.y2} radius={12} fill="transparent" stroke="transparent"
                              onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }}
                              onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }} />
                          </>}
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
                        {/* Прозрачная хитзона для drag-handle при select — без видимых маркеров */}
                        {isSelected && mode === 'select' && <>
                          <Circle x={l.x1} y={l.y1} radius={12} fill="transparent" stroke="transparent"
                            onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }}
                            onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end1',p.x,p.y) }} />
                          <Circle x={l.x2} y={l.y2} radius={12} fill="transparent" stroke="transparent"
                            onMouseDown={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }}
                            onTouchStart={e => { e.cancelBubble=true; const p=getPos(e); if(p) startDragLine(l.id,'end2',p.x,p.y) }} />
                        </>}
                      </Group>
                    )
                  })}

                  {/* Превью рисования */}
                  {mode === 'draw' && drawing && previewPt && (() => {
                    const previewVis = getLineVisual(drawType, drawSpec?.material, drawSpec?.subtype)
                    const previewColor = previewVis.colorOverride ?? LINE_COLORS[drawType]
                    return (
                      <>
                        <Line points={[drawing.x1,drawing.y1,previewX2,previewY2]}
                          stroke={previewColor} strokeWidth={LINE_WIDTH[drawType]} dash={[6,4]} opacity={0.6} lineCap="round" listening={false} />
                        {previewLabel(previewX2, previewY2) && (
                          <Text x={(drawing.x1+previewX2)/2-30} y={(drawing.y1+previewY2)/2-16}
                            width={60} text={previewLabel(previewX2,previewY2)}
                            fontSize={10} fill={previewColor} align="center" fontStyle="bold" listening={false} />
                        )}
                      </>
                    )
                  })()}

                  {/* Курсор снапа — крестик вместо круга */}
                  {cursor && mode === 'draw' && (() => {
                    const curVis = getLineVisual(drawType, drawSpec?.material, drawSpec?.subtype)
                    const curColor = curVis.colorOverride ?? LINE_COLORS[drawType]
                    const sz = 7 / stageScale
                    const sw = 1.5 / stageScale
                    const color = snapActive ? '#4caf50' : curColor
                    return (
                      <>
                        <Line points={[cursor.x - sz, cursor.y, cursor.x + sz, cursor.y]}
                          stroke={color} strokeWidth={sw} listening={false} />
                        <Line points={[cursor.x, cursor.y - sz, cursor.x, cursor.y + sz]}
                          stroke={color} strokeWidth={sw} listening={false} />
                      </>
                    )
                  })()}

                  {/* Точки масштаба — крестики, масштабируются с зумом для точности клика */}
                  {scalePt1 && (() => {
                    const sz = 6 / stageScale, sw = 1.5 / stageScale
                    return <>
                      <Line points={[scalePt1.x-sz,scalePt1.y, scalePt1.x+sz,scalePt1.y]} stroke="#ff9800" strokeWidth={sw} listening={false} />
                      <Line points={[scalePt1.x,scalePt1.y-sz, scalePt1.x,scalePt1.y+sz]} stroke="#ff9800" strokeWidth={sw} listening={false} />
                    </>
                  })()}
                  {scalePt2 && (() => {
                    const sz = 6 / stageScale, sw = 1.5 / stageScale
                    return <>
                      <Line points={[scalePt2.x-sz,scalePt2.y, scalePt2.x+sz,scalePt2.y]} stroke="#ff9800" strokeWidth={sw} listening={false} />
                      <Line points={[scalePt2.x,scalePt2.y-sz, scalePt2.x,scalePt2.y+sz]} stroke="#ff9800" strokeWidth={sw} listening={false} />
                      <Line points={[scalePt1!.x,scalePt1!.y,scalePt2.x,scalePt2.y]} stroke="#ff9800" strokeWidth={sw} dash={[4/stageScale,3/stageScale]} listening={false} />
                    </>
                  })()}

                  {/* Стартовая точка цепочки — маленькая мировая точка замыкания */}
                  {mode === 'draw' && chainStartPt && drawing && (
                    <Circle x={chainStartPt.x} y={chainStartPt.y} radius={4 / stageScale}
                      stroke="#4caf50" strokeWidth={1.5 / stageScale} fill="rgba(76,175,80,0.4)" listening={false} />
                  )}

                  {/* snap-точки концов убраны — они перекрывали конструкции */}
                </Layer>
              </Stage>
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
                        <td style={tdS}>
                          <input type="number" value={l.heightMm ?? 3000}
                            onClick={e => e.stopPropagation()}
                            onChange={e => {
                              const v = parseFloat(e.target.value)
                              if (v > 0) updatePlanLine(l.id, { heightMm: v })
                            }}
                            style={{ width: 64, fontSize: 11, padding: '3px 5px', borderRadius: 4, border: '1px solid #dde' }} /> мм
                        </td>
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
        {inspectorLine && (isMobile ? mobileRightOpen : true) && (
          <div style={isMobile ? {
            ...rightPanelStyle,
            position: 'absolute', top: 0, bottom: 0, right: 0, zIndex: 21,
            width: Math.min(RIGHT_W, window.innerWidth - 32),
            minWidth: 0, maxWidth: Math.min(RIGHT_W, window.innerWidth - 32),
            boxShadow: '-4px 0 16px rgba(0,0,0,0.25)',
          } : rightPanelStyle}>
            {isMobile && (
              <button onClick={() => setMobileRightOpen(false)} style={{
                position: 'absolute', top: 8, right: 8, zIndex: 1,
                width: 28, height: 28, borderRadius: 14, border: '1px solid #ddd',
                background: '#fff', cursor: 'pointer', fontSize: 14,
              }}>✕</button>
            )}
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

            {/* Уточнить точный размер — пересчитывает масштаб всего плана */}
            <div style={{ padding: '4px 16px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" placeholder="точный размер, мм" value={recalInput}
                onChange={e => setRecalInput(e.target.value)}
                style={{ flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 5, border: '1px solid #e0e4ee' }} />
              <button
                onClick={() => {
                  const mm = parseFloat(recalInput)
                  if (mm > 0) { recalibrateByLine(inspectorLine.id, mm); setRecalInput('') }
                }}
                disabled={!parseFloat(recalInput)}
                style={{ fontSize: 11, padding: '5px 10px', borderRadius: 5, border: 'none',
                  background: parseFloat(recalInput) > 0 ? '#3a7bd5' : '#ddd', color: '#fff',
                  cursor: parseFloat(recalInput) > 0 ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                Уточнить масштаб
              </button>
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

                  {/* Проёмы (двери/окна) */}
                  <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Проёмы</div>

                    {(inspectorLine.openings ?? []).length > 0 && (
                      <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(inspectorLine.openings ?? []).map(op => (
                          <div key={op.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '4px 6px', background: '#f7f8fb', borderRadius: 4 }}>
                            <span style={{ fontWeight: 600, color: op.type === 'door' ? '#8d6e63' : '#42a5f5', minWidth: 32 }}>{op.label}</span>
                            <span style={{ color: '#666' }}>
                              {op.type === 'door'
                                ? `дверь, отступ ${op.offsetMm}, ${op.widthMm}×${op.heightMm}мм`
                                : `окно, отступ ${op.offsetMm}, ${op.widthMm}×${op.heightMm}мм, низ от пола ${op.sillHeightMm ?? 900}мм`}
                            </span>
                            <button onClick={() => removeOpening(inspectorLine.id, op.id)}
                              style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#e57373', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      {(['door', 'window'] as const).map(t => (
                        <button key={t} onClick={() => { setOpeningType(t); setOpeningHeight(t === 'door' ? '2000' : '1200') }}
                          style={{
                            flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 4, cursor: 'pointer',
                            border: `1px solid ${openingType === t ? (t === 'door' ? '#8d6e63' : '#42a5f5') : '#dde'}`,
                            background: openingType === t ? (t === 'door' ? '#8d6e6320' : '#42a5f520') : '#fff',
                            color: openingType === t ? (t === 'door' ? '#8d6e63' : '#42a5f5') : '#888',
                          }}>
                          {t === 'door' ? 'Дверь' : 'Окно'}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <input type="number" placeholder="отступ, мм" value={openingOffset}
                        onChange={e => setOpeningOffset(e.target.value)}
                        style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 4, border: '1px solid #dde', minWidth: 0 }} />
                      <input type="number" placeholder="ширина, мм" value={openingWidth}
                        onChange={e => setOpeningWidth(e.target.value)}
                        style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 4, border: '1px solid #dde', minWidth: 0 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number"
                        placeholder={openingType === 'door' ? 'высота от пола, мм' : 'высота окна, мм'}
                        value={openingHeight}
                        onChange={e => setOpeningHeight(e.target.value)}
                        style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 4, border: '1px solid #dde', minWidth: 0 }} />
                      {openingType === 'window' && (
                        <input type="number" placeholder="низ окна от пола, мм" value={openingSill}
                          onChange={e => setOpeningSill(e.target.value)}
                          style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 4, border: '1px solid #dde', minWidth: 0 }} />
                      )}
                    </div>
                    <button
                      onClick={() => {
                        const offset = parseFloat(openingOffset), width = parseFloat(openingWidth)
                        const height = parseFloat(openingHeight)
                        const sill = openingType === 'window' ? parseFloat(openingSill) : undefined
                        if (offset >= 0 && width > 0 && height > 0) {
                          addOpening(inspectorLine.id, openingType, offset, width, height, sill)
                          setOpeningOffset(''); setOpeningWidth('')
                        }
                      }}
                      disabled={!(parseFloat(openingOffset) >= 0 && parseFloat(openingWidth) > 0 && parseFloat(openingHeight) > 0)}
                      style={{
                        width: '100%', marginTop: 4, fontSize: 11, padding: '6px 0', borderRadius: 4, border: 'none',
                        background: (parseFloat(openingOffset) >= 0 && parseFloat(openingWidth) > 0 && parseFloat(openingHeight) > 0) ? '#3a7bd5' : '#ddd',
                        color: '#fff', cursor: (parseFloat(openingOffset) >= 0 && parseFloat(openingWidth) > 0 && parseFloat(openingHeight) > 0) ? 'pointer' : 'not-allowed',
                      }}>
                      + Добавить проём
                    </button>
                    {parseFloat(openingOffset) >= 0 && parseFloat(openingWidth) > 0 &&
                      parseFloat(openingOffset) + parseFloat(openingWidth) > inspectorLine.lengthMm && (
                      <div style={{ fontSize: 10, color: '#e57373', marginTop: 4 }}>
                        Отступ + ширина превышают длину линии ({fmtLen(inspectorLine.lengthMm)})
                      </div>
                    )}
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
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    Высота:
                    <input type="number" value={inspectorLine.heightMm ?? 3000}
                      onChange={e => { const v = parseFloat(e.target.value); if (v > 0) updatePlanLine(inspectorLine.id, { heightMm: v }) }}
                      style={{ width: 64, fontSize: 12, padding: '3px 5px', borderRadius: 4, border: '1px solid #dde' }} /> мм
                  </div>
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
                    Площадь: <b>{calcLineArea(inspectorLine).toFixed(2)} м²</b>
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

        {/* ─── Мини-панель помещения / колонны ─── */}
        {!inspectorLine && inspectorRoomId && (() => {
          const room = rooms.find(r => r.id === inspectorRoomId)
          if (!room) return null
          return (
            <div style={isMobile ? {
              ...rightPanelStyle,
              position: 'absolute', top: 0, bottom: 0, right: 0, zIndex: 21,
              width: Math.min(RIGHT_W, window.innerWidth - 32),
              minWidth: 0, maxWidth: Math.min(RIGHT_W, window.innerWidth - 32),
              boxShadow: '-4px 0 16px rgba(0,0,0,0.25)',
            } : rightPanelStyle}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px 10px', borderBottom: '1px solid #e0e4ee', background: '#fff',
              }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{room.isColumn ? 'Колонна' : 'Помещение'}</div>
                <button title="Закрыть" style={iconBtnStyle2} onClick={() => setInspectorRoomId(null)}>✕</button>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ fontSize: 12, color: '#555' }}>
                  Название
                  <input value={room.label} onChange={e => updateRoom(room.id, { label: e.target.value })}
                    style={{ width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 5, fontSize: 13 }} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!room.isColumn}
                    onChange={e => updateRoom(room.id, { isColumn: e.target.checked })} />
                  Это колонна (заштриховать)
                </label>
                <div style={{ fontSize: 12, color: '#888' }}>
                  Площадь: <b>{room.areaM2.toFixed(2)} м²</b>
                  {!room.isColumn && <> · Периметр: <b>{(room.perimeterMm / 1000).toFixed(2)} м</b></>}
                </div>
                <button onClick={() => { removeRoom(room.id); setInspectorRoomId(null) }}
                  style={{ marginTop: 4, fontSize: 12, padding: '6px 10px', border: '1px solid #e53935', borderRadius: 5, color: '#e53935', background: '#fff', cursor: 'pointer' }}>
                  🗑 Удалить {room.isColumn ? 'колонну' : 'помещение'}
                </button>
              </div>
            </div>
          )
        })()}
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
