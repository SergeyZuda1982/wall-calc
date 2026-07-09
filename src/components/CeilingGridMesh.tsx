/**
 * CeilingGridMesh.tsx — 3D-визуализация каркаса подвесного потолка П112/П113
 * (несущий/основной профиль, крабы, подвесы, минвата, фрагмент ГКЛ) для
 * Scene3D.tsx.
 *
 * Раскладка рядов — из core/ceilingGridGeometry.ts (чистые мм, переиспользует
 * calcFrameRowPositions из calcP112Frame.ts — то же правило расстановки,
 * что и в реальной смете). Здесь — только сборка three.js-мешей поверх этой
 * раскладки: сечения профилей строятся как THREE.Shape + ExtrudeGeometry
 * (реальный контур сечения даёт узнаваемость, не bevel/текстура), крабы —
 * крестовая пластина, подвесы — стержень+пластина+зажим, минвата — box с
 * шумом по вершинам верхней грани + процедурная fibrous-текстура на canvas,
 * ГКЛ — прямоугольник с фаской УК по кромке.
 *
 * v1: без picking/интерактива (см. общий план "интерактивный 3D" в
 * KONSPEKT.md) — чисто визуальный слой поверх плоской плиты потолка,
 * которая уже рисуется в SlabOrColumn (Scene3D.tsx). Не заменяет её —
 * добавляется поверх/под ней.
 * v1 упрощение: подвесы/крабы рисуются обычными <mesh> (не инстансинг) —
 * при типичных размерах помещения это десятки объектов, не тысячи. Если на
 * больших планах (много помещений разом) станет тяжело — перевести на
 * drei <Instances>, раскладка (core/ceilingGridGeometry.ts) для этого уже
 * готова (все точки строго по сетке).
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import { calcCeilingGrid, DEFAULT_GRID_STEP_B, DEFAULT_GRID_STEP_C, DEFAULT_BEARING_ALONG_LENGTH } from '../core/ceilingGridGeometry'
import { mmToM } from '../core/planTo3D'

// ─── Сечения профилей (мм) ──────────────────────────────────────────────────
// ПН 28×27 — направляющий, П-образный швеллер (используется по периметру,
// здесь — как несущий периметральный ряд не рисуем отдельно, только ПП-сетка).
// ПП 60×27 — несущий/основной, шляпный (омега) профиль с загнутыми "ушками".
// Размеры совпадают с расходными таблицами (см. data/ceilingData.ts:
// pp6027_lm) — не выдуманы отдельно для 3D.

function ppProfileShape(width = 60, height = 27, t = 0.6, lip = 5): THREE.Shape {
  const s = new THREE.Shape()
  const w = width, h = height
  s.moveTo(-lip, h)
  s.lineTo(0, h)
  s.lineTo(0, t)
  s.lineTo(t, t)
  s.lineTo(t, h - t)
  s.lineTo(w - t, h - t)
  s.lineTo(w - t, t)
  s.lineTo(w, t)
  s.lineTo(w, h)
  s.lineTo(w + lip, h)
  s.closePath()
  return s
}

/** Экструзия сечения (мм, в плоскости XY) вдоль длины (мм) → geometry в метрах. */
function extrudeProfileM(shape: THREE.Shape, lengthMm: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: lengthMm, bevelEnabled: false, curveSegments: 1 })
  geo.scale(0.001, 0.001, 0.001) // мм -> м
  return geo
}

const metalMat = new THREE.MeshStandardMaterial({ color: '#b7bcc2', metalness: 0.75, roughness: 0.42 })
const crabMat = new THREE.MeshStandardMaterial({ color: '#9aa4ad', metalness: 0.6, roughness: 0.5 })
const gklMat = new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.92, metalness: 0 })

// ─── Минвата: box с шумом по вершинам верха + процедурная текстура ─────────

function noisyWoolGeometry(wM: number, dM: number, hM: number, segX = 8, segZ = 8): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(wM, hM, dM, segX, 2, segZ)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    if (y > hM * 0.3) {
      const nx = pos.getX(i), nz = pos.getZ(i)
      const n = (Math.sin(nx * 18) * Math.cos(nz * 21) * 0.003) + (Math.random() - 0.5) * 0.0025
      pos.setY(i, y + n)
    }
  }
  geo.computeVertexNormals()
  return geo
}

