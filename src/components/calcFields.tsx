import { C } from './calcTheme'

export function NumField({ label, value, onChange, step = 1, suffix, min }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string; min?: number
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: C.muted }}>
      {label}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0} step={step} min={min}
          onChange={e => { const v = parseFloat(e.target.value); onChange(isNaN(v) ? 0 : v) }}
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
