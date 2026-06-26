/**
 * FloorPlan — план объекта.
 *
 * Виды:
 *   top  — вид сверху (план): рисование линий, замыкание периметров, площади
 *   side — вид сбоку: заглушка, в будущем профиль стены
 *
 * Режимы (вид сверху):
 *   draw    — рисование линий кликом старт → финиш
 *   select  — выбор линий для контура / удаление
 *   contour — выделяем линии для замыкания периметра
 *   scale   — установка масштаба двумя кликами
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Stage, Layer, Line, Circle, Text, Rect, Group } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useProjectStore } from './store/useProjectStore'
import type { PlanLine, PlanLineType, PlanView, PlanContour } from './types'

// ─── Константы ───────────────────────────────────────────────────────────────

const CANVAS_H = 520
const SNAP_PX  = 18

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
  wall_new:      4,
  wall_lining:   3,
  wall_existing: 5,
  ceiling:       2,
  floor:         2,
}

// Типы у которых есть вид сбоку
const HAS_SIDE_VIEW: PlanLineType[] = ['wall_new', 'wall_lining', 'floor']

type Mode = 'draw' | 'select' | 'contour' | 'scale'

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

function lineLengthMm(x1: number, y1: number, x2: number, y2: number, s: number) {
  return Math.round(dist(x1, y1, x2, y2) * s)
}

function snapPoint(x: number, y: number, lines: PlanLine[]) {
  let best = { x, y, snapped: false, d: SNAP_PX }
  for (const l of lines) {
    for (const [px, py] of [[l.x1, l.y1], [l.x2, l.y2]] as [number, number][]) {
      const d = dist(x, y, px, py)
      if (d < best.d) best = { x: px, y: py, snapped: true, d }
    }
  }
  return best
}

/** Площадь по формуле Гаусса (Shoelace) для набора точек */
function polygonAreaM2(points: { x: number; y: number }[], scaleMmPx: number): number {
  const n = points.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }
  const areaPx2 = Math.abs(area) / 2
  const areaM2 = areaPx2 * (scaleMmPx / 1000) ** 2
  return areaM2
}

/** Извлекаем упорядоченные точки из набора линий (обход контура) */
function extractContourPoints(lineIds: string[], lines: PlanLine[]): { x: number; y: number }[] {
  const selected = lineIds.map(id => lines.find(l => l.id === id)).filter(Boolean) as PlanLine[]
  if (selected.length < 3) return []

  // Строим граф смежности
  const pts: { x: number; y: number }[] = []
  let current = selected[0]
  const used = new Set<string>()
  used.add(current.id)
  pts.push({ x: current.x1, y: current.y1 })
  pts.push({ x: current.x2, y: current.y2 })

  let prevEnd = { x: current.x2, y: current.y2 }
  for (let i = 1; i < selected.length; i++) {
    const next = selected.find(l => !used.has(l.id) && (
      (Math.abs(l.x1 - prevEnd.x) < 2 && Math.abs(l.y1 - prevEnd.y) < 2) ||
      (Math.abs(l.x2 - prevEnd.x) < 2 && Math.abs(l.y2 - prevEnd.y) < 2)
    ))
    if (!next) break
    used.add(next.id)
    if (Math.abs(next.x1 - prevEnd.x) < 2 && Math.abs(next.y1 - prevEnd.y) < 2) {
      prevEnd = { x: next.x2, y: next.y2 }
      pts.push(prevEnd)
    } else {
      prevEnd = { x: next.x1, y: next.y1 }
      pts.push(prevEnd)
    }
  }
  return pts
}

function fmtArea(m2: number) {
  return m2 < 0.01 ? '<0.01 м²' : `${m2.toFixed(2)} м²`
}

// ─── Компонент ───────────────────────────────────────────────────────────────

