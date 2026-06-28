/**
 * CeilingCalc.tsx — вкладка «Потолки»
 * Расчёт подвесных потолков КНАУФ: П112, П113, П131, П19
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva'
import type { CeilingSpec, CeilingType, CeilingLayers, CeilingMaterial, CeilingSheetThickness, CeilingStep } from './data/ceilingData'
import { CEILING_TYPE_LABELS, CEILING_STEP_OPTIONS } from './data/ceilingData'
import { calcCeiling } from './core/calcCeiling'
import type { CeilingCalcResult, CeilingSheetLayout } from './core/calcCeiling'

// ─── Константы ────────────────────────────────────────────────────────────────

const COLORS = {
  bg:          '#f7f8fa',
  panel:       '#ffffff',
  border:      '#e0e4ea',
  accent:      '#3a7bd5',
  accentLight: '#e8f0fc',
  text:        '#1a1f2e',
  textMuted:   '#6b7280',
  success:     '#2d7d46',
  warning:     '#b45309',
  error:       '#c0392b',
  // Цвета холста
  grid:        '#e8ecf0',
  profile:     '#78909c',
  profileMain: '#455a64',
  sheet:       'rgba(144,202,249,0.25)',
  sheetBorder: '#1e88e5',
  sheetCut:    'rgba(255,183,77,0.3)',
  sheetCutBorder: '#fb8c00',
  hanger:      '#e53935',
}

const INPUT_STYLE: React.CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 14,
  color: COLORS.text,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
}

const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE }

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: COLORS.textMuted,
  marginBottom: 4,
  display: 'block',
}

// ─── Дефолтные значения ───────────────────────────────────────────────────────

const DEFAULT_SPEC: CeilingSpec & { roomLengthMm: number; roomWidthMm: number; sheetLengthMm: number } = {
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

// ─── Компонент ────────────────────────────────────────────────────────────────

export default function CeilingCalc() {
  const [form, setForm] = useState(DEFAULT_SPEC)
  const [result, setResult] = useState<CeilingCalcResult | null>(null)
  const [shiftMm, setShiftMm] = useState(0)  // сдвиг раскладки листов
  const [shiftInput, setShiftInput] = useState('0')
  const [showOffcuts, setShowOffcuts] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(600)

  // Следим за шириной контейнера холста
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      setCanvasW(entries[0].contentRect.width || 600)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Пересчёт при изменении формы
  const recalc = useCallback((f: typeof form) => {
    if (f.areaSqm <= 0) { setResult(null); return }
    const spec = { ...f } as CeilingSpec & { roomLengthMm: number; roomWidthMm: number; sheetLengthMm: number }
    setResult(calcCeiling(spec))
  }, [])

  function setField<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(prev => {
      const next = { ...prev, [key]: value }

      // При изменении длины/ширины — пересчитываем площадь и периметр
      if (key === 'roomLengthMm' || key === 'roomWidthMm') {
        const l = key === 'roomLengthMm' ? (value as number) : prev.roomLengthMm
        const w = key === 'roomWidthMm' ? (value as number) : prev.roomWidthMm
        if (l > 0 && w > 0) {
          next.areaSqm = Math.round(l * w / 1000000 * 100) / 100
          next.perimeterM = Math.round((l + w) * 2 / 1000 * 100) / 100
        }
      }

      recalc(next)
      return next
    })
  }

  // Ручное изменение площади/периметра (для нестандартных форм)
  function setAreaManual(val: number) {
    setForm(prev => {
      const next = { ...prev, areaSqm: val }
      recalc(next)
      return next
    })
  }
  function setPerimeterManual(val: number) {
    setForm(prev => {
      const next = { ...prev, perimeterM: val }
      recalc(next)
      return next
    })
  }

  const isNonStandard = form.roomLengthMm > 0 && form.roomWidthMm > 0 &&
    Math.abs(form.areaSqm - form.roomLengthMm * form.roomWidthMm / 1e6) > 0.05
  void isNonStandard

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 600, background: COLORS.bg, padding: 16 }}>

      {/* ── Левая панель: форма ввода ── */}
      <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Тип потолка */}
        <Section title="Тип потолка">
          {(Object.keys(CEILING_TYPE_LABELS) as CeilingType[]).map(t => (
            <button key={t} onClick={() => setField('type', t)} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 10px', marginBottom: 4, borderRadius: 6, fontSize: 13,
              border: `1.5px solid ${form.type === t ? COLORS.accent : COLORS.border}`,
              background: form.type === t ? COLORS.accentLight : '#fff',
              color: form.type === t ? COLORS.accent : COLORS.text,
              fontWeight: form.type === t ? 600 : 400,
              cursor: 'pointer',
            }}>
              {t === 'p112' && '▦ '}
              {t === 'p113' && '▤ '}
              {t === 'p131' && '▥ '}
              {t === 'p19' && '✦ '}
              {CEILING_TYPE_LABELS[t].split(' — ')[0]}
              <div style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 400, marginTop: 2 }}>
                {CEILING_TYPE_LABELS[t].split(' — ')[1]}
              </div>
            </button>
          ))}
        </Section>

        {/* Размеры помещения */}
        <Section title="Размеры помещения">
          <Row2>
            <Field label="Длина, мм">
              <input style={INPUT_STYLE} type="number" min={0} step={100}
                value={form.roomLengthMm || ''}
                onChange={e => setField('roomLengthMm', +e.target.value)}
              />
            </Field>
            <Field label="Ширина, мм">
              <input style={INPUT_STYLE} type="number" min={0} step={100}
                value={form.roomWidthMm || ''}
                onChange={e => setField('roomWidthMm', +e.target.value)}
              />
            </Field>
          </Row2>

          <div style={{ marginTop: 8, padding: '8px 10px', background: COLORS.accentLight, borderRadius: 6, fontSize: 13 }}>
            <div>Площадь: <b>{form.areaSqm > 0 ? form.areaSqm.toFixed(2) : '—'} м²</b></div>
            <div>Периметр: <b>{form.perimeterM > 0 ? form.perimeterM.toFixed(2) : '—'} м</b></div>
          </div>

          {/* Для нестандартных форм — ручной ввод */}
          <div style={{ marginTop: 8, fontSize: 12, color: COLORS.textMuted }}>
            Г-образный, трапеция или другая форма — введите вручную:
          </div>
          <Row2>
            <Field label="Площадь, м²">
              <input style={INPUT_STYLE} type="number" min={0} step={0.1}
                value={form.areaSqm || ''}
                onChange={e => setAreaManual(+e.target.value)}
              />
            </Field>
            <Field label="Периметр, м">
              <input style={INPUT_STYLE} type="number" min={0} step={0.1}
                value={form.perimeterM || ''}
                onChange={e => setPerimeterManual(+e.target.value)}
              />
            </Field>
          </Row2>
        </Section>

        {/* Параметры конструкции */}
        {form.type !== 'p19' && (
          <Section title="Параметры конструкции">
            <Row2>
              <Field label="Слоёв ГКЛ">
                <select style={SELECT_STYLE} value={form.layers}
                  onChange={e => setField('layers', +e.target.value as CeilingLayers)}>
                  <option value={1}>1 слой</option>
                  <option value={2}>2 слоя</option>
                </select>
              </Field>
              <Field label="Материал">
                <select style={SELECT_STYLE} value={form.material}
                  onChange={e => setField('material', e.target.value as CeilingMaterial)}>
                  <option value="gsp">ГСП (ГКЛ)</option>
                  <option value="gvl">ГВЛ</option>
                </select>
              </Field>
            </Row2>
            <Row2>
              <Field label="Толщина, мм">
                <select style={SELECT_STYLE} value={form.thickness}
                  onChange={e => setField('thickness', +e.target.value as CeilingSheetThickness)}>
                  <option value={9.5}>9.5</option>
                  <option value={12.5}>12.5</option>
                </select>
              </Field>
              <Field label="Шаг профилей (c)">
                <select style={SELECT_STYLE} value={form.stepC}
                  onChange={e => setField('stepC', +e.target.value as CeilingStep)}>
                  {CEILING_STEP_OPTIONS.map(s => (
                    <option key={s} value={s}>{s} мм</option>
                  ))}
                </select>
              </Field>
            </Row2>
            <Field label="Длина листа, мм">
              <select style={SELECT_STYLE}
                value={(form as typeof DEFAULT_SPEC).sheetLengthMm}
                onChange={e => setField('sheetLengthMm' as keyof typeof form, +e.target.value as never)}>
                <option value={2500}>2500</option>
                <option value={2700}>2700</option>
                <option value={3000}>3000</option>
              </select>
            </Field>
          </Section>
        )}

        {/* Подсказки по типу */}
        {form.type !== 'p19' && (
          <div style={{ padding: '10px 12px', background: '#fffbeb', border: `1px solid #fcd34d`, borderRadius: 8, fontSize: 12, color: '#78350f' }}>
            {form.type === 'p112' && <>
              <b>П112</b> — два уровня профилей ПП 60×27.<br />
              Основные + несущие соединяются двухуровневым крабом.<br />
              Шаг несущих b = 500мм (поперечный монтаж).
            </>}
            {form.type === 'p113' && <>
              <b>П113</b> — один уровень ПП 60×27.<br />
              Профили соединяются одноуровневым крабом.<br />
              По периметру — ПН 28×27. Для низких помещений.
            </>}
            {form.type === 'p131' && <>
              <b>П131</b> — каркас из профилей ПС/ПН.<br />
              Без подвесов к перекрытию.<br />
              Только для узких помещений (до 4.25м).
            </>}
          </div>
        )}
      </div>

      {/* ── Правая часть: визуализация + спецификация ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {form.type === 'p19' ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: COLORS.panel, borderRadius: 10, border: `1px solid ${COLORS.border}`, padding: 40, textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✦</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.text, marginBottom: 8 }}>П19 — многоуровневый потолок</div>
              <div style={{ color: COLORS.textMuted, fontSize: 14 }}>
                Расчёт выполняется по индивидуальному дизайнерскому проекту.<br />
                Функция будет доступна в следующих версиях.
              </div>
            </div>
          </div>
        ) : result ? (
          <>
            {/* Предупреждения */}
            {result.warnings.length > 0 && (
              <div style={{ padding: '10px 14px', background: '#fef3c7', border: `1px solid #fcd34d`, borderRadius: 8, fontSize: 13, color: '#92400e' }}>
                {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            {/* Визуализация раскладки */}
            {result.sheetLayout && form.roomLengthMm > 0 && form.roomWidthMm > 0 && (
              <div style={{ background: COLORS.panel, borderRadius: 10, border: `1px solid ${COLORS.border}`, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: COLORS.text }}>
                    Раскладка листов
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: COLORS.textMuted }}>Сдвиг:</span>
                    <input
                      type="number" min={0} max={1200} step={50}
                      value={shiftInput}
                      onChange={e => { setShiftInput(e.target.value); setShiftMm(+e.target.value) }}
                      style={{ ...INPUT_STYLE, width: 80 }}
                    />
                    <span style={{ fontSize: 12, color: COLORS.textMuted }}>мм</span>
                  </div>
                </div>
                <div ref={containerRef}>
                  <CeilingCanvas
                    layout={result.sheetLayout}
                    canvasW={canvasW}
                    shiftMm={shiftMm}
                    type={form.type}
                  />
                </div>
                {/* Легенда */}
                <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12 }}>
                  <LegendItem color={COLORS.sheetBorder} bg={COLORS.sheet} label="Целый лист" />
                  <LegendItem color={COLORS.sheetCutBorder} bg={COLORS.sheetCut} label="Резаный лист" />
                  <LegendItem color={COLORS.profileMain} bg={COLORS.profile} label="Основной профиль" />
                  {form.type !== 'p131' && (
                    <LegendItem color={COLORS.hanger} bg="rgba(229,57,53,0.15)" label="Подвес" />
                  )}
                </div>
              </div>
            )}

            {/* Итоги по листам */}
            {result.sheetLayout && (
              <div style={{ display: 'flex', gap: 10 }}>
                <StatCard label="Всего листов" value={result.sheetLayout.totalSheets * form.layers} unit="шт" />
                <StatCard label="Целых" value={result.sheetLayout.fullSheets * form.layers} unit="шт" color={COLORS.success} />
                <StatCard label="Резаных" value={result.sheetLayout.cutSheets * form.layers} unit="шт" color={COLORS.warning} />
                <StatCard label="Площадь" value={form.areaSqm.toFixed(2)} unit="м²" />
              </div>
            )}

            {/* Спецификация материалов */}
            <div style={{ background: COLORS.panel, borderRadius: 10, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, fontWeight: 600, fontSize: 15, color: COLORS.text }}>
                Спецификация материалов
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: COLORS.bg }}>
                    <th style={TH}>Наименование</th>
                    <th style={{ ...TH, textAlign: 'center', width: 80 }}>Ед.</th>
                    <th style={{ ...TH, textAlign: 'right', width: 90 }}>Кол-во</th>
                    <th style={{ ...TH, textAlign: 'right', width: 90 }}>На м²</th>
                  </tr>
                </thead>
                <tbody>
                  {result.materials.map((m, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}`, background: i % 2 === 0 ? '#fff' : COLORS.bg }}>
                      <td style={TD}>{m.name}</td>
                      <td style={{ ...TD, textAlign: 'center', color: COLORS.textMuted }}>{m.unit}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{m.qty}</td>
                      <td style={{ ...TD, textAlign: 'right', color: COLORS.textMuted }}>
                        {m.ratePerSqm != null ? m.ratePerSqm.toFixed(1) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Обрезки */}
            {result.sheetLayout && result.sheetLayout.offcuts.length > 0 && (
              <div style={{ background: COLORS.panel, borderRadius: 10, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}>
                <button
                  onClick={() => setShowOffcuts(!showOffcuts)}
                  style={{ width: '100%', padding: '12px 16px', border: 'none', background: 'none',
                    textAlign: 'left', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: COLORS.text,
                    display: 'flex', justifyContent: 'space-between' }}>
                  <span>Обрезки ({result.sheetLayout.offcuts.length} шт)</span>
                  <span>{showOffcuts ? '▲' : '▼'}</span>
                </button>
                {showOffcuts && (
                  <div style={{ padding: '0 16px 12px' }}>
                    {result.sheetLayout.offcuts.map(([w, l], i) => (
                      <div key={i} style={{ fontSize: 13, color: COLORS.textMuted, padding: '2px 0' }}>
                        {w} × {l} мм
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: COLORS.panel, borderRadius: 10, border: `1px solid ${COLORS.border}` }}>
            <div style={{ textAlign: 'center', color: COLORS.textMuted }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📐</div>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}>Введите размеры помещения</div>
              <div style={{ fontSize: 13 }}>Длина и ширина — или площадь и периметр вручную</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Холст раскладки листов ───────────────────────────────────────────────────

function CeilingCanvas({ layout, canvasW, shiftMm, type }: {
  layout: CeilingSheetLayout
  canvasW: number
  shiftMm: number
  type: CeilingType
}) {
  const PAD = 40
  const scale = Math.min(
    (canvasW - PAD * 2) / layout.roomLengthMm,
    400 / layout.roomWidthMm,
  )
  const W = layout.roomLengthMm * scale
  const H = layout.roomWidthMm * scale
  const canvasH = H + PAD * 2

  // Листы (по длине = по оси X, по ширине = по оси Y)
  const sheetW_px = layout.sheetW * scale
  const sheetL_px = layout.sheetL * scale
  void sheetW_px; void sheetL_px
  const shift_px = (shiftMm % layout.sheetW) * scale
  void shift_px

  const sheets: { x: number; y: number; w: number; h: number; isCut: boolean }[] = []
  let y = 0
  while (y < layout.roomWidthMm) {
    const rowH = Math.min(layout.sheetL, layout.roomWidthMm - y)
    let x = -shiftMm
    while (x < layout.roomLengthMm) {
      const colW = Math.min(layout.sheetW, layout.roomLengthMm - Math.max(x, 0))
      const sx = Math.max(x, 0)
      const isCut = rowH < layout.sheetL || colW < layout.sheetW || x < 0
      if (colW > 0) {
        sheets.push({
          x: sx * scale,
          y: y * scale,
          w: colW * scale,
          h: rowH * scale,
          isCut,
        })
      }
      x += layout.sheetW
    }
    y += layout.sheetL
  }

  // Основные профили (вдоль длины, шаг c)
  const mainProfiles: number[] = []
  for (let x = layout.stepC; x < layout.roomLengthMm; x += layout.stepC) {
    mainProfiles.push(x * scale)
  }

  // Несущие профили (поперёк, шаг b=500мм)
  const bearingProfiles: number[] = []
  for (let y = layout.stepB; y < layout.roomWidthMm; y += layout.stepB) {
    bearingProfiles.push(y * scale)
  }

  // Подвесы (на пересечениях основных профилей с шагом stepA)
  const hangers: { x: number; y: number }[] = []
  if (type !== 'p131' && layout.stepA > 0) {
    for (const px of mainProfiles) {
      for (let ya = layout.stepA / 2; ya < layout.roomWidthMm; ya += layout.stepA) {
        hangers.push({ x: px, y: ya * scale })
      }
    }
  }

  return (
    <Stage width={canvasW} height={canvasH}>
      <Layer offsetX={-PAD} offsetY={-PAD}>
        {/* Фон помещения */}
        <Rect x={0} y={0} width={W} height={H} fill="#f0f4f8" stroke={COLORS.profileMain} strokeWidth={2} />

        {/* Листы ГКЛ */}
        {sheets.map((s, i) => (
          <Rect key={i}
            x={s.x} y={s.y} width={s.w} height={s.h}
            fill={s.isCut ? COLORS.sheetCut : COLORS.sheet}
            stroke={s.isCut ? COLORS.sheetCutBorder : COLORS.sheetBorder}
            strokeWidth={1}
          />
        ))}

        {/* Несущие профили (горизонтальные, шаг b) */}
        {bearingProfiles.map((py, i) => (
          <Line key={`b${i}`}
            points={[0, py, W, py]}
            stroke={COLORS.profile} strokeWidth={1.5} dash={[6, 4]}
          />
        ))}

        {/* Основные профили (вертикальные, шаг c) */}
        {mainProfiles.map((px, i) => (
          <Line key={`m${i}`}
            points={[px, 0, px, H]}
            stroke={COLORS.profileMain} strokeWidth={2}
          />
        ))}

        {/* Подвесы */}
        {hangers.map((h, i) => (
          <Group key={`h${i}`} x={h.x} y={h.y}>
            <Rect x={-5} y={-5} width={10} height={10}
              fill="rgba(229,57,53,0.2)" stroke={COLORS.hanger} strokeWidth={1.5} cornerRadius={2}
            />
          </Group>
        ))}

        {/* Размерные подписи по осям */}
        <Text x={W / 2} y={-28} text={`${layout.roomLengthMm} мм`}
          fontSize={12} fill={COLORS.textMuted} align="center" offsetX={40}
        />
        <Text x={-36} y={H / 2} text={`${layout.roomWidthMm} мм`}
          fontSize={12} fill={COLORS.textMuted} rotation={-90}
        />

        {/* Рамка */}
        <Rect x={0} y={0} width={W} height={H}
          fill="transparent" stroke={COLORS.profileMain} strokeWidth={2}
        />
      </Layer>
    </Stage>
  )
}

// ─── Мелкие компоненты ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', background: COLORS.bg, borderBottom: `1px solid ${COLORS.border}`,
        fontSize: 12, fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={LABEL_STYLE}>{label}</label>
      {children}
    </div>
  )
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>{children}</div>
}

function StatCard({ label, value, unit, color }: { label: string; value: number | string; unit: string; color?: string }) {
  return (
    <div style={{ flex: 1, background: '#fff', borderRadius: 8, border: `1px solid ${COLORS.border}`,
      padding: '10px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? COLORS.text }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.textMuted }}>{unit}</div>
    </div>
  )
}

function LegendItem({ color, bg, label }: { color: string; bg: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 20, height: 14, background: bg, border: `1.5px solid ${color}`, borderRadius: 3 }} />
      <span style={{ color: COLORS.textMuted }}>{label}</span>
    </div>
  )
}

const TH: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', fontWeight: 600,
  fontSize: 12, color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.border}`,
}
const TD: React.CSSProperties = {
  padding: '7px 12px', fontSize: 14, color: COLORS.text,
}
