import { useState } from 'react'
import { useProjectStore } from '../store/useProjectStore'
import { calcProjectMaterialsSummary } from '../core/calcProjectMaterialsSummary'

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

export default function ProjectMaterialsSummary() {
  const { walls, linings, floorPlan } = useProjectStore()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const summary = calcProjectMaterialsSummary(
    walls, linings, floorPlan.ceilings ?? [],
    floorPlan.rooms ?? [], floorPlan.lines, floorPlan.scaleMmPerPx || 1,
  )

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 12px' }}>
      <h2 style={{ margin: '0 0 4px' }}>📋 Смета — сводные количества</h2>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: '#888' }}>
        Только количество материала по всему объекту, без цен (цен на материалы в проекте
        пока нет вообще). Группировка по виду материала, не по конструкции — иначе одну
        и ту же позицию видно в десятке мест.
      </p>

      {summary.warnings.length > 0 && (
        <div style={{ background: '#fff8e8', border: '1px solid #f0dca0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#7a5c14', lineHeight: 1.6 }}>
          {summary.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}

      {summary.totalRows === 0 ? (
        <div style={{ padding: '24px 8px', textAlign: 'center', color: '#aaa' }}>Считать пока нечего</div>
      ) : (
        summary.groups.filter(g => g.rows.length > 0).map(group => {
          const isCollapsed = collapsed[group.title]
          return (
            <div key={group.title} style={{ marginBottom: 14, border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
              <div
                onClick={() => setCollapsed(c => ({ ...c, [group.title]: !c[group.title] }))}
                style={{ padding: '9px 14px', background: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {group.title}
                  <span style={{ fontWeight: 400, color: '#888', fontSize: 11, marginLeft: 8 }}>{group.rows.length} поз.</span>
                </span>
                <span style={{ color: '#888', fontSize: 12 }}>{isCollapsed ? '▼' : '▲'}</span>
              </div>
              {!isCollapsed && (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: '#888', borderBottom: '1px solid #eee' }}>
                        <th style={{ padding: '6px 14px', fontWeight: 500 }}>Материал</th>
                        <th style={{ padding: '6px 14px', fontWeight: 500, textAlign: 'right' }}>Кол-во</th>
                        <th style={{ padding: '6px 14px', fontWeight: 500 }}>Источник</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map(row => (
                        <tr key={row.label} style={{ borderBottom: '1px solid #f2f2f2' }}>
                          <td style={{ padding: '7px 14px' }}>{row.label}</td>
                          <td style={{ padding: '7px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <b>{fmt(row.qty)}</b> <span style={{ color: '#888', fontSize: 11 }}>{row.unit}</span>
                          </td>
                          <td style={{ padding: '7px 14px', color: '#888', fontSize: 11.5 }}>{row.sources}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {group.hint && (
                    <div style={{ padding: '6px 14px 10px', fontSize: 11, color: '#aaa' }}>{group.hint}</div>
                  )}
                </>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
