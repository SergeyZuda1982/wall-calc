/**
 * Scene3D.tsx — 3D-вид объекта (see KONSPEKT.md, "3D-сцена").
 *
 * v1: статичный снимок геометрии плана, БЕЗ анимации по статусам работ
 * (это отдельная задача — статусы уже есть в данных, но 3D пока не
 * фильтрует и не анимирует по ним, просто показывает всё как есть).
 *
 * С 05.07.2026 — показывает ВСЕ этажи проекта разом, каждый сдвинут по
 * вертикали на свою Level.elevationMm (см. LevelGroup ниже). До этого
 * показывался только активный этаж, а elevationMm вообще нигде не
 * использовалась в 3D — историческая деталь, если попадётся в старых
 * заметках выше по файлу/в KONSPEKT.md.
 *
 * Вся числовая геометрия (метры, повороты, полигоны) уже посчитана и
 * протестирована в core/planTo3D.ts — здесь только сборка three.js-мешей
 * и цвета.
 */

import { useMemo, useState, useRef, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, FlyControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useProjectStore } from './store/useProjectStore'
import {
  wallsToBoxes3D, roomsToPolygons3D, slabsToPolygons3D, roundColumnsToCylinders3D, rectColumnsToBoxes3D, estimateCeilingMm, mmToM,
  freeformStructuresToPrisms3D,
  FLOOR_SLAB_THICKNESS_MM, CEILING_SLAB_THICKNESS_MM,
  type WallBox3D, type RoomPolygon3D, type SlabPolygon3D, type ColumnCylinder3D, type RectColumnBox3D, type FreeformPrism3D,
} from './core/planTo3D'
import type { PlanLineType, FloorPlan } from './types'
import CeilingGridMesh from './components/CeilingGridMesh'

const TYPE_COLOR_3D: Record<PlanLineType, string> = {
  wall_new:      '#e57373',
  wall_lining:   '#64b5f6',
  wall_existing: '#b0bec5',
  ceiling:       '#ce93d8',
  floor:         '#a1887f',
  rib_beam:      '#546e7a',
}

const FLOOR_COLOR = '#c9c2b4'
const CEILING_COLOR = '#e8e8ec'
const COLUMN_COLOR = '#9aa5ad'

function WallMesh({ box, opacity = 1 }: { box: WallBox3D; opacity?: number }) {
  const color = TYPE_COLOR_3D[box.planLineType]
  return (
    <mesh position={[box.center.x, box.center.y, box.center.z]} rotation={[0, box.rotationY, 0]} castShadow receiveShadow>
      <boxGeometry args={[box.size.sx, box.size.sy, box.size.sz]} />
      <meshStandardMaterial color={color} roughness={0.9} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

/**
 * Полигон помещения → плоская плита (пол/потолок) или полный объём (колонна).
 * Геометрия строится через THREE.Shape + ExtrudeGeometry — вручную (не в
 * core/planTo3D.ts, т.к. это уже собственно three.js, не переносимая чистая
 * математика). Shape строится как (x, -z), затем rotateX(-90°) кладёт её
 * плашмя так, что итоговые мировые X/Z совпадают с планом без зеркалирования.
 */
function SlabOrColumn({ room, ceilingMm, skipFloor, opacity = 1 }: { room: RoomPolygon3D; ceilingMm: number; skipFloor: boolean; opacity?: number }) {
  const ceilingM = mmToM(ceilingMm)
  const transparent = opacity < 1

  const floorGeo = useMemo(() => {
    if (room.points.length < 3) return null
    const shape = new THREE.Shape(room.points.map(p => new THREE.Vector2(p.x, -p.z)))
    const depth = mmToM(FLOOR_SLAB_THICKNESS_MM)
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, -depth, 0)
    return geo
  }, [room.points])

  const ceilingGeo = useMemo(() => {
    if (room.points.length < 3) return null
    const shape = new THREE.Shape(room.points.map(p => new THREE.Vector2(p.x, -p.z)))
    const depth = mmToM(CEILING_SLAB_THICKNESS_MM)
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, ceilingM, 0)
    return geo
  }, [room.points, ceilingM])

  const columnGeo = useMemo(() => {
    if (!room.isColumn || room.points.length < 3) return null
    const shape = new THREE.Shape(room.points.map(p => new THREE.Vector2(p.x, -p.z)))
    const geo = new THREE.ExtrudeGeometry(shape, { depth: ceilingM, bevelEnabled: false, steps: 1 })
    geo.rotateX(-Math.PI / 2)
    return geo
  }, [room.points, room.isColumn, ceilingM])

  if (room.isColumn) {
    if (!columnGeo) return null
    return (
      <mesh geometry={columnGeo} castShadow receiveShadow>
        <meshStandardMaterial color={COLUMN_COLOR} roughness={0.9} transparent={transparent} opacity={opacity} />
      </mesh>
    )
  }

  return (
    <>
      {floorGeo && !skipFloor && (
        <mesh geometry={floorGeo} receiveShadow>
          <meshStandardMaterial color={FLOOR_COLOR} roughness={0.9} transparent={transparent} opacity={opacity} />
        </mesh>
      )}
      {ceilingGeo && (
        <mesh geometry={ceilingGeo} receiveShadow>
          <meshStandardMaterial color={CEILING_COLOR} roughness={0.9} transparent={transparent} opacity={opacity} />
        </mesh>
      )}
    </>
  )
}

