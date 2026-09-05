import { useMemo, useState } from 'react'
import { Stage, Layer, Line, Circle, Text, Rect } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { ProfilePoint } from '../types'
import { interpolateY } from '../core/profileGeometry'
import { useContainerWidth } from '../hooks/useContainerWidth'
import { CANVAS_W as CANVAS_W_MAX } from '../constants'

interface ProfileCanvasEditorProps {
  label: string          // "Потолок" / "Пол" — какой профиль редактируется
  yHint: string
  points: ProfilePoint[] // редактируемый (активный) профиль
  otherLabel: string     // подпись второго профиля, для контекста (не редактируется)
  otherPoints: ProfilePoint[]
  length: number         // длина стены, мм
  baseY: number          // y для новой точки по умолчанию
  onChange: (points: ProfilePoint[]) => void
}

const CANVAS_H = 260
const PAD_X = 44
const PAD_TOP = 24
const PAD_BOTTOM = 34
const POINT_R = 6

/**
 * Визуальный (канвас) редактор ломаной линии профиля — второй вид того же
 * массива points, что и числовая таблица ProfileEditor. Оба меняют один и
 * тот же store через одинаковый onChange(points), поэтому таблицу и канвас
 * можно держать открытыми одновременно без риска рассинхрона.
 *
 * Показывает ОБА профиля в одном разрезе (активный — ярко и кликабельно,
 * второй — приглушённо, только для контекста: чтобы, например, при правке
 * потолка сразу было видно, не "протыкает" ли наклонный участок пол).
 *
 * Ввод координат — только числом (без углового/шагового снапа): выбранная
 * точка редактируется через поля X/Y под канвасом, перетаскивание мышкой —
 * для черновой прикидки позиции. Это осознанно проще углового снапа в
 * FloorPlan.tsx — здесь X всегда монотонно возрастает и нет свободного
 * направления отрезка, снапить по факту нечего кроме самих чисел.
 */
