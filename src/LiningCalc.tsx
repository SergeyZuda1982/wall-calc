import { useState, useRef } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Arrow } from 'react-konva'
import type { LiningInput, LiningResult, Opening, EdgeProfile, PlywoodInsert, BoardSheetResult, BoardLayerLayout } from './types'
import { DEFAULT_BOARD_SPEC, boardLabel } from './types'
import { calcSheetLayout } from './core/calcSheetLayout'
import SheetLayoutCanvas from './components/SheetLayoutCanvas'
import { BoardSpecSelector } from './components/BoardSpecSelector'
import { calcLining } from './core/calcLining'
import { calcStudMaterial } from './core/calcStudMaterial'
import { getLiningMaxHeight } from './data/liningMaxHeight'
import { useProjectStore } from './store/useProjectStore'
import { normalizeProfile, maxStudHeight, integrateHeight, interpolateY } from './core/profileGeometry'
import ProfileEditor from './components/ProfileEditor'

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
function emptyOpening(): Opening {
  return { id: newLid(), type: 'opening', pos: 0, width: 0, height: 2100, sillHeight: 0 }
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
  layer1: DEFAULT_BOARD_SPEC,
  layer2: DEFAULT_BOARD_SPEC,
  plywoodInserts: [],
}

export default function LiningCalc({ canvasW = 820 }: { canvasW?: number }) {
  const CANVAS_W = canvasW
  const [form, setForm] = useState<LiningInput>(DEFAULT_INPUT)
  const [result, setResult] = useState<LiningResult | null>(null)
  const [heightWarning, setHeightWarning] = useState<string | null>(null)
  const [hasInsulation, setHasInsulation] = useState(false)
  const [positions, setPositions] = useState<number[]>([])
  const [snapL, setSnapL] = useState(0)
  const [snapH, setSnapH] = useState(0)
  const [snapWorstH, setSnapWorstH] = useState(0)
  const [snapCeilingProfile, setSnapCeilingProfile] = useState<EdgeProfile>([])
  const [snapFloorProfile, setSnapFloorProfile] = useState<EdgeProfile>([])
  const [shiftInput, setShiftInput] = useState('100')
  const [sheetLayerTab, setSheetLayerTab] = useState<1 | 2>(1)
  const [showOffcuts, setShowOffcuts] = useState(false)
  const basePositions = useRef<number[]>([])
  const gridShift = useRef(0)

  const { linings, activeLiningId, addLining, updateLining, setActiveLining } = useProjectStore()

  function set<K extends keyof LiningInput>(key: K, value: LiningInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function addOpening(type: 'door' | 'window' | 'opening') {
    const o = type === 'door' ? emptyDoor() : type === 'window' ? emptyWindow() : emptyOpening()
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

  function snapInput() {
    return {
      ...form,
      gklLayers: (gklLayersFixed ?? form.gklLayers) as 1 | 2,
      length: snapL,
      height: snapH,
      ceilingProfile: snapCeilingProfile,
      floorProfile: snapFloorProfile,
    }
  }

  function addStud(xpx: number) {
    if (!snapL) return
    const sc = (CANVAS_W - PAD * 2) / snapL
    const mm = Math.round((xpx - PAD) / sc / 100) * 100
    if (mm <= 0 || mm >= snapL) return
    const next = [...new Set([...positions, mm])].sort((a, b) => a - b)
    setPositions(next)
    setResult(calcLining(snapInput(), next))
  }

  function removeStud(pos: number) {
    if (pos === 0 || pos === snapL) return
    const next = positions.filter(p => p !== pos)
    setPositions(next)
    setResult(calcLining(snapInput(), next))
  }

  function calculate() {
    const input = { ...form, gklLayers: (gklLayersFixed ?? form.gklLayers) as 1 | 2 }

    const ceilingProfile = normalizeProfile(form.ceilingProfile, form.length, form.height)
    const floorProfile = normalizeProfile(form.floorProfile, form.length, 0)
    const worstH = maxStudHeight(ceilingProfile, floorProfile, form.length)

    if (!isC623) {
      const maxH = getLiningMaxHeight(form.liningType, form.profileType, form.step)
      if (maxH > 0 && worstH > maxH) {
        setHeightWarning(`⚠️ Высота ${(worstH / 1000).toFixed(2)}м превышает максимум ${(maxH / 1000).toFixed(2)}м по Кнауф для ${form.liningType.toUpperCase()}, ПС${profileLabel}, шаг ${form.step}мм.`)
      } else setHeightWarning(null)
    } else setHeightWarning(null)

    const studs = buildPos(form.length, form.step)
    basePositions.current = studs
    gridShift.current = 0
    setPositions(studs)
    setSnapL(form.length)
    setSnapH(form.height)
    setSnapWorstH(worstH)
    setSnapCeilingProfile(ceilingProfile)
    setSnapFloorProfile(floorProfile)
    setResult(calcLining({ ...input, length: form.length, ceilingProfile, floorProfile }, studs))
  }

  function applyShift(delta: number) {
    gridShift.current += delta
    const shifted = basePositions.current.map(p => {
      if (p === 0 || p === snapL) return p
      const np = p + gridShift.current
      return np > 0 && np < snapL ? np : p
    }).filter((p, i, arr) => arr.indexOf(p) === i).sort((a, b) => a - b)
    setPositions(shifted)
    if (snapL) setResult(calcLining(snapInput(), shifted))
  }

  const scale = snapL > 0 ? (CANVAS_W - PAD * 2) / snapL : 1
  // Геометрия потолка/пола облицовки — ломаные линии (как и в перегородке).
  // Для плоской стены snapCeilingProfile/snapFloorProfile — это просто 2 точки
  // на одном уровне, и все формулы ниже сводятся к прежнему поведению.
  const refTop = snapCeilingProfile.length ? Math.max(...snapCeilingProfile.map(p => p.y)) : snapH
  const refBottom = snapFloorProfile.length ? Math.min(...snapFloorProfile.map(p => p.y)) : 0
  const wallTopAt = (pos: number) => TOP_PAD + (refTop - interpolateY(snapCeilingProfile, pos)) * scale
  const wallBotAt = (pos: number) => TOP_PAD + (refTop - interpolateY(snapFloorProfile, pos)) * scale
  const canvasH = snapL > 0 ? (refTop - refBottom) * scale + TOP_PAD + BOT_PAD + 20 : 200
  const wallTop = wallTopAt(0), wallBot = wallBotAt(0)
  const studW = Math.max(4, 50 * scale)
  const tx = (mm: number) => PAD + mm * scale

  // Точки полилинии направляющей (потолок или пол) на участке [fromX, toX],
  // с изломами в точках перегиба профиля — уклон/ступень видны на самой
  // направляющей, а не только в высоте стоек. Тот же приём, что и в App.tsx.
  function railPoints(profile: EdgeProfile, yAt: (pos: number) => number, fromX: number, toX: number): number[] {
    const xs = new Set<number>([fromX, toX])
    for (const p of profile) if (p.x > fromX && p.x < toX) xs.add(p.x)
    return [...xs].sort((a, b) => a - b).flatMap(x => [tx(x), yAt(x)])
  }

  // Локальная высота/тип/ориентация КАЖДОЙ стойки — из результата расчёта
  // (result.studInfos), а не пересчитываются заново в компоненте. Так чертёж
  // гарантированно не может разойтись со сметой — тот же приём, что и в App.tsx.
  const heightMap = new Map((result?.studInfos ?? []).map(si => [si.pos, si.height]))
  const kindMap = new Map((result?.studInfos ?? []).map(si => [si.pos, si.kind]))
  const orientationMap = new Map((result?.studInfos ?? []).map(si => [si.pos, si.orientation]))

  // Площадь утеплителя — вся стена минус проёмы (с учётом геометрии потолка/пола)
  const insulationArea = result
    ? (() => {
        const cp = normalizeProfile(form.ceilingProfile, form.length, form.height)
        const fp = normalizeProfile(form.floorProfile, form.length, 0)
        const area = integrateHeight(cp, fp, 0, form.length)
        const openingsArea = form.openings.filter(o => o.width > 0).reduce((s, o) => s + o.width * o.height, 0)
        return ((area - openingsArea) / 1_000_000).toFixed(2)
      })()
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
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 13 }}>{(gklLayersFixed ?? form.gklLayers) === 2 ? '1-й слой' : 'Материал'}</label><br />
          <BoardSpecSelector value={form.layer1} onChange={v => set('layer1', v)} />
        </div>
        {(gklLayersFixed ?? form.gklLayers) === 2 && (
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 13 }}>2-й слой</label><br />
            <BoardSpecSelector value={form.layer2} onChange={v => set('layer2', v)} />
          </div>
        )}
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

      {/* ─── Геометрия потолка/пола (скос, ломаная, ступени) ─── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.ceilingProfile}
              onChange={e => set('ceilingProfile', e.target.checked
                ? [{ x: 0, y: form.height }, { x: form.length, y: form.height }]
                : undefined)} />
            Потолок с уклоном / ломаной линией
          </label>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.floorProfile}
              onChange={e => set('floorProfile', e.target.checked
                ? [{ x: 0, y: 0 }, { x: form.length, y: 0 }]
                : undefined)} />
            Пол с уклоном / ступенями
          </label>
        </div>
        {form.ceilingProfile && (
          <ProfileEditor label="Потолок" yHint="высота потолка от пола"
            points={form.ceilingProfile} length={form.length} baseY={form.height}
            onChange={pts => set('ceilingProfile', pts)} />
        )}
        {form.floorProfile && (
          <ProfileEditor label="Пол" yHint="уровень пола (0 = базовый)"
            points={form.floorProfile} length={form.length} baseY={0}
            onChange={pts => set('floorProfile', pts)} />
        )}
      </div>

      {/* ─── Проёмы ─── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#444' }}>Проёмы</span>
          <button onClick={() => addOpening('door')}
            style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: '#f0f4ff', border: '1px solid #aac', borderRadius: 4 }}>+ Дверной</button>
          <button onClick={() => addOpening('window')}
            style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: '#f0fff4', border: '1px solid #aca', borderRadius: 4 }}>+ Оконный</button>
          <button onClick={() => addOpening('opening')}
            style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 4 }}>+ Проём</button>
        </div>
        {form.openings.length === 0 && <p style={{ margin: 0, fontSize: 12, color: '#999' }}>Нет проёмов</p>}
        {form.openings.map((o, idx) => {
          const bg = o.type === 'door' ? '#f8f0ff' : o.type === 'window' ? '#f0fff4' : '#f5f5f5'
          const border = o.type === 'door' ? '#dcc' : o.type === 'window' ? '#cdc' : '#ccc'
          const icon = o.type === 'door' ? '🚪' : o.type === 'window' ? '🪟' : '▭'
          const label = o.type === 'door' ? 'Дверь' : o.type === 'window' ? 'Окно' : 'Проём'
          return (
          <div key={o.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end',
            marginBottom: 8, padding: '8px 10px', background: bg,
            border: `1px solid ${border}`, borderRadius: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#666', minWidth: 60, paddingBottom: 6 }}>
              {icon} {label} {idx + 1}
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
            {(o.type === 'window' || o.type === 'opening') && (
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: '#666' }}>Подоконник (мм)</label><br />
                <input type="number" value={o.sillHeight || ''} onChange={e => updateOpening(o.id, { sillHeight: Number(e.target.value) })} style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} placeholder="0 — от пола" />
              </div>
            )}
            <button onClick={() => removeOpening(o.id)}
              style={{ padding: '5px 8px', fontSize: 13, cursor: 'pointer', background: '#fff', border: '1px solid #e05', color: '#e05', borderRadius: 4, marginBottom: 1 }}>🗑</button>
          </div>
          )
        })}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={hasInsulation} onChange={e => setHasInsulation(e.target.checked)} />
          Утеплитель
        </label>
      </div>

      {/* ─── Закладные из фанеры ─── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Закладные (фанера)</span>
          <button onClick={() => {
            const newIns: PlywoodInsert = { id: `ply${Date.now()}`, x: 0, y: 800, width: 600, height: 400 }
            set('plywoodInserts', [...(form.plywoodInserts ?? []), newIns])
          }} style={{ fontSize: 12, padding: '3px 10px', cursor: 'pointer', border: '1px solid #aaa', borderRadius: 4, background: '#fff' }}>
            + Добавить
          </button>
        </div>
        {(form.plywoodInserts ?? []).map((ins, idx) => (
          <div key={ins.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8, padding: '8px 10px', background: '#fdf8ee', border: '1px solid #e8d99a', borderRadius: 6 }}>
            <div><label style={{ fontSize: 11, color: '#666' }}>X от начала, мм</label><br />
              <input type="number" value={ins.x} min={0} style={{ width: 90, padding: '5px 6px', fontSize: 13 }}
                onChange={e => { const v = [...(form.plywoodInserts??[])]; v[idx]={...ins,x:Number(e.target.value)}; set('plywoodInserts',v) }} />
            </div>
            <div><label style={{ fontSize: 11, color: '#666' }}>Y от пола, мм</label><br />
              <input type="number" value={ins.y} min={0} style={{ width: 90, padding: '5px 6px', fontSize: 13 }}
                onChange={e => { const v = [...(form.plywoodInserts??[])]; v[idx]={...ins,y:Number(e.target.value)}; set('plywoodInserts',v) }} />
            </div>
            <div><label style={{ fontSize: 11, color: '#666' }}>Ширина, мм</label><br />
              <input type="number" value={ins.width} min={1} style={{ width: 90, padding: '5px 6px', fontSize: 13 }}
                onChange={e => { const v = [...(form.plywoodInserts??[])]; v[idx]={...ins,width:Number(e.target.value)}; set('plywoodInserts',v) }} />
            </div>
            <div><label style={{ fontSize: 11, color: '#666' }}>Высота, мм</label><br />
              <input type="number" value={ins.height} min={1} style={{ width: 90, padding: '5px 6px', fontSize: 13 }}
                onChange={e => { const v = [...(form.plywoodInserts??[])]; v[idx]={...ins,height:Number(e.target.value)}; set('plywoodInserts',v) }} />
            </div>
            <button onClick={() => set('plywoodInserts', (form.plywoodInserts??[]).filter((_,i)=>i!==idx))}
              style={{ padding: '5px 10px', fontSize: 13, cursor: 'pointer', border: '1px solid #cc8888', borderRadius: 4, background: '#fff0f0', color: '#c00' }}>✕</button>
          </div>
        ))}
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
            <Stage width={CANVAS_W} height={canvasH}
              ref={node => { if (node) node.container().style.touchAction = 'pan-y' }}>
              <Layer>
                <Rect x={0} y={0} width={CANVAS_W} height={canvasH} fill="#f8f8f8"
                  onDblClick={e => { const pos = e.target.getStage()?.getPointerPosition(); if (pos) addStud(pos.x) }} />
                <Arrow points={[tx(0), 14, tx(snapL), 14]} stroke="#555" fill="#555" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Arrow points={[tx(snapL), 14, tx(0), 14]} stroke="#555" fill="#555" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Text x={tx(snapL / 2) - 28} y={4} text={`${snapL} мм`} fontSize={11} fill="#333" fontStyle="bold" />
                <Arrow points={[PAD - 22, wallTop + 8, PAD - 22, wallBot - 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Arrow points={[PAD - 22, wallBot - 8, PAD - 22, wallTop + 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Text x={8} y={(wallTop + wallBot) / 2}
                  text={`${Math.round(interpolateY(snapCeilingProfile, 0) - interpolateY(snapFloorProfile, 0))}`}
                  fontSize={11} fill="#444" rotation={-90} />

                {/* Вторая размерная стрелка справа — только если потолок/пол с уклоном
                    (высота у правого края отличается от левого), как и в перегородке */}
                {(() => {
                  const hRight = interpolateY(snapCeilingProfile, snapL) - interpolateY(snapFloorProfile, snapL)
                  const hLeft = interpolateY(snapCeilingProfile, 0) - interpolateY(snapFloorProfile, 0)
                  if (Math.abs(hRight - hLeft) < 1) return null
                  const xRight = tx(snapL) + 22
                  const topR = wallTopAt(snapL), botR = wallBotAt(snapL)
                  return (
                    <Group>
                      <Arrow points={[xRight, topR + 8, xRight, botR - 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                      <Arrow points={[xRight, botR - 8, xRight, topR + 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                      <Text x={xRight + 6} y={(topR + botR) / 2} text={`${Math.round(hRight)}`} fontSize={11} fill="#444" rotation={-90} />
                    </Group>
                  )
                })()}

                {/* Полотно облицовки — полигон по двум профилям (потолок сверху, пол снизу) */}
                <Line
                  points={[
                    ...railPoints(snapCeilingProfile, wallTopAt, 0, snapL),
                    ...(() => {
                      const bottom = railPoints(snapFloorProfile, wallBotAt, 0, snapL)
                      const rev: number[] = []
                      for (let i = bottom.length - 2; i >= 0; i -= 2) rev.push(bottom[i], bottom[i + 1])
                      return rev
                    })(),
                  ]}
                  closed fill="#e8f0e8" stroke="#aaa" strokeWidth={1} />

                {/* Направляющие — следуют профилю потолка/пола — псевдо-3D (три слоя) */}
                {[
                  railPoints(snapCeilingProfile, pos => wallTopAt(pos) + 4, 0, snapL),
                  railPoints(snapFloorProfile, pos => wallBotAt(pos) - 4, 0, snapL),
                ].map((pts, i) => (
                  <Group key={`rail${i}`}>
                    <Line points={pts} stroke="#384f60" strokeWidth={9}   lineCap="round" lineJoin="round" />
                    <Line points={pts} stroke="#6a8898" strokeWidth={5.5} lineCap="round" lineJoin="round" />
                    <Line points={pts} stroke="#aec8d4" strokeWidth={2}   lineCap="round" lineJoin="round" />
                  </Group>
                ))}

                {/* Позиции рядовых стоек сверху — фиксированный уровень TOP_PAD,
                    он всегда выше самой высокой точки потолка, скос не задевает */}
                {positions.filter(p => p !== 0 && p !== snapL).map(pos => (
                  <Group key={`tp${pos}`}>
                    <Line points={[tx(pos), TOP_PAD - 6, tx(pos), TOP_PAD - 16]} stroke="#666" strokeWidth={1} />
                    <Text x={tx(pos) - 14} y={TOP_PAD - 28} text={`${pos}`} fontSize={9} fill="#333" />
                  </Group>
                ))}
                {positions.filter(p => p !== 0 && p !== snapL).map((pos, i, arr) => {
                  const prev = i === 0 ? 0 : arr[i - 1], dist = pos - prev
                  return <Text key={`td${pos}`} x={tx(prev) + (dist * scale / 2) - 10} y={TOP_PAD - 18} text={`${dist}`} fontSize={8} fill="#888" />
                })}
                {positions.map((pos) => {
                  const isEdge = pos === 0 || pos === snapL
                  const insideOpening = form.openings.find(
                    o => o.width > 0 && pos > o.pos && pos < o.pos + o.width
                  )
                  // Локальная высота/ориентация именно этой стойки — из результата
                  // расчёта; если расчёт почему-то ещё не успел её найти (например,
                  // сразу после сдвига гребёнки), считаем по зафиксированному профилю.
                  const localH = heightMap.get(pos)
                    ?? (interpolateY(snapCeilingProfile, pos) - interpolateY(snapFloorProfile, pos))
                  const orientation = orientationMap.get(pos) ?? (positions.indexOf(pos) % 2 === 0 ? 'down' : 'up')
                  const localTop = wallTopAt(pos), localBot = wallBotAt(pos)
                  const overlapNode = (!insideOpening && !isC623 && localH > 3000) ? (() => {
                    const kind = kindMap.get(pos) ?? edgeKind(pos)
                    const calcKind = (kind === 'door' || kind === 'window') ? 'middle' : kind
                    const { overlapZones } = calcStudMaterial(localH, calcKind, overlap, orientation)
                    if (!overlapZones.length) return null
                    const baseY = localTop + 8
                    return (
                      <Group key={`ov${pos}`}>
                        {overlapZones.map((zone, zi) => {
                          const zFrom = baseY + zone.from * scale
                          const zTo   = baseY + zone.to   * scale
                          const zH    = zTo - zFrom
                          const zoneMm = zone.to - zone.from
                          return (
                            <Group key={zi}>
                              <Rect x={tx(pos) - studW / 2} y={zFrom} width={studW} height={zH}
                                fill="rgba(255,140,0,0.3)" stroke="#ff8c00" strokeWidth={1.5} dash={[4, 3]} />
                              <Text x={tx(pos) + studW / 2 + 3} y={zFrom + zH / 2 - 5}
                                text={`${zoneMm}мм`} fontSize={9} fill="#c05000" fontStyle="bold" />
                            </Group>
                          )
                        })}
                      </Group>
                    )
                  })() : null
                  return (
                    <Group key={`s${pos}`}>
                      {(() => {
                        const base  = isEdge ? '#8a9aa4' : '#b8c4cc'
                        const hi    = isEdge ? '#a3b3bd' : '#d0dce4'
                        const sh    = isEdge ? '#6c7c86' : '#9aa6ae'
                        return <Rect x={tx(pos) - studW / 2} y={localTop + 8}
                          width={studW} height={(localBot - localTop) - 16}
                          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                          fillLinearGradientEndPoint={{ x: studW, y: 0 }}
                          fillLinearGradientColorStops={[0, hi, 0.18, base, 0.82, base, 1, sh]}
                          stroke="#5a7080" strokeWidth={1} cornerRadius={2}
                          onDblClick={() => removeStud(pos)} />
                      })()}
                      {overlapNode}
                    </Group>
                  )
                })}
                {positions.map((pos, i) => {
                  if (i === 0) return null
                  const prev = positions[i - 1], dist = pos - prev, mx = tx(prev) + (dist * scale / 2)
                  const dy = Math.max(wallBotAt(prev), wallBotAt(pos)) + 12
                  return (
                    <Group key={`d${pos}`}>
                      <Line points={[tx(prev), dy, tx(pos), dy]} stroke="#aaa" strokeWidth={1} />
                      <Line points={[tx(prev), dy - 4, tx(prev), dy + 4]} stroke="#aaa" strokeWidth={1} />
                      <Line points={[tx(pos), dy - 4, tx(pos), dy + 4]} stroke="#aaa" strokeWidth={1} />
                      <Text x={mx - 12} y={dy + 5} text={`${dist}`} fontSize={10} fill="#555" />
                    </Group>
                  )
                })}
              {/* ─── Закладные из фанеры ─── */}
              {(snapL > 0 && (form.plywoodInserts ?? []).length > 0) && (form.plywoodInserts ?? []).map(ins => {
                const midX = ins.x + ins.width / 2
                const floorY = wallBotAt(midX)
                const pxX = tx(ins.x)
                const pxY = floorY - (ins.y + ins.height) * scale
                const pxW = ins.width * scale
                const pxH = ins.height * scale
                if (pxW < 2 || pxH < 2) return null
                const hatchLines: React.ReactNode[] = []
                const step = 12
                const total = pxW + pxH
                for (let d = 0; d < total; d += step) {
                  const x1 = pxX + Math.min(d, pxW)
                  const y1 = pxY + Math.max(0, d - pxW)
                  const x2 = pxX + Math.max(0, d - pxH)
                  const y2 = pxY + Math.min(d, pxH)
                  hatchLines.push(<Line key={d} points={[x1,y1,x2,y2]} stroke="#a0622a" strokeWidth={0.8} opacity={0.5} />)
                }
                return (
                  <Group key={ins.id} x={0} y={0} draggable
                    onDragEnd={e => {
                      const dx = e.target.x()
                      const dy = e.target.y()
                      const newXmm = Math.max(0, Math.min(snapL - ins.width,
                        Math.round((ins.x + dx / scale) / 10) * 10))
                      const newYmm = Math.max(0, Math.round((ins.y - dy / scale) / 10) * 10)
                      e.target.x(0); e.target.y(0)
                      set('plywoodInserts', (form.plywoodInserts ?? []).map(i =>
                        i.id === ins.id ? { ...i, x: newXmm, y: newYmm } : i
                      ))
                    }}
                  >
                    <Rect x={pxX} y={pxY} width={pxW} height={pxH}
                      fill="rgba(180,120,60,0.18)" stroke="#a0622a" strokeWidth={1.5} cornerRadius={2} />
                    {hatchLines}
                    <Text x={pxX + 4} y={pxY + 4} text="фанера"
                      fontSize={Math.max(9, Math.min(12, pxH * 0.25))} fill="#7a4a1a" />
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
          <p style={{ color: '#666', fontSize: 13 }}>{form.liningType.toUpperCase()} · {gklLayersFixed ?? form.gklLayers} сл. {boardLabel(form.layer1)}{(gklLayersFixed ?? form.gklLayers) === 2 ? ` + ${boardLabel(form.layer2)}` : ''} · {isC623 ? 'ПП 60×27' : `ПС ${profileLabel}×50`}</p>
          {result.needsOverlap && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: 10, borderRadius: 6, marginBottom: 12 }}>
              ⚠️ Высота {snapWorstH}мм — стойки наращиваются{isC623 ? ` · удлинители: ${result.extenders} шт` : ' с перехлёстом'}
            </div>
          )}
          <p>ПН {guideLabel}: <b>{result.guideRail.toFixed(2)} м</b></p>
          <p>{studLabel}: <b>{result.stud.toFixed(2)} м</b></p>
          <p>Стоек: <b>{result.studsCount} шт</b></p>
          {isC623 && <><p>Прямые подвесы: <b>{result.hangers} шт</b></p>{result.extenders > 0 && <p>Удлинители: <b>{result.extenders} шт</b></p>}</>}
          <p>ГКЛ ({gklLayersFixed ?? form.gklLayers} сл.): <b>{result.gklArea.toFixed(2)} м²</b></p>
          {hasInsulation && insulationArea && <p>Утеплитель: <b>{insulationArea} м²</b></p>}

          {/* ─── Саморезы ─── */}
          {(() => {
            const s = result.screws
            const plus20 = (n: number) => Math.ceil(n * 1.2)
            const rowSt = { paddingRight: 14, paddingBottom: 3, color: '#555', fontSize: 13 }
            const tdSt  = { paddingBottom: 3, fontSize: 13 }
            const rows: React.ReactNode[] = []
            if (s.ln11 > 0) rows.push(
              <tr key="ln"><td style={rowSt}>LN 11 (клопы):</td>
                <td style={tdSt}><b>{s.ln11}</b> шт</td></tr>
            )
            if (s.count25 > 0) rows.push(
              <tr key="s25"><td style={rowSt}>{s.code25} 25 мм:</td>
                <td style={tdSt}>
                  <b>{s.count25}</b><sup style={{fontSize:9,color:'#888'}}>*</sup> шт
                  <span style={{color:'#aaa',margin:'0 4px'}}>〜</span>
                  <b>{plus20(s.count25)}</b> шт
                </td></tr>
            )
            if (s.count35 > 0) rows.push(
              <tr key="s35"><td style={rowSt}>{s.code35} 35 мм:</td>
                <td style={tdSt}>
                  <b>{s.count35}</b><sup style={{fontSize:9,color:'#888'}}>*</sup> шт
                  <span style={{color:'#aaa',margin:'0 4px'}}>〜</span>
                  <b>{plus20(s.count35)}</b> шт
                </td></tr>
            )
            if (s.woodScrews > 0) rows.push(
              <tr key="wood"><td style={rowSt}>Саморезы по дереву:</td>
                <td style={tdSt}><b>{s.woodScrews}</b> шт</td></tr>
            )
            if (rows.length === 0) return null
            return (
              <table style={{marginTop: 6, marginBottom: 4}}><tbody>
                <tr><td colSpan={2} style={{paddingBottom:3,color:'#888',fontSize:11}}>
                  Саморезы (<sup style={{fontSize:9}}>*</sup> Кнауф · 〜 сторонний +20%)
                </td></tr>
                {rows}
              </tbody></table>
            )
          })()}

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
                    <span style={{ fontSize: 11, color: '#888', minWidth: 52 }}>Профиль {i + 1}:</span>
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

          {/* ─── Раскрой листов ─── */}
          {(() => {
            if (!snapL || !result) return null
            const layers = gklLayersFixed ?? form.gklLayers
            const firstStudForSheet = positions.find(p => p > 0 && p < snapL) ?? form.step
            const sheetLayout: BoardSheetResult = calcSheetLayout(
              snapL,
              snapCeilingProfile,
              snapFloorProfile,
              firstStudForSheet,
              form.step,
              layers as 1 | 2,
              form.openings,
              form.layer1,
              form.layer2,
              1, // облицовка — одна сторона
            )

            const layerLayouts: Record<number, BoardLayerLayout | null> = {
              1: sheetLayout.layer1,
              2: sheetLayout.layer2,
            }
            const activeLayout = layerLayouts[layers === 2 ? sheetLayerTab : 1]
            if (!activeLayout) return null

            const { totalSheetsNeeded, totalUsedAreaM2, totalSheetAreaM2, totalOffcutAreaM2, totalWastePercent } = sheetLayout

            return (
              <div style={{ marginTop: 20, background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 14 }}>Раскрой листов</b>

                  {/* Вкладки слоёв — только при 2 слоях */}
                  {layers === 2 && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {([1, 2] as const).map(l => (
                        <button key={l}
                          onClick={() => setSheetLayerTab(l)}
                          style={{
                            padding: '3px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                            border: '1px solid #ccc',
                            background: sheetLayerTab === l ? '#3a7bd5' : '#f5f5f5',
                            color: sheetLayerTab === l ? '#fff' : '#333',
                          }}>
                          Слой {l}
                        </button>
                      ))}
                    </div>
                  )}

                  <span style={{ fontSize: 12, color: '#888' }}>
                    {boardLabel(activeLayout.spec)} · {activeLayout.spec.sheetWidth}×{activeLayout.spec.sheetLength}мм
                  </span>
                </div>

                {/* Статистика текущего слоя */}
                <div style={{ fontSize: 12, color: '#555', marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                  <span>▲ Листов: <b>{activeLayout.sheetsNeeded}</b></span>
                  <span>В работе: <b>{activeLayout.usedAreaM2.toFixed(2)} м²</b></span>
                  <span>Куплено: <b>{activeLayout.sheetAreaM2.toFixed(2)} м²</b></span>
                </div>

                {/* Итоговая статистика по облицовке */}
                <div style={{
                  fontSize: 12, background: '#f0f7ff', border: '1px solid #b3d4ff',
                  borderRadius: 6, padding: '6px 10px', marginBottom: 10,
                  display: 'flex', flexWrap: 'wrap', gap: '6px 16px', color: '#1a4a8a',
                }}>
                  <b>Облицовка ({layers} сл. × общий пул):</b>
                  <span>Листов: <b>{totalSheetsNeeded}</b></span>
                  <span>В работе: <b>{totalUsedAreaM2.toFixed(2)} м²</b></span>
                  <span>Куплено: <b>{totalSheetAreaM2.toFixed(2)} м²</b></span>
                  <span>Финал. обрезки: <b>{totalOffcutAreaM2.toFixed(2)} м²</b></span>
                  <span>Отходы: <b>{totalWastePercent}%</b></span>
                </div>

                <SheetLayoutCanvas
                  layout={activeLayout}
                  wallL={snapL}
                  wallH={snapWorstH}
                  canvasW={CANVAS_W}
                  firstStud={firstStudForSheet}
                  step={form.step}
                />

                {/* ── Панель остатков ── */}
                {sheetLayout.finalOffcuts.length > 0 && (() => {
                  const offcuts = [...sheetLayout.finalOffcuts]
                    .sort((a, b) => b.w * b.h - a.w * a.h)
                  const totalM2 = offcuts.reduce((s, o) => s + o.w * o.h, 0) / 1e6
                  return (
                    <div style={{ marginTop: 12 }}>
                      <button
                        onClick={() => setShowOffcuts(v => !v)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          background: 'none', border: '1px solid #ddd', borderRadius: 6,
                          padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                          color: '#555', width: '100%', textAlign: 'left',
                        }}>
                        <span>🪚 Остатки: <b>{offcuts.length} шт</b>, <b>{totalM2.toFixed(2)} м²</b></span>
                        <span style={{ marginLeft: 'auto' }}>{showOffcuts ? '▲' : '▼'}</span>
                      </button>

                      {showOffcuts && (
                        <div style={{
                          marginTop: 8, padding: 10, background: '#fafafa',
                          border: '1px solid #eee', borderRadius: 6,
                        }}>
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                            Масштаб: 1px ≈ 15мм. Сортировка по площади.
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-end' }}>
                            {offcuts.map((o, idx) => {
                              const area = o.w * o.h
                              const sc = Math.min(90 / o.h, 130 / o.w)
                              const dw = Math.round(o.w * sc)
                              const dh = Math.round(o.h * sc)
                              const bg = area > 500000 ? '#4caf50'
                                : area > 200000 ? '#26a69a'
                                : area > 80000  ? '#42a5f5'
                                : '#ff9800'
                              return (
                                <div key={idx} title={`${Math.round(o.w)}×${Math.round(o.h)}мм — ${(area/1e6).toFixed(3)} м²`}
                                  style={{
                                    width: dw, height: dh,
                                    background: bg, borderRadius: 3, opacity: 0.85,
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center',
                                    fontSize: Math.max(9, Math.min(11, dw / 6)),
                                    color: '#fff', fontWeight: 600, lineHeight: 1.2,
                                    cursor: 'default', flexShrink: 0,
                                  }}>
                                  <span>{o.w}</span>
                                  <span>×</span>
                                  <span>{o.h}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
