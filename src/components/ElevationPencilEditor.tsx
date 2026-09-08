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

interface ViewFrame { x0: number; y0: number; span: number } // мм: левый-нижний угол + ширина видимой области

const CANVAS_H = 320
const PAD = 30
const PAD_TOP = 20
const PAD_BOTTOM = 20
const CLOSE_PX = 14
const DEFAULT_SPAN = 4000 // мм — ширина «чистого листа» до первой точки
const FRAME_MARGIN_RATIO = 0.1 // насколько близко к краю точка ещё считается "в кадре"
const NICE_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000] // мм, для клетки
const MIN_CELL_PX = 28

/**
 * Рисование ВСЕГО периметра сечения стены (вид сбоку) с нуля — без
 * предварительно заданных длины/высоты. Клик = точка контура (в любом
 * порядке обхода — низ/торец/верх/торец), точная длина текущего отрезка
 * вбивается числом (направление берётся от курсора) — тот же принцип, что
 * уже работает у карандаша Плиты в FloorPlan.tsx, перенесённый в разрез.
 * Замыкание — клик рядом с первой точкой ИЛИ кнопка «Готово». ПКМ по
 * холсту — отмена последней точки. Чекбокс «прямой угол» (orthoSnap,
 * вкл. по умолчанию) магнитит направление к ближайшей из 4 сторон света
 * (0/90/180/270°) — удобно для ровных участков и вертикальных ступеней/
 * ригелей; выключается для единственного наклонного отрезка.
 *
 * Система координат (ViewFrame) НЕ пересчитывается на каждый клик — иначе
 * только что поставленная точка визуально «прыгает» в центр (первая версия
 * так и делала: bbox тесно облегал единственную точку, из-за чего вид
 * перемасштабировался сразу после клика). Вместо этого кадр растёт только
 * когда новая точка реально выходит за его пределы (с запасом), и всегда
 * сохраняет пропорции канваса — letterbox'а по бокам нет вообще.
 *
 * По завершении контур раскладывается на ceilingProfile/floorProfile/length
 * через decomposeElevationPerimeter (core/profileGeometry.ts) — торцы стены
 * не обязаны быть вертикальными (мансардная геометрия поддерживается).
 */
