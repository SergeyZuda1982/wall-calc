/**
 * TileCalc.tsx — вкладка «Плитка» (15.07.2026).
 *
 * По аналогии с калькуляторами ГКЛ (LiningCalc/CeilingCalc), но проще:
 * материал штучный, поэтому нет ни каркаса, ни пула переиспользуемых
 * обрезков — только раскладка (для картинки и памятки резов) и расчёт
 * материалов (площадь+запас → плитки/коробки/клей/затирка), см. подробные
 * комментарии в core/calcTile.ts.
 *
 * Сознательно БЕЗ засева с плана (обсуждено с пользователем 15.07.2026) —
 * только ручной ввод размеров, как самый первый вариант калькулятора стен
 * до появления привязки к плану. Тоже сознательно — БЕЗ сохранения списка
 * расчётов в проект (в отличие от Перегородок/Облицовки): это разовый
 * инструмент "посчитать материал", а не сущность проекта на плане.
 */

import { useMemo, useState } from 'react'
import type { TileInput, TileSurfaceMode, TileLayoutMode } from './types'
import { calcTile } from './core/calcTile'

const C = {
  bg: '#f4f5f7',
  panel: '#ffffff',
  border: '#dde1e8',
  accent: '#2563eb',
  accentLight: '#eff6ff',
  text: '#111827',
  muted: '#6b7280',
  tileFill: 'rgba(144,202,249,0.35)',
  tileBorder: '#1e88e5',
  cutFill: 'rgba(255,183,77,0.4)',
  cutBorder: '#fb8c00',
}

const DEFAULT_INPUT: TileInput = {
  surfaceMode: 'floor',
  lengthMm: 3000,
  heightMm: 2000,
  tileWidthMm: 600,
  tileHeightMm: 600,
  tileThicknessMm: 8,
  seamMm: 2,
  layoutMode: 'grid',
  offsetRowPercent: 50,
  wastePercent: 10,
  areaPerBoxM2: 1.44,
  adhesiveKgPerM2: 4,
  groutDensityGCm3: 1.6,
}

const CANVAS_W = 640
const CANVAS_H = 440
const PAD = 24

function NumField({ label, value, onChange, step = 1, min = 0, suffix }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: C.muted }}>
      {label}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" value={value} step={step} min={min}
          onChange={e => { const v = parseFloat(e.target.value); onChange(isNaN(v) ? 0 : v) }}
          style={{ width: '100%', padding: '7px 9px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box' }} />
        {suffix && <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{suffix}</span>}
      </div>
    </label>
  )
}

