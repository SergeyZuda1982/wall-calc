/**
 * CeilingCalc.tsx — вкладка «Потолки»
 * Пошаговый конструктор каркаса П112 (П212)
 * Шаги: 1-ПН периметр → 2-Подвесы+Основные ПП → 3-Несущие ПП+Крабы → 4-Зашить ГКЛ
 */

import { useState, useRef, useEffect } from 'react'
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva'
import type { CeilingSpecFull, CeilingSpec } from './data/ceilingData'
import { CEILING_TYPE_LABELS, CEILING_STEP_OPTIONS, P112_HANGER_STEP, P113_HANGER_STEP, CEILING_LOAD_CLASS_OPTIONS } from './data/ceilingData'
import type { CeilingType, CeilingLayers, CeilingMaterial, CeilingSheetThickness, CeilingStep, CeilingLoadClass } from './data/ceilingData'
import { calcCeiling } from './core/calcCeiling'
import type { CeilingCalcResult, CeilingPolygonInput } from './core/calcCeiling'
import { calcFrameRowPositions, resolveFrameParams, snapHangerPositionsToAxis } from './core/calcP112Frame'
import type { PolygonP112FrameResult } from './core/calcPolygonP112Frame'
import { toWorld } from './core/calcPolygonP112Frame'
import { useCeilingSeedStore } from './store/useCeilingSeedStore'
import { useProjectStore } from './store/useProjectStore'
import type { Point2D } from './core/geometry2d'
import { polygonSides } from './core/geometry2d'
import type { CeilingSeedZone } from './store/useCeilingSeedStore'

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
  crab:         '#f57c00',   // Краб — соединитель двухуровневый (П112)
  crab1lvl:     '#8e24aa',   // Соединитель одноуровневый (П113) — другая деталь, свой цвет
  sheetFill:    'rgba(144,202,249,0.22)',
  sheetBorder:  '#1e88e5',
  sheetCutFill: 'rgba(255,183,77,0.28)',
  sheetCutBorder:'#fb8c00',
  scaleLine:    '#90a4ae',
  scaleText:    '#546e7a',
}

// ─── Шаги монтажа ────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4

