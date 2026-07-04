/**
 * CeilingCalc.tsx — вкладка «Потолки»
 * Пошаговый конструктор каркаса П112 (П212)
 * Шаги: 1-ПН периметр → 2-Подвесы+Основные ПП → 3-Несущие ПП+Крабы → 4-Зашить ГКЛ
 */

import { useState, useRef, useEffect } from 'react'
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva'
import type { CeilingSpecFull } from './data/ceilingData'
import { CEILING_TYPE_LABELS, CEILING_STEP_OPTIONS, P112_HANGER_STEP } from './data/ceilingData'
import type { CeilingType, CeilingLayers, CeilingMaterial, CeilingSheetThickness, CeilingStep } from './data/ceilingData'
import { calcCeiling } from './core/calcCeiling'
import type { CeilingCalcResult } from './core/calcCeiling'
import { calcFrameRowPositions } from './core/calcP112Frame'

// ─── Цвета ───────────────────────────────────────────────────────────────────

const C = {
  bg:           '#f4f5f7',
  panel:        '#ffffff',
  border:       '#dde1e8',
  accent:       '#2563eb',
  accentLight:  '#eff6ff',
  text:         '#111827',
  muted:        '#6b7280',
  success:      '#16a34a',
  warning:      '#d97706',
  // Профили
  pn:           '#607d8b',   // ПН 28×27 — синевато-серый
  ppMain:       '#37474f',   // Основной ПП — тёмный
  ppBearing:    '#546e7a',   // Несущий ПП — чуть светлее
  hanger:       '#e53935',   // Подвес
  crab:         '#f57c00',   // Краб (соединитель)
  sheetFill:    'rgba(144,202,249,0.22)',
  sheetBorder:  '#1e88e5',
  sheetCutFill: 'rgba(255,183,77,0.28)',
  sheetCutBorder:'#fb8c00',
  scaleLine:    '#90a4ae',
  scaleText:    '#546e7a',
}

// ─── Шаги монтажа ────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4
const STEPS: { id: Step; label: string; desc: string }[] = [
  { id: 1, label: 'ПН 28×27',        desc: 'Периметральный профиль' },
  { id: 2, label: 'Подвесы + ПП',    desc: 'Основные профили вдоль длины' },
  { id: 3, label: 'Несущие ПП',      desc: 'Поперёк + крабы' },
  { id: 4, label: 'Зашить ГКЛ',      desc: 'Раскладка листов' },
]

// ─── Дефолтная форма ─────────────────────────────────────────────────────────

const DEF: CeilingSpecFull = {
  type: 'p112',
  layers: 1,
  material: 'gsp',
  thickness: 12.5,
  stepC: 600,
  areaSqm: 0,
  perimeterM: 0,
  roomLengthMm: 0,
  roomWidthMm: 0,
  sheetLengthMm: 2500,
}

// ─── Стили ───────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  border: `1px solid ${C.border}`, borderRadius: 6,
  padding: '6px 10px', fontSize: 14, color: C.text,
  background: '#fff', width: '100%', boxSizing: 'border-box',
}
const sel: React.CSSProperties = { ...inp }
const lbl: React.CSSProperties = {
  fontSize: 12, color: C.muted, marginBottom: 3, display: 'block',
}

// ─── Компонент ───────────────────────────────────────────────────────────────