export default function TileCalc() {
  const [input, setInput] = useState<TileInput>(DEFAULT_INPUT)
  const patch = (p: Partial<TileInput>) => setInput(s => ({ ...s, ...p }))

  const result = useMemo(() => calcTile(input), [input])

  const scale = Math.min(
    (CANVAS_W - PAD * 2) / Math.max(input.lengthMm, 1),
    (CANVAS_H - PAD * 2) / Math.max(input.heightMm, 1),
  )
  const drawW = input.lengthMm * scale
  const drawH = input.heightMm * scale

  const surfaceLabel = input.surfaceMode === 'floor'
    ? { length: 'Длина помещения', height: 'Ширина помещения' }
    : { length: 'Длина стены', height: 'Высота стены' }

  return (
    <div style={{ display: 'flex', gap: 20, padding: 20, background: C.bg, minHeight: '100%', flexWrap: 'wrap' }}>
      {/* ── Форма ── */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, width: 320, flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, color: C.text }}>🀟 Плитка</div>

        {/* Режим поверхности */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {([['floor', '⬛ Пол'], ['wall', '🧱 Стены']] as [TileSurfaceMode, string][]).map(([mode, label]) => (
            <button key={mode} onClick={() => patch({ surfaceMode: mode })}
              style={{
                flex: 1, padding: '7px 8px', fontSize: 12.5, borderRadius: 6, cursor: 'pointer',
                border: input.surfaceMode === mode ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
                background: input.surfaceMode === mode ? C.accentLight : '#fff',
                color: input.surfaceMode === mode ? C.accent : C.text,
                fontWeight: input.surfaceMode === mode ? 600 : 400,
              }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, marginTop: 10 }}>Поверхность</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <NumField label={surfaceLabel.length} suffix="мм" value={input.lengthMm} step={10} onChange={v => patch({ lengthMm: v })} />
          <NumField label={surfaceLabel.height} suffix="мм" value={input.heightMm} step={10} onChange={v => patch({ heightMm: v })} />
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Плитка</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <NumField label="Ширина" suffix="мм" value={input.tileWidthMm} step={10} onChange={v => patch({ tileWidthMm: v })} />
          <NumField label="Высота" suffix="мм" value={input.tileHeightMm} step={10} onChange={v => patch({ tileHeightMm: v })} />
          <NumField label="Толщина" suffix="мм" value={input.tileThicknessMm} step={1} onChange={v => patch({ tileThicknessMm: v })} />
          <NumField label="Шов" suffix="мм" value={input.seamMm} step={0.5} onChange={v => patch({ seamMm: v })} />
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Раскладка</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {([['grid', 'Сеткой'], ['brick', 'Кирпичиком']] as [TileLayoutMode, string][]).map(([mode, label]) => (
            <button key={mode} onClick={() => patch({ layoutMode: mode })}
              style={{
                flex: 1, padding: '6px 8px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                border: input.layoutMode === mode ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
                background: input.layoutMode === mode ? C.accentLight : '#fff',
                color: input.layoutMode === mode ? C.accent : C.text,
                fontWeight: input.layoutMode === mode ? 600 : 400,
              }}>
              {label}
            </button>
          ))}
        </div>
        {input.layoutMode === 'brick' && (
          <div style={{ marginBottom: 14 }}>
            <NumField label="Сдвиг ряда" suffix="% от ширины плитки" value={input.offsetRowPercent} step={5} min={0}
              onChange={v => patch({ offsetRowPercent: v })} />
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Материалы</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumField label="Запас на подрезку/бой" suffix="%" value={input.wastePercent} step={1} onChange={v => patch({ wastePercent: v })} />
          <NumField label="Плитки в упаковке" suffix="м²" value={input.areaPerBoxM2} step={0.01} onChange={v => patch({ areaPerBoxM2: v })} />
          <NumField label="Расход клея" suffix="кг/м²" value={input.adhesiveKgPerM2} step={0.1} onChange={v => patch({ adhesiveKgPerM2: v })} />
          <NumField label="Плотность затирки" suffix="г/см³" value={input.groutDensityGCm3} step={0.1} onChange={v => patch({ groutDensityGCm3: v })} />
        </div>
      </div>

      {/* ── Раскладка + результаты ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minWidth: 340 }}>
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>
            Раскладка ({input.surfaceMode === 'floor' ? 'вид сверху' : 'вид на стену'})
          </div>
          <svg width={CANVAS_W} height={CANVAS_H} style={{ display: 'block', margin: '0 auto', background: '#fafbfc', borderRadius: 6 }}>
            <g transform={`translate(${(CANVAS_W - drawW) / 2}, ${(CANVAS_H - drawH) / 2})`}>
              <rect x={0} y={0} width={drawW} height={drawH} fill="none" stroke={C.muted} strokeWidth={1.5} />
              {result.layout.pieces.map((p, i) => (
                <rect key={i}
                  x={p.x * scale} y={p.y * scale} width={p.w * scale} height={p.h * scale}
                  fill={p.isCut ? C.cutFill : C.tileFill}
                  stroke={p.isCut ? C.cutBorder : C.tileBorder}
                  strokeWidth={1} />
              ))}
            </g>
          </svg>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 11.5, color: C.muted }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.tileFill, border: `1px solid ${C.tileBorder}`, marginRight: 5, verticalAlign: 'middle' }} />Целая плитка</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.cutFill, border: `1px solid ${C.cutBorder}`, marginRight: 5, verticalAlign: 'middle' }} />Подрезка</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Материалы</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <Row label="Площадь поверхности" value={`${result.areaM2.toFixed(2)} м²`} />
                <Row label={`Площадь с запасом (+${input.wastePercent}%)`} value={`${result.areaWithWasteM2.toFixed(2)} м²`} />
                <Row label="Плиток к покупке" value={`${result.tilesWholeEquivalent} шт`} bold />
                <Row label="Коробок" value={`${result.boxesCount} уп`} bold />
                <Row label="Клей" value={`${result.adhesiveKg.toFixed(1)} кг`} />
                <Row label="Затирка" value={`${result.groutKg.toFixed(2)} кг`} />
              </tbody>
            </table>
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Памятка резов</div>
            {result.layout.cutSizes.length === 0 ? (
              <div style={{ fontSize: 12.5, color: C.muted }}>Без подрезки — размеры кратны плитке.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thS}>Размер (мм)</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Кол-во</th>
                  </tr>
                </thead>
                <tbody>
                  {result.layout.cutSizes.map((c, i) => (
                    <tr key={i}>
                      <td style={tdS}>{c.widthMm} × {c.heightMm}</td>
                      <td style={{ ...tdS, textAlign: 'right' }}>{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr>
      <td style={{ padding: '6px 4px', color: C.muted }}>{label}</td>
      <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: bold ? 700 : 500, color: bold ? C.accent : C.text }}>{value}</td>
    </tr>
  )
}

const thS: React.CSSProperties = { padding: '6px 4px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }
const tdS: React.CSSProperties = { padding: '6px 4px', color: C.text, borderBottom: `1px solid #f0f0f0` }