let cachedWoolTexture: THREE.CanvasTexture | null = null
function fibrousTexture(): THREE.CanvasTexture {
  if (cachedWoolTexture) return cachedWoolTexture
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#c9a68a'
  ctx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256
    const len = 4 + Math.random() * 10
    const ang = Math.random() * Math.PI
    ctx.strokeStyle = `rgba(${180 + Math.random() * 40 | 0},${140 + Math.random() * 40 | 0},${100 + Math.random() * 30 | 0},${0.15 + Math.random() * 0.2})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    ctx.stroke()
  }
  cachedWoolTexture = new THREE.CanvasTexture(c)
  cachedWoolTexture.wrapS = cachedWoolTexture.wrapT = THREE.RepeatWrapping
  cachedWoolTexture.repeat.set(2, 2)
  return cachedWoolTexture
}

// ─── Краб (соединитель одноуровневый) — крестовая пластина ─────────────────

function crabGeometry(sizeMm = 22, thickMm = 1.4): THREE.BufferGeometry {
  const s = new THREE.Shape()
  const a = sizeMm, b = sizeMm * 0.28
  s.moveTo(-b, -a); s.lineTo(b, -a); s.lineTo(b, -b); s.lineTo(a, -b)
  s.lineTo(a, b); s.lineTo(b, b); s.lineTo(b, a); s.lineTo(-b, a)
  s.lineTo(-b, b); s.lineTo(-a, b); s.lineTo(-a, -b); s.lineTo(-b, -b)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, { depth: thickMm, bevelEnabled: false, curveSegments: 1 })
  geo.rotateX(Math.PI / 2)
  geo.scale(0.001, 0.001, 0.001)
  return geo
}

/** Подвес прямой: пластина у плиты + стержень + гнутый зажим (упрощённая форма). */
function Hanger({ x, y, z, dropM }: { x: number; y: number; z: number; dropM: number }) {
  const clampGeo = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -dropM, 0),
      new THREE.Vector3(0.01, -dropM - 0.006, 0),
      new THREE.Vector3(0.01, -dropM - 0.014, 0),
      new THREE.Vector3(-0.002, -dropM - 0.018, 0),
    ])
    return new THREE.TubeGeometry(curve, 12, 0.002, 6, false)
  }, [dropM])

  return (
    <group position={[x, y, z]}>
      <mesh material={crabMat} castShadow>
        <boxGeometry args={[0.024, 0.0015, 0.024]} />
      </mesh>
      <mesh material={crabMat} position={[0, -dropM / 2, 0]} castShadow>
        <cylinderGeometry args={[0.002, 0.002, dropM, 6]} />
      </mesh>
      <mesh geometry={clampGeo} material={crabMat} castShadow />
    </group>
  )
}

export interface CeilingGridMeshProps {
  /** контур помещения, метры, план сверху (x,z) — как RoomPolygon3D.points */
  roomPoints: { x: number; z: number }[]
  /** высота нижней плоскости плиты перекрытия (низ потолка комнаты), метры */
  ceilingM: number
  stepB?: number
  stepC?: number
  bearingAlongLength?: boolean
  showWool?: boolean
  showGkl?: boolean
}

/**
 * Собирает 3D-каркас подвесного потолка для ОДНОГО помещения. Раскладка —
 * по bounding box контура (см. ceilingGridGeometry.ts, v1 упрощение №1) —
 * для прямоугольных комнат (частый случай) это точно, для непрямоугольных —
 * сетка чуть шире фактического контура.
 */
export default function CeilingGridMesh({
  roomPoints, ceilingM, stepB = DEFAULT_GRID_STEP_B, stepC = DEFAULT_GRID_STEP_C,
  bearingAlongLength = DEFAULT_BEARING_ALONG_LENGTH, showWool = true, showGkl = true,
}: CeilingGridMeshProps) {
  const bbox = useMemo(() => {
    if (roomPoints.length < 3) return null
    const xs = roomPoints.map(p => p.x)
    const zs = roomPoints.map(p => p.z)
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
  }, [roomPoints])

  const grid = useMemo(() => {
    if (!bbox) return null
    const lengthMm = (bbox.maxX - bbox.minX) * 1000
    const widthMm = (bbox.maxZ - bbox.minZ) * 1000
    return calcCeilingGrid({ lengthMm, widthMm, stepB, stepC, bearingAlongLength })
  }, [bbox, stepB, stepC, bearingAlongLength])

  // Вертикальная раскладка уровней относительно низа плиты (ceilingM), вниз:
  const dropToBearingM = 0.12   // типичный вылет прямого подвеса, для показа
  const bearingY = ceilingM - dropToBearingM
  const mainY = bearingY - mmToM(27) - 0.003 // основной чуть ниже несущего + зазор краба
  const gklY = mainY - mmToM(27 / 2 + 12.5 / 2)
  const woolY = bearingY - mmToM(20)

  const ppShape = useMemo(() => ppProfileShape(), [])

  if (!bbox || !grid) return null

  return (
    <group>
      {/* несущий профиль */}
      {grid.bearingSegments.map((seg, i) => {
        const lengthMm = Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1)
        const geo = extrudeProfileM(ppShape, lengthMm)
        const alongX = Math.abs(seg.z1 - seg.z2) < 1e-6
        return (
          <mesh
            key={`bearing-${i}`}
            geometry={geo}
            material={metalMat}
            castShadow
            position={[bbox.minX + seg.x1 / 1000, bearingY, bbox.minZ + seg.z1 / 1000]}
            rotation={alongX ? [0, Math.PI / 2, 0] : [0, 0, 0]}
          />
        )
      })}

      {/* основной профиль (перпендикулярно несущему) */}
      {grid.mainSegments.map((seg, i) => {
        const lengthMm = Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1)
        const geo = extrudeProfileM(ppShape, lengthMm)
        const alongX = Math.abs(seg.z1 - seg.z2) < 1e-6
        return (
          <mesh
            key={`main-${i}`}
            geometry={geo}
            material={metalMat}
            castShadow
            position={[bbox.minX + seg.x1 / 1000, mainY, bbox.minZ + seg.z1 / 1000]}
            rotation={alongX ? [0, Math.PI / 2, 0] : [0, 0, 0]}
          />
        )
      })}

      {/* крабы на пересечениях */}
      {grid.crabPoints.map((p, i) => (
        <mesh
          key={`crab-${i}`}
          geometry={crabGeometry()}
          material={crabMat}
          position={[bbox.minX + p.x / 1000, (bearingY + mainY) / 2, bbox.minZ + p.z / 1000]}
          castShadow
        />
      ))}

      {/* подвесы вдоль несущего профиля */}
      {grid.hangerPoints.map((p, i) => (
        <Hanger
          key={`hanger-${i}`}
          x={bbox.minX + p.x / 1000}
          y={ceilingM}
          z={bbox.minZ + p.z / 1000}
          dropM={dropToBearingM}
        />
      ))}

      {/* минвата — фрагменты в части ячеек, только для наглядности */}
      {showWool && grid.mainSegments.length > 1 && grid.bearingSegments.length > 1 && (
        <MineralWoolFill bbox={bbox} grid={grid} y={woolY} />
      )}

      {/* ГКЛ — фрагмент листа снизу, показывает вид уже зашитого участка */}
      {showGkl && (
        <GklFragment bbox={bbox} y={gklY} />
      )}
    </group>
  )
}

function MineralWoolFill({
  bbox, grid, y,
}: {
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number }
  grid: ReturnType<typeof calcCeilingGrid>
  y: number
}) {
  // Границы ячеек по X — координаты всех "вертикальных" линий сетки (x1===x2,
  // линия идёт вдоль Z), независимо от того, несущий это профиль или основной
  // (кто из них вертикален — зависит от bearingAlongLength, см.
  // ceilingGridGeometry.ts). То же для Z с "горизонтальными" линиями (z1===z2).
  const allSegments = useMemo(() => [...grid.bearingSegments, ...grid.mainSegments], [grid])
  const cellsX = useMemo(() => {
    const xs = [0, ...allSegments.filter(s => s.x1 === s.x2).map(s => s.x1), (bbox.maxX - bbox.minX) * 1000]
      .filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b)
    return xs
  }, [allSegments, bbox])
  const cellsZ = useMemo(() => {
    const zs = [0, ...allSegments.filter(s => s.z1 === s.z2).map(s => s.z1), (bbox.maxZ - bbox.minZ) * 1000]
      .filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b)
    return zs
  }, [allSegments, bbox])

  const cells: { x: number; z: number; w: number; d: number }[] = []
  for (let i = 0; i < cellsX.length - 1; i++) {
    for (let j = 0; j < cellsZ.length - 1; j++) {
      if ((i + j) % 3 === 0) continue // не все ячейки — часть остаётся под открытый вид ГКЛ
      const w = cellsX[i + 1] - cellsX[i]
      const d = cellsZ[j + 1] - cellsZ[j]
      if (w < 100 || d < 100) continue
      cells.push({ x: (cellsX[i] + cellsX[i + 1]) / 2, z: (cellsZ[j] + cellsZ[j + 1]) / 2, w, d })
    }
  }

  const tex = useMemo(() => fibrousTexture(), [])
  const woolMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }), [tex])

  return (
    <>
      {cells.map((c, i) => {
        const geo = noisyWoolGeometry(c.w / 1000 - 0.02, c.d / 1000 - 0.02, 0.04)
        return (
          <mesh
            key={i}
            geometry={geo}
            material={woolMat}
            position={[bbox.minX + c.x / 1000, y, bbox.minZ + c.z / 1000]}
            castShadow
          />
        )
      })}
    </>
  )
}

function GklFragment({ bbox, y }: { bbox: { minX: number; maxX: number; minZ: number; maxZ: number }; y: number }) {
  const wM = Math.min(bbox.maxX - bbox.minX, 1.2)
  const dM = Math.min(bbox.maxZ - bbox.minZ, 1.2)
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    const thickness = 12.5, chamfer = 3
    s.moveTo(0, 0)
    s.lineTo(0, thickness - chamfer)
    s.lineTo(chamfer * 0.6, thickness)
    s.lineTo(1000 * wM - chamfer * 0.6, thickness)
    s.lineTo(1000 * wM, thickness - chamfer)
    s.lineTo(1000 * wM, 0)
    s.lineTo(0, 0)
    // shape в плоскости XY: X — ширина листа (wM), Y — толщина 12.5мм;
    // extrude вдоль Z даёт длину dM — без дополнительного поворота, чтобы
    // не путать местами X/Z листа относительно bbox комнаты.
    const g = new THREE.ExtrudeGeometry(s, { depth: 1000 * dM, bevelEnabled: false, curveSegments: 1 })
    g.scale(0.001, 0.001, 0.001)
    return g
  }, [wM, dM])

  return (
    <mesh
      geometry={geo}
      material={gklMat}
      position={[bbox.minX, y, bbox.minZ]}
      receiveShadow
      castShadow
    />
  )
}
