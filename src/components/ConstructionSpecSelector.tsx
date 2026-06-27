/**
 * Каскадный селектор конструктивной спецификации.
 *
 * Уровень 1: материал/система (gkl, brick, armstrong…)
 * Уровень 2: подтип/толщина (появляется только если у level1 есть children)
 *
 * Порядок выбора принудительный: нельзя перейти к level2 без level1.
 * При смене level1 level2 сбрасывается.
 */

import type { PlanLineType, PlanLineSpec } from '../types'
import { TAXONOMY } from '../data/constructionTaxonomy'

interface Props {
  planType: PlanLineType
  value: PlanLineSpec | undefined
  onChange: (spec: PlanLineSpec | undefined) => void
  compact?: boolean   // уменьшенный вид (для панели в строчку)
}

const selectStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 5,
  border: '1px solid #ccc',
  background: '#fff',
  cursor: 'pointer',
  minWidth: 0,
}

export default function ConstructionSpecSelector({ planType, value, onChange, compact }: Props) {
  const nodes = TAXONOMY[planType] ?? []
  if (!nodes.length) return null

  const selectedL1 = nodes.find(n => n.value === value?.material)
  const hasL2 = (selectedL1?.children?.length ?? 0) > 0

  function handleL1(material: string) {
    if (!material) { onChange(undefined); return }
    // Сбрасываем subtype при смене material
    onChange({ material })
  }

  function handleL2(subtype: string) {
    if (!value?.material) return
    onChange({ material: value.material, subtype: subtype || undefined })
  }

  const gap = compact ? 6 : 8
  const labelStyle: React.CSSProperties = compact
    ? { fontSize: 11, color: '#888', whiteSpace: 'nowrap' }
    : { fontSize: 12, color: '#666', fontWeight: 500 }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap, alignItems: 'center' }}>
      <span style={labelStyle}>Конструкция:</span>

      {/* ── Level 1: материал ── */}
      <select
        value={value?.material ?? ''}
        onChange={e => handleL1(e.target.value)}
        style={{ ...selectStyle, color: value?.material ? '#222' : '#aaa' }}
      >
        <option value=''>— не указана —</option>
        {nodes.map(n => (
          <option key={n.value} value={n.value}>{n.label}</option>
        ))}
      </select>

      {/* ── Level 2: подтип (только если есть children) ── */}
      {hasL2 && (
        <select
          value={value?.subtype ?? ''}
          onChange={e => handleL2(e.target.value)}
          style={{ ...selectStyle, color: value?.subtype ? '#222' : '#aaa' }}
        >
          <option value=''>— подтип —</option>
          {(selectedL1?.children ?? []).map(n => (
            <option key={n.value} value={n.value}>{n.label}</option>
          ))}
        </select>
      )}

      {/* Кнопка сброса — только когда что-то выбрано */}
      {value?.material && (
        <button
          onClick={() => onChange(undefined)}
          title='Сбросить'
          style={{
            padding: '3px 7px', fontSize: 11, borderRadius: 4,
            border: '1px solid #ddd', background: '#f5f5f5',
            color: '#999', cursor: 'pointer',
          }}
        >✕</button>
      )}
    </div>
  )
}
