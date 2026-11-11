/**
 * NicheCalc.tsx — вкладка «Ломаная стена» (11.11.2026).
 *
 * Облицовка с нишами, скосами и возвратами. Контур вводится по ЧИСТОВОЙ поверхности,
 * для каждого участка задаются число слоёв и толщина слоя обшивки. Экран показывает,
 * где ставить профиль (глубина лицевой полки от плоскости стены) и длины профиля
 * по участкам с поправками на изломах. Расчёт — core/nicheChain.ts, core/calcOffsetPolyline.ts.
 * Обшивка считается только с лицевой стороны (со стороны помещения).
 */

import { useEffect, useMemo, useState } from 'react'
import CalcFileButtons from './components/CalcFileButtons'
import { NumField, Toggle } from './components/calcFields'
import { C, btn, card } from './components/calcTheme'
import {
  analyzeNiche, depthBefore, emptyNiche, exampleNiche, mirrorAppend, sanitizeNiche, segLabel, validateNiche,
  type NicheAnalysis, type NicheModel, type NicheSeg,
} from './core/nicheChain'

const STORAGE_KEY = 'wallcalc.niche.v1'
const BOARDS = [9.5, 12.5, 15]

function load(): NicheModel {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return sanitizeNiche(JSON.parse(raw))
  } catch { /* хранилище недоступно или данные битые */ }
  return exampleNiche()
}

const f1 = (v: number) => (Math.abs(v) < 0.05 ? '0' : v.toFixed(1))
const sgn = (v: number) => (Math.abs(v) < 0.05 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1))
const KIND_RU = { convex: 'выступает в зал', concave: 'западает', straight: 'прямо', jog: 'уступ' } as const

const th: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', fontSize: 11.5, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', fontSize: 12.5, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }

function PlanSvg({ a, exag }: { a: NicheAnalysis; exag: number }) {
  const all = [...a.points, ...a.offset.segments.flatMap(s => [s.profileStart, s.profileEnd])]
  const minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x))
  const minY = Math.min(...all.map(p => p.y), 0), maxY = Math.max(...all.map(p => p.y))
  const W = 1000, pad = 24
  const s = (W - 2 * pad) / Math.max(maxX - minX, 1)
  const X = (x: number) => pad + (x - minX) * s
  const Y = (y: number) => pad + (y - minY) * s * exag
  const H = pad * 2 + (maxY - minY) * s * exag + 18
  const pts = (ps: { x: number; y: number }[]) => ps.map(p => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  const profile = a.offset.segments.flatMap((sg, i) => (i === 0 ? [sg.profileStart, sg.profileEnd] : [sg.profileEnd]))
  return (
    <svg viewBox={`0 0 ${W} ${H.toFixed(0)}`} style={{ width: '100%', height: 'auto', display: 'block', background: '#fff', borderRadius: 6 }}>
      <line x1={pad} x2={W - pad} y1={Y(0)} y2={Y(0)} stroke="#9ca3af" strokeDasharray="4 3" />
      <text x={pad} y={Y(0) - 5} fontSize="10" fill="#6b7280">плоскость стены (глубина 0), вниз — в помещение</text>
      <polyline points={pts(a.points)} fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinejoin="round" />
      <polyline points={pts(profile)} fill="none" stroke="#dc2626" strokeWidth="1.5" strokeDasharray="5 3" strokeLinejoin="round" />
      {a.offset.segments.map(sg => {
        const mx = (sg.cleanStart.x + sg.cleanEnd.x) / 2, my = (sg.cleanStart.y + sg.cleanEnd.y) / 2
        return <text key={sg.index} x={X(mx)} y={Y(my) + (sg.cleanEnd.x === sg.cleanStart.x ? 0 : 14)} fontSize="10" fill="#111827" textAnchor="middle">{sg.index + 1}</text>
      })}
      {a.points.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r="2.5" fill={C.accent} />)}
    </svg>
  )
}

