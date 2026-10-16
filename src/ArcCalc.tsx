/**
 * ArcCalc.tsx — вкладка «Разметка дуги» (15.10.2026).
 *
 * Дуга большого радиуса (20+ м) не чертится циркулем. Экран раскладывает листы
 * ГКЛ вдоль/поперёк хорды, позволяет сдвигать стыки и для выбранного листа
 * показывает чертёж с сеткой 50 мм и таблицу ординат дуги (расстояния от
 * кромки листа до линии реза через заданный шаг). Расчёт — core/calcArcLayout.ts.
 * Сетка на экране — ориентир; размечать нужно по числам таблицы.
 */

import { useMemo, useState } from 'react'
import {
  arcV, calcArcLayout, geometryFromChordRadius, geometryFromChordSagitta,
  type ArcGeometry, type ArcOrientation, type ArcSheet, type ArcWhich,
} from './core/calcArcLayout'

const C = {
  bg: '#f4f5f7', panel: '#ffffff', border: '#dde1e8', accent: '#2563eb', accentLight: '#eff6ff',
  text: '#111827', muted: '#6b7280', inner: '#1d4ed8', outer: '#dc2626',
}

function NumField({ label, value, onChange, step = 1, suffix }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: C.muted }}>
      {label}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" value={value} step={step}
          onChange={e => { const v = parseFloat(e.target.value); onChange(isNaN(v) ? 0 : v) }}
          style={{ width: '100%', padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box' }} />
        {suffix && <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{suffix}</span>}
      </div>
    </label>
  )
}

function Toggle<T extends string>({ value, options, onChange }: {
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

const btn: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer',
}

function SheetDrawing({ sheet, geom, show }: { sheet: ArcSheet; geom: ArcGeometry; show: 'inner' | 'outer' | 'both' }) {
  const { w, h } = sheet
  const fs = Math.max(w, h) / 55
  const pad = fs * 3
  const arcs: ArcWhich[] = show === 'both' ? ['inner', 'outer'] : [show]
  const y = (v: number) => h - v
  const lines: React.ReactNode[] = []
  for (let u = 0; u <= w + 1e-6; u += 50) {
    const major = u % 250 === 0
    lines.push(<line key={'u' + u} x1={u} y1={0} x2={u} y2={h} stroke={major ? '#9ca3af' : '#e5e7eb'} strokeWidth={major ? fs / 18 : fs / 40} />)
  }
  for (let v = 0; v <= h + 1e-6; v += 50) {
    const major = v % 250 === 0
    lines.push(<line key={'v' + v} x1={0} y1={y(v)} x2={w} y2={y(v)} stroke={major ? '#9ca3af' : '#e5e7eb'} strokeWidth={major ? fs / 18 : fs / 40} />)
  }
  // Линия дуги для листа (по 10 мм), обрезанная по листу
  const curve = (which: ArcWhich) => {
    const pts: string[] = []
    for (let du = 0; du <= w + 1e-6; du += 10) {
      const dv = arcV(geom, which, sheet.u0 + du) - sheet.v0
      pts.push(`${du},${y(Math.min(Math.max(dv, 0), h))}`)
    }
    return pts.join(' ')
  }
  const keep = (which: ArcWhich) => `0,${y(0)} ${curve(which)} ${w},${y(0)}`
  return (
    <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} style={{ width: '100%', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8 }}>
      {arcs.includes('outer') && <polygon points={keep('outer')} fill="rgba(220,38,38,0.07)" />}
      {arcs.includes('inner') && <polygon points={keep('inner')} fill="rgba(37,99,235,0.12)" />}
      {lines}
      <rect x={0} y={0} width={w} height={h} fill="none" stroke="#111827" strokeWidth={fs / 12} />
      {arcs.map(which => {
        const cut = sheet[which]
        const col = which === 'inner' ? C.inner : C.outer
        return (
          <g key={which}>
            <polyline points={curve(which)} fill="none" stroke={col} strokeWidth={fs / 10} />
            {cut.marks.map((m, i) => (
              <g key={i}>
                <circle cx={m.du} cy={y(m.dv)} r={fs / 6} fill={col} />
                {(m.du % 250 === 0 || i === cut.marks.length - 1) && (
                  <text x={m.du} y={y(m.dv) + (which === 'inner' ? fs * 1.4 : -fs * 0.6)} fontSize={fs} textAnchor="middle" fill={col} fontWeight={600}>
                    {m.dv}
                  </text>
                )}
              </g>
            ))}
          </g>
        )
      })}
      <text x={w / 2} y={h + pad * 0.75} fontSize={fs} textAnchor="middle" fill={C.muted}>
        низ листа — со стороны хорды · клетка 50 мм (жирная — 250 мм) · {w}×{h} мм
      </text>
    </svg>
  )
}

