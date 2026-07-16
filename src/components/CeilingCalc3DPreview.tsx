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
import CeilingGridMesh, { calcGklLevelM } from './CeilingGridMesh'
import CeilingEntityMesh from './CeilingEntityMesh'
import type { CeilingPolygon3D } from '../core/planTo3D'
import { mmToM } from '../core/planTo3D'
import { calcCeilingSheetRects } from '../core/ceilingGridGeometry'
import type { CeilingType } from '../data/ceilingData'
import type { CeilingSheetLayout } from '../core/calcCeiling'
import type { FrameLayoutMode } from '../core/calcP112Frame'

export interface CeilingCalc3DPreviewProps {
  lengthMm: number
  widthMm: number
  ceilingType: CeilingType
  stepB?: number
  stepC?: number
  stepA?: number
  bearingAlongLength?: boolean
  /** 16.07.2026: см. CeilingGridMeshProps.layoutMode — ОБЯЗАТЕЛЬНО передавать
   *  реальный form.layoutMode калькулятора, иначе для layoutMode='knauf'
   *  число рядов в 3D-превью разойдётся с 2D-схемой того же калькулятора
   *  (репорт пользователя со скриншотами 2D/3D). Не задан -> 'user'. */
  layoutMode?: FrameLayoutMode
  wallOffsetMainMm?: number
  wallOffsetBearingMm?: number
  /** Раскрой листов ГКЛ (шаг 4 калькулятора) — та же calcCeilingSheetRects,
   *  что и в 2D CeilingCanvas (см. её шапку, 13.07.2026) — раньше здесь
   *  вместо реального раскроя рисовалась общая иллюстративная минвата из
   *  CeilingGridMesh (для настоящих комнат на плане это уместно, а для
   *  сравнения с 2D-схемой — вводило в заблуждение, репорт пользователя со
   *  скриншотами). Не задан/шаг < 4 → листы не рисуются вовсе (как и в 2D).
   */
  sheetLayout?: CeilingSheetLayout | null
}

const SLAB_THICKNESS_M = 0.2
const SLAB_COLOR = '#c9c3b6'
const SHEET_COLOR = '#90caf9'
const SHEET_CUT_COLOR = '#ffb74d'
const SHEET_GAP_M = 0.004 // тонкий видимый шов между листами

function SlabPlate({ lengthM, widthM }: { lengthM: number; widthM: number }) {
  const geo = useMemo(() => new THREE.BoxGeometry(lengthM, SLAB_THICKNESS_M, widthM), [lengthM, widthM])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: SLAB_COLOR, roughness: 0.9 }), [])
  return (
    <mesh geometry={geo} material={mat} position={[lengthM / 2, SLAB_THICKNESS_M / 2, widthM / 2]} castShadow receiveShadow />
  )
}

/** Раскрой листов ГКЛ, зашитых снизу каркаса — целые/резаные, тот же
 *  тайлинг и та же раскраска (синий/оранжевый), что и в 2D CeilingCanvas. */
function SheetLayoutMesh({ lengthMm, widthMm, sheetLayout, yM }: {
  lengthMm: number; widthMm: number; sheetLayout: CeilingSheetLayout; yM: number
}) {
  const rects = useMemo(
    () => calcCeilingSheetRects(lengthMm, widthMm, sheetLayout.sheetL, sheetLayout.sheetW),
    [lengthMm, widthMm, sheetLayout.sheetL, sheetLayout.sheetW],
  )
  return (
    <group>
      {rects.map((r, i) => {
        const wM = mmToM(r.w) - SHEET_GAP_M
        const dM = mmToM(r.d) - SHEET_GAP_M
        if (wM <= 0 || dM <= 0) return null
        return (
          <mesh
            key={i}
            position={[mmToM(r.x) + wM / 2, yM, mmToM(r.z) + dM / 2]}
            castShadow receiveShadow
          >
            <boxGeometry args={[wM, 0.0125, dM]} />
            <meshStandardMaterial color={r.isCut ? SHEET_CUT_COLOR : SHEET_COLOR} roughness={0.85} />
          </mesh>
        )
      })}
    </group>
  )
}