/**
 * Плита, нарисованная "карандашом" — контур с вырезами (лестницы/шахты).
 * Рисуется как пол СВОЕГО этажа (y=0 относительно сдвига LevelGroup).
 * Отдельного зеркального потолка у неё нет и не нужно — если пользователь
 * нарисовал такую же плиту на этаже выше (с elevationMm побольше), её
 * низ и станет визуальным "потолком" этого этажа само собой, раз обе
 * сцены теперь показываются вместе (см. LevelGroup/Scene3D).
 */
function HandDrawnSlabMesh({ slab, opacity = 1 }: { slab: SlabPolygon3D; opacity?: number }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape(slab.outer.map(p => new THREE.Vector2(p.x, -p.z)))
    for (const hole of slab.holes) {
      shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x, -p.z))))
    }
    const depth = mmToM(FLOOR_SLAB_THICKNESS_MM)
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
    g.rotateX(-Math.PI / 2)
    g.translate(0, -depth, 0)
    return g
  }, [slab])

  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial color={FLOOR_COLOR} roughness={0.9} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

/**
 * Круглая колонна → цилиндр three.js. CylinderGeometry по умолчанию стоит
 * вдоль оси Y (высота) — ровно то, что нужно (вертикальная колонна от пола
 * до потолка), поворот не требуется в отличие от коробки-стены.
 */
