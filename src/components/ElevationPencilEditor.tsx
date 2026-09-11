import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Line, Circle, Text } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { ProfilePoint, EdgeProfile } from '../types'
import { decomposeElevationPerimeter } from '../core/profileGeometry'
import { useContainerWidth } from '../hooks/useContainerWidth'

interface ElevationPencilEditorProps {
  onFinish: (result: { length: number; ceilingProfile: EdgeProfile; floorProfile: EdgeProfile }) => void
  onCancel: () => void
}

// Растущий (после первой точки) кадр — всегда совпадает с пропорциями
// канваса (letterbox'а нет, см. ensureFrame).
interface ViewFrame { x0: number; y0: number; span: number }
// Унифицированное представление для рендера — и растущего кадра, и
// дефолтного (letterboxed) состояния до первой точки.
interface View { x0: number; y0: number; scale: number; offX: number; offY: number; usedH: number }

const CANVAS_H = 520
const CANVAS_W_MAX = 1400 // сильно больше обычного 820 у остальных canvas'ов проекта — это
  // единственное место, где холсту специально дают занять всю освободившуюся широкую область
  // (см. isFullBleedTab в App.tsx/использование в LiningCalc.tsx — снимает лимит 900px у страницы)
const PAD = 34
const PAD_TOP = 20
const PAD_BOTTOM = 20
const CLOSE_PX = 14
const SNAP_GUIDE_PX = 10 // радиус магнита (в экранных px) к ориентиру "известная длина стены"
// Дефолтный диапазон ДО первой точки — фиксированные мм, НЕ подогнанные под
// пропорции канваса (тот сейчас очень широкий, ~2.8:1) — иначе по высоте
// влезало от силы ~1500мм, а мышь физически не может уйти выше видимой
// области холста, чтобы дотянуться до реальных 3500-5500мм. Небольшой
// letterbox по бокам — меньшее зло, чем невозможность начертить нужную
// высоту сразу.
const DEFAULT_W_MM = 8000
const DEFAULT_H_MM = 5800
const FRAME_MARGIN_RATIO = 0.1 // насколько близко к краю точка ещё считается "в кадре"
const NICE_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000] // мм, для клетки
const MIN_CELL_PX = 28

/**
 * Рисование ВСЕГО периметра сечения стены (вид сбоку) с нуля — без
 * предварительно заданных длины/высоты.
 *
 * РАСКЛАДКА: узкая панель управления слева (фиксированной ширины) +
 * большой холст справа, во всю оставшуюся ширину (работает, когда родитель
 * снял лимит 900px страницы на время рисования — isFullBleedTab).
 *
 * ГЛАВНЫЙ способ добавить точку — ввод АБСОЛЮТНЫХ координат X/Y числом
 * (как график: есть 0, есть оси, деления подписаны) — не "отрезок от
 * последней точки по направлению курсора". Пользователь по факту знает
 * высоту в конкретных точках по длине стены (из проекта или замера), а не
 * относительные смещения. Клик по холсту — ВТОРОЙ, черновой способ (с
 * ортоснапом) для визуальной прикидки.
 *
 * Замыкание — клик рядом с первой точкой ИЛИ кнопка «Готово». ПКМ (через
 * mousedown) — отмена последней точки. Колесо мыши — зум к курсору (тот
 * же принцип, что уже у карандаша Плиты на плане в FloorPlan.tsx).
 *
 * Система координат: ДО первой точки — фиксированный реалистичный диапазон
 * DEFAULT_W_MM×DEFAULT_H_MM (см. выше, letterbox допустим). ПОСЛЕ первой
 * точки — растущий ViewFrame, который не пересчитывается на каждый клик
 * (иначе точка визуально "прыгает"), а растёт только когда новая точка
 * реально выходит за его пределы, и всегда без letterbox'а (сохраняет
 * пропорции канваса).
 *
 * По завершении контур раскладывается на ceilingProfile/floorProfile/length
 * через decomposeElevationPerimeter (core/profileGeometry.ts) — торцы стены
 * не обязаны быть вертикальными (мансардная геометрия поддерживается).
 *
 * «Известная длина стены» (необязательное поле слева) — ориентир для
 * случая, когда общая длина известна заранее (например, на полу уже
 * стоит направляющий профиль конкретной длины), а высота в точке, где
 * диагональ должна закончиться, ещё не измерена (нужен лазерный уровень
 * от метки на полу до потолка). Рисует вертикальную линию-магнит на
 * X = (X первой точки) + длина; клик рядом с ней снапится по X с любым Y —
 * высоту точки потом можно поправить в ProfileEditor/ProfileCanvasEditor.
 * Y первой точки по умолчанию предзаполнен нулём (`typedY` initial state) —
 * обычно первая точка это низ первой вертикали (пол), явно вводить 0 не
 * нужно, достаточно X + Enter.
 */
