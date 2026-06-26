/**
 * FloorPlan — план объекта (вид сверху).
 *
 * Режимы:
 *   draw   — рисование линий кликом (старт → финиш)
 *   select — выбор/удаление линии кликом на неё
 *   scale  — установка масштаба (два клика → вводишь реальную длину в мм)
 *
 * Цвета линий:
 *   wall_new      — красный   (#e53935)  новая перегородка
 *   wall_lining   — синий     (#1e88e5)  облицовка
 *   wall_existing — серый     (#78909c)  существующая стена
 *   ceiling       — фиолетовый(#8e24aa)  потолок
 *   floor         — коричневый(#6d4c41)  пол
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Stage, Layer, Line, Circle, Text, Rect, Group } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useProjectStore } from './store/useProjectStore'
import type { PlanLine, PlanLineType } from './types'

// ─── Константы ────────────────────────────────────────────────────────────────

const CANVAS_H  = 520
const SNAP_PX   = 18   // радиус притяжения — чуть больше для пальца

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
  wall_existing: 'Существующая стена',
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

type Mode = 'draw' | 'select' | 'scale'

// ─── Вспомогательные ─────────────────────────────────────────────────────────

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

function lineLengthMm(x1: number, y1: number, x2: number, y2: number, scaleMmPerPx: number) {
  return Math.round(dist(x1, y1, x2, y2) * scaleMmPerPx)
}

/** Снапаем к ближайшей точке существующих линий */
function snapPoint(
  x: number, y: number,
  lines: PlanLine[],
  excludeId?: string,
): { x: number; y: number; snapped: boolean } {
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

/** Расстояние от точки до отрезка — используется для клика по линии */
// @ts-ignore
function _pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return dist(px, py, x1, y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  return dist(px, py, x1 + t * dx, y1 + t * dy)
}

// ─── Компонент ───────────────────────────────────────────────────────────────

export default function FloorPlan() {
  const { floorPlan, addPlanLine, updatePlanLine, removePlanLine, setFloorPlanScale, clearFloorPlan } = useProjectStore()
  const lines      = floorPlan?.lines ?? []
  const scaleMmPx  = floorPlan?.scaleMmPerPx ?? 10

  // Адаптивная ширина холста под экран
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(820)
  useEffect(() => {
    function update() {
      if (containerRef.current) {
        setCanvasW(containerRef.current.offsetWidth)
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const [mode, setMode]           = useState<Mode>('draw')
  const [drawType, setDrawType]   = useState<PlanLineType>('wall_new')
  const [drawing, setDrawing]     = useState<{ x1: number; y1: number } | null>(null)
  const [cursor, setCursor]       = useState<{ x: number; y: number } | null>(null)
  const [selectedId, setSelected] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState<string | null>(null)  // id линии в режиме редактирования

  // Масштабирование: два клика → диалог
  const [scaleStep, setScaleStep]     = useState<0 | 1 | 2>(0)  // 0=ждём, 1=первый клик, 2=второй
  const [scalePt1, setScalePt1]       = useState<{ x: number; y: number } | null>(null)
  const [scalePt2, setScalePt2]       = useState<{ x: number; y: number } | null>(null)
  const [scaleMmInput, setScaleMmInput] = useState('')
  const [showScaleDialog, setShowScaleDialog] = useState(false)

  const stageRef = useRef<any>(null)

  // ── Все точки существующих линий (для снапа) ─────────────────────────────
  const allPoints = lines.flatMap(l => [
    { x: l.x1, y: l.y1 },
    { x: l.x2, y: l.y2 },
  ])

  // ── Метка длины для превью ────────────────────────────────────────────────
  function previewLabel(x2: number, y2: number) {
    if (!drawing) return ''
    const mm = lineLengthMm(drawing.x1, drawing.y1, x2, y2, scaleMmPx)
    if (mm < 10) return ''
    return mm >= 1000 ? `${(mm / 1000).toFixed(2)}м` : `${mm}мм`
  }

  // ── Универсальный обработчик позиции (mouse + touch) ─────────────────────
  function getPos(e: KonvaEventObject<MouseEvent | TouchEvent>): { x: number; y: number } | null {
    const stage = e.target.getStage()
    if (!stage) return null
    // Для touch берём первый палец
    const te = e.evt as TouchEvent
    if (te.touches && te.touches.length > 0) {
      const rect = stage.container().getBoundingClientRect()
      return {
        x: te.touches[0].clientX - rect.left,
        y: te.touches[0].clientY - rect.top,
      }
    }
    return stage.getPointerPosition()
  }

  // ── Клик/тап по холсту ───────────────────────────────────────────────────
  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const pos = getPos(e)
    if (!pos) return

    // ── Режим масштаба ──
    if (mode === 'scale') {
      const snapped = snapPoint(pos.x, pos.y, lines)
      if (scaleStep === 0) {
        setScalePt1({ x: snapped.x, y: snapped.y }); setScaleStep(1)
      } else if (scaleStep === 1) {
        setScalePt2({ x: snapped.x, y: snapped.y }); setScaleStep(2); setShowScaleDialog(true)
      }
      return
    }

    // ── Режим рисования ──
    if (mode === 'draw') {
      const snapped = snapPoint(pos.x, pos.y, lines)
      const pt = { x: snapped.x, y: snapped.y }

      if (!drawing) {
        setDrawing({ x1: pt.x, y1: pt.y })
      } else {
        const d = dist(drawing.x1, drawing.y1, pt.x, pt.y)
        if (d < 5) { setDrawing(null); return }  // слишком короткая — отмена
        const lengthMm = lineLengthMm(drawing.x1, drawing.y1, pt.x, pt.y, scaleMmPx)
        const count = lines.filter(l => l.type === drawType).length + 1
        addPlanLine({
          x1: drawing.x1, y1: drawing.y1,
          x2: pt.x, y2: pt.y,
          type: drawType,
          lengthMm,
          label: `${LINE_LABELS[drawType]} ${count}`,
        })
        // Продолжаем от конечной точки (цепочка линий)
        setDrawing({ x1: pt.x, y1: pt.y })
      }
      return
    }

    // ── Режим выбора: клик по пустому месту → снимаем выбор ──
    if (mode === 'select') {
      setSelected(null)
      setEditLabel(null)
    }
  }, [mode, drawing, lines, scaleMmPx, drawType, scaleStep, addPlanLine])

  // ── Движение мыши (превью) ────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    const snapped = snapPoint(pos.x, pos.y, lines)
    setCursor({ x: snapped.x, y: snapped.y })
  }, [lines])

  // ── Движение пальца (превью на touch) ────────────────────────────────────
  const handleTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    const te = e.evt as TouchEvent
    if (!te.touches.length) return
    const rect = stage.container().getBoundingClientRect()
    const pos = {
      x: te.touches[0].clientX - rect.left,
      y: te.touches[0].clientY - rect.top,
    }
    const snapped = snapPoint(pos.x, pos.y, lines)
    setCursor({ x: snapped.x, y: snapped.y })
  }, [lines])

  // ── Клик/тап по линии (выбор) ────────────────────────────────────────────
  const handleLineClick = useCallback((id: string, e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true
    if (mode === 'select') {
      setSelected(id)
      setEditLabel(null)
    }
  }, [mode])

  // ── Escape — отмена рисования ─────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setDrawing(null)
      setSelected(null)
      setEditLabel(null)
      setScaleStep(0)
      setScalePt1(null)
      setScalePt2(null)
    }
    if (e.key === 'Delete' && selectedId) {
      removePlanLine(selectedId)
      setSelected(null)
    }
  }, [selectedId, removePlanLine])

  // ── Подтверждение масштаба ────────────────────────────────────────────────
  function applyScale() {
    if (!scalePt1 || !scalePt2) return
    const mm = parseFloat(scaleMmInput)
    if (!mm || mm <= 0) return
    const px = dist(scalePt1.x, scalePt1.y, scalePt2.x, scalePt2.y)
    if (px < 1) return
    setFloorPlanScale(mm / px)
    setShowScaleDialog(false)
    setScaleStep(0)
    setScalePt1(null)
    setScalePt2(null)
    setScaleMmInput('')
    setMode('draw')
  }

  // ── Выбранная линия ───────────────────────────────────────────────────────
  const selectedLine = lines.find(l => l.id === selectedId)

  // ── Превью текущей рисуемой линии ────────────────────────────────────────
  const previewX2 = cursor?.x ?? (drawing?.x1 ?? 0)
  const previewY2 = cursor?.y ?? (drawing?.y1 ?? 0)

  return (
    <div
      style={{ outline: 'none' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* ── Панель инструментов ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' }}>

        {/* Режимы */}
        {([['draw', '✏️ Рисовать'], ['select', '↖ Выбрать'], ['scale', '📐 Масштаб']] as [Mode, string][]).map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setDrawing(null); setSelected(null) }}
            style={{
              padding: '5px 12px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
              border: '1px solid #ccc',
              background: mode === m ? '#3a7bd5' : '#f5f5f5',
              color: mode === m ? '#fff' : '#333',
              fontWeight: mode === m ? 600 : 400,
            }}>
            {label}
          </button>
        ))}

        <div style={{ width: 1, height: 24, background: '#ddd', margin: '0 4px' }} />

        {/* Тип линии (только в режиме рисования) */}
        {mode === 'draw' && (Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setDrawType(t)}
            style={{
              padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
              border: `2px solid ${LINE_COLORS[t]}`,
              background: drawType === t ? LINE_COLORS[t] : '#fff',
              color: drawType === t ? '#fff' : LINE_COLORS[t],
              fontWeight: drawType === t ? 600 : 400,
            }}>
            {label}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#888' }}>
            Масштаб: 1px = {scaleMmPx >= 10 ? `${scaleMmPx}мм` : `${scaleMmPx.toFixed(1)}мм`}
          </span>
          {lines.length > 0 && (
            <button onClick={() => { if (confirm('Очистить весь план?')) clearFloorPlan() }}
              style={{ padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid #e57373', background: '#fff', color: '#e53935' }}>
              🗑 Очистить
            </button>
          )}
        </div>
      </div>

      {/* ── Подсказки ── */}
      <div style={{ fontSize: 11, color: '#888', marginBottom: 6, minHeight: 16 }}>
        {mode === 'draw' && !drawing && '👆 Кликните чтобы начать линию. Esc — отмена.'}
        {mode === 'draw' && drawing && '👆 Кликните чтобы завершить. Esc — отмена. Линии соединяются автоматически.'}
        {mode === 'select' && '👆 Кликните на линию чтобы выбрать. Delete — удалить. Esc — снять выбор.'}
        {mode === 'scale' && scaleStep === 0 && '📐 Кликните первую точку отрезка известной длины.'}
        {mode === 'scale' && scaleStep === 1 && '📐 Кликните вторую точку — потом введите реальную длину в мм.'}
      </div>

      {/* ── Холст ── */}
      <div ref={containerRef} style={{ border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', background: '#fafafa', cursor: mode === 'draw' ? 'crosshair' : 'default', touchAction: 'none' }}>
        <Stage
          ref={stageRef}
          width={canvasW}
          height={CANVAS_H}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onMouseMove={handleMouseMove}
          onTouchMove={handleTouchMove}
        >
          <Layer>
            {/* Фон */}
            <Rect x={0} y={0} width={canvasW} height={CANVAS_H} fill="#fafafa" />

            {/* Сетка */}
            {Array.from({ length: Math.floor(canvasW / 50) + 1 }, (_, i) => (
              <Line key={`gv${i}`} points={[i * 50, 0, i * 50, CANVAS_H]}
                stroke="#e8e8e8" strokeWidth={1} />
            ))}
            {Array.from({ length: Math.floor(CANVAS_H / 50) + 1 }, (_, i) => (
              <Line key={`gh${i}`} points={[0, i * 50, canvasW, i * 50]}
                stroke="#e8e8e8" strokeWidth={1} />
            ))}

            {/* Нарисованные линии */}
            {lines.map(l => {
              const isSelected = l.id === selectedId
              const color = LINE_COLORS[l.type]
              const lw = LINE_WIDTH[l.type]
              const mx = (l.x1 + l.x2) / 2
              const my = (l.y1 + l.y2) / 2
              const mm = l.lengthMm
              const lenLabel = mm >= 1000 ? `${(mm / 1000).toFixed(2)}м` : `${mm}мм`

              return (
                <Group key={l.id}
                  onClick={(e) => handleLineClick(l.id, e)}
                  onTap={(e) => handleLineClick(l.id, e)}
                >
                  {/* Широкая невидимая зона для клика/тапа */}
                  <Line
                    points={[l.x1, l.y1, l.x2, l.y2]}
                    stroke="transparent"
                    strokeWidth={24}
                    hitStrokeWidth={24}
                  />
                  {/* Видимая линия */}
                  <Line
                    points={[l.x1, l.y1, l.x2, l.y2]}
                    stroke={isSelected ? '#ff9800' : color}
                    strokeWidth={isSelected ? lw + 2 : lw}
                    lineCap="round"
                  />
                  {/* Точки концов — увеличены для удобства тапа */}
                  <Circle x={l.x1} y={l.y1} radius={6} fill={color} />
                  <Circle x={l.x2} y={l.y2} radius={6} fill={color} />
                  {/* Подпись длины */}
                  <Text
                    x={mx - 30} y={my - 16}
                    width={60} text={lenLabel}
                    fontSize={10} fill={color} align="center"
                    fontStyle="bold"
                  />
                </Group>
              )
            })}

            {/* Превью рисуемой линии */}
            {mode === 'draw' && drawing && cursor && (
              <>
                <Line
                  points={[drawing.x1, drawing.y1, previewX2, previewY2]}
                  stroke={LINE_COLORS[drawType]}
                  strokeWidth={LINE_WIDTH[drawType]}
                  dash={[6, 4]}
                  opacity={0.6}
                  lineCap="round"
                />
                {previewLabel(previewX2, previewY2) && (
                  <Text
                    x={(drawing.x1 + previewX2) / 2 - 30}
                    y={(drawing.y1 + previewY2) / 2 - 16}
                    width={60}
                    text={previewLabel(previewX2, previewY2)}
                    fontSize={10}
                    fill={LINE_COLORS[drawType]}
                    align="center"
                    fontStyle="bold"
                  />
                )}
              </>
            )}

            {/* Курсор с кружком снапа */}
            {cursor && mode === 'draw' && (
              <Circle
                x={cursor.x} y={cursor.y}
                radius={5}
                stroke={LINE_COLORS[drawType]}
                strokeWidth={1.5}
                fill="rgba(255,255,255,0.6)"
              />
            )}

            {/* Точки масштабирования */}
            {scalePt1 && (
              <Circle x={scalePt1.x} y={scalePt1.y} radius={6} fill="#ff9800" />
            )}
            {scalePt2 && (
              <>
                <Circle x={scalePt2.x} y={scalePt2.y} radius={6} fill="#ff9800" />
                <Line
                  points={[scalePt1!.x, scalePt1!.y, scalePt2.x, scalePt2.y]}
                  stroke="#ff9800" strokeWidth={2} dash={[4, 3]}
                />
              </>
            )}

            {/* Точки притяжения (snap) */}
            {mode === 'draw' && allPoints.map((pt, i) => (
              <Circle key={i} x={pt.x} y={pt.y} radius={3}
                fill="transparent" stroke="#aaa" strokeWidth={1} />
            ))}
          </Layer>
        </Stage>
      </div>

      {/* ── Панель выбранной линии ── */}
      {selectedLine && mode === 'select' && (
        <div style={{
          marginTop: 10, padding: '10px 14px', background: '#fff',
          border: `2px solid ${LINE_COLORS[selectedLine.type]}`,
          borderRadius: 8, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: LINE_COLORS[selectedLine.type] }}>
            {LINE_LABELS[selectedLine.type]}
          </span>
          <span style={{ fontSize: 13, color: '#333' }}>
            {selectedLine.lengthMm >= 1000
              ? `${(selectedLine.lengthMm / 1000).toFixed(3)}м`
              : `${selectedLine.lengthMm}мм`}
          </span>

          {/* Редактирование метки */}
          {editLabel === selectedLine.id ? (
            <input
              autoFocus
              value={selectedLine.label}
              onChange={e => updatePlanLine(selectedLine.id, { label: e.target.value })}
              onBlur={() => setEditLabel(null)}
              onKeyDown={e => e.key === 'Enter' && setEditLabel(null)}
              style={{ fontSize: 12, padding: '2px 6px', border: '1px solid #ccc', borderRadius: 4, width: 160 }}
            />
          ) : (
            <span
              style={{ fontSize: 12, color: '#555', cursor: 'pointer', textDecoration: 'underline dotted' }}
              onClick={() => setEditLabel(selectedLine.id)}
            >
              {selectedLine.label}
            </span>
          )}

          {/* Смена типа */}
          <select
            value={selectedLine.type}
            onChange={e => updatePlanLine(selectedLine.id, { type: e.target.value as PlanLineType })}
            style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #ccc' }}
          >
            {(Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
              <option key={t} value={t}>{label}</option>
            ))}
          </select>

          <button
            onClick={() => { removePlanLine(selectedLine.id); setSelected(null) }}
            style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 12, borderRadius: 4, border: '1px solid #e57373', background: '#fff', color: '#e53935', cursor: 'pointer' }}
          >
            🗑 Удалить
          </button>
        </div>
      )}

      {/* ── Список линий ── */}
      {lines.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
            Конструкции на плане: {lines.length} шт
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {lines.map(l => (
              <div
                key={l.id}
                onClick={() => { setMode('select'); setSelected(l.id) }}
                style={{
                  padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                  border: `1.5px solid ${LINE_COLORS[l.type]}`,
                  background: selectedId === l.id ? LINE_COLORS[l.type] : '#fff',
                  color: selectedId === l.id ? '#fff' : LINE_COLORS[l.type],
                }}
              >
                {l.label} · {l.lengthMm >= 1000 ? `${(l.lengthMm / 1000).toFixed(2)}м` : `${l.lengthMm}мм`}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Диалог масштаба ── */}
      {showScaleDialog && scalePt1 && scalePt2 && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: 300, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📐 Установка масштаба</div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
              Расстояние между точками: <b>{Math.round(dist(scalePt1.x, scalePt1.y, scalePt2.x, scalePt2.y))} px</b>
              <br />Введите реальную длину этого отрезка в мм:
            </div>
            <input
              autoFocus
              type="number"
              value={scaleMmInput}
              onChange={e => setScaleMmInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyScale()}
              placeholder="например 3000"
              style={{ width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={applyScale}
                style={{ flex: 1, padding: '8px', background: '#3a7bd5', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                Применить
              </button>
              <button onClick={() => { setShowScaleDialog(false); setScaleStep(0); setScalePt1(null); setScalePt2(null) }}
                style={{ flex: 1, padding: '8px', background: '#f5f5f5', color: '#333', border: '1px solid #ccc', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Легенда ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, fontSize: 11, color: '#666' }}>
        {(Object.entries(LINE_LABELS) as [PlanLineType, string][]).map(([t, label]) => (
          <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 20, height: 3, background: LINE_COLORS[t], borderRadius: 2 }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
