/**
 * CeilingCompositionEditor.tsx — конструктор композиции П19 (многоуровневый/
 * архитектурный потолок), этап 3 (18.09.2026, см. TASKS.md и переписку).
 *
 * Точка входа: замена плашки «в разработке» для form.type === 'p19' в
 * CeilingCalc.tsx. Архитектура (этапы 1-2, НЕ переизобретается здесь):
 * каждый уровень — обычная сущность Ceiling (ceilingSpec.type p112/p113/p131,
 * отметка через Ceiling.slope с height1Mm===height2Mm), борт между уровнями —
 * отдельная сущность CeilingBorder (сечение узла: опуск/полка/тип), обе
 * сущности объединяет CeilingComposition (только список id, без геометрии).
 *
 * ⚠️ v1 (этап 3): уровни и борта создаются «с нуля», по одному, БЕЗ
 * геометрии на плане — Ceiling.outer и CeilingBorder.path остаются пустыми
 * до этапа 4 (рисование на плане). Поэтому:
 *  - площадь/периметр уровня — только вручную (как «нестандартная форма»
 *    в обычном калькуляторе, см. CeilingCalc.tsx РАЗМЕРЫ ПОМЕЩЕНИЯ);
 *  - длина борта — ещё не считается (путь пуст), calcCeilingBorder() сам
 *    возвращает 0 с предупреждением «путь борта пуст» — это ожидаемо на
 *    этом этапе, не ошибка.
 * Объединение уже нарисованных на плане потолков в композицию задним
 * числом — НЕ реализовано (сознательно отложено, см. переписку).
 */

import { useState } from 'react'
import { useProjectStore } from '../store/useProjectStore'
import type { CeilingSpec, CeilingType, CeilingLayers, CeilingMaterial, CeilingSheetThickness, CeilingStep } from '../data/ceilingData'
import { CEILING_TYPE_LABELS, CEILING_STEP_OPTIONS } from '../data/ceilingData'
import { calcCeiling } from '../core/calcCeiling'
import { calcCeilingBorder } from '../core/calcCeilingBorder'
import { calcMultiLevelCeiling } from '../core/calcMultiLevelCeiling'
import type { CeilingBorderJointType } from '../data/ceilingBorderData'
import { CEILING_BORDER_JOINT_LABELS } from '../data/ceilingBorderData'
import type { Ceiling, CeilingBorder } from '../types'

const C = {
  panel: '#ffffff', border: '#dde1e8', bg: '#f4f5f7', accent: '#2563eb',
  accentLight: '#eff6ff', text: '#111827', muted: '#6b7280',
  success: '#16a34a', warning: '#d97706', danger: '#dc2626',
}
const inp: React.CSSProperties = {
  border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px',
  fontSize: 13, color: C.text, background: '#fff', width: '100%', boxSizing: 'border-box',
}
const sel: React.CSSProperties = { ...inp }
const lbl: React.CSSProperties = { fontSize: 11, color: C.muted, marginBottom: 3, display: 'block' }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, borderRadius: 10, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: C.bg, borderBottom: `1px solid ${C.border}`,
        fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.06em' }}>{title}</div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  )
}

const LEVEL_TYPES: CeilingType[] = ['p112', 'p113', 'p131']

const DEFAULT_LEVEL_SPEC: CeilingSpec = {
  type: 'p112', layers: 1, material: 'gsp', thickness: 12.5,
  stepC: 600, areaSqm: 0, perimeterM: 0,
}

const ONLY_JOINT_TYPE: CeilingBorderJointType = 'p112_p113_angle_connector'

interface LevelFormState {
  label: string
  elevationMm: number
  spec: CeilingSpec
}

interface BorderFormState {
  label: string
  jointType: CeilingBorderJointType
  dropMm: number
  shelfDepthMm: number
  stepCMm: CeilingStep
  sheetLengthMm: number
}

function freshLevelForm(n: number): LevelFormState {
  return { label: `Уровень ${n}`, elevationMm: 3300, spec: { ...DEFAULT_LEVEL_SPEC } }
}
function freshBorderForm(n: number): BorderFormState {
  return { label: `Борт ${n}`, jointType: ONLY_JOINT_TYPE, dropMm: 250, shelfDepthMm: 125, stepCMm: 600, sheetLengthMm: 2500 }
}