function RoundColumnMesh({ cyl, opacity = 1 }: { cyl: ColumnCylinder3D; opacity?: number }) {
  return (
    <mesh position={[cyl.cx, cyl.heightM / 2, cyl.cz]} castShadow receiveShadow>
      <cylinderGeometry args={[cyl.radius, cyl.radius, cyl.heightM, 24]} />
      <meshStandardMaterial color={COLUMN_COLOR} roughness={0.9} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

/**
 * Прямоугольная колонна (самостоятельная сущность) → коробка three.js.
 * Тот же принцип, что и WallMesh (боковая коробка стены) — но свой
 * фиксированный цвет COLUMN_COLOR, как и у круглой колонны, а не цвет
 * из TYPE_COLOR_3D (колонна не привязана к PlanLineType).
 */
function RectColumnMesh({ box, opacity = 1 }: { box: RectColumnBox3D; opacity?: number }) {
  return (
    <mesh position={[box.center.x, box.center.y, box.center.z]} rotation={[0, box.rotationY, 0]} castShadow receiveShadow>
      <boxGeometry args={[box.size.sx, box.size.sy, box.size.sz]} />
      <meshStandardMaterial color={COLUMN_COLOR} roughness={0.9} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

/**
 * Обведённая карандашом стена/перегородка или колонна произвольной формы
 * (FreeformStructure, см. types/index.ts) → призма three.js. Та же техника
 * extrude, что и у колонны-Room (SlabOrColumn/columnGeo) — контур просто
 * тянется вверх на heightM, начиная от bottomM (0, если сегмент стоит на
 * полу). kind влияет только на цвет (стена — тот же TYPE_COLOR_3D, что у
 * обычных wall_existing коробов; колонна — COLUMN_COLOR, как у остальных
 * колонн) — геометрически оба вида не различаются.
 *
 * Проёмы (07.07.2026) — holes прорезаны в THREE.Shape тем же приёмом, что
 * и у плиты (HandDrawnSlabMesh выше): один FreeformStructure может дать
 * НЕСКОЛЬКО таких мешей (по band на разную высоту — planTo3D режет по
 * границам проёмов), каждый со своим набором активных дырок.
 */
function FreeformStructureMesh({ prism, opacity = 1 }: { prism: FreeformPrism3D; opacity?: number }) {
  const geo = useMemo(() => {
    if (prism.points.length < 3) return null
    const shape = new THREE.Shape(prism.points.map(p => new THREE.Vector2(p.x, -p.z)))
    for (const hole of prism.holes) {
      shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x, -p.z))))
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: prism.heightM, bevelEnabled: false, steps: 1 })
    geo.rotateX(-Math.PI / 2)
    if (prism.bottomM) geo.translate(0, prism.bottomM, 0)
    return geo
  }, [prism.points, prism.heightM, prism.bottomM, prism.holes])
  if (!geo) return null
  const color = prism.kind === 'column' ? COLUMN_COLOR : TYPE_COLOR_3D.wall_existing
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.9} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

/** Цель фокусировки камеры по клику на табличку помещения (см. RoomLabelTag/CameraRig) */
interface FocusTarget {
  nonce: number
  target: THREE.Vector3
  distance: number
}

/**
 * Табличка-номер помещения в 3D (09.07.2026) — висит примерно на уровне
 * чуть выше стен, в центре (среднем точек контура, тот же принцип, что и
 * подпись в 2D — см. FloorPlan.tsx, рендер rooms). Html из drei — обычный
 * DOM-элемент, привязанный к 3D-точке (billboard, всегда развёрнут на
 * камеру), поэтому клик обрабатывается как обычный onClick, без ray-casting
 * вручную. distanceFactor уменьшает табличку при отдалении камеры, чтобы
 * она не забивала вид на дальних планах.
 */
function RoomLabelTag({
  x, y, z, label, onFocus,
}: { x: number; y: number; z: number; label: string; onFocus: () => void }) {
  return (
    <Html position={[x, y, z]} center distanceFactor={10} zIndexRange={[10, 0]} occlude={false}>
      <div
        onClick={(e) => { e.stopPropagation(); onFocus() }}
        style={{
          padding: '3px 10px', borderRadius: 12, whiteSpace: 'nowrap',
          background: 'rgba(255,255,255,0.92)', border: '1px solid #3a7bd5',
          color: '#1a1f33', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)', userSelect: 'none',
        }}
        title="Нажмите, чтобы навести камеру на помещение"
      >
        {label}
      </div>
    </Html>
  )
}

/**
 * Плавно ведёт камеру/цель OrbitControls к focusTarget при клике на
 * табличку помещения (см. RoomLabelTag). Направление обзора сохраняется —
 * камера едет к помещению с той же стороны, откуда смотрела до клика, а не
 * дёргается в фиксированный ракурс. lerp с коэффициентом 0.12 за кадр даёт
 * плавный, но быстрый (~15-20 кадров) переход, без отдельной библиотеки
 * анимации.
 */
