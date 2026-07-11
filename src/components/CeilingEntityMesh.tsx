/**
 * CeilingEntityMesh.tsx — 3D-визуализация свободного Ceiling-контура
 * (обведён на плане, «Плита»/«Потолок» → CeilingCalc.tsx, см. types/index.ts
 * Ceiling и KONSPEKT.md 10.07.2026, пункт 3 "холст" + пункт 6 "точная
 * геометрия по контуру").
 *
 * До этого файла (пункт 7 плана) сущность Ceiling ВООБЩЕ не рисовалась в
 * 3D — ни плоскостью, ни тем более сеткой. Отдельно от CeilingGridMesh.tsx
 * (та рисует сетку для Room — прямоугольный bounding box, см. заголовок
 * того файла) — здесь геометрия СТРОГО по контуру, включая вогнутые формы,
 * через calcPolygonP112Frame.ts (пункт 6), переиспользуя низкоуровневые
 * примитивы отрисовки профиля/краба/подвеса из CeilingGridMesh.tsx (они там
 * экспортированы специально ради этого переиспользования — секции профиля,
 * материалы и т.д. не должны визуально разъезжаться между двумя файлами).
 *
 * Сетка рисуется, только если для этого Ceiling сохранена раскладка
 * («Сохранить в 3D» в CeilingCalc.tsx — ceilingSpec.type==='p112' +
 * startWallSideIndex + slabGapMm) — иначе просто плоскость по контуру
 * (видна форма и высота, без каркаса). v1: без picking/фокуса-по-клику
 * (см. общий план "интерактивный 3D" в KONSPEKT.md) и без минваты/фрагмента
 * ГКЛ (декоративные штрихи CeilingGridMesh, не критичны для первой версии
 * моста с расчётом) — можно добавить позже по аналогии.
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import type { CeilingPolygon3D } from '../core/planTo3D'
import { mmToM } from '../core/planTo3D'
import type { Point2D } from '../core/geometry2d'
import { polygonSides } from '../core/geometry2d'
import { resolveFrameParams } from '../core/calcP112Frame'
import { calcPolygonP112Frame, toWorld, type PolygonP112FrameResult } from '../core/calcPolygonP112Frame'
import {
  ppProfileShape, extrudeProfileM, ThinProfileMesh, crabGeometry, Hanger, metalMat, crabMat,
} from './CeilingGridMesh'

const PLATE_COLOR = '#e9e4d8'
const PLATE_THICKNESS_MM = 12.5 // ГСП/ГВЛВ верхнего слоя — толщина видимой плоскости

function useFrameResult(ceiling: CeilingPolygon3D): PolygonP112FrameResult | null {
  return useMemo(() => {
    const spec = ceiling.ceilingSpec
    if (!spec || spec.type !== 'p112' || !spec.slabGapMm || ceiling.startWallSideIndex == null) return null
    const sides = polygonSides(ceiling.outerMm)
    const side = sides[ceiling.startWallSideIndex]
    if (!side) return null
    const layoutMode = spec.layoutMode ?? 'user'
    const frameParams = resolveFrameParams({
      stepC: spec.stepC, layoutMode, userStepB: spec.stepB,
      mountDirection: spec.mountDirection, loadClass: spec.loadClass,
    })
    return calcPolygonP112Frame(
      ceiling.outerMm, [], { start: side.start, end: side.end },
      spec.stepC, frameParams.stepB, spec.slabGapMm, layoutMode,
      { stepA: frameParams.stepA, wallOffsetMainMm: frameParams.wallOffsetMainMm, wallOffsetBearingMm: frameParams.wallOffsetBearingMm },
    )
  }, [ceiling.outerMm, ceiling.ceilingSpec, ceiling.startWallSideIndex])
}

export interface CeilingEntityMeshProps {
  ceiling: CeilingPolygon3D
  /** высота нижней плоскости плиты перекрытия этажа (та же, что и у
   *  остальной сцены, см. Scene3D.tsx — общий потолок этажа), метры */
  ceilingM: number
  opacity?: number
  /** Тот же переключатель "показать сетку каркаса", что и у CeilingGridMesh
   *  (Room) — плоскость потолка рисуется всегда, сетка — только если true
   *  И раскладка сохранена (см. useFrameResult выше). */
  showGrid?: boolean
}

export default function CeilingEntityMesh({ ceiling, ceilingM, opacity = 1, showGrid = true }: CeilingEntityMeshProps) {
  const frame = useFrameResult(ceiling)
  const ppShape = useMemo(() => ppProfileShape(), [])

  const plateGeo = useMemo(() => {
    const shape = new THREE.Shape(ceiling.outerM.map(p => new THREE.Vector2(p.x, -p.z)))
    const depth = mmToM(PLATE_THICKNESS_MM)
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
    g.rotateX(-Math.PI / 2)
    g.translate(0, -depth, 0)
    return g
  }, [ceiling.outerM])

  // Локальная (u,v) точка каркаса, мм → мировые координаты сцены, метры.
  function toWorldM(local: Point2D): [x: number, z: number] {
    const w = toWorld(local, frame!.frame)
    return [mmToM(w.x), mmToM(w.y)]
  }

  const dropToBearingM = 0.12
  const bearingY = ceilingM - dropToBearingM
  const mainY = bearingY - mmToM(27) - 0.003

  return (
    <group>
      <mesh geometry={plateGeo} position={[0, ceilingM, 0]} receiveShadow castShadow>
        <meshStandardMaterial color={PLATE_COLOR} roughness={0.92} metalness={0}
          transparent={opacity < 1} opacity={opacity} />
      </mesh>

      {frame && showGrid && (
        <>
          {frame.bearingRows.flatMap((row, ri) => row.segments.map(([a, b], si) => {
            const [x1, z1] = toWorldM({ x: row.pos, y: a })
            const [x2, z2] = toWorldM({ x: row.pos, y: b })
            const lengthMm = Math.abs(b - a)
            const geo = extrudeProfileM(ppShape, lengthMm)
            const angle = Math.atan2(x2 - x1, z2 - z1)
            return (
              <ThinProfileMesh key={`b-${ri}-${si}`} geometry={geo} material={metalMat}
                position={[x1, bearingY, z1]} rotation={[0, angle, 0]} actualLocalHeightM={0.027} />
            )
          }))}

          {frame.mainRows.flatMap((row, ri) => row.segments.map(([a, b], si) => {
            const [x1, z1] = toWorldM({ x: a, y: row.pos })
            const [x2, z2] = toWorldM({ x: b, y: row.pos })
            const lengthMm = Math.abs(b - a)
            const geo = extrudeProfileM(ppShape, lengthMm)
            const angle = Math.atan2(x2 - x1, z2 - z1)
            return (
              <ThinProfileMesh key={`m-${ri}-${si}`} geometry={geo} material={metalMat}
                position={[x1, mainY, z1]} rotation={[0, angle, 0]} actualLocalHeightM={0.027} />
            )
          }))}

          {frame.crabPoints.map((p, i) => {
            const [x, z] = toWorldM(p)
            return (
              <mesh key={`c-${i}`} geometry={crabGeometry()} material={crabMat}
                position={[x, (bearingY + mainY) / 2, z]} castShadow />
            )
          })}

          {frame.hangerPoints.map((p, i) => {
            const [x, z] = toWorldM(p)
            return <Hanger key={`h-${i}`} x={x} y={ceilingM} z={z} dropM={dropToBearingM} />
          })}
        </>
      )}
    </group>
  )
}
