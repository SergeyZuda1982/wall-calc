import { useState } from 'react'
import { C, btn } from './calcTheme'
import type { Report } from '../core/calcReport'

export type ExportScope = 'all' | 'selected'

/** Экспорт расчёта в Excel или PDF по выбору пользователя. */
export default function ExportMenu({ build, selectedLabel, disabled }: {
  build: (scope: ExportScope) => Report
  /** Подпись выбранного листа, например «Лист №3»; null — листа не выбрано. */
  selectedLabel: string | null
  disabled?: boolean
}) {
  const [scope, setScope] = useState<ExportScope>('all')
  const [busy, setBusy] = useState<'' | 'xlsx' | 'pdf'>('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const eff: ExportScope = selectedLabel ? scope : 'all'

  const run = async (kind: 'xlsx' | 'pdf') => {
    setBusy(kind); setMsg(null)
    try {
      const report = build(eff)
      if (kind === 'xlsx') (await import('../export/exportXlsx')).exportXlsx(report).then(() => setMsg({ text: 'Excel сохранён (папка «Загрузки»)', ok: true }))
        .catch(() => setMsg({ text: 'Не удалось создать Excel', ok: false })).finally(() => setBusy(''))
      else (await import('../export/exportPdf')).exportPdf(report).then(() => setMsg({ text: 'PDF сохранён (папка «Загрузки»)', ok: true }))
        .catch(() => setMsg({ text: 'Не удалось создать PDF', ok: false })).finally(() => setBusy(''))
    } catch { setMsg({ text: 'Не удалось подготовить экспорт', ok: false }); setBusy('') }
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <b style={{ fontSize: 13 }}>Экспорт:</b>
      <button style={btn} disabled={disabled || !!busy} onClick={() => void run('xlsx')}>{busy === 'xlsx' ? '… Excel' : '📊 Excel (.xlsx)'}</button>
      <button style={btn} disabled={disabled || !!busy} onClick={() => void run('pdf')}>{busy === 'pdf' ? '… PDF' : '📄 PDF'}</button>
      {selectedLabel && (
        <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={scope} onChange={e => setScope(e.target.value as ExportScope)} style={{ fontSize: 12.5, padding: '4px 6px' }}>
            <option value="all">все листы</option>
            <option value="selected">только {selectedLabel}</option>
          </select>
        </label>
      )}
      {msg && <span style={{ fontSize: 12, color: msg.ok ? C.ok : C.danger }}>{msg.text}</span>}
    </div>
  )
}
