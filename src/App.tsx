import { useState, useRef, useEffect } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Arrow } from 'react-konva'
import type { WallInput, Opening, Communication, PlywoodInsert, BoardSheetResult, BoardLayerLayout } from './types'
import { DEFAULT_BOARD_SPEC, boardLabel } from './types'
import { BoardSpecSelector } from './components/BoardSpecSelector'
import type { WallEntry, LiningEntry } from './store/useProjectStore'
import { PROFILES } from './data/profiles'
import { useWallCalc } from './hooks/useWallCalc'
import { CANVAS_W as CANVAS_W_MAX, PAD } from './constants'
import { useContainerWidth } from './hooks/useContainerWidth'
import { MIN_GAP } from './core/buildPositions'
import { useProjectStore } from './store/useProjectStore'
import { useProjectsStore } from './store/useProjectsStore'
import { useAuthStore } from './store/useAuthStore'
import { useSupabaseSync } from './hooks/useSupabaseSync'
import { AuthModal } from './components/AuthModal'
import { ProjectMembersPanel } from './components/ProjectMembersPanel'
import { activateInvitesForUser } from './lib/projectMembers'
import LiningCalc from './LiningCalc'
import FloorPlan from './FloorPlan'
import Scene3D from './Scene3D'
import CeilingCalc from './CeilingCalc'
import TileCalc from './TileCalc'
import { useCeilingSeedStore } from './store/useCeilingSeedStore'
import { calcStudMaterial } from './core/calcStudMaterial'
import { calcProjectCutList } from './core/calcProjectCutList'
import { calcProjectSheetLayout, buildSurfaceInputs } from './core/calcProjectSheetLayout'
import { BAR_LENGTH } from './core/cutList'
import ProfileEditor from './components/ProfileEditor'
import { interpolateY, flatProfile, maxStudHeight, integrateHeight } from './core/profileGeometry'
import { calcSheetLayout } from './core/calcSheetLayout'
import SheetLayoutCanvas from './components/SheetLayoutCanvas'

// Цвета оцинкованной стали
const STEEL_NORMAL   = '#b8c4cc'
const STEEL_EDGE     = '#8a9aa4'
const STEEL_DOOR     = '#7a8e99'
const STEEL_STROKE   = '#5a7080'

// Псевдо-3D: [highlight, shadow] для каждого цвета стойки
const STUD_GRAD: Record<string, [string, string]> = {
  [STEEL_NORMAL]: ['#d0dce4', '#9aa6ae'],
  [STEEL_EDGE]:   ['#a3b3bd', '#6c7c86'],
  [STEEL_DOOR]:   ['#93a7b2', '#5c707b'],
}
// Цвета слоёв псевдо-3D направляющей ПН
const RAIL_DARK = '#384f60', RAIL_MID = '#6a8898', RAIL_LIGHT = '#aec8d4'

const PROFILE_LEN = 3

let _openingIdCounter = 1
function newOpeningId() { return `op_${_openingIdCounter++}` }

let _commIdCounter = 1
function newCommunicationId() { return `comm_${_commIdCounter++}` }

