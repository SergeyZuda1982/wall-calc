/**
 * ArcView3D.tsx — 3D-вид наклонной цилиндрической поверхности (27.10.2026).
 *
 * Показывает поверхность между верхней и нижней кромкой (с просадкой нижней у
 * краёв), обе кромки цветом, стойки с заданным шагом. Геометрия — из
 * core/inclinedArc3D.ts. Подгружается лениво из вкладки «Разметка дуги».
 */

import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Line } from '@react-three/drei'
import * as THREE from 'three'
import { buildInclinedSurface3D } from '../core/inclinedArc3D'
import type { InclinedInput } from '../core/calcInclinedArc'

type View = 'below' | 'side' | 'top'

const toPts = (a: Float32Array): [number, number, number][] => {
  const out: [number, number, number][] = []
  for (let i = 0; i < a.length; i += 3) out.push([a[i], a[i + 1], a[i + 2]])
  return out
}

const btn = (on: boolean): React.CSSProperties => ({
  padding: '5px 10px', fontSize: 12.5, borderRadius: 6, cursor: 'pointer',
  border: `1px solid ${on ? '#2563eb' : '#dde1e8'}`, background: on ? '#eff6ff' : '#fff',
  color: on ? '#2563eb' : '#111827', fontWeight: on ? 600 : 400,
})

export default function ArcView3D({ input }: { input: InclinedInput }) {
  const [view, setView] = useState<View>('below')
  const [showStuds, setShowStuds] = useState(true)
  const [wire, setWire] = useState(false)
  const surf = useMemo(() => buildInclinedSurface3D(input, { studStep: 400 }), [input])

  const geo = useMemo(() => {
    if (!surf) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(surf.positions, 3))
    g.setIndex(new THREE.BufferAttribute(surf.indices, 1))
    g.computeVertexNormals()
    return g
  }, [surf])
  const studGeo = useMemo(() => {
    if (!surf) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(surf.studs, 3))
    return g
  }, [surf])
  const top = useMemo(() => (surf ? toPts(surf.topEdge) : []), [surf])
  const bottom = useMemo(() => (surf ? toPts(surf.bottomEdge) : []), [surf])

  if (!surf || !geo || !studGeo) return <div style={{ color: '#6b7280', fontSize: 13 }}>Нет данных для 3D.</div>
  const [w, h, z] = surf.size
  const cam: Record<View, { pos: [number, number, number]; target: [number, number, number] }> = {
    below: { pos: [0, -(h + 4), z + w * 0.7], target: [0, -h / 2, z / 2] },
    side: { pos: [w * 0.9, -h / 2, z / 2 + 2], target: [0, -h / 2, z / 2] },
    top: { pos: [0, w * 0.9, z / 2 + 0.1], target: [0, 0, z / 2] },
  }
  const c = cam[view]

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <button style={btn(view === 'below')} onClick={() => setView('below')}>Из зала</button>
        <button style={btn(view === 'side')} onClick={() => setView('side')}>Сбоку</button>
        <button style={btn(view === 'top')} onClick={() => setView('top')}>Сверху (план)</button>
        <button style={btn(showStuds)} onClick={() => setShowStuds(v => !v)}>Стойки</button>
        <button style={btn(wire)} onClick={() => setWire(v => !v)}>Сетка</button>
      </div>
      <div style={{ height: 420, border: '1px solid #dde1e8', borderRadius: 8, overflow: 'hidden', background: '#f8fafc' }}>
        <Canvas key={view} camera={{ position: c.pos, fov: 40, near: 0.1, far: 300 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[6, -10, 20]} intensity={1.1} />
          <directionalLight position={[-6, 10, -10]} intensity={0.5} />
          <mesh geometry={geo}>
            <meshStandardMaterial color="#dbe4f0" side={THREE.DoubleSide} roughness={0.9} wireframe={wire} />
          </mesh>
          {showStuds && (
            <lineSegments geometry={studGeo}>
              <lineBasicMaterial color="#6b7280" />
            </lineSegments>
          )}
          <Line points={top} color="#1d4ed8" lineWidth={3} />
          <Line points={bottom} color="#dc2626" lineWidth={3} />
          <OrbitControls target={c.target} makeDefault />
        </Canvas>
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
        <span style={{ color: '#1d4ed8', fontWeight: 600 }}>Верхняя кромка</span> (у парапета),{' '}
        <span style={{ color: '#dc2626', fontWeight: 600 }}>нижняя кромка</span>, серые линии — стойки с шагом 400 мм
        ({surf.studCount} шт.). Габариты: {w.toFixed(2)} × {h.toFixed(2)} × {z.toFixed(2)} м. Мышью: вращение, колесо — масштаб.
      </div>
    </div>
  )
}