export default function NicheCalc() {
  const [model, setModel] = useState<NicheModel>(load)
  const [gLayers, setGLayers] = useState(2)
  const [gBoard, setGBoard] = useState(12.5)
  const [exag, setExag] = useState<'1' | '3'>('3')

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(model)) } catch { /* хранилище недоступно */ }
  }, [model])

  const error = useMemo(() => validateNiche(model), [model])
  const analysis = useMemo(() => (error ? null : analyzeNiche(model)), [model, error])

  const setSeg = (i: number, patch: Partial<NicheSeg>) =>
    setModel(m => ({ ...m, segs: m.segs.map((s, k) => (k === i ? { ...s, ...patch } : s)) }))
  const remove = (i: number) => setModel(m => (m.segs.length > 1 ? { ...m, segs: m.segs.filter((_, k) => k !== i) } : m))
  const move = (i: number, d: -1 | 1) => setModel(m => {
    const j = i + d
    if (j < 0 || j >= m.segs.length) return m
    const segs = [...m.segs];
    [segs[i], segs[j]] = [segs[j], segs[i]]
    return { ...m, segs }
  })
  const add = () => setModel(m => {
    const last = m.segs[m.segs.length - 1]
    return { ...m, segs: [...m.segs, { along: 1000, depth: last.depth, layers: last.layers, board: last.board }] }
  })
  const applyAll = () => setModel(m => ({ ...m, segs: m.segs.map(s => ({ ...s, layers: gLayers, board: gBoard })) }))

  return (
    <div style={{ display: 'flex', gap: 20, padding: 20, background: C.bg, minHeight: '100%', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ ...card, padding: 18, width: 560, maxWidth: '100%', flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>🧱 Ломаная стена (ниши, скосы)</div>
        <div style={{ marginBottom: 12 }}>
          <CalcFileButtons kind="niche" getData={() => model} onLoad={d => setModel(sanitizeNiche(d))} />
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>
          Размеры — по чистовой поверхности. «Вдоль стены» — длина участка по стене (0 — возврат под прямым углом),
          «Глубина в конце» — расстояние от плоскости стены до чистовой поверхности в конце участка (в помещение — плюс).
          Обшивка считается с лицевой стороны.
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ width: 150 }}><NumField label="Глубина в начале" suffix="мм" value={model.startDepth} step={10} onChange={v => setModel(m => ({ ...m, startDepth: v }))} /></div>
          <div style={{ width: 90 }}><NumField label="Слоёв" value={gLayers} min={0} onChange={setGLayers} /></div>
          <div style={{ width: 120 }}><NumField label="Толщина слоя" suffix="мм" value={gBoard} step={0.5} min={0} onChange={setGBoard} /></div>
          {BOARDS.map(b => <button key={b} style={btn} onClick={() => setGBoard(b)}>{b}</button>)}
          <button style={btn} onClick={applyAll} title="Поставить эти слои на все участки">Всем участкам</button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}>№</th>
              <th style={th}>Вдоль стены</th><th style={th}>Глубина в конце</th><th style={th}>Слоёв</th><th style={th}>Слой, мм</th><th style={th} />
            </tr></thead>
            <tbody>
              {model.segs.map((s, i) => (
                <tr key={i}>
                  <td style={{ ...td, textAlign: 'left', color: C.muted }}>{i + 1}<div style={{ fontSize: 10 }}>от {depthBefore(model, i)}</div></td>
                  <td style={td}><div style={{ width: 90 }}><NumField label="" value={s.along} step={10} min={0} onChange={v => setSeg(i, { along: v })} /></div></td>
                  <td style={td}><div style={{ width: 90 }}><NumField label="" value={s.depth} step={10} onChange={v => setSeg(i, { depth: v })} /></div></td>
                  <td style={td}><div style={{ width: 60 }}><NumField label="" value={s.layers} min={0} onChange={v => setSeg(i, { layers: v })} /></div></td>
                  <td style={td}><div style={{ width: 70 }}><NumField label="" value={s.board} step={0.5} min={0} onChange={v => setSeg(i, { board: v })} /></div></td>
                  <td style={{ ...td, display: 'flex', gap: 3 }}>
                    <button style={btn} onClick={() => move(i, -1)} title="Выше">↑</button>
                    <button style={btn} onClick={() => move(i, 1)} title="Ниже">↓</button>
                    <button style={btn} onClick={() => remove(i)} title="Удалить">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <button style={btn} onClick={add}>+ Участок</button>
          <button style={btn} onClick={() => setModel(m => mirrorAppend(m))} title="Достроить цепочку зеркально; центральный участок склеивается">⇆ Достроить зеркально</button>
          <button style={btn} onClick={() => setModel(exampleNiche(gLayers, gBoard))}>Пример: ниша под пожарный шкаф</button>
          <button style={btn} onClick={() => setModel(emptyNiche())}>Очистить</button>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div style={{ ...card, color: C.danger, fontSize: 13 }}>{error}</div>}
        {analysis && (
          <>
            {analysis.warnings.length > 0 && (
              <div style={{ ...card, color: C.warn, fontSize: 12.5, lineHeight: 1.6 }}>{analysis.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>
            )}
            <div style={card}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14 }}>План</b>
                <span style={{ fontSize: 12, color: C.muted }}>синяя — чистовая поверхность, красная пунктирная — профиль</span>
                <div style={{ width: 170 }}><Toggle value={exag} onChange={setExag} options={[['1', 'глубина ×1'], ['3', '×3']]} /></div>
              </div>
              <PlanSvg a={analysis} exag={Number(exag)} />
            </div>

            <div style={card}>
              <b style={{ fontSize: 14 }}>Профиль по участкам</b>
              <div style={{ fontSize: 12, color: C.muted, margin: '4px 0 8px', lineHeight: 1.5 }}>
                «Глубина профиля» — расстояние от плоскости стены до лицевой полки профиля (чистовая глубина минус обшивка).
                Поправки показывают, на сколько длина профиля отличается от чистовой на каждом конце.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead><tr>
                    <th style={{ ...th, textAlign: 'left' }}>№</th><th style={{ ...th, textAlign: 'left' }}>Участок</th>
                    <th style={th}>Обшивка</th><th style={th}>Чистовая</th><th style={th}>Поправка нач.</th><th style={th}>Поправка кон.</th>
                    <th style={th}>Длина профиля</th><th style={th}>Глубина профиля</th>
                  </tr></thead>
                  <tbody>
                    {analysis.rows.map(r => (
                      <tr key={r.index}>
                        <td style={{ ...td, textAlign: 'left' }}>{r.index}</td>
                        <td style={{ ...td, textAlign: 'left' }}>{segLabel(r.kind)}{r.kind === 'slope' ? ` ${r.angleDeg.toFixed(1)}°` : ''}</td>
                        <td style={td}>{f1(r.thickness)} мм</td>
                        <td style={td}>{f1(r.cleanLength)}</td>
                        <td style={td}>{sgn(r.startDelta)}</td>
                        <td style={td}>{sgn(r.endDelta)}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{f1(r.profileLength)}</td>
                        <td style={td}>{r.profileDepthStart === r.profileDepthEnd || Math.abs(r.profileDepthStart - r.profileDepthEnd) < 0.05 ? f1(r.profileDepthStart) : `${f1(r.profileDepthStart)} → ${f1(r.profileDepthEnd)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td style={{ ...td, textAlign: 'left' }} colSpan={3}><b>Итого</b></td>
                    <td style={td}><b>{f1(analysis.totalClean)}</b></td><td style={td} colSpan={2} />
                    <td style={td}><b>{f1(analysis.totalProfile)}</b></td><td style={td} />
                  </tr></tfoot>
                </table>
              </div>
            </div>

            <div style={card}>
              <b style={{ fontSize: 14 }}>Изломы (углы реза профиля)</b>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead><tr>
                    <th style={{ ...th, textAlign: 'left' }}>Между участками</th><th style={{ ...th, textAlign: 'left' }}>Угол</th><th style={th}>Поворот</th><th style={th}>Рез профиля</th>
                  </tr></thead>
                  <tbody>
                    {analysis.vertices.map(v => (
                      <tr key={v.index}>
                        <td style={{ ...td, textAlign: 'left' }}>{v.index} и {v.index + 1}</td>
                        <td style={{ ...td, textAlign: 'left' }}>{KIND_RU[v.kind]}</td>
                        <td style={td}>{v.kind === 'straight' || v.kind === 'jog' ? '—' : `${Math.abs(v.turnDeg).toFixed(1)}°`}</td>
                        <td style={td}>{v.kind === 'straight' || v.kind === 'jog' ? '—' : `${v.cutDeg.toFixed(1)}°`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
