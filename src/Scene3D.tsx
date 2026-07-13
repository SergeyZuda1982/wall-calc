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
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Grid, FlyControls, Html, Line, Sphere } from '@react-three/drei'
import * as THREE from 'three'
import { useProjectStore, type SelectedEntity } from './store/useProjectStore'
import {
  wallsToBoxes3D, roomsToPolygons3D, slabsToPolygons3D, ceilingsToPolygons3D, roundColumnsToCylinders3D, rectColumnsToBoxes3D, estimateCeilingMm, mmToM,
  freeformStructuresToPrisms3D, wallStudPositionsMm,
  FLOOR_SLAB_THICKNESS_MM, CEILING_SLAB_THICKNESS_MM,
  type WallBox3D, type RoomPolygon3D, type SlabPolygon3D, type ColumnCylinder3D, type RectColumnBox3D, type FreeformPrism3D,
} from './core/planTo3D'
import type { PlanLineType, FloorPlan, PlanLine } from './types'
import CeilingGridMesh from './components/CeilingGridMesh'
import CeilingEntityMesh from './components/CeilingEntityMesh'
import { resolveFrameParams } from './core/calcP112Frame'
import { formatDistanceM } from './core/formatDistance'
import { lineProgressColor, lineProgressSummary, wallGklVisual3D } from './core/lineProgress'
import { finishSidesOf } from './core/finishResolver'
import { getWallTexture, tintOverTexture } from './textures3D'

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
const CONCRETE_DEFAULT_TILE_M = 2

// ─── Каркас/обшивка ГКЛ-стены (Этап 2 "реалистичные материалы", 10-11.07.2026) ─
const FRAME_PROFILE_W_M = 0.05     // ширина полки профиля (схематично, ПС50/75/100 визуально не отличаем)
const FRAME_TRACK_H_M = 0.05       // высота направляющей (верх/низ)
const FRAME_PROFILE_COLOR = '#8a9199'
const GKL_SHEET_THICKNESS_M = 0.0125 // стандартный лист 12.5мм
const GKL_SHEET_COLOR = '#d9d4c5'

/**
 * Стена в 3D — коробка three.js. Клик по стене (10.07.2026, выбор стены в
 * 3D) поднимает `box.lineId` наверх через `onSelect` — ОДИНАКОВЫЙ у всех
 * сегментов одной линии (целая стена/подоконник/перемычка/хвост вокруг
 * проёма, см. lineId в core/planTo3D.ts), поэтому клик по любому кусочку
 * стены выделяет её ЦЕЛИКОМ, а не один сегмент.
 *
 * Пока активен инструмент измерения (`measuring`) — клик НЕ перехватывается
 * здесь (не вызывается stopPropagation), чтобы он всплыл до обработчика
 * измерения на внешней группе (см. handleMeasureClick в Scene3D) — это два
 * независимых режима клика по стене, activен только один одновременно.
 *
 * Подсветка выбранной стены — emissive-свечение поверх обычного цвета типа
 * линии (TYPE_COLOR_3D), не замена цвета: так остаётся видно, что это была
 * за стена (новая/облицовка/существующая), и что она ещё и выбрана.
 */
