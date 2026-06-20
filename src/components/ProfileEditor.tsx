import type { ProfilePoint } from '../types'

interface ProfileEditorProps {
  label: string
  yHint: string      // подсказка к полю y, например "высота потолка от пола"
  points: ProfilePoint[]
  length: number      // длина стены l — для подстановки координат новой точки
  baseY: number       // y по умолчанию для новой точки
  onChange: (points: ProfilePoint[]) => void
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
              <input type="number" value={p.x} disabled={xFixed}
                onChange={e => updatePoint(i, { x: Number(e.target.value) })}
                style={{ width: '100%', padding: '4px 6px', fontSize: 12, background: xFixed ? '#f0f0f0' : '#fff' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: '#888' }}>y — {yHint} (мм)</label><br />
              <input type="number" value={p.y}
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
    </div>
  )
}
