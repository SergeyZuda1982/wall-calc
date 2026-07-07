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
import { Stage, Layer, Line, Circle, Text, Rect, Group, Shape, Image as KonvaImage } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useProjectStore } from './store/useProjectStore'
import { useIsMobile } from './hooks/useIsMobile'
import type { PlanLine, PlanLineType, PlanLineSpec, PlanView, PlanContour, PlanOpening, LineCategory, WorkStatus, FastenerType, BoardSpec, RoundColumn, RectColumn, Room, WorkProgress, WorkStageTemplate } from './types'
import { DEFAULT_BOARD_SPEC } from './types'
import { getLineVisual, getContourFill, TAXONOMY } from './data/constructionTaxonomy'
import ConstructionSpecSelector from './components/ConstructionSpecSelector'
import { BoardSpecSelector } from './components/BoardSpecSelector'
import { WorkProgressChecklist } from './components/WorkProgressChecklist'
import { BUILTIN_WORK_STAGE_TEMPLATES } from './data/workStageTemplates'
import { lineProgressColor, lineProgressSummary } from './core/lineProgress'
import { aggregateProgressPercent } from './core/workProgress'
import { useTemplateStore } from './store/useTemplateStore'
import {
  rectColumnCornersPx, angleTo, snapAngleToStep, rectAreaM2, mmToPx, snapToColumnRow, nearestColumnCenter,
} from './core/columnStamp'
import { computeWallJoins } from './core/wallJoin'
import type { WallForJoin } from './core/wallJoin'
import { resolveAllAttachments, attachmentMaterialOf } from './core/attachmentResolver'
import type { AttachSurface, EndAttachment } from './core/attachmentResolver'
import { calcLineFasteners, calcProjectFasteners } from './core/calcAttachmentFasteners'
import { FASTENER_OPTIONS, ATTACHMENT_MATERIAL_LABEL, FASTENER_LABEL, suggestFastener, DEFAULT_FASTENER_STEP_MM } from './data/fastenerCatalog'
import { finishMaterialCategoryOf, finishSidesOf } from './core/finishResolver'
import { renderPdfPageToImage, getPdfPageCount } from './core/pdfBackground'
import { planLinesToSurfaceInputs } from './core/planLineToSurfaceInput'
import { calcProjectSheetLayout } from './core/calcProjectSheetLayout'
import type { ProjectSheetResult } from './core/calcProjectSheetLayout'
import { extractContourPoints } from './core/contour'
import { arcFromChordAndSagitta, arcLengthFromSagitta, sampleArcPoints, sagittaFromRadius, infiniteLineIntersection, openingOffsetFromClick } from './core/geometry2d'

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
  rib_beam:      '#37474f',
}
const LINE_LABELS_SHORT: Record<PlanLineType, string> = {
  wall_new:      'Перегородка',
  wall_lining:   'Облицовка',
  wall_existing: 'Сущ. конструкция',
  ceiling:       'Потолок',
  floor:         'Пол',
  rib_beam:      'Ригель',
}
const LINE_WIDTH: Record<PlanLineType, number> = {
  wall_new: 4, wall_lining: 3, wall_existing: 5, ceiling: 2, floor: 2, rib_beam: 5,
}
const HAS_SIDE_VIEW: PlanLineType[] = ['wall_new', 'wall_lining', 'floor']

/** Капитал по умолчанию — периметр (wall_existing) и ригели, всё остальное изменяемое */
function defaultCategory(type: PlanLineType): LineCategory {
  return (type === 'wall_existing' || type === 'rib_beam') ? 'capital' : 'mutable'
}
function defaultStatus(category: LineCategory): WorkStatus {
  return category === 'capital' ? 'existing' : 'planned'
}

type Mode = 'draw' | 'select' | 'contour' | 'scale' | 'erase' | 'pencil' | 'stamp' | 'trim' | 'opening'

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}
function lineLengthMm(x1: number, y1: number, x2: number, y2: number, s: number) {
  return Math.round(dist(x1, y1, x2, y2) * s)
}
/** Площадь сечения круглой колонны, м² — для инспектора */
function rectAreaM2Circle(diameterMm: number): number {
  const rM = diameterMm / 1000 / 2
  return Math.PI * rM * rM
}

/**
 * Стрела дуги для новой линии — в зависимости от выбранного в панели
 * способа ввода: напрямую (H) или через желаемый радиус (R). Для R —
 * если хорда (только что нарисованная) физически не влезает в
 * окружность такого радиуса, предупреждает и линия остаётся прямой,
 * а не молча рисует что-то неверное.
 */
