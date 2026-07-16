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
 * ─── 12.07.2026 (шаг 3 плана, см. чат): реальные листы ГКЛ вместо плоской
 * плиты ────────────────────────────────────────────────────────────────────
 * Раньше видимая "плоскость потолка" была ОДНИМ куском (просто заливка по
 * контуру) — не показывала ни швов, ни того, что листов вообще несколько.
 * Теперь, если раскладка каркаса сохранена (тот же showGrid, что и у
 * профиля/крабов/подвесов), считается реальная раскладка листов
 * (calcPolygonSheetLayout.ts, тот же движок, что и в смете/проектном
 * раскрое, calcProjectSheetLayout.ts — числа не расходятся) и КАЖДЫЙ лист
 * рисуется отдельным боксом с небольшим зазором (шов) от соседних — видно
 * границы, обрезки, смещение слоя 2 "вразбежку". Листы висят прямо под
 * нижней полкой несущего профиля (bearingY), как в реальной сборке — а не
 * привязаны к плите перекрытия, как старая плоскость-заглушка.
 * [12.07.2026, той же сессией позже: подвес крепится к ОСНОВНОМУ профилю
 * (верхний уровень), несущий — ниже, к нему и крепится ГКЛ — см.
 * calcP112Frame.ts, шапка файла. При автомёрже с этой правкой переменные
 * mainY/bearingY поменялись местами, ГКЛ переставлен на bearingY, чтобы
 * остаться под несущим, а не оказаться на новом mainY (теперь верхнем).]
 * Без сохранённой раскладки (showGrid=false или раскладки нет вовсе) —
 * старое поведение: одна плоскость по контуру на условной высоте ceilingM
 * (просто показать форму/наличие потолка).
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import type { CeilingPolygon3D } from '../core/planTo3D'
import { mmToM } from '../core/planTo3D'
import type { Point2D } from '../core/geometry2d'
import { polygonSides } from '../core/geometry2d'
import { resolveFrameParams } from '../core/calcP112Frame'
import { calcPolygonP112Frame, toWorld, type PolygonP112FrameResult } from '../core/calcPolygonP112Frame'
import { calcPolygonP113Frame, type PolygonP113FrameResult } from '../core/calcPolygonP113Frame'
import { calcPolygonSheetLayout, type PolygonSheetLayoutResult, type PolygonSheetPiece } from '../core/calcPolygonSheetLayout'
import { boardSpecFromCeilingSpec } from '../core/calcProjectSheetLayout'
import {
  ppProfileShape, extrudeProfileM, ThinProfileMesh, crabGeometry, Hanger, HangerStripP113, metalMat, crabMat,
} from './CeilingGridMesh'

const PLATE_COLOR = '#e9e4d8'
const PLATE_THICKNESS_MM = 12.5 // ГСП/ГВЛВ верхнего слоя — толщина видимой плоскости (фолбэк без раскладки)

/** Зазор между соседними листами, чтобы швы были видны (не настоящий монтажный
 *  зазор — тот 1-2мм, здесь чуть больше ради читаемости в 3D). */
const SHEET_GAP_MM = 4

const sheetMat = new THREE.MeshStandardMaterial({ color: PLATE_COLOR, roughness: 0.92, metalness: 0 })
const sheetCutMat = new THREE.MeshStandardMaterial({ color: '#ded7c6', roughness: 0.92, metalness: 0 }) // резаный лист — чуть темнее, видно обрезки

/** 13.07.2026: раньше — только П112 (`spec.type !== 'p112'` → null). Теперь
 *  поддерживает и П113 (calcPolygonP113Frame — та же геометрия, что уже
 *  используется в смете, см. calcCeiling.ts, ветка hasPolygonGeometryP113).
 *  Результат — union двух структурно идентичных интерфейсов (frame/mainRows/
 *  bearingRows/crabPoints/hangerPoints — те же поля у обоих), поэтому весь
 *  рендер-код ниже (JSX) не потребовал ветвления по типу — читает общие поля
 *  напрямую. Различается только topology внутри bearingRows/mainRows (несущий
 *  режется вставками у П113, см. calcPolygonP113Frame.ts) и высота Y на
 *  вызывающей стороне (см. mainY/bearingY ниже в компоненте). */