function CameraRig({ focusTarget, controlsRef }: {
  focusTarget: FocusTarget | null
  controlsRef: React.RefObject<any>
}) {
  const { camera } = useThree()
  const desiredTarget = useRef(new THREE.Vector3())
  const desiredPos = useRef(new THREE.Vector3())
  const lastNonce = useRef(0)

  useEffect(() => {
    if (!focusTarget || focusTarget.nonce === lastNonce.current) return
    lastNonce.current = focusTarget.nonce
    const currentTarget = controlsRef.current?.target ?? new THREE.Vector3()
    const dir = camera.position.clone().sub(currentTarget)
    if (dir.lengthSq() < 0.0001) dir.set(1, 1, 1)
    dir.normalize()
    desiredTarget.current.copy(focusTarget.target)
    desiredPos.current.copy(focusTarget.target).addScaledVector(dir, focusTarget.distance)
  }, [focusTarget, camera])

  useFrame(() => {
    if (!focusTarget || !controlsRef.current) return
    controlsRef.current.target.lerp(desiredTarget.current, 0.12)
    camera.position.lerp(desiredPos.current, 0.12)
    controlsRef.current.update()
  })
  return null
}

/**
 * Геометрия ОДНОГО этажа — то, что раньше было прямо в теле Scene3D.
 * Обёрнута в <group position={[0, offsetY, 0]}> — offsetY = отметка этажа
 * (Level.elevationMm) в метрах, так все этажи проекта встают друг над
 * другом на своих реальных высотах в одной сцене. Неактивный этаж (не тот,
 * что выбран в шапке плана) рисуется полупрозрачным — чтобы было видно
 * объект целиком, но сразу понятно, какой этаж сейчас редактируется.
 */
function LevelGroup({ floorPlan, offsetY, dimmed, showCeilingGrid, onFocusRoom }: {
  floorPlan: FloorPlan; offsetY: number; dimmed: boolean; showCeilingGrid: boolean
  onFocusRoom: (worldTarget: THREE.Vector3, distance: number) => void
}) {
  const lines = floorPlan.lines ?? []
  const rooms = floorPlan.rooms ?? []
  const slabs = floorPlan.slabs ?? []
  const roundColumns = floorPlan.roundColumns ?? []
  const rectColumns = floorPlan.rectColumns ?? []
  const freeformStructures = floorPlan.freeformStructures ?? []
  const scaleMmPx = floorPlan.scaleMmPerPx ?? 10
  const opacity = dimmed ? 0.35 : 1

  const boxes = useMemo(() => wallsToBoxes3D(lines, scaleMmPx, rectColumns), [lines, scaleMmPx, rectColumns])
  const polygons = useMemo(() => roomsToPolygons3D(rooms, lines, scaleMmPx), [rooms, lines, scaleMmPx])
  const slabPolygons = useMemo(() => slabsToPolygons3D(slabs, scaleMmPx), [slabs, scaleMmPx])
  const ceilingMm = useMemo(() => estimateCeilingMm(lines), [lines])
  const columnCylinders = useMemo(
    () => roundColumnsToCylinders3D(roundColumns, scaleMmPx, ceilingMm),
    [roundColumns, scaleMmPx, ceilingMm],
  )
  const rectColumnBoxes = useMemo(
    () => rectColumnsToBoxes3D(rectColumns, scaleMmPx, ceilingMm),
    [rectColumns, scaleMmPx, ceilingMm],
  )
  const freeformPrisms = useMemo(
    () => freeformStructuresToPrisms3D(freeformStructures, scaleMmPx, ceilingMm),
    [freeformStructures, scaleMmPx, ceilingMm],
  )
  const hasHandDrawnSlabs = slabPolygons.length > 0

  // Таблички-номера помещений (09.07.2026) — центр как среднее точек контура
  // (тот же приём, что и подпись в 2D, см. FloorPlan.tsx, рендер rooms; не
  // геометрический центроид многоугольника, но для этой цели — визуальной
  // метки — разница несущественна и поведение остаётся предсказуемо
  // одинаковым между 2D и 3D). sizeM — грубый диаметр помещения, определяет,
  // на какое расстояние отъезжает камера при фокусировке (просторная комната
  // требует более дальнего кадра, чем кладовка).
  const roomLabels = useMemo(() => {
    return polygons
      .filter(p => !p.isColumn && p.points.length >= 3)
      .map(p => {
        const cx = p.points.reduce((s, pt) => s + pt.x, 0) / p.points.length
        const cz = p.points.reduce((s, pt) => s + pt.z, 0) / p.points.length
        const minX = Math.min(...p.points.map(pt => pt.x)), maxX = Math.max(...p.points.map(pt => pt.x))
        const minZ = Math.min(...p.points.map(pt => pt.z)), maxZ = Math.max(...p.points.map(pt => pt.z))
        const sizeM = Math.max(maxX - minX, maxZ - minZ, 2)
        return { id: p.id, label: p.label, cx, cz, sizeM }
      })
  }, [polygons])

  return (
    <group position={[0, offsetY, 0]}>
      {boxes.map(box => <WallMesh key={box.id} box={box} opacity={opacity} />)}
      {polygons.map(room => <SlabOrColumn key={room.id} room={room} ceilingMm={ceilingMm} skipFloor={hasHandDrawnSlabs} opacity={opacity} />)}
      {showCeilingGrid && !dimmed && polygons.filter(r => !r.isColumn).map(room => (
        <CeilingGridMesh key={`grid-${room.id}`} roomPoints={room.points} ceilingM={mmToM(ceilingMm)} />
      ))}
      {slabPolygons.map(slab => <HandDrawnSlabMesh key={slab.id} slab={slab} opacity={opacity} />)}
      {columnCylinders.map(cyl => <RoundColumnMesh key={cyl.id} cyl={cyl} opacity={opacity} />)}
      {rectColumnBoxes.map(box => <RectColumnMesh key={box.id} box={box} opacity={opacity} />)}
      {freeformPrisms.map(prism => <FreeformStructureMesh key={prism.id} prism={prism} opacity={opacity} />)}
      {!dimmed && roomLabels.map(rl => (
        <RoomLabelTag
          key={rl.id}
          x={rl.cx} y={mmToM(ceilingMm) + 0.4} z={rl.cz}
          label={rl.label}
          onFocus={() => onFocusRoom(
            new THREE.Vector3(rl.cx, offsetY + mmToM(ceilingMm) / 2, rl.cz),
            Math.max(rl.sizeM * 1.4, 4),
          )}
        />
      ))}
    </group>
  )
}

