import { useState, useRef } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Arrow } from 'react-konva'
import type { LiningInput, LiningResult, Opening } from './types'
import { calcLining } from './core/calcLining'
import { calcStudMaterial } from './core/calcStudMaterial'
import { getLiningMaxHeight } from './data/liningMaxHeight'
import { useProjectStore } from './store/useProjectStore'

const CANVAS_W = 820
const PAD = 60
const TOP_PAD = 50
const BOT_PAD = 30
const OVERLAP_MAP: Record<string, number> = { ps50: 500, ps75: 750, ps100: 1000 }

let _lidCounter = 1
function newLid() { return `lop_${_lidCounter++}` }

function emptyDoor(): Opening {
  return { id: newLid(), type: 'door', pos: 0, width: 0, height: 2100, sillHeight: 0 }
}
function emptyWindow(): Opening {
  return { id: newLid(), type: 'window', pos: 0, width: 0, height: 1200, sillHeight: 900 }
}

const DEFAULT_INPUT: LiningInput = {
  liningType: 'c623',
  profileType: 'ps75',
  profileThickness: '06',
  gklLayers: 1,
  length: 3000,
  height: 2800,
  step: 600,
  hangerStep: 1000,
  abutment: 'both',
  openings: [],
}

export default function LiningCalc() {
  const [form, setForm] = useState<LiningInput>(DEFAULT_INPUT)
  const [result, setResult] = useState<LiningResult | null>(null)
  const [heightWarning, setHeightWarning] = useState<string | null>(null)
  const [hasInsulation, setHasInsulation] = useState(false)
  const [positions, setPositions] = useState<number[]>([])
  const [snapL, setSnapL] = useState(0)
  const [snapH, setSnapH] = useState(0)
  const [shiftInput, setShiftInput] = useState('100')
  const basePositions = useRef<number[]>([])
  const gridShift = useRef(0)

  const { linings, activeLiningId, addLining, updateLining, setActiveLining } = useProjectStore()

  function set<K extends keyof LiningInput>(key: K, value: LiningInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function addOpening(type: 'door' | 'window') {
    const o = type === 'door' ? emptyDoor() : emptyWindow()
    setForm(prev => ({ ...prev, openings: [...prev.openings, o] }))
  }

  function updateOpening(id: string, patch: Partial<Opening>) {
    setForm(prev => ({ ...prev, openings: prev.openings.map(o => o.id === id ? { ...o, ...patch } : o) }))
  }

  function removeOpening(id: string) {
    setForm(prev => ({ ...prev, openings: prev.openings.filter(o => o.id !== id) }))
  }

  const isC623 = form.liningType === 'c623'
  const overlap = OVERLAP_MAP[form.profileType] ?? 750

  // Та же логика, что и в calcLining.ts: крайняя стойка у стены ("Стена" в
  // примыкании) — wall (без нахлёста), иначе обычная стойка с нахлёстом.
  function edgeKind(pos: number): 'wall' | 'middle' {
    if (pos === 0) return (form.abutment === 'both' || form.abutment === 'left') ? 'wall' : 'middle'
    if (pos === snapL) return (form.abutment === 'both' || form.abutment === 'right') ? 'wall' : 'middle'
    return 'middle'
  }
  const availableProfiles = form.liningType === 'c626'
    ? [{ value: 'ps50', label: 'ПС 50×50' }, { value: 'ps75', label: 'ПС 75×50' }, { value: 'ps100', label: 'ПС 100×50' }]
    : [{ value: 'ps75', label: 'ПС 75×50' }, { value: 'ps100', label: 'ПС 100×50' }]
  const gklLayersFixed = form.liningType === 'c626' ? 2 : null
  const profileLabel = form.profileType === 'ps50' ? '50' : form.profileType === 'ps75' ? '75' : '100'
  const guideLabel = isC623 ? '28×27' : `${profileLabel}×40`
  const studLabel = isC623 ? 'ПП 60×27' : `ПС ${profileLabel}×50`

  function buildPos(l: number, s: number): number[] {
    const pos: number[] = [0]
    let p = s
    while (p <= l) { pos.push(p); p += s }
    if (pos[pos.length - 1] !== l) pos.push(l)
    return pos
  }

  function addStud(xpx: number) {
    if (!snapL) return
    const sc = (CANVAS_W - PAD * 2) / snapL
    const mm = Math.round((xpx - PAD) / sc / 100) * 100
    if (mm <= 0 || mm >= snapL) return
    const next = [...new Set([...positions, mm])].sort((a, b) => a - b)
    setPositions(next)
    const input = { ...form, gklLayers: (gklLayersFixed ?? form.gklLayers) as 1 | 2 }
    setResult(calcLining(input, next))
  }

  function removeStud(pos: number) {
    if (pos === 0 || pos === snapL) return
    const next = positions.filter(p => p !== pos)
    setPositions(next)
    const input = { ...form, gklLayers: (gklLayersFixed ?? form.gklLayers) as 1 | 2 }
    setResult(calcLining(input, next))
  }

  function calculate() {
    const input = { ...form, gklLayers: (gklLayersFixed ?? form.gklLayers) as 1 | 2 }
    if (!isC623) {
      const maxH = getLiningMaxHeight(form.liningType, form.profileType, form.step)
      if (maxH > 0 && form.height > maxH) {
        setHeightWarning(`⚠️ Высота ${(form.height / 1000).toFixed(2)}м превышает максимум ${(maxH / 1000).toFixed(2)}м по Кнауф для ${form.liningType.toUpperCase()}, ПС${profileLabel}, шаг ${form.step}мм.`)
      } else setHeightWarning(null)
    } else setHeightWarning(null)

    const studs = buildPos(form.length, form.step)
    basePositions.current = studs
    gridShift.current = 0
    setPositions(studs)
    setSnapL(form.length)
    setSnapH(form.height)
    setResult(calcLining({ ...input, length: form.length }, studs))
  }

  function applyShift(delta: number) {
    gridShift.current += delta
    const shifted = basePositions.current.map(p => {
      if (p === 0 || p === snapL) return p
      const np = p + gridShift.current
      return np > 0 && np < snapL ? np : p
    }).filter((p, i, arr) => arr.indexOf(p) === i).sort((a, b) => a - b)
    setPositions(shifted)
  }

  const scale = snapL > 0 ? (CANVAS_W - PAD * 2) / snapL : 1
  const canvasH = snapL > 0 ? snapH * scale + TOP_PAD + BOT_PAD + 20 : 200
  const wallTop = TOP_PAD, wallBot = TOP_PAD + snapH * scale
  const studW = Math.max(4, 50 * scale)
  const tx = (mm: number) => PAD + mm * scale

  // Площадь утеплителя — вся стена минус проёмы
  const insulationArea = result
    ? ((form.length * form.height - form.openings.filter(o => o.width > 0).reduce((s, o) => s + o.width * o.height, 0)) / 1_000_000).toFixed(2)
    : null

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label style={{ fontSize: 13 }}>Тип облицовки</label><br />
          <select value={form.liningType} onChange={e => {
            const lt = e.target.value as LiningInput['liningType']
            const np = lt === 'c626' ? form.profileType : (form.profileType === 'ps50' ? 'ps75' : form.profileType)
            setForm(prev => ({ ...prev, liningType: lt, profileType: np as LiningInput['profileType'], gklLayers: lt === 'c626' ? 2 : 1 }))
          }} style={{ width: '100%', padding: 7 }}>
            <option value="c623">С623 — ПП 60×27 на подвесах</option>
            <option value="c625">С625 — ПС 75/100, 1 слой ГКЛ</option>
            <option value="c626">С626 — ПС 50/75/100, 2 слоя ГКЛ</option>
          </select>
        </div>
        {!isC623 && <div style={{ flex: 1, minWidth: 150 }}>
          <label style={{ fontSize: 13 }}>Профиль</label><br />
          <select value={form.profileType} onChange={e => set('profileType', e.target.value as LiningInput['profileType'])} style={{ width: '100%', padding: 7 }}>
            {availableProfiles.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>}
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Слоёв ГКЛ</label><br />
          {gklLayersFixed
            ? <input readOnly value={`${gklLayersFixed} (фикс.)`} style={{ width: '100%', padding: 7, background: '#f0f0f0', border: '1px solid #ccc', borderRadius: 4 }} />
            : <select value={form.gklLayers} onChange={e => set('gklLayers', Number(e.target.value) as 1 | 2)} style={{ width: '100%', padding: 7 }}>
              <option value={1}>1 слой</option><option value={2}>2 слоя</option>
            </select>}
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={{ fontSize: 13 }}>Примыкание</label><br />
          <select value={form.abutment} onChange={e => set('abutment', e.target.value as LiningInput['abutment'])} style={{ width: '100%', padding: 7 }}>
            <option value="both">Стена — Стена</option>
            <option value="left">Стена — Свободно</option>
            <option value="right">Свободно — Стена</option>
            <option value="none">Без боковых</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label style={{ fontSize: 13 }}>Шаг стоек (мм)</label><br />
          <select value={form.step} onChange={e => set('step', Number(e.target.value))} style={{ width: '100%', padding: 7 }}>
            <option value={600}>600</option><option value={400}>400</option><option value={300}>300</option>
          </select>
        </div>
        {isC623 && <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 13 }}>Шаг подвесов (мм)</label><br />
          <select value={form.hangerStep} onChange={e => set('hangerStep', Number(e.target.value))} style={{ width: '100%', padding: 7 }}>
            {[500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500].map(v => <option key={v} value={v}>{v}{v === 1000 ? ' (норма)' : ''}</option>)}
          </select>
        </div>}
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Длина (мм)</label><br />
          <input type="number" value={form.length || ''} onChange={e => set('length', Number(e.target.value))} style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Высота (мм)</label><br />
          <input type="number" value={form.height || ''} onChange={e => set('height', Number(e.target.value))} style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
      </div>

      {/* ─── Проёмы ─── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#444' }}>Проёмы</span>
          <button onClick={() => addOpening('door')}
            style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: '#f0f4ff', border: '1px solid #aac', borderRadius: 4 }}>+ Дверной</button>
          <button onClick={() => addOpening('window')}
            style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: '#f0fff4', border: '1px solid #aca', borderRadius: 4 }}>+ Оконный</button>
        </div>
        {form.openings.length === 0 && <p style={{ margin: 0, fontSize: 12, color: '#999' }}>Нет проёмов</p>}
        {form.openings.map((o, idx) => (
          <div key={o.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end',
            marginBottom: 8, padding: '8px 10px', background: o.type === 'door' ? '#f8f0ff' : '#f0fff4',
            border: `1px solid ${o.type === 'door' ? '#dcc' : '#cdc'}`, borderRadius: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#666', minWidth: 60, paddingBottom: 6 }}>
              {o.type === 'door' ? '🚪' : '🪟'} {o.type === 'door' ? 'Дверь' : 'Окно'} {idx + 1}
            </span>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label style={{ fontSize: 11, color: '#666' }}>Начало (мм)</label><br />
              <input type="number" value={o.pos || ''} onChange={e => updateOpening(o.id, { pos: Number(e.target.value) })} style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
            </div>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label style={{ fontSize: 11, color: '#666' }}>Ширина (мм)</label><br />
              <input type="number" value={o.width || ''} onChange={e => updateOpening(o.id, { width: Number(e.target.value) })} style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
            </div>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label style={{ fontSize: 11, color: '#666' }}>Высота (мм)</label><br />
              <input type="number" value={o.height || ''} onChange={e => updateOpening(o.id, { height: Number(e.target.value) })} style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
            </div>
            {o.type === 'window' && (
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: '#666' }}>Подоконник (мм)</label><br />
                <input type="number" value={o.sillHeight || ''} onChange={e => updateOpening(o.id, { sillHeight: Number(e.target.value) })} style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
              </div>
            )}
            <button onClick={() => removeOpening(o.id)}
              style={{ padding: '5px 8px', fontSize: 13, cursor: 'pointer', background: '#fff', border: '1px solid #e05', color: '#e05', borderRadius: 4, marginBottom: 1 }}>🗑</button>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={hasInsulation} onChange={e => setHasInsulation(e.target.checked)} />
          Утеплитель
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {linings.length > 0 && <button onClick={() => { setActiveLining(null); setForm(DEFAULT_INPUT); setResult(null); setPositions([]); setHeightWarning(null) }}
          style={{ padding: '10px 20px', fontSize: 15, cursor: 'pointer', background: '#fff', border: '1px solid #aaa', borderRadius: 4 }}>+ Новая</button>}
        <button onClick={calculate} style={{ padding: '10px 32px', fontSize: 15, cursor: 'pointer', background: '#f0f0f0', border: '1px solid #ccc', borderRadius: 4, flex: 1 }}>Рассчитать</button>
        <button onClick={() => {
          if (result) {
            const inp = { ...form, gklLayers: (gklLayersFixed ?? form.gklLayers) as 1 | 2 }
            if (activeLiningId) updateLining(activeLiningId, inp, result)
            else addLining(inp, result)
          }
        }} disabled={!result}
          style={{ padding: '10px 20px', fontSize: 15, cursor: result ? 'pointer' : 'default', background: result ? '#3a7bd5' : '#ccc', color: '#fff', border: 'none', borderRadius: 4, whiteSpace: 'nowrap' }}>
          {activeLiningId ? '💾 Обновить' : '➕ В объект'}
        </button>
      </div>

      {heightWarning && <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: 12, borderRadius: 6, marginBottom: 16 }}>{heightWarning}</div>}

      {/* ─── Чертёж ─── */}
      {snapL > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 12px', background: '#f0f4ff', borderRadius: 6, border: '1px solid #c5d0f0' }}>
            <span style={{ fontSize: 13, color: '#444' }}>Сдвиг гребёнки:</span>
            <button onClick={() => applyShift(-Number(shiftInput))} style={{ padding: '4px 12px', fontSize: 14, cursor: 'pointer', background: '#fff', border: '1px solid #aaa', borderRadius: 4 }}>← влево</button>
            <input type="number" value={shiftInput} onChange={e => setShiftInput(e.target.value)} style={{ width: 70, padding: '4px 6px', textAlign: 'center', border: '1px solid #aaa', borderRadius: 4 }} />
            <span style={{ fontSize: 12, color: '#888' }}>мм</span>
            <button onClick={() => applyShift(Number(shiftInput))} style={{ padding: '4px 12px', fontSize: 14, cursor: 'pointer', background: '#fff', border: '1px solid #aaa', borderRadius: 4 }}>вправо →</button>
          </div>
          <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
            <Stage width={CANVAS_W} height={canvasH}>
              <Layer>
                <Rect x={0} y={0} width={CANVAS_W} height={canvasH} fill="#f8f8f8"
                  onDblClick={e => { const pos = e.target.getStage()?.getPointerPosition(); if (pos) addStud(pos.x) }} />
                <Arrow points={[tx(0), 14, tx(snapL), 14]} stroke="#555" fill="#555" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Arrow points={[tx(snapL), 14, tx(0), 14]} stroke="#555" fill="#555" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Text x={tx(snapL / 2) - 28} y={4} text={`${snapL} мм`} fontSize={11} fill="#333" fontStyle="bold" />
                <Arrow points={[PAD - 22, wallTop + 8, PAD - 22, wallBot - 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Arrow points={[PAD - 22, wallBot - 8, PAD - 22, wallTop + 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Text x={8} y={(wallTop + wallBot) / 2} text={`${snapH}`} fontSize={11} fill="#444" rotation={-90} />
                <Rect x={tx(0)} y={wallTop} width={snapL * scale} height={snapH * scale} fill="#e8f0e8" stroke="#aaa" strokeWidth={1} />
                <Rect x={tx(0)} y={wallTop} width={snapL * scale} height={8} fill="#444" />
                <Rect x={tx(0)} y={wallBot - 8} width={snapL * scale} height={8} fill="#444" />
                {positions.filter(p => p !== 0 && p !== snapL).map(pos => (
                  <Group key={`tp${pos}`}>
                    <Line points={[tx(pos), wallTop - 6, tx(pos), wallTop - 16]} stroke="#666" strokeWidth={1} />
                    <Text x={tx(pos) - 14} y={wallTop - 28} text={`${pos}`} fontSize={9} fill="#333" />
                  </Group>
                ))}
                {positions.filter(p => p !== 0 && p !== snapL).map((pos, i, arr) => {
                  const prev = i === 0 ? 0 : arr[i - 1], dist = pos - prev
                  return <Text key={`td${pos}`} x={tx(prev) + (dist * scale / 2) - 10} y={wallTop - 18} text={`${dist}`} fontSize={8} fill="#888" />
                })}
                {positions.map((pos, idx) => {
                  const isEdge = pos === 0 || pos === snapL
                  const insideOpening = form.openings.find(
                    o => o.width > 0 && pos > o.pos && pos < o.pos + o.width
                  )
                  const orientation = idx % 2 === 0 ? 'down' : 'up'
                  const overlapNode = (!insideOpening && !isC623 && snapH > 3000) ? (() => {
                    const kind = edgeKind(pos)
                    const { overlapZone } = calcStudMaterial(snapH, kind, overlap, orientation)
                    if (!overlapZone) return null
                    const baseY = wallTop + 8
                    const zFrom = baseY + overlapZone.from * scale
                    const zTo = baseY + overlapZone.to * scale
                    const zH = zTo - zFrom
                    const zoneMm = overlapZone.to - overlapZone.from
                    return (
                      <Group key={`ov${pos}`}>
                        <Rect x={tx(pos) - studW / 2} y={zFrom} width={studW} height={zH}
                          fill="rgba(255,140,0,0.3)" stroke="#ff8c00" strokeWidth={1.5} dash={[4, 3]} />
                        <Text x={tx(pos) + studW / 2 + 3} y={zFrom + zH / 2 - 5}
                          text={`${zoneMm}мм`} fontSize={9} fill="#c05000" fontStyle="bold" />
                      </Group>
                    )
                  })() : null
                  return (
                    <Group key={`s${pos}`}>
                      <Rect x={tx(pos) - studW / 2} y={wallTop + 8}
                        width={studW} height={snapH * scale - 16}
                        fill={isEdge ? '#8a9aa4' : '#b8c4cc'} stroke="#5a7080" strokeWidth={1} cornerRadius={2}
                        onDblClick={() => removeStud(pos)} />
                      {overlapNode}
                    </Group>
                  )
                })}
                {positions.map((pos, i) => {
                  if (i === 0) return null
                  const prev = positions[i - 1], dist = pos - prev, mx = tx(prev) + (dist * scale / 2), dy = wallBot + 12
                  return (
                    <Group key={`d${pos}`}>
                      <Line points={[tx(prev), dy, tx(pos), dy]} stroke="#aaa" strokeWidth={1} />
                      <Line points={[tx(prev), dy - 4, tx(prev), dy + 4]} stroke="#aaa" strokeWidth={1} />
                      <Line points={[tx(pos), dy - 4, tx(pos), dy + 4]} stroke="#aaa" strokeWidth={1} />
                      <Text x={mx - 12} y={dy + 5} text={`${dist}`} fontSize={10} fill="#555" />
                    </Group>
                  )
                })}
              </Layer>
            </Stage>
          </div>
        </>
      )}

      {/* ─── Результат ─── */}
      {result && (
        <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Результат</h3>
          <p style={{ color: '#666', fontSize: 13 }}>{form.liningType.toUpperCase()} · {gklLayersFixed ?? form.gklLayers} сл. ГКЛ · {isC623 ? 'ПП 60×27' : `ПС ${profileLabel}×50`}</p>
          {result.needsOverlap && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: 10, borderRadius: 6, marginBottom: 12 }}>
              ⚠️ Высота {form.height}мм — стойки наращиваются{isC623 ? ` · удлинители: ${result.extenders} шт` : ' с перехлёстом'}
            </div>
          )}
          <p>ПН {guideLabel}: <b>{result.guideRail.toFixed(2)} м</b></p>
          <p>{studLabel}: <b>{result.stud.toFixed(2)} м</b></p>
          <p>Стоек: <b>{result.studsCount} шт</b></p>
          {isC623 && <><p>Прямые подвесы: <b>{result.hangers} шт</b></p>{result.extenders > 0 && <p>Удлинители: <b>{result.extenders} шт</b></p>}</>}
          <p>ГКЛ ({gklLayersFixed ?? form.gklLayers} сл.): <b>{result.gklArea.toFixed(2)} м²</b></p>
          {hasInsulation && insulationArea && <p>Утеплитель: <b>{insulationArea} м²</b></p>}

          {/* ─── Раскрой ─── */}
          {(() => {
            const { pn, stud } = result.cutList
            const roleColor: Record<string, string> = {
              floor: '#e8f4ff', ceiling: '#e8f4ff', sill: '#fff8e8',
              lintel: '#fff0e8', stud: '#f0ffe8', stud_part: '#f0ffe8',
            }
            const renderCutList = (cl: typeof pn, title: string) => (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 6 }}>
                  {title} — {cl.totalBars} шт, остаток {cl.totalWaste}мм
                </div>
                {cl.bars.map((bar, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: '#888', minWidth: 52 }}>Пруток {i + 1}:</span>
                    <div style={{ display: 'flex', flex: 1, height: 22, border: '1px solid #ccc', borderRadius: 3, overflow: 'hidden' }}>
                      {bar.pieces.map((p, j) => (
                        <div key={j}
                          title={p.piece.label}
                          style={{
                            width: `${(p.piece.length / 3000) * 100}%`,
                            background: roleColor[p.piece.role] ?? '#eee',
                            borderRight: '1px solid #bbb',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, color: '#555', overflow: 'hidden', whiteSpace: 'nowrap',
                          }}>
                          {p.piece.length >= 200 ? p.piece.label : ''}
                        </div>
                      ))}
                      {bar.waste > 0 && (
                        <div style={{
                          width: `${(bar.waste / 3000) * 100}%`,
                          background: '#f5f5f5',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, color: '#aaa',
                        }}>
                          {bar.waste >= 200 ? `ост ${bar.waste}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
            return (
              <div style={{ marginTop: 16, padding: '12px 14px', background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#333', marginBottom: 4 }}>Раскрой (прутки 3000мм)</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, marginBottom: 8 }}>
                  {[[guideLabel, '#e8f4ff'], ['Перемычка', '#fff0e8'], [studLabel, '#f0ffe8'], ['Остаток', '#f5f5f5']].map(([label, color]) => (
                    <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 12, height: 12, background: color, border: '1px solid #ccc', borderRadius: 2, display: 'inline-block' }} />
                      {label}
                    </span>
                  ))}
                </div>
                {renderCutList(pn, `ПН ${guideLabel}`)}
                {renderCutList(stud, studLabel)}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