function useFrameResult(ceiling: CeilingPolygon3D): PolygonP112FrameResult | PolygonP113FrameResult | null {
  return useMemo(() => {
    const spec = ceiling.ceilingSpec
    if (!spec || (spec.type !== 'p112' && spec.type !== 'p113') || !spec.slabGapMm || ceiling.startWallSideIndex == null) return null
    const sides = polygonSides(ceiling.outerMm)
    const side = sides[ceiling.startWallSideIndex]
    if (!side) return null
    const layoutMode = spec.layoutMode ?? 'user'
    const frameParams = resolveFrameParams({
      stepC: spec.stepC, layoutMode, userStepB: spec.stepB,
      mountDirection: spec.mountDirection, loadClass: spec.loadClass,
      ceilingType: spec.type === 'p113' ? 'p113' : 'p112',
    })
    const opts = { stepA: frameParams.stepA, wallOffsetMainMm: frameParams.wallOffsetMainMm, wallOffsetBearingMm: frameParams.wallOffsetBearingMm }
    return spec.type === 'p113'
      ? calcPolygonP113Frame(
          ceiling.outerMm, [], { start: side.start, end: side.end },
          spec.stepC, frameParams.stepB, spec.slabGapMm, layoutMode, opts,
        )
      : calcPolygonP112Frame(
          ceiling.outerMm, [], { start: side.start, end: side.end },
          spec.stepC, frameParams.stepB, spec.slabGapMm, layoutMode, opts,
        )
  }, [ceiling.outerMm, ceiling.ceilingSpec, ceiling.startWallSideIndex])
}

/** Реальная раскладка листов ГКЛ по контуру — тот же движок, что и в смете
 *  (calcProjectSheetLayout.ts → calcPolygonSheetLayout.ts), поэтому число
 *  листов в 3D и в смете совпадает. Не требует slabGapMm (в отличие от
 *  каркаса) — только стену старта, раскрой не зависит от подвесов. */
