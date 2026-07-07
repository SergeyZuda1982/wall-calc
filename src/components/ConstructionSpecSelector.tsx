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
import { TAXONOMY, parseDoubleFrameSubtype, isLiningLayersFixed } from '../data/constructionTaxonomy'

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
    // ПС50 для облицовки — всегда 2 слоя (С626), однослойной С625 на ПС50
    // по нормам Кнауф не бывает (см. isLiningLayersFixed).
    const layers = isLiningLayersFixed(planType, subtype || undefined) ? 2 : value.layers
    onChange({
      material: value.material, subtype: subtype || undefined,
      boardSubtype: value.boardSubtype, layers,
    })
  }

  function handleBoardSubtype(boardSubtype: string) {
    if (!value?.material) return
    onChange({ ...value, boardSubtype: (boardSubtype || undefined) as PlanLineSpec['boardSubtype'] })
  }

  function handleLayers(layers: 1 | 2) {
    if (!value?.material) return
    onChange({ ...value, layers })
  }

  function handleGap(gapMm: string) {
    if (!value?.material) return
    const n = parseInt(gapMm)
    onChange({ ...value, gapMm: isNaN(n) ? undefined : n })
  }

  const isGkl = value?.material === 'gkl' && !!value?.subtype
  // Двойной каркас (С115.1/.2/.3, С116) — число слоёв фиксировано системой,
  // а не выбором монтажника, поэтому обычный селектор "1/2 слоя" здесь
  // не показываем (см. constructionTaxonomy.ts, getDoubleFrameLayerCounts).
  const doubleFrame = parseDoubleFrameSubtype(value?.subtype)
  const liningLayersFixed = isLiningLayersFixed(planType, value?.subtype)

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

      {/* ── Лист обшивки + кол-во слоёв (только ГКЛ, после выбора подтипа) ── */}
      {isGkl && (
        <>
          <select
            value={value?.boardSubtype ?? 'standard'}
            onChange={e => handleBoardSubtype(e.target.value)}
            style={{ ...selectStyle, color: '#222' }}
          >
            <option value="standard">Стандарт ГКЛ</option>
            <option value="moisture">Влагостойкий ГКЛВ</option>
            <option value="fire">Огнестойкий ГКЛО</option>
            <option value="moisture_fire">Влагоогнестойкий ГКЛВО</option>
          </select>
          {doubleFrame ? (
            <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
              слоёв: фикс. по системе
            </span>
          ) : liningLayersFixed ? (
            <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }} title="По нормам Кнауф однослойной С625 на ПС50 не бывает — только С626">
              слоёв: фикс. 2 (С626)
            </span>
          ) : (
            <select
              value={value?.layers ?? 1}
              onChange={e => handleLayers(Number(e.target.value) as 1 | 2)}
              style={{ ...selectStyle, color: '#222' }}
            >
              <option value={1}>1 слой</option>
              <option value={2}>2 слоя</option>
            </select>
          )}
          {doubleFrame?.dfType === 'c116' && (
            <input
              type='number'
              placeholder='зазор, мм'
              value={value?.gapMm ?? ''}
              onChange={e => handleGap(e.target.value)}
              title='Зазор между рядами стоек под коммуникации, мм'
              style={{ ...selectStyle, width: 90, cursor: 'text' }}
            />
          )}
        </>
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