export default function CeilingCalc() {
  const [form, setForm] = useState<CeilingSpecFull>(DEF)
  const [step, setStep] = useState<Step>(1)
  const [shiftMainMm, setShiftMainMm]       = useState(0)   // сдвиг основных ПП по X
  const [shiftBearingMm, setShiftBearingMm] = useState(0)   // сдвиг несущих ПП по Y
  const [result, setResult] = useState<CeilingCalcResult | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(600)

  useEffect(() => {
    if (!canvasRef.current) return
    const ro = new ResizeObserver(e => setCanvasW(e[0].contentRect.width || 600))
    ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [])

  function setField<K extends keyof CeilingSpecFull>(key: K, val: CeilingSpecFull[K]) {
    setForm(prev => {
      const next = { ...prev, [key]: val }
      if (key === 'roomLengthMm' || key === 'roomWidthMm') {
        const l = key === 'roomLengthMm' ? (val as number) : prev.roomLengthMm
        const w = key === 'roomWidthMm'  ? (val as number) : prev.roomWidthMm
        if (l > 0 && w > 0) {
          next.areaSqm   = Math.round(l * w / 1e6 * 100) / 100
          next.perimeterM = Math.round((l + w) * 2 / 1000 * 100) / 100
        }
      }
      if (next.areaSqm > 0) setResult(calcCeiling(next))
      return next
    })
  }

  // Материалы по шагам — накопительно
  const mats = result?.materials ?? []
  const stepMats: Record<Step, string[]> = {
    1: ['ПН 28×27', 'Лента уплотнительная 30мм', 'Дюбель для ПН 28×27'],
    2: ['Профиль ПП 60×27', 'Подвес прямой ПП 60×27', 'Шуруп LN (крепление в подвесе)', 'Дюбель анкерный', 'Удлинитель ПП 60×27'],
    3: ['Соединитель двухуровневый ПП 60×27'],
    4: ['ГСП', 'ГВЛ', 'Шуруп TN', 'Шуруп MN', 'Шпаклёвка', 'Лента армирующая', 'Лента разделительная', 'Грунтовка'],
  }

  const visibleMats = mats.filter(m =>
    Object.entries(stepMats)
      .filter(([s]) => +s <= step)
      .some(([, names]) => names.some(n => m.name.includes(n)))
  )

  const hasRoom = form.roomLengthMm > 0 && form.roomWidthMm > 0

  return (
    <div style={{ display: 'flex', gap: 14, minHeight: 600, background: C.bg, padding: 14 }}>

      {/* ── Левая панель ── */}
      <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Тип потолка */}
        <Card title="ТИП ПОТОЛКА">
          {(Object.keys(CEILING_TYPE_LABELS) as CeilingType[]).map(t => (
            <button key={t} onClick={() => setField('type', t)} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '7px 10px', marginBottom: 3, borderRadius: 6, fontSize: 12,
              border: `1.5px solid ${form.type === t ? C.accent : C.border}`,
              background: form.type === t ? C.accentLight : '#fff',
              color: form.type === t ? C.accent : C.text,
              fontWeight: form.type === t ? 600 : 400, cursor: 'pointer',
            }}>
              {CEILING_TYPE_LABELS[t].split(' — ')[0]}
              <span style={{ display: 'block', fontSize: 10, color: C.muted, fontWeight: 400 }}>
                {CEILING_TYPE_LABELS[t].split(' — ')[1]}
              </span>
            </button>
          ))}
        </Card>

        {/* Размеры */}
        <Card title="РАЗМЕРЫ ПОМЕЩЕНИЯ">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={lbl}>Длина, мм</label>
              <input style={inp} type="number" min={0} step={100}
                value={form.roomLengthMm || ''} onChange={e => setField('roomLengthMm', +e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Ширина, мм</label>
              <input style={inp} type="number" min={0} step={100}
                value={form.roomWidthMm || ''} onChange={e => setField('roomWidthMm', +e.target.value)} />
            </div>
          </div>
          {hasRoom && (
            <div style={{ padding: '7px 10px', background: C.accentLight, borderRadius: 6, fontSize: 13 }}>
              <div>Площадь: <b>{form.areaSqm.toFixed(2)} м²</b></div>
              <div>Периметр: <b>{form.perimeterM.toFixed(2)} м</b></div>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: C.muted }}>Нестандартная форма — вручную:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
            <div>
              <label style={lbl}>Площадь, м²</label>
              <input style={inp} type="number" min={0} step={0.1}
                value={form.areaSqm || ''} onChange={e => {
                  const v = +e.target.value
                  setForm(prev => { const n = { ...prev, areaSqm: v }; if (v > 0) setResult(calcCeiling(n)); return n })
                }} />
            </div>
            <div>
              <label style={lbl}>Периметр, м</label>
              <input style={inp} type="number" min={0} step={0.1}
                value={form.perimeterM || ''} onChange={e => {
                  const v = +e.target.value
                  setForm(prev => { const n = { ...prev, perimeterM: v }; if (n.areaSqm > 0) setResult(calcCeiling(n)); return n })
                }} />
            </div>
          </div>
        </Card>

        {/* Параметры конструкции */}
        {form.type !== 'p19' && (
          <Card title="ПАРАМЕТРЫ">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lbl}>Слоёв ГКЛ</label>
                <select style={sel} value={form.layers} onChange={e => setField('layers', +e.target.value as CeilingLayers)}>
                  <option value={1}>1 слой</option>
                  <option value={2}>2 слоя</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Материал</label>
                <select style={sel} value={form.material} onChange={e => setField('material', e.target.value as CeilingMaterial)}>
                  <option value="gsp">ГСП (ГКЛ)</option>
                  <option value="gvl">ГВЛ</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Толщина, мм</label>
                <select style={sel} value={form.thickness} onChange={e => setField('thickness', +e.target.value as CeilingSheetThickness)}>
                  <option value={9.5}>9.5</option>
                  <option value={12.5}>12.5</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Шаг осн. (c)</label>
                <select style={sel} value={form.stepC} onChange={e => setField('stepC', +e.target.value as CeilingStep)}>
                  {CEILING_STEP_OPTIONS.map(s => <option key={s} value={s}>{s} мм</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={lbl}>Длина листа, мм</label>
              <select style={sel} value={form.sheetLengthMm} onChange={e => setField('sheetLengthMm', +e.target.value)}>
                <option value={2500}>2500</option>
                <option value={2700}>2700</option>
                <option value={3000}>3000</option>
              </select>
            </div>
          </Card>
        )}

        {/* Точный расчёт каркаса П112 — см. calcP112Frame.ts, КОНСПЕКТ.md 05.07.2026 */}
        {form.type === 'p112' && (
          <Card title="ТОЧНЫЙ РАСЧЁТ КАРКАСА">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lbl}>Зазор плита→каркас, мм</label>
                <input style={inp} type="number" min={0} step={10}
                  value={form.slabGapMm ?? ''} onChange={e => setField('slabGapMm', +e.target.value || undefined)} />
              </div>
              <div>
                <label style={lbl}>Шаг несущего (b), мм</label>
                <input style={inp} type="number" min={0} step={50}
                  placeholder={String(P112_HANGER_STEP[form.stepC] ?? 1000)}
                  value={form.stepB ?? ''} onChange={e => setField('stepB', +e.target.value || undefined)} />
              </div>
            </div>
            <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.bearingAlongLength ?? true}
                onChange={e => setField('bearingAlongLength', e.target.checked)} />
              Несущий профиль вдоль длины (снять — вдоль ширины)
            </label>
            {!form.slabGapMm && (
              <div style={{ marginTop: 6, fontSize: 11, color: C.warning }}>
                Без зазора каркас считается по среднему расходу на м² (менее точно).
              </div>
            )}
          </Card>
        )}

        {/* Управление сдвигом — появляется на шаге 2 и 3 */}
        {hasRoom && step >= 2 && (
          <Card title="СДВИГ ГРЕБЁНКИ">
            {step >= 2 && (
              <div style={{ marginBottom: 8 }}>
                <label style={lbl}>Основные ПП (вдоль X), мм</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button style={shiftBtn} onClick={() => setShiftMainMm(v => Math.max(0, v - 50))}>← −50</button>
                  <input style={{ ...inp, width: 70, textAlign: 'center' }} type="number"
                    value={shiftMainMm} onChange={e => setShiftMainMm(+e.target.value)} />
                  <button style={shiftBtn} onClick={() => setShiftMainMm(v => v + 50)}>+50 →</button>
                </div>
              </div>
            )}
            {step >= 3 && (
              <div>
                <label style={lbl}>Несущие ПП (вдоль Y), мм</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button style={shiftBtn} onClick={() => setShiftBearingMm(v => Math.max(0, v - 50))}>↑ −50</button>
                  <input style={{ ...inp, width: 70, textAlign: 'center' }} type="number"
                    value={shiftBearingMm} onChange={e => setShiftBearingMm(+e.target.value)} />
                  <button style={shiftBtn} onClick={() => setShiftBearingMm(v => v + 50)}>+50 ↓</button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* ── Правая часть ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {form.type === 'p19' ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.panel, borderRadius: 10, border: `1px solid ${C.border}`, padding: 40, textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 36, marginBottom: 10 }}>✦</div>
              <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>П19 — многоуровневый потолок</div>
              <div style={{ color: C.muted, fontSize: 13 }}>Расчёт по индивидуальному проекту. В разработке.</div>
            </div>
          </div>
        ) : (
          <>
            {/* Шаги монтажа */}
            <div style={{ background: C.panel, borderRadius: 10, border: `1px solid ${C.border}`, padding: '10px 14px' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {STEPS.map(s => (
                  <button key={s.id} onClick={() => setStep(s.id)} style={{
                    flex: 1, padding: '8px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: step === s.id ? C.accent : step > s.id ? '#dcfce7' : C.bg,
                    color: step === s.id ? '#fff' : step > s.id ? C.success : C.muted,
                    fontWeight: step === s.id ? 700 : 500, fontSize: 12, transition: 'all 0.15s',
                  }}>
                    <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 2 }}>Шаг {s.id}</div>
                    <div>{s.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Холст */}
            <div style={{ background: C.panel, borderRadius: 10, border: `1px solid ${C.border}`, padding: 12 }}>
              {!hasRoom ? (
                <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: C.muted, flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 32 }}>📐</div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>Введите размеры помещения</div>
                </div>
              ) : (
                <div ref={canvasRef}>
                  <CeilingCanvas
                    form={form}
                    step={step}
                    canvasW={canvasW}
                    shiftMainMm={shiftMainMm}
                    shiftBearingMm={shiftBearingMm}
                    layout={result?.sheetLayout ?? null}
                  />
                </div>
              )}
            </div>

            {/* Легенда */}
            {hasRoom && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '6px 2px' }}>
                <LegItem color={C.pn} label="ПН 28×27 (периметр)" />
                {step >= 2 && <LegItem color={C.ppMain} label="Осн. ПП 60×27" />}
                {step >= 2 && <LegItem color={C.hanger} label="Подвес" dot />}
                {step >= 3 && <LegItem color={C.ppBearing} label="Несущий ПП 60×27" />}
                {step >= 3 && <LegItem color={C.crab} label="Краб" dot />}
                {step >= 4 && <LegItem color={C.sheetBorder} bg={C.sheetFill} label="ГКЛ целый" />}
                {step >= 4 && <LegItem color={C.sheetCutBorder} bg={C.sheetCutFill} label="ГКЛ резаный" />}
              </div>
            )}

            {/* Итоги по листам (шаг 4) */}
            {step === 4 && result?.sheetLayout && (
              <div style={{ display: 'flex', gap: 8 }}>
                <StatCard label="Всего листов" value={result.sheetLayout.totalSheets * form.layers} unit="шт" />
                <StatCard label="Целых" value={result.sheetLayout.fullSheets * form.layers} unit="шт" color={C.success} />
                <StatCard label="Резаных" value={result.sheetLayout.cutSheets * form.layers} unit="шт" color={C.warning} />
                {result.sheetLayout.rotated && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 12px',
                    background: '#fffbeb', border: `1px solid #fcd34d`, borderRadius: 8,
                    fontSize: 12, color: '#92400e' }}>
                    ↺ Листы повёрнуты — длинная сторона вдоль ширины помещения
                  </div>
                )}
              </div>
            )}

            {/* Спецификация — накопительная */}
            {visibleMats.length > 0 && (
              <div style={{ background: C.panel, borderRadius: 10, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
                  fontWeight: 600, fontSize: 14, color: C.text, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Спецификация</span>
                  <span style={{ fontSize: 12, color: C.muted, fontWeight: 400 }}>
                    шаги 1–{step} из 4
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: C.bg }}>
                      <th style={th}>Наименование</th>
                      <th style={{ ...th, textAlign: 'center', width: 60 }}>Ед.</th>
                      <th style={{ ...th, textAlign: 'right', width: 80 }}>Кол-во</th>
                      <th style={{ ...th, textAlign: 'right', width: 70 }}>На м²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMats.map((m, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}`,
                        background: i % 2 === 0 ? '#fff' : C.bg }}>
                        <td style={td}>{m.name}</td>
                        <td style={{ ...td, textAlign: 'center', color: C.muted }}>{m.unit}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{m.qty}</td>
                        <td style={{ ...td, textAlign: 'right', color: C.muted }}>
                          {m.ratePerSqm != null ? m.ratePerSqm.toFixed(1) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Холст ───────────────────────────────────────────────────────────────────

function CeilingCanvas({ form, step, canvasW, shiftMainMm, shiftBearingMm, layout }: {
  form: CeilingSpecFull
  step: Step
  canvasW: number
  shiftMainMm: number
  shiftBearingMm: number
  layout: import('./core/calcCeiling').CeilingSheetLayout | null
}) {
  const PAD_L = 50
  const PAD_T = 40
  const PAD_R = 10
  const PAD_B = 10
  const CANVAS_H = 460  // фиксированная высота холста

  const { roomLengthMm: L, roomWidthMm: W_room } = form
  const drawW = canvasW - PAD_L - PAD_R

  // ── Зум и панорама ──
  const [zoom, setZoom] = useState(1)
  const [pan, setPan]   = useState({ x: 0, y: 0 })
  const isPanning       = useRef(false)
  const lastMid         = useRef({ x: 0, y: 0 })
  const stageRef        = useRef<any>(null)

  // Базовый масштаб (fit в окно)
  const baseScale = Math.min(drawW / L, (CANVAS_H - PAD_T - PAD_B) / W_room)

  // Итоговый масштаб с учётом зума
  const scale = baseScale * zoom
  const W = L * scale
  const H = W_room * scale
  const stageH = CANVAS_H

  // Сброс зума при смене помещения
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [form.roomLengthMm, form.roomWidthMm])

  // Обработчик колёсика — зум к точке курсора
  function handleWheel(e: any) {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const oldScale = zoom
    const pointer  = stage.getPointerPosition()
    if (!pointer) return
    // Точка в координатах чертежа (без учёта PAD)
    const mouseX = (pointer.x - PAD_L - pan.x) / (baseScale * oldScale)
    const mouseY = (pointer.y - PAD_T - pan.y) / (baseScale * oldScale)
    const dir    = e.evt.deltaY > 0 ? -1 : 1
    const factor = 1 + dir * 0.12
    const newZoom = Math.min(10, Math.max(0.3, oldScale * factor))
    // Корректируем пан чтобы точка под курсором не сдвинулась
    const newPanX = pointer.x - PAD_L - mouseX * baseScale * newZoom
    const newPanY = pointer.y - PAD_T - mouseY * baseScale * newZoom
    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }

  // Средняя кнопка — панорамирование
  function handleMouseDown(e: any) {
    if (e.evt.button === 1) {  // средняя кнопка
      e.evt.preventDefault()
      isPanning.current = true
      lastMid.current   = { x: e.evt.clientX, y: e.evt.clientY }
    }
  }
  function handleMouseMove(e: any) {
    if (!isPanning.current) return
    const dx = e.evt.clientX - lastMid.current.x
    const dy = e.evt.clientY - lastMid.current.y
    lastMid.current = { x: e.evt.clientX, y: e.evt.clientY }
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }))
  }
  function handleMouseUp(e: any) {
    if (e.evt.button === 1) isPanning.current = false
  }

  // ── Профили ──
  const PP_W = Math.max(3, Math.min(10, scale * 60 / 1000))
  const PN_W = Math.max(2, Math.min(6,  scale * 28 / 1000))

  // ── Основные профили (X, шаг c) ──
  const stepC = form.stepC
  // Реальная позиция рядов (см. calcP112Frame.ts): первый ряд на расстоянии
  // шага от стены, последний просто ближе к дальней стене — не наивная
  // сетка от 0. shiftMainMm — ручной сдвиг всей гребёнки поверх этого.
  const mainPosX = calcFrameRowPositions(L, stepC)
    .map(p => (p + shiftMainMm) * scale)
    .filter(x => x >= 0 && x <= L * scale)

  // ── Несущие профили (Y, шаг b) ──
  // Раньше был захардкожен неверный шаг 500мм — реальный шаг несущего
  // профиля берём из формы (или дефолт из той же таблицы, что и подвесы,
  // см. КОНСПЕКТ.md — на объекте это одно и то же расстояние).
  const stepB = form.stepB ?? (P112_HANGER_STEP[stepC] ?? 1000)
  const bearingPosY = calcFrameRowPositions(W_room, stepB)
    .map(p => (p + shiftBearingMm) * scale)
    .filter(y => y >= 0 && y <= W_room * scale)

  // ── Подвесы ──
  // Вдоль каждого несущего профиля, с тем же шагом b (НЕ пол-шага — это
  // правило для стоек в перегородках, здесь по-другому, см. КОНСПЕКТ.md).
  const hangerPosXMm = calcFrameRowPositions(L, stepB)
  const hangers: { x: number; y: number }[] = []
  // Рисуем подвесы только если их не слишком много (иначе каша)
  const hangerCount = bearingPosY.length * hangerPosXMm.length
  const showHangers = hangerCount <= 200
  if (showHangers) {
    for (const py of bearingPosY) {
      for (const hxMm of hangerPosXMm) {
        hangers.push({ x: hxMm * scale, y: py })
      }
    }
  }

  // Известное упрощение (см. КОНСПЕКТ.md): эта иллюстрация всегда рисует
  // несущий вдоль длины — разворот каркаса (form.bearingAlongLength=false)
  // сейчас учитывается только в смете (calcCeiling), не в картинке.

  // ── Листы ГКЛ (шаг 4) ──
  const sheets: { x: number; y: number; w: number; h: number; isCut: boolean }[] = []
  if (step === 4 && layout) {
    let sy = 0
    while (sy < W_room) {
      const rh = Math.min(layout.sheetW, W_room - sy)
      let sx = 0
      while (sx < L) {
        const cw = Math.min(layout.sheetL, L - sx)
        const isCut = rh < layout.sheetW || cw < layout.sheetL
        if (cw > 0) sheets.push({ x: sx * scale, y: sy * scale, w: cw * scale, h: rh * scale, isCut })
        sx += layout.sheetL
      }
      sy += layout.sheetW
    }
  }

  // ── Шкала X — пересчитываем с учётом зума/пана ──
  // Показываем только те профили что видны
  const xBounds = [0, ...mainPosX.map(px => px / scale), L]
  const xSpans: { x: number; w: number; lbl: string }[] = []
  for (let i = 0; i < xBounds.length - 1; i++) {
    const a = xBounds[i], b = xBounds[i + 1], span = b - a
    const wPx = span * scale
    if (wPx > 20) xSpans.push({ x: a * scale, w: wPx, lbl: `${Math.round(span)}` })
  }

  // ── Шкала Y ──
  const yBounds = [0, ...bearingPosY.map(py => py / scale), W_room]
  const ySpans: { y: number; h: number; lbl: string }[] = []
  for (let i = 0; i < yBounds.length - 1; i++) {
    const a = yBounds[i], b = yBounds[i + 1], span = b - a
    const hPx = span * scale
    if (hPx > 16) ySpans.push({ y: a * scale, h: hPx, lbl: `${Math.round(span)}` })
  }

  // Смещение чертежа с учётом пана (ограничиваем чтоб не уйти слишком далеко)
  const offX = Math.max(-(W * zoom), Math.min(drawW, pan.x))
  const offY = Math.max(-(H * zoom), Math.min(CANVAS_H - PAD_T, pan.y))

  return (
    <div style={{ position: 'relative' }}>
      {/* Подсказка по управлению */}
      <div style={{ position: 'absolute', top: 4, right: 8, fontSize: 11,
        color: C.muted, pointerEvents: 'none', zIndex: 1 }}>
        🖱 колёсико — зум · зажать колёсико — двигать
        {zoom !== 1 && (
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
            style={{ marginLeft: 8, fontSize: 11, padding: '1px 6px',
              border: `1px solid ${C.border}`, borderRadius: 4,
              background: C.bg, cursor: 'pointer', color: C.accent,
              pointerEvents: 'all' }}>
            сброс
          </button>
        )}
      </div>
    <Stage ref={stageRef} width={canvasW} height={stageH}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ cursor: isPanning.current ? 'grabbing' : 'default' }}>
      {/* ── Шкала X сверху — фиксированная, не двигается с паном ── */}
      <Layer x={PAD_L} y={PAD_T}>
        <Line points={[0, -PAD_T + 10, canvasW - PAD_L - PAD_R, -PAD_T + 10]}
          stroke={C.scaleLine} strokeWidth={1} />
        {xSpans.map((s, i) => {
          const sx = s.x + offX
          if (sx + s.w < 0 || sx > canvasW - PAD_L) return null
          return (
            <Group key={`xs${i}`}>
              <Line points={[sx, -PAD_T + 5, sx, -PAD_T + 15]} stroke={C.scaleLine} strokeWidth={1.5} />
              <Line points={[sx + s.w, -PAD_T + 5, sx + s.w, -PAD_T + 15]} stroke={C.scaleLine} strokeWidth={1.5} />
              <Text x={sx} y={-PAD_T + 16} width={s.w} align="center"
                text={s.lbl} fontSize={10} fill={C.ppMain} fontStyle="bold" />
            </Group>
          )
        })}
        {mainPosX.filter((_, i) => i > 0).map((px, i) => {
          const sx = px + offX
          if (sx < -20 || sx > canvasW - PAD_L + 20) return null
          return (
            <Text key={`xp${i}`} x={sx - 20} y={-PAD_T + 1} width={40} align="center"
              text={`${Math.round(px / scale)}`} fontSize={9} fill={C.scaleText} />
          )
        })}
      </Layer>

      {/* ── Шкала Y слева — фиксированная ── */}
      <Layer x={PAD_L} y={PAD_T}>
        <Line points={[-PAD_L + 10, 0, -PAD_L + 10, stageH - PAD_T]}
          stroke={C.scaleLine} strokeWidth={1} />
        {ySpans.map((s, i) => {
          const sy = s.y + offY
          if (sy + s.h < 0 || sy > stageH - PAD_T) return null
          return (
            <Group key={`ys${i}`}>
              <Line points={[-PAD_L + 5, sy, -PAD_L + 15, sy]} stroke={C.scaleLine} strokeWidth={1.5} />
              <Line points={[-PAD_L + 5, sy + s.h, -PAD_L + 15, sy + s.h]} stroke={C.scaleLine} strokeWidth={1.5} />
              <Text x={-PAD_L + 16} y={sy + s.h / 2 - 5} width={28}
                text={s.lbl} fontSize={9} fill={C.ppBearing} fontStyle="bold" />
            </Group>
          )
        })}
        {bearingPosY.filter((_, i) => i > 0).map((py, i) => {
          const sy = py + offY
          if (sy < -10 || sy > stageH - PAD_T + 10) return null
          return (
            <Text key={`yp${i}`} x={-PAD_L + 1} y={sy - 6} width={PAD_L - 18} align="right"
              text={`${Math.round(py / scale)}`} fontSize={9} fill={C.scaleText} />
          )
        })}
      </Layer>

      {/* ── Основной слой чертежа — двигается с паном ── */}
      <Layer x={PAD_L + offX} y={PAD_T + offY}>

        {/* ── Фон помещения ── */}
        <Rect x={0} y={0} width={W} height={H} fill="#eef2f7"
          stroke={C.ppMain} strokeWidth={2} />

        {/* ── Шаг 4: Листы ГКЛ (под профилями) ── */}
        {step === 4 && sheets.map((s, i) => (
          <Rect key={`sh${i}`} x={s.x} y={s.y} width={s.w} height={s.h}
            fill={s.isCut ? C.sheetCutFill : C.sheetFill}
            stroke={s.isCut ? C.sheetCutBorder : C.sheetBorder} strokeWidth={1} />
        ))}

        {/* ── Шаг 1+: ПН 28×27 по периметру ── */}
        {/* Верх */}
        <Rect x={0} y={0} width={W} height={PN_W} fill={C.pn} opacity={0.85} />
        {/* Низ */}
        <Rect x={0} y={H - PN_W} width={W} height={PN_W} fill={C.pn} opacity={0.85} />
        {/* Лево */}
        <Rect x={0} y={0} width={PN_W} height={H} fill={C.pn} opacity={0.85} />
        {/* Право */}
        <Rect x={W - PN_W} y={0} width={PN_W} height={H} fill={C.pn} opacity={0.85} />

        {/* ── Шаг 2+: Основные ПП 60×27 (вертикальные) ── */}
        {step >= 2 && mainPosX.map((px, i) => (
          <Group key={`mp${i}`}>
            {/* Имитация П-профиля: тёмная полка + светлая середина + тёмная полка */}
            <Rect x={px - PP_W / 2} y={0} width={PP_W / 4} height={H}
              fill={C.ppMain} opacity={0.9} />
            <Rect x={px - PP_W / 4} y={0} width={PP_W / 2} height={H}
              fill="#78909c" opacity={0.6} />
            <Rect x={px + PP_W / 4} y={0} width={PP_W / 4} height={H}
              fill={C.ppMain} opacity={0.9} />
          </Group>
        ))}

        {/* ── Шаг 2+: Подвесы ── */}
        {step >= 2 && hangers.map((h, i) => (
          <Group key={`hg${i}`} x={h.x} y={h.y}>
            <Rect x={-5} y={-4} width={10} height={8}
              fill="rgba(229,57,53,0.25)" stroke={C.hanger} strokeWidth={1.5} cornerRadius={1} />
            {/* Тяга подвеса — вертикальная линия вверх */}
            <Line points={[0, -4, 0, -10]} stroke={C.hanger} strokeWidth={1} />
          </Group>
        ))}

        {/* ── Шаг 3+: Несущие ПП 60×27 (горизонтальные) ── */}
        {step >= 3 && bearingPosY.map((py, i) => (
          <Group key={`bp${i}`}>
            <Rect x={0} y={py - PP_W / 2} width={W} height={PP_W / 4}
              fill={C.ppBearing} opacity={0.9} />
            <Rect x={0} y={py - PP_W / 4} width={W} height={PP_W / 2}
              fill="#90a4ae" opacity={0.6} />
            <Rect x={0} y={py + PP_W / 4} width={W} height={PP_W / 4}
              fill={C.ppBearing} opacity={0.9} />
          </Group>
        ))}

        {/* ── Шаг 3+: Крабы на пересечениях ── */}
        {step >= 3 && mainPosX.map((px, mi) =>
          bearingPosY.map((py, bi) => (
            <Group key={`cr${mi}_${bi}`} x={px} y={py}>
              <Rect x={-4} y={-4} width={8} height={8}
                fill={C.crab} opacity={0.9} cornerRadius={1} />
              <Line points={[-6, 0, 6, 0]} stroke={C.crab} strokeWidth={1} />
              <Line points={[0, -6, 0, 6]} stroke={C.crab} strokeWidth={1} />
            </Group>
          ))
        )}

        {/* ── Рамка поверх ── */}
        <Rect x={0} y={0} width={W} height={H}
          fill="transparent" stroke={C.ppMain} strokeWidth={2} />

        {/* Подсказка если подвесов слишком много для отображения */}
        {!showHangers && step >= 2 && (
          <Text x={W / 2 - 80} y={H / 2 - 8} width={160} align="center"
            text={`Подвесы: приблизьте чертёж`}
            fontSize={11} fill={C.hanger} />
        )}

      </Layer>
    </Stage>
    </div>
  )
}

// ─── Мелкие компоненты ───────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, borderRadius: 10, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: C.bg, borderBottom: `1px solid ${C.border}`,
        fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.06em' }}>{title}</div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  )
}

function LegItem({ color, bg, label, dot }: { color: string; bg?: string; label: string; dot?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.muted }}>
      {dot
        ? <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        : <div style={{ width: 18, height: 10, background: bg ?? color,
            border: `1.5px solid ${color}`, borderRadius: 2, flexShrink: 0 }} />
      }
      {label}
    </div>
  )
}

function StatCard({ label, value, unit, color }: { label: string; value: number; unit: string; color?: string }) {
  return (
    <div style={{ flex: 1, background: C.panel, borderRadius: 8, border: `1px solid ${C.border}`,
      padding: '8px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted }}>{unit}</div>
    </div>
  )
}

const shiftBtn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, borderRadius: 5,
  border: `1px solid ${C.border}`, background: C.bg,
  color: C.text, cursor: 'pointer', whiteSpace: 'nowrap',
}

const th: React.CSSProperties = {
  padding: '7px 12px', textAlign: 'left', fontWeight: 600,
  fontSize: 11, color: C.muted, borderBottom: `1px solid ${C.border}`,
}
const td: React.CSSProperties = {
  padding: '6px 12px', fontSize: 13, color: C.text,
}
