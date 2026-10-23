import { useRef, useState } from 'react'
import { C, btn } from './calcTheme'
import { calcFileName, parseCalcFile, wrapCalcFile, type CalcKind } from '../core/calcFile'

/** Кнопки «Сохранить в файл» / «Открыть из файла» для расчётов-вкладок. */
export default function CalcFileButtons({ kind, getData, onLoad }: {
  kind: CalcKind
  getData: () => unknown
  onLoad: (data: unknown) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const save = () => {
    try {
      const blob = new Blob([wrapCalcFile(kind, getData())], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = calcFileName(kind)
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMsg({ text: 'Файл сохранён (папка «Загрузки»)', ok: true })
    } catch { setMsg({ text: 'Не удалось сохранить файл', ok: false }) }
  }
  const open = async (f: File | undefined) => {
    if (!f) return
    try {
      onLoad(parseCalcFile(await f.text(), kind))
      setMsg({ text: `Открыт: ${f.name}`, ok: true })
    } catch (e) { setMsg({ text: (e as Error).message, ok: false }) }
    if (input.current) input.current.value = ''
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <button style={btn} onClick={save} title="Скачать расчёт файлом .json">💾 Сохранить в файл</button>
      <button style={btn} onClick={() => input.current?.click()} title="Загрузить ранее сохранённый расчёт">📂 Открыть из файла</button>
      <input ref={input} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => void open(e.target.files?.[0])} />
      {msg && <span style={{ fontSize: 12, color: msg.ok ? C.ok : C.danger }}>{msg.text}</span>}
    </div>
  )
}
