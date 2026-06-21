import { useState, useRef } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Arrow } from 'react-konva'
import type { WallInput, Opening } from './types'
import type { WallEntry, LiningEntry } from './store/useProjectStore'
import { PROFILES } from './data/profiles'
import { useWallCalc } from './hooks/useWallCalc'
import { CANVAS_W as CANVAS_W_MAX, PAD } from './constants'
import { useContainerWidth } from './hooks/useContainerWidth'
import { MIN_GAP } from './core/buildPositions'
import { useProjectStore } from './store/useProjectStore'
import LiningCalc from './LiningCalc'
import { calcStudMaterial } from './core/calcStudMaterial'
import { calcProjectCutList } from './core/calcProjectCutList'
import { BAR_LENGTH } from './core/cutList'
import ProfileEditor from './components/ProfileEditor'
import { interpolateY, flatProfile, maxStudHeight, integrateHeight } from './core/profileGeometry'

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
  return <span>{m.toFixed(2)}&thinsp;м</span>
}

// Форматирует метраж с данными из раскроя (штуки и остаток из cutList, не ceil)
function fmtCut(totalMm: number, bars: number, wasteMm: number): React.ReactNode {
  if (totalMm <= 0) return <span style={{ color: '#aaa' }}>—</span>
  const wasteM = (wasteMm / 1000).toFixed(2)
  return (
    <span>
      {(totalMm / 1000).toFixed(2)}&thinsp;м
      <span style={{ color: '#666', fontSize: 11 }}>
        {' · '}{bars}&thinsp;шт{wasteMm > 0 && <> · ост&thinsp;{wasteM}&thinsp;м</>}
      </span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [form, setForm] = useState<WallInput>(DEFAULT_INPUT)
  const [shiftInput, setShiftInput] = useState('100')
  const [activeTab, setActiveTab] = useState<'wall' | 'lining'>('wall')
  const [hasInsulation, setHasInsulation] = useState(false)
  const [canvasWrapRef, CANVAS_W] = useContainerWidth(CANVAS_W_MAX, 48)
  const {
    positions, snap, result, heightWarning, profileWidth,
    calculate, onDragEnd, onRightDragEnd, shiftGrid, addStud, removeStud,
  } = useWallCalc()

  const rightDragStart = useRef<{ studPos: number; startXpx: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTapTime = useRef<number>(0)
  const lastTapPos = useRef<{ x: number; y: number } | null>(null)

  const {
    projectName, walls, linings, activeWallId, activeLiningId,
    addWall, updateWall, removeWall, setActiveWall,
    removeLining, setActiveLining,
  } = useProjectStore()

  // ─── Объекты (localStorage) ───────────────────────────────────────────────
  const { projects, activeProjectId, createProject, deleteProject, selectProject } = useProjectStore()
  const activeProject = projects.find(p => p.id === activeProjectId) ?? null

  const [showProjects, setShowProjects] = useState(false)

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

  // Геометрия потолка/пола — ломаные линии (для плоской стены это просто 2 точки
  // на одном уровне, и все формулы ниже сводятся к прежнему поведению с одним h).
  const ceilingProfile = snap.ceilingProfile.length >= 2 ? snap.ceilingProfile : flatProfile(l, h)
  const floorProfile = snap.floorProfile.length >= 2 ? snap.floorProfile : flatProfile(l, 0)
  // refTop — самая высокая точка потолка по всей стене, на неё ставим TOP_PAD,
  // refBottom — самая низкая точка пола, на неё ставим низ чертежа.
  const refTop = Math.max(...ceilingProfile.map(p => p.y))
  const refBottom = Math.min(...floorProfile.map(p => p.y))
  // Пиксельный y потолка/пола в произвольной точке x (мм) по длине стены.
  const wallTopAt = (pos: number) => TOP_PAD + (refTop - interpolateY(ceilingProfile, pos)) * scale
  const wallBotAt = (pos: number) => TOP_PAD + (refTop - interpolateY(floorProfile, pos)) * scale

  const canvasH = l > 0 ? (refTop - refBottom) * scale + TOP_PAD + BOT_PAD : 300
  const studW = Math.max(profileWidth * scale, 4)
  const tx = (mm: number) => PAD + mm * scale
  // Уровень потолка/пола в x=0 — используется как опорный для вертикальной
  // размерной стрелки слева и нескольких decorations, не привязанных к
  // конкретной стойке.
  const wallTop = wallTopAt(0), wallBot = wallBotAt(0)
  const gklLayers = form.wallType === 'c112' ? 2 : 1

  // Точки полилинии направляющей (потолок или пол) на участке [fromX, toX],
  // с изломами в точках перегиба профиля — поэтому уклон/ступень видны на
  // самой направляющей, а не только в высоте стоек.
  function railPoints(profile: typeof ceilingProfile, yAt: (pos: number) => number, fromX: number, toX: number): number[] {
    const xs = new Set<number>([fromX, toX])
    for (const p of profile) if (p.x > fromX && p.x < toX) xs.add(p.x)
    return [...xs].sort((a, b) => a - b).flatMap(x => [tx(x), yAt(x)])
  }

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
  // Локальная высота каждой стойки — берём ИЗ РЕЗУЛЬТАТА РАСЧЁТА (studInfos),
  // а не пересчитываем заново по профилю. Так чертёж гарантированно не может
  // разойтись с цифрами в смете — это один и тот же источник данных.
  const heightMap = new Map((result?.studInfos ?? []).map(si => [si.pos, si.height]))
  // Худшая (максимальная) высота по всей геометрии — для текста предупреждения
  // needsOverlap; для плоской стены совпадает с form.height, как и раньше.
  const worstH = l > 0 ? maxStudHeight(ceilingProfile, floorProfile, l) : h

  // Площадь утеплителя — вся стена минус проёмы (с учётом геометрии потолка/пола),
  // тот же приём, что и в облицовке: одна "сторона" площади, без удвоения на ГКЛ.
  const insulationArea = (result && l > 0)
    ? (() => {
        const area = integrateHeight(ceilingProfile, floorProfile, 0, l)
        const openingsArea = snapOpenings.filter(o => o.width > 0).reduce((s, o) => s + o.width * o.height, 0)
        return ((area - openingsArea) / 1_000_000).toFixed(2)
      })()
    : null

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
    <div style={{ fontFamily: 'sans-serif', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ─── Шапка ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px',
        background: '#2c3e50', color: '#fff', borderBottom: '2px solid #1a252f', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: 0.5 }}>🧱 wall-calc</span>
        {activeProject && (
          <span style={{ fontSize: 13, color: '#afc', background: 'rgba(255,255,255,0.1)',
            padding: '3px 10px', borderRadius: 20 }}>
            📁 {activeProject.name}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowProjects(p => !p)}
          style={{ padding: '5px 14px', background: showProjects ? '#3a7bd5' : 'rgba(255,255,255,0.15)',
            color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6,
            cursor: 'pointer', fontSize: 13 }}>
          📁 Объекты
        </button>
      </div>

      {/* ─── Тело ─── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* Боковая панель объектов */}
        {showProjects && (
          <div style={{ width: 220, background: '#f5f5f5', borderRight: '1px solid #ddd',
            padding: 16, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#333', marginBottom: 4 }}>📁 Объекты</div>
            {projects.length === 0 && (
              <div style={{ fontSize: 12, color: '#999' }}>Нет объектов</div>
            )}
            {projects.map(p => (
              <div key={p.id} onClick={() => { selectProject(p.id); setShowProjects(false) }}
                style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  background: p.id === activeProjectId ? '#3a7bd5' : '#fff',
                  color: p.id === activeProjectId ? '#fff' : '#333',
                  border: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1 }}>{p.name}</span>
                <span onClick={e => { e.stopPropagation(); if (window.confirm('Удалить объект?')) deleteProject(p.id) }}
                  style={{ color: p.id === activeProjectId ? '#fcc' : '#e05', fontSize: 12, cursor: 'pointer' }}>✕</span>
              </div>
            ))}
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input id="new-project-name" placeholder="Название объекта"
                style={{ padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const input = e.currentTarget
                    const name = input.value.trim()
                    if (name) { createProject(name); input.value = ''; setShowProjects(false) }
                  }
                }} />
              <button onClick={() => {
                const input = document.getElementById('new-project-name') as HTMLInputElement
                const name = input?.value.trim() || 'Новый объект'
                createProject(name)
                if (input) input.value = ''
                setShowProjects(false)
              }} style={{ padding: '7px', background: '#3a7bd5', color: '#fff',
                border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                + Новый объект
              </button>
            </div>
          </div>
        )}

        {/* Основной контент */}
        <div ref={canvasWrapRef} style={{ flex: 1, padding: 24, maxWidth: 900, overflowY: 'auto' }}>

      {/* ─── Панель объекта ─── */}
      <div style={{ marginBottom: 20, padding: '12px 16px', background: '#f8f9ff', border: '1px solid #dde', borderRadius: 8 }}>

        {/* Строка: название объекта */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: activeProject ? 12 : 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#444', whiteSpace: 'nowrap' }}>Объект:</span>
          {activeProject
            ? <span style={{ fontSize: 14, fontWeight: 600, color: '#2c3e50' }}>{activeProject.name}</span>
            : <span style={{ fontSize: 13, color: '#999' }}>— не выбран (нажмите «Объекты» в шапке)</span>
          }
          {activeProject && (
            <button onClick={() => setShowProjects(p => !p)}
              style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                background: 'transparent', border: '1px solid #aaa', borderRadius: 4, color: '#555' }}>
              Сменить
            </button>
          )}
        </div>

        {/* Дропдауны перегородок и облицовок — только когда объект выбран */}
        {activeProject && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {/* Перегородки */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Перегородки объекта</div>
              {walls.length > 0 ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={activeWallId ?? ''} onChange={e => {
                    const id = e.target.value; if (!id) return
                    const w = walls.find(w => w.id === id)
                    if (w) { setActiveWall(w.id); setForm(w.input); setActiveTab('wall') }
                  }} style={{ flex: 1, padding: '6px 8px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4 }}>
                    <option value="">— Выберите перегородку —</option>
                    {walls.map(w => (
                      <option key={w.id} value={w.id}>
                        {w.label} · {w.input.length}×{w.input.height} · {w.input.wallType.toUpperCase()} · {
                          w.input.profileType === 'ps50' ? 'ПС50' : w.input.profileType === 'ps75' ? 'ПС75' : 'ПС100'
                        }
                      </option>
                    ))}
                  </select>
                  {activeWallId && (
                    <button onClick={() => { if (window.confirm('Удалить перегородку?')) { removeWall(activeWallId) } }}
                      style={{ padding: '5px 10px', fontSize: 13, cursor: 'pointer', background: '#fff', border: '1px solid #e05', color: '#e05', borderRadius: 4 }}>
                      🗑
                    </button>
                  )}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: '#999' }}>Нет перегородок</p>
              )}
            </div>
            {/* Облицовки */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>Облицовки объекта</div>
              {linings.length > 0 ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={activeLiningId ?? ''} onChange={e => {
                    const id = e.target.value; if (!id) return
                    const l = linings.find(l => l.id === id)
                    if (l) { setActiveLining(l.id); setActiveTab('lining') }
                  }} style={{ flex: 1, padding: '6px 8px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4 }}>
                    <option value="">— Выберите облицовку —</option>
                    {linings.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.label} · {l.input?.length}×{l.input?.height} · {l.input?.liningType?.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  {activeLiningId && (
                    <button onClick={() => { if (window.confirm('Удалить облицовку?')) { removeLining(activeLiningId) } }}
                      style={{ padding: '5px 10px', fontSize: 13, cursor: 'pointer', background: '#fff', border: '1px solid #e05', color: '#e05', borderRadius: 4 }}>
                      🗑
                    </button>
                  )}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: '#999' }}>Нет облицовок</p>
              )}
            </div>
          </div>
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

      {activeTab === 'lining' && <LiningCalc canvasW={CANVAS_W} />}

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

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={hasInsulation} onChange={e => setHasInsulation(e.target.checked)} />
            Утеплитель
          </label>
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
              if (activeWallId) {
                updateWall(activeWallId, form, result, positions)

              } else {
                addWall(form, result, positions)

              }
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
              <Stage width={CANVAS_W} height={canvasH}
                ref={node => { if (node) node.container().style.touchAction = 'pan-y' }}>
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
                  <Text x={8} y={(wallTop + wallBot) / 2} text={`${Math.round(interpolateY(ceilingProfile, 0) - interpolateY(floorProfile, 0))}`} fontSize={11} fill="#444" rotation={-90} />

                  {/* Вторая размерная стрелка справа — только если потолок/пол с уклоном
                      (высота у правого края отличается от левого) */}
                  {(() => {
                    const hRight = interpolateY(ceilingProfile, l) - interpolateY(floorProfile, l)
                    const hLeft = interpolateY(ceilingProfile, 0) - interpolateY(floorProfile, 0)
                    if (Math.abs(hRight - hLeft) < 1) return null
                    const xRight = tx(l) + 22
                    const topR = wallTopAt(l), botR = wallBotAt(l)
                    return (
                      <>
                        <Arrow points={[xRight, topR + 8, xRight, botR - 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                        <Arrow points={[xRight, botR - 8, xRight, topR + 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                        <Text x={xRight + 6} y={(topR + botR) / 2} text={`${Math.round(hRight)}`} fontSize={11} fill="#444" rotation={-90} />
                      </>
                    )
                  })()}

                  {/* Позиции рядовых стоек сверху — фиксированный уровень TOP_PAD,
                      он всегда выше самой высокой точки потолка, скос не задевает */}
                  {[0, ...gridStuds].map((pos) => (
                    <Group key={`tp${pos}`}>
                      <Line points={[tx(pos), TOP_PAD - 6, tx(pos), TOP_PAD - 18]} stroke="#666" strokeWidth={1} />
                      <Text x={tx(pos) - 16} y={TOP_PAD - 30} text={`${pos}`} fontSize={10} fill="#333" />
                    </Group>
                  ))}
                  {[0, ...gridStuds].map((pos, i, arr) => {
                    if (i === 0) return null
                    const prev = arr[i - 1], dist = pos - prev, mx = tx(prev) + (dist * scale) / 2
                    return (
                      <Group key={`td${pos}`}>
                        <Line points={[tx(prev), TOP_PAD - 8, tx(pos), TOP_PAD - 8]} stroke="#aaa" strokeWidth={1} />
                        <Text x={mx - 10} y={TOP_PAD - 20} text={`${dist}`} fontSize={9} fill="#666" />
                      </Group>
                    )
                  })}

                  {/* Направляющие ПН — пол (следует профилю пола, с вырезами под двери) */}
                  {(() => {
                    // Вырезаем дверные проёмы из нижней направляющей
                    const doorOpenings = snapOpenings.filter(o => o.type === 'door' && o.width > 0)
                    const floorY = (pos: number) => wallBotAt(pos) - 4 // центр 8px-линии на wallBot-8..wallBot
                    if (doorOpenings.length === 0) {
                      return <Line points={railPoints(floorProfile, floorY, 0, l)} stroke="#5a7080" strokeWidth={8} lineCap="round" lineJoin="round" />
                    }
                    const segments: React.ReactNode[] = []
                    let cursor = 0
                    const sorted = [...doorOpenings].sort((a, b) => a.pos - b.pos)
                    for (const o of sorted) {
                      if (o.pos > cursor) segments.push(
                        <Line key={`fl${o.id}`} points={railPoints(floorProfile, floorY, cursor, o.pos)} stroke="#5a7080" strokeWidth={8} lineCap="round" lineJoin="round" />
                      )
                      cursor = o.pos + o.width
                    }
                    if (cursor < l) segments.push(
                      <Line key="fl_end" points={railPoints(floorProfile, floorY, cursor, l)} stroke="#5a7080" strokeWidth={8} lineCap="round" lineJoin="round" />
                    )
                    return <>{segments}</>
                  })()}

                  {/* Направляющая ПН — потолок (следует профилю потолка) */}
                  <Line points={railPoints(ceilingProfile, pos => wallTopAt(pos) + 4, 0, l)}
                    stroke="#5a7080" strokeWidth={8} lineCap="round" lineJoin="round" />


                  {/* Проёмы — сортируем и рисуем без перекрытий */}
                  {snapOpenings.filter(o => o.width > 0)
                    .sort((a, b) => a.pos - b.pos)
                    .map(o => {
                    const oBottom = wallBotAt(o.pos) - o.sillHeight * scale
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
                    // Локальная высота ИМЕННО этой стойки — из результата расчёта
                    // (или, если расчёт почему-то не нашёл стойку, считаем по профилю).
                    const localH = heightMap.get(pos) ?? (interpolateY(ceilingProfile, pos) - interpolateY(floorProfile, pos))
                    const localTop = wallTopAt(pos), localBot = wallBotAt(pos)

                    // Проём, внутри которого находится стойка (если есть)
                    const insideOpening = snapOpenings.find(
                      o => o.width > 0 && pos > o.pos && pos < o.pos + o.width
                    )

                    // Цвет — оцинкованная сталь
                    let fillColor: string
                    if (isDoor) { fillColor = STEEL_DOOR }
                    else if (fixed) { fillColor = STEEL_EDGE }
                    else { fillColor = STEEL_NORMAL }

                    // Зоны нахлёста (только для полных стоек, localH>3000)
                    const overlapNode = !insideOpening && localH > 3000 ? (() => {
                      const kind = fixed
                        ? (pos === 0
                          ? ((form.abutment === 'both' || form.abutment === 'left') ? 'wall' : 'free')
                          : ((form.abutment === 'both' || form.abutment === 'right') ? 'wall' : 'free'))
                        : 'middle'
                      const { overlapZones } = calcStudMaterial(localH, kind as any, effectiveOverlap, orientation)
                      if (!overlapZones.length) return null
                      const baseY = localTop + 8
                      return (
                        <Group>
                          {overlapZones.map((zone, zi) => {
                            const zFrom = baseY + zone.from * scale
                            const zTo   = baseY + zone.to   * scale
                            const zH    = zTo - zFrom
                            const zoneMm = zone.to - zone.from
                            return (
                              <Group key={zi}>
                                <Rect x={0} y={zFrom} width={studW} height={zH}
                                  fill="rgba(255,140,0,0.3)" stroke="#ff8c00" strokeWidth={1.5} dash={[4, 3]} />
                                <Text x={studW + 3} y={zFrom + zH / 2 - 5}
                                  text={`${zoneMm}мм`} fontSize={9} fill="#c05000" fontStyle="bold" />
                              </Group>
                            )
                          })}
                        </Group>
                      )
                    })() : null

                    if (insideOpening) {
                      // Стойка внутри проёма — рисуем ДВА сегмента:
                      // верхний (от потолочной направляющей вниз до верха проёма)
                      // нижний (от напольной направляющей вверх до подоконника)
                      // Оба куска — отрезки от целого профиля 3000мм, длина всегда < 3000мм,
                      // поэтому зоны нахлёста НЕ рисуем.
                      const aboveH = (localH - insideOpening.height - insideOpening.sillHeight) * scale - 8
                      const belowH = insideOpening.sillHeight * scale - 8

                      return (
                        <Group key={`s${pos}`} x={tx(pos) - studW / 2} y={0}>
                          {aboveH > 0 && (
                            <Rect x={0} y={localTop + 8} width={studW} height={aboveH}
                              fill={fillColor} stroke={STEEL_STROKE} strokeWidth={1} cornerRadius={2} />
                          )}
                          {belowH > 0 && (
                            <Rect x={0} y={localBot - 8 - belowH} width={studW} height={belowH}
                              fill={fillColor} stroke={STEEL_STROKE} strokeWidth={1} cornerRadius={2} />
                          )}
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
                        <Rect x={0} y={localTop + 8} width={studW} height={(localH - 16) * scale}
                          fill={fillColor} stroke={STEEL_STROKE} strokeWidth={1} cornerRadius={2} />
                        {overlapNode}
                      </Group>
                    )
                  })}

                  {/* Метки стоек проёмов снизу */}
                  {snapOpenings.filter(o => o.width > 0).flatMap(o =>
                    [o.pos, o.pos + o.width].map(pos => {
                      const cx = tx(pos), localBot = wallBotAt(pos), cy = localBot + 20
                      const tooClose = gridStuds.some(g => Math.abs(g - pos) <= MIN_GAP)
                      return (
                        <Group key={`dl${o.id}_${pos}`}>
                          <Line points={[cx, localBot, cx, cy - 10]} stroke="#888" strokeWidth={1} dash={[3, 3]} />
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
                          const x1 = tx(Math.min(g, doorPos)), x2 = tx(Math.max(g, doorPos))
                          const my = Math.max(wallBotAt(g), wallBotAt(doorPos)) + 42
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
                ⚠️ Высота {worstH} мм — промежуточные стойки наращиваются с перехлёстом {effectiveOverlap}мм
              </div>
            )}
            <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                {(() => {
                  const { pn, ps } = result.cutList
                  // Суммарный метраж по ролям из раскроя ПН
                  const pnMm = (role: string) => pn.bars.flatMap(b => b.pieces)
                    .filter(p => p.piece.role === role)
                    .reduce((s, p) => s + p.piece.length, 0)
                  const floorMm   = pnMm('floor')
                  const ceilMm    = pnMm('ceiling')
                  const sillMm    = pnMm('sill')
                  const lintelMm  = pnMm('lintel')
                  const psMm      = ps.bars.flatMap(b => b.pieces).reduce((s, p) => s + p.piece.length, 0)

                  // Штуки и остатки — из раскроя (не ceil!)
                  // Для ПН все позиции берутся из одного cutList.pn
                  // поэтому штуки/остаток показываем только для итоговой строки ПН
                  return <>
                    <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>ПН пол:</td>
                      <td style={{ paddingBottom: 6 }}><b>{fmtMeters(floorMm / 1000)}</b></td></tr>
                    <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>ПН потолок:</td>
                      <td style={{ paddingBottom: 6 }}><b>{fmtMeters(ceilMm / 1000)}</b></td></tr>
                    {sillMm > 0 && <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>ПН подоконник:</td>
                      <td style={{ paddingBottom: 6 }}><b>{fmtMeters(sillMm / 1000)}</b></td></tr>}
                    {lintelMm > 0 && <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Перемычки (ПН):</td>
                      <td style={{ paddingBottom: 6 }}><b>{fmtMeters(lintelMm / 1000)}</b></td></tr>}
                    <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#888', fontSize: 12 }}>ПН итого:</td>
                      <td style={{ paddingBottom: 6 }}>
                        {fmtCut(floorMm + ceilMm + sillMm + lintelMm, pn.totalBars, pn.totalWaste)}
                      </td></tr>
                    <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Стоечный ПС:</td>
                      <td style={{ paddingBottom: 6 }}><b>{fmtCut(psMm, ps.totalBars, ps.totalWaste)}</b></td></tr>
                    <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Стоек всего:</td>
                      <td style={{ paddingBottom: 6 }}><b>{result.studsCount} шт</b></td></tr>
                    {result.aboveStuds > 0 && <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Над/под проёмами:</td>
                      <td style={{ paddingBottom: 6 }}><b>{result.aboveStuds} шт</b></td></tr>}
                    <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>ГКЛ ({gklLayers} сл.):</td>
                      <td style={{ paddingBottom: 6 }}><b>{result.gklArea.toFixed(2)} м²</b></td></tr>
                    {hasInsulation && insulationArea && <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Утеплитель:</td>
                      <td style={{ paddingBottom: 6 }}><b>{insulationArea} м²</b></td></tr>}
                  </>
                })()}
              </tbody>
            </table>

            {/* ─── Раскрой ─── */}
            {(() => {
              const { pn, ps } = result.cutList
              const roleLabel: Record<string, string> = {
                floor: 'Пол', ceiling: 'Потолок', sill: 'Подоконник',
                lintel: 'Перемычка', stud: 'Стойка', stud_part: 'Стойка (доп.)',
              }
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
                            {p.piece.length >= 200 ? `${roleLabel[p.piece.role]} ${p.piece.length}` : ''}
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
                    {[['Пол/Потолок', '#e8f4ff'], ['Подоконник', '#fff8e8'], ['Перемычка', '#fff0e8'], ['Стойка', '#f0ffe8'], ['Остаток', '#f5f5f5']].map(([label, color]) => (
                      <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 12, height: 12, background: color, border: '1px solid #ccc', borderRadius: 2, display: 'inline-block' }} />
                        {label}
                      </span>
                    ))}
                  </div>
                  {renderCutList(pn, 'ПН направляющий')}
                  {renderCutList(ps, 'ПС стоечный')}
                </div>
              )
            })()}
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
                    else { setActiveLining(row.id); setActiveTab('lining') }
                  }} style={{ cursor: 'pointer', background: (row.type === 'wall' && row.id === activeWallId) || (row.type === 'lining' && row.id === activeLiningId) ? '#e8f0ff' : 'transparent' }}>
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

            {/* ─── Общий раскрой объекта ─── */}
            {(() => {
              const projectCut = calcProjectCutList(walls, linings)
              const poolLabels: Record<string, string> = {
                pn_50: 'ПН 50×40', pn_75: 'ПН 75×40', pn_100: 'ПН 100×40',
                ps_50: 'ПС 50×50', ps_75: 'ПС 75×50', ps_100: 'ПС 100×50',
                pp_60x27: 'ПП 60×27', pn_27x28: 'ПН 27×28',
              }
              const roleColor: Record<string, string> = {
                floor: '#e8f4ff', ceiling: '#e8f4ff', sill: '#fff8e8',
                lintel: '#fff0e8', stud: '#f0ffe8', stud_part: '#f0ffe8',
              }
              const roleLabel: Record<string, string> = {
                floor: 'Пол', ceiling: 'Потолок', sill: 'Подоконник',
                lintel: 'Перемычка', stud: 'Стойка', stud_part: 'Стойка доп.',
              }
              const pools = Object.entries(projectCut.pools)
              if (pools.length === 0) return null
              return (
                <div style={{ marginTop: 16, borderTop: '2px solid #ccd' }}>
                  <div style={{ padding: '10px 14px', background: '#f0f4ff', fontWeight: 600, fontSize: 13 }}>
                    Раскрой объекта (прутки 3000мм) — с учётом остатков между конструкциями
                  </div>
                  <div style={{ padding: '8px 14px' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, marginBottom: 8 }}>
                      {[['Пол/Потолок', '#e8f4ff'], ['Подоконник', '#fff8e8'], ['Перемычка', '#fff0e8'], ['Стойка', '#f0ffe8'], ['Остаток', '#f5f5f5']].map(([label, color]) => (
                        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 12, height: 12, background: color as string, border: '1px solid #ccc', borderRadius: 2, display: 'inline-block' }} />
                          {label}
                        </span>
                      ))}
                    </div>
                    {pools.map(([poolKey, cl]) => (
                      <div key={poolKey} style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#444', marginBottom: 4 }}>
                          {poolLabels[poolKey] ?? poolKey} — {cl.totalBars} шт, остаток {(cl.totalWaste / 1000).toFixed(2)}м
                        </div>
                        {cl.bars.map((bar, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 3 }}>
                            <span style={{ fontSize: 10, color: '#888', minWidth: 52 }}>Профиль {i + 1}:</span>
                            <div style={{ display: 'flex', flex: 1, height: 20, border: '1px solid #ccc', borderRadius: 3, overflow: 'hidden' }}>
                              {bar.pieces.map((p, j) => (
                                <div key={j} title={p.piece.label} style={{
                                  width: `${(p.piece.length / BAR_LENGTH) * 100}%`,
                                  background: roleColor[p.piece.role] ?? '#eee',
                                  borderRight: '1px solid #bbb',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 9, color: '#555', overflow: 'hidden', whiteSpace: 'nowrap',
                                }}>
                                  {p.piece.length >= 300 ? `${roleLabel[p.piece.role]} ${p.piece.length}` : ''}
                                </div>
                              ))}
                              {bar.waste > 0 && (
                                <div style={{
                                  width: `${(bar.waste / BAR_LENGTH) * 100}%`,
                                  background: '#f5f5f5',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 9, color: '#aaa',
                                }}>
                                  {bar.waste >= 300 ? `ост ${bar.waste}` : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}


          </div>
        )
      })()}
        </div>  {/* /основной контент */}
      </div>  {/* /тело */}
    </div>
  )
}