export default function FloorPlan() {
  const {
    floorPlan, addPlanLine, updatePlanLine, removePlanLine,
    setFloorPlanScale, clearFloorPlan,
    addContour, removeContour,
  } = useProjectStore()

  const lines    = floorPlan?.lines    ?? []
  const contours = floorPlan?.contours ?? []
  const scaleMmPx = floorPlan?.scaleMmPerPx ?? 10

  // ── Состояние UI ──────────────────────────────────────────────────────────
  const [planView, setPlanView]       = useState<PlanView>('top')
  const [mode, setMode]               = useState<Mode>('draw')
  const [drawType, setDrawType]       = useState<PlanLineType>('wall_new')
  const [drawing, setDrawing]         = useState<{ x1: number; y1: number } | null>(null)
  const [cursor, setCursor]           = useState<{ x: number; y: number } | null>(null)
  const [selectedId, setSelected]     = useState<string | null>(null)
  const [contourIds, setContourIds]   = useState<string[]>([])   // линии для замыкания
  const [contourType, setContourType] = useState<PlanLineType>('ceiling')
  const [contourLabel, setContourLabel] = useState('')

  // Масштаб
  const [scaleStep, setScaleStep]         = useState<0 | 1 | 2>(0)
  const [scalePt1, setScalePt1]           = useState<{ x: number; y: number } | null>(null)
  const [scalePt2, setScalePt2]           = useState<{ x: number; y: number } | null>(null)
  const [scaleMmInput, setScaleMmInput]   = useState('')
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

  // ── Позиция из события (mouse + touch) ───────────────────────────────────
  function getPos(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    const stage = e.target.getStage()
    if (!stage) return null
    const te = e.evt as TouchEvent
    if (te.touches?.length > 0) {
      const rect = stage.container().getBoundingClientRect()
      return { x: te.touches[0].clientX - rect.left, y: te.touches[0].clientY - rect.top }
    }
    return stage.getPointerPosition()
  }

  // ── Превью длины ─────────────────────────────────────────────────────────
  function previewLabel(x2: number, y2: number) {
    if (!drawing) return ''
    const mm = lineLengthMm(drawing.x1, drawing.y1, x2, y2, scaleMmPx)
    if (mm < 10) return ''
    return mm >= 1000 ? `${(mm / 1000).toFixed(2)}м` : `${mm}мм`
  }

  // ── Клик по холсту ───────────────────────────────────────────────────────
  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const pos = getPos(e)
    if (!pos) return

    if (mode === 'scale') {
      const s = snapPoint(pos.x, pos.y, lines)
      if (scaleStep === 0) { setScalePt1({ x: s.x, y: s.y }); setScaleStep(1) }
      else if (scaleStep === 1) { setScalePt2({ x: s.x, y: s.y }); setScaleStep(2); setShowScaleDialog(true) }
      return
    }

    if (mode === 'draw') {
      const s = snapPoint(pos.x, pos.y, lines)
      const pt = { x: s.x, y: s.y }
      if (!drawing) {
        setDrawing({ x1: pt.x, y1: pt.y })
      } else {
        const d = dist(drawing.x1, drawing.y1, pt.x, pt.y)
        if (d < 5) { setDrawing(null); return }
        const lengthMm = lineLengthMm(drawing.x1, drawing.y1, pt.x, pt.y, scaleMmPx)
        const count = lines.filter(l => l.type === drawType).length + 1
        addPlanLine({
          x1: drawing.x1, y1: drawing.y1,
          x2: pt.x, y2: pt.y,
          type: drawType, lengthMm,
          label: `${LINE_LABELS[drawType]} ${count}`,
        })
        setDrawing({ x1: pt.x, y1: pt.y })
      }
      return
    }

    if (mode === 'select') { setSelected(null); return }
    if (mode === 'contour') { /* клики по линиям обрабатываются в handleLineClick */ }
  }, [mode, drawing, lines, scaleMmPx, drawType, scaleStep, addPlanLine])

  // ── Движение мыши ────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    setCursor(snapPoint(pos.x, pos.y, lines))
  }, [lines])

  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    const te = e.evt as TouchEvent
    if (!te.touches.length) return
    const rect = stage.container().getBoundingClientRect()
    const pos = { x: te.touches[0].clientX - rect.left, y: te.touches[0].clientY - rect.top }
    setCursor(snapPoint(pos.x, pos.y, lines))
  }, [lines])

  // ── Клик по линии ────────────────────────────────────────────────────────
  const handleLineClick = useCallback((id: string, e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true
    if (mode === 'select') { setSelected(id) }
    if (mode === 'contour') {
      setContourIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      )
    }
  }, [mode])

  // ── Escape / Delete ───────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setDrawing(null); setSelected(null)
      setScaleStep(0); setScalePt1(null); setScalePt2(null)
    }
    if (e.key === 'Delete' && selectedId) {
      removePlanLine(selectedId); setSelected(null)
    }
  }, [selectedId, removePlanLine])

  // ── Замкнуть периметр ────────────────────────────────────────────────────
  function handleCloseContour() {
    if (contourIds.length < 3) return
    const pts = extractContourPoints(contourIds, lines)
    const areaM2 = polygonAreaM2(pts, scaleMmPx)
    const count = contours.filter(c => c.type === contourType).length + 1
    addContour({
      lineIds: contourIds,
      areaM2,
      type: contourType,
      label: contourLabel.trim() || `${LINE_LABELS[contourType]} ${count}`,
    })
    setContourIds([])
    setContourLabel('')
    setMode('draw')
  }

  // ── Масштаб ──────────────────────────────────────────────────────────────
  function applyScale() {
    if (!scalePt1 || !scalePt2) return
    const mm = parseFloat(scaleMmInput)
    if (!mm || mm <= 0) return
    const px = dist(scalePt1.x, scalePt1.y, scalePt2.x, scalePt2.y)
    if (px < 1) return
    setFloorPlanScale(mm / px)
    setShowScaleDialog(false); setScaleStep(0)
    setScalePt1(null); setScalePt2(null); setScaleMmInput('')
    setMode('draw')
  }

  // ── Центроид контура для подписи ─────────────────────────────────────────
  function contourCentroid(c: PlanContour) {
    const pts = extractContourPoints(c.lineIds, lines)
    if (!pts.length) return null
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    return { x: cx, y: cy }
  }

  const selectedLine = lines.find(l => l.id === selectedId)
  const previewX2 = cursor?.x ?? (drawing?.x1 ?? 0)
  const previewY2 = cursor?.y ?? (drawing?.y1 ?? 0)
  const allPoints  = lines.flatMap(l => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }])

  // ─────────────────────────────────────────────────────────────────────────
  // РЕНДЕР
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ outline: 'none' }} tabIndex={0} onKeyDown={handleKeyDown}>

      {/* ── Переключатель вид сверху / сбоку ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 10, borderRadius: 7, overflow: 'hidden', border: '1px solid #ddd', width: 'fit-content' }}>
        {([['top', '🗺 Вид сверху'], ['side', '📐 Вид сбоку']] as [PlanView, string][]).map(([v, label]) => (
          <button key={v} onClick={() => setPlanView(v)}
            style={{
              padding: '7px 18px', fontSize: 13, cursor: 'pointer', border: 'none',
              background: planView === v ? '#3a7bd5' : '#f5f5f5',
              color: planView === v ? '#fff' : '#555',
              fontWeight: planView === v ? 600 : 400,
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* ══════════════ ВИД СБОКУ ══════════════ */}
      {planView === 'side' && (
        <div style={{ padding: 24, background: '#f9f9f9', border: '1px solid #eee', borderRadius: 8, color: '#888', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📐</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Вид сбоку</div>
          <div style={{ fontSize: 12 }}>
            Выберите конструкцию на виде сверху и нажмите "Открыть вид сбоку".<br />
            Здесь будет отображаться профиль стены с высотами, проёмами и слоями ГКЛ.
          </div>
          {selectedLine && HAS_SIDE_VIEW.includes(selectedLine.type) && (
            <div style={{ marginTop: 16, padding: '10px 16px', background: '#fff', borderRadius: 6, border: `2px solid ${LINE_COLORS[selectedLine.type]}`, display: 'inline-block' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: LINE_COLORS[selectedLine.type] }}>{selectedLine.label}</div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                Длина: {selectedLine.lengthMm >= 1000 ? `${(selectedLine.lengthMm / 1000).toFixed(3)}м` : `${selectedLine.lengthMm}мм`}
              </div>
              <button style={{ marginTop: 8, padding: '5px 14px', fontSize: 12, borderRadius: 5, border: 'none', background: LINE_COLORS[selectedLine.type], color: '#fff', cursor: 'pointer' }}>
                Открыть расчёт →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ ВИД СВЕРХУ ══════════════ */}
      {planView === 'top' && (<>

        {/* ── Панель инструментов ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>

          {/* Режимы */}
          {([
            ['draw',    '✏️ Рисовать'],
            ['select',  '↖ Выбрать'],
            ['contour', '⬡ Периметр'],
            ['scale',   '📐 Масштаб'],
          ] as [Mode, string][]).map(([m, label]) => (
            <button key={m}
              onClick={() => { setMode(m); setDrawing(null); setSelected(null) }}
              style={{
                padding: '5px 11px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                border: '1px solid #ccc',
                background: mode === m ? '#3a7bd5' : '#f5f5f5',
                color: mode === m ? '#fff' : '#333',
                fontWeight: mode === m ? 600 : 400,
              }}>
              {label}
            </button>
          ))}

          <div style={{ width: 1, height: 22, background: '#ddd', margin: '0 2px' }} />

          {/* Тип линии (только draw) */}
          {mode === 'draw' && (Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setDrawType(t)}
              style={{
                padding: '4px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                border: `2px solid ${LINE_COLORS[t]}`,
                background: drawType === t ? LINE_COLORS[t] : '#fff',
                color: drawType === t ? '#fff' : LINE_COLORS[t],
                fontWeight: drawType === t ? 600 : 400,
              }}>
              {label}
            </button>
          ))}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#999' }}>
              1px = {scaleMmPx >= 10 ? `${Math.round(scaleMmPx)}мм` : `${scaleMmPx.toFixed(1)}мм`}
            </span>
            {lines.length > 0 && (
              <button onClick={() => { if (confirm('Очистить план?')) clearFloorPlan() }}
                style={{ padding: '4px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid #e57373', background: '#fff', color: '#e53935' }}>
                🗑
              </button>
            )}
          </div>
        </div>

        {/* ── Панель режима "Периметр" ── */}
        {mode === 'contour' && (
          <div style={{ marginBottom: 8, padding: '10px 14px', background: '#f3f0ff', border: '1px solid #c5b8f5', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#5e35b1', marginBottom: 8, fontWeight: 600 }}>
              ⬡ Режим периметра — выделите линии образующие замкнутый контур
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#666' }}>Тип:</span>
              {(Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
                <button key={t} onClick={() => setContourType(t)}
                  style={{
                    padding: '3px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                    border: `2px solid ${LINE_COLORS[t]}`,
                    background: contourType === t ? LINE_COLORS[t] : '#fff',
                    color: contourType === t ? '#fff' : LINE_COLORS[t],
                  }}>
                  {label}
                </button>
              ))}
              <input
                value={contourLabel}
                onChange={e => setContourLabel(e.target.value)}
                placeholder="Название (необязательно)"
                style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, width: 160 }}
              />
              <button
                onClick={handleCloseContour}
                disabled={contourIds.length < 3}
                style={{
                  padding: '5px 14px', fontSize: 12, borderRadius: 5, cursor: contourIds.length < 3 ? 'not-allowed' : 'pointer',
                  border: 'none', background: contourIds.length >= 3 ? '#5e35b1' : '#ccc',
                  color: '#fff', fontWeight: 600,
                }}>
                Замкнуть периметр ({contourIds.length} линий)
              </button>
              {contourIds.length > 0 && (
                <button onClick={() => setContourIds([])}
                  style={{ padding: '4px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid #ccc', background: '#fff', color: '#666' }}>
                  Сбросить
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Подсказка ── */}
        <div style={{ fontSize: 11, color: '#999', marginBottom: 6, minHeight: 15 }}>
          {mode === 'draw'    && !drawing && '👆 Кликните — начало линии. Esc — отмена.'}
          {mode === 'draw'    && drawing  && '👆 Кликните — конец линии. Esc — отмена.'}
          {mode === 'select'  && '👆 Кликните на линию. Delete — удалить.'}
          {mode === 'contour' && '👆 Тапайте по линиям чтобы выбрать их в периметр (выделятся жёлтым).'}
          {mode === 'scale'   && scaleStep === 0 && '📐 Кликните первую точку отрезка известной длины.'}
          {mode === 'scale'   && scaleStep === 1 && '📐 Кликните вторую точку.'}
        </div>

        {/* ── Холст ── */}
        <div ref={containerRef}
          style={{ border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', background: '#fafafa', cursor: mode === 'draw' ? 'crosshair' : 'default', touchAction: 'none' }}>
          <Stage ref={stageRef} width={canvasW} height={CANVAS_H}
            onClick={handleStageClick} onTap={handleStageClick}
            onMouseMove={handleMouseMove} onTouchMove={handleTouchMove}>
            <Layer>
              {/* Фон */}
              <Rect x={0} y={0} width={canvasW} height={CANVAS_H} fill="#fafafa" />

              {/* Сетка */}
              {Array.from({ length: Math.floor(canvasW / 50) + 1 }, (_, i) => (
                <Line key={`gv${i}`} points={[i*50, 0, i*50, CANVAS_H]} stroke="#ebebeb" strokeWidth={1} />
              ))}
              {Array.from({ length: Math.floor(CANVAS_H / 50) + 1 }, (_, i) => (
                <Line key={`gh${i}`} points={[0, i*50, canvasW, i*50]} stroke="#ebebeb" strokeWidth={1} />
              ))}

              {/* Залитые контуры */}
              {contours.map(c => {
                const pts = extractContourPoints(c.lineIds, lines)
                if (pts.length < 3) return null
                const flatPts = pts.flatMap(p => [p.x, p.y])
                const centroid = contourCentroid(c)
                const color = LINE_COLORS[c.type]
                return (
                  <Group key={c.id}>
                    <Line
                      points={flatPts}
                      closed
                      fill={color + '22'}
                      stroke={color}
                      strokeWidth={1.5}
                      dash={[6, 3]}
                    />
                    {centroid && (
                      <>
                        <Text
                          x={centroid.x - 60} y={centroid.y - 16}
                          width={120} text={c.label}
                          fontSize={11} fill={color} align="center" fontStyle="bold"
                        />
                        <Text
                          x={centroid.x - 60} y={centroid.y - 3}
                          width={120} text={fmtArea(c.areaM2)}
                          fontSize={13} fill={color} align="center" fontStyle="bold"
                        />
                      </>
                    )}
                  </Group>
                )
              })}

              {/* Линии */}
              {lines.map(l => {
                const isSelected  = l.id === selectedId
                const inContour   = contourIds.includes(l.id)
                const color       = LINE_COLORS[l.type]
                const lw          = LINE_WIDTH[l.type]
                const mx          = (l.x1 + l.x2) / 2
                const my          = (l.y1 + l.y2) / 2
                const mm          = l.lengthMm
                const lenLabel    = mm >= 1000 ? `${(mm / 1000).toFixed(2)}м` : `${mm}мм`
                const strokeColor = inContour ? '#ff9800' : isSelected ? '#ff5722' : color
                return (
                  <Group key={l.id}
                    onClick={e => handleLineClick(l.id, e)}
                    onTap={e => handleLineClick(l.id, e)}>
                    <Line points={[l.x1, l.y1, l.x2, l.y2]} stroke="transparent" strokeWidth={24} hitStrokeWidth={24} />
                    <Line points={[l.x1, l.y1, l.x2, l.y2]}
                      stroke={strokeColor}
                      strokeWidth={inContour ? lw + 3 : isSelected ? lw + 2 : lw}
                      lineCap="round"
                    />
                    <Circle x={l.x1} y={l.y1} radius={6} fill={strokeColor} />
                    <Circle x={l.x2} y={l.y2} radius={6} fill={strokeColor} />
                    <Text x={mx - 30} y={my - 16} width={60} text={lenLabel}
                      fontSize={10} fill={strokeColor} align="center" fontStyle="bold" />
                  </Group>
                )
              })}

              {/* Превью */}
              {mode === 'draw' && drawing && cursor && (
                <>
                  <Line points={[drawing.x1, drawing.y1, previewX2, previewY2]}
                    stroke={LINE_COLORS[drawType]} strokeWidth={LINE_WIDTH[drawType]}
                    dash={[6, 4]} opacity={0.6} lineCap="round" />
                  {previewLabel(previewX2, previewY2) && (
                    <Text
                      x={(drawing.x1 + previewX2) / 2 - 30}
                      y={(drawing.y1 + previewY2) / 2 - 16}
                      width={60} text={previewLabel(previewX2, previewY2)}
                      fontSize={10} fill={LINE_COLORS[drawType]} align="center" fontStyle="bold"
                    />
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
                <Line points={[scalePt1!.x, scalePt1!.y, scalePt2.x, scalePt2.y]}
                  stroke="#ff9800" strokeWidth={2} dash={[4, 3]} />
              </>}

              {/* Точки снапа */}
              {mode === 'draw' && allPoints.map((pt, i) => (
                <Circle key={i} x={pt.x} y={pt.y} radius={3} fill="transparent" stroke="#bbb" strokeWidth={1} />
              ))}
            </Layer>
          </Stage>
        </div>

        {/* ── Панель выбранной линии ── */}
        {selectedLine && mode === 'select' && (
          <div style={{
            marginTop: 8, padding: '10px 14px', background: '#fff',
            border: `2px solid ${LINE_COLORS[selectedLine.type]}`, borderRadius: 8,
            display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: LINE_COLORS[selectedLine.type] }}>
              {LINE_LABELS[selectedLine.type]}
            </span>
            <span style={{ fontSize: 13 }}>
              {selectedLine.lengthMm >= 1000
                ? `${(selectedLine.lengthMm / 1000).toFixed(3)}м`
                : `${selectedLine.lengthMm}мм`}
            </span>
            <select value={selectedLine.type}
              onChange={e => updatePlanLine(selectedLine.id, { type: e.target.value as PlanLineType })}
              style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #ccc' }}>
              {(Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
                <option key={t} value={t}>{label}</option>
              ))}
            </select>
            {HAS_SIDE_VIEW.includes(selectedLine.type) && (
              <button
                onClick={() => setPlanView('side')}
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

        {/* ── Список контуров ── */}
        {contours.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Замкнутые контуры:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {contours.map(c => (
                <div key={c.id} style={{
                  padding: '4px 12px', fontSize: 11, borderRadius: 5,
                  border: `1.5px solid ${LINE_COLORS[c.type]}`,
                  background: '#fff', color: LINE_COLORS[c.type],
                  display: 'flex', gap: 8, alignItems: 'center',
                }}>
                  <span style={{ fontWeight: 600 }}>{c.label}</span>
                  <span>{fmtArea(c.areaM2)}</span>
                  <span onClick={() => removeContour(c.id)}
                    style={{ cursor: 'pointer', color: '#aaa', fontSize: 13 }}>✕</span>
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

      {/* ── Диалог масштаба ── */}
      {showScaleDialog && scalePt1 && scalePt2 && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: 300, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📐 Масштаб</div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>
              Расстояние: <b>{Math.round(dist(scalePt1.x, scalePt1.y, scalePt2.x, scalePt2.y))} px</b>
              <br />Введите реальную длину в мм:
            </div>
            <input autoFocus type="number" value={scaleMmInput}
              onChange={e => setScaleMmInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyScale()}
              placeholder="например 3000"
              style={{ width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={applyScale}
                style={{ flex: 1, padding: 8, background: '#3a7bd5', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                Применить
              </button>
              <button onClick={() => { setShowScaleDialog(false); setScaleStep(0); setScalePt1(null); setScalePt2(null) }}
                style={{ flex: 1, padding: 8, background: '#f5f5f5', color: '#333', border: '1px solid #ccc', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