export default function CeilingCompositionEditor() {
  const compositions = useProjectStore(s => s.floorPlan?.ceilingCompositions ?? [])
  const allLevels = useProjectStore(s => s.floorPlan?.ceilings ?? [])
  const allBorders = useProjectStore(s => s.floorPlan?.ceilingBorders ?? [])
  const addCeilingComposition = useProjectStore(s => s.addCeilingComposition)
  const removeCeilingComposition = useProjectStore(s => s.removeCeilingComposition)
  const updateCeilingComposition = useProjectStore(s => s.updateCeilingComposition)
  const addCompositionLevel = useProjectStore(s => s.addCompositionLevel)
  const removeCompositionLevel = useProjectStore(s => s.removeCompositionLevel)
  const addCompositionBorder = useProjectStore(s => s.addCompositionBorder)
  const removeCompositionBorder = useProjectStore(s => s.removeCompositionBorder)

  const [activeId, setActiveId] = useState<string | null>(compositions[0]?.id ?? null)
  const active = compositions.find(c => c.id === activeId) ?? null

  const [levelForm, setLevelForm] = useState<LevelFormState>(() => freshLevelForm(1))
  const [borderForm, setBorderForm] = useState<BorderFormState>(() => freshBorderForm(1))

  function handleCreateComposition() {
    const id = addCeilingComposition()
    setActiveId(id)
  }

  if (!active) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {compositions.length > 0 && (
          <Card title="КОМПОЗИЦИИ П19 НА ЭТОМ ЭТАЖЕ">
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
              {compositions.map(c => (
                <button key={c.id} onClick={() => setActiveId(c.id)} style={{
                  padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.border}`,
                  background: '#fff', cursor: 'pointer', fontSize: 12,
                }}>{c.label} ({c.levelIds.length} ур. / {c.borderIds.length} борт.)</button>
              ))}
            </div>
          </Card>
        )}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: C.panel, borderRadius: 10, border: `1px solid ${C.border}`, padding: 40, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✦</div>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>П19 — многоуровневый потолок</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 16, maxWidth: 420 }}>
              Композиция — это несколько уровней (обычных потолков П112/П113/П131
              на своих отметках) и борта (короба) между ними, посчитанные вместе.
              Геометрия на плане и 3D — следующий этап, здесь только состав и смета.
            </div>
            <button onClick={handleCreateComposition} style={{
              padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: C.accent, color: '#fff', fontWeight: 600, fontSize: 13,
            }}>+ Создать композицию</button>
          </div>
        </div>
      </div>
    )
  }

  const levels = active.levelIds
    .map(id => allLevels.find(cl => cl.id === id))
    .filter((cl): cl is Ceiling => !!cl)
  const borders = active.borderIds
    .map(id => allBorders.find(b => b.id === id))
    .filter((b): b is CeilingBorder => !!b)

  const levelResults = levels
    .filter(lv => !!lv.ceilingSpec)
    .map(lv => ({ label: lv.label, result: calcCeiling(lv.ceilingSpec!) }))
  const borderResults = borders.map(b => ({ label: b.label, result: calcCeilingBorder(b) }))

  const aggregate = levelResults.length > 0
    ? calcMultiLevelCeiling(levelResults, borderResults)
    : null

  function handleAddLevel() {
    if (!active) return
    addCompositionLevel(active.id, levelForm.spec, levelForm.elevationMm, levelForm.label)
    setLevelForm(freshLevelForm(levels.length + 2))
  }

  function handleAddBorder() {
    if (!active) return
    const { label, ...section } = borderForm
    addCompositionBorder(active.id, section, label)
    setBorderForm(freshBorderForm(borders.length + 2))
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── Шапка: переключение композиций ── */}
      <Card title="КОМПОЗИЦИЯ">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
          <input style={{ ...inp, flex: 1, minWidth: 160 }} value={active.label}
            onChange={e => updateCeilingComposition(active.id, { label: e.target.value })} />
          {compositions.length > 1 && (
            <select style={{ ...sel, width: 'auto' }} value={active.id} onChange={e => setActiveId(e.target.value)}>
              {compositions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
          <button onClick={handleCreateComposition} style={{
            padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.border}`,
            background: '#fff', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' as const,
          }}>+ Новая</button>
          <button onClick={() => { removeCeilingComposition(active.id); setActiveId(null) }} style={{
            padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.danger}`,
            background: '#fff', color: C.danger, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' as const,
          }}>Удалить композицию</button>
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
        {/* ── Уровни ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card title={`УРОВНИ (${levels.length})`}>
            {levels.length === 0 && (
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Пока ни одного уровня.</div>
            )}
            {levels.map(lv => (
              <div key={lv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 8px', borderRadius: 6, background: C.bg, marginBottom: 6, fontSize: 12 }}>
                <div>
                  <b>{lv.label}</b>
                  {lv.ceilingSpec && <span style={{ color: C.muted }}> · {CEILING_TYPE_LABELS[lv.ceilingSpec.type].split(' — ')[0]} · {lv.ceilingSpec.areaSqm} м²</span>}
                  {lv.slope && <span style={{ color: C.muted }}> · отметка +{(lv.slope.height1Mm / 1000).toFixed(3)}</span>}
                </div>
                <button onClick={() => removeCompositionLevel(active.id, lv.id)} style={{
                  border: 'none', background: 'none', color: C.danger, cursor: 'pointer', fontSize: 13,
                }}>✕</button>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8 }}>ДОБАВИТЬ УРОВЕНЬ</div>
              <div style={{ marginBottom: 8 }}>
                <label style={lbl}>Подпись</label>
                <input style={inp} value={levelForm.label} onChange={e => setLevelForm({ ...levelForm, label: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={lbl}>Тип</label>
                  <select style={sel} value={levelForm.spec.type}
                    onChange={e => setLevelForm({ ...levelForm, spec: { ...levelForm.spec, type: e.target.value as CeilingType } })}>
                    {LEVEL_TYPES.map(t => <option key={t} value={t}>{CEILING_TYPE_LABELS[t].split(' — ')[0]}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Отметка, мм</label>
                  <input style={inp} type="number" step={50} value={levelForm.elevationMm}
                    onChange={e => setLevelForm({ ...levelForm, elevationMm: +e.target.value })} />
                </div>
                <div>
                  <label style={lbl}>Площадь, м²</label>
                  <input style={inp} type="number" min={0} step={0.1} value={levelForm.spec.areaSqm || ''}
                    onChange={e => setLevelForm({ ...levelForm, spec: { ...levelForm.spec, areaSqm: +e.target.value } })} />
                </div>
                <div>
                  <label style={lbl}>Периметр, м</label>
                  <input style={inp} type="number" min={0} step={0.1} value={levelForm.spec.perimeterM || ''}
                    onChange={e => setLevelForm({ ...levelForm, spec: { ...levelForm.spec, perimeterM: +e.target.value } })} />
                </div>
                <div>
                  <label style={lbl}>Слоёв ГКЛ</label>
                  <select style={sel} value={levelForm.spec.layers}
                    onChange={e => setLevelForm({ ...levelForm, spec: { ...levelForm.spec, layers: +e.target.value as CeilingLayers } })}>
                    <option value={1}>1 слой</option>
                    <option value={2}>2 слоя</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Материал</label>
                  <select style={sel} value={levelForm.spec.material}
                    onChange={e => setLevelForm({ ...levelForm, spec: { ...levelForm.spec, material: e.target.value as CeilingMaterial } })}>
                    <option value="gsp">ГСП (ГКЛ)</option>
                    <option value="gvl">ГВЛ</option>
                    <option value="sapphire">Сапфир</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Толщина, мм</label>
                  <select style={sel} value={levelForm.spec.thickness}
                    onChange={e => setLevelForm({ ...levelForm, spec: { ...levelForm.spec, thickness: +e.target.value as CeilingSheetThickness } })}>
                    <option value={9.5}>9.5</option>
                    <option value={12.5}>12.5</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Шаг осн. (c), мм</label>
                  <select style={sel} value={levelForm.spec.stepC}
                    onChange={e => setLevelForm({ ...levelForm, spec: { ...levelForm.spec, stepC: +e.target.value as CeilingStep } })}>
                    {CEILING_STEP_OPTIONS.map(s => <option key={s} value={s}>{s} мм</option>)}
                  </select>
                </div>
              </div>
              <button onClick={handleAddLevel} disabled={levelForm.spec.areaSqm <= 0} style={{
                width: '100%', padding: '8px 0', borderRadius: 6, border: 'none', cursor: levelForm.spec.areaSqm > 0 ? 'pointer' : 'not-allowed',
                background: levelForm.spec.areaSqm > 0 ? C.accent : C.border, color: '#fff', fontWeight: 600, fontSize: 12,
              }}>+ Добавить уровень</button>
              {levelForm.spec.areaSqm <= 0 && (
                <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Укажите площадь, чтобы добавить уровень.</div>
              )}
            </div>
          </Card>
        </div>

        {/* ── Борта ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card title={`БОРТА (${borders.length})`}>
            {borders.length === 0 && (
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Пока ни одного борта.</div>
            )}
            {borders.map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 8px', borderRadius: 6, background: C.bg, marginBottom: 6, fontSize: 12 }}>
                <div>
                  <b>{b.label}</b>
                  <span style={{ color: C.muted }}> · опуск {b.dropMm}мм / полка {b.shelfDepthMm}мм</span>
                  <span style={{ color: C.warning }}> · длина не задана (этап 4)</span>
                </div>
                <button onClick={() => removeCompositionBorder(active.id, b.id)} style={{
                  border: 'none', background: 'none', color: C.danger, cursor: 'pointer', fontSize: 13,
                }}>✕</button>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8 }}>ДОБАВИТЬ БОРТ</div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                Сечение узла — опуск/полка/тип соединения. Путь борта по плану
                (и его длина) задаётся позже, на этапе рисования — материалы,
                привязанные к длине, посчитаются, когда она появится.
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={lbl}>Подпись</label>
                <input style={inp} value={borderForm.label} onChange={e => setBorderForm({ ...borderForm, label: e.target.value })} />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={lbl}>Тип узла</label>
                <select style={sel} value={borderForm.jointType}
                  onChange={e => setBorderForm({ ...borderForm, jointType: e.target.value as CeilingBorderJointType })}>
                  <option value={ONLY_JOINT_TYPE}>{CEILING_BORDER_JOINT_LABELS[ONLY_JOINT_TYPE]}</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={lbl}>Опуск, мм</label>
                  <input style={inp} type="number" min={0} step={10} value={borderForm.dropMm}
                    onChange={e => setBorderForm({ ...borderForm, dropMm: +e.target.value })} />
                </div>
                <div>
                  <label style={lbl}>Глубина полки, мм</label>
                  <input style={inp} type="number" min={0} step={10} value={borderForm.shelfDepthMm}
                    onChange={e => setBorderForm({ ...borderForm, shelfDepthMm: +e.target.value })} />
                </div>
                <div>
                  <label style={lbl}>Шаг соединителей, мм</label>
                  <select style={sel} value={borderForm.stepCMm}
                    onChange={e => setBorderForm({ ...borderForm, stepCMm: +e.target.value as CeilingStep })}>
                    {CEILING_STEP_OPTIONS.map(s => <option key={s} value={s}>{s} мм</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Длина листа ГКЛ, мм</label>
                  <select style={sel} value={borderForm.sheetLengthMm}
                    onChange={e => setBorderForm({ ...borderForm, sheetLengthMm: +e.target.value })}>
                    <option value={2500}>2500</option>
                    <option value={2700}>2700</option>
                    <option value={3000}>3000</option>
                  </select>
                </div>
              </div>
              <button onClick={handleAddBorder} style={{
                width: '100%', padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: C.accent, color: '#fff', fontWeight: 600, fontSize: 12,
              }}>+ Добавить борт</button>
            </div>
          </Card>
        </div>

        {/* ── Сводная смета ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 260 }}>
          <Card title="СВОДНАЯ СМЕТА">
            {!aggregate ? (
              <div style={{ fontSize: 12, color: C.muted }}>Добавьте хотя бы один уровень, чтобы увидеть смету.</div>
            ) : (
              <>
                <div style={{ padding: '8px 10px', background: C.accentLight, borderRadius: 6, fontSize: 13, marginBottom: 10 }}>
                  <div>Площадь уровней: <b>{aggregate.totalAreaSqm} м²</b></div>
                  <div>Длина бортов: <b>{aggregate.totalBorderLengthM} м</b></div>
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto' as const, fontSize: 12, marginBottom: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
                    <tbody>
                      {aggregate.materials.map((m, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '4px 2px' }}>{m.name}</td>
                          <td style={{ padding: '4px 2px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const, color: C.muted }}>
                            {Math.round(m.qty * 100) / 100} {m.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {aggregate.warnings.length > 0 && (
                  <div style={{ fontSize: 11, color: C.warning }}>
                    {aggregate.warnings.map((w, i) => <div key={i} style={{ marginBottom: 4 }}>⚠ {w}</div>)}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
