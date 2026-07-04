/**
 * Scene3D.tsx — первая версия 3D-вида объекта (see KONSPEKT.md, "3D-сцена").
 *
 * v1: статичный снимок геометрии плана, БЕЗ анимации по статусам работ
 * (это отдельная задача — статусы уже есть в данных, но 3D пока не
 * фильтрует и не анимирует по ним, просто показывает всё как есть).
 *
 * Вся числовая геометрия (метры, повороты, полигоны) уже посчитана и
 * протестирована в core/planTo3D.ts — здесь только сборка three.js-мешей
 * и цвета.
 */

import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, FlyControls } from '@react-three/drei'
import * as THREE from 'three'
import { useProjectStore } from './store/useProjectStore'
import {
  wallsToBoxes3D, roomsToPolygons3D, slabsToPolygons3D, roundColumnsToCylinders3D, estimateCeilingMm, mmToM,
  FLOOR_SLAB_THICKNESS_MM, CEILING_SLAB_THICKNESS_MM,
  type WallBox3D, type RoomPolygon3D, type SlabPolygon3D, type ColumnCylinder3D,
} from './core/planTo3D'
import type { PlanLineType } from './types'

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

function WallMesh({ box }: { box: WallBox3D }) {
  const color = TYPE_COLOR_3D[box.planLineType]
  return (
    <mesh position={[box.center.x, box.center.y, box.center.z]} rotation={[0, box.rotationY, 0]} castShadow receiveShadow>
      <boxGeometry args={[box.size.sx, box.size.sy, box.size.sz]} />
      <meshStandardMaterial color={color} roughness={0.9} />
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
function SlabOrColumn({ room, ceilingMm, skipFloor }: { room: RoomPolygon3D; ceilingMm: number; skipFloor: boolean }) {
  const ceilingM = mmToM(ceilingMm)

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
        <meshStandardMaterial color={COLUMN_COLOR} roughness={0.9} />
      </mesh>
    )
  }

  return (
    <>
      {floorGeo && !skipFloor && (
        <mesh geometry={floorGeo} receiveShadow>
          <meshStandardMaterial color={FLOOR_COLOR} roughness={0.9} />
        </mesh>
      )}
      {ceilingGeo && (
        <mesh geometry={ceilingGeo} receiveShadow>
          <meshStandardMaterial color={CEILING_COLOR} roughness={0.9} />
        </mesh>
      )}
    </>
  )
}

/**
 * Плита, нарисованная "карандашом" — контур с вырезами (лестницы/шахты).
 * v1: только пол текущего этажа (y=0), без зеркального потолка — потолок
 * появится из плиты этажа ВЫШЕ, когда 3D научится показывать несколько
 * этажей разом (задел на будущее, сейчас Scene3D показывает один этаж).
 */
function HandDrawnSlabMesh({ slab }: { slab: SlabPolygon3D }) {
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
      <meshStandardMaterial color={FLOOR_COLOR} roughness={0.9} />
    </mesh>
  )
}

/**
 * Круглая колонна → цилиндр three.js. CylinderGeometry по умолчанию стоит
 * вдоль оси Y (высота) — ровно то, что нужно (вертикальная колонна от пола
 * до потолка), поворот не требуется в отличие от коробки-стены.
 */
function RoundColumnMesh({ cyl }: { cyl: ColumnCylinder3D }) {
  return (
    <mesh position={[cyl.cx, cyl.heightM / 2, cyl.cz]} castShadow receiveShadow>
      <cylinderGeometry args={[cyl.radius, cyl.radius, cyl.heightM, 24]} />
      <meshStandardMaterial color={COLUMN_COLOR} roughness={0.9} />
    </mesh>
  )
}

export default function Scene3D() {
  const [cameraMode, setCameraMode] = useState<'orbit' | 'fly'>('orbit')
  const floorPlan = useProjectStore(s => s.floorPlan)
  const lines = floorPlan?.lines ?? []
  const rooms = floorPlan?.rooms ?? []
  const slabs = floorPlan?.slabs ?? []
  const roundColumns = floorPlan?.roundColumns ?? []
  const scaleMmPx = floorPlan?.scaleMmPerPx ?? 10

  const boxes = useMemo(() => wallsToBoxes3D(lines, scaleMmPx), [lines, scaleMmPx])
  const polygons = useMemo(() => roomsToPolygons3D(rooms, lines, scaleMmPx), [rooms, lines, scaleMmPx])
  const slabPolygons = useMemo(() => slabsToPolygons3D(slabs, scaleMmPx), [slabs, scaleMmPx])
  const ceilingMm = useMemo(() => estimateCeilingMm(lines), [lines])
  const columnCylinders = useMemo(
    () => roundColumnsToCylinders3D(roundColumns, scaleMmPx, ceilingMm),
    [roundColumns, scaleMmPx, ceilingMm],
  )
  const hasHandDrawnSlabs = slabPolygons.length > 0

  const isEmpty = boxes.length === 0 && polygons.length === 0 && slabPolygons.length === 0 && columnCylinders.length === 0

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
        {cameraMode === 'fly' && (
          <div style={{
            padding: '6px 10px', fontSize: 12, color: '#444', background: '#fffbe6',
            border: '1px solid #e6d68a', borderRadius: 6, maxWidth: 220, lineHeight: 1.4,
          }}>
            W/S — вперёд/назад, A/D — влево/вправо, R/F — вверх/вниз.
            Зажать мышь и потянуть — посмотреть по сторонам.
          </div>
        )}
      </div>
      <Canvas shadows camera={{ position: [10, 10, 10], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 12, 6]} intensity={1} castShadow />
        <Grid args={[100, 100]} cellColor="#c9ccd6" sectionColor="#9aa0b0" fadeDistance={40} position={[0, -0.001, 0]} />
        {boxes.map(box => <WallMesh key={box.id} box={box} />)}
        {polygons.map(room => <SlabOrColumn key={room.id} room={room} ceilingMm={ceilingMm} skipFloor={hasHandDrawnSlabs} />)}
        {slabPolygons.map(slab => <HandDrawnSlabMesh key={slab.id} slab={slab} />)}
        {columnCylinders.map(cyl => <RoundColumnMesh key={cyl.id} cyl={cyl} />)}
        {cameraMode === 'orbit'
          ? <OrbitControls makeDefault />
          : <FlyControls makeDefault dragToLook movementSpeed={4} rollSpeed={0.6} />}
      </Canvas>
    </div>
  )
}