/** Есть ли вообще что рисовать на этаже (та же проверка, что раньше была одна на весь Scene3D) */
function levelHasGeometry(floorPlan: FloorPlan): boolean {
  const lines = floorPlan.lines ?? []
  const scaleMmPx = floorPlan.scaleMmPerPx ?? 10
  const ceilingMm = estimateCeilingMm(lines)
  return (
    wallsToBoxes3D(lines, scaleMmPx, floorPlan.rectColumns ?? []).length > 0 ||
    roomsToPolygons3D(floorPlan.rooms ?? [], lines, scaleMmPx).length > 0 ||
    slabsToPolygons3D(floorPlan.slabs ?? [], scaleMmPx).length > 0 ||
    roundColumnsToCylinders3D(floorPlan.roundColumns ?? [], scaleMmPx, ceilingMm).length > 0 ||
    rectColumnsToBoxes3D(floorPlan.rectColumns ?? [], scaleMmPx, ceilingMm).length > 0 ||
    freeformStructuresToPrisms3D(floorPlan.freeformStructures ?? [], scaleMmPx, ceilingMm).length > 0
  )
}

export default function Scene3D() {
  const [cameraMode, setCameraMode] = useState<'orbit' | 'fly'>('orbit')
  const [showCeilingGrid, setShowCeilingGrid] = useState(false)
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)
  const focusNonce = useRef(0)
  const controlsRef = useRef<any>(null)
  const levels = useProjectStore(s => s.levels)
  const activeLevelId = useProjectStore(s => s.activeLevelId)

  // Клик по табличке помещения (см. RoomLabelTag) должен работать и в режиме
  // полёта (FlyControls не имеет "target" — сперва переключаемся на orbit,
  // затем едем к помещению; см. CameraRig).
  function focusOnRoom(target: THREE.Vector3, distance: number) {
    setCameraMode('orbit')
    focusNonce.current += 1
    setFocusTarget({ nonce: focusNonce.current, target, distance })
  }

  const isEmpty = useMemo(() => levels.every(lv => !levelHasGeometry(lv.floorPlan)), [levels])

  if (isEmpty) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#888', fontSize: 14, textAlign: 'center', padding: 24,
      }}>
        На плане пока нет конструкций со спецификацией (стены/ригели с заданным
        материалом или сечением) — нечего показывать в 3D. Нарисуйте план на
        вкладке «План» и вернитесь сюда.
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', background: '#eef1f6', position: 'relative' }}>
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start',
      }}>
        <button
          onClick={() => setCameraMode(m => m === 'orbit' ? 'fly' : 'orbit')}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: '1px solid #3a7bd5', borderRadius: 6,
            background: cameraMode === 'fly' ? '#3a7bd5' : '#fff',
            color: cameraMode === 'fly' ? '#fff' : '#3a7bd5',
          }}>
          {cameraMode === 'fly' ? '✈ Режим полёта (вкл)' : '🖱 Мышь (вкл) — включить полёт'}
        </button>
        <button
          onClick={() => setShowCeilingGrid(v => !v)}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: '1px solid #7e57c2', borderRadius: 6,
            background: showCeilingGrid ? '#7e57c2' : '#fff',
            color: showCeilingGrid ? '#fff' : '#7e57c2',
          }}>
          {showCeilingGrid ? '▦ Каркас потолка (вкл)' : '▦ Показать каркас потолка'}
        </button>
        {showCeilingGrid && (
          <div style={{
            padding: '6px 10px', fontSize: 12, color: '#444', background: '#f3edff',
            border: '1px solid #d4c4f5', borderRadius: 6, maxWidth: 220, lineHeight: 1.4,
          }}>
            Показан по умолчанию (шаг 600×600, П113) — пока не связан с
            параметрами конкретного помещения из «Потолок» (CeilingCalc.tsx).
          </div>
        )}
        {cameraMode === 'fly' && (
          <div style={{
            padding: '6px 10px', fontSize: 12, color: '#444', background: '#fffbe6',
            border: '1px solid #e6d68a', borderRadius: 6, maxWidth: 220, lineHeight: 1.4,
          }}>
            W/S — вперёд/назад, A/D — влево/вправо, R/F — вверх/вниз.
            Зажать мышь и потянуть — посмотреть по сторонам.
          </div>
        )}
        {levels.length > 1 && (
          <div style={{
            padding: '6px 10px', fontSize: 12, color: '#444', background: '#fff',
            border: '1px solid #dde', borderRadius: 6, maxWidth: 220, lineHeight: 1.4,
          }}>
            Показаны все этажи ({levels.length}) на своих отметках. Текущий —
            непрозрачный, остальные — полупрозрачные для ориентира.
          </div>
        )}
      </div>
      <Canvas shadows camera={{ position: [10, 10, 10], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 12, 6]} intensity={1} castShadow />
        <Grid args={[100, 100]} cellColor="#c9ccd6" sectionColor="#9aa0b0" fadeDistance={40} position={[0, -0.001, 0]} />
        {levels.map(lv => (
          <LevelGroup
            key={lv.id}
            floorPlan={lv.floorPlan}
            offsetY={mmToM(lv.elevationMm)}
            dimmed={lv.id !== activeLevelId}
            showCeilingGrid={showCeilingGrid}
            onFocusRoom={focusOnRoom}
          />
        ))}
        {cameraMode === 'orbit'
          ? <OrbitControls ref={controlsRef} makeDefault />
          : <FlyControls makeDefault dragToLook movementSpeed={4} rollSpeed={0.6} />}
        {cameraMode === 'orbit' && <CameraRig focusTarget={focusTarget} controlsRef={controlsRef} />}
      </Canvas>
    </div>
  )
}
