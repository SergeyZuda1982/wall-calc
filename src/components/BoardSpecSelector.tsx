/**
 * Каскадный селектор спецификации листового материала (BoardSpec).
 *
 * Для ГКЛ показываются 4 дропдауна: материал → подтип → толщина → длина.
 * Для ГВЛ: материал → толщина → длина.
 * Для Сапфир/Аквамарин: только материал (толщина и длина фиксированы).
 */

import type { BoardSpec, GklSubtype } from '../types'

interface Props {
  value: BoardSpec
  onChange: (spec: BoardSpec) => void
}

const GKL_SUBTYPES: { value: GklSubtype; label: string }[] = [
  { value: 'standard',      label: 'Обычный' },
  { value: 'moisture',      label: 'Влагостойкий (В)' },
  { value: 'fire',          label: 'Огнестойкий (О)' },
  { value: 'moisture_fire', label: 'Влаго+Огне (ВО)' },
]

const GKL_THICKNESSES = [9.5, 12.5]
const GVL_THICKNESSES = [10, 12.5]
const GKL_LENGTHS     = [2500, 2700, 3000]
const GVL_LENGTHS     = [2500, 2700]

const SEL: React.CSSProperties = {
  padding: '6px 4px',
  fontSize: 13,
  flex: '1 1 90px',
  minWidth: 80,
  maxWidth: 160,
  borderRadius: 4,
  border: '1px solid #ccc',
  background: '#fff',
}

export function BoardSpecSelector({ value, onChange }: Props) {
  const m = value.material
  const isFixed = m === 'sapphire' || m === 'aquamarine'
  const thicknesses = m === 'gvl' ? GVL_THICKNESSES : GKL_THICKNESSES
  const lengths     = m === 'gvl' ? GVL_LENGTHS     : GKL_LENGTHS

  function setMaterial(mat: BoardSpec['material']) {
    if (mat === 'sapphire') {
      onChange({ material: 'sapphire', subtype: null, thickness: 12.5, sheetWidth: 1200, sheetLength: 2500 })
      return
    }
    if (mat === 'aquamarine') {
      onChange({ material: 'aquamarine', subtype: null, thickness: 12.5, sheetWidth: 1200, sheetLength: 2500 })
      return
    }
    if (mat === 'gvl') {
      const t = GVL_THICKNESSES.includes(value.thickness) ? value.thickness : 12.5
      const l = GVL_LENGTHS.includes(value.sheetLength)   ? value.sheetLength : 2500
      onChange({ material: 'gvl', subtype: null, thickness: t, sheetWidth: 1200, sheetLength: l })
      return
    }
    // gkl
    const t = GKL_THICKNESSES.includes(value.thickness)   ? value.thickness   : 12.5
    const l = GKL_LENGTHS.includes(value.sheetLength)     ? value.sheetLength : 2500
    onChange({ material: 'gkl', subtype: value.subtype ?? 'standard', thickness: t, sheetWidth: 1200, sheetLength: l })
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {/* 1. Материал — всегда */}
      <select style={SEL} value={m} onChange={e => setMaterial(e.target.value as BoardSpec['material'])}>
        <option value="gkl">ГКЛ</option>
        <option value="gvl">ГВЛ</option>
        <option value="sapphire">Сапфир</option>
        <option value="aquamarine">Аквамарин</option>
      </select>

      {/* 2. Подтип — только для ГКЛ */}
      {m === 'gkl' && (
        <select style={SEL} value={value.subtype ?? 'standard'}
          onChange={e => onChange({ ...value, subtype: e.target.value as GklSubtype })}>
          {GKL_SUBTYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      )}

      {/* 3. Толщина + 4. Длина — скрыты для Сапфир/Аквамарин */}
      {!isFixed && (
        <>
          <select style={SEL} value={value.thickness}
            onChange={e => onChange({ ...value, thickness: Number(e.target.value) })}>
            {thicknesses.map(t => (
              <option key={t} value={t}>{t} мм</option>
            ))}
          </select>

          <select style={SEL} value={value.sheetLength}
            onChange={e => onChange({ ...value, sheetLength: Number(e.target.value) })}>
            {lengths.map(l => (
              <option key={l} value={l}>{l} мм</option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}