export default function ArcCalc() {
  const [mode, setMode] = useState<'sagitta' | 'radius'>('sagitta')
  const [chord, setChord] = useState(20800)
  const [sagitta, setSagitta] = useState(1900)
  const [radius, setRadius] = useState(29413)
  const [band, setBand] = useState(200)
  const [sheetW, setSheetW] = useState(1200)
  const [sheetL, setSheetL] = useState(2500)
  const [orientation, setOrientation] = useState<ArcOrientation>('across')
  const [shiftU, setShiftU] = useState(0)
  const [shiftV, setShiftV] = useState(0)
  const [stagger, setStagger] = useState(0)
  const [step, setStep] = useState(50)
  const [show, setShow] = useState<'inner' | 'outer' | 'both'>('both')
  const [selected, setSelected] = useState(1)
  const [copied, setCopied] = useState(false)

  const error = useMemo(() => {
    if (!(chord > 0)) return 'Хорда должна быть больше 0'
    if (mode === 'sagitta' && !(sagitta > 0 && sagitta <= chord / 2)) return 'Стрела должна быть от 0 до половины хорды'
    if (mode === 'radius' && !(radius >= chord / 2)) return 'Радиус не может быть меньше половины хорды'
    if (!(sheetW > 0 && sheetL > 0)) return 'Размер листа должен быть больше 0'
    if (!(step >= 5)) return 'Шаг разметки не меньше 5 мм'
    return null
  }, [mode, chord, sagitta, radius, sheetW, sheetL, step])

  const geom = useMemo(() => {
    if (error) return null
    return mode === 'sagitta' ? geometryFromChordSagitta(chord, sagitta, band) : geometryFromChordRadius(chord, radius, band)
  }, [error, mode, chord, sagitta, radius, band])

  const layout = useMemo(() => {
    if (!geom) return null
    return calcArcLayout({ geometry: geom, sheetWidth: sheetW, sheetLength: sheetL, orientation, shiftU, shiftV, stagger, step })
  }, [geom, sheetW, sheetL, orientation, shiftU, shiftV, stagger, step])

  const sheets = layout?.sheets ?? []
  const sel = sheets.find(s => s.id === selected) ?? sheets[0]
  const selIdx = sel ? sheets.indexOf(sel) : -1
  const a = orientation === 'across' ? sheetW : sheetL

  const stats = (which: ArcWhich) => {
    const list = sheets.filter(s => s[which].status !== 'none')
    return { total: list.length, cut: list.filter(s => s[which].status === 'cut').length }
  }

  const copyTable = () => {
    if (!sel) return
    const rows = ['от кромки, мм\tвнутр. дуга, мм\tнаруж. дуга, мм']
    sel.inner.marks.forEach((m, i) => rows.push(`${m.du}\t${m.dv}\t${sel.outer.marks[i]?.dv ?? ''}`))
    navigator.clipboard?.writeText(rows.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => { /* буфер недоступен */ })
  }

  const moveBtns = (val: number, set: (v: number) => void) => (
    <div style={{ display: 'flex', gap: 4 }}>
      <button style={btn} onClick={() => set(val - 50)}>−50</button>
      <button style={btn} onClick={() => set(val + 50)}>+50</button>
    </div>
  )

  return (
    <div style={{ display: 'flex', gap: 20, padding: 20, background: C.bg, minHeight: '100%', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* ── Форма ── */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, width: 320, flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, color: C.text }}>📐 Разметка дуги</div>

        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Дуга (по плану)</div>
        <Toggle value={mode} onChange={setMode} options={[['sagitta', 'Хорда + стрела'], ['radius', 'Хорда + радиус']]} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 0 6px' }}>
          <NumField label="Хорда" suffix="мм" value={chord} step={10} onChange={setChord} />
          {mode === 'sagitta'
            ? <NumField label="Стрела" suffix="мм" value={sagitta} step={10} onChange={setSagitta} />
            : <NumField label="Радиус" suffix="мм" value={radius} step={10} onChange={setRadius} />}
          <NumField label="Полоса (до наружной дуги)" suffix="мм" value={band} step={10} onChange={setBand} />
        </div>
        {geom && (
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
            R внутр. = {geom.radiusInner.toFixed(0)} мм · R наруж. = {geom.radiusOuter.toFixed(0)} мм · стрела = {geom.sagitta.toFixed(0)} мм
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Лист</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <NumField label="Ширина" suffix="мм" value={sheetW} step={10} onChange={setSheetW} />
          <NumField label="Длина" suffix="мм" value={sheetL} step={10} onChange={setSheetL} />
        </div>
        <Toggle value={orientation} onChange={v => { setOrientation(v); if (v === 'across') setStagger(0) }}
          options={[['across', 'Поперёк хорды'], ['along', 'Вдоль хорды']]} />

        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '14px 0 6px' }}>Сдвиг раскладки</div>
        <NumField label="По хорде (вправо)" suffix="мм" value={shiftU} step={50} onChange={setShiftU} />
        <div style={{ margin: '4px 0 8px' }}>{moveBtns(shiftU, setShiftU)}</div>
        <NumField label="От хорды (вверх)" suffix="мм" value={shiftV} step={50} onChange={setShiftV} />
        <div style={{ margin: '4px 0 8px' }}>{moveBtns(shiftV, setShiftV)}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <button style={btn} onClick={() => setShiftU(((chord / 2) % a + a) % a)}>Стык в центре дуги</button>
          <button style={btn} onClick={() => setShiftU((((chord / 2 - a / 2) % a) + a) % a)}>Лист в центре дуги</button>
          <button style={btn} onClick={() => { setShiftU(0); setShiftV(0) }}>Сброс</button>
        </div>
        {orientation === 'along' && (
          <>
            <NumField label="Смещение рядов вразбежку" suffix="мм" value={stagger} step={50} onChange={setStagger} />
            <div style={{ display: 'flex', gap: 6, margin: '4px 0 8px' }}>
              {[0, 600, 1250].map(v => <button key={v} style={btn} onClick={() => setStagger(v)}>{v}</button>)}
            </div>
          </>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, margin: '10px 0 6px' }}>Разметка</div>
        <NumField label="Шаг отметок вдоль кромки" suffix="мм" value={step} step={25} onChange={setStep} />
        {error && <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', color: '#b91c1c', borderRadius: 6, fontSize: 12.5 }}>{error}</div>}
      </div>

      {/* ── Результат ── */}
      <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {layout && geom && sheets.length > 0 && (
          <>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 13, color: C.text, marginBottom: 8 }}>
                Под внутреннюю дугу: <b>{stats('inner').total}</b> листов (резать <b>{stats('inner').cut}</b>) · под наружную: <b>{stats('outer').total}</b> (резать <b>{stats('outer').cut}</b>).
                Нажмите на лист на схеме.
              </div>
              <OverviewSvg sheets={sheets} geom={geom} selectedId={sel?.id} onSelect={setSelected} layout={layout} />
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                Голубой — лист целиком под внутренней дугой, оранжевый — дуга режет лист, серый — только наружная дуга.
              </div>
            </div>

            {sel && (
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <button style={btn} disabled={selIdx <= 0} onClick={() => setSelected(sheets[selIdx - 1].id)}>◀</button>
                  <b style={{ fontSize: 14 }}>Лист №{sel.id}</b>
                  <button style={btn} disabled={selIdx >= sheets.length - 1} onClick={() => setSelected(sheets[selIdx + 1].id)}>▶</button>
                  <span style={{ fontSize: 12, color: C.muted }}>
                    ряд {sel.row + 1}, {sel.w}×{sel.h} мм{sel.clippedByChord ? ' (обрезан по хорде)' : ''}, u = {Math.round(sel.u0)}…{Math.round(sel.u1)} от левого конца хорды
                  </span>
                  <div style={{ marginLeft: 'auto', width: 230 }}>
                    <Toggle value={show} onChange={setShow} options={[['inner', 'Внутр.'], ['outer', 'Наруж.'], ['both', 'Обе']]} />
                  </div>
                </div>
                <SheetDrawing sheet={sel} geom={geom} show={show} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 6px' }}>
                  <b style={{ fontSize: 13 }}>Ординаты дуги, мм</b>
                  <button style={btn} onClick={copyTable}>{copied ? '✓ Скопировано' : 'Копировать'}</button>
                </div>
                <CutTable sheet={sel} />
              </div>
            )}
          </>
        )}
        {layout && sheets.length === 0 && !error && <div style={{ color: C.muted }}>Нет листов для такой раскладки.</div>}
      </div>
    </div>
  )
}