function computeSagittaForNewLine(
  mode: 'sagitta' | 'radius', sagittaInput: string, radiusInput: string, deep: boolean, chordMm: number,
): number {
  if (mode === 'sagitta') return parseFloat(sagittaInput) || 0
  const R = parseFloat(radiusInput) || 0
  if (!R) return 0
  const h = sagittaFromRadius(chordMm, R, deep)
  if (h === null) {
    window.alert(`Радиус ${R} мм слишком мал для этой хорды (${Math.round(chordMm)} мм) — минимально возможный радиус ${Math.round(chordMm / 2)} мм (ровно полуокружность). Линия нарисована прямой.`)
    return 0
  }
  return h
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

      const vis = getLineVisual(l.type, l.spec?.material, l.spec?.subtype, l.spec?.gapMm)
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

// extractContourPoints вынесена в core/contour.ts (переиспользуется в planTo3D.ts)

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
  wall_new: 'П', wall_lining: 'О', wall_existing: 'С', ceiling: 'Пт', floor: 'Пл', rib_beam: 'Р',
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
    levels, activeLevelId, addLevel, duplicateLevel, removeLevel, renameLevel, setLevelElevation, selectLevel,
    addSlab, addSlabHole,
    addRoundColumn, updateRoundColumn, removeRoundColumn,
    addRectColumn, updateRectColumn, removeRectColumn,
    customWorkStageTemplates, addCustomWorkStageTemplate,
  } = useProjectStore()

  const allWorkStageTemplates: WorkStageTemplate[] = useMemo(
    () => [...BUILTIN_WORK_STAGE_TEMPLATES, ...(customWorkStageTemplates ?? [])],
    [customWorkStageTemplates],
  )

  const { templates, addTemplate, removeTemplate } = useTemplateStore()

  const lines     = floorPlan?.lines    ?? []
  const contours  = floorPlan?.contours ?? []
  const rooms     = floorPlan?.rooms    ?? []
  const slabs     = floorPlan?.slabs    ?? []
  const roundColumns = floorPlan?.roundColumns ?? []
  const rectColumns  = floorPlan?.rectColumns  ?? []
  const scaleMmPx = floorPlan?.scaleMmPerPx ?? 10

  // ── UI-состояние ──────────────────────────────────────────────────────────
  const [planView, setPlanView]         = useState<PlanView>('top')
  // Дефолт 'select', не 'draw' — иначе любое касание холста сразу после
  // открытия плана/загрузки подложки ставит точку новой линии, прежде
  // чем пользователь успел просто посмотреть/приблизить чертёж (жалоба
  // с мобильного, см. КОНСПЕКТ 06.07.2026). В 'select' одним пальцем
  // можно панорамировать (см. onTouchStartNative), рисование — по
  // явному нажатию инструмента.
  const [mode, setMode]                 = useState<Mode>('select')
  const [trimSourceId, setTrimSourceId] = useState<string | null>(null)  // первый клик инструмента "обрезать/продлить"
  const [drawType, setDrawType]         = useState<PlanLineType>('wall_new')
  const [drawSpec, setDrawSpec]         = useState<PlanLineSpec | null>(null)
  const [drawHeightMm, setDrawHeightMm] = useState('3000')
  const [drawSagittaMm, setDrawSagittaMm] = useState('0')  // стрела дуги для новых линий, 0 = прямая
  const [drawArcMode, setDrawArcMode] = useState<'sagitta' | 'radius'>('sagitta')  // способ задания дуги при рисовании
  const [drawRadiusMm, setDrawRadiusMm] = useState('')      // радиус R — альтернатива стреле H (нужен известный R на разных пролётах)
  const [drawArcDeep, setDrawArcDeep] = useState(false)     // при R>L — какое из двух решений (пологое/глубокое)
  const [inspectorArcDeep, setInspectorArcDeep] = useState(false)  // то же самое, но для поля R в инспекторе
  const [drawRibWidthMm, setDrawRibWidthMm] = useState('300')  // ригель: ширина сечения по плану, мм
  const [drawRibDropMm, setDrawRibDropMm]   = useState('200')  // ригель: опускание низа от плиты перекрытия, мм
  const [pencilPts, setPencilPts] = useState<{ x: number; y: number }[]>([])       // карандаш: накопленные точки контура
  const [pencilHoleTargetId, setPencilHoleTargetId] = useState<string | null>(null) // если задано — рисуем дырку В этой плите, а не новую плиту
  const [stampTemplateId, setStampTemplateId] = useState<string | null>(null)  // активный шаблон для штамповки колонн
  const [stampCenter, setStampCenter] = useState<{ x: number; y: number } | null>(null) // прямоугольный шаблон: центр зафиксирован, ждём 2-й клик (угол)
  // Последняя поставленная штампом колонна (круглая или прямоугольная) — чтобы
  // ПКМ могла отменить именно её, если сейчас нет промежуточного шага (ожидания
  // клика по углу поворота). Обновляется при каждой успешной штамповке, гасится
  // при выходе из режима stamp (см. switchMode) — отмена работает только "назад
  // на один шаг" в рамках текущей сессии штамповки, не полноценный undo-стек.
  const lastStampedRef = useRef<{ id: string; kind: 'round' | 'rect' } | null>(null)

  // Центры уже поставленных колонн (круглые — прямо, прямоугольные — центроид
  // их 4-точечного контура Room с isColumn:true) — для снапа новой колонны
  // в один ряд с Ctrl при штамповке, см. snapToColumnRow в columnStamp.ts.
  const existingColumnCenters = useMemo(() => {
    const fromRound = roundColumns.map(rc => ({ cx: rc.cx, cy: rc.cy }))
    const fromRect = rectColumns.map(rc => ({ cx: rc.cx, cy: rc.cy }))
    const fromLegacyRoomColumns = rooms
      .filter(r => r.isColumn)
      .map(r => {
        const pts = extractContourPoints(r.lineIds, lines)
        if (pts.length === 0) return null
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
        return { cx, cy }
      })
      .filter((c): c is { cx: number; cy: number } => c !== null)
    return [...fromRound, ...fromRect, ...fromLegacyRoomColumns]
  }, [roundColumns, rectColumns, rooms, lines])
  const [drawStep, setDrawStep] = useState('600')
  const [drawLayer1, setDrawLayer1] = useState<BoardSpec>(DEFAULT_BOARD_SPEC)
  const [drawLayer2, setDrawLayer2] = useState<BoardSpec>(DEFAULT_BOARD_SPEC)
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
  const [showSheetSummary, setShowSheetSummary] = useState(false)
  const [showFastenerSummary, setShowFastenerSummary] = useState(false)
  const [showParallelDialog, setShowParallelDialog] = useState(false)
  const [parallelDist, setParallelDist]             = useState('100')
  const [rightTab, setRightTab]         = useState<'construction' | 'finish' | 'materials' | 'calc'>('construction')
  const [hoveredId, setHoveredId]       = useState<string | null>(null)
  const [snapActive, setSnapActive]     = useState(false)
  const [inspectorId, setInspectorId]   = useState<string | null>(null)
  const [inspectorRoomId, setInspectorRoomId] = useState<string | null>(null)
  const [inspectorRoundColumnId, setInspectorRoundColumnId] = useState<string | null>(null)
  const [inspectorRectColumnId, setInspectorRectColumnId] = useState<string | null>(null)
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
  // Konva слушает touch-события САМА (для своего onTap/onClick), независимо от наших
  // кастомных обработчиков ниже. Из-за этого после пинч-зума (или панорамы) Konva иногда
  // всё равно засчитывает жест как "тап" по первому пальцу и вызывает handleStageClick —
  // отсюда баг "любой зум ставит точку". Этот флаг взводится, как только в текущей
  // тач-последовательности случился пинч (2 пальца) или реальная панорама, и проверяется
  // в начале handleStageClick — если взведён, тач-клик игнорируется целиком. Сбрасывается
  // не по touchend (порядок срабатывания слушателей относительно Konva не гарантирован),
  // а в начале СЛЕДУЮЩЕЙ последовательности (первый палец новой последовательности).
  const touchGestureRef = useRef(false)

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
  const [openingType, setOpeningType]         = useState<'door' | 'window' | 'opening'>('door')
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
  // Исходный файл PDF — только в памяти текущей сессии (сами байты PDF
  // никуда не сохраняются, чтобы не раздувать localStorage/Supabase).
  // lastRenderedDataUrl нужен, чтобы не пытаться дорендерить чужую
  // подложку после переключения этажа (там свой PDF или его вообще нет).
  const bgSourceRef = useRef<{ file: File; pageNum: number; lastRenderedDataUrl: string } | null>(null)
  const bgRerenderTimeoutRef = useRef<number | null>(null)
  const bgRerenderingRef = useRef(false)
  // true между "дорендер подложки закончился" и следующим прогоном эффекта
  // автоцентрирования — говорит ему: это не новая подложка, а та же картинка
  // просто перерисована чётче на том же месте, экран трогать не нужно.
  // Без этого флага автоцентрирование срабатывало прямо во время рисования
  // карандашом (стоило зуму спровоцировать дорендер) — экран "отлетал"
  // от пользователя посреди работы, см. КОНСПЕКТ по багу 05.07.2026.
  const bgRerenderSkipFitRef = useRef(false)

  // Загружаем HTMLImageElement из dataUrl при изменении подложки в сторе
  useEffect(() => {
    const url = floorPlan?.backgroundImage?.dataUrl
    if (!url) { setBgImageEl(null); return }
    const img = new window.Image()
    img.onload = () => setBgImageEl(img)
    img.src = url
  }, [floorPlan?.backgroundImage?.dataUrl])

  // Дорендер подложки из исходного PDF при сильном зуме холста — если
  // текущая картинка растягивается заметно крупнее, чем позволяет её
  // родное разрешение (отсюда и размытие), перерисовываем страницу из
  // PDF заново под нужный масштаб. Работает только пока файл ещё жив
  // в памяти этой сессии (bgSourceRef) и относится именно к ТЕКУЩЕЙ
  // подложке (lastRenderedDataUrl) — иначе после переключения этажа
  // на другую подложку тут пытались бы дорендерить чужой PDF.
  useEffect(() => {
    const bg = floorPlan?.backgroundImage
    const src = bgSourceRef.current
    if (!bg || !bgImageEl || !src) return
    if (bg.dataUrl !== src.lastRenderedDataUrl) return  // подложка сменилась не через этот PDF (другой этаж/файл)
    if (bgRerenderingRef.current) return

    const displayedLongSidePx = Math.max(bg.width, bg.height) * stageScale
    const nativeLongSidePx = Math.max(bgImageEl.naturalWidth, bgImageEl.naturalHeight)
    const MARGIN = 1.3  // не пересчитываем из-за каждого пикселя — только когда реально не хватает
    if (displayedLongSidePx <= nativeLongSidePx * MARGIN) return

    if (bgRerenderTimeoutRef.current) window.clearTimeout(bgRerenderTimeoutRef.current)
    bgRerenderTimeoutRef.current = window.setTimeout(async () => {
      const s = bgSourceRef.current
      if (!s) return
      bgRerenderingRef.current = true
      try {
        const targetLongSidePx = displayedLongSidePx * 1.3  // с запасом, чтобы не пересчитывать на каждый чих
        const res = await renderPdfPageToImage(s.file, s.pageNum, { targetLongSidePx })
        bgSourceRef.current = { ...s, lastRenderedDataUrl: res.dataUrl }
        // Мировые width/height (позиция и размер на плане) НЕ трогаем —
        // меняется только сама картинка, она просто чётче в текущем зуме.
        // Это не "новая подложка" — эффект автоцентрирования ниже должен
        // это обновление пропустить (см. bgRerenderSkipFitRef выше).
        bgRerenderSkipFitRef.current = true
        updateBackgroundImage({ dataUrl: res.dataUrl })
      } catch {
        // тихо не получилось (например, файл больше недоступен) — остаёмся
        // на текущей картинке, не мешаем работе всплывающими ошибками
      } finally {
        bgRerenderingRef.current = false
      }
    }, 500)

    return () => { if (bgRerenderTimeoutRef.current) window.clearTimeout(bgRerenderTimeoutRef.current) }
  }, [stageScale, floorPlan?.backgroundImage, bgImageEl, updateBackgroundImage])

  // Автоцентрирование канваса сразу после загрузки/смены подложки — чтобы не потерять её из виду.
  // Пропускаем, если это не новая подложка, а просто дорендер той же картинки
  // на резкость (bgRerenderSkipFitRef) — иначе экран "отлетал" прямо во время
  // рисования, стоило зуму спровоцировать дорендер (баг 05.07.2026).
  useEffect(() => {
    if (bgRerenderSkipFitRef.current) { bgRerenderSkipFitRef.current = false; return }
    if (!floorPlan?.backgroundImage) return
    const t = setTimeout(() => fitToContent(), 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        bgSourceRef.current = { file, pageNum: 1, lastRenderedDataUrl: res.dataUrl }
        setBackgroundImage({
          dataUrl: res.dataUrl, x: 0, y: 0,
          width: res.width, height: res.height,
          opacity: 0.6, locked: true,
        })
        setMode('select')
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
      bgSourceRef.current = { file: bgPendingFile, pageNum: page, lastRenderedDataUrl: res.dataUrl }
      setBackgroundImage({
        dataUrl: res.dataUrl, x: 0, y: 0,
        width: res.width, height: res.height,
        opacity: 0.6, locked: true,
      })
      setMode('select')
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

  // Ctrl (или Cmd на Mac) — снап новой колонны в ряд с уже поставленными
  // (штамповка шаблона, см. handleStageClick, mode==='stamp'). Держим как
  // состояние (не читаем ctrlKey только в момент клика), чтобы превью до
  // клика тоже подсвечивало, куда прилипнет — аналогично spaceDown выше.
  const [ctrlDown, setCtrlDown] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if ((e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'MetaLeft' || e.code === 'MetaRight') && !e.repeat) setCtrlDown(true) }
    const up   = (e: KeyboardEvent) => { if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'MetaLeft' || e.code === 'MetaRight') setCtrlDown(false) }
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
    if (m !== 'stamp') { setStampTemplateId(null); setStampCenter(null); lastStampedRef.current = null }
    if (m !== 'trim') setTrimSourceId(null)
    if (isMobile && m === 'draw') setMobileLeftOpen(false)
  }

  // Выбор шаблона колонны в левой панели → включает режим штампа сразу с этим шаблоном
  function selectTemplateForStamp(id: string) {
    setMode('stamp')
    setStampTemplateId(id)
    setStampCenter(null)
    if (isMobile) setMobileLeftOpen(false)
  }

  // ── Сохранить существующую колонну как шаблон (мех-сначала-форма-потом: window.prompt) ──
  function saveRectColumnAsTemplate(room: Room) {
    const roomLines = room.lineIds.map(id => lines.find(l => l.id === id)).filter(Boolean) as PlanLine[]
    if (roomLines.length < 2) { window.alert('У этой колонны меньше 2 линий — не удалось определить размеры.'); return }
    const widthMm = roomLines[0].lengthMm
    const depthMm = roomLines[1].lengthMm
    const spec = roomLines[0].spec
    const name = window.prompt('Название шаблона:', room.label || 'Колонна')
    if (!name) return
    addTemplate({ kind: 'rectColumn', name, widthMm, depthMm, spec })
  }

  function saveRoundColumnAsTemplate(rc: RoundColumn) {
    const name = window.prompt('Название шаблона:', rc.label || 'Колонна')
    if (!name) return
    addTemplate({ kind: 'roundColumn', name, diameterMm: rc.diameterMm, spec: rc.spec })
  }

  // ── Новый шаблон "с нуля" — без уже нарисованной колонны-образца на плане ──
  // (материал у такого шаблона не задан — донастраивается после штамповки, у
  // самой поставленной колонны, как и остальные её параметры)
  function createRectTemplateFromScratch() {
    const name = window.prompt('Название шаблона:', 'Колонна')
    if (!name) return
    const widthMm = parseFloat(window.prompt('Ширина, мм:', '400') || '')
    if (!(widthMm > 0)) { window.alert('Ширина должна быть положительным числом.'); return }
    const depthMm = parseFloat(window.prompt('Глубина, мм:', '400') || '')
    if (!(depthMm > 0)) { window.alert('Глубина должна быть положительным числом.'); return }
    addTemplate({ kind: 'rectColumn', name, widthMm, depthMm })
  }

  function createRoundTemplateFromScratch() {
    const name = window.prompt('Название шаблона:', 'Колонна')
    if (!name) return
    const diameterMm = parseFloat(window.prompt('Диаметр, мм:', '400') || '')
    if (!(diameterMm > 0)) { window.alert('Диаметр должен быть положительным числом.'); return }
    addTemplate({ kind: 'roundColumn', name, diameterMm })
  }

  // Сохранение шаблона от прямоугольной колонны-СУЩНОСТИ (RectColumn, с 05.07.2026).
  // Старую saveRectColumnAsTemplate(room: Room) выше не трогаем — она нужна
  // для уже расставленных ранее колонн старого образца (Room+4 линии).
  function saveRectColumnEntityAsTemplate(rc: RectColumn) {
    const name = window.prompt('Название шаблона:', rc.label || 'Колонна')
    if (!name) return
    addTemplate({ kind: 'rectColumn', name, widthMm: rc.widthMm, depthMm: rc.depthMm, spec: rc.spec })
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
        const chordMm = lineLengthMm(s.x, s.y, l.x2, l.y2, scaleMmPx)
        const lm = l.sagittaMm ? arcLengthFromSagitta(chordMm, l.sagittaMm) : chordMm
        updatePlanLine(dr.id, { x1: s.x, y1: s.y, lengthMm: lm })
      } else {
        const thresh = SNAP_SCREEN_PX / stageScaleRef.current
        const s = snapPoint(rawX, rawY, lines, scaleMmPx, dr.id, thresh)
        const l = lines.find(l => l.id === dr.id)!
        const chordMm = lineLengthMm(l.x1, l.y1, s.x, s.y, scaleMmPx)
        const lm = l.sagittaMm ? arcLengthFromSagitta(chordMm, l.sagittaMm) : chordMm
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
        touchGestureRef.current = true
        const m = touchMid(te.touches[0], te.touches[1])
        pinchRef.current = {
          dist: touchDist(te.touches[0], te.touches[1]),
          scale: stageScaleRef.current,
          midX: m.x, midY: m.y,
        }
        return
      }

      if (te.touches.length === 1) {
        // Новая тач-последовательность (первый палец) — сбрасываем метку
        // предыдущего жеста, чтобы не заблокировать следующий обычный тап.
        touchGestureRef.current = false
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
        touchGestureRef.current = true
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
        touchGestureRef.current = true
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

  // ── Показать всё: центрирует и вписывает все линии + подложку в экран ─────
  function fitToContent() {
    const pts: { x: number; y: number }[] = []
    lines.forEach(l => { pts.push({ x: l.x1, y: l.y1 }); pts.push({ x: l.x2, y: l.y2 }) })
    const bg = floorPlan?.backgroundImage
    if (bg) {
      pts.push({ x: bg.x, y: bg.y })
      pts.push({ x: bg.x + bg.width, y: bg.y + bg.height })
    }
    if (pts.length === 0) { setStageScale(1); setStagePos({ x: 0, y: 0 }); return }
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x))
    const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y))
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1)
    const pad = 60
    const newScale = Math.min((canvasW - pad * 2) / w, (CANVAS_H - pad * 2) / h, 5)
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    setStageScale(newScale)
    setStagePos({ x: canvasW / 2 - cx * newScale, y: CANVAS_H / 2 - cy * newScale })
  }

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
    if (mode === 'pencil') {
      setPencilPts(prev => prev.slice(0, -1))
    }
    if (mode === 'stamp') {
      if (stampCenter) {
        // Прямоугольная колонна: ждём 2-й клик (угол) — отменяем именно этот
        // промежуточный шаг, колонна ещё не поставлена.
        setStampCenter(null)
      } else if (lastStampedRef.current) {
        // Ничего не ожидаем — отменяем последнюю реально поставленную колонну.
        const { id, kind } = lastStampedRef.current
        if (kind === 'round') removeRoundColumn(id)
        else removeRectColumn(id)
        lastStampedRef.current = null
      }
    }
  }

  // ── Ограничение черчения внутри периметра ─────────────────────────────────
  function isPointAllowed(x: number, y: number, type: PlanLineType): boolean {
    if (type === 'wall_existing' || type === 'rib_beam') return true
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
    // Konva сама детектирует 'tap' по touch-событиям, независимо от нашего
    // кастомного пинч/пан-кода ниже. Если в этой тач-последовательности уже
    // был пинч или реальная панорама — это хвост жеста, а не настоящий тап,
    // игнорируем целиком (см. комментарий у touchGestureRef).
    if ('changedTouches' in e.evt && touchGestureRef.current) return
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

    if (mode === 'stamp') {
      const tpl = templates.find(t => t.id === stampTemplateId)
      if (!tpl) return

      if (tpl.kind === 'roundColumn') {
        // Круглая колонна — поворот не нужен, один клик и готово
        const pt = applySnap(pos.x, pos.y)
        const ctrlHeld = ctrlDown || ('ctrlKey' in e.evt && e.evt.ctrlKey) || ('metaKey' in e.evt && e.evt.metaKey)
        const final = ctrlHeld ? snapToColumnRow(pt.x, pt.y, existingColumnCenters) : pt
        const count = (useProjectStore.getState().floorPlan?.roundColumns ?? []).length + 1
        const newId = addRoundColumn({
          cx: final.x, cy: final.y, diameterMm: tpl.diameterMm, spec: tpl.spec,
          category: 'capital', workStatus: 'existing', label: `Колонна ${count}`,
        })
        lastStampedRef.current = { id: newId, kind: 'round' }
        return
      }

      // Прямоугольная колонна: 1-й клик — центр (Ctrl — снап в ряд с соседними
      // колоннами), 2-й — угол поворота (Shift/⊾90° — привязка к 15°)
      if (!stampCenter) {
        const pt = applySnap(pos.x, pos.y)
        const ctrlHeld = ctrlDown || ('ctrlKey' in e.evt && e.evt.ctrlKey) || ('metaKey' in e.evt && e.evt.metaKey)
        const final = ctrlHeld ? snapToColumnRow(pt.x, pt.y, existingColumnCenters) : pt
        setStampCenter({ x: final.x, y: final.y })
        return
      }

      let angle = angleTo(stampCenter.x, stampCenter.y, pos.x, pos.y)
      if (orthoMode) angle = snapAngleToStep(angle, 15)

      const count = (useProjectStore.getState().floorPlan?.rectColumns ?? []).length + 1
      const newId = addRectColumn({
        cx: stampCenter.x, cy: stampCenter.y, widthMm: tpl.widthMm, depthMm: tpl.depthMm, angleRad: angle,
        spec: tpl.spec, category: 'capital', workStatus: 'existing', label: `Колонна ${count}`,
      })
      lastStampedRef.current = { id: newId, kind: 'rect' }
      setStampCenter(null)
      return
    }

    if (mode === 'pencil') {
      const pt = applySnap(pos.x, pos.y)
      const closeThresh = SNAP_SCREEN_PX / stageScaleRef.current
      const closing = pencilPts.length >= 3 && dist(pt.x, pt.y, pencilPts[0].x, pencilPts[0].y) <= closeThresh
      if (closing) {
        if (pencilHoleTargetId) {
          addSlabHole(pencilHoleTargetId, pencilPts)
        } else {
          addSlab(pencilPts)
        }
        setPencilPts([])
        return
      }
      // Клик рядом с уже поставленной точкой контура (не первой — та замыкает,
      // см. выше) — удалить именно её, не только последнюю через ПКМ.
      const hitIdx = pencilPts.findIndex((p, i) => i > 0 && dist(pt.x, pt.y, p.x, p.y) <= closeThresh)
      if (hitIdx !== -1) {
        setPencilPts(prev => prev.filter((_, i) => i !== hitIdx))
        return
      }
      setPencilPts(prev => [...prev, { x: pt.x, y: pt.y }])
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
          const straightLenMm = lineLengthMm(drawing.x1, drawing.y1, chainStartPt!.x, chainStartPt!.y, scaleMmPx)
          const sagittaMm = computeSagittaForNewLine(drawArcMode, drawSagittaMm, drawRadiusMm, drawArcDeep, straightLenMm)
          const lengthMm = sagittaMm ? arcLengthFromSagitta(straightLenMm, sagittaMm) : straightLenMm
          const label = genLabel(drawType, lines)
          const closingId = addPlanLine({
            x1: drawing.x1, y1: drawing.y1,
            x2: chainStartPt!.x, y2: chainStartPt!.y,
            type: drawType, lengthMm, label,
            spec: drawSpec ? { ...drawSpec, step: parseFloat(drawStep) || 600, layer1: drawLayer1, layer2: drawLayer2 } : undefined,
            heightMm: parseFloat(drawHeightMm) || 3000,
            category: defaultCategory(drawType), workStatus: defaultStatus(defaultCategory(drawType)),
            ...(drawType === 'rib_beam' ? { sectionWidthMm: parseFloat(drawRibWidthMm) || 300, dropMm: parseFloat(drawRibDropMm) || 200 } : {}),
            ...(sagittaMm ? { sagittaMm } : {}),
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
        const straightLenMm = lineLengthMm(drawing.x1, drawing.y1, pt.x, pt.y, scaleMmPx)
        if (straightLenMm < 10) { setDrawing(null); return }  // < 10мм — не линия, случайный клик
        const sagittaMm = computeSagittaForNewLine(drawArcMode, drawSagittaMm, drawRadiusMm, drawArcDeep, straightLenMm)
        const lengthMm = sagittaMm ? arcLengthFromSagitta(straightLenMm, sagittaMm) : straightLenMm
        const label = genLabel(drawType, lines)
        const newId = addPlanLine({
          x1: drawing.x1, y1: drawing.y1, x2: pt.x, y2: pt.y, type: drawType, lengthMm, label,
          spec: drawSpec ? { ...drawSpec, step: parseFloat(drawStep) || 600, layer1: drawLayer1, layer2: drawLayer2 } : undefined, heightMm: parseFloat(drawHeightMm) || 3000,
          category: defaultCategory(drawType), workStatus: defaultStatus(defaultCategory(drawType)),
          ...(drawType === 'rib_beam' ? { sectionWidthMm: parseFloat(drawRibWidthMm) || 300, dropMm: parseFloat(drawRibDropMm) || 200 } : {}),
          ...(sagittaMm ? { sagittaMm } : {}),
        })
        setChainLineIds(prev => [...prev, newId])
        // Конец линии — НЕ автостарт следующей, ждём нового клика пользователя
        setDrawing(null)
      }
      return
    }
    if (mode === 'select') setSelected(null)
  }, [mode, drawing, lines, scaleMmPx, drawType, drawSpec, drawHeightMm, drawSagittaMm, drawArcMode, drawRadiusMm, drawArcDeep, drawRibWidthMm, drawRibDropMm, drawStep, drawLayer1, drawLayer2, scaleStep, orthoMode, addPlanLine, removePlanLine, pencilPts, pencilHoleTargetId, addSlab, addSlabHole, templates, stampTemplateId, stampCenter, addRoundColumn, addRectColumn, addRoom, ctrlDown, existingColumnCenters])

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
    if (mode === 'trim') {
      if (!trimSourceId) {
        setTrimSourceId(id)               // первый клик — что обрезаем/продлеваем
      } else if (trimSourceId === id) {
        setTrimSourceId(null)             // клик по той же линии — отмена
      } else {
        performTrim(trimSourceId, id)     // второй клик — до чего обрезаем/продлеваем
        setTrimSourceId(null)
      }
      return
    }
    if (mode === 'opening') {
      const line = lines.find(l => l.id === id)
      if (line) placeOpeningOnLine(line, pos.x, pos.y)
      return
    }
    if (mode === 'select') {
      startDragLine(id, 'line', pos.x, pos.y)
    }
    setSelected(id)
  }, [mode, lines, trimSourceId, openingType, openingWidth, openingHeight, openingSill])

  /**
   * Обрезать/продлить линию source до пересечения с бесконечным продолжением
   * линии target — двигаем тот конец source, что БЛИЖЕ к точке пересечения
   * (если он был "недотянут" — продлеваем, если "перелетел" — обрезаем;
   * одна операция покрывает оба случая, как их обычно и понимают на объекте).
   *
   * Пока только для прямых линий — дуга (sagittaMm) требует пересечения
   * с окружностью, это другая геометрия, не реализовано (см. KONSPEKT.md).
   */
  function performTrim(sourceId: string, targetId: string) {
    const source = lines.find(l => l.id === sourceId)
    const target = lines.find(l => l.id === targetId)
    if (!source || !target) return
    if (source.sagittaMm || target.sagittaMm) {
      window.alert('Обрезка/продление пока не поддерживает дуги — только прямые линии.')
      return
    }
    const ip = infiniteLineIntersection(source.x1, source.y1, source.x2, source.y2, target.x1, target.y1, target.x2, target.y2)
    if (!ip) {
      window.alert('Эти линии параллельны — обрезать/продлить одну до другой нельзя.')
      return
    }
    const d1 = dist(source.x1, source.y1, ip.x, ip.y)
    const d2 = dist(source.x2, source.y2, ip.x, ip.y)
    if (d1 <= d2) {
      const lengthMm = lineLengthMm(ip.x, ip.y, source.x2, source.y2, scaleMmPx)
      updatePlanLine(sourceId, { x1: ip.x, y1: ip.y, lengthMm })
    } else {
      const lengthMm = lineLengthMm(source.x1, source.y1, ip.x, ip.y, scaleMmPx)
      updatePlanLine(sourceId, { x2: ip.x, y2: ip.y, lengthMm })
    }
    setSelected(sourceId)
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (mode === 'erase') {
        setEraseIds([])
        switchMode('select')
      } else if (mode === 'stamp') {
        if (stampCenter) setStampCenter(null)  // сначала отменяем только промежуточный шаг (ждём угол)
        else switchMode('select')              // нечего отменять — выходим из режима штампа целиком
      } else if (mode === 'trim') {
        setTrimSourceId(null)
      } else {
        setDrawing(null); setSelected(null); setScaleStep(0); setScalePt1(null); setScalePt2(null)
        setPencilPts([])
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
  }, [selectedId, removePlanLine, mode, eraseIds, stampCenter])

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
      category: l.category ?? defaultCategory(l.type),
      workStatus: l.workStatus,
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

  /** Следующий порядковый номер проёма данного типа (Д-N / О-N / Пр-N) — сквозная нумерация по всему плану */
  function nextOpeningLabel(type: 'door' | 'window' | 'opening'): string {
    const prefix = type === 'door' ? 'Д' : type === 'window' ? 'О' : 'Пр'
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
    lineId: string, type: 'door' | 'window' | 'opening',
    offsetMm: number, widthMm: number, heightMm: number, sillHeightMm?: number,
  ) {
    const line = lines.find(l => l.id === lineId)
    if (!line) return
    if (offsetMm < 0 || widthMm <= 0 || heightMm <= 0 || offsetMm + widthMm > line.lengthMm) return
    const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const label = nextOpeningLabel(type)
    const opening: PlanOpening = { id, type, offsetMm, widthMm, heightMm, label }
    if (type !== 'door' && sillHeightMm !== undefined && sillHeightMm >= 0) opening.sillHeightMm = sillHeightMm
    updatePlanLine(lineId, { openings: [...(line.openings ?? []), opening] })
  }

  /**
   * Инструмент "Проём" (режим 'opening', см. handleLinePointerDown) — клик
   * прямо по стене на плане, без захода в инспектор и без ручного счёта
   * отступа. Проблема, которую решает: offsetMm в данных всегда считается
   * от точки (x1,y1) линии — а на подложке PDF размер до проёма часто дан
   * от ДРУГОГО конца стены, и линия не всегда начерчена с той стороны,
   * откуда идёт размер. Клик — сразу по месту на глаз/по сетке, без
   * пересчёта "от какого конца я вообще чертил эту стену".
   *
   * Проём центрируется на точке клика (спроецированной на ось линии) —
   * не начинается от неё, чтобы клик "в середину дверного проёма на
   * подложке" естественно попадал серединой, а не левым краем.
   */
  function placeOpeningOnLine(line: PlanLine, clickX: number, clickY: number) {
    const defaultWidth = openingType === 'window' ? 1500 : 900
    const width = parseFloat(openingWidth) > 0 ? parseFloat(openingWidth) : defaultWidth
    const height = parseFloat(openingHeight) > 0 ? parseFloat(openingHeight) : (openingType === 'window' ? 1200 : 2000)
    const sill = openingType !== 'door' ? (parseFloat(openingSill) || 0) : undefined

    const offset = openingOffsetFromClick(line.x1, line.y1, line.x2, line.y2, line.lengthMm, clickX, clickY, width)
    if (offset === null) {
      window.alert(`Эта стена короче ширины проёма: стена ${Math.round(line.lengthMm)}мм, проём ${width}мм.`)
      return
    }
    addOpening(line.id, openingType, offset, width, height, sill)
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

  // Смета раскроя листов по всему проекту — пересчитывается только при изменении линий
  const sheetSummary: ProjectSheetResult = useMemo(
    () => calcProjectSheetLayout(planLinesToSurfaceInputs(lines)),
    [lines],
  )

  // Общий % выполнения по объекту + разбивка по типу работ (см. lineProgress.ts/workProgress.ts).
  // Учитываются только НАСТРОЕННЫЕ прогрессы (buildProgress + finishProgressA/B с шагами) —
  // линии без прогресса (legacy/капитал) в эту статистику не попадают, иначе 0% "непонятно
  // откуда" размывал бы честный процент по тем поверхностям, где прогресс реально ведётся.
  const progressSummary = useMemo(() => {
    type Entry = { progress: WorkProgress; workTypeLabel: string }
    const entries: Entry[] = []
    for (const l of lines) {
      if (l.buildProgress && l.buildProgress.steps.length > 0) {
        entries.push({ progress: l.buildProgress, workTypeLabel: l.buildProgress.sourceTemplateLabel ?? 'Строительство (свой список)' })
      }
      for (const key of ['finishProgressA', 'finishProgressB'] as const) {
        const p = l[key]
        if (p && p.steps.length > 0) {
          entries.push({ progress: p, workTypeLabel: p.sourceTemplateLabel ?? 'Отделка (свой список)' })
        }
      }
    }
    const overallPercent = aggregateProgressPercent(entries.map(e => e.progress))
    const byType = new Map<string, WorkProgress[]>()
    for (const e of entries) {
      const arr = byType.get(e.workTypeLabel) ?? []
      arr.push(e.progress)
      byType.set(e.workTypeLabel, arr)
    }
    const byTypePercent = Array.from(byType.entries())
      .map(([label, progresses]) => ({ label, percent: aggregateProgressPercent(progresses) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return { overallPercent, byTypePercent, totalSurfaces: entries.length }
  }, [lines])

  const previewPt    = cursor ?? (drawing ? { x: drawing.x1, y: drawing.y1 } : null)
  const previewX2    = previewPt?.x ?? 0
  const previewY2    = previewPt?.y ?? 0
  // allPoints убраны — snap-точки на холсте не рисуются

  // ── Wall join: скорректированные точки для стыков ────────────────────────
  const wallJoins = useMemo(() => {
    const walls: WallForJoin[] = []
    lines.forEach((l, idx) => {
      const vis = getLineVisual(l.type, l.spec?.material, l.spec?.subtype, l.spec?.gapMm)
      const hasSpec = !!(l.spec?.material)
      const thicknessPx = hasSpec && vis.thicknessMm > 0 ? vis.thicknessMm / scaleMmPx : 0
      if (thicknessPx <= 3) return
      if (l.sagittaMm) return  // дуга — join со стенами пока не считаем (см. KONSPEKT.md)
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1
      if (Math.sqrt(dx * dx + dy * dy) < 1) return
      walls.push({
        id: l.id,
        x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
        halfPx: thicknessPx / 2,
        createdIndex: idx,
        category: l.category ?? defaultCategory(l.type),
      })
    })
    return computeWallJoins(walls)
  }, [lines, scaleMmPx])

  // ── Боковое примыкание: к чему упирается каждый конец линии ──────────────
  const lineAttachments = useMemo(() => {
    const surfaces: AttachSurface[] = []
    lines.forEach(l => {
      const vis = getLineVisual(l.type, l.spec?.material, l.spec?.subtype, l.spec?.gapMm)
      const hasSpec = !!(l.spec?.material) || l.type === 'wall_existing'
      const thicknessPx = hasSpec && vis.thicknessMm > 0 ? vis.thicknessMm / scaleMmPx : 0
      if (thicknessPx <= 3) return
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1
      if (Math.sqrt(dx * dx + dy * dy) < 1) return
      surfaces.push({
        id: l.id,
        x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
        halfPx: thicknessPx / 2,
        material: attachmentMaterialOf(l.type, l.spec?.material),
      })
    })
    return resolveAllAttachments(surfaces)
  }, [lines, scaleMmPx])

  // ── Смета крепежа боковых примыканий по всему проекту ─────────────────────
  // Переиспользует уже готовые calcLineFasteners (по линии) и calcProjectFasteners
  // (агрегат по типу) — просто выводит их на UI, сама механика не менялась.
  const fastenerSummary = useMemo(() => {
    type LineFastenerRow = {
      id: string
      label: string
      startLabel: string | null
      endLabel: string | null
    }
    const rows: LineFastenerRow[] = []
    for (const l of lines) {
      const res = calcLineFasteners(l, lineAttachments.get(l.id))
      if (!res.start && !res.end) continue
      rows.push({
        id: l.id,
        label: l.label,
        startLabel: res.start ? `${FASTENER_LABEL[res.start.spec.type]} × ${res.start.qty}` : null,
        endLabel: res.end ? `${FASTENER_LABEL[res.end.spec.type]} × ${res.end.qty}` : null,
      })
    }
    const totals = calcProjectFasteners(lines, lineAttachments)
    const totalsList = Array.from(totals.entries())
      .map(([type, qty]) => ({ type, label: FASTENER_LABEL[type as keyof typeof FASTENER_LABEL] ?? type, qty }))
      .sort((a, b) => b.qty - a.qty)
    const totalQty = totalsList.reduce((s, t) => s + t.qty, 0)
    return { rows, totalsList, totalQty }
  }, [lines, lineAttachments])

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

        {/* Этажи — переключатель + добавить/дублировать/удалить */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {levels.map(lv => (
            <button key={lv.id} onClick={() => selectLevel(lv.id)}
              title={`Отметка ${lv.elevationMm} мм`}
              style={{
                padding: '4px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 5,
                border: lv.id === activeLevelId ? '1px solid #3a7bd5' : '1px solid #ddd',
                background: lv.id === activeLevelId ? '#3a7bd5' : '#fff',
                color: lv.id === activeLevelId ? '#fff' : '#555', fontWeight: lv.id === activeLevelId ? 600 : 400,
              }}>
              {lv.name} <span style={{ opacity: 0.75 }}>({lv.elevationMm}мм)</span>
            </button>
          ))}
          <button
            onClick={() => {
              const name = window.prompt('Название нового этажа', `Этаж ${levels.length + 1}`)
              if (!name) return
              const elevStr = window.prompt('Отметка низа этажа, мм', '0')
              if (elevStr === null) return
              addLevel(name, parseFloat(elevStr) || 0)
            }}
            title="Добавить этаж" style={{ ...toolBtnStyle(false), padding: '4px 10px', fontSize: 12 }}>
            + этаж
          </button>
          {activeLevelId && (
            <button
              onClick={() => {
                const src = levels.find(lv => lv.id === activeLevelId)
                if (!src) return
                const name = window.prompt('Название этажа-копии', `${src.name} (копия)`)
                if (!name) return
                const elevStr = window.prompt('Отметка низа нового этажа, мм', String(src.elevationMm + 3000))
                if (elevStr === null) return
                duplicateLevel(src.id, name, parseFloat(elevStr) || src.elevationMm + 3000)
              }}
              title="Дублировать текущий этаж на новую отметку" style={{ ...toolBtnStyle(false), padding: '4px 10px', fontSize: 12 }}>
              ⧉ дублировать
            </button>
          )}
          {activeLevelId && levels.length > 1 && (
            <button
              onClick={() => {
                const src = levels.find(lv => lv.id === activeLevelId)
                if (src && window.confirm(`Удалить этаж «${src.name}» вместе с его планом?`)) removeLevel(src.id)
              }}
              title="Удалить текущий этаж" style={{ ...toolBtnStyle(false), padding: '4px 10px', fontSize: 12, color: '#c0392b' }}>
              🗑
            </button>
          )}
          {activeLevelId && (
            <button
              onClick={() => {
                const src = levels.find(lv => lv.id === activeLevelId)
                if (!src) return
                const name = window.prompt('Новое название этажа', src.name)
                if (name) renameLevel(src.id, name)
              }}
              title="Переименовать этаж" style={{ ...toolBtnStyle(false), padding: '4px 8px', fontSize: 12 }}>
              ✎
            </button>
          )}
          {activeLevelId && (
            <button
              onClick={() => {
                const src = levels.find(lv => lv.id === activeLevelId)
                if (!src) return
                const elevStr = window.prompt('Новая отметка низа этажа, мм', String(src.elevationMm))
                if (elevStr === null) return
                setLevelElevation(src.id, parseFloat(elevStr) || src.elevationMm)
              }}
              title="Изменить отметку" style={{ ...toolBtnStyle(false), padding: '4px 8px', fontSize: 12 }}>
              ↕ отметка
            </button>
          )}
        </div>

        <div style={{ flex: 1 }} />
        {!isMobile && (
          <span style={{ fontSize: 12, color: '#888' }}>
            Масштаб: {scaleMmPx >= 10 ? `${Math.round(scaleMmPx)}мм/рх` : `${scaleMmPx.toFixed(1)}мм/рх`}
          </span>
        )}
        {/* Undo/Redo placeholders */}
        {!isMobile && <button title="Отменить" style={toolBtnStyle(false)}>↩</button>}
        {!isMobile && <button title="Повторить" style={toolBtnStyle(false)}>↪</button>}
        <button onClick={fitToContent} title="Показать всё — вписать план/подложку в экран"
          style={{ ...toolBtnStyle(false), minWidth: isMobile ? 0 : undefined, padding: isMobile ? '6px 10px' : '5px 10px' }}>
          🎯 {isMobile ? '' : 'Показать всё'}
        </button>
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

          {/* Ригель — отдельно от дерева материалов: нет спецификации,
              только геометрия (ширина сечения + опускание от потолка) */}
          <div>
            <div style={{ ...sectionHeaderStyle, color: LINE_COLORS.rib_beam }}>Ригели (перекрытие)</div>
            <button
              onClick={() => { setDrawType('rib_beam'); setDrawSpec(null); setMode('draw') }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', width: '100%', textAlign: 'left',
                borderLeft: (mode === 'draw' && drawType === 'rib_beam') ? '3px solid #37474f' : '3px solid transparent',
                color: (mode === 'draw' && drawType === 'rib_beam') ? '#fff' : '#8a9ac8', fontSize: 12,
              }}>
              <span style={{ fontSize: 14, minWidth: 16, textAlign: 'center' }}>▬</span>
              <span>Нарисовать ригель</span>
            </button>
            <div style={{ padding: '2px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#8a9ac8', whiteSpace: 'nowrap' }}>Сечение:</span>
              <input type="number" value={drawRibWidthMm}
                onChange={e => setDrawRibWidthMm(e.target.value)}
                style={{ width: 60, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff' }} />
              <span style={{ fontSize: 11, color: '#8a9ac8' }}>мм</span>
            </div>
            <div style={{ padding: '0 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#8a9ac8', whiteSpace: 'nowrap' }}>Опускание:</span>
              <input type="number" value={drawRibDropMm}
                onChange={e => setDrawRibDropMm(e.target.value)}
                style={{ width: 60, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff' }} />
              <span style={{ fontSize: 11, color: '#8a9ac8' }}>мм от потолка</span>
            </div>
          </div>

          {/* Карандаш — свободный контур плиты (пол/потолок этажа) + вырезание
              дырок (лестницы/шахты). Отметка плиты — с самого этажа (Level),
              своего поля высоты у плиты нет. */}
          <div>
            <div style={{ ...sectionHeaderStyle, color: '#8d99ae' }}>Плита (карандаш)</div>
            <button
              onClick={() => { setPencilHoleTargetId(null); setPencilPts([]); setMode('pencil') }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px', background: 'transparent', border: 'none',
                cursor: 'pointer', width: '100%', textAlign: 'left',
                borderLeft: (mode === 'pencil' && !pencilHoleTargetId) ? '3px solid #8d99ae' : '3px solid transparent',
                color: (mode === 'pencil' && !pencilHoleTargetId) ? '#fff' : '#8a9ac8', fontSize: 12,
              }}>
              <span style={{ fontSize: 14, minWidth: 16, textAlign: 'center' }}>✏️</span>
              <span>Нарисовать плиту</span>
            </button>
            {mode === 'pencil' && (
              <div style={{ padding: '2px 14px 8px', fontSize: 10, color: '#8a9ac8', lineHeight: 1.4 }}>
                Клик — точка контура. Клик рядом с первой точкой — замкнуть.
                ПКМ или Esc — отменить текущий контур.
                {pencilPts.length > 0 && <div style={{ marginTop: 2 }}>Точек: {pencilPts.length}</div>}
              </div>
            )}
            {mode === 'opening' && (
              <div style={{ padding: '2px 14px 10px' }}>
                <div style={{ fontSize: 10, color: '#8a9ac8', lineHeight: 1.4, marginBottom: 8 }}>
                  Клик по стене на плане — проём ставится сразу там, по центру
                  клика. Открывать панель каждой стены по отдельности не нужно.
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  {(['door', 'window', 'opening'] as const).map(t => {
                    const color = t === 'door' ? '#c9a68a' : t === 'window' ? '#7ba9e0' : '#9aa5ad'
                    return (
                      <button key={t}
                        onClick={() => {
                          setOpeningType(t)
                          setOpeningHeight(t === 'window' ? '1200' : '2000')
                          setOpeningWidth(t === 'window' ? '1500' : '900')
                          if (t === 'opening') setOpeningSill('0')
                          else if (t === 'window') setOpeningSill('900')
                        }}
                        style={{
                          flex: 1, fontSize: 11, padding: '6px 0', borderRadius: 4, cursor: 'pointer',
                          border: `1px solid ${openingType === t ? color : '#3a4060'}`,
                          background: openingType === t ? color : 'transparent',
                          color: openingType === t ? '#1a1f33' : '#8a9ac8',
                        }}>
                        {t === 'door' ? 'Дверь' : t === 'window' ? 'Окно' : 'Проём'}
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input type="number" placeholder="ширина, мм" value={openingWidth}
                    onChange={e => setOpeningWidth(e.target.value)}
                    style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff', minWidth: 0 }} />
                  <input type="number"
                    placeholder={openingType === 'window' ? 'высота окна, мм' : 'высота, мм'}
                    value={openingHeight}
                    onChange={e => setOpeningHeight(e.target.value)}
                    style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff', minWidth: 0 }} />
                </div>
                {(openingType === 'window' || openingType === 'opening') && (
                  <input type="number" placeholder="низ от пола, мм (0 — от пола)" value={openingSill}
                    onChange={e => setOpeningSill(e.target.value)}
                    style={{ width: '100%', fontSize: 11, padding: '5px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff', boxSizing: 'border-box' as const }} />
                )}
              </div>
            )}
            {slabs.length > 0 && (
              <div style={{ padding: '4px 14px 8px' }}>
                <div style={{ fontSize: 10, color: '#8a9ac8', marginBottom: 4, textTransform: 'uppercase' }}>
                  Вырезать проём в плите
                </div>
                {slabs.map(sl => (
                  <button key={sl.id}
                    onClick={() => { setPencilHoleTargetId(sl.id); setPencilPts([]); setMode('pencil') }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', marginBottom: 3,
                      fontSize: 11, borderRadius: 4, cursor: 'pointer',
                      border: pencilHoleTargetId === sl.id ? '1px solid #8d99ae' : '1px solid #3a4060',
                      background: pencilHoleTargetId === sl.id ? '#8d99ae' : 'transparent',
                      color: pencilHoleTargetId === sl.id ? '#1a1f33' : '#8a9ac8',
                    }}>
                    {sl.label} {sl.holes.length > 0 && `(${sl.holes.length} проём${sl.holes.length > 1 ? 'а' : ''})`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Шаблоны колонн — библиотека общая на все объекты (useTemplateStore),
              штамповка: прямоугольная — 2 клика (центр, потом угол), круглая — 1 клик.
              Библиотека наполняется либо "Сохранить как шаблон" с уже нарисованной
              колонны (см. инспектор), либо кнопками ниже — шаблон с нуля, без образца
              на плане (материал у такого шаблона донастраивается уже после штамповки). */}
          <div>
            <div style={{ ...sectionHeaderStyle, color: '#c5a880' }}>Шаблоны колонн</div>
            {templates.length === 0 && (
              <div style={{ padding: '2px 14px 6px', fontSize: 10, color: '#8a9ac8', lineHeight: 1.4 }}>
                Пока пусто. Создайте шаблон кнопками ниже, либо выделите уже
                нарисованную колонну и нажмите «Сохранить как шаблон» в её панели.
              </div>
            )}
            {templates.length > 0 && (
              <div style={{ padding: '2px 14px 8px' }}>
                {templates.map(t => (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3,
                  }}>
                    <button
                      onClick={() => selectTemplateForStamp(t.id)}
                      style={{
                        flex: 1, textAlign: 'left', padding: '5px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                        border: (mode === 'stamp' && stampTemplateId === t.id) ? '1px solid #c5a880' : '1px solid #3a4060',
                        background: (mode === 'stamp' && stampTemplateId === t.id) ? '#c5a880' : 'transparent',
                        color: (mode === 'stamp' && stampTemplateId === t.id) ? '#1a1f33' : '#8a9ac8',
                      }}>
                      <span style={{ marginRight: 6 }}>{t.kind === 'roundColumn' ? '⬤' : '▦'}</span>
                      {t.name}
                      <span style={{ opacity: 0.75 }}>
                        {' '}{t.kind === 'roundColumn' ? `⌀${t.diameterMm}` : `${t.widthMm}×${t.depthMm}`} мм
                      </span>
                    </button>
                    <button
                      title="Удалить шаблон"
                      onClick={() => {
                        if (window.confirm(`Удалить шаблон «${t.name}»? Уже поставленные колонны не тронет.`)) {
                          removeTemplate(t.id)
                          if (stampTemplateId === t.id) { setStampTemplateId(null); setStampCenter(null) }
                        }
                      }}
                      style={{
                        padding: '5px 7px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                        border: '1px solid #3a4060', background: 'transparent', color: '#8a9ac8',
                      }}>🗑</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, padding: '0 14px 8px' }}>
              <button onClick={createRectTemplateFromScratch}
                style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 4, cursor: 'pointer', border: '1px dashed #c5a880', background: 'transparent', color: '#c5a880' }}>
                + ▦ новый
              </button>
              <button onClick={createRoundTemplateFromScratch}
                style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 4, cursor: 'pointer', border: '1px dashed #c5a880', background: 'transparent', color: '#c5a880' }}>
                + ⬤ новый
              </button>
            </div>
            {mode === 'stamp' && stampTemplateId && (() => {
              const tpl = templates.find(t => t.id === stampTemplateId)
              if (!tpl) return null
              return (
                <div style={{ padding: '2px 14px 8px', fontSize: 10, color: '#8a9ac8', lineHeight: 1.4 }}>
                  {tpl.kind === 'roundColumn'
                    ? 'Клик — поставить колонну. Ctrl — прилипнуть в ряд с соседней. ПКМ — отменить последнюю поставленную. Esc — выйти в «Двигать».'
                    : stampCenter
                      ? 'Клик — зафиксировать угол поворота (Shift — привязка к 15°). ПКМ/Esc — отменить этот шаг.'
                      : 'Клик — поставить центр колонны. Ctrl — прилипнуть в ряд с соседней. ПКМ — отменить последнюю поставленную. Esc — выйти в «Двигать».'}
                </div>
              )
            })()}
          </div>

          <div style={{ height: 1, background: '#2a3045', margin: '8px 0' }} />

          {/* Инструменты */}
          <div style={sectionHeaderStyle}>Инструменты</div>
          {([
            ['draw',    '✏', 'Рисовать'],
            ['select',  '✥', 'Двигать'],
            ['contour', '⬡', 'Замкнуть контур'],
            ['scale',   '⬛', 'Масштаб'],
            ['trim',    '✂', 'Обрезать/продлить'],
            ['opening', '🚪', 'Проём (дверь/окно/проход)'],
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
              <button onClick={() => { if (window.confirm('Удалить подложку?')) { bgSourceRef.current = null; setBackgroundImage(null) } }}
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

          {/* Стрела дуги ИЛИ радиус — 0/пусто = обычная прямая линия.
              Способ H: натянул шнур, замерил стрелу посередине рулеткой.
              Способ R: известен радиус (одна арка на несколько разных
              пролётов должна иметь ОДИН радиус, а не одну и ту же стрелу —
              при разной хорде одинаковая H даёт РАЗНЫЙ, не связанный
              радиус, это и была реальная проблема на объекте). */}
          <div style={{ padding: '0 14px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#8a9ac8', whiteSpace: 'nowrap' }}>Дуга по:</span>
            <button onClick={() => setDrawArcMode('sagitta')}
              style={{ ...toolBtnStyle(drawArcMode === 'sagitta'), padding: '3px 8px', fontSize: 11 }}>H</button>
            <button onClick={() => setDrawArcMode('radius')}
              style={{ ...toolBtnStyle(drawArcMode === 'radius'), padding: '3px 8px', fontSize: 11 }}>R</button>
          </div>
          {drawArcMode === 'sagitta' ? (
            <div style={{ padding: '0 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#8a9ac8', whiteSpace: 'nowrap' }}>Стрела дуги H:</span>
              <input type="number" value={drawSagittaMm}
                onChange={e => setDrawSagittaMm(e.target.value)}
                title="0 = обычная прямая линия. Формула R=(L²+H²)/2H, L — половина хорды"
                style={{ width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff' }} />
              <span style={{ fontSize: 11, color: '#8a9ac8' }}>мм (0=прямая)</span>
            </div>
          ) : (
            <div style={{ padding: '0 14px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#8a9ac8', whiteSpace: 'nowrap' }}>Радиус R:</span>
                <input type="number" value={drawRadiusMm}
                  onChange={e => setDrawRadiusMm(e.target.value)}
                  title="Пусто/0 = обычная прямая линия. Стрела H посчитается сама по хорде, которую нарисуете"
                  style={{ width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff' }} />
                <span style={{ fontSize: 11, color: '#8a9ac8' }}>мм (пусто=прямая)</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#8a9ac8', cursor: 'pointer' }}>
                <input type="checkbox" checked={drawArcDeep} onChange={e => setDrawArcDeep(e.target.checked)} />
                глубокая дуга (&gt; полуокружности)
              </label>
            </div>
          )}

          {/* Шаг стоек и лист обшивки — глобальный дефолт для новых линий, правится точечно в инспекторе */}
          <div style={{ padding: '0 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#8a9ac8', whiteSpace: 'nowrap' }}>Шаг стоек:</span>
            <input type="number" value={drawStep}
              onChange={e => setDrawStep(e.target.value)}
              style={{ width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #3a4060', background: '#1a1f33', color: '#fff' }} />
            <span style={{ fontSize: 11, color: '#8a9ac8' }}>мм</span>
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <div style={{ fontSize: 11, color: '#8a9ac8', marginBottom: 4 }}>
              Лист 1-го слоя{(drawSpec?.layers ?? 1) === 2 ? ' / 2-го слоя' : ''}:
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
              <BoardSpecSelector value={drawLayer1} onChange={setDrawLayer1} />
              {(drawSpec?.layers ?? 1) === 2 && (
                <BoardSpecSelector value={drawLayer2} onChange={setDrawLayer2} />
              )}
            </div>
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
              {mode === 'trim' && (
                <span style={{ fontSize: 11, color: '#00897b', fontWeight: 600 }}>
                  {!trimSourceId ? '✂ Кликните линию, которую обрезать/продлить' : '✂ Теперь кликните линию, до которой тянуть'}
                </span>
              )}
              {mode === 'opening' && (
                <span style={{ fontSize: 11, color: '#8d6e63', fontWeight: 600 }}>
                  🚪 Кликайте по стенам — проём ставится сразу, без открытия панели
                </span>
              )}
            </div>
          </div>

          {/* ── Холст ── */}
            <div ref={containerRef}
              style={{
                border: '1px solid #dde', borderRadius: 8, overflow: 'hidden', background: '#fafafa',
                cursor: spaceDown ? (panStartRef.current ? 'grabbing' : 'grab')
                  : mode === 'draw' ? 'crosshair' : mode === 'select' ? 'default' : mode === 'erase' ? 'pointer' : mode === 'trim' ? 'crosshair' : mode === 'opening' ? 'crosshair' : 'default',
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
                    return (
                      <Group key={room.id} listening={false}>
                        <Line points={flatPts} closed fill="rgba(120,144,156,0.08)" stroke="none" listening={false} />
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

                  {/* Плиты (карандаш) — под контурами/стенами, дырки через evenodd */}
                  {slabs.map(sl => (
                    <Shape
                      key={sl.id}
                      fill={pencilHoleTargetId === sl.id ? '#8d99ae33' : '#8d99ae22'}
                      stroke="#8d99ae"
                      strokeWidth={1.5}
                      listening={false}
                      sceneFunc={(ctx, shape) => {
                        ctx.beginPath()
                        ctx.moveTo(sl.outer[0].x, sl.outer[0].y)
                        for (let i = 1; i < sl.outer.length; i++) ctx.lineTo(sl.outer[i].x, sl.outer[i].y)
                        ctx.closePath()
                        for (const hole of sl.holes) {
                          if (hole.length < 3) continue
                          ctx.moveTo(hole[0].x, hole[0].y)
                          for (let i = 1; i < hole.length; i++) ctx.lineTo(hole[i].x, hole[i].y)
                          ctx.closePath()
                        }
                        ctx.fillStrokeShape(shape)
                      }}
                    />
                  ))}

                  {/* Круглые колонны — Konva Circle, заштрихованы как и прямоугольные (Room isColumn) */}
                  {roundColumns.map(rc => {
                    const r = mmToPx(rc.diameterMm, scaleMmPx) / 2
                    return (
                      <Group key={rc.id} listening={false}>
                        <Circle x={rc.cx} y={rc.cy} radius={r} fill="rgba(120,144,156,0.08)" stroke="#78909c" strokeWidth={1.5} />
                        <Group listening={false} clipFunc={ctx => { ctx.beginPath(); ctx.arc(rc.cx, rc.cy, r, 0, Math.PI * 2) }}>
                          {(() => {
                            const step = 14
                            const strokes = []
                            for (let d = -2 * r; d < 2 * r; d += step) {
                              strokes.push(
                                <Line key={d}
                                  points={[rc.cx - r + d, rc.cy - r, rc.cx - r + d + 2 * r, rc.cy + r]}
                                  stroke="#78909c" strokeWidth={1} listening={false} />
                              )
                            }
                            return strokes
                          })()}
                        </Group>
                        <Text x={rc.cx - 70} y={rc.cy - 18} width={140}
                          text={rc.label || 'Колонна'} fontSize={11} fill="#78909c" align="center" fontStyle="bold" listening={false} />
                        <Text x={rc.cx - 70} y={rc.cy - 2} width={140}
                          text={`${rectAreaM2Circle(rc.diameterMm).toFixed(2)} м²`} fontSize={13} fill="#78909c" align="center" fontStyle="bold" listening={false} />
                      </Group>
                    )
                  })}

                  {/* Прямоугольные колонны-сущности (RectColumn, с 05.07.2026) — та же
                      штриховка, что у круглых (генерик, не зависит от материала, см.
                      комментарий у roundColumns.map выше) и у старых Room-колонн. */}
                  {rectColumns.map(rc => {
                    const corners = rectColumnCornersPx(rc.cx, rc.cy, rc.widthMm, rc.depthMm, rc.angleRad, scaleMmPx)
                    const flat = corners.flatMap(p => [p.x, p.y])
                    const minX = Math.min(...corners.map(p => p.x)), maxX = Math.max(...corners.map(p => p.x))
                    const minY = Math.min(...corners.map(p => p.y)), maxY = Math.max(...corners.map(p => p.y))
                    return (
                      <Group key={rc.id} listening={false}>
                        <Line points={flat} closed fill="rgba(120,144,156,0.08)" stroke="#78909c" strokeWidth={1.5} listening={false} />
                        <Group listening={false} clipFunc={ctx => {
                          ctx.beginPath()
                          corners.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
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
                        <Text x={rc.cx - 70} y={rc.cy - 18} width={140}
                          text={rc.label || 'Колонна'} fontSize={11} fill="#78909c" align="center" fontStyle="bold" listening={false} />
                        <Text x={rc.cx - 70} y={rc.cy - 2} width={140}
                          text={`${rectAreaM2(rc.widthMm, rc.depthMm).toFixed(2)} м²`} fontSize={13} fill="#78909c" align="center" fontStyle="bold" listening={false} />
                      </Group>
                    )
                  })}

                  {/* Превью текущего контура карандаша — точки + отрезок до курсора */}
                  {mode === 'pencil' && pencilPts.length > 0 && (
                    <>
                      {cursor && (
                        <Line
                          points={[...pencilPts.flatMap(p => [p.x, p.y]), cursor.x, cursor.y]}
                          stroke="#8d99ae" strokeWidth={1.5} dash={[6, 3]} listening={false}
                        />
                      )}
                      {pencilPts.map((p, i) => (
                        i === 0 ? (
                          <Shape
                            key={i} x={p.x} y={p.y} rotation={-45} listening={false}
                            sceneFunc={(ctx) => {
                              // Носик (остриё) — ровно в точке (0,0), тело уходит назад по диагонали,
                              // чтобы не перекрывать угол, к которому идёт привязка.
                              ctx.beginPath()
                              ctx.moveTo(0, 0)
                              ctx.lineTo(7, -2.5)
                              ctx.lineTo(7, 2.5)
                              ctx.closePath()
                              ctx.fillStyle = '#e53935'
                              ctx.fill()
                              ctx.beginPath()
                              ctx.rect(7, -2, 13, 4)
                              ctx.fillStyle = '#8d99ae'
                              ctx.fill()
                              ctx.beginPath()
                              ctx.rect(20, -2, 4, 4)
                              ctx.fillStyle = '#5a6a8a'
                              ctx.fill()
                            }}
                          />
                        ) : (
                          <Circle key={i} x={p.x} y={p.y} radius={3} fill="#8d99ae" listening={false} />
                        )
                      ))}
                    </>
                  )}

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
                    const inTrimSrc  = mode === 'trim' && l.id === trimSourceId
                    const baseColor  = LINE_COLORS[l.type]

                    const vis       = getLineVisual(l.type, l.spec?.material, l.spec?.subtype, l.spec?.gapMm)
                    const specColor = vis.colorOverride ?? baseColor
                    const stroke    = inErase ? '#e53935' : inContour ? '#ff9800' : inTrimSrc ? '#00897b' : isSelected ? '#ff5722' : specColor
                    const dash      = (inErase || inContour || isSelected || inTrimSrc) ? undefined : (vis.dash ?? undefined)

                    const mx = (l.x1 + l.x2) / 2
                    const my = (l.y1 + l.y2) / 2

                    const lCategory  = l.category ?? defaultCategory(l.type)
                    const lStatusColor = lineProgressColor(l.buildProgress)
                    const showStatusDot = lCategory === 'mutable' && !inErase

                    // Рисуем двойную линию (трапецию) ТОЛЬКО если spec задан явно
                    // (или это ригель — у него своя толщина из sectionWidthMm).
                    // Без spec — тонкая линия, чтобы не путать при первом рисовании.
                    const isRibBeam = l.type === 'rib_beam'
                    const hasExplicitSpec = !!(l.spec?.material) || isRibBeam
                    const thicknessPx = isRibBeam
                      ? (l.sectionWidthMm ?? 300) / scaleMmPx
                      : (hasExplicitSpec && vis.thicknessMm > 0) ? vis.thicknessMm / scaleMmPx : 0
                    const dx = l.x2 - l.x1, dy = l.y2 - l.y1
                    const len = Math.sqrt(dx*dx + dy*dy)
                    const useDouble = thicknessPx > 3 && len > 0 && !inErase

                    // ── Дуга (арка/гнутая перегородка) — своя ветка рендера,
                    // мимо wallJoin/computeOpeningSegments (для дуг они пока
                    // не считаются, см. KONSPEKT.md). Хорда/концы — те же
                    // l.x1/y1/x2/y2, что и у прямой линии, поэтому endpoint-
                    // drag и select работают без изменений.
                    if (l.sagittaMm) {
                      const sagittaPx = l.sagittaMm / scaleMmPx
                      const arc = arcFromChordAndSagitta(l.x1, l.y1, l.x2, l.y2, sagittaPx)
                      if (arc) {
                        const centerPts  = sampleArcPoints(arc, 40)
                        const centerFlat = centerPts.flatMap(p => [p.x, p.y])
                        const midPt      = centerPts[Math.floor(centerPts.length / 2)]
                        const wallLike   = thicknessPx > 3 && !inErase
                        const sw         = vis.strokeWidth
                        const fill       = isSelected ? stroke + '30' : inContour ? '#ff980022' : vis.fillColor

                        let fillPolyFlat: number[] | null = null
                        let outerFlat: number[] | null = null
                        let innerFlat: number[] | null = null
                        if (wallLike) {
                          const half = thicknessPx / 2
                          const outerPts = sampleArcPoints({ ...arc, radius: arc.radius + half }, 40)
                          const innerPts = sampleArcPoints({ ...arc, radius: Math.max(1, arc.radius - half) }, 40)
                          outerFlat = outerPts.flatMap(p => [p.x, p.y])
                          innerFlat = innerPts.flatMap(p => [p.x, p.y])
                          fillPolyFlat = [...outerFlat, ...[...innerPts].reverse().flatMap(p => [p.x, p.y])]
                        }

                        return (
                          <Group key={l.id}
                            opacity={inErase ? 0.55 : 1}
                            onMouseDown={e => handleLinePointerDown(l.id, e)}
                            onTouchStart={e => handleLinePointerDown(l.id, e)}
                            onMouseEnter={() => setHoveredId(l.id)}
                            onMouseLeave={() => setHoveredId(null)}>
                            {/* Хитзона клика по всей дуге */}
                            <Line points={centerFlat} stroke="transparent"
                              strokeWidth={Math.max(28, thicknessPx + 8)}
                              hitStrokeWidth={Math.max(28, thicknessPx + 8)} />
                            {wallLike && fillPolyFlat ? (
                              <>
                                <Line points={fillPolyFlat} closed fill={fill} listening={false} />
                                <Line points={outerFlat!} stroke={stroke} strokeWidth={sw} lineCap="round" dash={dash} listening={false} />
                                <Line points={innerFlat!} stroke={stroke} strokeWidth={sw} lineCap="round" dash={dash} listening={false} />
                              </>
                            ) : (
                              <Line points={centerFlat} stroke={stroke} strokeWidth={sw} lineCap="round" dash={dash} listening={false} />
                            )}
                            {inErase && (
                              <Text x={midPt.x - 9} y={midPt.y - 10} text="✕" fontSize={18} fill="#e53935" fontStyle="bold" listening={false} />
                            )}
                            {!inErase && (
                              <Group x={midPt.x} y={midPt.y - 12} listening={false}>
                                <Text x={-40} width={80} text={l.label} fontSize={10}
                                  fill={stroke} align="center" fontStyle="bold" listening={false} />
                                {showStatusDot && <Circle x={44} y={5} radius={3.5} fill={lStatusColor} listening={false} />}
                              </Group>
                            )}
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
                      // arc === null (вырожденная хорда) — не должно случаться на
                      // практике, но на всякий случай падаем в обычный рендер ниже
                    }

                    if (useDouble) {
                      const half = thicknessPx / 2
                      const hitW = Math.max(28, thicknessPx + 8)
                      const fill = isSelected ? stroke + '30' : inContour ? '#ff980022' : (isRibBeam ? '#37474f22' : vis.fillColor)
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
                                {(l.type === 'wall_existing' || l.type === 'rib_beam') && (() => {
                                  const hatch = calcHatch(sAx, sAy, sBx, sBy, sCx, sCy, sDx, sDy, 8)
                                  return (
                                    <Group clipFunc={(ctx: any) => {
                                      ctx.beginPath(); ctx.moveTo(sAx, sAy); ctx.lineTo(sBx, sBy)
                                      ctx.lineTo(sCx, sCy); ctx.lineTo(sDx, sDy); ctx.closePath()
                                    }} listening={false}>
                                      {hatch.map((pts, i) => (
                                        <Line key={i} points={pts} stroke={stroke} strokeWidth={0.8} opacity={0.5} listening={false} />
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
                                  {showStatusDot && <Circle x={38} y={-2} radius={3.5} fill={lStatusColor} listening={false} />}
                                </Group>
                              )
                            }
                            return len > 40 ? (
                              <Group x={mx} y={my-12} listening={false}>
                                <Text x={-40} width={80} text={l.label} fontSize={10}
                                  fill={stroke} align="center" fontStyle="bold" listening={false} />
                                {showStatusDot && <Circle x={44} y={5} radius={3.5} fill={lStatusColor} listening={false} />}
                              </Group>
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
                            <Group x={mx} y={my-12} listening={false}>
                              <Text x={-40} width={80} text={l.label} fontSize={10}
                                fill={stroke} align="center" fontStyle="bold" listening={false} />
                              {showStatusDot && <Circle x={44} y={5} radius={3.5} fill={lStatusColor} listening={false} />}
                            </Group>
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

                  {/* Маркеры помещений/колонн — намеренно поверх линий (z-order), чтобы
                      хитзона стен (24px) не перехватывала клик у маленьких контуров типа колонны */}
                  {mode === 'select' && rooms.map(room => {
                    const roomLines = room.lineIds
                      .map(id => lines.find(l => l.id === id))
                      .filter(Boolean) as PlanLine[]
                    if (roomLines.length < 3) return null
                    const pts = roomLines.map(l => ({ x: l.x1, y: l.y1 }))
                    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
                    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
                    const r = 9 / stageScale
                    return (
                      <Group key={'marker-' + room.id}
                        onClick={e => { e.cancelBubble = true; setInspectorRoomId(room.id); setInspectorId(null); setInspectorRoundColumnId(null); setInspectorRectColumnId(null); setSelected(null) }}
                        onTap={e => { if (touchGestureRef.current) return; e.cancelBubble = true; setInspectorRoomId(room.id); setInspectorId(null); setInspectorRoundColumnId(null); setInspectorRectColumnId(null); setSelected(null) }}>
                        <Circle x={cx} y={cy} radius={r} fill="#fff" stroke="#78909c" strokeWidth={1.5 / stageScale} />
                        <Text x={cx - r} y={cy - r} width={r * 2} height={r * 2} text={room.isColumn ? '▦' : '⛶'}
                          fontSize={11 / stageScale} fill="#78909c" align="center" verticalAlign="middle" listening={false} />
                      </Group>
                    )
                  })}

                  {/* Select-маркер круглых колонн — открывает инспектор */}
                  {mode === 'select' && roundColumns.map(rc => {
                    const r = 9 / stageScale
                    return (
                      <Group key={'marker-' + rc.id}
                        onClick={e => { e.cancelBubble = true; setInspectorRoundColumnId(rc.id); setInspectorId(null); setInspectorRoomId(null); setInspectorRectColumnId(null); setSelected(null) }}
                        onTap={e => { if (touchGestureRef.current) return; e.cancelBubble = true; setInspectorRoundColumnId(rc.id); setInspectorId(null); setInspectorRoomId(null); setInspectorRectColumnId(null); setSelected(null) }}>
                        <Circle x={rc.cx} y={rc.cy} radius={r} fill="#fff" stroke="#78909c" strokeWidth={1.5 / stageScale} />
                        <Text x={rc.cx - r} y={rc.cy - r} width={r * 2} height={r * 2} text="⬤"
                          fontSize={11 / stageScale} fill="#78909c" align="center" verticalAlign="middle" listening={false} />
                      </Group>
                    )
                  })}

                  {mode === 'select' && rectColumns.map(rc => {
                    const r = 9 / stageScale
                    return (
                      <Group key={'marker-' + rc.id}
                        onClick={e => { e.cancelBubble = true; setInspectorRectColumnId(rc.id); setInspectorId(null); setInspectorRoomId(null); setInspectorRoundColumnId(null); setSelected(null) }}
                        onTap={e => { if (touchGestureRef.current) return; e.cancelBubble = true; setInspectorRectColumnId(rc.id); setInspectorId(null); setInspectorRoomId(null); setInspectorRoundColumnId(null); setSelected(null) }}>
                        <Rect x={rc.cx - r} y={rc.cy - r} width={r * 2} height={r * 2} fill="#fff" stroke="#78909c" strokeWidth={1.5 / stageScale} />
                        <Text x={rc.cx - r} y={rc.cy - r} width={r * 2} height={r * 2} text="▦"
                          fontSize={11 / stageScale} fill="#78909c" align="center" verticalAlign="middle" listening={false} />
                      </Group>
                    )
                  })}

                  {/* Превью штампа шаблона колонны */}
                  {mode === 'stamp' && stampTemplateId && cursor && (() => {
                    const tpl = templates.find(t => t.id === stampTemplateId)
                    if (!tpl) return null

                    // До того, как центр зафиксирован (круглая колонна — всегда;
                    // прямоугольная — только 1-й клик) — с Ctrl подсвечиваем, куда
                    // прилипнет центр (ряд с соседней колонной), и саму соседнюю линию ряда.
                    const rowSnapActive = ctrlDown && !stampCenter
                    const rowNeighbor = rowSnapActive ? nearestColumnCenter(cursor.x, cursor.y, existingColumnCenters) : null
                    const previewCursor = rowNeighbor ? snapToColumnRow(cursor.x, cursor.y, existingColumnCenters) : cursor

                    if (tpl.kind === 'roundColumn') {
                      const r = mmToPx(tpl.diameterMm, scaleMmPx) / 2
                      return (
                        <>
                          {rowNeighbor && (
                            <Line points={[rowNeighbor.cx, rowNeighbor.cy, previewCursor.x, previewCursor.y]}
                              stroke="#4caf50" strokeWidth={1} dash={[4, 4]} listening={false} />
                          )}
                          <Circle x={previewCursor.x} y={previewCursor.y} radius={r}
                            stroke="#c5a880" strokeWidth={1.5} dash={[6, 3]} fill="rgba(197,168,128,0.12)" listening={false} />
                        </>
                      )
                    }

                    // rectColumn: до 1-го клика — превью по курсору (с учётом снапа
                    // в ряд) без поворота; после — крутится вокруг зафиксированного center
                    const center = stampCenter ?? previewCursor
                    let angle = stampCenter ? angleTo(stampCenter.x, stampCenter.y, cursor.x, cursor.y) : 0
                    if (stampCenter && orthoMode) angle = snapAngleToStep(angle, 15)
                    const corners = rectColumnCornersPx(center.x, center.y, tpl.widthMm, tpl.depthMm, angle, scaleMmPx)
                    const flat = corners.flatMap(p => [p.x, p.y])
                    return (
                      <>
                        {rowNeighbor && (
                          <Line points={[rowNeighbor.cx, rowNeighbor.cy, previewCursor.x, previewCursor.y]}
                            stroke="#4caf50" strokeWidth={1} dash={[4, 4]} listening={false} />
                        )}
                        <Line points={flat} closed stroke="#c5a880" strokeWidth={1.5} dash={[6, 3]}
                          fill="rgba(197,168,128,0.12)" listening={false} />
                        {stampCenter && (
                          <>
                            <Line points={[stampCenter.x, stampCenter.y, cursor.x, cursor.y]}
                              stroke="#c5a880" strokeWidth={1} dash={[2, 3]} listening={false} />
                            <Circle x={stampCenter.x} y={stampCenter.y} radius={3 / stageScale} fill="#c5a880" listening={false} />
                          </>
                        )}
                      </>
                    )
                  })()}

                  {/* Превью рисования */}
                  {mode === 'draw' && drawing && previewPt && (() => {
                    const previewVis = getLineVisual(drawType, drawSpec?.material, drawSpec?.subtype, drawSpec?.gapMm)
                    const previewColor = previewVis.colorOverride ?? LINE_COLORS[drawType]
                    return (
                      <>
                        <Line points={[drawing.x1,drawing.y1,previewX2,previewY2]}
                          stroke={previewColor} strokeWidth={previewVis.strokeWidth || LINE_WIDTH[drawType]}
                          dash={previewVis.dash ?? undefined} opacity={0.6} lineCap="round" listening={false} />
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
                    const curVis = getLineVisual(drawType, drawSpec?.material, drawSpec?.subtype, drawSpec?.gapMm)
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
              <div style={{ padding: '10px 16px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e2433' }}>
                  Конструкции на плане
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {progressSummary.totalSurfaces > 0 && (
                    <div title={progressSummary.byTypePercent.map(t => `${t.label}: ${t.percent}%`).join(' · ')}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#555' }}>
                      <span>Прогресс:</span>
                      <div style={{ width: 60, height: 6, borderRadius: 3, background: '#eee', overflow: 'hidden' }}>
                        <div style={{ width: `${progressSummary.overallPercent}%`, height: '100%', background: progressSummary.overallPercent === 100 ? '#43a047' : '#3a7bd5' }} />
                      </div>
                      <span style={{ fontWeight: 700 }}>{progressSummary.overallPercent}%</span>
                    </div>
                  )}
                  {sheetSummary.surfaces.length > 0 && (
                  <button onClick={() => setShowSheetSummary(true)}
                    style={{
                      fontSize: 11, fontWeight: 600, color: '#fff', background: '#3a7bd5',
                      border: 'none', borderRadius: 5, padding: '5px 10px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                    📋 Смета раскроя ({sheetSummary.totalSheetsNeeded} л.)
                  </button>
                  )}
                  {fastenerSummary.totalQty > 0 && (
                  <button onClick={() => setShowFastenerSummary(true)}
                    style={{
                      fontSize: 11, fontWeight: 600, color: '#fff', background: '#6a4fb5',
                      border: 'none', borderRadius: 5, padding: '5px 10px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                    🔩 Смета крепежа ({fastenerSummary.totalQty} шт)
                  </button>
                  )}
                </div>
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
                  {lines.filter(l => l.type !== 'rib_beam').map((l, i) => {
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
                          <span style={{ color: lineProgressColor(l.buildProgress) }}>●</span>
                          {' '}{lineProgressSummary(l.buildProgress)}
                        </td>
                        <td style={{ ...tdS, display: 'flex', gap: 4 }}>
                          <button title="Просмотр" style={iconBtnStyle} onClick={e => { e.stopPropagation(); setSelected(l.id); setInspectorId(l.id); setMode('select') }}>👁</button>
                          <button title="Открыть расчёт" style={iconBtnStyle} onClick={e => { e.stopPropagation(); setShowSheetSummary(true) }}>↗</button>
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
                  onClick={() => setShowSheetSummary(true)}
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

            {/* Категория: капитал / изменяемая конструкция */}
            <div style={{ padding: '6px 16px 4px' }}>
              <div style={{ fontSize: 10, color: '#999', marginBottom: 4, textTransform: 'uppercase' }}>Категория</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['capital', 'mutable'] as LineCategory[]).map(cat => {
                  const active = (inspectorLine.category ?? defaultCategory(inspectorLine.type)) === cat
                  return (
                    <button key={cat}
                      onClick={() => updatePlanLine(inspectorLine.id, {
                        category: cat,
                        workStatus: inspectorLine.workStatus ?? defaultStatus(cat),
                      })}
                      style={{
                        flex: 1, fontSize: 11, padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
                        border: active ? '1.5px solid #3a7bd5' : '1px solid #ddd',
                        background: active ? '#eaf2fd' : '#fff',
                        color: active ? '#3a7bd5' : '#666', fontWeight: active ? 700 : 400,
                      }}>
                      {cat === 'capital' ? '🔒 Капитал' : '✏️ Изменяемая'}
                    </button>
                  )
                })}
              </div>
              {(inspectorLine.category ?? defaultCategory(inspectorLine.type)) === 'capital' && (
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>
                  Периметр / колонна / ригель / уровень — не сносится и не двигается, к ней подтягиваются остальные
                </div>
              )}
            </div>

            {/* Этапы строительства — только для изменяемых конструкций (капитал уже стоит) */}
            {(inspectorLine.category ?? defaultCategory(inspectorLine.type)) === 'mutable' && (
              <div style={{ padding: '6px 16px 4px' }}>
                <div style={{ fontSize: 10, color: '#999', marginBottom: 4, textTransform: 'uppercase' }}>Этапы строительства</div>
                <WorkProgressChecklist
                  label="Строительство"
                  progress={inspectorLine.buildProgress}
                  templates={allWorkStageTemplates}
                  onChange={p => updatePlanLine(inspectorLine.id, { buildProgress: p })}
                  onSaveTemplate={t => addCustomWorkStageTemplate(t)}
                />
              </div>
            )}

            {/* Этапы отделки — независимо от прогресса строительства (та — построена ли конструкция) */}
            {(() => {
              const category = finishMaterialCategoryOf(inspectorLine)
              const sides = finishSidesOf(inspectorLine)
              if (!category || sides === 0) return null
              const sideDefs: Array<{ key: 'finishProgressA' | 'finishProgressB'; label: string }> = [
                { key: 'finishProgressA', label: sides === 1 ? 'Отделка' : 'Сторона A' },
                ...(sides === 2 ? [{ key: 'finishProgressB' as const, label: 'Сторона B' }] : []),
              ]
              return (
                <div style={{ padding: '6px 16px 10px', borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 10, color: '#999', marginBottom: 6, textTransform: 'uppercase' }}>Этапы отделки</div>
                  {sideDefs.map(({ key, label }) => (
                    <WorkProgressChecklist
                      key={key}
                      label={label}
                      progress={inspectorLine[key]}
                      templates={allWorkStageTemplates}
                      onChange={p => updatePlanLine(inspectorLine.id, { [key]: p } as Partial<PlanLine>)}
                      onSaveTemplate={t => addCustomWorkStageTemplate(t)}
                    />
                  ))}
                </div>
              )
            })()}

            {/* Ригель: своя геометрия вместо материала — сечение по плану + опускание от потолка */}
            {inspectorLine.type === 'rib_beam' && (
              <div style={{ padding: '6px 16px 10px' }}>
                <div style={{ fontSize: 10, color: '#999', marginBottom: 6, textTransform: 'uppercase' }}>
                  Геометрия ригеля
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: '#666', minWidth: 70 }}>Сечение:</span>
                  <input type="number" value={inspectorLine.sectionWidthMm ?? 300}
                    onChange={e => {
                      const v = parseFloat(e.target.value)
                      if (v > 0) updatePlanLine(inspectorLine.id, { sectionWidthMm: v })
                    }}
                    style={{ width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #ddd' }} />
                  <span style={{ fontSize: 11, color: '#999' }}>мм</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#666', minWidth: 70 }}>Опускание:</span>
                  <input type="number" value={inspectorLine.dropMm ?? 200}
                    onChange={e => {
                      const v = parseFloat(e.target.value)
                      if (v >= 0) updatePlanLine(inspectorLine.id, { dropMm: v })
                    }}
                    style={{ width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid #ddd' }} />
                  <span style={{ fontSize: 11, color: '#999' }}>мм от потолка</span>
                </div>
                <div style={{ fontSize: 10, color: '#aaa', marginTop: 6 }}>
                  Единое целое с перекрытием — резать нельзя, коммуникации в обход.
                  Высота чистового потолка под ригелем ограничена его опусканием.
                </div>
              </div>
            )}

            {/* Боковое примыкание + крепёж — только для перегородок/облицовки (у них есть боковые стойки) */}
            {(inspectorLine.type === 'wall_new' || inspectorLine.type === 'wall_lining') && (() => {
              const att = lineAttachments.get(inspectorLine.id)
              const fasteners = calcLineFasteners(inspectorLine, att)
              const ends: Array<{ key: 'start' | 'end'; label: string; info: EndAttachment | null; qty: number }> = [
                { key: 'start', label: 'Начало (x1,y1)', info: att?.start ?? null, qty: fasteners.start?.qty ?? 0 },
                { key: 'end',   label: 'Конец (x2,y2)',  info: att?.end ?? null,   qty: fasteners.end?.qty ?? 0 },
              ]
              return (
                <div style={{ padding: '6px 16px 8px', borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 10, color: '#999', marginBottom: 6, textTransform: 'uppercase' }}>Боковое примыкание и крепёж</div>
                  {ends.map(({ key, label, info, qty }) => {
                    const overrideField = key === 'start' ? 'fastenerStart' : 'fastenerEnd'
                    const override = inspectorLine[overrideField]
                    const suggested = info ? suggestFastener(info.material) : null
                    const currentType: FastenerType | '' = override?.type ?? suggested ?? ''
                    const currentStep = override?.stepMm ?? DEFAULT_FASTENER_STEP_MM
                    return (
                      <div key={key} style={{ marginBottom: 8, padding: '6px 8px', background: '#fafbfc', borderRadius: 5, border: '1px solid #eee' }}>
                        <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>
                          {label}: {info ? <b>{ATTACHMENT_MATERIAL_LABEL[info.material]}</b> : <span style={{ color: '#aaa' }}>свободный край</span>}
                        </div>
                        {info && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select
                              value={currentType}
                              onChange={e => {
                                const type = e.target.value as FastenerType
                                updatePlanLine(inspectorLine.id, {
                                  [overrideField]: { type, stepMm: currentStep },
                                } as Partial<PlanLine>)
                              }}
                              style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 5, border: '1px solid #ddd' }}>
                              {!currentType && <option value="">Выберите тип крепежа</option>}
                              {FASTENER_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                            <input type="number" value={currentStep}
                              onChange={e => {
                                const stepMm = parseFloat(e.target.value)
                                if (stepMm > 0 && currentType) {
                                  updatePlanLine(inspectorLine.id, {
                                    [overrideField]: { type: currentType, stepMm },
                                  } as Partial<PlanLine>)
                                }
                              }}
                              title="Шаг крепежа, мм"
                              style={{ width: 64, fontSize: 11, padding: '5px 6px', borderRadius: 5, border: '1px solid #ddd' }} />
                            <span style={{ fontSize: 11, color: '#555', alignSelf: 'center', whiteSpace: 'nowrap' }}>
                              {qty} шт
                            </span>
                          </div>
                        )}
                        {info && !suggested && !override && (
                          <div style={{ fontSize: 10, color: '#e57373', marginTop: 3 }}>
                            Материал соседней конструкции не задан — выберите крепёж вручную
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}

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

                  {/* Шаг стоек и лист обшивки — переопределение для этой линии (дефолт см. в левой панели при рисовании) */}
                  {(inspectorLine.type === 'wall_new' || inspectorLine.type === 'wall_lining') && inspectorLine.spec?.material === 'gkl' && (
                    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Шаг стоек и лист</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: '#666' }}>Шаг:</span>
                        <input type="number" value={inspectorLine.spec?.step ?? ''}
                          placeholder="600"
                          onChange={e => {
                            const step = parseFloat(e.target.value)
                            if (inspectorLine.spec) updatePlanLine(inspectorLine.id, { spec: { ...inspectorLine.spec, step: step > 0 ? step : undefined } })
                          }}
                          style={{ width: 70, fontSize: 12, padding: '5px 6px', borderRadius: 5, border: '1px solid #ddd' }} />
                        <span style={{ fontSize: 11, color: '#666' }}>мм</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                        Лист 1-го слоя{(inspectorLine.spec?.layers ?? 1) === 2 ? ' / 2-го слоя' : ''}:
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                        <BoardSpecSelector
                          value={inspectorLine.spec?.layer1 ?? DEFAULT_BOARD_SPEC}
                          onChange={layer1 => { if (inspectorLine.spec) updatePlanLine(inspectorLine.id, { spec: { ...inspectorLine.spec, layer1 } }) }}
                        />
                        {(inspectorLine.spec?.layers ?? 1) === 2 && (
                          <BoardSpecSelector
                            value={inspectorLine.spec?.layer2 ?? DEFAULT_BOARD_SPEC}
                            onChange={layer2 => { if (inspectorLine.spec) updatePlanLine(inspectorLine.id, { spec: { ...inspectorLine.spec, layer2 } }) }}
                          />
                        )}
                      </div>
                    </div>
                  )}

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
                            <span style={{ fontWeight: 600, color: op.type === 'door' ? '#8d6e63' : op.type === 'window' ? '#42a5f5' : '#78909c', minWidth: 32 }}>{op.label}</span>
                            <span style={{ color: '#666' }}>
                              {op.type === 'door'
                                ? `дверь, отступ ${op.offsetMm}, ${op.widthMm}×${op.heightMm}мм`
                                : op.type === 'window'
                                  ? `окно, отступ ${op.offsetMm}, ${op.widthMm}×${op.heightMm}мм, низ от пола ${op.sillHeightMm ?? 900}мм`
                                  : `проём, отступ ${op.offsetMm}, ${op.widthMm}×${op.heightMm}мм${op.sillHeightMm ? `, низ от пола ${op.sillHeightMm}мм` : ''}`}
                            </span>
                            <button onClick={() => removeOpening(inspectorLine.id, op.id)}
                              style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#e57373', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      {(['door', 'window', 'opening'] as const).map(t => {
                        const color = t === 'door' ? '#8d6e63' : t === 'window' ? '#42a5f5' : '#78909c'
                        return (
                          <button key={t}
                            onClick={() => {
                              setOpeningType(t)
                              setOpeningHeight(t === 'window' ? '1200' : '2000')
                              if (t === 'opening') setOpeningSill('0')
                              else if (t === 'window') setOpeningSill('900')
                            }}
                            style={{
                              flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 4, cursor: 'pointer',
                              border: `1px solid ${openingType === t ? color : '#dde'}`,
                              background: openingType === t ? color + '20' : '#fff',
                              color: openingType === t ? color : '#888',
                            }}>
                            {t === 'door' ? 'Дверь' : t === 'window' ? 'Окно' : 'Проём'}
                          </button>
                        )
                      })}
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
                        placeholder={openingType === 'window' ? 'высота окна, мм' : 'высота проёма, мм'}
                        value={openingHeight}
                        onChange={e => setOpeningHeight(e.target.value)}
                        style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 4, border: '1px solid #dde', minWidth: 0 }} />
                      {(openingType === 'window' || openingType === 'opening') && (
                        <input type="number" placeholder="низ от пола, мм (0 — от пола)" value={openingSill}
                          onChange={e => setOpeningSill(e.target.value)}
                          style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 4, border: '1px solid #dde', minWidth: 0 }} />
                      )}
                    </div>
                    <button
                      onClick={() => {
                        const offset = parseFloat(openingOffset), width = parseFloat(openingWidth)
                        const height = parseFloat(openingHeight)
                        const sill = openingType !== 'door' ? parseFloat(openingSill) : undefined
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
                    {inspectorLine.sagittaMm ? <span style={{ color: '#888' }}> (длина дуги)</span> : null}
                  </div>
                  {(() => {
                    const chordMm = lineLengthMm(inspectorLine.x1, inspectorLine.y1, inspectorLine.x2, inspectorLine.y2, scaleMmPx)
                    const sagitta = inspectorLine.sagittaMm ?? 0
                    const arcInfo = sagitta ? arcFromChordAndSagitta(0, 0, chordMm, 0, sagitta) : null
                    const displayR = arcInfo ? Math.round(arcInfo.radius) : ''
                    const minR = Math.round(chordMm / 2)
                    return (
                      <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: arcInfo ? 4 : 0 }}>
                          Стрела дуги H:
                          <input type="number" value={sagitta}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || 0
                              const lm = v ? arcLengthFromSagitta(chordMm, v) : chordMm
                              updatePlanLine(inspectorLine.id, { sagittaMm: v || undefined, lengthMm: lm })
                            }}
                            title="0 = прямая линия. R=(L²+H²)/2H, L — половина хорды"
                            style={{ width: 64, fontSize: 12, padding: '3px 5px', borderRadius: 4, border: '1px solid #dde' }} /> мм
                        </div>
                        {arcInfo && (
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                            Хорда: {fmtLen(chordMm)} · Радиус R: <b>{fmtLen(Math.round(arcInfo.radius))}</b>
                          </div>
                        )}
                        {/* Альтернативный ввод — сразу радиусом (нужен, когда несколько
                            арок с разной хордой должны иметь ОДИН и тот же радиус —
                            через H этого не добиться, при разной хорде выйдет разный R) */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 4, borderTop: '1px dashed #eee' }}>
                          или Радиус R:
                          <input type="number" value={displayR}
                            onChange={e => {
                              const R = parseFloat(e.target.value) || 0
                              if (!R) { updatePlanLine(inspectorLine.id, { sagittaMm: undefined, lengthMm: chordMm }); return }
                              const h = sagittaFromRadius(chordMm, R, inspectorArcDeep)
                              if (h === null) return  // R меньше минимально возможного для этой хорды — не применяем
                              updatePlanLine(inspectorLine.id, { sagittaMm: h, lengthMm: arcLengthFromSagitta(chordMm, h) })
                            }}
                            title={`Минимально возможный радиус для этой хорды: ${fmtLen(minR)}`}
                            style={{ width: 64, fontSize: 12, padding: '3px 5px', borderRadius: 4, border: '1px solid #dde' }} /> мм
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#999', cursor: 'pointer', marginTop: 3 }}>
                          <input type="checkbox" checked={inspectorArcDeep} onChange={e => setInspectorArcDeep(e.target.checked)} />
                          глубокая дуга (мин. R для этой хорды: {fmtLen(minR)})
                        </label>
                      </div>
                    )
                  })()}
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
                    onClick={() => setShowSheetSummary(true)}>
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
                {room.isColumn && (
                  <button onClick={() => saveRectColumnAsTemplate(room)}
                    style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #c5a880', borderRadius: 5, color: '#8a6d3b', background: '#fdf6ec', cursor: 'pointer' }}>
                    💾 Сохранить как шаблон
                  </button>
                )}
                <button onClick={() => { removeRoom(room.id); setInspectorRoomId(null) }}
                  style={{ marginTop: 4, fontSize: 12, padding: '6px 10px', border: '1px solid #e53935', borderRadius: 5, color: '#e53935', background: '#fff', cursor: 'pointer' }}>
                  🗑 Удалить {room.isColumn ? 'колонну' : 'помещение'}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Инспектор круглой колонны */}
        {!inspectorLine && !inspectorRoomId && inspectorRoundColumnId && (() => {
          const rc = roundColumns.find(r => r.id === inspectorRoundColumnId)
          if (!rc) return null
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
                <div style={{ fontWeight: 700, fontSize: 14 }}>Колонна (круглая)</div>
                <button title="Закрыть" style={iconBtnStyle2} onClick={() => setInspectorRoundColumnId(null)}>✕</button>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ fontSize: 12, color: '#555' }}>
                  Название
                  <input value={rc.label} onChange={e => updateRoundColumn(rc.id, { label: e.target.value })}
                    style={{ width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 5, fontSize: 13 }} />
                </label>
                <label style={{ fontSize: 12, color: '#555' }}>
                  Диаметр, мм
                  <input type="number" value={rc.diameterMm}
                    onChange={e => { const v = parseFloat(e.target.value); if (v > 0) updateRoundColumn(rc.id, { diameterMm: v }) }}
                    style={{ width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 5, fontSize: 13 }} />
                </label>
                <ConstructionSpecSelector planType="wall_existing" value={rc.spec}
                  onChange={spec => updateRoundColumn(rc.id, { spec })} />
                <div style={{ fontSize: 12, color: '#888' }}>
                  Площадь сечения: <b>{rectAreaM2Circle(rc.diameterMm).toFixed(2)} м²</b>
                </div>
                <button onClick={() => saveRoundColumnAsTemplate(rc)}
                  style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #c5a880', borderRadius: 5, color: '#8a6d3b', background: '#fdf6ec', cursor: 'pointer' }}>
                  💾 Сохранить как шаблон
                </button>
                <button onClick={() => { removeRoundColumn(rc.id); setInspectorRoundColumnId(null) }}
                  style={{ marginTop: 4, fontSize: 12, padding: '6px 10px', border: '1px solid #e53935', borderRadius: 5, color: '#e53935', background: '#fff', cursor: 'pointer' }}>
                  🗑 Удалить колонну
                </button>
              </div>
            </div>
          )
        })()}

        {!inspectorLine && !inspectorRoomId && !inspectorRoundColumnId && inspectorRectColumnId && (() => {
          const rc = rectColumns.find(r => r.id === inspectorRectColumnId)
          if (!rc) return null
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
                <div style={{ fontWeight: 700, fontSize: 14 }}>Колонна (прямоугольная)</div>
                <button title="Закрыть" style={iconBtnStyle2} onClick={() => setInspectorRectColumnId(null)}>✕</button>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ fontSize: 12, color: '#555' }}>
                  Название
                  <input value={rc.label} onChange={e => updateRectColumn(rc.id, { label: e.target.value })}
                    style={{ width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 5, fontSize: 13 }} />
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label style={{ fontSize: 12, color: '#555', flex: 1 }}>
                    Ширина, мм
                    <input type="number" value={rc.widthMm}
                      onChange={e => { const v = parseFloat(e.target.value); if (v > 0) updateRectColumn(rc.id, { widthMm: v }) }}
                      style={{ width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 5, fontSize: 13 }} />
                  </label>
                  <label style={{ fontSize: 12, color: '#555', flex: 1 }}>
                    Глубина, мм
                    <input type="number" value={rc.depthMm}
                      onChange={e => { const v = parseFloat(e.target.value); if (v > 0) updateRectColumn(rc.id, { depthMm: v }) }}
                      style={{ width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 5, fontSize: 13 }} />
                  </label>
                </div>
                <label style={{ fontSize: 12, color: '#555' }}>
                  Поворот, °
                  <input type="number" value={Math.round(rc.angleRad * 180 / Math.PI)}
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) updateRectColumn(rc.id, { angleRad: v * Math.PI / 180 }) }}
                    style={{ width: '100%', marginTop: 4, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 5, fontSize: 13 }} />
                </label>
                <ConstructionSpecSelector planType="wall_existing" value={rc.spec}
                  onChange={spec => updateRectColumn(rc.id, { spec })} />
                <div style={{ fontSize: 12, color: '#888' }}>
                  Площадь сечения: <b>{rectAreaM2(rc.widthMm, rc.depthMm).toFixed(2)} м²</b>
                </div>
                <button onClick={() => saveRectColumnEntityAsTemplate(rc)}
                  style={{ fontSize: 12, padding: '6px 10px', border: '1px solid #c5a880', borderRadius: 5, color: '#8a6d3b', background: '#fdf6ec', cursor: 'pointer' }}>
                  💾 Сохранить как шаблон
                </button>
                <button onClick={() => { removeRectColumn(rc.id); setInspectorRectColumnId(null) }}
                  style={{ marginTop: 4, fontSize: 12, padding: '6px 10px', border: '1px solid #e53935', borderRadius: 5, color: '#e53935', background: '#fff', cursor: 'pointer' }}>
                  🗑 Удалить колонну
                </button>
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Смета раскроя листов ГКЛ (проектный расчёт) ── */}
      {showSheetSummary && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowSheetSummary(false)}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 0, width: 640, maxWidth: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e0e4ee' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e2433' }}>📋 Смета раскроя ГКЛ</div>
              <button onClick={() => setShowSheetSummary(false)} style={iconBtnStyle2}>✕</button>
            </div>

            {sheetSummary.surfaces.length === 0 ? (
              <div style={{ padding: 24, fontSize: 12, color: '#888', textAlign: 'center' }}>
                Нет конструкций с раскроем ГКЛ — задайте материал «ГКЛ» перегородкам или облицовкам на плане
              </div>
            ) : (
              <>
                <div style={{ overflowY: 'auto', padding: '0 20px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f5f7fb' }}>
                        <th style={thS}>№</th>
                        <th style={thS}>Конструкция</th>
                        <th style={thS}>Листов</th>
                        <th style={thS}>Использовано</th>
                        <th style={thS}>Куплено</th>
                        <th style={thS}>Отходы</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheetSummary.surfaces.map((s, i) => (
                        <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={tdS}>{i + 1}</td>
                          <td style={tdS}>{s.label}</td>
                          <td style={tdS}>{s.result.totalSheetsNeeded}</td>
                          <td style={tdS}>{s.result.totalUsedAreaM2.toFixed(2)} м²</td>
                          <td style={tdS}>{s.result.totalSheetAreaM2.toFixed(2)} м²</td>
                          <td style={tdS}>
                            <span style={{ color: s.result.totalWastePercent > 15 ? '#e53935' : '#888' }}>
                              {s.result.totalWastePercent}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ padding: '14px 20px', borderTop: '1px solid #e0e4ee', background: '#f5f7fb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: '#1e2433', marginBottom: 6 }}>
                    <span>Итого листов:</span>
                    <span>{sheetSummary.totalSheetsNeeded} шт</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555', marginBottom: 3 }}>
                    <span>Использовано площади:</span>
                    <span>{sheetSummary.totalUsedAreaM2.toFixed(2)} м²</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555', marginBottom: 3 }}>
                    <span>Куплено площади листов:</span>
                    <span>{sheetSummary.totalSheetAreaM2.toFixed(2)} м²</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555', marginBottom: 3 }}>
                    <span>Отходы:</span>
                    <span style={{ color: sheetSummary.totalWastePercent > 15 ? '#e53935' : '#555', fontWeight: 600 }}>
                      {sheetSummary.totalWastePercent}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888' }}>
                    <span>Остаток обрезков в пуле:</span>
                    <span>{sheetSummary.finalOffcuts.length} шт · {sheetSummary.totalOffcutAreaM2.toFixed(2)} м²</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 8 }}>
                    Обрезки переносятся последовательно между конструкциями — порядок совпадает
                    с порядком в таблице «Конструкции на плане».
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Смета крепежа боковых примыканий (проектный расчёт) ── */}
      {showFastenerSummary && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowFastenerSummary(false)}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 0, width: 640, maxWidth: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e0e4ee' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e2433' }}>🔩 Смета крепежа боковых примыканий</div>
              <button onClick={() => setShowFastenerSummary(false)} style={iconBtnStyle2}>✕</button>
            </div>

            {fastenerSummary.rows.length === 0 ? (
              <div style={{ padding: 24, fontSize: 12, color: '#888', textAlign: 'center' }}>
                Нет линий с определённым боковым примыканием — крепёж считается только там,
                где конец конструкции упирается в другую (стену, монолит, блок и т.п.)
              </div>
            ) : (
              <>
                <div style={{ overflowY: 'auto', padding: '0 20px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f5f7fb' }}>
                        <th style={thS}>№</th>
                        <th style={thS}>Конструкция</th>
                        <th style={thS}>Начало</th>
                        <th style={thS}>Конец</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fastenerSummary.rows.map((r, i) => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={tdS}>{i + 1}</td>
                          <td style={tdS}>{r.label}</td>
                          <td style={tdS}>{r.startLabel ?? <span style={{ color: '#ccc' }}>—</span>}</td>
                          <td style={tdS}>{r.endLabel ?? <span style={{ color: '#ccc' }}>—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ padding: '14px 20px', borderTop: '1px solid #e0e4ee', background: '#f5f7fb' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e2433', marginBottom: 8 }}>
                    Итого по типам:
                  </div>
                  {fastenerSummary.totalsList.map(t => (
                    <div key={t.type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555', marginBottom: 3 }}>
                      <span>{t.label}</span>
                      <span style={{ fontWeight: 600 }}>{t.qty} шт</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 8 }}>
                    Крепёж по умолчанию подобран автоматически по материалу соседней
                    конструкции — тип и шаг можно переопределить вручную в инспекторе
                    линии, раздел «Боковое примыкание и крепёж».
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
