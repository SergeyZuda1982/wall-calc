import type React from 'react'

/** Общие цвета и стили калькуляторов-вкладок (ContourCalc). */
export const C = {
  bg: '#f4f5f7', panel: '#ffffff', border: '#dde1e8', accent: '#2563eb', accentLight: '#eff6ff',
  text: '#111827', muted: '#6b7280', danger: '#b91c1c', ok: '#059669', warn: '#d97706',
}

export const btn: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer',
}

export const card: React.CSSProperties = {
  background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14,
}