export default function CeilingCalc3DPreview({
  lengthMm, widthMm, ceilingType, stepB, stepC, stepA, bearingAlongLength,
  layoutMode, wallOffsetMainMm, wallOffsetBearingMm, sheetLayout,
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
              layoutMode={layoutMode}
              wallOffsetMainMm={wallOffsetMainMm}
              wallOffsetBearingMm={wallOffsetBearingMm}
              showWool={false}
              showGkl={false}
            />
          )}
          {hasDetailedGrid && sheetLayout && (
            <SheetLayoutMesh
              lengthMm={lengthMm}
              widthMm={widthMm}
              sheetLayout={sheetLayout}
              yM={calcGklLevelM(0, ceilingType === 'p113' ? 'p113' : 'p112')}
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


/**
 * Тот же 3D-переключатель, что и CeilingCalc3DPreview выше, но для
 * СЛОЖНОГО контура (много углов) — засеян с реального обведённого Ceiling
 * на плане, а не введён прямоугольником L×W. 13.07.2026, по прямому
 * запросу пользователя: раньше такой контур не показывался в 3D прямо в
 * калькуляторе вообще — переключатель был скрыт (виден только при
 * hasRoom, а у полигона roomLengthMm/roomWidthMm пустые).
 *
 * Переиспользует CeilingEntityMesh НАПРЯМУЮ (тот же компонент, что рисует
 * этот же контур в основной 3D-сцене Scene3D.tsx) — не копия/дублирование
 * геометрии: подрезка по реальным углам, раскрой ГКЛ по контуру
 * (calcPolygonP112Frame/calcPolygonP113Frame + calcPolygonSheetLayout)
 * гарантированно те же, что и в проекте, одним источником истины.
 * CeilingEntityMesh ничего не знает про Scene3D/стены — ему достаточно
 * объекта формы CeilingPolygon3D, который здесь собирается "на лету" из
 * текущего состояния формы калькулятора (ceiling.tsx строит такой же для
 * автосинхронизации с реальным Ceiling — см. её код, тот же список полей).
 */
export interface CeilingCalcPolygon3DPreviewProps {
  ceiling: CeilingPolygon3D
}

export function CeilingCalcPolygon3DPreview({ ceiling }: CeilingCalcPolygon3DPreviewProps) {
  const bbox = useMemo(() => {
    const xs = ceiling.outerM.map(p => p.x)
    const zs = ceiling.outerM.map(p => p.z)
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
    }
  }, [ceiling.outerM])
  const cx = (bbox.minX + bbox.maxX) / 2
  const cz = (bbox.minZ + bbox.maxZ) / 2
  const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxZ - bbox.minZ, 1)
  const hasDetailedGrid = ceiling.ceilingSpec?.type === 'p112' || ceiling.ceilingSpec?.type === 'p113'

  return (
    <div style={{ height: 460, borderRadius: 10, overflow: 'hidden', position: 'relative', background: '#eef0f4' }}>
      <Canvas shadows camera={{ position: [cx + maxDim * 1.1, maxDim * 1.1, cz + maxDim * 1.4], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[cx + maxDim, maxDim * 1.5, cz + maxDim]} intensity={1} castShadow />
        <Suspense fallback={null}>
          <CeilingEntityMesh ceiling={ceiling} ceilingM={0} showGrid />
          {!hasDetailedGrid && (
            <Html position={[cx, -0.3, cz]} center style={{ pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(255,255,255,0.9)', padding: '4px 10px', borderRadius: 6,
                fontSize: 12, color: '#666', whiteSpace: 'nowrap',
              }}>
                Детальный 3D-каркас для этого типа потолка ещё не реализован — показана плита
              </div>
            </Html>
          )}
        </Suspense>
        <OrbitControls target={[cx, -0.3, cz]} makeDefault />
      </Canvas>
    </div>
  )
}
