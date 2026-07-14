/**
 * CeilingCalc3DPreview.tsx — самостоятельный 3D-просмотр потолка ПРЯМО ИЗ
 * КАЛЬКУЛЯТОРА (CeilingCalc.tsx), не привязанный ни к какому Room/Ceiling
 * на плане.
 *
 * До этого компонента 3D-показ каркаса работал только если расчёт был
 * "засеян" (seed) с плана — из реального Room или обведённого контура
 * Ceiling (см. useCeilingSeedStore, CeilingCalc.tsx → autosync-эффекты
 * → Scene3D.tsx). Если пользователь просто открывал калькулятор и вбивал
 * размеры руками (roomLengthMm/roomWidthMm), результат был виден ТОЛЬКО
 * в 2D-холсте калькулятора (CeilingCanvas) — в 3D он никак не появлялся,
 * потому что негде: нет ни Room, ни Ceiling-сущности, к которой можно
 * привязать 3D-сцену (13.07.2026, по прямому запросу пользователя).
 *
 * Этот компонент рисует ту же геометрию каркаса (CeilingGridMesh, та же
 * подрезка по контуру и честный масштаб профиля, что и в основной 3D-сцене
 * — переиспользуется как есть, не дублируется) поверх ПРЯМОУГОЛЬНОГО
 * контура L×W из формы — своя мини-сцена (Canvas+OrbitControls), не
 * основной Scene3D (там завязка на весь floorPlan/этажи, здесь это лишнее).
 *
 * Типы без точной геометрии каркаса (П131 — только расход материалов на м²,
 * без раскладки рядов; П19 — "по индивидуальному проекту", своей формы
 * вообще нет) — честно показывают только плиту без каркаса, с поясняющей
 * подписью, как и раньше в основной 3D-сцене (см. CeilingEntityMesh.tsx).
 */

import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import CeilingGridMesh from './CeilingGridMesh'
import { mmToM } from '../core/planTo3D'
import type { CeilingType } from '../data/ceilingData'

export interface CeilingCalc3DPreviewProps {
  lengthMm: number
  widthMm: number
  ceilingType: CeilingType
  stepB?: number
  stepC?: number
  stepA?: number
  bearingAlongLength?: boolean
}

const SLAB_THICKNESS_M = 0.2
const SLAB_COLOR = '#c9c3b6'

function SlabPlate({ lengthM, widthM }: { lengthM: number; widthM: number }) {
  const geo = useMemo(() => new THREE.BoxGeometry(lengthM, SLAB_THICKNESS_M, widthM), [lengthM, widthM])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: SLAB_COLOR, roughness: 0.9 }), [])
  return (
    <mesh geometry={geo} material={mat} position={[lengthM / 2, SLAB_THICKNESS_M / 2, widthM / 2]} castShadow receiveShadow />
  )
}

export default function CeilingCalc3DPreview({
  lengthMm, widthMm, ceilingType, stepB, stepC, stepA, bearingAlongLength,
}: CeilingCalc3DPreviewProps) {
  const lengthM = mmToM(lengthMm)
  const widthM = mmToM(widthMm)
  const maxDim = Math.max(lengthM, widthM, 1)
  const hasDetailedGrid = ceilingType === 'p112' || ceilingType === 'p113'

  // Прямоугольный контур комнаты в тех же координатах (x,z), что и
  // roomPoints у RoomPolygon3D/CeilingGridMesh — origin в углу (0,0).
  const roomPoints = useMemo(() => [
    { x: 0, z: 0 }, { x: lengthM, z: 0 }, { x: lengthM, z: widthM }, { x: 0, z: widthM },
  ], [lengthM, widthM])

  return (
    <div style={{ height: 460, borderRadius: 10, overflow: 'hidden', position: 'relative', background: '#eef0f4' }}>
      <Canvas shadows camera={{ position: [maxDim * 1.1, maxDim * 1.1, maxDim * 1.4], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[maxDim, maxDim * 1.5, maxDim]} intensity={1} castShadow />
        <Suspense fallback={null}>
          <SlabPlate lengthM={lengthM} widthM={widthM} />
          {hasDetailedGrid && (
            <CeilingGridMesh
              roomPoints={roomPoints}
              ceilingM={0}
              stepB={stepB}
              stepC={stepC}
              stepA={stepA}
              bearingAlongLength={bearingAlongLength}
              ceilingType={ceilingType === 'p113' ? 'p113' : 'p112'}
            />
          )}
          {!hasDetailedGrid && (
            <Html position={[lengthM / 2, -0.3, widthM / 2]} center style={{ pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(255,255,255,0.9)', padding: '4px 10px', borderRadius: 6,
                fontSize: 12, color: '#666', whiteSpace: 'nowrap',
              }}>
                Детальный 3D-каркас для этого типа потолка ещё не реализован — показана плита
              </div>
            </Html>
          )}
        </Suspense>
        <OrbitControls target={[lengthM / 2, -0.3, widthM / 2]} makeDefault />
      </Canvas>
    </div>
  )
}
