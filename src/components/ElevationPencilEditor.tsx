import { useMemo, useState } from 'react'
import { Stage, Layer, Line, Circle, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { ProfilePoint, EdgeProfile } from '../types'
import { decomposeElevationPerimeter } from '../core/profileGeometry'
import { useContainerWidth } from '../hooks/useContainerWidth'
import { CANVAS_W as CANVAS_W_MAX } from '../constants'

interface ElevationPencilEditorProps {
  onFinish: (result: { length: number; ceilingProfile: EdgeProfile; floorProfile: EdgeProfile }) => void
  onCancel: () => void
}

const CANVAS_H = 320
const PAD = 30
const PAD_TOP = 20
const PAD_BOTTOM = 20
const CLOSE_PX = 14
const DEFAULT_SPAN = 3000 // мм — «чистый лист» до первой точки

/**
 * Рисование ВСЕГО периметра сечения стены (вид сбоку) с нуля — без
 * предварительно заданных длины/высоты. Клик = точка контура (в любом
 * порядке обхода — низ/торец/верх/торец), точная длина текущего отрезка
 * вбивается числом (направление берётся от курсора) — тот же принцип, что
 * уже работает у карандаша Плиты в FloorPlan.tsx, перенесённый в разрез.
 * Замыкание — клик рядом с первой точкой ИЛИ кнопка «Готово».
 *
 * По завершении контур раскладывается на ceilingProfile/floorProfile/length
 * через decomposeElevationPerimeter (core/profileGeometry.ts) — торцы стены
 * не обязаны быть вертикальными (мансардная геометрия поддерживается).
 */
export default function ElevationPencilEditor({ onFinish, onCancel }: ElevationPencilEditorProps) {
  const [wrapRef, CANVAS_W] = useContainerWidth(CANVAS_W_MAX, 20)
  const [pts, setPts] = useState<ProfilePoint[]>([])
  const [cursorMm, setCursorMm] = useState<ProfilePoint | null>(null)
  const [typedLen, setTypedLen] = useState('')
  const [error, setError] = useState<string | null>(null)

  const plotW = Math.max(CANVAS_W - PAD * 2, 10)
  const plotH = CANVAS_H - PAD_TOP - PAD_BOTTOM

  // Масштаб считаем ТОЛЬКО от уже поставленных точек (не от курсора) —
  // иначе холст «дёргался» бы при каждом движении мыши. Пока точек нет —
  // условный чистый лист DEFAULT_SPAN×DEFAULT_SPAN.
  const { minX, minY, scale, offX, offY, usedH } = useMemo(() => {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const minX = xs.length ? Math.min(...xs) : 0
    const maxX = xs.length ? Math.max(...xs) : DEFAULT_SPAN
    const minY = ys.length ? Math.min(...ys) : 0
    const maxY = ys.length ? Math.max(...ys) : DEFAULT_SPAN * 0.75
    const pad = Math.max((maxX - minX) * 0.15, (maxY - minY) * 0.15, 300)
    const xSpan = Math.max(maxX - minX + pad * 2, 500)
    const ySpan = Math.max(maxY - minY + pad * 2, 500)
    const scale = Math.max(xSpan / plotW, ySpan / plotH) // мм на px
    const usedW = xSpan / scale, usedH = ySpan / scale
    return {
      minX: minX - pad, minY: minY - pad, scale,
      offX: (plotW - usedW) / 2, offY: (plotH - usedH) / 2, usedW, usedH,
    }
  }, [pts, plotW, plotH])

  const xToPx = (x: number) => PAD + offX + (x - minX) / scale
  const yToPx = (y: number) => PAD_TOP + offY + usedH - (y - minY) / scale
  const pxToX = (px: number) => minX + (px - PAD - offX) * scale
  const pxToY = (py: number) => minY + (usedH - (py - PAD_TOP - offY)) * scale

  const last = pts[pts.length - 1] ?? null

  function handleMove(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    setCursorMm({ x: Math.round(pxToX(pos.x)), y: Math.round(pxToY(pos.y)) })
  }

  function tryClose(): boolean {
    if (pts.length < 3) return false
    const res = decomposeElevationPerimeter(pts)
    if (!res) { setError('Контур вырожден — нулевая ширина или все точки на одной вертикали.'); return false }
    setError(null)
    onFinish(res)
    setPts([]); setCursorMm(null); setTypedLen('')
    return true
  }

  function handleStageClick(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (e.target !== e.target.getStage()) return // клик по точке — обработан её обработчиком
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    if (pts.length >= 3) {
      const dx = pos.x - xToPx(pts[0].x), dy = pos.y - yToPx(pts[0].y)
      if (Math.sqrt(dx * dx + dy * dy) < CLOSE_PX) { tryClose(); return }
    }
    const x = Math.round(pxToX(pos.x)), y = Math.round(pxToY(pos.y))
    setPts([...pts, { x, y }])
    setError(null)
  }

  function commitTyped() {
    const mm = Number(typedLen)
    if (!mm || mm <= 0) return
    if (!last) {
      // первая точка — числа тут задавать нечем (нет направления), кладём
      // на условный ноль чистого листа
      setPts([{ x: 0, y: 0 }])
      setTypedLen('')
      return
    }
    const dir = cursorMm ?? { x: last.x + 1, y: last.y }
    const angle = Math.atan2(dir.y - last.y, dir.x - last.x)
    const next = { x: Math.round(last.x + Math.cos(angle) * mm), y: Math.round(last.y + Math.sin(angle) * mm) }
    setPts([...pts, next])
    setTypedLen('')
  }

  function removeLast() {
    setPts(pts.slice(0, -1))
    setError(null)
  }

  const previewLen = last && cursorMm
    ? Math.round(Math.hypot(cursorMm.x - last.x, cursorMm.y - last.y))
    : null

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 10px', marginTop: 6, background: '#fafafe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>
          Рисование периметра сечения (клик — точка контура, клик у первой точки — замкнуть)
        </span>
        <button type="button" onClick={() => { setPts([]); setCursorMm(null); setError(null); onCancel() }}
          style={{ fontSize: 11, color: '#999', background: 'none', border: 'none', cursor: 'pointer' }}>
          ✕ отмена
        </button>
      </div>

      <div ref={wrapRef}>
        <Stage width={CANVAS_W} height={CANVAS_H}
          onMouseMove={handleMove} onTouchMove={handleMove}
          onClick={handleStageClick} onTap={handleStageClick}
          style={{ background: '#fff', border: '1px solid #eee', borderRadius: 4, cursor: 'crosshair' }}>
          <Layer>
            {pts.length >= 2 && (
              <Line points={pts.flatMap(p => [xToPx(p.x), yToPx(p.y)])} stroke="#4a7dff" strokeWidth={2.5} listening={false} />
            )}
            {last && cursorMm && (
              <Line points={[xToPx(last.x), yToPx(last.y), xToPx(cursorMm.x), yToPx(cursorMm.y)]}
                stroke="#4a7dff" strokeWidth={1.5} dash={[5, 4]} listening={false} />
            )}
            {pts.map((p, i) => (
              <Circle key={i} x={xToPx(p.x)} y={yToPx(p.y)} radius={i === 0 ? 7 : 5.5}
                fill={i === 0 ? '#1a9c4a' : '#4a7dff'} stroke="#fff" strokeWidth={1.5} listening={false} />
            ))}
            {last && cursorMm && previewLen !== null && (
              <Text x={xToPx(cursorMm.x) + 10} y={yToPx(cursorMm.y) - 18}
                text={`${previewLen} мм`} fontSize={12} fill="#333" />
            )}
          </Layer>
        </Stage>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#888' }}>Длина отрезка от последней точки, мм:</span>
        <input type="number" value={typedLen} onChange={e => setTypedLen(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitTyped() }}
          placeholder={last ? 'напр. 1500' : 'сначала клик — 1-я точка'} disabled={!last}
          style={{ width: 110, padding: '4px 6px', fontSize: 12 }} />
        <button type="button" onClick={commitTyped} disabled={!last}
          style={{ padding: '4px 10px', fontSize: 12, cursor: last ? 'pointer' : 'default' }}>+ точка</button>
        <button type="button" onClick={removeLast} disabled={pts.length === 0}
          style={{ padding: '4px 10px', fontSize: 12, cursor: pts.length ? 'pointer' : 'default' }}>↩ убрать последнюю</button>
        <button type="button" onClick={tryClose} disabled={pts.length < 3}
          style={{ padding: '4px 10px', fontSize: 12, marginLeft: 'auto', fontWeight: 600,
            background: pts.length >= 3 ? '#1a9c4a' : '#eee', color: pts.length >= 3 ? '#fff' : '#aaa',
            border: 'none', borderRadius: 4, cursor: pts.length >= 3 ? 'pointer' : 'default' }}>
          ✓ Готово, посчитать контур
        </button>
      </div>
      {error && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#c0392b' }}>{error}</p>}
      <p style={{ margin: '6px 0 0', fontSize: 10, color: '#aaa' }}>
        Точки можно ставить в любом порядке обхода (низ → торец → верх → торец
        или наоборот) — главное, чтобы получился один замкнутый контур. Торец
        необязательно вертикальный.
      </p>
    </div>
  )
}
