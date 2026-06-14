import { useState, useRef } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Arrow } from 'react-konva'
import type { WallInput, Opening } from './types'
import type { WallEntry, LiningEntry } from './store/useProjectStore'
import { PROFILES } from './data/profiles'
import { useWallCalc, CANVAS_W, PAD } from './hooks/useWallCalc'
import { MIN_GAP } from './core/buildPositions'
import { useProjectStore } from './store/useProjectStore'
import LiningCalc from './LiningCalc'
import { calcStudMaterial } from './core/calcStudMaterial'

// Цвета оцинкованной стали
const STEEL_NORMAL   = '#b8c4cc'
const STEEL_EDGE     = '#8a9aa4'
const STEEL_DOOR     = '#7a8e99'
const STEEL_STROKE   = '#5a7080'

const PROFILE_LEN = 3

let _openingIdCounter = 1
function newOpeningId() { return `op_${_openingIdCounter++}` }

function emptyDoor(): Opening {
  return { id: newOpeningId(), type: 'door', pos: 0, width: 0, height: 2100, sillHeight: 0 }
}
function emptyWindow(): Opening {
  return { id: newOpeningId(), type: 'window', pos: 0, width: 0, height: 1200, sillHeight: 900 }
}

const DEFAULT_INPUT: WallInput = {
  wallType: 'c111',
  profileType: 'ps50',
  profileThickness: '06',
  abutment: 'both',
  length: 6160,
  height: 3600,
  step: 600,
  firstStud: 600,
  openings: [],
  customOverlap: null,
}

// ─── Типы для сводной ведомости ──────────────────────────────────────────────

type MaterialKey =
  | 'pp_60x27' | 'pn_27x28'
  | 'ps_50' | 'pn_50'
  | 'ps_75' | 'pn_75'
  | 'ps_100' | 'pn_100'
  | 'gkl_m2'

const MATERIAL_LABELS: Record<MaterialKey, string> = {
  pp_60x27: 'ПП 60×27', pn_27x28: 'ПН 27×28',
  ps_50: 'ПС 50×50', pn_50: 'ПН 50×40',
  ps_75: 'ПС 75×50', pn_75: 'ПН 75×40',
  ps_100: 'ПС 100×50', pn_100: 'ПН 100×40',
  gkl_m2: 'ГКЛ',
}
const MATERIAL_ORDER: MaterialKey[] = [
  'pp_60x27', 'pn_27x28', 'ps_50', 'pn_50', 'ps_75', 'pn_75', 'ps_100', 'pn_100', 'gkl_m2',
]
const MATERIAL_UNIT: Record<MaterialKey, string> = {
  pp_60x27: 'м', pn_27x28: 'м', ps_50: 'м', pn_50: 'м',
  ps_75: 'м', pn_75: 'м', ps_100: 'м', pn_100: 'м', gkl_m2: 'м²',
}
const MATERIAL_COUNT_PCS: Record<MaterialKey, boolean> = {
  pp_60x27: true, pn_27x28: true, ps_50: true, pn_50: true,
  ps_75: true, pn_75: true, ps_100: true, pn_100: true, gkl_m2: false,
}
type MaterialMap = Partial<Record<MaterialKey, number>>

function wallMaterials(w: WallEntry): MaterialMap {
  const { result, input } = w
  if (!result) return {}
  const prof = input.profileType
  const psKey: MaterialKey = prof === 'ps50' ? 'ps_50' : prof === 'ps75' ? 'ps_75' : 'ps_100'
  const pnKey: MaterialKey = prof === 'ps50' ? 'pn_50' : prof === 'ps75' ? 'pn_75' : 'pn_100'
  return {
    [pnKey]: result.uwFloor + result.uwCeiling + result.lintel + result.uwSill,
    [psKey]: result.cwTotal,
    gkl_m2: result.gklArea,
  }
}
function liningMaterials(l: LiningEntry): MaterialMap {
  const { result, input } = l
  if (!result) return {}
  if (input.liningType === 'c623') return { pn_27x28: result.guideRail, pp_60x27: result.stud, gkl_m2: result.gklArea }
  const prof = input.profileType
  const psKey: MaterialKey = prof === 'ps50' ? 'ps_50' : prof === 'ps75' ? 'ps_75' : 'ps_100'
  const pnKey: MaterialKey = prof === 'ps50' ? 'pn_50' : prof === 'ps75' ? 'pn_75' : 'pn_100'
  return { [pnKey]: result.guideRail, [psKey]: result.stud, gkl_m2: result.gklArea }
}
function addMaterials(a: MaterialMap, b: MaterialMap): MaterialMap {
  const out: MaterialMap = { ...a }
  for (const k of Object.keys(b) as MaterialKey[]) out[k] = (out[k] ?? 0) + (b[k] ?? 0)
  return out
}