export default function ElevationPencilEditor({ onFinish, onCancel }: ElevationPencilEditorProps) {
  const [wrapRef, CANVAS_W] = useContainerWidth(CANVAS_W_MAX, 20)
  const [pts, setPts] = useState<ProfilePoint[]>([])
  const [frame, setFrame] = useState<ViewFrame | null>(null)
  const [cursorMm, setCursorMm] = useState<ProfilePoint | null>(null)
  const [typedX, setTypedX] = useState('')
  const [typedY, setTypedY] = useState('0') // первая точка обычно на полу (Y=0) — жать Enter сразу после X
  const [orthoSnap, setOrthoSnap] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // "Известная длина стены" — необязательный ориентир для случая, когда
  // высота в конкретной точке диагонали ещё не измерена (например, ждём
  // лазерный уровень от направляющего профиля на полу), но общая длина
  // стены уже известна заранее. Рисуется как вертикальная линия на
  // X = (X первой точки) + длина, и клик по холсту к ней магнитится —
  // не нужно попадать пикселем точно, стену можно "дотянуть" по высоте
  // позже, отредактировав Y у уже поставленной точки.
  const [wallLengthInput, setWallLengthInput] = useState('')
  // Панорамирование средней кнопкой мыши (СКМ) — тот же принцип, что у
  // карандаша Плиты на плане в FloorPlan.tsx, только тут двигаем не
  // Konva Stage-transform, а свою mm-based систему координат (ViewFrame).
  // panStartRef хранит пиксель начала драга + "мировой" x0/y0/span кадра
  // НА МОМЕНТ начала драга (если кадра ещё не было — до первой точки —
  // синтезируем эквивалентный кадр из текущего letterboxed view, чтобы
  // картинка не прыгала в момент начала панорамирования).
  const panStartRef = useRef<{ px: number; py: number; x0: number; y0: number; span: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const stageRef = useRef<Konva.Stage>(null)

  const plotW = Math.max(CANVAS_W - PAD * 2, 10)
  const plotH = CANVAS_H - PAD_TOP - PAD_BOTTOM

  const view: View = useMemo(() => {
    if (frame) {
      // растущий кадр — всегда без letterbox'а (span/height уже совпадают
      // с пропорциями канваса по построению, см. ensureFrame)
      return { x0: frame.x0, y0: frame.y0, scale: frame.span / plotW, offX: 0, offY: 0, usedH: plotH }
    }
    // дефолтное состояние — фиксированные мм, letterbox допустим
    const scale = Math.max(DEFAULT_W_MM / plotW, DEFAULT_H_MM / plotH)
    const usedW = DEFAULT_W_MM / scale, usedH = DEFAULT_H_MM / scale
    return {
      x0: -DEFAULT_W_MM * 0.05, y0: -DEFAULT_H_MM * 0.05, scale,
      offX: (plotW - usedW) / 2, offY: (plotH - usedH) / 2, usedH,
    }
  }, [frame, plotW, plotH])

  const xToPx = (x: number) => PAD + view.offX + (x - view.x0) / view.scale
  const yToPx = (y: number) => PAD_TOP + view.offY + view.usedH - (y - view.y0) / view.scale
  const pxToX = (px: number) => view.x0 + (px - PAD - view.offX) * view.scale
  const pxToY = (py: number) => view.y0 + (view.usedH - (py - PAD_TOP - view.offY)) * view.scale

  // Растим кадр, только если точка реально выходит за его пределы (с запасом
  // FRAME_MARGIN_RATIO) — иначе кадр не меняется вообще, никакого "прыжка".
  function ensureFrame(f: ViewFrame | null, p: ProfilePoint): ViewFrame {
    if (!f) {
      // первая точка — стартуем растущий кадр, уже точно накрывающий саму
      // точку с запасом
      const pad = Math.max(DEFAULT_W_MM, DEFAULT_H_MM) * 0.1
      const minX = p.x - pad, maxX = p.x + pad, minY = p.y - pad, maxY = p.y + pad
      const span = Math.max(maxX - minX, (maxY - minY) * (plotW / plotH), DEFAULT_W_MM * 0.5)
      const hNew = span * (plotH / plotW)
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
      return { x0: cx - span / 2, y0: cy - hNew / 2, span }
    }
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
    setFrame(ensureFrame(frame, p))
    setPts(prev => [...prev, p])
    setError(null)
  }

  // Ориентир "известная длина стены" — X отсчитывается от X первой
  // поставленной точки (обычно это низ первой вертикали, пол).
  const originX = pts[0]?.x ?? 0
  const knownLengthMm = (() => {
    const v = Number(wallLengthInput)
    return wallLengthInput.trim() !== '' && Number.isFinite(v) && v > 0 ? v : null
  })()
  const guideX = knownLengthMm !== null ? originX + knownLengthMm : null

  function applyGuideSnap(p: ProfilePoint): ProfilePoint {
    if (guideX === null) return p
    if (Math.abs(p.x - guideX) <= SNAP_GUIDE_PX * view.scale) return { x: Math.round(guideX), y: p.y }
    return p
  }

  // Лист в клетку — шаг подбирается так, чтобы клетка была 28-56px на экране.
  const gridStep = useMemo(
    () => NICE_STEPS.find(s => s / view.scale >= MIN_CELL_PX) ?? NICE_STEPS[NICE_STEPS.length - 1],
    [view.scale]
  )

  const gridLines = useMemo(() => {
    const leftMm = pxToX(PAD), rightMm = pxToX(PAD + plotW)
    const bottomMm = pxToY(PAD_TOP + plotH), topMm = pxToY(PAD_TOP)
    const vs: number[] = []
    for (let x = Math.ceil(leftMm / gridStep) * gridStep; x <= rightMm; x += gridStep) vs.push(x)
    const hs: number[] = []
    for (let y = Math.ceil(bottomMm / gridStep) * gridStep; y <= topMm; y += gridStep) hs.push(y)
    return { vs, hs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridStep, view, plotW, plotH])

  const last = pts[pts.length - 1] ?? null

  function snapToOrtho(from: ProfilePoint, to: ProfilePoint): ProfilePoint {
    const dx = to.x - from.x, dy = to.y - from.y
    return Math.abs(dx) >= Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y }
  }

  const previewPoint = last && cursorMm
    ? applyGuideSnap(orthoSnap ? snapToOrtho(last, cursorMm) : cursorMm)
    : (cursorMm ? applyGuideSnap(cursorMm) : null)
  const guideSnapActive = guideX !== null && previewPoint !== null && Math.round(previewPoint.x) === Math.round(guideX)

  function handleWheel(e: KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    const SCALE_BY = 1.12
    const MIN_SPAN = 300, MAX_SPAN = 100000
    const baseSpan = frame ? frame.span : view.scale * plotW
    const newSpan = e.evt.deltaY < 0
      ? Math.max(baseSpan / SCALE_BY, MIN_SPAN)
      : Math.min(baseSpan * SCALE_BY, MAX_SPAN)
    const newScale = newSpan / plotW
    // мировые координаты под курсором — по ТЕКУЩЕМУ виду (до зума), чтобы
    // после масштабирования под курсором осталась та же точка (зум "к
    // курсору", тот же принцип, что уже у Плиты на плане в FloorPlan.tsx)
    const worldX = pxToX(pos.x), worldY = pxToY(pos.y)
    const newX0 = worldX - newScale * (pos.x - PAD)
    const newY0 = worldY - newScale * (PAD_TOP + plotH - pos.y)
    setFrame({ x0: newX0, y0: newY0, span: newSpan })
  }

  function handleMove(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    if (panStartRef.current) {
      const anchor = panStartRef.current
      const dpx = pos.x - anchor.px, dpy = pos.y - anchor.py
      // см. вывод знаков в handleStageMouseDown: мышь вправо/вниз двигает
      // содержимое кадра вправо/вниз вслед за курсором (обычный grab-pan)
      setFrame({ x0: anchor.x0 - dpx * view.scale, y0: anchor.y0 + dpy * view.scale, span: anchor.span })
      return
    }
    setCursorMm({ x: Math.round(pxToX(pos.x)), y: Math.round(pxToY(pos.y)) })
  }

  // ── Начало панорамирования средней кнопкой мыши ─────────────────────────
  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    if (e.evt.button !== 1) return
    e.evt.preventDefault() // гасим системный автоскролл браузера по СКМ
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    // Синтезируем "эквивалентный" кадр из текущего view (важно ДО первой
    // точки, когда реального frame ещё нет и видна letterboxed рамка
    // DEFAULT_W_MM×DEFAULT_H_MM) — тот же приём, что уже у зума колесом
    // (handleWheel), чтобы точка под курсором никуда не прыгнула в момент
    // начала драга.
    const worldX = pxToX(pos.x), worldY = pxToY(pos.y)
    const x0 = worldX - view.scale * (pos.x - PAD)
    const y0 = worldY - view.scale * (PAD_TOP + plotH - pos.y)
    const span = frame ? frame.span : view.scale * plotW
    panStartRef.current = { px: pos.x, py: pos.y, x0, y0, span }
    setIsPanning(true)
  }

  function endPan() {
    if (!panStartRef.current) return
    panStartRef.current = null
    setIsPanning(false)
  }

  // Подстраховка: если СКМ отпущена вне канваса, всё равно завершаем драг.
  useEffect(() => {
    if (!isPanning) return
    window.addEventListener('mouseup', endPan)
    return () => window.removeEventListener('mouseup', endPan)
  }, [isPanning])

  function tryClose(): boolean {
    if (pts.length < 3) return false
    const res = decomposeElevationPerimeter(pts)
    if (!res) { setError('Контур вырожден — нулевая ширина или все точки на одной вертикали.'); return false }
    setError(null)
    onFinish(res)
    setPts([]); setFrame(null); setCursorMm(null); setTypedX(''); setTypedY('0'); setWallLengthInput('')
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
    // используется поле X/Y слева.
    const raw = { x: Math.round(pxToX(pos.x)), y: Math.round(pxToY(pos.y)) }
    const snapped = last ? (orthoSnap ? snapToOrtho(last, raw) : raw) : raw
    addPoint(applyGuideSnap(snapped))
  }

  function commitAbsolute() {
    const x = Number(typedX), y = Number(typedY)
    if (typedX.trim() === '' || typedY.trim() === '' || Number.isNaN(x) || Number.isNaN(y)) return
    addPoint({ x: Math.round(x), y: Math.round(y) })
    setTypedX(''); setTypedY('')
  }

  function removeLast() {
    setPts(prev => {
      const next = prev.slice(0, -1)
      if (next.length === 0) setTypedY('0') // вернулись к пустому контуру — снова предлагаем начать с пола
      return next
    })
    setError(null)
  }

  const previewLen = last && previewPoint
    ? Math.round(Math.hypot(previewPoint.x - last.x, previewPoint.y - last.y))
    : null

  // Постоянные подписи длины каждого УЖЕ нарисованного отрезка — раньше
  // подпись показывалась только у превью-линии под курсором и исчезала
  // сразу после клика/ввода точки; теперь остаётся навсегда рядом с
  // отрезком (смещена перпендикулярно линии, чтобы не перекрывать её).
  const segmentLabels = useMemo(() => {
    const out: { x: number; y: number; text: string }[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const len = Math.round(Math.hypot(b.x - a.x, b.y - a.y))
      const midXpx = (xToPx(a.x) + xToPx(b.x)) / 2
      const midYpx = (yToPx(a.y) + yToPx(b.y)) / 2
      const dxPx = xToPx(b.x) - xToPx(a.x), dyPx = yToPx(b.y) - yToPx(a.y)
      const segLenPx = Math.hypot(dxPx, dyPx) || 1
      // перпендикулярное смещение на 12px от середины отрезка
      const offX = (-dyPx / segLenPx) * 12, offY = (dxPx / segLenPx) * 12
      out.push({ x: midXpx + offX, y: midYpx + offY, text: `${len}` })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, view])

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '10px 12px', marginTop: 6, background: '#fafafe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>
          Рисование периметра сечения — точки по координатам X/Y (слева), клик по холсту — черновой набросок
        </span>
        <button type="button" onClick={() => { setPts([]); setFrame(null); setCursorMm(null); setError(null); setTypedX(''); setTypedY('0'); setWallLengthInput(''); onCancel() }}
          style={{ fontSize: 11, color: '#999', background: 'none', border: 'none', cursor: 'pointer' }}>
          ✕ отмена
        </button>
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Узкая панель управления — фиксированная ширина, не растягивается
            вместе с холстом. */}
        <div style={{ flex: '0 0 250px', minWidth: 220 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
            Точка по координатам, мм:
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: '#888' }}>X (по стене)</label>
              <input type="number" value={typedX} onChange={e => setTypedX(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitAbsolute() }}
                placeholder="X" style={{ width: '100%', padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: '#888' }}>Y (высота)</label>
              <input type="number" value={typedY} onChange={e => setTypedY(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitAbsolute() }}
                placeholder="Y" style={{ width: '100%', padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }} />
            </div>
          </div>
          <button type="button" onClick={commitAbsolute}
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
            + точка
          </button>
          <button type="button" onClick={removeLast} disabled={pts.length === 0}
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, cursor: pts.length ? 'pointer' : 'default', marginBottom: 10 }}>
            ↩ убрать последнюю (или ПКМ)
          </button>

          <div style={{ marginBottom: 10, padding: '6px 8px', background: '#fff7ec', border: '1px solid #f0d9b5', borderRadius: 4 }}>
            <label style={{ fontSize: 10, color: '#a06a20', display: 'block', marginBottom: 3 }}>
              Известная длина стены, мм (если знаешь заранее)
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" value={wallLengthInput} onChange={e => setWallLengthInput(e.target.value)}
                placeholder="напр. 6400" style={{ flex: 1, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }} />
              {wallLengthInput !== '' && (
                <button type="button" onClick={() => setWallLengthInput('')}
                  style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✕</button>
              )}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 9.5, color: '#a06a20', lineHeight: 1.3 }}>
              Покажет оранжевый ориентир на этой длине от первой точки — клик
              по холсту будет к нему магнититься. Удобно для диагонали, когда
              высота в этой точке ещё не измерена (например, ждёшь лазерный
              уровень от направляющей на полу) — ставь точку по X на
              ориентире с любой Y, а высоту поправишь позже.
            </p>
          </div>

          <label style={{ fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" checked={orthoSnap} onChange={e => setOrthoSnap(e.target.checked)} />
            ⊥ прямой угол (для клика по холсту)
          </label>

          <button type="button" onClick={tryClose} disabled={pts.length < 3}
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, fontWeight: 600,
              background: pts.length >= 3 ? '#1a9c4a' : '#eee', color: pts.length >= 3 ? '#fff' : '#aaa',
              border: 'none', borderRadius: 4, cursor: pts.length >= 3 ? 'pointer' : 'default', marginBottom: 10 }}>
            ✓ Готово, посчитать контур
          </button>

          {error && <p style={{ margin: '0 0 8px', fontSize: 11, color: '#c0392b' }}>{error}</p>}
          <p style={{ margin: 0, fontSize: 10, color: '#aaa', lineHeight: 1.4 }}>
            Вводи точки по координатам в порядке обхода периметра (низ → торец
            → верх → торец или наоборот) — главное, чтобы получился один
            замкнутый контур. Торец необязательно вертикальный. Клик по
            холсту — черновой набросок (не обязателен). Клетка — {gridStep} мм.
          </p>
        </div>

        {/* Большой холст — занимает всю оставшуюся ширину. */}
        {/* ПКМ ловим на mousedown (button===2) на обычном div — надёжнее, чем
            событие contextmenu через внутреннюю Konva-подписку на <Stage>.
            Отдельный onContextMenu только гасит системное меню браузера. */}
        <div ref={wrapRef} style={{ flex: '1 1 480px', minWidth: 320 }}
          onContextMenu={e => e.preventDefault()}
          onMouseDown={e => { if (e.button === 2) { e.preventDefault(); removeLast() } }}>
          <Stage ref={stageRef} width={CANVAS_W} height={CANVAS_H}
            onMouseMove={handleMove} onTouchMove={handleMove}
            onClick={handleStageClick} onTap={handleStageClick}
            onWheel={handleWheel}
            onMouseDown={handleStageMouseDown} onMouseUp={endPan}
            style={{ background: '#fff', border: '1px solid #eee', borderRadius: 4,
              cursor: isPanning ? 'grabbing' : 'crosshair' }}>
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
                  конкретные числа, даже не наводя курсор. */}
              {gridLines.vs.map(x => (
                <Text key={`vt${x}`} x={xToPx(x) - 16} y={PAD_TOP + plotH + 3} width={32} align="center"
                  text={String(x)} fontSize={10} fill="#99a" listening={false} />
              ))}
              {gridLines.hs.map(y => (
                <Text key={`ht${y}`} x={2} y={yToPx(y) - 6} width={PAD - 6} align="right"
                  text={String(y)} fontSize={10} fill="#99a" listening={false} />
              ))}
              {/* Ориентир "известная длина стены" — магнит для клика по
                  холсту, подсвечивается ярче, когда курсор рядом с ним
                  (см. guideSnapActive). */}
              {guideX !== null && (
                <>
                  <Line points={[xToPx(guideX), PAD_TOP, xToPx(guideX), PAD_TOP + plotH]}
                    stroke="#e07b1a" strokeWidth={guideSnapActive ? 2.5 : 1.5}
                    dash={guideSnapActive ? undefined : [6, 4]} listening={false} />
                  <Text x={xToPx(guideX) - 40} y={PAD_TOP + 2} width={80} align="center"
                    text={`L=${Math.round(knownLengthMm ?? 0)}`} fontSize={11}
                    fontStyle="bold" fill="#e07b1a" listening={false} />
                </>
              )}
              {pts.length >= 2 && (
                <Line points={pts.flatMap(p => [xToPx(p.x), yToPx(p.y)])} stroke="#4a7dff" strokeWidth={2.5} listening={false} />
              )}
              {last && previewPoint && (
                <Line points={[xToPx(last.x), yToPx(last.y), xToPx(previewPoint.x), yToPx(previewPoint.y)]}
                  stroke="#4a7dff" strokeWidth={1.5} dash={[5, 4]} listening={false} />
              )}
              {segmentLabels.map((l, i) => (
                <Text key={`seg${i}`} x={l.x - 20} y={l.y - 6} width={40} align="center"
                  text={l.text} fontSize={11} fill="#2a52c4" listening={false} />
              ))}
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
      </div>
    </div>
  )
}