export default function ProfileCanvasEditor({
  label, yHint, points, otherLabel, otherPoints, length, baseY, onChange,
}: ProfileCanvasEditorProps) {
  const [wrapRef, CANVAS_W] = useContainerWidth(CANVAS_W_MAX, 20)
  const [selected, setSelected] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const allY = [...points.map(p => p.y), ...otherPoints.map(p => p.y), baseY, 0]
  const minY = Math.min(...allY)
  const maxY = Math.max(...allY)
  const ySpan = Math.max(maxY - minY, 1)

  const plotW = Math.max(CANVAS_W - PAD_X * 2, 10)
  const plotH = CANVAS_H - PAD_TOP - PAD_BOTTOM

  const xToPx = (x: number) => PAD_X + (length > 0 ? (x / length) * plotW : 0)
  const yToPx = (y: number) => PAD_TOP + plotH - ((y - minY) / ySpan) * plotH
  const pxToX = (px: number) => length > 0 ? ((px - PAD_X) / plotW) * length : 0
  const pxToY = (py: number) => minY + ((PAD_TOP + plotH - py) / plotH) * ySpan

  const linePx = (pts: ProfilePoint[]): number[] => {
    const out: number[] = []
    for (const p of pts) { out.push(xToPx(p.x), yToPx(p.y)) }
    return out
  }

  const gridYLines = useMemo(() => {
    const step = ySpan > 3000 ? 500 : ySpan > 1200 ? 200 : 100
    const lines: number[] = []
    const start = Math.ceil(minY / step) * step
    for (let y = start; y <= maxY; y += step) lines.push(y)
    return lines
  }, [minY, maxY, ySpan])

  function updatePoint(i: number, patch: Partial<ProfilePoint>) {
    const clamp = (p: ProfilePoint): ProfilePoint => {
      if (i === 0) return { ...p, x: 0 }
      if (i === points.length - 1) return { ...p, x: length }
      return { ...p, x: Math.min(Math.max(p.x, 0), length) }
    }
    onChange(points.map((p, idx) => idx === i ? clamp({ ...p, ...patch }) : p))
  }

  function removePoint(i: number) {
    if (points.length <= 2) return
    onChange(points.filter((_, idx) => idx !== i))
    setSelected(null)
  }

  // Клик по холсту (не по точке) — добавить новую точку в место клика,
  // на позиции X курсора (высота Y — интерполяция текущего профиля в этом X,
  // чтобы новая точка не "прыгала" линией, а сначала ложится на неё же;
  // Y потом правится числом или перетаскиванием).
  function handleStageClick(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (e.target !== e.target.getStage()) return // клик пришёлся на точку — её обработчик уже сработал
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()
    if (!pos) return
    const x = Math.round(Math.min(Math.max(pxToX(pos.x), 0), length))
    const y = Math.round(interpolateY(points, x))
    const next = [...points, { x, y }].sort((a, b) => a.x - b.x)
    onChange(next)
    setSelected(next.findIndex(p => p.x === x && p.y === y))
  }

  const sel = selected !== null ? points[selected] : null

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 10px', marginTop: 6, background: '#fafafe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>{label} — разрез (клик = точка, ЛКМ по точке = выбрать)</span>
        <span style={{ fontSize: 11, color: '#aaa' }}>{otherLabel} показан фоном</span>
      </div>

      <div ref={wrapRef}>
        <Stage width={CANVAS_W} height={CANVAS_H} onClick={handleStageClick} onTap={handleStageClick}
          style={{ background: '#fff', border: '1px solid #eee', borderRadius: 4, cursor: 'crosshair' }}>
          <Layer>
            {/* сетка по Y с подписями высоты */}
            {gridYLines.map(y => (
              <Line key={y} points={[PAD_X, yToPx(y), PAD_X + plotW, yToPx(y)]} stroke="#f0f0f0" strokeWidth={1} />
            ))}
            {gridYLines.map(y => (
              <Text key={`t${y}`} x={2} y={yToPx(y) - 6} text={String(y)} fontSize={9} fill="#bbb" />
            ))}

            {/* контекстный (не редактируемый) профиль */}
            {otherPoints.length >= 2 && (
              <Line points={linePx(otherPoints)} stroke="#ccc" strokeWidth={2} dash={[4, 4]} listening={false} />
            )}

            {/* активный профиль */}
            {points.length >= 2 && (
              <Line points={linePx(points)} stroke="#4a7dff" strokeWidth={2.5} listening={false} />
            )}

            {/* точки активного профиля — кликабельные, перетаскиваемые */}
            {points.map((p, i) => (
              <Circle key={i}
                x={xToPx(p.x)} y={yToPx(p.y)} radius={POINT_R}
                fill={selected === i ? '#e05' : '#4a7dff'}
                stroke="#fff" strokeWidth={1.5}
                draggable
                onDragStart={() => { setSelected(i); setDragging(true) }}
                onDragMove={ev => {
                  const x = Math.round(pxToX(ev.target.x()))
                  const y = Math.round(pxToY(ev.target.y()))
                  updatePoint(i, { x, y })
                }}
                onDragEnd={() => setDragging(false)}
                onClick={ev => { ev.cancelBubble = true; setSelected(i) }}
                onTap={ev => { ev.cancelBubble = true; setSelected(i) }}
              />
            ))}

            {/* подсказка высоты у выбранной точки */}
            {sel && !dragging && (
              <Text x={xToPx(sel.x) + 8} y={yToPx(sel.y) - 18}
                text={`X=${Math.round(sel.x)} Y=${Math.round(sel.y)}`} fontSize={11} fill="#333" />
            )}

            {/* рамка длины стены */}
            <Rect x={PAD_X} y={PAD_TOP} width={plotW} height={plotH} stroke="#e5e5e5" strokeWidth={1} listening={false} />
          </Layer>
        </Stage>
      </div>

      {/* Точный ввод для выбранной точки — единственный способ попасть в */}
      {/* точное число (перетаскивание — только для черновой прикидки). */}
      {sel && selected !== null && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: '#999', paddingBottom: 6 }}>Точка {selected + 1}</span>
          <div>
            <label style={{ fontSize: 10, color: '#888' }}>x — от начала стены (мм)</label><br />
            <input type="number" value={sel.x || ''} disabled={selected === 0 || selected === points.length - 1}
              onFocus={e => e.currentTarget.select()}
              onChange={e => updatePoint(selected, { x: Number(e.target.value) })}
              style={{ width: 110, padding: '4px 6px', fontSize: 12,
                background: (selected === 0 || selected === points.length - 1) ? '#f0f0f0' : '#fff' }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#888' }}>y — {yHint} (мм)</label><br />
            <input type="number" value={sel.y || ''}
              onFocus={e => e.currentTarget.select()}
              onChange={e => updatePoint(selected, { y: Number(e.target.value) })}
              style={{ width: 110, padding: '4px 6px', fontSize: 12 }} />
          </div>
          <button type="button" onClick={() => removePoint(selected)} disabled={points.length <= 2}
            style={{ padding: '4px 8px', fontSize: 12, marginBottom: 1,
              cursor: points.length <= 2 ? 'default' : 'pointer', background: '#fff',
              border: '1px solid #e05', color: points.length <= 2 ? '#ccc' : '#e05', borderRadius: 4 }}>
            🗑 удалить точку
          </button>
        </div>
      )}
      <p style={{ margin: '6px 0 0', fontSize: 10, color: '#aaa' }}>
        Клик по пустому месту — новая точка. Две точки подряд с одинаковым X — вертикальный
        перепад (ступень, ригель, балка): поставь точку, потом вбей то же X вручную и новый Y.
      </p>
    </div>
  )
}