// 11.07.2026: ПН 28×27 (периметральный профиль) есть ТОЛЬКО в системе П113 —
// в П112/П212 крепление к стене идёт через анкерные подвесы (≤100мм от
// стены), без бортовой направляющей (см. KONSPEKT.md, сессия 11.07.2026,
// фото официального документа Кнауф лист 1.045.9-2.08.1-2). Раньше Step 1
// одинаково назывался "ПН 28×27" для ЛЮБОГО типа потолка — для П112 это было
// не просто лишним визуальным элементом (см. CeilingCanvas ниже), а неверным
// названием первого шага монтажа.
function getSteps(type: CeilingType): { id: Step; label: string; desc: string }[] {
  if (type === 'p113') {
    return [
      { id: 1, label: 'ПН 28×27',        desc: 'Периметральный профиль' },
      { id: 2, label: 'Подвесы + ПП',    desc: 'Основные профили вдоль длины' },
      { id: 3, label: 'Несущие ПП',      desc: 'Поперёк + крабы' },
      { id: 4, label: 'Зашить ГКЛ',      desc: 'Раскладка листов' },
    ]
  }
  return [
    { id: 1, label: 'Подвесы',           desc: 'Анкерные, у стен ≤100мм' },
    { id: 2, label: 'Подвесы + ПП',      desc: 'Основные профили вдоль длины' },
    { id: 3, label: 'Несущие ПП',        desc: 'Поперёк + крабы' },
    { id: 4, label: 'Зашить ГКЛ',        desc: 'Раскладка листов' },
  ]
}

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
  const [seedBanner, setSeedBanner] = useState<{ label: string; holesCount: number; zoneCount: number } | null>(null)
  // Зоны (одна или несколько Плит/Потолков), пришедшие вместе с seed — для
  // холста показываем реально обведённую форму(ы), а не только цифры
  // площади/периметра (см. KONSPEKT.md 10.07.2026, пункты 3 и 4).
  const [seedZones, setSeedZones] = useState<CeilingSeedZone[] | null>(null)
  // НОВОЕ (10.07.2026): если seed пришёл из Room (не из Плиты/Потолка),
  // здесь хранится id этого Room — чтобы кнопка «Сохранить в 3D» знала,
  // куда писать настройки каркаса (updateRoom), и чтобы можно было
  // подставить в форму то, что для этого Room уже было сохранено раньше.
  const [seedRoomId, setSeedRoomId] = useState<string | null>(null)
  const [savedToRoom, setSavedToRoom] = useState(false)
  // Пункт 7 плана (KONSPEKT.md 10.07.2026) — та же механика «Сохранить в
  // 3D», что и у Room выше, но для свободного контура Ceiling: id сущности
  // (см. ceilingEntityId в useCeilingSeedStore.ts) + флаг «уже сохранено».
  const [seedCeilingId, setSeedCeilingId] = useState<string | null>(null)
  const [savedToCeiling, setSavedToCeiling] = useState(false)
  const floorPlanRooms = useProjectStore(s => s.floorPlan?.rooms ?? [])
  const updateRoom = useProjectStore(s => s.updateRoom)
  // Пункт 5 плана (KONSPEKT.md 10.07.2026): выбор стены начала раскладки
  // профилей для непрямоугольного контура. С пункта 6 (та же сессия, чуть
  // позже) значение реально используется в расчёте — buildPolygonInput()
  // ниже задействует его для точной геометрии каркаса (только для ОДНОЙ
  // зоны, для объединения нескольких зон см. её же комментарий).
  const [startWall, setStartWall] = useState<{ zoneIndex: number; sideIndex: number } | null>(null)

  // Плита ("карандаш"), отправленная с плана — площадь/периметр вычислены
  // по факту обведённого контура (не прямоугольник), поэтому обнуляем
  // roomLengthMm/roomWidthMm: точная раскладка листов по L×W для такой
  // формы всё равно была бы неверной, работаем в режиме "площадь+периметр".
  const floorPlanCeilings = useProjectStore(s => s.floorPlan?.ceilings ?? [])
  const updateCeiling = useProjectStore(s => s.updateCeiling)
  const consumeSeed = useCeilingSeedStore(s => s.seed)
  const clearSeed = useCeilingSeedStore(s => s.clearSeed)
  useEffect(() => {
    if (!consumeSeed) return
    const savedRoomSpec = consumeSeed.roomId
      ? floorPlanRooms.find(r => r.id === consumeSeed.roomId)?.ceilingSpec
      : undefined
    const savedCeilingEntity = consumeSeed.ceilingEntityId
      ? floorPlanCeilings.find(cl => cl.id === consumeSeed.ceilingEntityId)
      : undefined
    const savedSpec = savedRoomSpec ?? savedCeilingEntity?.ceilingSpec
    setForm(prev => {
      const next: CeilingSpecFull = {
        ...prev,
        roomLengthMm: 0,
        roomWidthMm: 0,
        areaSqm: consumeSeed.areaSqm,
        perimeterM: consumeSeed.perimeterM,
        // Если для этого Room/Ceiling раньше уже сохраняли каркас (см.
        // кнопку «Сохранить в 3D» ниже) — подставляем его вместо дефолтов
        // формы, чтобы не заставлять настраивать заново при повторном
        // открытии.
        ...(savedSpec ? {
          type: savedSpec.type,
          stepC: savedSpec.stepC,
          stepB: savedSpec.stepB,
          layoutMode: savedSpec.layoutMode,
          bearingAlongLength: savedSpec.bearingAlongLength,
          mountDirection: savedSpec.mountDirection,
          loadClass: savedSpec.loadClass,
        } : {}),
      }
      setResult(calcCeiling(next))
      return next
    })
    setSeedBanner({ label: consumeSeed.label, holesCount: consumeSeed.holesCount, zoneCount: consumeSeed.zones.length })
    setSeedZones(consumeSeed.zones)
    setSeedRoomId(consumeSeed.roomId ?? null)
    setSavedToRoom(false)
    setSeedCeilingId(consumeSeed.ceilingEntityId ?? null)
    setSavedToCeiling(false)
    // Сохранённая ранее стена старта (startWallSideIndex) — та же зона
    // (индекс 0, у Ceiling-сида зона всегда одна, см. ceilingEntityId).
    setStartWall(
      savedCeilingEntity?.startWallSideIndex != null
        ? { zoneIndex: 0, sideIndex: savedCeilingEntity.startWallSideIndex }
        : null,
    )
    clearSeed()
  }, [consumeSeed, clearSeed, floorPlanRooms, floorPlanCeilings])

  useEffect(() => {
    if (!canvasRef.current) return
    const ro = new ResizeObserver(e => setCanvasW(e[0].contentRect.width || 600))
    ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [])

  // НОВОЕ (11.07.2026, по просьбе пользователя): автосинхронизация вместо
  // ручной кнопки «Сохранить в 3D» — раньше 3D-вид не обновлялся, пока
  // пользователь явно не нажимал кнопку (легко забыть, известное
  // ограничение из KONSPEKT.md). Теперь любое изменение параметров каркаса
  // сразу пишется в Room.ceilingSpec, если этот расчёт привязан к
  // помещению (seedRoomId задан). Зависимости — только поля, которые
  // реально влияют на 3D-сетку/смету каркаса (см. Scene3D.tsx), а не ВСЯ
  // форма целиком — иначе несвязанные поля (заметки, roomLengthMm для
  // точной раскладки листов и т.п.) тоже гоняли бы лишние записи в стор.
  useEffect(() => {
    if (!seedRoomId) return
    const ceilingSpec: CeilingSpec = {
      type: form.type,
      layers: form.layers,
      material: form.material,
      thickness: form.thickness,
      stepC: form.stepC,
      areaSqm: form.areaSqm,
      perimeterM: form.perimeterM,
      stepB: form.stepB,
      bearingAlongLength: form.bearingAlongLength,
      layoutMode: form.layoutMode,
      mountDirection: form.mountDirection,
      loadClass: form.loadClass,
    }
    updateRoom(seedRoomId, { ceilingSpec })
    setSavedToRoom(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    seedRoomId, form.type, form.layers, form.material, form.thickness, form.stepC,
    form.areaSqm, form.perimeterM, form.stepB, form.bearingAlongLength,
    form.layoutMode, form.mountDirection, form.loadClass,
  ])

  // 11.07.2026: та же автосинхронизация, что и выше для Room (по свежему
  // прецеденту той сессии) — но для свободного контура Ceiling (пункт 7).
  // Дополнительное условие относительно Room: нужна ещё и выбранная стена
  // старта (startWall) — без неё нет точки отсчёта для calcPolygonP112Frame
  // (см. CeilingEntityMesh.tsx), поэтому пока стена не выбрана — не пишем.
  useEffect(() => {
    if (!seedCeilingId || form.type !== 'p112' || seedZones?.length !== 1 || !startWall) return
    const ceilingSpec: CeilingSpec = {
      type: form.type,
      layers: form.layers,
      material: form.material,
      thickness: form.thickness,
      stepC: form.stepC,
      areaSqm: form.areaSqm,
      perimeterM: form.perimeterM,
      stepB: form.stepB,
      bearingAlongLength: form.bearingAlongLength,
      layoutMode: form.layoutMode,
      mountDirection: form.mountDirection,
      loadClass: form.loadClass,
      slabGapMm: form.slabGapMm,
    }
    updateCeiling(seedCeilingId, { ceilingSpec, startWallSideIndex: startWall.sideIndex })
    setSavedToCeiling(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    seedCeilingId, seedZones, startWall, form.type, form.layers, form.material, form.thickness, form.stepC,
    form.areaSqm, form.perimeterM, form.stepB, form.bearingAlongLength,
    form.layoutMode, form.mountDirection, form.loadClass, form.slabGapMm,
  ])

  // Пункт 6: выбор/смена стены начала раскладки (или новый набор зон) должны
  // пересчитать смету — раньше эти состояния ни на что не влияли (заглушка
  // пункта 5), теперь buildPolygonInput() задействует их в расчёте.
  useEffect(() => {
    setForm(prev => {
      if (prev.areaSqm > 0) setResult(runCalc(prev))
      return prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWall, seedZones])

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
      if (next.areaSqm > 0) setResult(runCalc(next))
      return next
    })
  }

  // Пункт 6 плана (KONSPEKT.md 10.07.2026): если контур пришёл с плана
  // (seedZones) и выбрана стена начала раскладки (startWall) — считаем
  // каркас и раскрой листов ТОЧНО по контуру, а не по среднему расходу.
  // Ограничение v1: только ОДНА зона (объединение нескольких зон в общий
  // геометрический контур — отдельная задача, тут физического union пока
  // нет, см. combineCeilingSeeds.ts — там только сумма площади/периметра).
  function buildPolygonInput(): CeilingPolygonInput | undefined {
    if (!seedZones || !startWall) return undefined
    if (seedZones.length !== 1 || startWall.zoneIndex !== 0) return undefined
    const zone = seedZones[0]
    if (zone.outerMm.length < 3) return undefined
    const side = polygonSides(zone.outerMm)[startWall.sideIndex]
    if (!side) return undefined
    return { outerMm: zone.outerMm, holesMm: zone.holesMm, startSide: { start: side.start, end: side.end } }
  }

  function runCalc(spec: CeilingSpecFull): CeilingCalcResult {
    return calcCeiling(spec, buildPolygonInput())
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

  const layoutModeUi = form.layoutMode ?? 'user'
  const frameParamsUi = resolveFrameParams({
    stepC: form.stepC, layoutMode: layoutModeUi, userStepB: form.stepB,
    mountDirection: form.mountDirection, loadClass: form.loadClass,
    ceilingType: form.type === 'p113' ? 'p113' : 'p112',
  })

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

        {seedRoomId && (
          <div style={{
            padding: '8px 10px', background: savedToRoom ? '#f0fdf4' : C.accentLight,
            border: `1px solid ${savedToRoom ? C.success : C.accent}`,
            borderRadius: 6, fontSize: 11, color: C.text,
          }}>
            Расчёт привязан к помещению на плане.
            {savedToRoom
              ? <span style={{ color: C.success }}> Настройки каркаса синхронизированы — 3D-вид рисует именно эту раскладку.</span>
              : ' Синхронизация с 3D-видом...'}
          </div>
        )}

        {seedCeilingId && form.type === 'p112' && seedZones?.length === 1 && (
          <div style={{
            padding: '8px 10px', background: savedToCeiling ? '#f0fdf4' : C.accentLight,
            border: `1px solid ${savedToCeiling ? C.success : C.accent}`,
            borderRadius: 6, fontSize: 11, color: C.text,
          }}>
            Расчёт привязан к потолку на плане.
            {!startWall
              ? ' Выберите стену начала раскладки выше — после этого 3D-сцена сама нарисует сетку каркаса по этой раскладке.'
              : savedToCeiling
                ? <span style={{ color: C.success }}> Настройки каркаса синхронизированы — 3D-вид рисует именно эту раскладку.</span>
                : ' Синхронизация с 3D-видом...'}
          </div>
        )}

        {seedBanner && (
          <div style={{
            padding: '8px 10px', background: '#eff6ff', border: `1px solid ${C.accent}`,
            borderRadius: 6, fontSize: 11, color: C.text, display: 'flex',
            justifyContent: 'space-between', alignItems: 'flex-start', gap: 6,
          }}>
            <div>
              {seedBanner.zoneCount > 1 ? (
                <>Площадь/периметр — сумма <b>{seedBanner.zoneCount} зон</b>, объединённых с плана: «{seedBanner.label}».</>
              ) : (
                <>Площадь/периметр взяты из плиты «<b>{seedBanner.label}</b>» на плане.</>
              )}
              {seedBanner.holesCount > 0 && (
                <div style={{ marginTop: 3, color: C.warning }}>
                  ⚠ {seedBanner.holesCount} вырез{seedBanner.holesCount > 1 ? 'а' : ''} учтён{seedBanner.holesCount > 1 ? 'ы' : ''}
                  {' '}в площади, но НЕ в периметре — обрамление ПН вокруг выреза добавьте отдельно, если нужно.
                </div>
              )}
              {seedBanner.zoneCount > 1 && (
                <div style={{ marginTop: 3, color: C.muted }}>
                  Периметр — сумма периметров зон по отдельности (с запасом, не по внешнему контуру объединения).
                </div>
              )}
            </div>
            <button onClick={() => { setSeedBanner(null); setSeedZones(null); setStartWall(null) }}
              style={{ border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
          </div>
        )}

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
                  setForm(prev => { const n = { ...prev, areaSqm: v }; if (v > 0) setResult(runCalc(n)); return n })
                }} />
            </div>
            <div>
              <label style={lbl}>Периметр, м</label>
              <input style={inp} type="number" min={0} step={0.1}
                value={form.perimeterM || ''} onChange={e => {
                  const v = +e.target.value
                  setForm(prev => { const n = { ...prev, perimeterM: v }; if (n.areaSqm > 0) setResult(runCalc(n)); return n })
                }} />
            </div>
          </div>
        </Card>

        {/* Стена начала раскладки — пункт 5 плана (KONSPEKT.md 10.07.2026).
            Только для непрямоугольного контура (пришёл с плана, L×W не заданы).
            С пункта 6 (та же сессия) выбор реально запускает точный расчёт
            каркаса/листов по контуру (calcPolygonP112Frame.ts) — но только
            для ОДНОЙ зоны; при объединении нескольких зон геометрического
            union контуров пока нет, см. buildPolygonInput() и текст в
            StartWallPicker ниже. Для прямоугольного помещения (hasRoom)
            раскладка уже точная и стена старта там не нужна. */}
        {!hasRoom && seedZones && seedZones.some(z => z.outerMm.length >= 3) && (
          <Card title="СТЕНА НАЧАЛА РАСКЛАДКИ">
            <StartWallPicker
              zones={seedZones}
              value={startWall}
              onChange={setStartWall}
            />
          </Card>
        )}

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

        {/* Точный расчёт каркаса П112/П113 — см. calcP112Frame.ts / calcP113Frame.ts.
             12.07.2026: карточка открыта и для П113 — точная геометрия уже
             есть (calcCeiling.ts, hasPreciseGeometryP113), раньше это условие
             молча выключало её для П113. */}
        {(form.type === 'p112' || form.type === 'p113') && (
          <Card title="ТОЧНЫЙ РАСЧЁТ КАРКАСА">
            <div style={{ marginBottom: 8 }}>
              <label style={lbl}>Вариант раскладки рядов</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['user', 'knauf'] as const).map(m => (
                  <button key={m}
                    onClick={() => setField('layoutMode', m)}
                    style={{
                      flex: 1, padding: '6px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                      border: `1px solid ${(form.layoutMode ?? 'user') === m ? C.accent : '#3a4060'}`,
                      background: (form.layoutMode ?? 'user') === m ? C.accent : 'transparent',
                      color: (form.layoutMode ?? 'user') === m ? '#fff' : C.muted,
                    }}>
                    {m === 'user' ? 'Пользовательский' : 'По Кнауф'}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 4, fontSize: 10, color: C.muted }}>
                {(form.layoutMode ?? 'user') === 'user'
                  ? 'Реальная практика: последний ряд подвигается ближе к стене, лишний ряд не ставится.'
                  : 'Строго по официальной таблице КНАУФ (лист 40/76, серия 1.045.9-2.08.1-4): оба профиля — отступ ≤100мм от стены, последний ряд не сжимается.'}
              </div>
            </div>

            {layoutModeUi === 'knauf' ? (
              <>
                {/* 11.07.2026: переключатель "Поперечно/Продольно" убран для
                    П112 — по официальному документу (лист 1.045.9-2.08.1-2)
                    у П112 есть только один вариант монтажа, b=500мм
                    константа. Продольный монтаж (b=400мм) относится к П113,
                    см. ceilingData.ts (CeilingMountDirection). mountDirection
                    больше не задаётся из UI для П112 → resolveFrameParams
                    использует дефолт 'crosswise'. */}
                <div style={{ marginBottom: 8 }}>
                  <label style={lbl}>Класс нагрузки на подвесы, кН/м²</label>
                  <select style={inp} value={form.loadClass ?? 0.15}
                    onChange={e => setField('loadClass', +e.target.value as CeilingLoadClass)}>
                    {CEILING_LOAD_CLASS_OPTIONS.map(lc => (
                      <option key={lc} value={lc}>≤ {lc}</option>
                    ))}
                  </select>
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                  Расчётные шаги по таблице: несущий b = <b>{frameParamsUi.stepB}мм</b>, подвесы a = <b>{frameParamsUi.stepA}мм</b>
                </div>
                {frameParamsUi.warning && (
                  <div style={{ marginBottom: 8, fontSize: 11, color: C.warning }}>⚠ {frameParamsUi.warning}</div>
                )}
              </>
            ) : (
              <div style={{ marginBottom: 8 }}>
                <label style={lbl}>Шаг несущего (b), мм</label>
                <input style={inp} type="number" min={0} step={50}
                  placeholder={String((form.type === 'p113' ? P113_HANGER_STEP : P112_HANGER_STEP)[form.stepC] ?? (form.type === 'p113' ? 950 : 1000))}
                  value={form.stepB ?? ''} onChange={e => setField('stepB', +e.target.value || undefined)} />
              </div>
            )}

            <div style={{ marginBottom: 8 }}>
              <label style={lbl}>Зазор плита→каркас, мм</label>
              <input style={inp} type="number" min={0} step={10}
                value={form.slabGapMm ?? ''} onChange={e => setField('slabGapMm', +e.target.value || undefined)} />
            </div>
            <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.bearingAlongLength ?? true}
                onChange={e => setField('bearingAlongLength', e.target.checked)} />
              {form.type === 'p113'
                ? 'Основной профиль вдоль длины (снять — вдоль ширины)'
                : 'Несущий профиль вдоль длины (снять — вдоль ширины)'}
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
                {getSteps(form.type).map(s => (
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
              <div ref={canvasRef}>
                {!hasRoom ? (
                  seedZones ? (
                    <CeilingContourPreview
                      zones={seedZones}
                      canvasW={canvasW}
                      areaSqm={form.areaSqm}
                      perimeterM={form.perimeterM}
                      startWall={startWall}
                      polygonFrame={result?.polygonFrame ?? null}
                    />
                  ) : (
                    <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: C.muted, flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 32 }}>📐</div>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>Введите размеры помещения</div>
                    </div>
                  )
                ) : (
                  <CeilingCanvas
                    form={form}
                    step={step}
                    canvasW={canvasW}
                    shiftMainMm={shiftMainMm}
                    shiftBearingMm={shiftBearingMm}
                    layout={result?.sheetLayout ?? null}
                  />
                )}
              </div>
            </div>

            {/* Легенда */}
            {hasRoom && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '6px 2px' }}>
                {form.type === 'p113' && <LegItem color={C.pn} label="ПН 28×27 (периметр)" />}
                {step >= 2 && <LegItem color={C.ppMain} label="Осн. ПП 60×27" />}
                {step >= 2 && <LegItem color={C.hanger} label="Подвес" dot />}
                {step >= 3 && <LegItem color={C.ppBearing} label="Несущий ПП 60×27" />}
                {step >= 3 && (form.type === 'p113'
                  ? <LegItem color={C.crab1lvl} label="Соединитель одноур." dot />
                  : <LegItem color={C.crab} label="Краб" dot />)}
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

            {/* Предупреждения расчёта (result.warnings) — раньше считались,
                но нигде не выводились; теперь показываем прямо над спецификацией,
                чтобы не пропустить "по среднему расходу" или "шаг не предусмотрен". */}
            {!!result?.warnings.length && (
              <div style={{
                padding: '8px 10px', background: '#fffbeb', border: `1px solid ${C.warning}`,
                borderRadius: 6, fontSize: 11, color: '#92400e',
              }}>
                {result.warnings.map((w, i) => (
                  <div key={i} style={{ marginTop: i > 0 ? 4 : 0 }}>⚠ {w}</div>
                ))}
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

// ─── Превью обведённого контура (нестандартная форма — без точной раскладки) ──

// Палитра для зон при объединении — циклится, если зон больше, чем цветов.
const ZONE_COLORS = ['#2563eb', '#c9a68a', '#16a34a', '#dc2626', '#9333ea', '#0891b2']

/**
 * Показывает реально обведённую(ые) фигуру(ы) (Плита/Потолок с плана)
 * внутри калькулятора потолка, когда L×W не заданы (нестандартная форма —
 * режим "площадь+периметр"). Раньше здесь была просто заглушка "Введите
 * размеры помещения" даже при переданном контуре — пользователь видел
 * только числа, хотя контур уже был обведён на плане и хотел видеть его
 * глазами здесь же (KONSPEKT.md 10.07.2026, пункт 3). Поддерживает
 * несколько зон одновременно (объединение через "Объединить N → Потолок",
 * там же пункт 4) — каждая зона рисуется своим цветом с подписью, общий
 * итог площади/периметра — под холстом. Точная раскладка профилей для
 * произвольного полигона — отдельная нерешённая задача (пункт 6), это
 * превью её не делает, только показывает форму(ы).
 */
function CeilingContourPreview({ zones, canvasW, areaSqm, perimeterM, startWall, polygonFrame }: {
  zones: CeilingSeedZone[]
  canvasW: number
  areaSqm: number
  perimeterM: number
  startWall?: { zoneIndex: number; sideIndex: number } | null
  polygonFrame?: PolygonP112FrameResult | null
}) {
  const PAD = 32
  const STAGE_H = 300
  const availW = Math.max(canvasW - PAD * 2, 10)
  const availH = STAGE_H - PAD * 2

  const validZones = zones.filter(z => z.outerMm.length >= 3)
  if (validZones.length === 0) return null

  const allPts = validZones.flatMap(z => z.outerMm)
  const xs = allPts.map(p => p.x)
  const ys = allPts.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const w = Math.max(maxX - minX, 1)
  const h = Math.max(maxY - minY, 1)
  const scale = Math.min(availW / w, availH / h)
  const offX = PAD + (availW - w * scale) / 2
  const offY = PAD + (availH - h * scale) / 2

  const toStage = (p: Point2D) => ({ x: offX + (p.x - minX) * scale, y: offY + (p.y - minY) * scale })
  const flat = (pts: Point2D[]) => pts.flatMap(p => { const s = toStage(p); return [s.x, s.y] })
  const centroid = (pts: Point2D[]) => {
    const s = toStage({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length })
    return s
  }

  return (
    <div>
      <Stage width={canvasW} height={STAGE_H}>
        <Layer>
          {validZones.map((zone, zi) => {
            const color = ZONE_COLORS[zi % ZONE_COLORS.length]
            const c = centroid(zone.outerMm)
            return (
              <Group key={zi}>
                <Line points={flat(zone.outerMm)} closed fill={`${color}1a`} stroke={color} strokeWidth={2} />
                {zone.holesMm.map((hole, hi) => (
                  <Line key={hi} points={flat(hole)} closed fill={C.panel} stroke={C.warning} strokeWidth={1.5} dash={[6, 4]} />
                ))}
                {zone.outerMm.map((p, pi) => {
                  const s = toStage(p)
                  return <Rect key={pi} x={s.x - 3} y={s.y - 3} width={6} height={6} fill={color} />
                })}
                {startWall && startWall.zoneIndex === zi && (() => {
                  const side = polygonSides(zone.outerMm)[startWall.sideIndex]
                  if (!side) return null
                  const a = toStage(side.start)
                  const b = toStage(side.end)
                  return (
                    <Group>
                      <Line points={[a.x, a.y, b.x, b.y]} stroke={C.warning} strokeWidth={4} lineCap="round" />
                      <Rect x={a.x - 4} y={a.y - 4} width={8} height={8} fill={C.warning} cornerRadius={1} />
                    </Group>
                  )
                })()}
                {validZones.length > 1 && (
                  <Text x={c.x} y={c.y} text={zone.label} fontSize={11} fill={color}
                    fontStyle="bold" offsetX={zone.label.length * 3} offsetY={5} />
                )}
              </Group>
            )
          })}
          {polygonFrame && (
            <Group>
              {polygonFrame.mainRows.flatMap((row, ri) => row.segments.map(([a, b], si) => {
                const wa = toStage(toWorld({ x: a, y: row.pos }, polygonFrame.frame))
                const wb = toStage(toWorld({ x: b, y: row.pos }, polygonFrame.frame))
                return <Line key={`m-${ri}-${si}`} points={[wa.x, wa.y, wb.x, wb.y]} stroke={C.accent} strokeWidth={1} opacity={0.6} />
              }))}
              {polygonFrame.bearingRows.flatMap((row, ri) => row.segments.map(([a, b], si) => {
                const wa = toStage(toWorld({ x: row.pos, y: a }, polygonFrame.frame))
                const wb = toStage(toWorld({ x: row.pos, y: b }, polygonFrame.frame))
                return <Line key={`b-${ri}-${si}`} points={[wa.x, wa.y, wb.x, wb.y]} stroke={C.text} strokeWidth={1} opacity={0.4} dash={[4, 3]} />
              }))}
            </Group>
          )}
        </Layer>
      </Stage>
      {validZones.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 6 }}>
          {validZones.map((zone, zi) => (
            <div key={zi} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.muted }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: ZONE_COLORS[zi % ZONE_COLORS.length], display: 'inline-block' }} />
              {zone.label} · {zone.areaSqm.toFixed(2)} м²
            </div>
          ))}
        </div>
      )}
      <div style={{ textAlign: 'center', fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.4 }}>
        {validZones.length > 1 ? 'Зоны объединены' : 'Контур обведён на плане'} · {areaSqm.toFixed(2)} м² · {perimeterM.toFixed(2)} пог.м
        {polygonFrame ? (
          <><br />Синим — основной профиль, серым пунктиром — несущий. Смета в списке материалов посчитана точно по этой сетке.</>
        ) : (
          <><br />Нестандартная форма — чтобы увидеть точный чертёж раскладки каркаса, выберите стену начала раскладки слева.</>
        )}
        {startWall && !polygonFrame && <><br />Оранжевым — выбранная стена начала раскладки.</>}
        {polygonFrame && <><br />Оранжевым — стена начала раскладки, от неё считается сетка.</>}
      </div>
    </div>
  )
}

