import { useState } from 'react'
import type { ProfilePoint, ProfileTemplate } from '../types'
import { interpolateY } from '../core/profileGeometry'
import { useProjectStore } from '../store/useProjectStore'

interface ProfileEditorProps {
  label: string
  yHint: string      // подсказка к полю y, например "высота потолка от пола"
  points: ProfilePoint[]
  length: number      // длина стены l — для подстановки координат новой точки
  baseY: number       // y по умолчанию для новой точки
  onChange: (points: ProfilePoint[]) => void
}

function templateDims(t: ProfileTemplate): string {
  if (t.shape.length < 2) return ''
  const span = Math.round(t.shape[t.shape.length - 1].x - t.shape[0].x)
  const depth = Math.round(Math.max(...t.shape.map(p => Math.abs(p.y))))
  return `${span}×${depth}мм`
}

/**
 * Числовой редактор точек перегиба ломаной линии (потолок или пол).
 * Первая и последняя точка зафиксированы по x (0 и length стены) —
 * редактируется только их y. Промежуточные точки можно двигать по x и y.
 *
 * Это первая версия ввода геометрии (числовая таблица), без drag по канвасу —
 * визуальный редактор точек добавится отдельным шагом.
 */
export default function ProfileEditor({ label, yHint, points, length, baseY, onChange }: ProfileEditorProps) {
  const { activeProjectId, profileTemplates, addProfileTemplate, removeProfileTemplate } = useProjectStore()

  const [fromIdx, setFromIdx] = useState(0)
  const [toIdx, setToIdx] = useState(points.length - 1)
  const [selectedTplId, setSelectedTplId] = useState('')
  const [insertX, setInsertX] = useState('')

  const [stairsStartX, setStairsStartX] = useState('')
  const [stairsLen, setStairsLen] = useState('')
  const [stairsH, setStairsH] = useState('')
  const [stairsCount, setStairsCount] = useState('')
  const [stairsDir, setStairsDir] = useState<'down' | 'up'>('down')

  function updatePoint(i: number, patch: Partial<ProfilePoint>) {
    onChange(points.map((p, idx) => idx === i ? { ...p, ...patch } : p))
  }

  function addPoint() {
    if (points.length < 2) {
      onChange([{ x: 0, y: baseY }, { x: length, y: baseY }])
      return
    }
    // Вставляем новую точку посередине наибольшего по x промежутка
    let bestGap = -1, insertAt = 1
    for (let i = 0; i < points.length - 1; i++) {
      const gap = points[i + 1].x - points[i].x
      if (gap > bestGap) { bestGap = gap; insertAt = i + 1 }
    }
    const a = points[insertAt - 1], b = points[insertAt]
    const mid: ProfilePoint = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }
    const next = [...points]
    next.splice(insertAt, 0, mid)
    onChange(next)
  }

  function removePoint(i: number) {
    if (points.length <= 2) return // минимум 2 точки — начало и конец
    onChange(points.filter((_, idx) => idx !== i))
  }

  // ─── Шаблоны объекта (балка, ригель, ступени и т.п.) ───────────────────────
  // Шаблон хранит ФОРМУ (смещения от первой точки выделения), а не абсолютные
  // координаты — поэтому одну и ту же балку можно воткнуть в любую перегородку
  // объекта, просто указав, где у неё начало на этой конкретной стене.

  function saveSelectionAsTemplate() {
    const from = Math.min(fromIdx, points.length - 1)
    const to = Math.min(toIdx, points.length - 1)
    if (to <= from) return
    const sel = points.slice(from, to + 1)
    const base = sel[0]
    const name = window.prompt('Имя шаблона (например «Балка 600×400» или «Ригель»):')
    if (!name) return
    const shape = sel.map(p => ({ x: p.x - base.x, y: p.y - base.y }))
    addProfileTemplate(name.trim(), shape)
  }

  function insertSelectedTemplate() {
    const tpl = profileTemplates.find(t => t.id === selectedTplId)
    const startX = Number(insertX)
    if (!tpl || !tpl.shape.length || !Number.isFinite(startX)) return
    const baseAtX = interpolateY(points, startX)
    const newPts = tpl.shape.map(p => ({
      x: Math.min(Math.max(Math.round(startX + p.x), 0), length),
      y: Math.round(baseAtX + p.y),
    }))
    const spanFrom = newPts[0].x, spanTo = newPts[newPts.length - 1].x
    // Убираем существующие точки строго внутри диапазона вставки — края (0/length
    // и любые точки ровно на границе шаблона) остаются, сольются по сортировке.
    const kept = points.filter(p => p.x <= spanFrom || p.x >= spanTo)
    onChange([...kept, ...newPts].sort((a, b) => a.x - b.x))
    setInsertX('')
  }

  // ─── Ступени (генератор) ────────────────────────────────────────────────
  // Каждая ступень — проступь (горизонтальный отрезок длиной stairsLen) и
  // подступенок (перепад stairsH). Перепад делаем на x+1мм от конца проступи,
  // а не на том же x — иначе направляющая на canvas схлопнет точку и вместо
  // вертикали нарисует наклонную линию (см. railPoints: уникальные x в Set).
  // Конец предыдущей ступени = начало следующей, как и просили.

  function generateStairs() {
    const startX = Number(stairsStartX)
    const stepLen = Number(stairsLen)
    const stepH = Number(stairsH)
    const count = Math.round(Number(stairsCount))
    if (!Number.isFinite(startX) || !(stepLen > 0) || !(stepH > 0) || !(count >= 1)) return

    const sign = stairsDir === 'up' ? 1 : -1
    let curY = interpolateY(points, startX)
    let canonicalX = startX
    const generated: ProfilePoint[] = [{ x: Math.round(startX), y: Math.round(curY) }]
    for (let i = 0; i < count; i++) {
      canonicalX += stepLen
      generated.push({ x: Math.round(canonicalX), y: Math.round(curY) })      // конец проступи
      curY += sign * stepH
      generated.push({ x: Math.round(canonicalX) + 1, y: Math.round(curY) })  // подступенок
    }
    const spanFrom = generated[0].x, spanTo = generated[generated.length - 1].x
    const clamp = (x: number) => Math.min(Math.max(x, 0), length)
    const kept = points.filter(p => p.x <= spanFrom || p.x >= spanTo)
    const merged = [...kept, ...generated.map(p => ({ ...p, x: clamp(p.x) }))].sort((a, b) => a.x - b.x)
    onChange(merged)
    setStairsStartX(String(clamp(spanTo)))
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '8px 10px', marginTop: 6, background: '#fafafe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>{label} — точки перегиба</span>
        <button type="button" onClick={addPoint}
          style={{ padding: '3px 10px', fontSize: 12, cursor: 'pointer', background: '#f0f4ff', border: '1px solid #aac', borderRadius: 4 }}>
          + точка
        </button>
      </div>

      {points.map((p, i) => {
        const xFixed = i === 0 || i === points.length - 1
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: '#999', width: 14, paddingBottom: 6 }}>{i + 1}</span>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: '#888' }}>x — от начала стены (мм)</label><br />
              <input type="number" value={p.x || ''} disabled={xFixed}
                onFocus={e => e.currentTarget.select()}
                onChange={e => updatePoint(i, { x: Number(e.target.value) })}
                style={{ width: '100%', padding: '4px 6px', fontSize: 12, background: xFixed ? '#f0f0f0' : '#fff' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: '#888' }}>y — {yHint} (мм)</label><br />
              <input type="number" value={p.y || ''}
                onFocus={e => e.currentTarget.select()}
                onChange={e => updatePoint(i, { y: Number(e.target.value) })}
                style={{ width: '100%', padding: '4px 6px', fontSize: 12 }} />
            </div>
            <button type="button" onClick={() => removePoint(i)} disabled={points.length <= 2}
              style={{ padding: '4px 8px', fontSize: 12, marginBottom: 1,
                cursor: points.length <= 2 ? 'default' : 'pointer', background: '#fff',
                border: '1px solid #e05', color: points.length <= 2 ? '#ccc' : '#e05', borderRadius: 4 }}>
              🗑
            </button>
          </div>
        )
      })}
      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#999' }}>
        Точки сортируются по x при расчёте. Две точки с одинаковым x подряд = вертикальная ступень.
      </p>

      {/* ─── Ступени: генератор цепочки проступь+подступенок ─── */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #ddd' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Ступени</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <input type="number" placeholder="X начала, мм" value={stairsStartX}
            onFocus={e => e.currentTarget.select()}
            onChange={e => setStairsStartX(e.target.value)}
            style={{ width: 90, padding: '4px 6px', fontSize: 12 }} />
          <input type="number" placeholder="Длина ступени, мм" value={stairsLen}
            onFocus={e => e.currentTarget.select()}
            onChange={e => setStairsLen(e.target.value)}
            style={{ width: 110, padding: '4px 6px', fontSize: 12 }} />
          <input type="number" placeholder="Высота ступени, мм" value={stairsH}
            onFocus={e => e.currentTarget.select()}
            onChange={e => setStairsH(e.target.value)}
            style={{ width: 110, padding: '4px 6px', fontSize: 12 }} />
          <input type="number" placeholder="Кол-во" value={stairsCount}
            onFocus={e => e.currentTarget.select()}
            onChange={e => setStairsCount(e.target.value)}
            style={{ width: 70, padding: '4px 6px', fontSize: 12 }} />
          <select value={stairsDir} onChange={e => setStairsDir(e.target.value as 'down' | 'up')}
            style={{ padding: '4px 6px', fontSize: 12 }}>
            <option value="down">вниз</option>
            <option value="up">вверх</option>
          </select>
          <button type="button" onClick={generateStairs}
            disabled={!stairsStartX || !stairsLen || !stairsH || !stairsCount}
            style={{ padding: '4px 10px', fontSize: 12,
              cursor: (!stairsStartX || !stairsLen || !stairsH || !stairsCount) ? 'default' : 'pointer',
              background: '#f0f4ff', border: '1px solid #aac', borderRadius: 4,
              color: (!stairsStartX || !stairsLen || !stairsH || !stairsCount) ? '#aaa' : '#333' }}>
            Сгенерировать
          </button>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 10, color: '#aaa' }}>
          Каждая ступень: проступь stairsLen мм + перепад stairsH мм в выбранную сторону.
          Конец ступени — начало следующей. После генерации «X начала» сам сдвинется на конец цепочки,
          можно сразу продолжать (например, после лестничной площадки).
        </p>
      </div>

      {/* ─── Шаблоны объекта: балка/ригель/ступени и т.п. ─── */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #ddd' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Шаблоны объекта</span>

        {!activeProjectId && (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#999' }}>
            Доступно внутри объекта — выбери или создай объект, чтобы сохранять и переиспользовать формы (балки, ригели, ступени) между перегородками.
          </p>
        )}

        {activeProjectId && (
          <>
            {profileTemplates.length > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                <select value={selectedTplId} onChange={e => setSelectedTplId(e.target.value)}
                  style={{ padding: '4px 6px', fontSize: 12, flex: '1 1 160px' }}>
                  <option value="">— выбери шаблон —</option>
                  {profileTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({templateDims(t)})</option>
                  ))}
                </select>
                <input type="number" placeholder="X начала, мм" value={insertX}
                  onFocus={e => e.currentTarget.select()}
                  onChange={e => setInsertX(e.target.value)}
                  style={{ width: 110, padding: '4px 6px', fontSize: 12 }} />
                <button type="button" onClick={insertSelectedTemplate} disabled={!selectedTplId || !insertX}
                  style={{ padding: '4px 10px', fontSize: 12, cursor: (!selectedTplId || !insertX) ? 'default' : 'pointer',
                    background: '#f0f4ff', border: '1px solid #aac', borderRadius: 4,
                    color: (!selectedTplId || !insertX) ? '#aaa' : '#333' }}>
                  Вставить
                </button>
              </div>
            )}

            {profileTemplates.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {profileTemplates.map(t => (
                  <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#666' }}>
                    <span>{t.name} <span style={{ color: '#aaa' }}>({templateDims(t)})</span></span>
                    <button type="button" onClick={() => removeProfileTemplate(t.id)}
                      style={{ padding: '0 6px', fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', color: '#e05' }}>
                      🗑
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: '#888' }}>Сохранить точки от</span>
              <select value={Math.min(fromIdx, points.length - 1)} onChange={e => setFromIdx(Number(e.target.value))}
                style={{ padding: '3px 4px', fontSize: 12 }}>
                {points.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
              </select>
              <span style={{ fontSize: 11, color: '#888' }}>до</span>
              <select value={Math.min(toIdx, points.length - 1)} onChange={e => setToIdx(Number(e.target.value))}
                style={{ padding: '3px 4px', fontSize: 12 }}>
                {points.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
              </select>
              <button type="button" onClick={saveSelectionAsTemplate} disabled={Math.min(toIdx, points.length - 1) <= Math.min(fromIdx, points.length - 1)}
                style={{ padding: '3px 10px', fontSize: 12,
                  cursor: Math.min(toIdx, points.length - 1) <= Math.min(fromIdx, points.length - 1) ? 'default' : 'pointer',
                  background: '#f0fff4', border: '1px solid #9c9', borderRadius: 4,
                  color: Math.min(toIdx, points.length - 1) <= Math.min(fromIdx, points.length - 1) ? '#aaa' : '#333' }}>
                Сохранить как шаблон
              </button>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 10, color: '#aaa' }}>
              Выдели в таблице выше точки, образующие один вырез (например, спуск-низ-подъём балки), и сохрани как шаблон —
              потом воткнёшь его в любую перегородку этого объекта по X начала.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