function CutTable({ sheet }: { sheet: ArcSheet }) {
  const note = (which: 'inner' | 'outer') => {
    const s = sheet[which].status
    return s === 'full' ? 'лист целиком под дугой, резать не надо' : s === 'none' ? 'лист за дугой, для неё не нужен' : null
  }
  const n1 = note('inner'); const n2 = note('outer')
  const rows = sheet.outer.marks.length ? sheet.outer.marks : sheet.inner.marks
  return (
    <div style={{ maxHeight: 360, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
      {(n1 || n2) && (
        <div style={{ padding: 8, fontSize: 12, color: C.muted }}>
          {n1 && <div>Внутренняя дуга: {n1}.</div>}
          {n2 && <div>Наружная дуга: {n2}.</div>}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
            <th style={th}>От левой кромки</th>
            <th style={{ ...th, color: C.inner }}>Внутр. дуга</th>
            <th style={{ ...th, color: C.outer }}>Наруж. дуга</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => {
            const mi = sheet.inner.marks[i]; const mo = sheet.outer.marks[i]
            const major = m.du % 250 === 0
            return (
              <tr key={i} style={{ background: major ? '#f3f4f6' : '#fff', fontWeight: major ? 600 : 400 }}>
                <td style={td}>{m.du}</td>
                <td style={{ ...td, color: C.inner }}>{mi ? cell(mi) : '—'}</td>
                <td style={{ ...td, color: C.outer }}>{mo ? cell(mo) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', fontSize: 12, borderBottom: `1px solid ${C.border}` }
const td: React.CSSProperties = { padding: '4px 10px', borderBottom: '1px solid #f0f1f3' }
const cell = (m: { dv: number; clipped: 'top' | 'bottom' | null }) =>
  m.clipped === 'top' ? `${m.dv} (край листа)` : m.clipped === 'bottom' ? '0 (ниже хорды)' : String(m.dv)

function OverviewSvg({ sheets, geom, selectedId, onSelect, layout }: {
  sheets: ArcSheet[]; geom: ArcGeometry; selectedId?: number
  onSelect: (id: number) => void; layout: ReturnType<typeof calcArcLayout>
}) {
  const uMin = Math.min(...sheets.map(s => s.u0), 0) - 300
  const uMax = Math.max(...sheets.map(s => s.u1), geom.chord) + 300
  const vMax = Math.max(layout.vTop, ...sheets.map(s => s.v1)) + 300
  const vMin = -300
  const Y = (v: number) => vMax - v
  const curve = (which: ArcWhich) => {
    const half = which === 'inner' ? layout.halfInner : layout.halfOuter
    const pts: string[] = []
    const from = geom.chord / 2 - half; const to = geom.chord / 2 + half
    for (let u = from; u <= to; u += Math.max((to - from) / 400, 1)) pts.push(`${u},${Y(arcV(geom, which, u))}`)
    pts.push(`${to},${Y(arcV(geom, which, to))}`)
    return pts.join(' ')
  }
  const fs = 260
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`${uMin} 0 ${uMax - uMin} ${vMax - vMin}`} style={{ width: '100%', minWidth: 900, display: 'block' }}>
        {sheets.map(s => {
          const st = s.inner.status
          const fill = st === 'full' ? 'rgba(96,165,250,0.35)' : st === 'cut' ? 'rgba(251,146,60,0.45)' : 'rgba(156,163,175,0.25)'
          return (
            <g key={s.id} onClick={() => onSelect(s.id)} style={{ cursor: 'pointer' }}>
              <rect x={s.u0} y={Y(s.v1)} width={s.w} height={s.h} fill={fill}
                stroke={s.id === selectedId ? '#111827' : '#6b7280'} strokeWidth={s.id === selectedId ? 40 : 12} />
              <text x={(s.u0 + s.u1) / 2} y={Y((s.v0 + s.v1) / 2) + fs / 3} fontSize={fs} textAnchor="middle" fill="#111827" pointerEvents="none">{s.id}</text>
            </g>
          )
        })}
        <line x1={0} y1={Y(0)} x2={geom.chord} y2={Y(0)} stroke="#111827" strokeWidth={18} strokeDasharray="120 60" />
        <polyline points={curve('inner')} fill="none" stroke={C.inner} strokeWidth={24} />
        <polyline points={curve('outer')} fill="none" stroke={C.outer} strokeWidth={24} />
      </svg>
    </div>
  )
}