export default function ElevationPencilEditor({ onFinish, onCancel }: ElevationPencilEditorProps) {
  const [wrapRef, CANVAS_W] = useContainerWidth(CANVAS_W_MAX, 20)
  const [pts, setPts] = useState<ProfilePoint[]>([])
  const [frame, setFrame] = useState<ViewFrame | null>(null)
  const [cursorMm, setCursorMm] = useState<ProfilePoint | null>(null)
  const [typedLen, setTypedLen] = useState('')
  const [orthoSnap, setOrthoSnap] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const plotW = Math.max(CANVAS_W - PAD * 2, 10)
  const plotH = CANVAS_H - PAD_TOP - PAD_BOTTOM

  const defaultFrame: ViewFrame = useMemo(
    () => ({ x0: -DEFAULT_SPAN * 0.1, y0: -(DEFAULT_SPAN * (plotH / plotW)) * 0.25, span: DEFAULT_SPAN }),
    [plotW, plotH]
  )
  const activeFrame = frame ?? defaultFrame
  const height = activeFrame.span * (plotH / plotW) // мм, высота видимой области — та же пропорция, что у канваса
  const scale = activeFrame.span / plotW // мм на px, единый для X и Y — углы не искажаются

  const xToPx = (x: number) => PAD + (x - activeFrame.x0) / scale
  const yToPx = (y: number) => PAD_TOP + plotH - (y - activeFrame.y0) / scale
  const pxToX = (px: number) => activeFrame.x0 + (px - PAD) * scale
  const pxToY = (py: number) => activeFrame.y0 + (plotH - (py - PAD_TOP)) * scale

  // Растим кадр, только если точка реально выходит за его пределы (с запасом
  // FRAME_MARGIN_RATIO) — иначе кадр не меняется вообще, никакого "прыжка".
  function ensureFrame(f: ViewFrame, p: ProfilePoint): ViewFrame {
    const h = f.span * (plotH / plotW)
    const mx = f.span * FRAME_MARGIN_RATIO, my = h * FRAME_MARGIN_RATIO
    const inside = p.x >= f.x0 + mx && p.x <= f.x0 + f.span - mx && p.y >= f.y0 + my && p.y <= f.y0 + h - my
    if (inside) return f
    const minX = Math.min(f.x0, p.x), maxX = Math.max(f.x0 + f.span, p.x)
    const minY = Math.min(f.y0, p.y), maxY = Math.max(f.y0 + h, p.y)
    const pad = Math.max((maxX - minX) * 0.15, (maxY - minY) * 0.15, 300)
    const xSpanNeeded = maxX - minX + pad * 2
    const ySpanNeeded = maxY - minY + pad * 2
    const span = Math.max(xSpanNeeded, ySpanNeeded * (plotW / plotH))
    const hNew = span * (plotH / plotW)
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    return { x0: cx - span / 2, y0: cy - hNew / 2, span }
  }

  function addPoint(p: ProfilePoint) {
    setFrame(ensureFrame(activeFrame, p))
    setPts(prev => [...prev, p])
    setError(null)
  }

  // Лист в клетку — шаг подбирается так, чтобы клетка была 28-56px на экране
  // (не мельчила и не была слишком крупной при разном масштабе/зуме).
  const gridStep = useMemo(
    () => NICE_STEPS.find(s => s / scale >= MIN_CELL_PX) ?? NICE_STEPS[NICE_STEPS.length - 1],
    [scale]
  )

  const gridLines = useMemo(() => {
    const leftMm = activeFrame.x0, rightMm = activeFrame.x0 + activeFrame.span
    const bottomMm = activeFrame.y0, topMm = activeFrame.y0 + height
    const vs: number[] = []
    for (let x = Math.ceil(leftMm / gridStep) * gridStep; x <= rightMm; x += gridStep) vs.push(x)
    const hs: number[] = []
    for (let y = Math.ceil(bottomMm / gridStep) * gridStep; y <= topMm; y += gridStep) hs.push(y)
    return { vs, hs }
  }, [gridStep, activeFrame, height])

  const last = pts[pts.length - 1] ?? null

  function snapToOrtho(from: ProfilePoint, to: ProfilePoint): ProfilePoint {
    const dx = to.x - from.x, dy = to.y - from.y
    return Math.abs(dx) >= Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y }
  }

  const previewPoint = last && cursorMm ? (orthoSnap ? snapToOrtho(last, cursorMm) : cursorMm) : null

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
    setPts([]); setFrame(null); setCursorMm(null); setTypedLen('')
    return true
  }

  function handleStageClick(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    // Konva шлёт 'click' по отпусканию ЛЮБОЙ кнопки мыши, не только левой —
    // без этой проверки ПКМ одновременно и убирала точку (наш mousedown-
    // обработчик), и тут же добавляла новую (этот обработчик клика).
    if ('button' in e.evt && e.evt.button !== 0) return
    if (e.target !== e.target.getStage()) return // клик по точке — обработан её обработчиком
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    if (pts.length >= 3) {
      const dx = pos.x - xToPx(pts[0].x), dy = pos.y - yToPx(pts[0].y)
      if (Math.sqrt(dx * dx + dy * dy) < CLOSE_PX) { tryClose(); return }
    }
    const raw = { x: Math.round(pxToX(pos.x)), y: Math.round(pxToY(pos.y)) }
    addPoint(last && orthoSnap ? snapToOrtho(last, raw) : raw)
  }

  function commitTyped() {
    const mm = Number(typedLen)
    if (!mm || mm <= 0) return
    if (!last) {
      // первая точка — числа тут задавать нечем (нет направления), кладём
      // на условный ноль чистого листа
      addPoint({ x: 0, y: 0 })
      setTypedLen('')
      return
    }
    const rawDir = cursorMm ?? { x: last.x + 1, y: last.y }
    const dir = orthoSnap ? snapToOrtho(last, rawDir) : rawDir
    const angle = Math.atan2(dir.y - last.y, dir.x - last.x)
    addPoint({ x: Math.round(last.x + Math.cos(angle) * mm), y: Math.round(last.y + Math.sin(angle) * mm) })
    setTypedLen('')
  }

  function removeLast() {
    setPts(prev => prev.slice(0, -1))
    setError(null)
  }

  const previewLen = last && previewPoint
    ? Math.round(Math.hypot(previewPoint.x - last.x, previewPoint.y - last.y))
    : null

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 10px', marginTop: 6, background: '#fafafe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>
          Рисование периметра сечения (клик — точка контура, клик у первой точки — замкнуть, ПКМ — отменить последнюю)
        </span>
        <button type="button" onClick={() => { setPts([]); setFrame(null); setCursorMm(null); setError(null); onCancel() }}
          style={{ fontSize: 11, color: '#999', background: 'none', border: 'none', cursor: 'pointer' }}>
          ✕ отмена
        </button>
      </div>

      {/* ПКМ ловим на mousedown (button===2) на обычном div — надёжнее, чем
          событие contextmenu через внутреннюю Konva-подписку на <Stage>,
          которое на практике не всегда доходило до обработчика. Отдельный
          onContextMenu только гасит системное меню браузера. */}
      <div ref={wrapRef}
        onContextMenu={e => e.preventDefault()}
        onMouseDown={e => { if (e.button === 2) { e.preventDefault(); removeLast() } }}>
        <Stage width={CANVAS_W} height={CANVAS_H}
          onMouseMove={handleMove} onTouchMove={handleMove}
          onClick={handleStageClick} onTap={handleStageClick}
          style={{ background: '#fff', border: '1px solid #eee', borderRadius: 4, cursor: 'crosshair' }}>
          <Layer>
            {gridLines.vs.map(x => (
              <Line key={`v${x}`} points={[xToPx(x), PAD_TOP, xToPx(x), PAD_TOP + plotH]}
                stroke={x === 0 ? '#cfd8ea' : '#eef1f7'} strokeWidth={x === 0 ? 1.2 : 1} listening={false} />
            ))}
            {gridLines.hs.map(y => (
              <Line key={`h${y}`} points={[PAD, yToPx(y), PAD + plotW, yToPx(y)]}
                stroke={y === 0 ? '#cfd8ea' : '#eef1f7'} strokeWidth={y === 0 ? 1.2 : 1} listening={false} />
            ))}
            {pts.length >= 2 && (
              <Line points={pts.flatMap(p => [xToPx(p.x), yToPx(p.y)])} stroke="#4a7dff" strokeWidth={2.5} listening={false} />
            )}
            {last && previewPoint && (
              <Line points={[xToPx(last.x), yToPx(last.y), xToPx(previewPoint.x), yToPx(previewPoint.y)]}
                stroke="#4a7dff" strokeWidth={1.5} dash={[5, 4]} listening={false} />
            )}
            {pts.map((p, i) => (
              <Circle key={i} x={xToPx(p.x)} y={yToPx(p.y)} radius={i === 0 ? 7 : 5.5}
                fill={i === 0 ? '#1a9c4a' : '#4a7dff'} stroke="#fff" strokeWidth={1.5} listening={false} />
            ))}
            {last && previewPoint && previewLen !== null && (
              <Text x={xToPx(previewPoint.x) + 10} y={yToPx(previewPoint.y) - 18}
                text={`${previewLen} мм`} fontSize={12} fill="#333" />
            )}
          </Layer>
        </Stage>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={orthoSnap} onChange={e => setOrthoSnap(e.target.checked)} />
          ⊥ прямой угол
        </label>
        <span style={{ fontSize: 11, color: '#888' }}>Длина отрезка от последней точки, мм:</span>
        <input type="number" value={typedLen} onChange={e => setTypedLen(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitTyped() }}
          placeholder={last ? 'напр. 1500' : 'сначала клик — 1-я точка'} disabled={!last}
          style={{ width: 110, padding: '4px 6px', fontSize: 12 }} />
        <button type="button" onClick={commitTyped} disabled={!last}
          style={{ padding: '4px 10px', fontSize: 12, cursor: last ? 'pointer' : 'default' }}>+ точка</button>
        <button type="button" onClick={removeLast} disabled={pts.length === 0}
          style={{ padding: '4px 10px', fontSize: 12, cursor: pts.length ? 'pointer' : 'default' }}>↩ убрать последнюю (или ПКМ)</button>
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
        необязательно вертикальный. «Прямой угол» магнитит направление к
        ближайшей горизонтали/вертикали — выключи для наклонного отрезка.
        Клетка — {gridStep} мм.
      </p>
    </div>
  )
}