function useSheetLayoutResult(ceiling: CeilingPolygon3D): PolygonSheetLayoutResult | null {
  return useMemo(() => {
    const spec = ceiling.ceilingSpec
    if (!spec || ceiling.startWallSideIndex == null) return null
    const sides = polygonSides(ceiling.outerMm)
    const side = sides[ceiling.startWallSideIndex]
    if (!side) return null
    const boardSpec = boardSpecFromCeilingSpec(spec)
    return calcPolygonSheetLayout(
      ceiling.outerMm, [], { start: side.start, end: side.end },
      boardSpec.sheetLength, spec.layers, boardSpec, boardSpec,
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
   *  (Room) — при true и сохранённой раскладке рисуются профиль/крабы/
   *  подвесы И реальные листы ГКЛ вместо плоской плиты-заглушки. */
  showGrid?: boolean
}

export default function CeilingEntityMesh({ ceiling, ceilingM, opacity = 1, showGrid = true }: CeilingEntityMeshProps) {
  const frame = useFrameResult(ceiling)
  const sheetLayout = useSheetLayoutResult(ceiling)
  const ppShape = useMemo(() => ppProfileShape(), [])

  const showDetailed = showGrid && !!frame
  const showSheets = showDetailed && !!sheetLayout

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

  // 12.07.2026, ИСПРАВЛЕНИЕ: подвес крепится к ОСНОВНОМУ профилю (верхний
  // уровень), несущий — ниже, соединён с основным крабом (см.
  // calcP112Frame.ts, шапка файла — было наоборот).
  // 13.07.2026: у П113 (одноуровневая система) mainY/bearingY совпадают —
  // см. тот же комментарий в CeilingGridMesh.tsx (Room-путь), топология
  // идентична, отличается только источник геометрии (контур vs bbox).
  const isP113 = ceiling.ceilingSpec?.type === 'p113'
  const dropToMainM = 0.12
  const mainY = ceilingM - dropToMainM
  const bearingY = isP113 ? mainY : mainY - mmToM(27) - 0.003

  return (
    <group>
      {!showSheets && (
        <mesh geometry={plateGeo} position={[0, ceilingM, 0]} receiveShadow castShadow>
          <meshStandardMaterial color={PLATE_COLOR} roughness={0.92} metalness={0}
            transparent={opacity < 1} opacity={opacity} />
        </mesh>
      )}

      {showSheets && (
        <SheetLayers sheetLayout={sheetLayout!} toWorldM={toWorldM} topY={bearingY} opacity={opacity} />
      )}

      {showDetailed && (
        <>
          {frame!.bearingRows.flatMap((row, ri) => row.segments.map(([a, b], si) => {
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

          {frame!.mainRows.flatMap((row, ri) => row.segments.map(([a, b], si) => {
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

          {frame!.crabPoints.map((p, i) => {
            const [x, z] = toWorldM(p)
            return (
              <mesh key={`c-${i}`} geometry={crabGeometry()} material={crabMat}
                position={[x, (bearingY + mainY) / 2, z]} castShadow />
            )
          })}

          {frame!.hangerPoints.map((p, i) => {
            const [x, z] = toWorldM(p)
            // 14.07.2026: П113 — перфорированная лента по фото (см.
            // HangerStripP113 в CeilingGridMesh.tsx), П112 — прежний
            // стержень+пластина+зажим (Hanger).
            const HangerComp = isP113 ? HangerStripP113 : Hanger
            return <HangerComp key={`h-${i}`} x={x} y={ceilingM} z={z} dropM={dropToMainM} />
          })}
        </>
      )}
    </group>
  )
}

/** Один слой листов ГКЛ — куски по calcPolygonSheetLayout, каждый отдельным
 *  боксом с зазором (виден шов). Слой 2 (если есть) — сразу под слоем 1. */
function SheetLayers({ sheetLayout, toWorldM, topY, opacity }: {
  sheetLayout: PolygonSheetLayoutResult
  toWorldM: (p: Point2D) => [number, number]
  topY: number
  opacity: number
}) {
  const layer1ThicknessM = mmToM(sheetLayout.layer1.spec.thickness)
  const layer1CenterY = topY - layer1ThicknessM / 2

  const layer2 = sheetLayout.layer2
  const layer2ThicknessM = layer2 ? mmToM(layer2.spec.thickness) : 0
  const layer2CenterY = topY - layer1ThicknessM - layer2ThicknessM / 2

  return (
    <>
      {sheetLayout.layer1.pieces.map((piece, i) => (
        <SheetPieceMesh key={`s1-${i}`} piece={piece} toWorldM={toWorldM}
          centerY={layer1CenterY} thicknessM={layer1ThicknessM} opacity={opacity} />
      ))}
      {layer2 && layer2.pieces.map((piece, i) => (
        <SheetPieceMesh key={`s2-${i}`} piece={piece} toWorldM={toWorldM}
          centerY={layer2CenterY} thicknessM={layer2ThicknessM} opacity={opacity} />
      ))}
    </>
  )
}

/**
 * Угол поворота меша (Three.js rotation.y, радианы) такой, что после
 * поворота локальная ось X меша совпадает по направлению с мировым
 * вектором (dx, dz) (в плоскости X-Z, "план сверху").
 *
 * Матрица поворота THREE.js вокруг Y на угол θ переводит локальную точку
 * (1,0,0) в мировую (cosθ, -sinθ) — ПОЭТОМУ здесь atan2(-dz, dx), а не
 * atan2(dx, dz) (последнее было багом до 16.07.2026 — см. регресс-тест).
 */
export function yRotationForDirection(dx: number, dz: number): number {
  return Math.atan2(-dz, dx)
}

function SheetPieceMesh({ piece, toWorldM, centerY, thicknessM, opacity }: {
  piece: PolygonSheetPiece
  toWorldM: (p: Point2D) => [number, number]
  centerY: number
  thicknessM: number
  opacity: number
}) {
  const uC = (piece.u1 + piece.u2) / 2
  const vC = (piece.v1 + piece.v2) / 2
  const [xa, za] = toWorldM({ x: piece.u1, y: vC })
  const [xb, zb] = toWorldM({ x: piece.u2, y: vC })
  // 16.07.2026: РЕГРЕСС — старая формула atan2(xb-xa, zb-za) разворачивала
  // каждый лист на 90° от направления оси U каркаса (см. yRotationForDirection
  // выше), поэтому ширина листа "уезжала" в сторону глубины полосы и торчала
  // за пределы каркаса (репорт пользователя со скриншотами 3D, хотя сам
  // расчёт кусков — calcPolygonSheetLayout — верный, проверено отдельно).
  const angle = yRotationForDirection(xb - xa, zb - za)
  const [xc, zc] = toWorldM({ x: uC, y: vC })

  const widthM = Math.max(0.02, (piece.u2 - piece.u1 - SHEET_GAP_MM) / 1000)
  const depthM = Math.max(0.02, (piece.v2 - piece.v1 - SHEET_GAP_MM) / 1000)
  const mat = piece.kind === 'full' ? sheetMat : sheetCutMat

  return (
    <mesh position={[xc, centerY, zc]} rotation={[0, angle, 0]} receiveShadow castShadow>
      <boxGeometry args={[widthM, thicknessM, depthM]} />
      <primitive object={mat} attach="material" transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}