function emptyDoor(): Opening {
  return { id: newOpeningId(), type: 'door', pos: 0, width: 0, height: 2100, sillHeight: 0 }
}
function emptyWindow(): Opening {
  return { id: newOpeningId(), type: 'window', pos: 0, width: 0, height: 1200, sillHeight: 900 }
}
function emptyOpening(): Opening {
  // "Просто проём" (арка, ниша, портал) — по умолчанию от пола, без подоконника,
  // высота как у двери. sillHeight можно задать вручную (например, ниша в стене).
  return { id: newOpeningId(), type: 'opening', pos: 0, width: 0, height: 2100, sillHeight: 0 }
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
  communications: [],
  customOverlap: null,
  layer1: DEFAULT_BOARD_SPEC,
  layer2: DEFAULT_BOARD_SPEC,
  plywoodInserts: [],
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

  // Произвольный проём по двум кликам на плане (14.07.2026): 1-й клик — начало,
  // 2-й — конец, после чего модалка спрашивает высоту от пола и высоту проёма.
  const [openingClickMode, setOpeningClickMode] = useState(false)
  const [openingClickStart, setOpeningClickStart] = useState<number | null>(null)
  const [openingClickModal, setOpeningClickModal] = useState<{ pos: number; width: number } | null>(null)
  const [openingClickSill, setOpeningClickSill] = useState('0')
  const [openingClickHeight, setOpeningClickHeight] = useState('2100')
  const [activeTab, setActiveTab] = useState<'wall' | 'lining' | 'plan' | 'ceiling' | 'tile' | '3d'>('wall')

  // Плита ("карандаш") на плане отправлена в расчёт потолка — переключаемся
  // на вкладку сразу, не заставляя искать её руками (сам расчёт CeilingCalc
  // подхватывает seed самостоятельно из того же стора).
  const ceilingSeedPending = useCeilingSeedStore(s => s.seed)
  useEffect(() => {
    if (ceilingSeedPending) setActiveTab('ceiling')
  }, [ceilingSeedPending])
  const [sheetLayerTab, setSheetLayerTab] = useState<1 | 2>(1)
  const [sheetSideTab, setSheetSideTab] = useState<'A' | 'B'>('A')
  const [showOffcuts, setShowOffcuts] = useState(false)
  const [showProjectOffcuts, setShowProjectOffcuts] = useState(false)
  const [hasInsulation, setHasInsulation] = useState(false)
  const [canvasWrapRef, CANVAS_W] = useContainerWidth(CANVAS_W_MAX, 48)
  const {
    positions, snap, result, heightWarning, profileWidth,
    calculate, onDragEnd, onRightDragEnd, shiftGrid, addStud, removeStud,
    currentFirstStud, currentStep,
  } = useWallCalc()

  const rightDragStart = useRef<{ studPos: number; startXpx: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTapTime = useRef<number>(0)
  const lastTapPos = useRef<{ x: number; y: number } | null>(null)

  // Синхронизируем form.firstStud с актуальной фазой гребёнки.
  // Это нужно чтобы:
  // 1. calcSheetLayout всегда видел реальный firstStud (включая ручные сдвиги)
  // 2. При повторном нажатии «рассчитать» позиция гребёнки сохранялась
  useEffect(() => {
    if (currentFirstStud > 0) {
      setForm(prev => ({ ...prev, firstStud: currentFirstStud }))
    }
  }, [currentFirstStud])

  const {
    projectName, walls, linings, activeWallId, activeLiningId,
    addWall, updateWall, removeWall, setActiveWall,
    removeLining, setActiveLining,
  } = useProjectStore()

  // ─── Объекты (localStorage) ───────────────────────────────────────────────
  const { projects, activeProjectId, createProject, deleteProject, selectProject, saveError, clearSaveError } = useProjectStore()
  const hydrateProject = useProjectStore(s => s.hydrateProject)
  const activeProject = projects.find(p => p.id === activeProjectId) ?? null

  const [showProjects, setShowProjects] = useState(false)

  // ─── Облако: вход и синхронизация объектов ─────────────────────────────────
  // Общий принцип (см. KONSPEKT от 06.07.2026): приложение работает и без
  // входа — как раньше, целиком на localStorage. Вход и облако — добавка.
  const { user, loading: authLoading, init: initAuth, signOut } = useAuthStore()
  const cloud = useProjectsStore()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null)

  useEffect(() => { initAuth() }, [initAuth])

  // При появлении пользователя (вход) — тянем список объектов из облака и,
  // если это первый вход, переносим локальные объекты (не удаляя их).
  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      await cloud.fetchProjects()
      const localProjects = useProjectStore.getState().projects
      const result = await cloud.migrateLocalIfNeeded(localProjects, user.id)
      if (!cancelled && result) {
        setMigrationNotice(
          result.errors.length > 0
            ? `Перенесено объектов: ${result.migrated}. Ошибки: ${result.errors.join('; ')}`
            : `Локальные объекты (${result.migrated}) перенесены в облако.`
        )
      }
      // Приглашения (project_members с invited_email) активируются по email
      // при входе — раздел 4г конспекта, п.3. Для входа только по телефону
      // email отсутствует — активировать нечего.
      if (user.email) await activateInvitesForUser(user.id, user.email)
    })()
    return () => { cancelled = true }
  }, [user])

  // Активный объект — облачный, если его id есть в списке cloud.projects.
  const isCloudActive = !!user && !!activeProjectId && cloud.projects.some(p => p.id === activeProjectId)
  const { scheduleSync } = useSupabaseSync(isCloudActive ? activeProjectId : null)

  async function openCloudProject(id: string) {
    const entry = await cloud.loadActiveProjectEntry(id)
    if (entry) { hydrateProject(entry); cloud.setActiveProject(id) }
    setShowProjects(false)
  }

  async function createCloudProject(name: string) {
    const row = await cloud.createProject(name)
    if (row) await openCloudProject(row.id)
  }

  async function deleteCloudProject(id: string) {
    await cloud.deleteProject(id)
    if (activeProjectId === id) selectProject(null)
  }

  function handleSignOut() {
    // Данные объекта пропадают из вида (не с сервера — просто перестаём
    // показывать активный объект), пока не войдут снова.
    if (isCloudActive) selectProject(null)
    signOut()
  }

  // Полный слепок активного объекта — для дебаунс-синхронизации с облаком
  // (сами мутации плана происходят в десятках функций useProjectStore, вклинивать
  // облачный вызов в каждую было бы огромной переделкой — см. projectCloud.ts).
  const levels = useProjectStore(s => s.levels)
  const profileTemplates = useProjectStore(s => s.profileTemplates)
  useEffect(() => {
    if (!isCloudActive) return
    scheduleSync({ walls, linings, levels, profileTemplates })
  }, [isCloudActive, walls, linings, levels, profileTemplates, scheduleSync])

  function set<K extends keyof WallInput>(key: K, value: WallInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // ─── Управление проёмами ───────────────────────────────────────────────────

  function addOpening(type: 'door' | 'window' | 'opening') {
    const o = type === 'door' ? emptyDoor() : type === 'window' ? emptyWindow() : emptyOpening()
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

  // ─── Управление коммуникациями (транзитными) ───────────────────────────────

  function addCommunication() {
    const c: Communication = { id: newCommunicationId(), pos: 0, width: 0, bottom: 1200, top: 1800 }
    setForm(prev => ({ ...prev, communications: [...prev.communications, c] }))
  }

  function updateCommunication(id: string, patch: Partial<Communication>) {
    setForm(prev => ({
      ...prev,
      communications: prev.communications.map(c => c.id === id ? { ...c, ...patch } : c)
    }))
  }

  function removeCommunication(id: string) {
    setForm(prev => ({ ...prev, communications: prev.communications.filter(c => c.id !== id) }))
  }

  // ─── Произвольный проём по клику ────────────────────────────────────────

  function handleOpeningClick(xpx: number) {
    if (!openingClickMode || !form.length) return
    const sc = (CANVAS_W - PAD * 2) / form.length
    const mm = Math.round((xpx - PAD) / sc / 10) * 10
    if (mm <= 0 || mm >= form.length) return

    if (openingClickStart === null) {
      setOpeningClickStart(mm)
    } else {
      const pos = Math.min(openingClickStart, mm)
      const width = Math.abs(mm - openingClickStart)
      setOpeningClickStart(null)
      setOpeningClickMode(false)
      if (width > 0) setOpeningClickModal({ pos, width })
    }
  }

  function confirmOpeningClickModal() {
    if (!openingClickModal) return
    const o: Opening = {
      id: newOpeningId(),
      type: 'opening',
      pos: openingClickModal.pos,
      width: openingClickModal.width,
      height: Number(openingClickHeight) || 0,
      sillHeight: Number(openingClickSill) || 0,
    }
    setForm(prev => ({ ...prev, openings: [...prev.openings, o] }))
    setOpeningClickModal(null)
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
        const label = (o: typeof a) => o.type === 'door' ? 'Дверь' : o.type === 'window' ? 'Окно' : 'Проём'
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

  const { l, h, openings: snapOpenings, communications: snapCommunications } = snap
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
  // Нахлёст перемычки на стойку проёма (мм на каждую сторону) — совпадает с
  // lintelTotal в calcLining.ts (o.width + 400 = 200мм нахлёста × 2 стороны).
  const LINTEL_OVERLAP_MM = 200
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
        {!authLoading && (
          <div
            onClick={() => user ? handleSignOut() : setShowAuthModal(true)}
            title={user ? `Выйти (${user.email ?? user.phone})` : 'Войти'}
            style={{
              width: 30, height: 30, background: '#e4e2dc', borderRadius: 5,
              border: '1px solid rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
            }}>
            <div style={{
              width: 20, height: 20, background: '#fbfbf9', border: '1px solid #c2c0b9',
              borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ width: 9, height: 3, borderRadius: 1.5, background: user ? '#5fb8e8' : '#8a8a8a' }} />
            </div>
          </div>
        )}
        <button onClick={() => setShowProjects(p => !p)}
          style={{ padding: '5px 14px', background: showProjects ? '#3a7bd5' : 'rgba(255,255,255,0.15)',
            color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6,
            cursor: 'pointer', fontSize: 13 }}>
          📁 Объекты
        </button>
        {isCloudActive && user && (
          <button onClick={() => setShowMembers(true)}
            style={{ padding: '5px 14px', background: 'rgba(255,255,255,0.15)',
              color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6,
              cursor: 'pointer', fontSize: 13 }}>
            👥 Участники
          </button>
        )}
      </div>

      {showMembers && activeProjectId && user && (
        <ProjectMembersPanel
          projectId={activeProjectId}
          currentUserId={user.id}
          currentUserEmail={user.email}
          onClose={() => setShowMembers(false)}
        />
      )}

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      {openingClickModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 20, width: 280 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Новый проём</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: '#777' }}>
              Позиция {openingClickModal.pos}мм, ширина {openingClickModal.width}мм
            </p>
            <label style={{ fontSize: 12, color: '#555' }}>Высота от пола (низ проёма), мм</label>
            <input type="number" value={openingClickSill} onChange={e => setOpeningClickSill(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 14, marginTop: 4, marginBottom: 12, boxSizing: 'border-box' }} />
            <label style={{ fontSize: 12, color: '#555' }}>Высота проёма (Н), мм</label>
            <input type="number" value={openingClickHeight} onChange={e => setOpeningClickHeight(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 14, marginTop: 4, marginBottom: 16, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setOpeningClickModal(null)}
                style={{ padding: '6px 14px', fontSize: 13, cursor: 'pointer', background: '#fff', border: '1px solid #ccc', borderRadius: 4 }}>
                Отмена
              </button>
              <button onClick={confirmOpeningClickModal}
                style={{ padding: '6px 14px', fontSize: 13, cursor: 'pointer', background: '#2a7', border: '1px solid #196', color: '#fff', borderRadius: 4 }}>
                Добавить проём
              </button>
            </div>
          </div>
        </div>
      )}

      {migrationNotice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
          background: '#e8f5e9', color: '#2e5c31', borderBottom: '2px solid #7fae6a', flexShrink: 0, fontSize: 13 }}>
          <span style={{ fontSize: 16 }}>☁️</span>
          <span style={{ flex: 1 }}>{migrationNotice}</span>
          <button onClick={() => setMigrationNotice(null)}
            style={{ padding: '4px 10px', background: 'transparent', color: '#2e5c31',
              border: '1px solid #2e5c31', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>
            Скрыть
          </button>
        </div>
      )}

      {/* ─── Баннер ошибки сохранения (переполнение localStorage) ─── */}
      {saveError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
          background: '#fff3cd', color: '#7a5c00', borderBottom: '2px solid #ffc107', flexShrink: 0, fontSize: 13 }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span style={{ flex: 1 }}>{saveError}</span>
          <button onClick={clearSaveError}
            style={{ padding: '4px 10px', background: 'transparent', color: '#7a5c00',
              border: '1px solid #7a5c00', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>
            Скрыть
          </button>
        </div>
      )}

      {/* ─── Тело ─── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* Боковая панель объектов */}
        {showProjects && (
          <div style={{ width: 220, maxWidth: '70vw', background: '#f5f5f5', borderRight: '1px solid #ddd',
            padding: 16, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#333', marginBottom: 4 }}>
              📁 Объекты {user && <span style={{ fontWeight: 400, fontSize: 11, color: '#3a7bd5' }}>(облако)</span>}
            </div>
            {(user ? cloud.projects : projects).length === 0 && (
              <div style={{ fontSize: 12, color: '#999' }}>Нет объектов</div>
            )}
            {(user ? cloud.projects : projects).map(p => (
              <div key={p.id}
                onClick={() => user ? openCloudProject(p.id) : (selectProject(p.id), setShowProjects(false))}
                style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  background: p.id === activeProjectId ? '#3a7bd5' : '#fff',
                  color: p.id === activeProjectId ? '#fff' : '#333',
                  border: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1 }}>{p.name}</span>
                <span onClick={e => {
                  e.stopPropagation()
                  if (!window.confirm('Удалить объект?')) return
                  user ? deleteCloudProject(p.id) : deleteProject(p.id)
                }}
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
                    if (!name) return
                    user ? createCloudProject(name) : createProject(name)
                    input.value = ''
                    setShowProjects(false)
                  }
                }} />
              <button onClick={() => {
                const input = document.getElementById('new-project-name') as HTMLInputElement
                const name = input?.value.trim() || 'Новый объект'
                user ? createCloudProject(name) : createProject(name)
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
        <div ref={canvasWrapRef} style={{ flex: 1, padding: 'clamp(10px, 4vw, 24px)', maxWidth: (activeTab === 'plan' || activeTab === '3d') ? 'none' : 900, overflowY: 'auto', minWidth: 0 }}>

      {/* ─── Панель объекта ─── (на вкладках "План" и "3D" скрыта — освобождаем высоту под канвас) */}
      {activeTab !== 'plan' && activeTab !== '3d' && (
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
      )}

      {/* ─── Вкладки ─── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #dde',
        overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {([['wall', 'Перегородки'], ['lining', 'Облицовка стен'], ['ceiling', '🏠 Потолки'], ['tile', '🀟 Плитка'], ['plan', '🗺 План'], ['3d', '🧊 3D']] as const).map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '10px clamp(10px, 3vw, 24px)', fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap',
            border: 'none', borderBottom: activeTab === tab ? '2px solid #3a7bd5' : '2px solid transparent',
            background: 'none', color: activeTab === tab ? '#3a7bd5' : '#666',
            fontWeight: activeTab === tab ? 600 : 400, marginBottom: -2, flexShrink: 0,
          }}>{label}</button>
        ))}
      </div>

      {activeTab === 'lining' && <LiningCalc canvasW={CANVAS_W} />}
      {activeTab === 'ceiling' && <CeilingCalc />}
      {activeTab === 'tile' && <TileCalc />}

      {activeTab === 'plan' && (
        <div style={{ margin: '0 -24px', height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <FloorPlan />
        </div>
      )}

      {activeTab === '3d' && (
        <div style={{ margin: '0 -24px', height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Scene3D />
        </div>
      )}

      {activeTab === 'wall' && <>
        <h1 style={{ display: 'none' }}>Калькулятор перегородки</h1>

        {/* ─── Строка 1 ─── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontSize: 13 }}>Тип перегородки</label><br />
            <select value={form.wallType} onChange={e => set('wallType', e.target.value as WallInput['wallType'])} style={{ width: '100%', padding: 7 }}>
              <option value="c111">С111 — 1 слой</option>
              <option value="c112">С112 — 2 слоя</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 13 }}>{form.wallType === 'c112' ? '1-й слой' : 'Материал обшивки'}</label><br />
            <BoardSpecSelector value={form.layer1} onChange={v => set('layer1', v)} />
          </div>
          {form.wallType === 'c112' && (
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 13 }}>2-й слой</label><br />
              <BoardSpecSelector value={form.layer2} onChange={v => set('layer2', v)} />
            </div>
          )}
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
            <button onClick={() => addOpening('opening')}
              style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 4 }}>
              + Проём
            </button>
            <button onClick={() => { setOpeningClickMode(m => !m); setOpeningClickStart(null) }}
              style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                background: openingClickMode ? '#ffe8a8' : '#fff', border: '1px solid #c9a94a', borderRadius: 4,
                color: openingClickMode ? '#754' : '#333' }}>
              {openingClickMode
                ? (openingClickStart === null ? '📍 Кликните начало проёма…' : '📍 Кликните конец проёма…')
                : '📍 Указать проём кликами'}
            </button>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#888' }}>
            Ширина неизвестна, известна только высота? Нажмите «Указать проём кликами», затем кликните начало и конец проёма на плане ниже — ширина посчитается сама, останется задать высоту.
          </p>

          {form.openings.length === 0 && (
            <p style={{ margin: 0, fontSize: 12, color: '#999' }}>Нет проёмов — нажмите кнопку для добавления</p>
          )}

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
              {(o.type === 'window' || o.type === 'opening') && (
                <div style={{ flex: 1, minWidth: 110 }}>
                  <label style={{ fontSize: 11, color: '#666' }}>Подоконник (мм)</label><br />
                  <input type="number" value={o.sillHeight || ''} onChange={e => updateOpening(o.id, { sillHeight: Number(e.target.value) })}
                    style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} placeholder="0 — от пола" />
                </div>
              )}
              <button onClick={() => removeOpening(o.id)}
                style={{ padding: '5px 8px', fontSize: 13, cursor: 'pointer', background: '#fff', border: '1px solid #e05', color: '#e05', borderRadius: 4, marginBottom: 1 }}>
                🗑
              </button>
            </div>
            )
          })}
        </div>

        {/* ─── Коммуникации (транзитные) ─── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#444' }}>Коммуникации (транзитные)</span>
            <button onClick={addCommunication}
              style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', background: '#fff8e8', border: '1px solid #d9c48a', borderRadius: 4 }}>
              + Коммуникация
            </button>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#888' }}>
            Лоток/труба сквозь стену: стойка на этой позиции не убирается, режется перемычкой снизу (всегда) и сверху (если запас до ПН &gt;400мм).
          </p>

          {form.communications.length === 0 && (
            <p style={{ margin: 0, fontSize: 12, color: '#999' }}>Нет коммуникаций</p>
          )}

          {form.communications.map((c, idx) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end',
              marginBottom: 8, padding: '8px 10px', background: '#fffaf0',
              border: '1px solid #d9c48a', borderRadius: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#666', minWidth: 60, paddingBottom: 6 }}>
                🛠 Комм. {idx + 1}
              </span>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: '#666' }}>Начало (мм)</label><br />
                <input type="number" value={c.pos || ''} onChange={e => updateCommunication(c.id, { pos: Number(e.target.value) })}
                  style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: '#666' }}>Ширина (мм)</label><br />
                <input type="number" value={c.width || ''} onChange={e => updateCommunication(c.id, { width: Number(e.target.value) })}
                  style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: '#666' }}>Низ от пола (мм)</label><br />
                <input type="number" value={c.bottom || ''} onChange={e => updateCommunication(c.id, { bottom: Number(e.target.value) })}
                  style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
              </div>
              <div style={{ flex: 1, minWidth: 110 }}>
                <label style={{ fontSize: 11, color: '#666' }}>Верх от пола (мм)</label><br />
                <input type="number" value={c.top || ''} onChange={e => updateCommunication(c.id, { top: Number(e.target.value) })}
                  style={{ width: '100%', padding: '5px 6px', fontSize: 13 }} />
              </div>
              <button onClick={() => removeCommunication(c.id)}
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
                    onClick={e => { if (openingClickMode) { const stage = e.target.getStage(); const pos = stage?.getPointerPosition(); if (pos) handleOpeningClick(pos.x) } }}
                    onDblClick={e => { if (openingClickMode) return; const stage = e.target.getStage(); const pos = stage?.getPointerPosition(); if (pos) addStud(pos.x) }}
                    onTouchEnd={e => { const touch = e.evt.changedTouches[0]; if (touch) handleBgTouchEnd(touch.clientX - (e.target.getStage()?.container().getBoundingClientRect().left ?? 0)) }} />

                  {openingClickMode && openingClickStart !== null && (
                    <Line points={[tx(openingClickStart), TOP_PAD, tx(openingClickStart), canvasH - BOT_PAD]}
                      stroke="#c9a94a" strokeWidth={2} dash={[6, 4]} />
                  )}

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

                  {/* Направляющие ПН — пол (следует профилю пола, с вырезами под проёмы "от пола") — псевдо-3D */}
                  {(() => {
                    // Совпадает с бэкендом (calcResults.ts/calcLining.ts): вырез не только под
                    // дверью, а под любым проёмом без подоконника (sillHeight=0) — включая окно
                    // "от пола" (панорамное остекление) и просто проём.
                    const floorLevelOpenings = snapOpenings.filter(o => o.sillHeight === 0 && o.width > 0)
                    const floorY = (pos: number) => wallBotAt(pos) - 4
                    const rail3D = (pts: number[], key: string) => (
                      <Group key={key}>
                        <Line points={pts} stroke={RAIL_DARK}  strokeWidth={9}   lineCap="round" lineJoin="round" />
                        <Line points={pts} stroke={RAIL_MID}   strokeWidth={5.5} lineCap="round" lineJoin="round" />
                        <Line points={pts} stroke={RAIL_LIGHT} strokeWidth={2}   lineCap="round" lineJoin="round" />
                      </Group>
                    )
                    if (floorLevelOpenings.length === 0) return rail3D(railPoints(floorProfile, floorY, 0, l), 'fl_all')
                    const segments: React.ReactNode[] = []
                    let cursor = 0
                    for (const o of [...floorLevelOpenings].sort((a, b) => a.pos - b.pos)) {
                      if (o.pos > cursor) segments.push(rail3D(railPoints(floorProfile, floorY, cursor, o.pos), `fl${o.id}`))
                      cursor = o.pos + o.width
                    }
                    if (cursor < l) segments.push(rail3D(railPoints(floorProfile, floorY, cursor, l), 'fl_end'))
                    return <>{segments}</>
                  })()}

                  {/* Направляющая ПН — потолок (следует профилю потолка) — псевдо-3D */}
                  {(() => { const pts = railPoints(ceilingProfile, pos => wallTopAt(pos) + 4, 0, l); return (
                    <Group>
                      <Line points={pts} stroke={RAIL_DARK}  strokeWidth={9}   lineCap="round" lineJoin="round" />
                      <Line points={pts} stroke={RAIL_MID}   strokeWidth={5.5} lineCap="round" lineJoin="round" />
                      <Line points={pts} stroke={RAIL_LIGHT} strokeWidth={2}   lineCap="round" lineJoin="round" />
                    </Group>
                  ) })()}


                  {/* Проёмы — сортируем и рисуем без перекрытий */}
                  {snapOpenings.filter(o => o.width > 0)
                    .sort((a, b) => a.pos - b.pos)
                    .map(o => {
                    const oBottom = wallBotAt(o.pos) - o.sillHeight * scale
                    const oTop = oBottom - o.height * scale
                    const oX = tx(o.pos), oW = o.width * scale
                    const color = o.type === 'door' ? '#ddeeff' : o.type === 'window' ? '#ffeedd' : '#eeeeee'
                    const stroke = o.type === 'door' ? '#88aacc' : o.type === 'window' ? '#ccaa88' : '#aaaaaa'
                    // Нахлёст перемычки на стойки проёма — крепится к двум стойкам
                    // проёма внахлёст, а не свисает в соседний пролёт. LINTEL_OVERLAP_MM
                    // совпадает с расчётом длины в calcLining.ts (o.width + 400 = по
                    // 200мм нахлёста с каждой стороны) — раньше здесь был фиксированный
                    // отступ 10px, не привязанный к масштабу чертежа, из-за чего на
                    // вытянутых стенах перемычка визуально вылезала за пределы стоек
                    // проёма в соседний пролёт.
                    const lintelOverlapPx = LINTEL_OVERLAP_MM * scale
                    return (
                      <Group key={`op${o.id}`}>
                        <Rect x={oX} y={oTop} width={oW} height={o.height * scale} fill={color} stroke={stroke} strokeWidth={1} />
                        {/* Перемычка сверху — нахлёст по 200мм на каждую стойку проёма */}
                        <Rect x={oX - lintelOverlapPx} y={oTop - 6} width={oW + lintelOverlapPx * 2} height={6} fill="#5a7080" />
                        {/* Подоконник — у любого проёма с sillHeight>0 (окно, либо ниша-"проём") */}
                        {o.sillHeight > 0 && (
                          <Rect x={oX} y={oBottom - 6} width={oW} height={6} fill="#5a7080" />
                        )}
                        <Text x={oX + oW / 2 - 20} y={oTop + o.height * scale / 2 - 6}
                          text={`${o.width}×${o.height}`} fontSize={10} fill="#336" />
                      </Group>
                    )
                  })}

                  {/* Коммуникации (транзитные) — низ/верх от пола + перемычки */}
                  {snapCommunications.filter(c => c.width > 0)
                    .sort((a, b) => a.pos - b.pos)
                    .map(c => {
                    const cBottom = wallBotAt(c.pos) - c.bottom * scale
                    const cTop = wallBotAt(c.pos) - c.top * scale
                    const cX = tx(c.pos), cW = c.width * scale
                    const hasTop = (h - c.top) > 400
                    const commLintelOverlapPx = LINTEL_OVERLAP_MM * scale
                    return (
                      <Group key={`comm${c.id}`}>
                        <Rect x={cX} y={cTop} width={cW} height={cBottom - cTop} fill="#ded0a0" stroke="#a8905a" strokeWidth={1} />
                        {/* Нижняя перемычка — всегда, нахлёст по 200мм на стойки, как и у проёмов */}
                        <Rect x={cX - commLintelOverlapPx} y={cBottom - 3} width={cW + commLintelOverlapPx * 2} height={6} fill="#5a7080" />
                        {/* Верхняя перемычка — только если есть запас > 400мм до ПН */}
                        {hasTop && (
                          <Rect x={cX - commLintelOverlapPx} y={cTop - 3} width={cW + commLintelOverlapPx * 2} height={6} fill="#5a7080" />
                        )}
                        <Text x={cX} y={cTop - 18} text={`комм. ${c.bottom}-${c.top}`} fontSize={10} fill="#795" />
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
                          {aboveH > 0 && (() => {
                            const [hi, sh] = STUD_GRAD[fillColor] ?? [fillColor, fillColor]
                            return <Rect x={0} y={localTop + 8} width={studW} height={aboveH}
                              fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: studW, y: 0 }}
                              fillLinearGradientColorStops={[0, hi, 0.18, fillColor, 0.82, fillColor, 1, sh]}
                              stroke={STEEL_STROKE} strokeWidth={1} cornerRadius={2} />
                          })()}
                          {belowH > 0 && (() => {
                            const [hi, sh] = STUD_GRAD[fillColor] ?? [fillColor, fillColor]
                            return <Rect x={0} y={localBot - 8 - belowH} width={studW} height={belowH}
                              fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: studW, y: 0 }}
                              fillLinearGradientColorStops={[0, hi, 0.18, fillColor, 0.82, fillColor, 1, sh]}
                              stroke={STEEL_STROKE} strokeWidth={1} cornerRadius={2} />
                          })()}
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
                        {/* height: 16px-зазор должен вычитаться ПОСЛЕ перевода в пиксели, а не до —
                            иначе при scale<1 (а он почти всегда <1) реально вычитается лишь
                            16×scale px вместо 16px, и стойка протыкает нижнюю направляющую */}
                        {(() => {
                          const [hi, sh] = STUD_GRAD[fillColor] ?? [fillColor, fillColor]
                          return <Rect x={0} y={localTop + 8} width={studW} height={Math.max(0, localH * scale - 16)}
                            fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: studW, y: 0 }}
                            fillLinearGradientColorStops={[0, hi, 0.18, fillColor, 0.82, fillColor, 1, sh]}
                            stroke={STEEL_STROKE} strokeWidth={1} cornerRadius={2} />
                        })()}
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
                  {/* ─── Закладные из фанеры ─── */}
                  {(snap.l > 0 && (form.plywoodInserts ?? []).length > 0) && (form.plywoodInserts ?? []).map(ins => {
                    // Y на canvas: пол внизу, y=0 от пола вверх
                    const floorY = wallBotAt(ins.x + ins.width / 2)
                    const pxX = tx(ins.x)
                    const pxY = floorY - (ins.y + ins.height) * scale
                    const pxW = ins.width * scale
                    const pxH = ins.height * scale
                    if (pxW < 2 || pxH < 2) return null
                    // Штриховка: диагональные линии через 12px
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
                      <Group key={ins.id}
                        x={0} y={0}
                        draggable
                        onDragEnd={e => {
                          const dx = e.target.x()
                          const dy = e.target.y()
                          const newXmm = Math.max(0, Math.min(snap.l - ins.width,
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

        {/* ─── Результаты ─── */}
        {result && (
          <div style={{ marginTop: 20, background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
            <h2 style={{ marginTop: 0 }}>Результат</h2>
            <p style={{ color: '#666', fontSize: 13 }}>
              {form.wallType.toUpperCase()} · {gklLayers} сл. {boardLabel(form.layer1)}{gklLayers === 2 ? ` + ${boardLabel(form.layer2)}` : ''} · профиль {form.profileThickness === '06' ? '0.6' : '0.7'}мм
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
                    {result.sealingTapeLm > 0 && <tr><td style={{ paddingRight: 16, paddingBottom: 6, color: '#555' }}>Лента уплотнительная:</td>
                      <td style={{ paddingBottom: 6 }}><b>{fmtMeters(result.sealingTapeLm)}</b></td></tr>}
                    {/* ─── Саморезы ─── */}
                    {(() => {
                      const s = result.screws
                      const plus20 = (n: number) => Math.ceil(n * 1.2)
                      const rowStyle = { paddingRight: 16, paddingBottom: 4, color: '#555', fontSize: 13 }
                      const tdStyle = { paddingBottom: 4, fontSize: 13 }
                      const screwRows: React.ReactNode[] = []
                      if (s.ln11 > 0) screwRows.push(
                        <tr key="ln"><td style={rowStyle}>LN 11 (клопы):</td>
                          <td style={tdStyle}><b>{s.ln11}</b> шт</td></tr>
                      )
                      if (s.count25 > 0) screwRows.push(
                        <tr key="s25"><td style={rowStyle}>{s.code25} 25 мм:</td>
                          <td style={tdStyle}>
                            <b>{s.count25}</b><sup style={{fontSize:9,color:'#888'}}>*</sup> шт
                            <span style={{color:'#aaa',margin:'0 4px'}}>〜</span>
                            <b>{plus20(s.count25)}</b> шт
                          </td></tr>
                      )
                      if (s.count35 > 0) screwRows.push(
                        <tr key="s35"><td style={rowStyle}>{s.code35} 35 мм:</td>
                          <td style={tdStyle}>
                            <b>{s.count35}</b><sup style={{fontSize:9,color:'#888'}}>*</sup> шт
                            <span style={{color:'#aaa',margin:'0 4px'}}>〜</span>
                            <b>{plus20(s.count35)}</b> шт
                          </td></tr>
                      )
                      if (s.woodScrews > 0) screwRows.push(
                        <tr key="wood"><td style={rowStyle}>Саморезы по дереву:</td>
                          <td style={tdStyle}><b>{s.woodScrews}</b> шт</td></tr>
                      )
                      if (screwRows.length === 0) return null
                      return <>
                        <tr><td colSpan={2} style={{paddingTop:6,paddingBottom:2,color:'#888',fontSize:11,borderTop:'1px solid #eee'}}>
                          Саморезы (<sup style={{fontSize:9}}>*</sup> Кнауф · 〜 сторонний +20%)
                        </td></tr>
                        {screwRows}
                      </>
                    })()}
                  </>
                })()}
              </tbody>
            </table>

            {/* ─── Раскрой листов ─── */}
            {(() => {
              if (!result) return null
              const ceilP = form.ceilingProfile && form.ceilingProfile.length >= 2 ? form.ceilingProfile : flatProfile(form.length, form.height)
              const floorP = form.floorProfile && form.floorProfile.length >= 2 ? form.floorProfile : flatProfile(form.length, 0)
              const sheetLayout: BoardSheetResult = calcSheetLayout(
                form.length,
                ceilP,
                floorP,
                currentFirstStud || form.firstStud,
                currentStep || form.step,
                gklLayers as 1 | 2,
                form.openings,
                form.layer1,
                form.layer2,
                2,  // перегородка всегда 2 стороны
              )

              // Активная раскладка по выбранным вкладкам
              const sideLayouts = {
                A: { 1: sheetLayout.layer1,       2: sheetLayout.layer2 },
                B: { 1: sheetLayout.sideB_layer1, 2: sheetLayout.sideB_layer2 },
              }
              const activeLayout = (sideLayouts[sheetSideTab as 'A' | 'B'] as Record<number, BoardLayerLayout | null>)[sheetLayerTab]
              if (!activeLayout) return null

              const { totalSheetsNeeded, totalUsedAreaM2, totalSheetAreaM2, totalOffcutAreaM2, totalWastePercent } = sheetLayout
              const sidesCount = 2
              const instancesCount = sidesCount * gklLayers

              return (
                <div style={{ marginTop: 20, background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 14 }}>Раскрой листов</b>

                    {/* Вкладки: Сторона А / Сторона Б */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['A', 'B'] as const).map(side => (
                        <button key={side}
                          onClick={() => setSheetSideTab(side)}
                          style={{
                            padding: '3px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                            border: '1px solid #ccc',
                            background: sheetSideTab === side ? '#2d7d46' : '#f5f5f5',
                            color: sheetSideTab === side ? '#fff' : '#333',
                          }}>
                          Ст. {side}
                        </button>
                      ))}
                    </div>

                    {/* Вкладки: Слой 1 / Слой 2 */}
                    {gklLayers === 2 && (
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

                  {/* Статистика текущего вида (без обрезков — они в общем пуле) */}
                  <div style={{ fontSize: 12, color: '#555', marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                    <span>▲ Листов: <b>{activeLayout.sheetsNeeded}</b></span>
                    <span>В работе: <b>{activeLayout.usedAreaM2.toFixed(2)} м²</b></span>
                    <span>Куплено: <b>{activeLayout.sheetAreaM2.toFixed(2)} м²</b></span>
                  </div>

                  {/* Итоговая статистика по перегородке */}
                  <div style={{
                    fontSize: 12, background: '#f0f7ff', border: '1px solid #b3d4ff',
                    borderRadius: 6, padding: '6px 10px', marginBottom: 10,
                    display: 'flex', flexWrap: 'wrap', gap: '6px 16px', color: '#1a4a8a',
                  }}>
                    <b>Перегородка ({instancesCount} экз. × общий пул):</b>
                    <span>Листов: <b>{totalSheetsNeeded}</b></span>
                    <span>В работе: <b>{totalUsedAreaM2.toFixed(2)} м²</b></span>
                    <span>Куплено: <b>{totalSheetAreaM2.toFixed(2)} м²</b></span>
                    <span>Финал. обрезки: <b>{totalOffcutAreaM2.toFixed(2)} м²</b></span>
                    <span>Отходы: <b>{totalWastePercent}%</b></span>
                  </div>

                  <SheetLayoutCanvas
                    layout={activeLayout}
                    wallL={form.length}
                    wallH={worstH}
                    canvasW={CANVAS_W}
                    firstStud={currentFirstStud || form.firstStud}
                    step={currentStep || form.step}
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
                                const scale = Math.min(90 / o.h, 130 / o.w)
                                const dw = Math.round(o.w * scale)
                                const dh = Math.round(o.h * scale)
                                const bg = area > 500000 ? '#4caf50'
                                  : area > 200000 ? '#26a69a'
                                  : area > 80000  ? '#42a5f5'
                                  : '#ff9800'
                                return (
                                  <div key={idx} title={
                                    o.polygon
                                      ? `${Math.round(o.w)}×${Math.round(o.h)}мм (вписанный прямоугольник) — из отхода косого среза, ${(area/1e6).toFixed(3)} м²`
                                      : `${Math.round(o.w)}×${Math.round(o.h)}мм — ${(area/1e6).toFixed(3)} м²`
                                  }
                                    style={{
                                      width: dw, height: dh,
                                      background: bg, borderRadius: 3, opacity: 0.85,
                                      display: 'flex', flexDirection: 'column',
                                      alignItems: 'center', justifyContent: 'center',
                                      fontSize: Math.max(9, Math.min(11, dw / 6)),
                                      color: '#fff', fontWeight: 600, lineHeight: 1.2,
                                      cursor: 'default', flexShrink: 0,
                                      border: o.polygon ? '1.5px dashed #fff' : undefined,
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

            {/* ─── Раскрой профилей ─── */}
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

            {/* ─── Раскрой листов объекта ─── */}
            {(() => {
              const surfaces = buildSurfaceInputs(walls, linings)
              if (surfaces.length === 0) return null
              const proj = calcProjectSheetLayout(surfaces)
              const offcuts = [...proj.finalOffcuts].sort((a, b) => b.w * b.h - a.w * a.h)
              const offcutM2 = offcuts.reduce((s, o) => s + o.w * o.h / 1e6, 0)
              return (
                <div style={{ marginTop: 0, borderTop: '2px solid #ccd' }}>
                  <div style={{ padding: '10px 14px', background: '#f0fff4', fontWeight: 600, fontSize: 13 }}>
                    Раскрой листов объекта — с учётом остатков между конструкциями
                  </div>
                  <div style={{ padding: '8px 14px', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f5f5f5', color: '#555' }}>
                          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Конструкция</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>Листов</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>В работе, м²</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>Куплено, м²</th>
                          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>Отходы</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proj.surfaces.map(({ id, label, result: r }) => (
                          <tr key={id} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '4px 8px', color: '#333' }}>{label}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.totalSheetsNeeded}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.totalUsedAreaM2.toFixed(2)}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.totalSheetAreaM2.toFixed(2)}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.totalWastePercent}%</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: '#f0fff4', fontWeight: 700, borderTop: '2px solid #b2dfdb' }}>
                          <td style={{ padding: '5px 8px', color: '#1a4a2e' }}>ИТОГО</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#1a4a2e' }}>{proj.totalSheetsNeeded}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#1a4a2e' }}>{proj.totalUsedAreaM2.toFixed(2)}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#1a4a2e' }}>{proj.totalSheetAreaM2.toFixed(2)}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#1a4a2e' }}>{proj.totalWastePercent}%</td>
                        </tr>
                      </tfoot>
                    </table>

                    {offcuts.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <button
                          onClick={() => setShowProjectOffcuts(v => !v)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: 'none', border: '1px solid #ddd', borderRadius: 6,
                            padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                            color: '#555', width: '100%', textAlign: 'left',
                          }}>
                          <span>🪚 Финальные остатки объекта: <b>{offcuts.length} шт</b>, <b>{offcutM2.toFixed(2)} м²</b></span>
                          <span style={{ marginLeft: 'auto' }}>{showProjectOffcuts ? '▲' : '▼'}</span>
                        </button>
                        {showProjectOffcuts && (
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
                                  <div key={idx}
                                    title={`${Math.round(o.w)}×${Math.round(o.h)}мм — ${(area / 1e6).toFixed(3)} м²`}
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
                    )}
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
