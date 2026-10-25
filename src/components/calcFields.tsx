import { useState } from 'react'
import { C } from './calcTheme'
import { numToText, parseNumText, stripLeadingZeros } from '../core/numInput'

export function NumField({ label, value, onChange, step = 1, suffix, min }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string; min?: number
}) {
  // Текст хранится отдельно, чтобы можно было набирать «-», «1.» и не терять ввод; ведущие нули убираются.
  const [txt, setTxt] = useState(() => numToText(value))
  // Значение изменили снаружи (не вводом) — обновляем текст; при совпадении числа оставляем набранное.
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setTxt(cur => (parseNumText(cur) === parseNumText(numToText(value)) ? cur : numToText(value)))
  }
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: C.muted }}>
      {label}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" value={txt} step={step} min={min}
          onChange={e => { const t = stripLeadingZeros(e.target.value); setTxt(t); onChange(parseNumText(t)) }}
          style={{ width: '100%', padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box' }} />
        {suffix && <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{suffix}</span>}
      </div>
    </label>
  )
}

export function Toggle<T extends string>({ value, options, onChange }: {
  value: T; options: [T, string][]; onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} style={{
          flex: 1, padding: '7px 8px', fontSize: 12.5, borderRadius: 6, cursor: 'pointer',
          border: value === v ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
          background: value === v ? C.accentLight : '#fff', color: value === v ? C.accent : C.text,
          fontWeight: value === v ? 600 : 400,
        }}>{label}</button>
      ))}
    </div>
  )
}
