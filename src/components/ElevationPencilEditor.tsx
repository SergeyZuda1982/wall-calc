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
const PAD = 34
const PAD_TOP = 20
const PAD_BOTTOM = 20
const CLOSE_PX = 14
const DEFAULT_SPAN = 4000 // мм — ширина «чистого листа» до первой точки
const FRAME_MARGIN_RATIO = 0.1 // насколько близко к краю точка ещё считается "в кадре"
const NICE_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000] // мм, для клетки
const MIN_CELL_PX = 28

/**
 * Рисование ВСЕГО периметра сечения стены (вид сбоку) с нуля — без
 * предварительно заданных длины/высоты.
 *
 * ГЛАВНЫЙ способ добавить точку — ввод АБСОЛЮТНЫХ координат X/Y числом
 * (как график: есть 0, есть оси, деления подписаны) — НЕ "отрезок от
 * последней точки по направлению курсора". Так и задумано специально:
 * пользователь по факту знает высоту в конкретных точках по длине стены
 * (из проекта или замера рулеткой/дальномером), а не относительные
 * смещения — и для наклонной/скошенной стены ему нужно ЗАДАТЬ известную
 * высоту во второй опорной точке, а не пытаться попасть туда мышкой
 * (мышь физически не может уйти за пределы видимого холста, а нужная
 * точка может быть выше текущего окна — с относительным вводом это была
 * тупиковая ситуация). Клик по холсту остаётся как ВТОРОЙ, черновой
 * способ (с ортоснапом) — для быстрой визуальной прикидки, а не для
 * точных чисел.
 *
 * Замыкание — клик рядом с первой точкой ИЛИ кнопка «Готово». ПКМ (через
 * mousedown, см. handleStageClick) — отмена последней точки.
 *
 * Система координат (ViewFrame) не пересчитывается на каждую точку —
 * растёт только когда точка реально выходит за её пределы (с запасом),
 * всегда сохраняет пропорции канваса (letterbox'а нет). Оси подписаны
 * числами по краям — видно масштаб, даже не наводя курсор.
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
  const [typedX, setTypedX] = useState('')
  const [typedY, setTypedY] = useState('')
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
  // Работает одинаково и для точки с холста, и для введённой числом — после
  // ввода абсолютных координат далеко за пределами текущего окна холст сам
  // подстроится и покажет добавленную точку.
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

  // Лист в клетку — шаг подбирается так, чтобы клетка была 28-56px на экране.
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
    setPts([]); setFrame(null); setCursorMm(null); setTypedX(''); setTypedY('')
    return true
  }

  function handleStageClick(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    // Konva шлёт 'click' по отпусканию ЛЮБОЙ кнопки мыши, не только левой —
    // без этой проверки ПКМ одновременно и убирала точку (mousedown-
    // обработчик ниже), и тут же добавляла новую (этот обработчик клика).
    if ('button' in e.evt && e.evt.button !== 0) return
    if (e.target !== e.target.getStage()) return // клик по точке — обработан её обработчиком
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    if (pts.length >= 3) {
      const dx = pos.x - xToPx(pts[0].x), dy = pos.y - yToPx(pts[0].y)
      if (Math.sqrt(dx * dx + dy * dy) < CLOSE_PX) { tryClose(); return }
    }
    // Клик — черновое (визуальное) размещение точки, для точных чисел
    // используется поле X/Y ниже.
    const raw = { x: Math.round(pxToX(pos.x)), y: Math.round(pxToY(pos.y)) }
    addPoint(last ? (orthoSnap ? snapToOrtho(last, raw) : raw) : raw)
  }

  function commitAbsolute() {
    const x = Number(typedX), y = Number(typedY)
    if (typedX.trim() === '' || typedY.trim() === '' || Number.isNaN(x) || Number.isNaN(y)) return
    addPoint({ x: Math.round(x), y: Math.round(y) })
    setTypedX(''); setTypedY('')
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
          Рисование периметра сечения — точки по координатам X/Y (ниже), клик по холсту — черновой набросок
        </span>
        <button type="button" onClick={() => { setPts([]); setFrame(null); setCursorMm(null); setError(null); onCancel() }}
          style={{ fontSize: 11, color: '#999', background: 'none', border: 'none', cursor: 'pointer' }}>
          ✕ отмена
        </button>
      </div>

      {/* ПКМ ловим на mousedown (button===2) на обычном div — надёжнее, чем
          событие contextmenu через внутреннюю Konva-подписку на <Stage>.
          Отдельный onContextMenu только гасит системное меню браузера. */}
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
            {/* Подписи делений — сама суть графика с осями: видно масштаб и
                конкретные числа, даже не наводя курсор и не завися от того,
                видна ли сейчас нужная зона под курсором. */}
            {gridLines.vs.map(x => (
              <Text key={`vt${x}`} x={xToPx(x) - 14} y={PAD_TOP + plotH + 3} width={28} align="center"
                text={String(x)} fontSize={9} fill="#aab" listening={false} />
            ))}
            {gridLines.hs.map(y => (
              <Text key={`ht${y}`} x={2} y={yToPx(y) - 6} width={PAD - 6} align="right"
                text={String(y)} fontSize={9} fill="#aab" listening={false} />
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
              <Text x={Math.min(xToPx(previewPoint.x) + 10, CANVAS_W - 90)} y={Math.max(yToPx(previewPoint.y) - 18, PAD_TOP)}
                text={`${previewLen} мм`} fontSize={12} fill="#333" />
            )}
          </Layer>
        </Stage>
      </div>

      {/* ГЛАВНЫЙ способ добавить точку — абсолютные X/Y, независимо от того,
          что сейчас видно на холсте и куда дотягивается курсор. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#888' }}>Точка по координатам — X (по стене), Y (высота), мм:</span>
        <input type="number" value={typedX} onChange={e => setTypedX(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitAbsolute() }}
          placeholder="X" style={{ width: 90, padding: '4px 6px', fontSize: 12 }} />
        <input type="number" value={typedY} onChange={e => setTypedY(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitAbsolute() }}
          placeholder="Y" style={{ width: 90, padding: '4px 6px', fontSize: 12 }} />
        <button type="button" onClick={commitAbsolute}
          style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>+ точка</button>
        <button type="button" onClick={removeLast} disabled={pts.length === 0}
          style={{ padding: '4px 10px', fontSize: 12, cursor: pts.length ? 'pointer' : 'default' }}>↩ убрать последнюю (или ПКМ)</button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={orthoSnap} onChange={e => setOrthoSnap(e.target.checked)} />
          ⊥ прямой угол (для клика по холсту)
        </label>
        <button type="button" onClick={tryClose} disabled={pts.length < 3}
          style={{ padding: '4px 10px', fontSize: 12, marginLeft: 'auto', fontWeight: 600,
            background: pts.length >= 3 ? '#1a9c4a' : '#eee', color: pts.length >= 3 ? '#fff' : '#aaa',
            border: 'none', borderRadius: 4, cursor: pts.length >= 3 ? 'pointer' : 'default' }}>
          ✓ Готово, посчитать контур
        </button>
      </div>
      {error && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#c0392b' }}>{error}</p>}
      <p style={{ margin: '6px 0 0', fontSize: 10, color: '#aaa' }}>
        Вводи точки по координатам в порядке обхода периметра (низ → торец →
        верх → торец или наоборот) — главное, чтобы получился один замкнутый
        контур. Торец необязательно вертикальный. Клик по холсту — черновой
        набросок (не обязателен). Клетка — {gridStep} мм.
      </p>
    </div>
  )
}