function fmtMeters(m: number): React.ReactNode {
  if (m <= 0) return <span style={{ color: '#aaa' }}>—</span>
  const pcs = Math.ceil(m / PROFILE_LEN)
  const rest = +(pcs * PROFILE_LEN - m).toFixed(2)
  return (
    <span>
      {m.toFixed(2)}&thinsp;м
      <span style={{ color: '#666', fontSize: 11 }}>
        {' · '}{pcs}&thinsp;шт{rest > 0 && <> · ост&thinsp;{rest.toFixed(2)}&thinsp;м</>}
      </span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [form, setForm] = useState<WallInput>(DEFAULT_INPUT)
  const [shiftInput, setShiftInput] = useState('100')
  const [activeTab, setActiveTab] = useState<'wall' | 'lining'>('wall')
  const {
    positions, snap, result, heightWarning, profileWidth,
    calculate, onDragEnd, onRightDragEnd, shiftGrid, addStud, removeStud,
  } = useWallCalc()

  const rightDragStart = useRef<{ studPos: number; startXpx: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTapTime = useRef<number>(0)
  const lastTapPos = useRef<{ x: number; y: number } | null>(null)

  const {
    projectName, walls, linings, activeWallId,
    setProjectName, addWall, updateWall, removeWall, setActiveWall,
  } = useProjectStore()

  function set<K extends keyof WallInput>(key: K, value: WallInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // ─── Управление проёмами ───────────────────────────────────────────────────

  function addOpening(type: 'door' | 'window') {
    const o = type === 'door' ? emptyDoor() : emptyWindow()
    setForm(prev => ({ ...prev, openings: [...prev.openings, o] }))
  }

  function updateOpening(id: string, patch: Partial<Opening>) {
    setForm(prev => ({
      ...prev,
      openings: prev.openings.map(o => o.id === id ? { ...o, ...patch } : o)
    }))
  }

  function removeOpening(id: string) {
    setForm(prev => ({ ...prev, openings: prev.openings.filter(o => o.id !== id) }))
  }

  // ─── Перегородки: прочее ──────────────────────────────────────────────────

  const knaufOverlap = PROFILES.find(p => p.value === form.profileType)?.overlap ?? 500
  const effectiveOverlap = (form.customOverlap != null && form.customOverlap >= 100)
    ? form.customOverlap : knaufOverlap
  const overlapWarning = (form.customOverlap != null && form.customOverlap >= 100 && form.customOverlap < knaufOverlap)
    ? `⚠️ ${form.customOverlap}мм — меньше нормы Кнауф (${knaufOverlap}мм). Ответственность на монтажнике.`
    : null

  // Проверка пересечения проёмов
  const openingConflicts: string[] = []
  const activeOpenings = form.openings.filter(o => o.width > 0)
  for (let i = 0; i < activeOpenings.length; i++) {
    for (let j = i + 1; j < activeOpenings.length; j++) {
      const a = activeOpenings[i], b = activeOpenings[j]
      const aEnd = a.pos + a.width, bEnd = b.pos + b.width
      if (a.pos < bEnd && aEnd > b.pos) {
        const label = (o: typeof a) => o.type === 'door' ? 'Дверь' : 'Окно'
        openingConflicts.push(`${label(a)} (${a.pos}–${aEnd}) пересекается с ${label(b)} (${b.pos}–${bEnd})`)
      }
    }
  }
  const hasOpeningConflict = openingConflicts.length > 0

  function handleStudTouchStart(pos: number, fixed: boolean) {
    if (fixed) return
    longPressTimer.current = setTimeout(() => { removeStud(pos); longPressTimer.current = null }, 600)
  }
  function handleStudTouchEnd() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }
  function handleBgTouchEnd(xpx: number) {
    const now = Date.now(), last = lastTapTime.current, lastPos = lastTapPos.current
    lastTapTime.current = now; lastTapPos.current = { x: xpx, y: 0 }
    if (last && now - last < 350 && lastPos && Math.abs(lastPos.x - xpx) < 30) {
      addStud(xpx); lastTapTime.current = 0
    }
  }

  const { l, h, openings: snapOpenings } = snap
  const scale = l > 0 ? (CANVAS_W - PAD * 2) / l : 1
  const TOP_PAD = 70, BOT_PAD = 50
  const canvasH = l > 0 ? h * scale + TOP_PAD + BOT_PAD : 300
  const studW = Math.max(profileWidth * scale, 4)
  const tx = (mm: number) => PAD + mm * scale
  const wallTop = TOP_PAD, wallBot = TOP_PAD + h * scale
  const gklLayers = form.wallType === 'c112' ? 2 : 1

  function isFixed(pos: number) {
    if (pos === 0 || pos === l) return true
    for (const o of snapOpenings) {
      if (o.width > 0 && (pos === o.pos || pos === o.pos + o.width)) return true
    }
    return false
  }

  // Все стойки проёмов
  const openingStudPositions = new Set(
    snapOpenings.flatMap(o => o.width > 0 ? [o.pos, o.pos + o.width] : [])
  )
  const gridStuds = positions.filter(p =>
    p !== 0 && p !== l && !openingStudPositions.has(p)
  )

  const orientationMap = new Map((result?.studInfos ?? []).map(si => [si.pos, si.orientation]))

  // ─── Сводная ведомость ────────────────────────────────────────────────────

  type ItemRow = { id: string; label: string; type: 'wall' | 'lining'; constructionType: string; materials: MaterialMap }
  const itemRows: ItemRow[] = [
    ...walls.filter(w => w.result).map(w => ({
      id: w.id, label: w.label, type: 'wall' as const,
      constructionType: w.input.wallType.toUpperCase(), materials: wallMaterials(w),
    })),
    ...linings.filter(l => l.result).map(l => ({
      id: l.id, label: l.label, type: 'lining' as const,
      constructionType: l.input.liningType.toUpperCase(), materials: liningMaterials(l),
    })),
  ]
  const grandTotal: MaterialMap = itemRows.reduce((acc, row) => addMaterials(acc, row.materials), {} as MaterialMap)
  const usedMaterials = MATERIAL_ORDER.filter(k => (grandTotal[k] ?? 0) > 0)
  const hasAnything = itemRows.length > 0

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 900 }}>

      {/* ─── Панель объекта ─── */}
      <div style={{ marginBottom: 20, padding: '12px 16px', background: '#f8f9ff', border: '1px solid #dde', borderRadius: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#444', whiteSpace: 'nowrap' }}>Объект:</span>
          <input value={projectName} onChange={e => setProjectName(e.target.value)}
            placeholder="Название объекта / квартиры"
            style={{ flex: 1, padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }} />
        </div>
        {walls.length > 0 ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <select value={activeWallId ?? ''} onChange={e => {
                const id = e.target.value; if (!id) return
                const w = walls.find(w => w.id === id)
                if (w) { setActiveWall(w.id); setForm(w.input) }
              }} style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4 }}>
                <option value="">— Выберите перегородку —</option>
                {walls.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.label} · {w.input.length}×{w.input.height} · {w.input.wallType.toUpperCase()} · {
                      w.input.profileType === 'ps50' ? 'ПС50' : w.input.profileType === 'ps75' ? 'ПС75' : 'ПС100'
                    }
                  </option>
                ))}
              </select>
            </div>
            {activeWallId && (
              <button onClick={() => { if (window.confirm('Удалить перегородку?')) removeWall(activeWallId) }}
                style={{ padding: '5px 10px', fontSize: 13, cursor: 'pointer', background: '#fff', border: '1px solid #e05', color: '#e05', borderRadius: 4 }}>
                🗑
              </button>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: '#999' }}>Рассчитайте перегородку и нажмите «Добавить в объект»</p>
        )}
      </div>

      {/* ─── Вкладки ─── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #dde' }}>
        {([['wall', 'Перегородки'], ['lining', 'Облицовка стен']] as const).map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '10px 24px', fontSize: 14, cursor: 'pointer',
            border: 'none', borderBottom: activeTab === tab ? '2px solid #3a7bd5' : '2px solid transparent',
            background: 'none', color: activeTab === tab ? '#3a7bd5' : '#666',
            fontWeight: activeTab === tab ? 600 : 400, marginBottom: -2,
          }}>{label}</button>
        ))}
      </div>

      {activeTab === 'lining' && <LiningCalc />}

      {activeTab === 'wall' && <>
        <h1 style={{ display: 'none' }}>Калькулятор перегородки</h1>

        {/* ─── Строка 1 ─── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontSize: 13 }}>Тип перегородки</label><br />
            <select value={form.wallType} onChange={e => set('wallType', e.target.value as WallInput['wallType'])} style={{ width: '100%', padding: 7 }}>
              <option value="c111">С111 — 1 слой ГКЛ</option>
              <option value="c112">С112 — 2 слоя ГКЛ</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontSize: 13 }}>Толщина профиля</label><br />
            <select value={form.profileThickness} onChange={e => set('profileThickness', e.target.value as WallInput['profileThickness'])} style={{ width: '100%', padding: 7 }}>
              <option value="06">0.6 мм (стандарт)</option>
              <option value="07">0.7 мм (усиленный)</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ fontSize: 13 }}>Тип профиля</label><br />
            <select value={form.profileType} onChange={e => set('profileType', e.target.value as WallInput['profileType'])} style={{ width: '100%', padding: 7 }}>
              {PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ fontSize: 13 }}>Примыкание</label><br />
            <select value={form.abutment} onChange={e => set('abutment', e.target.value as WallInput['abutment'])} style={{ width: '100%', padding: 7 }}>
              <option value="both">Стена — Стена</option>
              <option value="left">Стена — Свободно</option>
              <option value="right">Свободно — Стена</option>
              <option value="none">Отдельностоящая</option>
            </select>
          </div>
        </div>

        {/* ─── Строка 2 ─── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={{ fontSize: 13 }}>Шаг (мм)</label><br />
            <select value={form.step} onChange={e => { const s = Number(e.target.value); setForm(prev => ({ ...prev, step: s, firstStud: s })) }} style={{ width: '100%', padding: 7 }}>
              <option value={600}>600</option><option value={400}>400</option>
              <option value={300}>300</option><option value={200}>200 (радиус)</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={{ fontSize: 13 }}>Первая стойка (мм)</label><br />
            <input type="number" value={form.firstStud || ''} onChange={e => set('firstStud', Number(e.target.value))} style={{ width: '100%', padding: 7, marginTop: 2 }} />
          </div>
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
              style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: '#f0f4ff', border: '1px solid #aac', borderRadius: 4 }}>
              + Дверной
            </button>
            <button onClick={() => addOpening('window')}
              style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: '#f0fff4', border: '1px solid #aca', borderRadius: 4 }}>
              + Оконный
            </button>
          </div>

          {form.openings.length === 0 && (
            <p style={{ margin: 0, fontSize: 12, color: '#999' }}>Нет проёмов — нажмите кнопку для добавления</p>
          )}

          {form.openings.map((o, idx) => (
            <div key={o.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end',
              marginBottom: 8, padding: '8px 10px', background: o.type === 'door' ? '#f8f0ff' : '#f0fff4',
              border: `1px solid ${o.type === 'door' ? '#dcc' : '#cdc'}`, borderRadius: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#666', minWidth: 60, paddingBottom: 6 }}>
                {o.type === 'door' ? '🚪' : '🪟'} {o.type === 'door' ? 'Дверь' : 'Окно'} {idx + 1}
              </span>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: '#666' }}>Начало (мм)</label><br />
                <input type="number" value={o.pos || ''} onChange={e => updateOpening(o.id, { pos: Number(e.target.value) })}
                  style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: '#666' }}>Ширина (мм)</label><br />
                <input type="number" value={o.width || ''} onChange={e => updateOpening(o.id, { width: Number(e.target.value) })}
                  style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: '#666' }}>Высота (мм)</label><br />
                <input type="number" value={o.height || ''} onChange={e => updateOpening(o.id, { height: Number(e.target.value) })}
                  style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
              </div>
              {o.type === 'window' && (
                <div style={{ flex: 1, minWidth: 110 }}>
                  <label style={{ fontSize: 11, color: '#666' }}>Подоконник (мм)</label><br />
                  <input type="number" value={o.sillHeight || ''} onChange={e => updateOpening(o.id, { sillHeight: Number(e.target.value) })}
                    style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
                </div>
              )}
              <button onClick={() => removeOpening(o.id)}
                style={{ padding: '5px 8px', fontSize: 13, cursor: 'pointer', background: '#fff', border: '1px solid #e05', color: '#e05', borderRadius: 4, marginBottom: 1 }}>
                🗑
              </button>
            </div>
          ))}
        </div>

        {/* ─── Нахлёст ─── */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label style={{ fontSize: 13 }}>
              Нахлёст профиля (мм)
              <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>норма Кнауф: {knaufOverlap}мм</span>
            </label><br />
            <input type="number" placeholder={`${knaufOverlap} (по умолчанию)`}
              value={form.customOverlap ?? ''} min={100}
              onChange={e => set('customOverlap', e.target.value === '' ? null : Number(e.target.value))}
              style={{ width: '100%', padding: 7, marginTop: 2 }} />
          </div>
          {overlapWarning && (
            <div style={{ flex: 2, fontSize: 12, color: '#c05000', background: '#fff3e0', border: '1px solid #ffb74d', padding: '6px 10px', borderRadius: 4, marginBottom: 2 }}>
              {overlapWarning}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: hasOpeningConflict ? 8 : 20, flexWrap: 'wrap' }}>
          {walls.length > 0 && (
            <button onClick={() => { setActiveWall(null); setForm(DEFAULT_INPUT) }}
              style={{ padding: '10px 20px', fontSize: 15, cursor: 'pointer', background: '#fff', border: '1px solid #aaa', borderRadius: 4 }}>
              + Новая
            </button>
          )}
          <button
            onClick={() => !hasOpeningConflict && calculate({ ...form, customOverlap: effectiveOverlap })}
            disabled={hasOpeningConflict}
            style={{ padding: '10px 32px', fontSize: 15,
              cursor: hasOpeningConflict ? 'not-allowed' : 'pointer',
              background: hasOpeningConflict ? '#eee' : '#f0f0f0',
              border: `1px solid ${hasOpeningConflict ? '#e05' : '#ccc'}`,
              color: hasOpeningConflict ? '#c00' : 'inherit',
              borderRadius: 4, flex: 1 }}>
            Рассчитать
          </button>
          <button onClick={() => {
            if (result && positions.length) {
              if (activeWallId) updateWall(activeWallId, form, result, positions)
              else addWall(form, result, positions)
            }
          }} disabled={!result || hasOpeningConflict}
            style={{ padding: '10px 20px', fontSize: 15, cursor: (result && !hasOpeningConflict) ? 'pointer' : 'default',
              background: (result && !hasOpeningConflict) ? '#3a7bd5' : '#ccc', color: '#fff', border: 'none', borderRadius: 4, whiteSpace: 'nowrap' }}>
            {activeWallId ? '💾 Обновить' : '➕ В объект'}
          </button>
        </div>

        {/* Предупреждение о пересечении проёмов */}
        {hasOpeningConflict && (
          <div style={{ background: '#fff0f0', border: '1px solid #e05', padding: '10px 14px', borderRadius: 6, marginBottom: 16 }}>
            <b style={{ color: '#c00' }}>🚫 Проёмы пересекаются — расчёт невозможен:</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {openingConflicts.map((msg, i) => (
                <li key={i} style={{ fontSize: 13, color: '#900' }}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {heightWarning && (
          <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: 12, borderRadius: 6, marginBottom: 16 }}>
            {heightWarning}
          </div>
        )}

        {/* ─── Чертёж ─── */}
        {l > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 12px',
              background: '#f0f4ff', borderRadius: 6, border: '1px solid #c5d0f0' }}>
              <span style={{ fontSize: 13, color: '#444' }}>Сдвиг гребёнки:</span>
              <button onClick={() => shiftGrid(-Number(shiftInput))} style={{ padding: '4px 12px', fontSize: 14, cursor: 'pointer', background: '#fff', border: '1px solid #aaa', borderRadius: 4 }}>← влево</button>
              <input type="number" value={shiftInput} onChange={e => setShiftInput(e.target.value)}
                style={{ width: 70, padding: '4px 6px', textAlign: 'center', border: '1px solid #aaa', borderRadius: 4 }} />
              <span style={{ fontSize: 12, color: '#888' }}>мм</span>
              <button onClick={() => shiftGrid(Number(shiftInput))} style={{ padding: '4px 12px', fontSize: 14, cursor: 'pointer', background: '#fff', border: '1px solid #aaa', borderRadius: 4 }}>вправо →</button>
              <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>· ПКМ + drag — сдвиг по 100мм</span>
            </div>

            <p style={{ fontSize: 12, color: '#888', margin: '0 0 6px' }}>
              ЛКМ + drag — переместить стойку · Двойной клик на стойке — удалить · Двойной клик на пустом месте — добавить
            </p>

            <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}
              onContextMenu={e => e.preventDefault()}>
              <Stage width={CANVAS_W} height={canvasH}>
                <Layer>
                  <Rect x={0} y={0} width={CANVAS_W} height={canvasH} fill="#f8f8f8"
                    onDblClick={e => { const stage = e.target.getStage(); const pos = stage?.getPointerPosition(); if (pos) addStud(pos.x) }}
                    onTouchEnd={e => { const touch = e.evt.changedTouches[0]; if (touch) handleBgTouchEnd(touch.clientX - (e.target.getStage()?.container().getBoundingClientRect().left ?? 0)) }} />

                  {/* Размерные стрелки */}
                  <Arrow points={[tx(0), 14, tx(l), 14]} stroke="#555" fill="#555" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                  <Arrow points={[tx(l), 14, tx(0), 14]} stroke="#555" fill="#555" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                  <Text x={tx(l / 2) - 28} y={4} text={`${l} мм`} fontSize={11} fill="#333" fontStyle="bold" />
                  <Arrow points={[PAD - 22, wallTop + 8, PAD - 22, wallBot - 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                  <Arrow points={[PAD - 22, wallBot - 8, PAD - 22, wallTop + 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                  <Text x={8} y={(wallTop + wallBot) / 2} text={`${h}`} fontSize={11} fill="#444" rotation={-90} />

                  {/* Позиции рядовых стоек сверху */}
                  {[0, ...gridStuds].map((pos) => (
                    <Group key={`tp${pos}`}>
                      <Line points={[tx(pos), wallTop - 6, tx(pos), wallTop - 18]} stroke="#666" strokeWidth={1} />
                      <Text x={tx(pos) - 16} y={wallTop - 30} text={`${pos}`} fontSize={10} fill="#333" />
                    </Group>
                  ))}
                  {[0, ...gridStuds].map((pos, i, arr) => {
                    if (i === 0) return null
                    const prev = arr[i - 1], dist = pos - prev, mx = tx(prev) + (dist * scale) / 2
                    return (
                      <Group key={`td${pos}`}>
                        <Line points={[tx(prev), wallTop - 8, tx(pos), wallTop - 8]} stroke="#aaa" strokeWidth={1} />
                        <Text x={mx - 10} y={wallTop - 20} text={`${dist}`} fontSize={9} fill="#666" />
                      </Group>
                    )
                  })}

                  {/* Направляющие ПН — пол */}
                  {(() => {
                    // Вырезаем дверные проёмы из нижней направляющей
                    const doorOpenings = snapOpenings.filter(o => o.type === 'door' && o.width > 0)
                    if (doorOpenings.length === 0) {
                      return <Rect x={tx(0)} y={wallBot - 8} width={l * scale} height={8} fill="#5a7080" />
                    }
                    const segments: React.ReactNode[] = []
                    let cursor = 0
                    const sorted = [...doorOpenings].sort((a, b) => a.pos - b.pos)
                    for (const o of sorted) {
                      if (o.pos > cursor) segments.push(
                        <Rect key={`fl${o.id}`} x={tx(cursor)} y={wallBot - 8} width={(o.pos - cursor) * scale} height={8} fill="#5a7080" />
                      )
                      cursor = o.pos + o.width
                    }
                    if (cursor < l) segments.push(
                      <Rect key="fl_end" x={tx(cursor)} y={wallBot - 8} width={(l - cursor) * scale} height={8} fill="#5a7080" />
                    )
                    return <>{segments}</>
                  })()}

                  {/* Направляющая ПН — потолок */}
                  <Rect x={tx(0)} y={wallTop} width={l * scale} height={8} fill="#5a7080" />

                  {/* Проёмы — сортируем и рисуем без перекрытий */}
                  {snapOpenings.filter(o => o.width > 0)
                    .sort((a, b) => a.pos - b.pos)
                    .map(o => {
                    const oBottom = wallBot - o.sillHeight * scale
                    const oTop = oBottom - o.height * scale
                    const oX = tx(o.pos), oW = o.width * scale
                    const color = o.type === 'door' ? '#ddeeff' : '#ffeedd'
                    const stroke = o.type === 'door' ? '#88aacc' : '#ccaa88'
                    return (
                      <Group key={`op${o.id}`}>
                        <Rect x={oX} y={oTop} width={oW} height={o.height * scale} fill={color} stroke={stroke} strokeWidth={1} />
                        {/* Перемычка сверху */}
                        <Rect x={oX - 10} y={oTop - 6} width={oW + 20} height={6} fill="#5a7080" />
                        {/* Подоконник для окна */}
                        {o.type === 'window' && o.sillHeight > 0 && (
                          <Rect x={oX} y={oBottom - 6} width={oW} height={6} fill="#5a7080" />
                        )}
                        <Text x={oX + oW / 2 - 20} y={oTop + o.height * scale / 2 - 6}
                          text={`${o.width}×${o.height}`} fontSize={10} fill="#336" />
                      </Group>
                    )
                  })}

                  {/* Стойки */}
                  {positions.map((pos) => {
                    const fixed = isFixed(pos)
                    const isDoor = openingStudPositions.has(pos)
                    const orientation = orientationMap.get(pos) ?? 'down'

                    // Проём, внутри которого находится стойка (если есть)
                    const insideOpening = snapOpenings.find(
                      o => o.width > 0 && pos > o.pos && pos < o.pos + o.width
                    )

                    // Цвет — оцинкованная сталь
                    let fillColor: string
                    if (isDoor) { fillColor = STEEL_DOOR }
                    else if (fixed) { fillColor = STEEL_EDGE }
                    else { fillColor = STEEL_NORMAL }

                    // Зона нахлёста (только для полных стоек, h>3000)
                    const overlapNode = !insideOpening && h > 3000 ? (() => {
                      const kind = fixed
                        ? (pos === 0
                          ? ((form.abutment === 'both' || form.abutment === 'left') ? 'wall' : 'free')
                          : ((form.abutment === 'both' || form.abutment === 'right') ? 'wall' : 'free'))
                        : 'middle'
                      const { overlapZone } = calcStudMaterial(h, kind as any, effectiveOverlap, orientation)
                      if (!overlapZone) return null
                      const baseY = wallTop + 8
                      const zFrom = baseY + overlapZone.from * scale
                      const zTo = baseY + overlapZone.to * scale
                      const zH = zTo - zFrom
                      const zoneMm = overlapZone.to - overlapZone.from
                      return (
                        <Group>
                          <Rect x={0} y={zFrom} width={studW} height={zH}
                            fill="rgba(255,140,0,0.3)" stroke="#ff8c00" strokeWidth={1.5} dash={[4, 3]} />
                          <Text x={studW + 3} y={zFrom + zH / 2 - 5}
                            text={`${zoneMm}мм`} fontSize={9} fill="#c05000" fontStyle="bold" />
                        </Group>
                      )
                    })() : null

                    if (insideOpening) {
                      // Стойка внутри проёма — рисуем ДВА сегмента:
                      // верхний (от потолочной направляющей вниз до верха проёма)
                      // нижний (от напольной направляющей вверх до подоконника)
                      const aboveH = (h - insideOpening.height - insideOpening.sillHeight) * scale - 8
                      const belowH = insideOpening.sillHeight * scale - 8

                      // Зона нахлёста для этой стойки (если h > 3000)
                      const overlapZoneNode = h > 3000 ? (() => {
                        const { overlapZone } = calcStudMaterial(h, 'middle', effectiveOverlap, orientation)
                        if (!overlapZone) return null

                        const nodes: React.ReactNode[] = []
                        const baseY = wallTop + 8 // база = от потолочной направляющей

                        // Верхний сегмент: диапазон стойки [0, aboveH] от baseY
                        // Зона нахлёста в координатах стойки: [overlapZone.from, overlapZone.to]
                        const aboveRangeEnd = h - insideOpening.height - insideOpening.sillHeight
                        if (overlapZone.from < aboveRangeEnd) {
                          const clipFrom = Math.max(overlapZone.from, 0)
                          const clipTo = Math.min(overlapZone.to, aboveRangeEnd)
                          if (clipTo > clipFrom) {
                            const zY = baseY + clipFrom * scale
                            const zH = (clipTo - clipFrom) * scale
                            nodes.push(
                              <Group key="oz_above">
                                <Rect x={0} y={zY} width={studW} height={zH}
                                  fill="rgba(255,140,0,0.3)" stroke="#ff8c00" strokeWidth={1.5} dash={[4, 3]} />
                                <Text x={studW + 3} y={zY + zH / 2 - 5}
                                  text={`${Math.round(clipTo - clipFrom)}мм`} fontSize={9} fill="#c05000" fontStyle="bold" />
                              </Group>
                            )
                          }
                        }

                        // Нижний сегмент: стойка идёт от пола (0) до sillHeight
                        // В координатах канваса: от wallBot-8-belowH до wallBot-8
                        const belowRangeStart = h - insideOpening.sillHeight // от потолка до начала нижнего сегмента
                        if (overlapZone.to > belowRangeStart) {
                          const clipFrom = Math.max(overlapZone.from, belowRangeStart)
                          const clipTo = Math.min(overlapZone.to, h)
                          if (clipTo > clipFrom) {
                            // Перевод в координаты нижнего сегмента (от wallBot-8 вверх)
                            const toBottom = h - clipFrom   // расстояние от пола до верхней границы зоны
                            const zY = wallBot - 8 - toBottom * scale
                            const zH = (clipTo - clipFrom) * scale
                            nodes.push(
                              <Group key="oz_below">
                                <Rect x={0} y={zY} width={studW} height={zH}
                                  fill="rgba(255,140,0,0.3)" stroke="#ff8c00" strokeWidth={1.5} dash={[4, 3]} />
                                <Text x={studW + 3} y={zY + zH / 2 - 5}
                                  text={`${Math.round(clipTo - clipFrom)}мм`} fontSize={9} fill="#c05000" fontStyle="bold" />
                              </Group>
                            )
                          }
                        }

                        return nodes.length ? <>{nodes}</> : null
                      })() : null

                      return (
                        <Group key={`s${pos}`} x={tx(pos) - studW / 2} y={0}>
                          {/* Верхний сегмент — над проёмом */}
                          {aboveH > 0 && (
                            <Rect x={0} y={wallTop + 8} width={studW} height={aboveH}
                              fill={fillColor} stroke={STEEL_STROKE} strokeWidth={1} cornerRadius={2} />
                          )}
                          {/* Нижний сегмент — под подоконником */}
                          {belowH > 0 && (
                            <Rect x={0} y={wallBot - 8 - belowH} width={studW} height={belowH}
                              fill={fillColor} stroke={STEEL_STROKE} strokeWidth={1} cornerRadius={2} />
                          )}
                          {overlapZoneNode}
                        </Group>
                      )
                    }

                    // Обычная полная стойка (от потолка до пола)
                    return (
                      <Group key={`s${pos}`} x={tx(pos) - studW / 2} y={0}
                        draggable={!fixed}
                        dragBoundFunc={p => ({ x: p.x, y: 0 })}
                        onDragEnd={e => { if (rightDragStart.current) return; onDragEnd(pos, e.target.x() + studW / 2) }}
                        onDblClick={() => removeStud(pos)}
                        onMouseDown={e => {
                          if (e.evt.button === 2 && !fixed) {
                            e.evt.preventDefault()
                            const stagePos = e.target.getStage()?.getPointerPosition()
                            if (stagePos) rightDragStart.current = { studPos: pos, startXpx: stagePos.x }
                          }
                        }}
                        onMouseUp={e => {
                          if (e.evt.button === 2 && rightDragStart.current) {
                            const stagePos = e.target.getStage()?.getPointerPosition()
                            if (stagePos) onRightDragEnd(rightDragStart.current.studPos, stagePos.x, rightDragStart.current.startXpx)
                            rightDragStart.current = null
                          }
                        }}
                        onTouchStart={() => handleStudTouchStart(pos, fixed)}
                        onTouchEnd={() => handleStudTouchEnd()}
                        onTouchMove={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}>
                        <Rect x={0} y={wallTop + 8} width={studW} height={(h - 16) * scale}
                          fill={fillColor} stroke={STEEL_STROKE} strokeWidth={1} cornerRadius={2} />
                        {overlapNode}
                      </Group>
                    )
                  })}

                  {/* Метки стоек проёмов снизу */}
                  {snapOpenings.filter(o => o.width > 0).flatMap(o =>
                    [o.pos, o.pos + o.width].map(pos => {
                      const cx = tx(pos), cy = wallBot + 20
                      const tooClose = gridStuds.some(g => Math.abs(g - pos) <= MIN_GAP)
                      return (
                        <Group key={`dl${o.id}_${pos}`}>
                          <Line points={[cx, wallBot, cx, cy - 10]} stroke="#888" strokeWidth={1} dash={[3, 3]} />
                          <Rect x={cx - 18} y={cy - 10} width={36} height={20}
                            fill={tooClose ? '#ffe0d0' : '#fff'} stroke={tooClose ? '#e06030' : '#888'}
                            strokeWidth={1} cornerRadius={10} />
                          <Text x={cx - 16} y={cy - 5} text={`${pos}`} fontSize={10}
                            fill={tooClose ? '#c03000' : '#444'} width={32} align="center" />
                        </Group>
                      )
                    })
                  )}

                  {/* Предупреждения о малом расстоянии */}
                  {snapOpenings.filter(o => o.width > 0).flatMap(o =>
                    [o.pos, o.pos + o.width].flatMap(doorPos =>
                      gridStuds
                        .filter(g => Math.abs(g - doorPos) <= MIN_GAP && Math.abs(g - doorPos) > 0)
                        .map(g => {
                          const x1 = tx(Math.min(g, doorPos)), x2 = tx(Math.max(g, doorPos)), my = wallBot + 42
                          return (
                            <Group key={`warn${o.id}_${g}_${doorPos}`}>
                              <Line points={[x1, my, x2, my]} stroke="#e06030" strokeWidth={1.5} />
                              <Text x={(x1 + x2) / 2 - 12} y={my + 3}
                                text={`${Math.abs(g - doorPos)}мм!`} fontSize={9} fill="#c03000" fontStyle="bold" />
                            </Group>
                          )
                        })
                    )
                  )}
                </Layer>
              </Stage>
            </div>
          </>
        )}

        {/* ─── Результаты ─── */}
        {result && (
          <div style={{ marginTop: 20, background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
            <h2 style={{ marginTop: 0 }}>Результат</h2>
            <p style={{ color: '#666', fontSize: 13 }}>
              {form.wallType.toUpperCase()} · {gklLayers} слой ГКЛ · профиль {form.profileThickness === '06' ? '0.6' : '0.7'}мм
            </p>
            {result.needsOverlap && (
              <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: 10, borderRadius: 6, marginBottom: 12 }}>
                ⚠️ Высота {form.height} мм — промежуточные стойки наращиваются с перехлёстом {effectiveOverlap}мм
              </div>
            )}
            <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>ПН пол:</td><td style={{ paddingBottom: 6 }}><b>{fmtMeters(result.uwFloor)}</b></td></tr>
                <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>ПН потолок:</td><td style={{ paddingBottom: 6 }}><b>{fmtMeters(result.uwCeiling)}</b></td></tr>
                {result.uwSill > 0 && <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>ПН подоконник:</td><td style={{ paddingBottom: 6 }}><b>{fmtMeters(result.uwSill)}</b></td></tr>}
                {result.lintel > 0 && <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Перемычки (ПН):</td><td style={{ paddingBottom: 6 }}><b>{fmtMeters(result.lintel)}</b></td></tr>}
                <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Стоечный ПС:</td><td style={{ paddingBottom: 6 }}><b>{fmtMeters(result.cwTotal)}</b></td></tr>
                <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Стоек всего:</td><td style={{ paddingBottom: 6 }}><b>{result.studsCount} шт</b></td></tr>
                {result.aboveStuds > 0 && <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Над/под проёмами:</td><td style={{ paddingBottom: 6 }}><b>{result.aboveStuds} шт</b></td></tr>}
                <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>ГКЛ ({gklLayers} сл.):</td><td style={{ paddingBottom: 6 }}><b>{result.gklArea.toFixed(2)} м²</b></td></tr>
              </tbody>
            </table>
          </div>
        )}
      </>}

      {/* ─── Сводная ведомость ─── */}
      {hasAnything && (() => {
        const thS: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: 12, background: '#e8edf8', borderBottom: '1px solid #ccd' }
        const tdS: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderBottom: '1px solid #eee', verticalAlign: 'top' }
        const tdR: React.CSSProperties = { ...tdS, textAlign: 'right' }
        return (
          <div style={{ marginTop: 28, borderRadius: 8, overflow: 'hidden', border: '1px solid #ccd' }}>
            <div style={{ padding: '10px 14px', background: '#e8edf8', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #ccd' }}>
              Сводная ведомость объекта
              {projectName && <span style={{ fontWeight: 400, color: '#666', marginLeft: 8 }}>— {projectName}</span>}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thS}>Позиция</th><th style={thS}>Тип</th>
                  {usedMaterials.map(k => <th key={k} style={{ ...thS, textAlign: 'right' }}>{MATERIAL_LABELS[k]}{MATERIAL_UNIT[k] === 'м²' ? ', м²' : ', м'}</th>)}
                </tr>
              </thead>
              <tbody>
                {itemRows.map(row => (
                  <tr key={row.id} onClick={() => {
                    if (row.type === 'wall') { const w = walls.find(w => w.id === row.id); if (w) { setActiveWall(w.id); setForm(w.input); setActiveTab('wall') } }
                    else setActiveTab('lining')
                  }} style={{ cursor: 'pointer', background: row.id === activeWallId ? '#e8f0ff' : 'transparent' }}>
                    <td style={tdS}><b>{row.label}</b></td>
                    <td style={tdS}>{row.constructionType}</td>
                    {usedMaterials.map(k => {
                      const m = row.materials[k] ?? 0
                      if (!MATERIAL_COUNT_PCS[k]) return <td key={k} style={tdR}>{m > 0 ? m.toFixed(2) : <span style={{ color: '#aaa' }}>—</span>}</td>
                      if (m <= 0) return <td key={k} style={tdR}><span style={{ color: '#aaa' }}>—</span></td>
                      const pcs = Math.ceil(m / PROFILE_LEN), rest = +(pcs * PROFILE_LEN - m).toFixed(2)
                      return <td key={k} style={tdR}>{m.toFixed(2)}<span style={{ color: '#666', fontSize: 11, display: 'block' }}>{pcs}&thinsp;шт{rest > 0 ? `, ост ${rest.toFixed(2)}м` : ''}</span></td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: '8px 14px', background: '#f0f4ff', fontWeight: 600, fontSize: 13, borderTop: '2px solid #ccd', borderBottom: '1px solid #ccd' }}>Итого по материалам</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thS}>Материал</th><th style={{ ...thS, textAlign: 'right' }}>Итого</th><th style={{ ...thS, textAlign: 'right' }}>Штук</th><th style={{ ...thS, textAlign: 'right' }}>Остаток</th></tr></thead>
              <tbody>
                {usedMaterials.map(k => {
                  const totalM = grandTotal[k] ?? 0; if (totalM <= 0) return null
                  if (!MATERIAL_COUNT_PCS[k]) return (
                    <tr key={k}><td style={tdS}><b>{MATERIAL_LABELS[k]}</b></td><td style={tdR}><b>{totalM.toFixed(2)} м²</b></td><td style={tdR}><span style={{ color: '#aaa' }}>—</span></td><td style={tdR}><span style={{ color: '#aaa' }}>—</span></td></tr>
                  )
                  const posMeters = itemRows.map(r => r.materials[k] ?? 0).filter(v => v > 0)
                  const totalPcs = posMeters.reduce((s, v) => s + Math.ceil(v / PROFILE_LEN), 0)
                  const rest = +(totalPcs * PROFILE_LEN - totalM).toFixed(2)
                  return (
                    <tr key={k}>
                      <td style={tdS}><b>{MATERIAL_LABELS[k]}</b><span style={{ color: '#888', fontWeight: 400, fontSize: 11, marginLeft: 4 }}>{MATERIAL_UNIT[k]}</span></td>
                      <td style={tdR}><b>{totalM.toFixed(2)}</b></td>
                      <td style={tdR}><b>{totalPcs}</b></td>
                      <td style={tdR}>{rest > 0 ? `${rest.toFixed(2)} м` : <span style={{ color: '#888' }}>0</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })()}
    </div>
  )
}
