import { useState } from 'react'
import { useProjectStore } from '../store/useProjectStore'
import { buildClosingVolumesReport, type ClosingVolumeKind } from '../core/closingVolumesReport'

const KIND_LABEL: Record<ClosingVolumeKind, string> = {
  wall_new: 'Перегородка', wall_lining: 'Облицовка', round_column: 'Колонна (круглая)', rect_column: 'Колонна (прямоуг.)',
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
const fmtRub = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export default function ClosingVolumesReport() {
  const { floorPlan } = useProjectStore()
  const [rateBelow, setRateBelow] = useState(1200)
  const [rateAbove, setRateAbove] = useState(1400)
  const [thresholdMm, setThresholdMm] = useState(3000)
  const [onlyConfirmed, setOnlyConfirmed] = useState(false)

  const report = buildClosingVolumesReport({
    lines: floorPlan.lines,
    roundColumns: floorPlan.roundColumns,
    rectColumns: floorPlan.rectColumns,
    ceilingSlopes: floorPlan.ceilingSlopes,
    rooms: floorPlan.rooms,
    defaultHeightMm: floorPlan.defaultHeightMm,
    rateBelow, rateAbove, thresholdMm,
  })

  const rows = onlyConfirmed ? report.rows.filter(r => r.isComplete) : report.rows
  const shownTotalCost = onlyConfirmed
    ? rows.reduce((s, r) => s + r.cost, 0)
    : report.totalCost

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 12px' }}>
      <h2 style={{ margin: '0 0 4px' }}>🧾 Закрытие объёмов</h2>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: '#888' }}>
        Перегородки/облицовка — по площади, колонны — по погонажу высоты.
        Порог режет каждую строку на два ценовых уровня (ниже/выше). Прогресс
        (буд. прораб → нач. участка) — необязателен: строки без него всё равно
        считаются, просто без отметки «подтверждено».
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16, padding: 12, background: '#f7f8fb', borderRadius: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: '#666' }}>Ставка ниже порога, ₽/м² (₽/пог.м)</label><br />
          <input type="number" value={rateBelow} onChange={e => setRateBelow(Number(e.target.value) || 0)} style={{ width: 100, padding: '5px 6px' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#666' }}>Ставка выше порога, ₽/м² (₽/пог.м)</label><br />
          <input type="number" value={rateAbove} onChange={e => setRateAbove(Number(e.target.value) || 0)} style={{ width: 100, padding: '5px 6px' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#666' }}>Порог высоты, мм</label><br />
          <input type="number" value={thresholdMm} onChange={e => setThresholdMm(Number(e.target.value) || 0)} style={{ width: 100, padding: '5px 6px' }} />
        </div>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', paddingBottom: 6 }}>
          <input type="checkbox" checked={onlyConfirmed} onChange={e => setOnlyConfirmed(e.target.checked)} />
          Только подтверждённые
        </label>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd', color: '#666' }}>
            <th style={{ padding: '6px 8px' }}>Объект</th>
            <th style={{ padding: '6px 8px' }}>Тип</th>
            <th style={{ padding: '6px 8px' }}>Ниже {thresholdMm}мм</th>
            <th style={{ padding: '6px 8px' }}>Выше {thresholdMm}мм</th>
            <th style={{ padding: '6px 8px' }}>Готовность</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isArea = r.tiers.belowM2 > 0 || r.tiers.aboveM2 > 0
            const below = isArea ? `${fmt(r.tiers.belowM2)} м²` : `${fmt(r.tiers.belowM)} пог.м`
            const above = isArea ? `${fmt(r.tiers.aboveM2)} м²` : `${fmt(r.tiers.aboveM)} пог.м`
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '6px 8px' }}>{r.label}</td>
                <td style={{ padding: '6px 8px', color: '#888' }}>{KIND_LABEL[r.kind]}</td>
                <td style={{ padding: '6px 8px' }}>{below}</td>
                <td style={{ padding: '6px 8px' }}>{above}</td>
                <td style={{ padding: '6px 8px' }}>
                  {r.progressPercent === null && !r.isComplete
                    ? <span style={{ color: '#bbb' }}>без отслеживания</span>
                    : r.isComplete
                      ? <span style={{ color: '#2a9d5c' }}>✓ подтверждено</span>
                      : <span style={{ color: '#c98a2b' }}>{r.progressPercent}%</span>}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtRub(r.cost)}</td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr><td colSpan={6} style={{ padding: '16px 8px', textAlign: 'center', color: '#aaa' }}>
              {onlyConfirmed ? 'Нет подтверждённых объёмов' : 'На плане пока нет перегородок/облицовки/колонн'}
            </td></tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr style={{ borderTop: '2px solid #ddd', fontWeight: 600 }}>
              <td style={{ padding: '8px' }} colSpan={5}>Итого{onlyConfirmed ? ' (подтверждённое)' : ''}</td>
              <td style={{ padding: '8px', textAlign: 'right' }}>{fmtRub(shownTotalCost)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