// ─── Выбор стены начала раскладки (пункт 5, UI-заглушка) ────────────────────
//
// Показывает стороны контура выбранной зоны как список кнопок; при
// нескольких зонах — сначала переключатель зоны. Само значение пока
// никак не участвует в расчёте (алгоритм раскладки по полигону —
// пункт 6, ещё не реализован) — только запоминается и подсвечивается
// на CeilingContourPreview, чтобы был задел на будущее.
function StartWallPicker({ zones, value, onChange }: {
  zones: CeilingSeedZone[]
  value: { zoneIndex: number; sideIndex: number } | null
  onChange: (v: { zoneIndex: number; sideIndex: number } | null) => void
}) {
  const validZones = zones
    .map((z, zi) => ({ zone: z, zi }))
    .filter(({ zone }) => zone.outerMm.length >= 3)

  const [activeZi, setActiveZi] = useState(validZones[0]?.zi ?? 0)
  const activeEntry = validZones.find(({ zi }) => zi === activeZi) ?? validZones[0]
  if (!activeEntry) return null
  const sides = polygonSides(activeEntry.zone.outerMm)

  return (
    <div>
      {validZones.length > 1 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {validZones.map(({ zone, zi }) => (
            <button key={zi} onClick={() => setActiveZi(zi)} style={{
              padding: '4px 8px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
              border: `1px solid ${activeZi === zi ? C.accent : C.border}`,
              background: activeZi === zi ? C.accentLight : '#fff',
              color: activeZi === zi ? C.accent : C.text,
            }}>
              {zone.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sides.map(side => {
          const isSelected = value?.zoneIndex === activeZi && value?.sideIndex === side.index
          return (
            <button key={side.index}
              onClick={() => onChange(isSelected ? null : { zoneIndex: activeZi, sideIndex: side.index })}
              style={{
                display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
                borderRadius: 6, fontSize: 12, cursor: 'pointer', textAlign: 'left',
                border: `1.5px solid ${isSelected ? C.warning : C.border}`,
                background: isSelected ? '#fffbeb' : '#fff',
                color: isSelected ? C.warning : C.text,
                fontWeight: isSelected ? 600 : 400,
              }}>
              <span>Сторона {side.index + 1}</span>
              <span>{Math.round(side.lengthMm)} мм</span>
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: C.muted, lineHeight: 1.4 }}>
        {zones.filter(z => z.outerMm.length >= 3).length > 1
          ? 'При объединении нескольких зон точная раскладка каркаса по общему контуру пока не считается (нет физического объединения контуров в один полигон) — выбор стены подсвечивается на превью, но смета остаётся по среднему расходу.'
          : 'Для типа П112 выбор стены запускает точный расчёт сетки каркаса и раскроя листов по контуру — вместо среднего расхода на м². Сетка видна на превью слева.'}
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
  const layoutMode = form.layoutMode ?? 'user'
  // Единая точка правды для stepB/stepA/отступов — та же функция, что
  // использует смета (calcCeiling.ts), чтобы превью не могло разойтись
  // с реальным расчётом материала (см. calcP112Frame.ts).
  const frameParams = resolveFrameParams({
    stepC, layoutMode, userStepB: form.stepB,
    mountDirection: form.mountDirection, loadClass: form.loadClass,
    // 10.07.2026: П112/П113 — своя таблица дефолтного шага b в 'user'-режиме
    // (раньше здесь всегда молча брался П112-вариант, даже для П113).
    ceilingType: form.type === 'p113' ? 'p113' : 'p112',
  })
  const stepB = frameParams.stepB
  const stepA = frameParams.stepA

  // Реальная позиция рядов (см. calcP112Frame.ts): в режиме 'user' первый
  // ряд на расстоянии шага от стены, последний просто ближе к дальней стене
  // — не наивная сетка от 0; в режиме 'knauf' — строго по официальной сетке,
  // без сжатия последнего ряда. shiftMainMm — ручной сдвиг гребёнки поверх.
  const mainPosXMm = calcFrameRowPositions(L, stepC, { mode: layoutMode, wallOffsetMm: frameParams.wallOffsetMainMm })
  const mainPosX = mainPosXMm
    .map(p => (p + shiftMainMm) * scale)
    .filter(x => x >= 0 && x <= L * scale)

  // ── Несущие профили (Y, шаг b) ──
  const bearingPosYMm = calcFrameRowPositions(W_room, stepB, { mode: layoutMode, wallOffsetMm: frameParams.wallOffsetBearingMm })
  const bearingPosY = bearingPosYMm
    .map(p => (p + shiftBearingMm) * scale)
    .filter(y => y >= 0 && y <= W_room * scale)

  // ── Подвесы ──
  // 10.07.2026: подвес обязан висеть строго по оси профиля, на который он
  // физически крепится — в точке пересечения основной/несущий (там же
  // соединитель), а не независимой сеткой от стены.
  // 12.07.2026, ИСПРАВЛЕНИЕ: подвес крепится к ОСНОВНОМУ профилю (вертикальные
  // линии, mainPosX) — ОДИНАКОВО для П112 и П113 (см. calcP112Frame.ts, шапка
  // файла — раньше для П112 здесь ошибочно считалось наоборот, на несущем;
  // для П113 было верно с самого начала). Снэпается вдоль собственного
  // пробега основного (Y) к позициям НЕСУЩЕГО профиля (bearingPosY) — один
  // подвес на каждый (mainPosX × снэпнутый Y). Сдвиг гребёнки применяется к
  // подвесам так же, как и к профилю, на котором они сидят.
  const hangerPosXMm = mainPosXMm
  const hangerPosYMm = snapHangerPositionsToAxis(bearingPosYMm, stepA)
  const hangers: { x: number; y: number }[] = []
  // Рисуем подвесы только если их не слишком много (иначе каша)
  const hangerCount = hangerPosYMm.length * hangerPosXMm.length
  const showHangers = hangerCount <= 200
  if (showHangers) {
    for (const hyMm of hangerPosYMm) {
      const hy = (hyMm + shiftBearingMm) * scale
      if (hy < 0 || hy > W_room * scale) continue
      for (const hxMm of hangerPosXMm) {
        const hx = (hxMm + shiftMainMm) * scale
        if (hx < 0 || hx > L * scale) continue
        hangers.push({ x: hx, y: hy })
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

        {/* ── Шаг 1+: ПН 28×27 по периметру (только П113 — у П112/П212
             периметрального профиля в системе нет, крепление к стене идёт
             через анкерные подвесы, см. KONSPEKT.md 11.07.2026) ── */}
        {form.type === 'p113' && (
          <>
            {/* Верх */}
            <Rect x={0} y={0} width={W} height={PN_W} fill={C.pn} opacity={0.85} />
            {/* Низ */}
            <Rect x={0} y={H - PN_W} width={W} height={PN_W} fill={C.pn} opacity={0.85} />
            {/* Лево */}
            <Rect x={0} y={0} width={PN_W} height={H} fill={C.pn} opacity={0.85} />
            {/* Право */}
            <Rect x={W - PN_W} y={0} width={PN_W} height={H} fill={C.pn} opacity={0.85} />
          </>
        )}

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

        {/* ── Шаг 3+: Несущие ПП 60×27 (горизонтальные) ──
             П112: несущий — сплошной на всю ширину W (как раньше).
             П113 (12.07.2026, роли ОБРАТНЫЕ — см. calcP113Frame.ts): несущий
             тут режется короткими вставками между рядами основного профиля
             (mainPosX), с зазором на месте одноуровневого соединителя — не
             идёт сплошняком, как у П112. Основной профиль (mainPosX, выше)
             при этом сплошной у ОБОИХ типов — рисовка вертикальных линий не
             меняется. */}
        {step >= 3 && form.type === 'p113' && bearingPosY.map((py, i) => {
          const GAP = PP_W * 0.5
          const boundaries = [0, ...mainPosX, W]
          const segs: { xa: number; xb: number }[] = []
          for (let b = 0; b < boundaries.length - 1; b++) {
            let xa = boundaries[b]
            let xb = boundaries[b + 1]
            if (b > 0) xa += GAP
            if (b < boundaries.length - 2) xb -= GAP
            if (xb > xa) segs.push({ xa, xb })
          }
          return (
            <Group key={`bp${i}`}>
              {segs.map((s, si) => (
                <Rect key={`bpseg${i}_${si}`} x={s.xa} y={py - PP_W / 2} width={s.xb - s.xa} height={PP_W}
                  fill={C.ppBearing} opacity={0.75} cornerRadius={1} />
              ))}
            </Group>
          )
        })}
        {step >= 3 && form.type !== 'p113' && bearingPosY.map((py, i) => (
          <Group key={`bp${i}`}>
            <Rect x={0} y={py - PP_W / 2} width={W} height={PP_W / 4}
              fill={C.ppBearing} opacity={0.9} />
            <Rect x={0} y={py - PP_W / 4} width={W} height={PP_W / 2}
              fill="#90a4ae" opacity={0.6} />
            <Rect x={0} y={py + PP_W / 4} width={W} height={PP_W / 4}
              fill={C.ppBearing} opacity={0.9} />
          </Group>
        ))}

        {/* ── Шаг 3+: Соединители на пересечениях — двухуровневый краб (П112)
             или одноуровневый (П113, другой цвет, т.к. физически другая
             деталь, см. calcP113Frame.ts) ── */}
        {step >= 3 && mainPosX.map((px, mi) =>
          bearingPosY.map((py, bi) => (
            <Group key={`cr${mi}_${bi}`} x={px} y={py}>
              <Rect x={-4} y={-4} width={8} height={8}
                fill={form.type === 'p113' ? C.crab1lvl : C.crab} opacity={0.9} cornerRadius={1} />
              <Line points={[-6, 0, 6, 0]} stroke={form.type === 'p113' ? C.crab1lvl : C.crab} strokeWidth={1} />
              <Line points={[0, -6, 0, 6]} stroke={form.type === 'p113' ? C.crab1lvl : C.crab} strokeWidth={1} />
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