function WallMesh({ box, line, opacity = 1, selected = false, measuring = false, onSelect }: {
  box: WallBox3D
  /** Линия плана, которой принадлежит box (по box.lineId) — нужна для каркаса
   *  ГКЛ (wallGklVisual3D/wallStudPositionsMm). Может быть undefined только
   *  в теории (защита от рассинхрона lines/boxes) — тогда просто нет каркаса. */
  line?: PlanLine
  opacity?: number
  selected?: boolean
  measuring?: boolean
  onSelect?: (lineId: string) => void
}) {
  const color = TYPE_COLOR_3D[box.planLineType]
  // Текстура материала (бетон/кирпич/блок) — только если материал задан
  // (spec.material); для 'unknown' остаётся прежний плоский цвет типа линии.
  // См. textures3D.ts — repeat считается из реальных sx/sy стены.
  const texture = useMemo(
    () => getWallTexture(box.materialKind, box.size.sx, box.size.sy),
    [box.materialKind, box.size.sx, box.size.sy],
  )
  const tint = useMemo(() => tintOverTexture(color), [color])

  // ГКЛ-каркас (Этап 2, 10-11.07.2026): применимо только для линий
  // finishMaterialCategoryOf==='gkl' с ЯВНО настроенным buildProgress —
  // иначе (кладка/бетон/legacy) обычный вид Этапа 1 ниже.
  // Короткие вставки у проёма (подоконник/перемычка, id содержит __sill_/
  // __lintel_) намеренно ВСЕГДА остаются сплошными — россыпь стоек на
  // 100-900мм высоты нечитаема и не даёт визуальной ценности (см.
  // обсуждение с пользователем).
  const gklVisual = useMemo(() => (line ? wallGklVisual3D(line) : null), [line])
  const isPartialHeightSegment = box.id.includes('__sill_') || box.id.includes('__lintel_')
  const showFrame = !!gklVisual && gklVisual.mode === 'frame' && !isPartialHeightSegment
  const sides = line ? finishSidesOf(line) : 2

  const studLocalXs = useMemo(() => {
    if (!showFrame || !line) return []
    const allMm = wallStudPositionsMm(line)
    const fromMm = box.alongFromM * 1000, toMm = box.alongToM * 1000
    return allMm
      .filter(p => p > fromMm + 1 && p < toMm - 1) // строго внутри сегмента, края уже заняты торцевыми стойками
      .map(p => (p - fromMm) / 1000 - box.size.sx / 2)
  }, [showFrame, line, box.alongFromM, box.alongToM, box.size.sx])

  function handleClick(e: ThreeEvent<MouseEvent>) {
    if (measuring || !onSelect) return
    e.stopPropagation()
    onSelect(box.lineId)
  }

  const emissive = selected ? '#ffca28' : '#000000'
  const emissiveIntensity = selected ? 0.55 : 0
  const transparent = opacity < 1

  return (
    <group
      position={[box.center.x, box.center.y, box.center.z]}
      rotation={[0, box.rotationY, 0]}
      onClick={handleClick}
    >
      {!showFrame && (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[box.size.sx, box.size.sy, box.size.sz]} />
          <meshStandardMaterial
            map={texture}
            color={texture ? tint : color}
            roughness={0.9}
            transparent={transparent}
            opacity={opacity}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
          />
        </mesh>
      )}
      {showFrame && (
        <>
          {/* верхняя/нижняя направляющая */}
          {[1, -1].map(sign => (
            <mesh key={`track-${sign}`} position={[0, sign * (box.size.sy / 2 - FRAME_TRACK_H_M / 2), 0]} castShadow receiveShadow>
              <boxGeometry args={[box.size.sx, FRAME_TRACK_H_M, box.size.sz * 0.9]} />
              <meshStandardMaterial color={FRAME_PROFILE_COLOR} roughness={0.4} metalness={0.5} emissive={emissive} emissiveIntensity={emissiveIntensity} transparent={transparent} opacity={opacity} />
            </mesh>
          ))}
          {/* торцевые + рядовые стойки (торцевые — на реальной границе сегмента, всегда) */}
          {[-(box.size.sx / 2 - FRAME_PROFILE_W_M / 2), ...studLocalXs, box.size.sx / 2 - FRAME_PROFILE_W_M / 2].map((x, i) => (
            <mesh key={`stud-${i}`} position={[x, 0, 0]} castShadow receiveShadow>
              <boxGeometry args={[FRAME_PROFILE_W_M, box.size.sy - 2 * FRAME_TRACK_H_M, box.size.sz * 0.9]} />
              <meshStandardMaterial color={FRAME_PROFILE_COLOR} roughness={0.4} metalness={0.5} emissive={emissive} emissiveIntensity={emissiveIntensity} transparent={transparent} opacity={opacity} />
            </mesh>
          ))}
          {/* обшивка стороны А/Б — тонкий лист поверх каркаса, только если подтверждена */}
          {gklVisual!.sheetA && (
            <mesh position={[0, 0, box.size.sz / 2 - GKL_SHEET_THICKNESS_M / 2]} castShadow receiveShadow>
              <boxGeometry args={[box.size.sx, box.size.sy, GKL_SHEET_THICKNESS_M]} />
              <meshStandardMaterial color={GKL_SHEET_COLOR} roughness={0.85} emissive={emissive} emissiveIntensity={emissiveIntensity} transparent={transparent} opacity={opacity} />
            </mesh>
          )}
          {gklVisual!.sheetB && sides === 2 && (
            <mesh position={[0, 0, -(box.size.sz / 2 - GKL_SHEET_THICKNESS_M / 2)]} castShadow receiveShadow>
              <boxGeometry args={[box.size.sx, box.size.sy, GKL_SHEET_THICKNESS_M]} />
              <meshStandardMaterial color={GKL_SHEET_COLOR} roughness={0.85} emissive={emissive} emissiveIntensity={emissiveIntensity} transparent={transparent} opacity={opacity} />
            </mesh>
          )}
        </>
      )}
    </group>
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

  // Плиты/колонны-помещения в этом проекте всегда бетон/монолит по смыслу
  // (нет отдельного spec.material, как у стены) — текстура берётся всегда,
  // repeat считается по bounding box контура (см. textures3D.ts, для бетона
  // это просто масштаб шума, не модуль кладки — точность тут не критична).
  const bbox = useMemo(() => {
    if (room.points.length === 0) return { w: CONCRETE_DEFAULT_TILE_M, d: CONCRETE_DEFAULT_TILE_M }
    const xs = room.points.map(p => p.x), zs = room.points.map(p => p.z)
    return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }
  }, [room.points])
  const floorTex = useMemo(() => getWallTexture('concrete', bbox.w, bbox.d), [bbox.w, bbox.d])
  const columnTex = useMemo(() => getWallTexture('concrete', bbox.w, ceilingM), [bbox.w, ceilingM])
  const floorTint = useMemo(() => tintOverTexture(FLOOR_COLOR), [])
  const ceilingTint = useMemo(() => tintOverTexture(CEILING_COLOR), [])
  const columnTint = useMemo(() => tintOverTexture(COLUMN_COLOR), [])

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
        <meshStandardMaterial map={columnTex} color={columnTint} roughness={0.9} transparent={transparent} opacity={opacity} />
      </mesh>
    )
  }

  return (
    <>
      {floorGeo && !skipFloor && (
        <mesh geometry={floorGeo} receiveShadow>
          <meshStandardMaterial map={floorTex} color={floorTint} roughness={0.9} transparent={transparent} opacity={opacity} />
        </mesh>
      )}
      {ceilingGeo && (
        <mesh geometry={ceilingGeo} receiveShadow>
          <meshStandardMaterial map={floorTex} color={ceilingTint} roughness={0.9} transparent={transparent} opacity={opacity} />
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
  const bbox = useMemo(() => {
    if (slab.outer.length === 0) return { w: CONCRETE_DEFAULT_TILE_M, d: CONCRETE_DEFAULT_TILE_M }
    const xs = slab.outer.map(p => p.x), zs = slab.outer.map(p => p.z)
    return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }
  }, [slab.outer])
  const tex = useMemo(() => getWallTexture('concrete', bbox.w, bbox.d), [bbox.w, bbox.d])
  const tint = useMemo(() => tintOverTexture(FLOOR_COLOR), [])
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
      <meshStandardMaterial map={tex} color={tint} roughness={0.9} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

/**
 * Круглая колонна → цилиндр three.js. CylinderGeometry по умолчанию стоит
 * вдоль оси Y (высота) — ровно то, что нужно (вертикальная колонна от пола
 * до потолка), поворот не требуется в отличие от коробки-стены.
 *
 * Клик/подсветка/выделение (10.07.2026) — тот же принцип, что и у WallMesh
 * выше: клик поднимает cyl.id (у круглой колонны один цельный меш, без
 * деления на сегменты вокруг проёмов, как у стены — поэтому отдельного
 * lineId не нужно, id колонны и так уникален и один на весь объект).
 */
function RoundColumnMesh({ cyl, opacity = 1, selected = false, measuring = false, onSelect }: {
  cyl: ColumnCylinder3D
  opacity?: number
  selected?: boolean
  measuring?: boolean
  onSelect?: (id: string) => void
}) {
  const tex = useMemo(() => getWallTexture('concrete', 2 * Math.PI * cyl.radius, cyl.heightM), [cyl.radius, cyl.heightM])
  const tint = useMemo(() => tintOverTexture(COLUMN_COLOR), [])
  function handleClick(e: ThreeEvent<MouseEvent>) {
    if (measuring || !onSelect) return
    e.stopPropagation()
    onSelect(cyl.id)
  }
  return (
    <mesh position={[cyl.cx, cyl.heightM / 2, cyl.cz]} castShadow receiveShadow onClick={handleClick}>
      <cylinderGeometry args={[cyl.radius, cyl.radius, cyl.heightM, 24]} />
      <meshStandardMaterial
        map={tex}
        color={tint}
        roughness={0.9}
        transparent={opacity < 1}
        opacity={opacity}
        emissive={selected ? '#ffca28' : '#000000'}
        emissiveIntensity={selected ? 0.55 : 0}
      />
    </mesh>
  )
}

/**
 * Прямоугольная колонна (самостоятельная сущность) → коробка three.js.
 * Тот же принцип, что и WallMesh (боковая коробка стены) — но свой
 * фиксированный цвет COLUMN_COLOR, как и у круглой колонны, а не цвет
 * из TYPE_COLOR_3D (колонна не привязана к PlanLineType).
 * Клик/подсветка (10.07.2026) — см. RoundColumnMesh выше, тот же принцип.
 */
function RectColumnMesh({ box, opacity = 1, selected = false, measuring = false, onSelect }: {
  box: RectColumnBox3D
  opacity?: number
  selected?: boolean
  measuring?: boolean
  onSelect?: (id: string) => void
}) {
  const tex = useMemo(() => getWallTexture('concrete', box.size.sx, box.size.sy), [box.size.sx, box.size.sy])
  const tint = useMemo(() => tintOverTexture(COLUMN_COLOR), [])
  function handleClick(e: ThreeEvent<MouseEvent>) {
    if (measuring || !onSelect) return
    e.stopPropagation()
    onSelect(box.id)
  }
  return (
    <mesh position={[box.center.x, box.center.y, box.center.z]} rotation={[0, box.rotationY, 0]} castShadow receiveShadow onClick={handleClick}>
      <boxGeometry args={[box.size.sx, box.size.sy, box.size.sz]} />
      <meshStandardMaterial
        map={tex}
        color={tint}
        roughness={0.9}
        transparent={opacity < 1}
        opacity={opacity}
        emissive={selected ? '#ffca28' : '#000000'}
        emissiveIntensity={selected ? 0.55 : 0}
      />
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
function FreeformStructureMesh({ prism, opacity = 1, selected = false, measuring = false, onSelect }: {
  prism: FreeformPrism3D
  opacity?: number
  selected?: boolean
  measuring?: boolean
  onSelect?: (structureId: string) => void
}) {
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
  const color = prism.kind === 'column' ? COLUMN_COLOR : TYPE_COLOR_3D.wall_existing
  const bbox = useMemo(() => {
    if (prism.points.length === 0) return { w: CONCRETE_DEFAULT_TILE_M, d: CONCRETE_DEFAULT_TILE_M }
    const xs = prism.points.map(p => p.x), zs = prism.points.map(p => p.z)
    return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }
  }, [prism.points])
  // Для стены (kind: 'wall') главная видимая грань — вдоль контура, высота
  // сегмента (band); для колонны просто периметр × высота, то же упрощение,
  // что и у остальных колонн (RoundColumnMesh/RectColumnMesh) выше.
  const tex = useMemo(
    () => getWallTexture(prism.materialKind, Math.max(bbox.w, bbox.d), prism.heightM),
    [prism.materialKind, bbox.w, bbox.d, prism.heightM],
  )
  const tint = useMemo(() => tintOverTexture(color), [color])
  if (!geo) return null
  function handleClick(e: ThreeEvent<MouseEvent>) {
    if (measuring || !onSelect) return
    e.stopPropagation()
    onSelect(prism.structureId)
  }
  return (
    <mesh geometry={geo} castShadow receiveShadow onClick={handleClick}>
      <meshStandardMaterial
        map={tex}
        color={tex ? tint : color}
        roughness={0.9}
        transparent={opacity < 1}
        opacity={opacity}
        emissive={selected ? '#ffca28' : '#000000'}
        emissiveIntensity={selected ? 0.55 : 0}
      />
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
 * Закладка вида (10.07.2026, идея №5) — не персистится (сбрасывается при
 * перезагрузке/повторном открытии проекта, см. обсуждение с пользователем).
 * posLocal/targetLocal — ЛОКАЛЬНЫЕ координаты (до visualScale), см.
 * ViewJumpRig выше.
 */
interface ViewBookmark {
  id: string
  name: string
  posLocal: THREE.Vector3
  targetLocal: THREE.Vector3
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
 * Всплывающая табличка над выбранным объектом (10.07.2026, выбор кликом в
 * 3D — стена, круглая/прямоугольная колонна, обведённая карандашом
 * конструкция) — показывает label и, если есть, строку статуса/стадии
 * работ. Для стены статус — из buildProgress (тот же резолвер, что и
 * 2D-дот в FloorPlan.tsx, см. core/lineProgress.ts); у колонн и
 * произвольных конструкций такого прогресса в модели данных пока нет
 * (только устаревшее WorkStatus без текстового отображения нигде в
 * приложении) — для них панель показывает только label, без выдуманной
 * строки статуса. Кнопка «✕» снимает выделение — тот же эффект, что клик
 * по пустому месту сцены (см. onPointerMissed в Canvas ниже).
 */
function EntitySelectionPanel({
  x, y, z, label, statusText, statusColor, onClose,
}: { x: number; y: number; z: number; label: string; statusText?: string; statusColor?: string; onClose: () => void }) {
  const borderColor = statusColor ?? '#3a7bd5'
  return (
    <Html position={[x, y, z]} center distanceFactor={10} zIndexRange={[30, 0]} occlude={false}>
      <div
        style={{
          padding: '6px 10px', borderRadius: 8, whiteSpace: 'nowrap',
          background: 'rgba(255,255,255,0.96)', border: `1px solid ${borderColor}`,
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)', userSelect: 'none',
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: '#1a1f33' }}>{label}</div>
          {statusText && <div style={{ color: borderColor, fontWeight: 600 }}>{statusText}</div>}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          title="Снять выделение"
          style={{
            border: 'none', background: 'none', cursor: 'pointer', fontSize: 14,
            color: '#888', padding: 0, lineHeight: 1,
          }}
        >
          ✕
        </button>
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
 * Закладки видов (10.07.2026) — идея №5 (последняя) из списка "3D-вид на
 * объекте" (KONSPEKT.md). В отличие от CameraRig (который сохраняет ТЕКУЩИЙ
 * угол обзора и лишь подъезжает к новой точке — нужно для "фокуса"), здесь
 * нужно восстановить ТОЧНЫЙ сохранённый ракурс (позицию камеры и цель) —
 * иначе "закладка" не имела бы смысла (каждый раз смотрели бы по-своему).
 *
 * pos/target — уже МИРОВЫЕ координаты на момент прыжка (домножены на
 * текущий visualScale в goToBookmark, см. Scene3D) — сама закладка хранит
 * ЛОКАЛЬНЫЕ координаты (viewBookmarks), чтобы оставаться корректной при
 * любом активном визуальном масштабе.
 *
 * settledNonce — как только позиция/цель практически совпали с целевыми,
 * дальше НЕ трогаем камеру каждый кадр (в отличие от CameraRig) — иначе
 * если пользователь начнёт вручную крутить камеру после прыжка, лёрп к
 * замороженной цели продолжал бы "утягивать" её обратно, мешая ручному
 * управлению.
 */
function ViewJumpRig({ viewJump, controlsRef }: {
  viewJump: { nonce: number; pos: THREE.Vector3; target: THREE.Vector3 } | null
  controlsRef: React.RefObject<any>
}) {
  const { camera } = useThree()
  const settledNonce = useRef(0)

  useFrame(() => {
    if (!viewJump || !controlsRef.current || settledNonce.current === viewJump.nonce) return
    controlsRef.current.target.lerp(viewJump.target, 0.15)
    camera.position.lerp(viewJump.pos, 0.15)
    controlsRef.current.update()
    if (
      camera.position.distanceTo(viewJump.pos) < 0.01 &&
      controlsRef.current.target.distanceTo(viewJump.target) < 0.01
    ) {
      settledNonce.current = viewJump.nonce
    }
  })
  return null
}

/**
 * Инструмент измерения в 3D (10.07.2026) — идея №3 из списка "3D-вид на
 * объекте" (KONSPEKT-снапшот сессии 09.07.2026). Клик по двум точкам модели
 * → расстояние между ними прямо в 3D-виде, не только по данным сметы.
 *
 * `points` — МИРОВЫЕ координаты (то, что даёт event.point из R3F при клике,
 * см. handleMeasureClick в Scene3D) — этот компонент рендерится СНАРУЖИ
 * <group scale={visualScale}> (см. Canvas ниже), поэтому координаты не
 * нужно домножать/делить при рисовании маркеров и линии — они уже мировые,
 * как и всё остальное на этом уровне вложенности.
 *
 * Реальное расстояние (то, что показывается в подписи) — отдельная история:
 * `visualScale` растягивает МИРОВЫЕ координаты объекта (см. кнопки 1x/5x/10x
 * и комментарий у CameraScaleSync выше), поэтому расстояние между мировыми
 * точками нужно ДЕЛИТЬ на visualScale, чтобы получить настоящую величину —
 * иначе на масштабе 5x/10x показывалось бы значение в 5-10 раз больше
 * реального, что нарушало бы главный принцип фичи масштаба ("три метра
 * остаются тремя метрами").
 */
function MeasureOverlay({ points, visualScale }: { points: THREE.Vector3[]; visualScale: VisualScale }) {
  if (points.length === 0) return null

  const midpoint = points.length === 2
    ? points[0].clone().add(points[1]).multiplyScalar(0.5)
    : null
  const realDistanceM = points.length === 2
    ? points[0].distanceTo(points[1]) / visualScale
    : null

  return (
    <>
      {points.map((p, i) => (
        <Sphere key={i} args={[0.03, 12, 12]} position={[p.x, p.y, p.z]}>
          <meshBasicMaterial color="#ff7043" depthTest={false} />
        </Sphere>
      ))}
      {points.length === 2 && (
        <Line points={[points[0], points[1]]} color="#ff7043" lineWidth={2} dashed={false} depthTest={false} />
      )}
      {midpoint && realDistanceM !== null && (
        <Html position={[midpoint.x, midpoint.y, midpoint.z]} center distanceFactor={10} zIndexRange={[20, 0]} occlude={false}>
          <div
            style={{
              padding: '4px 10px', borderRadius: 8, whiteSpace: 'nowrap',
              background: '#ff7043', color: '#fff', fontSize: 13, fontWeight: 700,
              boxShadow: '0 1px 4px rgba(0,0,0,0.35)', userSelect: 'none', pointerEvents: 'none',
            }}
          >
            {formatDistanceM(realDistanceM)}
          </div>
        </Html>
      )}
    </>
  )
}

/**
 * Геометрия ОДНОГО этажа — то, что раньше было прямо в теле Scene3D.
 * Обёрнута в <group position={[0, offsetY, 0]}> — offsetY = отметка этажа
 * (Level.elevationMm) в метрах, так все этажи проекта встают друг над
 * другом на своих реальных высотах в одной сцене. Неактивный этаж (не тот,
 * что выбран в шапке плана) рисуется полупрозрачным — чтобы было видно
 * объект целиком, но сразу понятно, какой этаж сейчас редактируется.
 */
function LevelGroup({
  floorPlan, offsetY, dimmed, showCeilingGrid, onFocusRoom, onFocusElement,
  selectedEntity, measuring, onSelectEntity, onDeselect,
}: {
  floorPlan: FloorPlan; offsetY: number; dimmed: boolean; showCeilingGrid: boolean
  onFocusRoom: (worldTarget: THREE.Vector3, distance: number) => void
  onFocusElement: (localTarget: THREE.Vector3, localDistance: number) => void
  selectedEntity: SelectedEntity | null
  measuring: boolean
  onSelectEntity: (entity: SelectedEntity) => void
  onDeselect: () => void
}) {
  const lines = floorPlan.lines ?? []
  const rooms = floorPlan.rooms ?? []
  const slabs = floorPlan.slabs ?? []
  const ceilings = floorPlan.ceilings ?? []
  const roundColumns = floorPlan.roundColumns ?? []
  const rectColumns = floorPlan.rectColumns ?? []
  const freeformStructures = floorPlan.freeformStructures ?? []
  const scaleMmPx = floorPlan.scaleMmPerPx ?? 10
  const opacity = dimmed ? 0.35 : 1

  const boxes = useMemo(() => wallsToBoxes3D(lines, scaleMmPx, rectColumns), [lines, scaleMmPx, rectColumns])
  const linesById = useMemo(() => new Map(lines.map(l => [l.id, l])), [lines])
  const polygons = useMemo(() => roomsToPolygons3D(rooms, lines, scaleMmPx), [rooms, lines, scaleMmPx])
  const slabPolygons = useMemo(() => slabsToPolygons3D(slabs, scaleMmPx), [slabs, scaleMmPx])
  const ceilingPolygons = useMemo(() => ceilingsToPolygons3D(ceilings, scaleMmPx), [ceilings, scaleMmPx])
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

  // Выбранный объект (10.07.2026) — панель статуса и подсветка показываются
  // только для АКТИВНОГО (недимленного) этажа, чтобы не путать пользователя
  // геометрией другого, полупрозрачного этажа. Если выбранный объект
  // относится к другому этажу, здесь просто ничего не найдётся — сработает
  // у того LevelGroup, которому он действительно принадлежит.
  const selectedWallId        = !dimmed && selectedEntity?.kind === 'wall'        ? selectedEntity.id : null
  const selectedRoundColId    = !dimmed && selectedEntity?.kind === 'roundColumn' ? selectedEntity.id : null
  const selectedRectColId     = !dimmed && selectedEntity?.kind === 'rectColumn'  ? selectedEntity.id : null
  const selectedFreeformId    = !dimmed && selectedEntity?.kind === 'freeform'    ? selectedEntity.id : null

  const selectedLine = selectedWallId ? lines.find(l => l.id === selectedWallId) : undefined
  const selectedWallBox = selectedLine ? boxes.find(b => b.lineId === selectedLine.id) : undefined
  const selectedRoundCol = selectedRoundColId ? roundColumns.find(c => c.id === selectedRoundColId) : undefined
  const selectedRoundCyl = selectedRoundCol ? columnCylinders.find(c => c.id === selectedRoundCol.id) : undefined
  const selectedRectCol = selectedRectColId ? rectColumns.find(c => c.id === selectedRectColId) : undefined
  const selectedRectBox = selectedRectCol ? rectColumnBoxes.find(b => b.id === selectedRectCol.id) : undefined
  const selectedFreeform = selectedFreeformId ? freeformStructures.find(f => f.id === selectedFreeformId) : undefined
  const selectedFreeformFirstPrism = selectedFreeform ? freeformPrisms.find(p => p.structureId === selectedFreeform.id) : undefined

  // Панель статуса (10.07.2026) — единая для всех 4 видов объектов, но
  // содержимое собирается по-разному: у стены есть buildProgress (см.
  // core/lineProgress.ts, тот же резолвер, что и 2D-дот); у колонн и
  // произвольных конструкций такого прогресса в модели данных пока нет —
  // для них показывается только label, без выдуманной строки статуса.
  const panel = selectedLine && selectedWallBox
    ? {
        x: selectedWallBox.center.x, y: selectedWallBox.center.y + selectedWallBox.size.sy / 2 + 0.3, z: selectedWallBox.center.z,
        label: selectedLine.label,
        statusText: lineProgressSummary(selectedLine.buildProgress),
        statusColor: lineProgressColor(selectedLine.buildProgress),
      }
    : selectedRoundCol && selectedRoundCyl
    ? { x: selectedRoundCyl.cx, y: selectedRoundCyl.heightM + 0.3, z: selectedRoundCyl.cz, label: selectedRoundCol.label }
    : selectedRectCol && selectedRectBox
    ? { x: selectedRectBox.center.x, y: selectedRectBox.center.y + selectedRectBox.size.sy / 2 + 0.3, z: selectedRectBox.center.z, label: selectedRectCol.label }
    : selectedFreeform && selectedFreeformFirstPrism
    ? {
        x: selectedFreeformFirstPrism.points.reduce((s, p) => s + p.x, 0) / selectedFreeformFirstPrism.points.length,
        y: mmToM(selectedFreeform.heightMm ?? ceilingMm) + 0.3,
        z: selectedFreeformFirstPrism.points.reduce((s, p) => s + p.z, 0) / selectedFreeformFirstPrism.points.length,
        label: selectedFreeform.label,
      }
    : null

  return (
    <group position={[0, offsetY, 0]}>
      {boxes.map(box => (
        <WallMesh
          key={box.id}
          box={box}
          line={linesById.get(box.lineId)}
          opacity={opacity}
          selected={box.lineId === selectedWallId}
          measuring={measuring}
          onSelect={(lineId) => onSelectEntity({ kind: 'wall', id: lineId })}
        />
      ))}
      {polygons.map(room => <SlabOrColumn key={room.id} room={room} ceilingMm={ceilingMm} skipFloor={hasHandDrawnSlabs} opacity={opacity} />)}
      {showCeilingGrid && !dimmed && polygons.filter(r => !r.isColumn).map(room => {
        // 10.07.2026: если для этого Room сохранён ceilingSpec (CeilingCalc.tsx
        // → «Сохранить в 3D», см. KONSPEKT.md), считаем реальный шаг несущего/
        // подвесов через тот же resolveFrameParams, что и сам калькулятор —
        // единая точка правды, число не разъезжается между 2D-превью и 3D.
        // Не задан -> CeilingGridMesh падает на дефолты (DEFAULT_GRID_STEP_B/C),
        // как раньше.
        const spec = room.ceilingSpec
        const frameParams = spec
          ? resolveFrameParams({
              stepC: spec.stepC, layoutMode: spec.layoutMode ?? 'user', userStepB: spec.stepB,
              mountDirection: spec.mountDirection, loadClass: spec.loadClass, ceilingType: spec.type === 'p113' ? 'p113' : 'p112',
            })
          : null
        return (
          <CeilingGridMesh
            key={`grid-${room.id}`}
            roomPoints={room.points}
            ceilingM={mmToM(ceilingMm)}
            stepB={frameParams?.stepB}
            stepC={spec?.stepC}
            stepA={frameParams?.stepA}
            bearingAlongLength={spec?.bearingAlongLength}
            ceilingType={spec?.type === 'p113' ? 'p113' : 'p112'}
            onFocusElement={onFocusElement}
            measuring={measuring}
          />
        )
      })}
      {slabPolygons.map(slab => <HandDrawnSlabMesh key={slab.id} slab={slab} opacity={opacity} />)}
      {ceilingPolygons.map(cl => (
        <CeilingEntityMesh
          key={`ceiling-${cl.id}`}
          ceiling={cl}
          ceilingM={mmToM(ceilingMm)}
          opacity={opacity}
          showGrid={showCeilingGrid && !dimmed}
        />
      ))}
      {columnCylinders.map(cyl => (
        <RoundColumnMesh
          key={cyl.id}
          cyl={cyl}
          opacity={opacity}
          selected={cyl.id === selectedRoundColId}
          measuring={measuring}
          onSelect={(id) => onSelectEntity({ kind: 'roundColumn', id })}
        />
      ))}
      {rectColumnBoxes.map(box => (
        <RectColumnMesh
          key={box.id}
          box={box}
          opacity={opacity}
          selected={box.id === selectedRectColId}
          measuring={measuring}
          onSelect={(id) => onSelectEntity({ kind: 'rectColumn', id })}
        />
      ))}
      {freeformPrisms.map(prism => (
        <FreeformStructureMesh
          key={prism.id}
          prism={prism}
          opacity={opacity}
          selected={prism.structureId === selectedFreeformId}
          measuring={measuring}
          onSelect={(structureId) => onSelectEntity({ kind: 'freeform', id: structureId })}
        />
      ))}
      {panel && (
        <EntitySelectionPanel
          x={panel.x}
          y={panel.y}
          z={panel.z}
          label={panel.label}
          statusText={'statusText' in panel ? panel.statusText : undefined}
          statusColor={'statusColor' in panel ? panel.statusColor : undefined}
          onClose={onDeselect}
        />
      )}
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
    freeformStructuresToPrisms3D(floorPlan.freeformStructures ?? [], scaleMmPx, ceilingMm).length > 0 ||
    // 12.07.2026: свободные Ceiling-контуры (пункт 7, отдельная от Room
    // сущность) раньше не учитывались здесь — план с одним только обведённым
    // потолком (без стен/комнат/плит со спецификацией) считался "пустым" и
    // 3D показывал заглушку "нечего показывать", хотя CeilingEntityMesh
    // ниже по файлу готов был его отрисовать.
    ceilingsToPolygons3D(floorPlan.ceilings ?? [], scaleMmPx).length > 0
  )
}

const VISUAL_SCALE_OPTIONS = [1, 5, 10] as const
type VisualScale = typeof VISUAL_SCALE_OPTIONS[number]

/**
 * Секущая плоскость (10.07.2026) — идея №2 из списка "3D-вид на объекте"
 * (KONSPEKT-снапшот сессии 09.07.2026, обсуждение визуального масштаба).
 * Горизонтальная (по высоте) и вертикальная (по одной оси плана, X) —
 * каждая включается независимо, слайдером внутри диапазона реальных
 * координат модели (см. modelBoundsM в Scene3D).
 *
 * Технически — глобальные THREE.Plane на renderer.clippingPlanes (world-
 * space, не требует localClippingEnabled — это отдельная штука для
 * per-material клиппинга, здесь не нужна). Каждая плоскость подключается,
 * только если соответствующий чекбокс включён — иначе массив пуст и
 * ничего не режется (см. п. "срез выключен по умолчанию" в обсуждении).
 *
 * Значения слайдеров (horizontalM/verticalM) приходят в ЛОКАЛЬНЫХ
 * координатах модели (внутри <group scale={visualScale}>, см. Canvas
 * ниже) — ровно как и modelBoundsM, от которого их диапазон считается.
 * Плоскости же — МИРОВЫЕ (renderer.clippingPlanes работает в мировом
 * пространстве, вне scale-группы), поэтому domножаем constant на
 * visualScale — тот же приём, что и в CameraScaleSync/focusOnPoint/
 * MeasureOverlay выше по файлу для той же самой проблемы (локальные
 * координаты модели vs мировые координаты рендерера при активном
 * визуальном масштабе).
 */
function SectionPlaneController({
  horizontalEnabled, horizontalM, verticalEnabled, verticalM, visualScale,
}: {
  horizontalEnabled: boolean; horizontalM: number
  verticalEnabled: boolean; verticalM: number
  visualScale: VisualScale
}) {
  const { gl } = useThree()

  useEffect(() => {
    const planes: THREE.Plane[] = []
    // normal (0,-1,0): сохраняет всё НИЖЕ constant (срезает то, что выше) —
    // чтобы заглянуть сверху внутрь помещения/каркаса.
    if (horizontalEnabled) planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), horizontalM * visualScale))
    // normal (-1,0,0): сохраняет всё С МЕНЬШИМ X (срезает то, что правее по
    // плану) — направление среза не переключается пользователем (не
    // запрашивалось), но при необходимости легко добавить переключатель.
    if (verticalEnabled) planes.push(new THREE.Plane(new THREE.Vector3(-1, 0, 0), verticalM * visualScale))
    gl.clippingPlanes = planes
    return () => { gl.clippingPlanes = [] }
  }, [gl, horizontalEnabled, horizontalM, verticalEnabled, verticalM, visualScale])

  return null
}

/**
 * Синхронизирует камеру и OrbitControls.target с visualScale (см. кнопки
 * 1x/5x/10x в Scene3D), чтобы при смене визуального масштаба объект
 * оставался в кадре примерно тем же по размеру на экране — а не "улетал"
 * за пределы вида или не оказывался внутри камеры.
 *
 * Работает через множитель ОТ ПРЕДЫДУЩЕГО масштаба К НОВОМУ (а не от 1x),
 * так что переключение работает в обе стороны (1x→10x→5x→1x) и не зависит
 * от того, где пользователь успел покрутить/подвинуть камеру между
 * переключениями.
 *
 * Реальная геометрия (planTo3D.ts, расчёты материалов) этот компонент не
 * трогает — только камеру. Сам объект масштабируется отдельно, через
 * <group scale={...}> в Scene3D ниже.
 */
function CameraScaleSync({ scale, controlsRef }: { scale: VisualScale; controlsRef: React.MutableRefObject<{ target: THREE.Vector3; update: () => void } | null> }) {
  const { camera } = useThree()
  const prevScaleRef = useRef<VisualScale>(scale)

  useEffect(() => {
    const factor = scale / prevScaleRef.current
    if (factor !== 1) {
      camera.position.multiplyScalar(factor)
      const controls = controlsRef.current
      if (controls) {
        controls.target.multiplyScalar(factor)
        controls.update()
      }
      camera.updateProjectionMatrix()
    }
    prevScaleRef.current = scale
  }, [scale, camera, controlsRef])

  return null
}

export default function Scene3D() {
  const [cameraMode, setCameraMode] = useState<'orbit' | 'fly'>('orbit')
  const [showCeilingGrid, setShowCeilingGrid] = useState(false)
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)
  const focusNonce = useRef(0)
  const [visualScale, setVisualScale] = useState<VisualScale>(1)
  const [measuring, setMeasuring] = useState(false)
  const [measurePoints, setMeasurePoints] = useState<THREE.Vector3[]>([])
  const [sectionPanelOpen, setSectionPanelOpen] = useState(false)
  const [horizontalSectionEnabled, setHorizontalSectionEnabled] = useState(false)
  const [horizontalSectionM, setHorizontalSectionM] = useState<number | null>(null)
  const [verticalSectionEnabled, setVerticalSectionEnabled] = useState(false)
  const [verticalSectionM, setVerticalSectionM] = useState<number | null>(null)
  const controlsRef = useRef<any>(null)
  const levels = useProjectStore(s => s.levels)
  const activeLevelId = useProjectStore(s => s.activeLevelId)
  // Выбор объекта кликом (10.07.2026, стена/колонны/произвольные
  // конструкции) — общее с 2D-планом состояние (см.
  // useProjectStore.selectedEntity): клик по объекту здесь подсвечивает его
  // и на вкладке «План», если туда переключиться, и наоборот.
  const selectedEntity = useProjectStore(s => s.selectedEntity)
  const setSelectedEntity = useProjectStore(s => s.setSelectedEntity)

  // Границы модели (метры, ЛОКАЛЬНЫЕ координаты — до применения visualScale)
  // — нужны только чтобы задать разумный диапазон слайдеров секущей
  // плоскости (см. SectionPlaneController). Точность не критична (слайдер,
  // не расчёт материалов) — считаем по центрам стен/точкам контуров
  // помещений с запасом (pad), без учёта поворота коробок стен, этого
  // достаточно, чтобы диапазон гарантированно накрывал модель целиком.
  const modelBoundsM = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    let minY = 0, maxY = 3
    for (const lv of levels) {
      const scaleMmPx = lv.floorPlan.scaleMmPerPx ?? 10
      const lines = lv.floorPlan.lines ?? []
      const offsetY = mmToM(lv.elevationMm)
      const ceilingMm = estimateCeilingMm(lines)
      minY = Math.min(minY, offsetY)
      maxY = Math.max(maxY, offsetY + mmToM(ceilingMm))
      for (const p of roomsToPolygons3D(lv.floorPlan.rooms ?? [], lines, scaleMmPx)) {
        for (const pt of p.points) {
          minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x)
          minZ = Math.min(minZ, pt.z); maxZ = Math.max(maxZ, pt.z)
        }
      }
      for (const box of wallsToBoxes3D(lines, scaleMmPx, lv.floorPlan.rectColumns ?? [])) {
        const half = Math.max(box.size.sx, box.size.sz) / 2
        minX = Math.min(minX, box.center.x - half); maxX = Math.max(maxX, box.center.x + half)
        minZ = Math.min(minZ, box.center.z - half); maxZ = Math.max(maxZ, box.center.z + half)
      }
    }
    if (!isFinite(minX)) { minX = -3; maxX = 3; minZ = -3; maxZ = 3 } // пустой план — просто дефолт
    const pad = 0.3
    return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad, minY, maxY: maxY + pad }
  }, [levels])

  const effectiveHorizontalM = horizontalSectionM ?? (modelBoundsM.minY + modelBoundsM.maxY) / 2
  const effectiveVerticalM = verticalSectionM ?? (modelBoundsM.minX + modelBoundsM.maxX) / 2

  // Закладки видов (10.07.2026, идея №5) — не персистятся, сбрасываются при
  // повторном открытии проекта (см. обсуждение с пользователем). Имя —
  // авто "Вид N" (bookmarkCounterRef монотонно растёт даже после удаления,
  // чтобы номера не переиспользовались и не путали), переименовать можно
  // потом инлайн в панели.
  const [viewBookmarks, setViewBookmarks] = useState<ViewBookmark[]>([])
  const bookmarkCounterRef = useRef(0)
  const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false)
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null)
  const [viewJump, setViewJump] = useState<{ nonce: number; pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const viewJumpNonceRef = useRef(0)

  // Читаем текущую камеру/цель через controlsRef.current.object — OrbitControls
  // (three-stdlib) хранит камеру, к которой привязан, в .object. Работает
  // только в режиме orbit (во fly controlsRef не заполняется — см. Canvas
  // ниже), поэтому кнопка "Сохранить вид" недоступна в режиме полёта.
  function saveCurrentView() {
    const controls = controlsRef.current
    if (!controls) return
    const cam = controls.object as THREE.Object3D
    bookmarkCounterRef.current += 1
    setViewBookmarks(prev => [...prev, {
      id: `bm_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: `Вид ${bookmarkCounterRef.current}`,
      posLocal: cam.position.clone().divideScalar(visualScale),
      targetLocal: controls.target.clone().divideScalar(visualScale),
    }])
  }

  function goToBookmark(bm: ViewBookmark) {
    setCameraMode('orbit')
    viewJumpNonceRef.current += 1
    setViewJump({
      nonce: viewJumpNonceRef.current,
      pos: bm.posLocal.clone().multiplyScalar(visualScale),
      target: bm.targetLocal.clone().multiplyScalar(visualScale),
    })
  }

  function renameBookmark(id: string, name: string) {
    setViewBookmarks(prev => prev.map(b => (b.id === id ? { ...b, name: name.trim() || b.name } : b)))
  }

  function deleteBookmark(id: string) {
    setViewBookmarks(prev => prev.filter(b => b.id !== id))
  }

  function toggleMeasuring() {
    setMeasuring(v => !v)
    setMeasurePoints([]) // выключение или включение — начинаем с чистого листа
  }

  // Клик по любому объекту сцены, когда включён инструмент измерения (см.
  // кнопку "📏 Измерение" ниже). Обработчик висит на <group scale=...>,
  // оборачивающей всю геометрию (Grid + все этажи) — клик по стене, плите,
  // колонне или элементу каркаса потолка "всплывает" сюда как обычное
  // DOM-событие (R3F бросает событие вверх по дереву сцены), поэтому не
  // нужно вешать обработчик на каждый меш отдельно.
  //
  // event.point из R3F — ВСЕГДА мировые координаты (так работает
  // THREE.Raycaster независимо от того, где висит обработчик в дереве),
  // поэтому здесь координаты не нужно домножать на visualScale — только при
  // расчёте итогового расстояния для показа человеку (см. MeasureOverlay).
  function handleMeasureClick(e: ThreeEvent<MouseEvent>) {
    if (!measuring) return
    e.stopPropagation()
    const point = e.point.clone()
    setMeasurePoints(prev => (prev.length >= 2 ? [point] : [...prev, point]))
  }

  // Общий "фокус камеры на точке" — клик по табличке помещения (RoomLabelTag)
  // ИЛИ по узлу каркаса потолка (CeilingGridMesh, см. onFocusElement у
  // LevelGroup, "фокус на элемент", 10.07.2026) ведут сюда одинаково. Должен
  // работать и в режиме полёта (FlyControls не имеет "target" — сперва
  // переключаемся на orbit, затем едем к точке; см. CameraRig).
  //
  // localTarget/localDistance приходят в ЛОКАЛЬНЫХ координатах этажа — внутри
  // <group scale={visualScale}> (см. Canvas ниже), а камера/OrbitControls
  // работают в МИРОВЫХ координатах вне этой группы. Поэтому при активном
  // визуальном масштабе (5x/10x) и цель, и дистанцию домножаем на
  // visualScale — иначе камера при клике подъедет не туда и не на то
  // расстояние, что видно на экране.
  function focusOnPoint(localTarget: THREE.Vector3, localDistance: number) {
    setCameraMode('orbit')
    focusNonce.current += 1
    setFocusTarget({
      nonce: focusNonce.current,
      target: localTarget.clone().multiplyScalar(visualScale),
      distance: localDistance * visualScale,
    })
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
        <button
          onClick={toggleMeasuring}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: '1px solid #ff7043', borderRadius: 6,
            background: measuring ? '#ff7043' : '#fff',
            color: measuring ? '#fff' : '#ff7043',
          }}>
          {measuring ? '📏 Измерение (вкл)' : '📏 Измерить расстояние'}
        </button>
        <button
          onClick={() => setSectionPanelOpen(v => !v)}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: '1px solid #00897b', borderRadius: 6,
            background: (horizontalSectionEnabled || verticalSectionEnabled) ? '#00897b' : '#fff',
            color: (horizontalSectionEnabled || verticalSectionEnabled) ? '#fff' : '#00897b',
          }}>
          {(horizontalSectionEnabled || verticalSectionEnabled) ? '✂ Разрез (вкл)' : '✂ Разрез'}
        </button>
        {sectionPanelOpen && (
          <div style={{
            padding: '10px 12px', fontSize: 12, color: '#444', background: '#e6f6f3',
            border: '1px solid #8fd4c6', borderRadius: 6, maxWidth: 240, lineHeight: 1.4,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={horizontalSectionEnabled}
                  onChange={e => setHorizontalSectionEnabled(e.target.checked)}
                />
                Горизонтальный (высота: {Math.round(effectiveHorizontalM * 1000)} мм)
              </span>
              <input
                type="range"
                min={modelBoundsM.minY} max={modelBoundsM.maxY} step={0.01}
                value={effectiveHorizontalM}
                onChange={e => setHorizontalSectionM(Number(e.target.value))}
                disabled={!horizontalSectionEnabled}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={verticalSectionEnabled}
                  onChange={e => setVerticalSectionEnabled(e.target.checked)}
                />
                Вертикальный (позиция: {Math.round(effectiveVerticalM * 1000)} мм)
              </span>
              <input
                type="range"
                min={modelBoundsM.minX} max={modelBoundsM.maxX} step={0.01}
                value={effectiveVerticalM}
                onChange={e => setVerticalSectionM(Number(e.target.value))}
                disabled={!verticalSectionEnabled}
              />
            </label>
            <span style={{ color: '#00695c' }}>
              Реальные размеры и расчёты материалов не меняются — срез только
              скрывает часть модели для обзора.
            </span>
          </div>
        )}
        <button
          onClick={() => setBookmarksPanelOpen(v => !v)}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: '1px solid #6a5acd', borderRadius: 6,
            background: bookmarksPanelOpen ? '#6a5acd' : '#fff',
            color: bookmarksPanelOpen ? '#fff' : '#6a5acd',
          }}>
          🔖 Виды{viewBookmarks.length > 0 ? ` (${viewBookmarks.length})` : ''}
        </button>
        {bookmarksPanelOpen && (
          <div style={{
            padding: '10px 12px', fontSize: 12, color: '#444', background: '#ede9fb',
            border: '1px solid #b7a9e8', borderRadius: 6, maxWidth: 260, lineHeight: 1.4,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <button
              onClick={saveCurrentView}
              disabled={cameraMode !== 'orbit'}
              title={cameraMode !== 'orbit' ? 'Сохранение видов доступно в режиме орбиты (не полёта)' : 'Сохранить текущий ракурс камеры'}
              style={{
                padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: cameraMode === 'orbit' ? 'pointer' : 'not-allowed',
                border: '1px solid #6a5acd', borderRadius: 6, background: '#6a5acd', color: '#fff',
                opacity: cameraMode === 'orbit' ? 1 : 0.5,
              }}>
              + Сохранить текущий вид
            </button>
            {viewBookmarks.length === 0 && (
              <span style={{ color: '#6a5acd' }}>Пока нет сохранённых видов.</span>
            )}
            {viewBookmarks.map(bm => (
              <div key={bm.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {editingBookmarkId === bm.id ? (
                  <input
                    autoFocus
                    defaultValue={bm.name}
                    onBlur={e => { renameBookmark(bm.id, e.target.value); setEditingBookmarkId(null) }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditingBookmarkId(null)
                    }}
                    style={{ flex: 1, fontSize: 12, padding: '2px 4px' }}
                  />
                ) : (
                  <button
                    onClick={() => goToBookmark(bm)}
                    title="Перейти к этому виду"
                    style={{
                      flex: 1, textAlign: 'left', padding: '4px 6px', fontSize: 12, cursor: 'pointer',
                      border: '1px solid #b7a9e8', borderRadius: 4, background: '#fff', color: '#4b3f8f',
                    }}>
                    {bm.name}
                  </button>
                )}
                <button
                  onClick={() => setEditingBookmarkId(bm.id)}
                  title="Переименовать"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: 2 }}>
                  ✎
                </button>
                <button
                  onClick={() => deleteBookmark(bm.id)}
                  title="Удалить закладку"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: 2, color: '#a33' }}>
                  ✕
                </button>
              </div>
            ))}
            <span style={{ color: '#6a5acd' }}>
              Виды не сохраняются между открытиями проекта.
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          {VISUAL_SCALE_OPTIONS.map(opt => (
            <button
              key={opt}
              onClick={() => setVisualScale(opt)}
              title="Визуальное увеличение 3D-вида — реальные размеры и расчёты материалов не меняются, только картинка"
              style={{
                padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: '1px solid #43a047', borderRadius: 6,
                background: visualScale === opt ? '#43a047' : '#fff',
                color: visualScale === opt ? '#fff' : '#43a047',
              }}>
              {opt}×
            </button>
          ))}
        </div>
        {showCeilingGrid && (
          <div style={{
            padding: '6px 10px', fontSize: 12, color: '#444', background: '#f3edff',
            border: '1px solid #d4c4f5', borderRadius: 6, maxWidth: 220, lineHeight: 1.4,
          }}>
            Показан по умолчанию (шаг 600×600, П113) — пока не связан с
            параметрами конкретного помещения из «Потолок» (CeilingCalc.tsx).
          </div>
        )}
        {measuring && (
          <div style={{
            padding: '6px 10px', fontSize: 12, color: '#7a3419', background: '#fff3ed',
            border: '1px solid #ffab91', borderRadius: 6, maxWidth: 220, lineHeight: 1.4,
          }}>
            {measurePoints.length === 0 && 'Кликните по первой точке на модели.'}
            {measurePoints.length === 1 && 'Кликните по второй точке — покажем расстояние.'}
            {measurePoints.length === 2 && (
              <>
                Готово. Следующий клик начнёт новое измерение.{' '}
                <button
                  onClick={() => setMeasurePoints([])}
                  style={{
                    marginTop: 4, display: 'block', padding: '3px 8px', fontSize: 12,
                    fontWeight: 600, cursor: 'pointer', border: '1px solid #ff7043',
                    borderRadius: 5, background: '#fff', color: '#ff7043',
                  }}>
                  Очистить
                </button>
              </>
            )}
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
      <Canvas
        shadows
        camera={{ position: [10, 10, 10], fov: 50 }}
        onPointerMissed={() => { if (!measuring) setSelectedEntity(null) }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 12, 6]} intensity={1} castShadow />
        <group scale={[visualScale, visualScale, visualScale]} onClick={handleMeasureClick}>
          <Grid args={[100, 100]} cellColor="#c9ccd6" sectionColor="#9aa0b0" fadeDistance={40} position={[0, -0.001, 0]} />
          {levels.map(lv => (
            <LevelGroup
              key={lv.id}
              floorPlan={lv.floorPlan}
              offsetY={mmToM(lv.elevationMm)}
              dimmed={lv.id !== activeLevelId}
              showCeilingGrid={showCeilingGrid}
              onFocusRoom={focusOnPoint}
              onFocusElement={focusOnPoint}
              selectedEntity={selectedEntity}
              measuring={measuring}
              onSelectEntity={setSelectedEntity}
              onDeselect={() => setSelectedEntity(null)}
            />
          ))}
        </group>
        <MeasureOverlay points={measurePoints} visualScale={visualScale} />
        <SectionPlaneController
          horizontalEnabled={horizontalSectionEnabled}
          horizontalM={effectiveHorizontalM}
          verticalEnabled={verticalSectionEnabled}
          verticalM={effectiveVerticalM}
          visualScale={visualScale}
        />
        <CameraScaleSync scale={visualScale} controlsRef={controlsRef} />
        {cameraMode === 'orbit'
          ? <OrbitControls ref={controlsRef} makeDefault />
          : <FlyControls makeDefault dragToLook movementSpeed={4} rollSpeed={0.6} />}
        {cameraMode === 'orbit' && <CameraRig focusTarget={focusTarget} controlsRef={controlsRef} />}
        {cameraMode === 'orbit' && <ViewJumpRig viewJump={viewJump} controlsRef={controlsRef} />}
      </Canvas>
    </div>
  )
}
