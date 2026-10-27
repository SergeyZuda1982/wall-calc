/**
 * ArcCalc.tsx — вкладка «Разметка дуги» (15.10.2026).
 *
 * Дуга большого радиуса (20+ м) не чертится циркулем. Экран раскладывает листы
 * ГКЛ вдоль/поперёк хорды, позволяет сдвигать стыки и для выбранного листа
 * показывает чертёж с сеткой 50 мм и таблицу ординат дуги (расстояния от
 * кромки листа до линии реза через заданный шаг). Расчёт — core/calcArcLayout.ts.
 *
 * По умолчанию одна дуга; дополнительные концентрические дуги (до 4 всего)
 * добавляются кнопкой, у каждой — расстояние от предыдущей дуги.
 * Сетка на экране — ориентир; размечать нужно по числам таблицы.
 */

import { useEffect, useMemo, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CalcFileButtons from './components/CalcFileButtons'
import { NumField } from './components/calcFields'
import ExportMenu, { type ExportScope } from './components/ExportMenu'
import { buildArcReport } from './core/arcReport'
import { pickNum, pickOneOf } from './core/calcFile'
import { calcInclined, inclinedEdgeTable, validateInclined } from './core/calcInclinedArc'
import {
  arcRadius, arcV, bandGeometry, calcArcLayout, geometryFromChordRadius, geometryFromChordSagitta,
  type ArcGeometry, type ArcOrientation, type ArcSheet,
  labelIndices,
  ordinateOffsets,
  type OffsetFrom,
} from './core/calcArcLayout'

const C = {
  bg: '#f4f5f7', panel: '#ffffff', border: '#dde1e8', accent: '#2563eb', accentLight: '#eff6ff',
  text: '#111827', muted: '#6b7280',
}
/** Цвета дуг 1…4. */
const ARC_COLORS = ['#1d4ed8', '#dc2626', '#059669', '#d97706']
const MAX_ARCS = 4
const DEFAULT_GAP = 200


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

function SheetDrawing({ sheet, geom, shown, labelStep }: { sheet: ArcSheet; geom: ArcGeometry; shown: number[]; labelStep: number }) {
  const { w, h } = sheet
  const fs = Math.max(w, h) / 55
  const pad = fs * 3
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
  const curvePts = (arc: number) => {
    const pts: string[] = []
    for (let du = 0; du <= w + 1e-6; du += 10) {
      const dv = arcV(geom, arc, sheet.u0 + du) - sheet.v0
      pts.push(`${du},${y(Math.min(Math.max(dv, 0), h))}`)
    }
    return pts
  }
  const curve = (arc: number) => curvePts(arc).join(' ')
  const keep = (arc: number) => `0,${y(0)} ${curve(arc)} ${w},${y(0)}`
  // Наклонная поверхность: закрашена полоса между верхней и нижней кромкой.
  const bandPoly = geom.band ? [...curvePts(1), ...curvePts(0).reverse()].join(' ') : null
  return (
    <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} style={{ width: '100%', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8 }}>
      {bandPoly
        ? <polygon points={bandPoly} fill={ARC_COLORS[1]} fillOpacity={0.1} />
        : [...shown].reverse().map(k => (
          <polygon key={'k' + k} points={keep(k)} fill={ARC_COLORS[k]} fillOpacity={0.09} />
        ))}
      {lines}
      <rect x={0} y={0} width={w} height={h} fill="none" stroke="#111827" strokeWidth={fs / 12} />
      {shown.map(k => {
        const cut = sheet.cuts[k]
        const col = ARC_COLORS[k]
        const labeled = labelIndices(cut.marks.map(m => m.du), labelStep)
        return (
          <g key={k}>
            <polyline points={curve(k)} fill="none" stroke={col} strokeWidth={fs / 10} />
            {cut.marks.map((m, i) => (
              <g key={i}>
                <circle cx={m.du} cy={y(m.dv)} r={fs / 6} fill={col} />
                {labeled.has(i) && (
                  <text x={m.du} y={y(m.dv) + (k % 2 === 0 ? fs * 1.4 : -fs * 0.6)} fontSize={fs} textAnchor="middle" fill={col} fontWeight={600}>
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

const ARC_STORAGE_KEY = 'wallcalc.arc.v1'
interface ArcSaved {
  mode: 'sagitta' | 'radius'; chord: number; sagitta: number; radius: number; gaps: number[]; hidden: number[]
  sheetW: number; sheetL: number; orientation: ArcOrientation; shiftU: number; shiftV: number; stagger: number
  step: number; labelStep: number; selected: number; offFrom: OffsetFrom
  /** Наклонная поверхность: опуск между кромками и смещение по горизонтали, мм. */
  incl: boolean; dropH: number; offsetH: number
  /** Просадка нижней кромки у краёв, мм (неровный потолок). */
  droopE: number
}
const ARC_DEFAULT: ArcSaved = {
  mode: 'sagitta', chord: 20800, sagitta: 1900, radius: 29413, gaps: [], hidden: [], sheetW: 1200, sheetL: 2500,
  orientation: 'across', shiftU: 0, shiftV: 0, stagger: 0, step: 50, labelStep: 250, selected: 1, offFrom: 'top',
  incl: false, dropH: 1200, offsetH: 2250, droopE: 0,
}
const numList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [])
/** Приводит произвольные данные (localStorage / файл) к безопасному состоянию вкладки. */
// eslint-disable-next-line react-refresh/only-export-components
export function sanitizeArcSaved(d: unknown): ArcSaved {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  const D = ARC_DEFAULT
  const gaps = numList(o.gaps).slice(0, 3)
  return {
    mode: pickOneOf(o.mode, ['sagitta', 'radius'] as const, D.mode),
    chord: pickNum(o.chord, D.chord), sagitta: pickNum(o.sagitta, D.sagitta), radius: pickNum(o.radius, D.radius),
    gaps, hidden: numList(o.hidden).filter(k => k >= 0 && k <= gaps.length),
    sheetW: pickNum(o.sheetW, D.sheetW), sheetL: pickNum(o.sheetL, D.sheetL),
    orientation: pickOneOf(o.orientation, ['across', 'along'] as const, D.orientation) as ArcOrientation,
    shiftU: pickNum(o.shiftU, 0), shiftV: pickNum(o.shiftV, 0), stagger: pickNum(o.stagger, 0),
    step: pickNum(o.step, D.step), labelStep: pickNum(o.labelStep, D.labelStep),
    selected: pickNum(o.selected, 1), offFrom: pickOneOf(o.offFrom, ['top', 'bottom'] as const, D.offFrom) as OffsetFrom,
    incl: o.incl === true, dropH: pickNum(o.dropH, D.dropH), offsetH: pickNum(o.offsetH, D.offsetH),
    droopE: pickNum(o.droopE, 0),
  }
}
function loadArcSaved(): ArcSaved {
  try {
    if (typeof window === 'undefined') return ARC_DEFAULT
    const raw = window.localStorage.getItem(ARC_STORAGE_KEY)
    return raw ? sanitizeArcSaved(JSON.parse(raw)) : ARC_DEFAULT
  } catch { return ARC_DEFAULT }
}

export default function ArcCalc() {
  const [init] = useState(loadArcSaved)
  const [mode, setMode] = useState<'sagitta' | 'radius'>(init.mode)
  const [chord, setChord] = useState(init.chord)
  const [sagitta, setSagitta] = useState(init.sagitta)
  const [radius, setRadius] = useState(init.radius)
  /** Дополнительные дуги: расстояние каждой от предыдущей, мм. Пусто — только первая дуга. */
  const [gaps, setGaps] = useState<number[]>(init.gaps)
  const [hidden, setHidden] = useState<number[]>(init.hidden)
  const [sheetW, setSheetW] = useState(init.sheetW)
  const [sheetL, setSheetL] = useState(init.sheetL)
  const [orientation, setOrientation] = useState<ArcOrientation>(init.orientation)
  const [shiftU, setShiftU] = useState(init.shiftU)
  const [shiftV, setShiftV] = useState(init.shiftV)
  const [stagger, setStagger] = useState(init.stagger)
  const [step, setStep] = useState(init.step)
  const [labelStep, setLabelStep] = useState(init.labelStep)
  const [selected, setSelected] = useState(init.selected)
  const [copied, setCopied] = useState(false)
  const [offFrom, setOffFrom] = useState<OffsetFrom>(init.offFrom)
  const [incl, setIncl] = useState(init.incl)
  const [dropH, setDropH] = useState(init.dropH)
  const [offsetH, setOffsetH] = useState(init.offsetH)
  const [droopE, setDroopE] = useState(init.droopE)
  const [edgeStep, setEdgeStep] = useState(500)
  const [edgeCopied, setEdgeCopied] = useState(false)

  const snapshot = (): ArcSaved => ({
    mode, chord, sagitta, radius, gaps, hidden, sheetW, sheetL, orientation, shiftU, shiftV, stagger, step, labelStep, selected, offFrom,
    incl, dropH, offsetH, droopE,
  })
  useEffect(() => {
    try { window.localStorage.setItem(ARC_STORAGE_KEY, JSON.stringify(snapshot())) } catch { /* хранилище недоступно */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, chord, sagitta, radius, gaps, hidden, sheetW, sheetL, orientation, shiftU, shiftV, stagger, step, labelStep, selected, offFrom, incl, dropH, offsetH, droopE])
  const applySaved = (d: unknown) => {
    const v = sanitizeArcSaved(d)
    setMode(v.mode); setChord(v.chord); setSagitta(v.sagitta); setRadius(v.radius); setGaps(v.gaps); setHidden(v.hidden)
    setSheetW(v.sheetW); setSheetL(v.sheetL); setOrientation(v.orientation); setShiftU(v.shiftU); setShiftV(v.shiftV)
    setStagger(v.stagger); setStep(v.step); setLabelStep(v.labelStep); setSelected(v.selected); setOffFrom(v.offFrom)
    setIncl(v.incl); setDropH(v.dropH); setOffsetH(v.offsetH); setDroopE(v.droopE)
  }

  const error = useMemo(() => {
    if (!(chord > 0)) return 'Хорда должна быть больше 0'
    if (mode === 'sagitta' && !(sagitta > 0 && sagitta <= chord / 2)) return 'Стрела должна быть от 0 до половины хорды'
    if (mode === 'radius' && !(radius >= chord / 2)) return 'Радиус не может быть меньше половины хорды'
    if (!incl && gaps.some(g => !(g > 0))) return 'Расстояние между дугами должно быть больше 0'
    if (!(sheetW > 0 && sheetL > 0)) return 'Размер листа должен быть больше 0'
    if (!(step >= 5)) return 'Шаг разметки не меньше 5 мм'
    if (!(labelStep >= step)) return 'Шаг подписей не меньше шага отметок'
    if (incl) {
      const sg = mode === 'sagitta' ? sagitta : radius - Math.sqrt(Math.max(radius * radius - (chord / 2) ** 2, 0))
      return validateInclined({ chord, sagitta: sg, drop: dropH, shift: offsetH, edgeDroop: droopE })
    }
    return null
  }, [mode, chord, sagitta, radius, gaps, sheetW, sheetL, step, labelStep, incl, dropH, offsetH, droopE])

  /** Дуга в плане → параметры наклонной поверхности (стрела берётся из радиуса, если задан он). */
  const inclInput = useMemo(() => {
    if (!incl || error) return null
    const sg = mode === 'sagitta' ? sagitta : radius - Math.sqrt(Math.max(radius * radius - (chord / 2) ** 2, 0))
    return { chord, sagitta: sg, drop: dropH, shift: offsetH, edgeDroop: droopE }
  }, [incl, error, mode, chord, sagitta, radius, dropH, offsetH, droopE])
  const inc = useMemo(() => (inclInput ? calcInclined(inclInput) : null), [inclInput])

  const geom = useMemo(() => {
    if (error) return null
    // Наклон: работаем в развёртке — верхняя кромка, нижняя = та же дуга, сдвинутая на длину стойки.
    if (inc) return bandGeometry(geometryFromChordSagitta(inc.devChord, inc.devSagitta), inc.rulingLength, inc.droopAlong)
    const offsets = [0]
    for (const g of gaps) offsets.push(offsets[offsets.length - 1] + g)
    return mode === 'sagitta' ? geometryFromChordSagitta(chord, sagitta, offsets) : geometryFromChordRadius(chord, radius, offsets)
  }, [error, mode, chord, sagitta, radius, gaps, inc])

  const layout = useMemo(() => {
    if (!geom) return null
    return calcArcLayout({ geometry: geom, sheetWidth: sheetW, sheetLength: sheetL, orientation, shiftU, shiftV, stagger, step })
  }, [geom, sheetW, sheetL, orientation, shiftU, shiftV, stagger, step])

  const arcCount = incl && inc ? 2 : gaps.length + 1
  const arcName = (k: number) => (incl && inc ? (k === 0 ? 'Верхняя кромка' : 'Нижняя кромка') : `Дуга ${k + 1}`)
  const chordU = geom ? geom.chord : chord
  const shown = useMemo(
    () => Array.from({ length: arcCount }, (_, k) => k).filter(k => !hidden.includes(k)),
    [arcCount, hidden],
  )
  const sheets = layout?.sheets ?? []
  const sel = sheets.find(s => s.id === selected) ?? sheets[0]
  const selIdx = sel ? sheets.indexOf(sel) : -1
  const a = orientation === 'across' ? sheetW : sheetL

  const stats = (k: number) => {
    const list = sheets.filter(s => s.cuts[k]?.status !== 'none')
    return { total: list.length, cut: list.filter(s => s.cuts[k]?.status === 'cut').length }
  }

  const addArc = () => setGaps(g => (g.length + 1 < MAX_ARCS ? [...g, DEFAULT_GAP] : g))
  const removeArc = (i: number) => {
    setGaps(g => g.filter((_, idx) => idx !== i))
    setHidden([])
  }

  const copyTable = () => {
    if (!sel) return
    const offs = shown.map(k => ordinateOffsets(sel.cuts[k].marks.map(m => (m.clipped ? null : m.dv)), offFrom).offsets)
    const head = ['от кромки, мм', ...shown.flatMap(k => [`дуга ${k + 1}, мм`, `дуга ${k + 1}: от ${offFrom === 'top' ? 'верхней' : 'нижней'} линии, мм`])]
    const ref = sel.cuts.find(c => c.marks.length) ?? sel.cuts[0]
    const rows = [head.join('\t')]
    ref.marks.forEach((m, i) => rows.push([m.du, ...shown.flatMap((k, j) => [sel.cuts[k].marks[i]?.dv ?? '', offs[j][i] ?? ''])].join('\t')))
    navigator.clipboard?.writeText(rows.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => { /* буфер недоступен */ })
  }

  const buildReport = (scope: ExportScope) => {
    if (!geom || !layout) throw new Error('нет раскладки')
    return buildArcReport({
      geom, sheets, shown, labelStep, offFrom, orientation, sheetW, sheetL, shiftU, shiftV, stagger, step,
      sheetIds: scope === 'selected' && sel ? [sel.id] : 'all',
      drawing: sh => renderToStaticMarkup(<SheetDrawing sheet={sh} geom={geom} shown={shown} labelStep={labelStep} />),
      overview: () => renderToStaticMarkup(<OverviewSvg sheets={sheets} geom={geom} onSelect={() => undefined} layout={layout} />),
    })
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
        <div style={{ marginBottom: 12 }}><CalcFileButtons kind="arc" getData={snapshot} onLoad={applySaved} /></div>

        <div style={{ fontSize: 12, fontWeight: 600, color: ARC_COLORS[0], marginBottom: 6 }}>Дуга 1 (по плану)</div>
        <Toggle value={mode} onChange={setMode} options={[['sagitta', 'Хорда + стрела'], ['radius', 'Хорда + радиус']]} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 0 6px' }}>
          <NumField label="Хорда" suffix="мм" value={chord} step={10} onChange={setChord} />
          {mode === 'sagitta'
            ? <NumField label="Стрела" suffix="мм" value={sagitta} step={10} onChange={setSagitta} />
            : <NumField label="Радиус" suffix="мм" value={radius} step={10} onChange={setRadius} />}
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '10px 0 6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={incl} onChange={e => setIncl(e.target.checked)} />
          <b>Наклонная поверхность</b>
        </label>
        {incl && (
          <div style={{ background: C.accentLight, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>
              Нижняя кромка — такая же дуга, сдвинутая вниз и вперёд. Стойки параллельны. Дуга выше задаётся в плане, разметка ведётся в развёртке.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <NumField label="Опуск по вертикали" suffix="мм" value={dropH} step={10} onChange={setDropH} />
              <NumField label="Между дугами по горизонтали" suffix="мм" value={offsetH} step={10} onChange={setOffsetH} />
            </div>
            <div style={{ marginTop: 10 }}>
              <NumField label="Просадка нижней кромки у краёв (0 — потолок в уровне)" suffix="мм" value={droopE} step={5} onChange={setDroopE} />
            </div>
            {inc && (
              <div style={{ fontSize: 12, color: C.text, marginTop: 8, lineHeight: 1.55 }}>
                <div>Стойка по наклону: <b>{inc.rulingLength.toFixed(0)} мм</b>, наклон {inc.angleDeg.toFixed(1)}°
                  {droopE > 0 && <> · у краёв <b>{inc.rulingLengthEdge.toFixed(0)} мм</b></>}</div>
                <div>План: R = {inc.planRadius.toFixed(0)} мм, длина дуги {inc.planArcLength.toFixed(0)} мм</div>
                <div>Развёртка: хорда <b>{inc.devChord.toFixed(0)} мм</b>, стрела <b>{inc.devSagitta.toFixed(0)} мм</b>, R ≈ <b>{inc.devRadius.toFixed(0)} мм</b></div>
                <div>Стрела поперёк стоек: {inc.sagittaAcross.toFixed(0)} мм</div>
                <div>Площадь одной стороны: <b>{inc.areaM2.toFixed(2)} м²</b></div>
              </div>
            )}
          </div>
        )}
        {!incl && gaps.map((gap, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', margin: '8px 0' }}>
            <div style={{ flex: 1 }}>
              <NumField label={`Дуга ${i + 2}: от дуги ${i + 1} (общий центр)`} suffix="мм" value={gap} step={10}
                onChange={v => setGaps(g => g.map((x, idx) => (idx === i ? v : x)))} />
            </div>
            <button style={{ ...btn, color: ARC_COLORS[i + 1], borderColor: ARC_COLORS[i + 1] }} title="Убрать дугу" onClick={() => removeArc(i)}>✕</button>
          </div>
        ))}
        {!incl && arcCount < MAX_ARCS && (
          <button style={{ ...btn, margin: '6px 0 4px', width: '100%' }} onClick={addArc}>+ Добавить дугу</button>
        )}
        {geom && !inc && (
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
            {geom.offsets.map((_, k) => (
              <div key={k}><span style={{ color: ARC_COLORS[k], fontWeight: 600 }}>Дуга {k + 1}</span>: R = {arcRadius(geom, k).toFixed(0)} мм{k === 0 ? `, стрела ${geom.sagitta.toFixed(0)} мм` : ''}</div>
            ))}
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
          <button style={btn} onClick={() => setShiftU(((chordU / 2) % a + a) % a)}>Стык в центре дуги</button>
          <button style={btn} onClick={() => setShiftU((((chordU / 2 - a / 2) % a) + a) % a)}>Лист в центре дуги</button>
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
        <NumField label="Шаг подписей на чертеже и жирных строк в таблице" suffix="мм" value={labelStep} step={25} onChange={setLabelStep} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {[25, 50, 100, 250].map(v => <button key={v} style={btn} onClick={() => setLabelStep(v)}>{v}</button>)}
        </div>
        {error && <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', color: '#b91c1c', borderRadius: 6, fontSize: 12.5 }}>{error}</div>}
      </div>

      {/* ── Результат ── */}
      <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {inc && inclInput && <EdgeTable input={inclInput} inc={inc} step={edgeStep} onStep={setEdgeStep}
          copied={edgeCopied} onCopy={() => { setEdgeCopied(true); setTimeout(() => setEdgeCopied(false), 1500) }} />}
        {layout && geom && sheets.length > 0 && (
          <>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 13, color: C.text, marginBottom: 8 }}>
                {geom.offsets.map((_, k) => (
                  <span key={k} style={{ marginRight: 14, whiteSpace: 'nowrap' }}>
                    <b style={{ color: ARC_COLORS[k] }}>{arcName(k)}</b>: {stats(k).total} листов, резать <b>{stats(k).cut}</b>
                  </span>
                ))}
                <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Нажмите на лист на схеме.</div>
              </div>
              <OverviewSvg sheets={sheets} geom={geom} selectedId={sel?.id} onSelect={setSelected} layout={layout} />
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                {incl && inc
                  ? 'Развёртка наклонной поверхности. Цвет листа — по верхней кромке: оранжевый — верхняя кромка режет лист, серый — лист целиком в поверхности. Нижнюю кромку режет лист с отметками «Нижняя кромка».'
                  : 'Цвет листа — по дуге 1: голубой — целиком под дугой, оранжевый — дуга режет лист, серый — лист нужен только для дальних дуг.'}
              </div>
            </div>

            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
              <ExportMenu build={buildReport} selectedLabel={sel ? `лист №${sel.id}` : null} disabled={sheets.length === 0} />
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
                  {arcCount > 1 && (
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      {Array.from({ length: arcCount }, (_, k) => {
                        const on = !hidden.includes(k)
                        return (
                          <button key={k} onClick={() => setHidden(h => (on ? [...h, k] : h.filter(x => x !== k)))}
                            style={{ ...btn, color: on ? '#fff' : ARC_COLORS[k], background: on ? ARC_COLORS[k] : '#fff', borderColor: ARC_COLORS[k], fontWeight: 600 }}>
                            {arcName(k)}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <SheetDrawing sheet={sel} geom={geom} shown={shown} labelStep={labelStep} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 6px' }}>
                  <b style={{ fontSize: 13 }}>Ординаты дуги, мм</b>
                  <button style={btn} onClick={copyTable}>{copied ? '✓ Скопировано' : 'Копировать'}</button>
                </div>
                <div style={{ maxWidth: 300, marginBottom: 8 }}>
                  <Toggle value={offFrom} onChange={setOffFrom} options={[['top', 'Отступ от верхней'], ['bottom', 'От нижней']]} />
                </div>
                <CutTable sheet={sel} shown={shown} labelStep={labelStep} offFrom={offFrom} name={arcName} />
              </div>
            )}
          </>
        )}
        {layout && sheets.length === 0 && !error && <div style={{ color: C.muted }}>Нет листов для такой раскладки.</div>}
      </div>
    </div>
  )
}

function CutTable({ sheet, shown, labelStep, offFrom, name }: { sheet: ArcSheet; shown: number[]; labelStep: number; offFrom: OffsetFrom; name: (k: number) => string }) {
  const notes = shown.flatMap(k => {
    const s = sheet.cuts[k].status
    if (s === 'full') return [{ k, text: 'лист целиком под дугой, резать не надо' }]
    if (s === 'none') return [{ k, text: 'лист за дугой, для неё не нужен' }]
    return []
  })
  const ref = sheet.cuts.find(c => c.marks.length)
  const rows = ref ? ref.marks : []
  const labeled = labelIndices(rows.map(m => m.du), labelStep)
  const offs = shown.map(k => ordinateOffsets(sheet.cuts[k].marks.map(m => (m.clipped ? null : m.dv)), offFrom))
  const arrow = offFrom === 'top' ? '↓ от верхней' : '↑ от нижней'
  return (
    <div style={{ maxHeight: 360, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
      {notes.length > 0 && (
        <div style={{ padding: 8, fontSize: 12, color: C.muted }}>
          {notes.map(n => <div key={n.k}>{name(n.k)}: {n.text}.</div>)}
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ padding: 8, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          {shown.map((k, j) => offs[j].top === null ? null : (
            <div key={k} style={{ color: ARC_COLORS[k] }}>
              {name(k)}: верхняя линия {offs[j].top}, нижняя {offs[j].bottom}, между ними {offs[j].span} мм.
            </div>
          ))}
          <div>Проведите поперёк листа две линии по этим отметкам, а внутри между ними мерьте столбец «{arrow}».</div>
        </div>
      )}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
              <th style={th}>От левой кромки</th>
              {shown.map(k => [
                <th key={k} style={{ ...th, color: ARC_COLORS[k] }}>{name(k)}</th>,
                <th key={k + 'o'} style={{ ...th, color: ARC_COLORS[k], fontStyle: 'italic' }}>{arrow}</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const major = labeled.has(i)
              return (
                <tr key={i} style={{ background: major ? '#f3f4f6' : '#fff', fontWeight: major ? 600 : 400 }}>
                  <td style={td}>{m.du}</td>
                  {shown.map((k, j) => {
                    const mk = sheet.cuts[k].marks[i]
                    const off = offs[j].offsets[i]
                    return [
                      <td key={k} style={{ ...td, color: ARC_COLORS[k] }}>{mk ? cell(mk) : '—'}</td>,
                      <td key={k + 'o'} style={{ ...td, color: ARC_COLORS[k], fontStyle: 'italic' }}>{off === null || off === undefined ? '—' : off}</td>,
                    ]
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
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
  const curve = (arc: number) => {
    const half = layout.halfs[arc]
    const pts: string[] = []
    const from = geom.chord / 2 - half; const to = geom.chord / 2 + half
    for (let u = from; u <= to; u += Math.max((to - from) / 400, 1)) pts.push(`${u},${Y(arcV(geom, arc, u))}`)
    pts.push(`${to},${Y(arcV(geom, arc, to))}`)
    return pts.join(' ')
  }
  const fs = 260
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`${uMin} 0 ${uMax - uMin} ${vMax - vMin}`} style={{ width: '100%', minWidth: 900, display: 'block' }}>
        {sheets.map(s => {
          const st = s.cuts[0].status
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
        {geom.offsets.map((_, k) => (
          <polyline key={k} points={curve(k)} fill="none" stroke={ARC_COLORS[k]} strokeWidth={24} />
        ))}
      </svg>
    </div>
  )
}

function EdgeTable({ input, inc, step, onStep, copied, onCopy }: {
  input: Parameters<typeof calcInclined>[0]; inc: ReturnType<typeof calcInclined>
  step: number; onStep: (v: number) => void; copied: boolean; onCopy: () => void
}) {
  const rows = useMemo(() => inclinedEdgeTable(input, step > 0 ? step : 500), [input, step])
  const L = inc.rulingLength
  const copy = () => {
    const head = ['u (вдоль кромки), мм', 'верх: от хорды, мм', 'низ: от хорды, мм', 'в плане x, мм', 'в плане y, мм']
    const text = [head.join('\t'), ...rows.map(r => [r.u, r.w, r.wBottom, r.x, r.y].join('\t'))].join('\n')
    navigator.clipboard?.writeText(text).then(onCopy).catch(() => { /* буфер недоступен */ })
  }
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>Координаты кромки на развёртке</b>
        <div style={{ width: 140 }}><NumField label="Шаг" suffix="мм" value={step} step={100} onChange={onStep} /></div>
        <button style={btn} onClick={copy}>{copied ? '✓ Скопировано' : 'Копировать'}</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
        Развёртка: хорда {inc.devChord.toFixed(0)} мм, стрела {inc.devSagitta.toFixed(0)} мм, R ≈ {inc.devRadius.toFixed(0)} мм.
        u — длина вдоль кромки от левого конца, «от хорды» — отступ от прямой, соединяющей концы кромки.
        Нижняя кромка — та же кривая, ниже на {L.toFixed(0)} мм вдоль стоек
        {inc.droopAlong > 0 ? `, плюс просадка у краёв до ${inc.droopAlong.toFixed(1)} мм вдоль стоек (по параболе)` : ''}. Значения точные (по окружности раскладки ниже отличаются не более чем на 1,5 мм).
      </div>
      <div style={{ maxHeight: 320, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
              <th style={th}>u, мм</th>
              <th style={{ ...th, color: ARC_COLORS[0] }}>Верх: от хорды</th>
              <th style={{ ...th, color: ARC_COLORS[1] }}>Низ: от хорды</th>
              <th style={th}>План x</th>
              <th style={th}>План y</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={td}>{r.u}</td>
                <td style={{ ...td, color: ARC_COLORS[0] }}>{r.w}</td>
                <td style={{ ...td, color: ARC_COLORS[1] }}>{r.wBottom}</td>
                <td style={{ ...td, color: C.muted }}>{r.x}</td>
                <td style={{ ...td, color: C.muted }}>{r.y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
