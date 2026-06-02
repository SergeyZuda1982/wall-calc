import { useState, useRef } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Arrow } from 'react-konva'

const PROFILES = [
  { label: 'ПС 50×50', value: 'ps50', overlap: 500, width: 50 },
  { label: 'ПС 75×50', value: 'ps75', overlap: 750, width: 75 },
  { label: 'ПС 100×50', value: 'ps100', overlap: 1000, width: 100 },
]

// Таблица максимальных высот по Кнауф
// [тип, профиль, шаг, толщина профиля] -> макс высота в мм
const MAX_HEIGHT: Record<string, number> = {
  'c111_ps50_600_06': 3000, 'c111_ps50_600_07': 3500,
  'c111_ps50_400_06': 3850, 'c111_ps50_400_07': 4200,
  'c111_ps50_300_06': 4250, 'c111_ps50_300_07': 5000,
  'c111_ps75_600_06': 4000, 'c111_ps75_600_07': 4750,
  'c111_ps75_400_06': 5000, 'c111_ps75_400_07': 6000,
  'c111_ps75_300_06': 6000, 'c111_ps75_300_07': 7000,
  'c111_ps100_600_06': 5000, 'c111_ps100_600_07': 6000,
  'c111_ps100_400_06': 6000, 'c111_ps100_400_07': 7000,
  'c111_ps100_300_06': 7000, 'c111_ps100_300_07': 8000,
  'c112_ps50_600_06': 4000, 'c112_ps50_600_07': 4500,
  'c112_ps50_400_06': 5000, 'c112_ps50_400_07': 5500,
  'c112_ps50_300_06': 5750, 'c112_ps50_300_07': 6250,
  'c112_ps75_600_06': 5000, 'c112_ps75_600_07': 6000,
  'c112_ps75_400_06': 6000, 'c112_ps75_400_07': 7000,
  'c112_ps75_300_06': 7000, 'c112_ps75_300_07': 8000,
  'c112_ps100_600_06': 6500, 'c112_ps100_600_07': 7500,
  'c112_ps100_400_06': 7500, 'c112_ps100_400_07': 8500,
  'c112_ps100_300_06': 8500, 'c112_ps100_300_07': 9500,
}

function getMaxHeight(wallType: string, profile: string, step: number, thickness: string): number {
  const key = `${wallType}_${profile}_${step}_${thickness}`
  return MAX_HEIGHT[key] || 0
}

const STUD_LENGTH = 3000
const CANVAS_W = 820
const PAD = 60

type StudKind = 'wall' | 'free' | 'middle'

function calcStudMaterial(h: number, kind: StudKind, overlap: number) {
  if (h <= STUD_LENGTH) return h
  if (kind === 'wall') return h
  if (kind === 'middle') return h + overlap
  const part2 = h - STUD_LENGTH
  const up = part2 >= overlap ? overlap : 500
  return STUD_LENGTH + part2 + overlap + up
}

function buildPositions(l: number, s: number, first: number, dp: number, dw: number) {
  const pos: number[] = [0]
  if (dw > 0) {
    pos.push(dp, dp + dw)
    let p = dp - s; while (p > 0) { pos.push(p); p -= s }
    p = dp + dw + s; while (p < l) { pos.push(p); p += s }
  } else {
    let p = first; while (p < l) { pos.push(p); p += s }
  }
  pos.push(l)
  return [...new Set(pos)].sort((a, b) => a - b)
}

function calcResults(
  positions: number[], h: number, l: number,
  dw: number, dh: number, dp: number,
  abutment: string, overlap: number
) {
  let cwTotal = 0, aboveStuds = 0
  const aboveH = h - dh
  for (const p of positions) {
    let kind: StudKind = 'middle'
    if (p === 0) kind = abutment === 'both' || abutment === 'left' ? 'wall' : 'free'
    if (p === l) kind = abutment === 'both' || abutment === 'right' ? 'wall' : 'free'
    if (dw > 0 && p > dp && p < dp + dw) { cwTotal += aboveH; aboveStuds++ }
    else cwTotal += calcStudMaterial(h, kind, overlap)
  }
  return {
    uwFloor: dw > 0 ? (l - dw) / 1000 : l / 1000,
    uwCeiling: l / 1000,
    lintel: dw > 0 ? (dw + 400) / 1000 : 0,
    cwTotal: cwTotal / 1000,
    studsCount: positions.length,
    aboveStuds, aboveStudHeight: aboveH,
    gklArea: (l * h * 2) / 1000000,
    needsOverlap: h > STUD_LENGTH
  }
}

export default function App() {
  const [wallType, setWallType] = useState('c111')
  const [profileThickness, setProfileThickness] = useState('06')
  const [length, setLength] = useState('6160')
  const [height, setHeight] = useState('3600')
  const [step, setStep] = useState('600')
  const [firstStud, setFirstStud] = useState('600')
  const [profileType, setProfileType] = useState('ps50')
  const [abutment, setAbutment] = useState('both')
  const [doorWidth, setDoorWidth] = useState('')
  const [doorHeight, setDoorHeight] = useState('')
  const [doorPos, setDoorPos] = useState('')

  const [positions, setPositions] = useState<number[]>([])
  const [snap, setSnap] = useState({ l: 0, h: 0, dw: 0, dh: 0, dp: 0 })
  const [result, setResult] = useState<any>(null)
  const [heightWarning, setHeightWarning] = useState<string | null>(null)
  const profileRef = useRef(PROFILES[0])

  function go(pos?: number[]) {
    const l = parseFloat(length), h = parseFloat(height), s = parseFloat(step)
    const fs = parseFloat(firstStud) || s
    const dw = parseFloat(doorWidth) || 0
    const dh = parseFloat(doorHeight) || 0
    const dp = parseFloat(doorPos) || 0
    if (!l || !h || !s) return

    const profile = PROFILES.find(p => p.value === profileType)!
    profileRef.current = profile

    // Проверка максимальной высоты
    const maxH = getMaxHeight(wallType, profileType, s, profileThickness)
    if (maxH > 0 && h > maxH) {
      setHeightWarning(
        `⚠️ Высота ${(h/1000).toFixed(2)}м превышает максимально допустимую ${(maxH/1000).toFixed(2)}м ` +
        `по Кнауф для ${profileType.toUpperCase()}, шаг ${s}мм, профиль ${profileThickness === '06' ? '0.6' : '0.7'}мм. ` +
        `Уменьшите шаг или возьмите профиль большего размера.`
      )
    } else {
      setHeightWarning(null)
    }

    const studs = pos || buildPositions(l, s, fs, dp, dw)
    setPositions(studs)
    setSnap({ l, h, dw, dh, dp })
    setResult(calcResults(studs, h, l, dw, dh, dp, abutment, profile.overlap))
  }

  function update(next: number[]) {
    const { l, h, dw, dh, dp } = snap
    setPositions(next)
    setResult(calcResults(next, h, l, dw, dh, dp, abutment, profileRef.current.overlap))
  }

  function onDragEnd(i: number, xpx: number) {
    const sc = (CANVAS_W - PAD * 2) / snap.l
    const mm = Math.round((xpx - PAD) / sc / 100) * 100
    const clamped = Math.max(0, Math.min(snap.l, mm))
    const delta = clamped - positions[i]
    const next = positions.map((p) => {
      if (p === 0 || p === snap.l) return p
      if (p === snap.dp || p === snap.dp + snap.dw) return p
      return Math.max(1, Math.min(snap.l - 1, p + delta))
    })
    update([...new Set(next)].sort((a, b) => a - b))
  }

  function addStud(xpx: number) {
    if (!snap.l) return
    const sc = (CANVAS_W - PAD * 2) / snap.l
    const mm = Math.round((xpx - PAD) / sc / 100) * 100
    if (mm <= 0 || mm >= snap.l) return
    update([...new Set([...positions, mm])].sort((a, b) => a - b))
  }

  function removeStud(i: number) {
    const pos = positions[i]
    const { l, dp, dw } = snap
    if (pos === 0 || pos === l || pos === dp || pos === dp + dw) return
    update(positions.filter((_, idx) => idx !== i))
  }

  const { l, h, dw, dh, dp } = snap
  const scale = l > 0 ? (CANVAS_W - PAD * 2) / l : 1
  const canvasH = l > 0 ? h * scale + PAD * 2 + 50 : 300
  const studW = Math.max(profileRef.current.width * scale, 4)
  const tx = (mm: number) => PAD + mm * scale
  const ty = (mm: number) => PAD + mm * scale

  const gklLayers = wallType === 'c112' ? 2 : 1

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 900 }}>
      <h1>Калькулятор перегородки</h1>

      {/* Тип перегородки */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={{ fontSize: 13 }}>Тип перегородки</label><br />
          <select value={wallType} onChange={e => setWallType(e.target.value)}
            style={{ width: '100%', padding: 7 }}>
            <option value="c111">С111 — 1 слой ГКЛ</option>
            <option value="c112">С112 — 2 слоя ГКЛ</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={{ fontSize: 13 }}>Толщина профиля</label><br />
          <select value={profileThickness} onChange={e => setProfileThickness(e.target.value)}
            style={{ width: '100%', padding: 7 }}>
            <option value="06">0.6 мм (стандарт)</option>
            <option value="07">0.7 мм (усиленный)</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 13 }}>Тип профиля</label><br />
          <select value={profileType} onChange={e => setProfileType(e.target.value)}
            style={{ width: '100%', padding: 7 }}>
            {PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 13 }}>Примыкание</label><br />
          <select value={abutment} onChange={e => setAbutment(e.target.value)}
            style={{ width: '100%', padding: 7 }}>
            <option value="both">Стена — Стена</option>
            <option value="left">Стена — Свободно</option>
            <option value="right">Свободно — Стена</option>
            <option value="none">Отдельностоящая</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label style={{ fontSize: 13 }}>Шаг (мм)</label><br />
          <select value={step} onChange={e => { setStep(e.target.value); setFirstStud(e.target.value) }}
            style={{ width: '100%', padding: 7 }}>
            <option value="600">600</option>
            <option value="400">400</option>
            <option value="300">300</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Первая стойка (мм)</label><br />
          <input type="number" value={firstStud} onChange={e => setFirstStud(e.target.value)}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Длина (мм)</label><br />
          <input type="number" value={length} onChange={e => setLength(e.target.value)}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Высота (мм)</label><br />
          <input type="number" value={height} onChange={e => setHeight(e.target.value)}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Начало проёма (мм)</label><br />
          <input type="number" value={doorPos} onChange={e => setDoorPos(e.target.value)}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Ширина проёма (мм)</label><br />
          <input type="number" value={doorWidth} onChange={e => setDoorWidth(e.target.value)}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Высота проёма (мм)</label><br />
          <input type="number" value={doorHeight} onChange={e => setDoorHeight(e.target.value)}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
      </div>

      <button onClick={() => go()}
        style={{ padding: '10px 32px', fontSize: 15, cursor: 'pointer', marginBottom: 20 }}>
        Рассчитать
      </button>

      {/* Предупреждение о высоте */}
      {heightWarning && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffc107',
          padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {heightWarning}
        </div>
      )}

      {l > 0 && (
        <>
          <p style={{ fontSize: 12, color: '#888', margin: '0 0 6px' }}>
            Тяните стойку для перемещения · Двойной клик на стойке — удалить · Двойной клик на пустом месте — добавить
          </p>
          <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
            <Stage width={CANVAS_W} height={canvasH}
              onDblClick={e => {
                const stage = e.target.getStage()
                if (e.target === stage) {
                  const pos = stage?.getPointerPosition()
                  if (pos) addStud(pos.x)
                }
              }}>
              <Layer>
                <Rect x={0} y={0} width={CANVAS_W} height={canvasH} fill="#f8f8f8" />

                <Arrow points={[tx(0), PAD - 22, tx(l), PAD - 22]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Arrow points={[tx(l), PAD - 22, tx(0), PAD - 22]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Text x={tx(l / 2) - 25} y={PAD - 34} text={`${l} мм`} fontSize={11} fill="#444" />

                <Arrow points={[PAD - 22, ty(0) + 8, PAD - 22, ty(h) - 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Arrow points={[PAD - 22, ty(h) - 8, PAD - 22, ty(0) + 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Text x={8} y={ty(h / 2)} text={`${h}`} fontSize={11} fill="#444" rotation={-90} />

                <Rect x={tx(0)} y={ty(0)} width={l * scale} height={8} fill="#444" />
                {dw > 0
                  ? <>
                    <Rect x={tx(0)} y={ty(h) - 8} width={dp * scale} height={8} fill="#444" />
                    <Rect x={tx(dp + dw)} y={ty(h) - 8} width={(l - dp - dw) * scale} height={8} fill="#444" />
                  </>
                  : <Rect x={tx(0)} y={ty(h) - 8} width={l * scale} height={8} fill="#444" />
                }

                {dw > 0 && <>
                  <Rect x={tx(dp)} y={ty(h) - dh * scale} width={dw * scale} height={dh * scale}
                    fill="#ddeeff" stroke="#88aacc" strokeWidth={1} />
                  <Rect x={tx(dp) - 10} y={ty(h) - dh * scale - 6} width={dw * scale + 20} height={6} fill="#666" />
                  <Text x={tx(dp) + dw * scale / 2 - 20} y={ty(h) - dh * scale / 2 - 6}
                    text={`${dw}×${dh}`} fontSize={11} fill="#336" />
                </>}

                {positions.map((pos, i) => {
                  const isFixed = pos === 0 || pos === l || pos === dp || pos === dp + dw
                  const isAbove = dw > 0 && pos > dp && pos < dp + dw
                  const sH = isAbove ? (h - dh) * scale - 6 : (h - 16) * scale
                  const sY = isAbove ? ty(h) - dh * scale - sH - 6 : ty(0) + 8
                  return (
                    <Group key={`s${i}`} x={tx(pos) - studW / 2} y={0}
                      draggable={!isFixed}
                      dragBoundFunc={p => ({ x: p.x, y: 0 })}
                      onDragEnd={e => onDragEnd(i, e.target.x() + studW / 2)}
                      onDblClick={() => removeStud(i)}>
                      <Rect x={0} y={sY} width={studW} height={sH}
                        fill={isFixed ? '#3a7bd5' : '#6aaee8'}
                        stroke="#1a4fa0" strokeWidth={1} cornerRadius={2} />
                    </Group>
                  )
                })}

                {positions.map((pos, i) => {
                  if (i === 0) return null
                  const prev = positions[i - 1]
                  const dist = pos - prev
                  const mx = tx(prev) + (dist * scale) / 2
                  const dimY = ty(h) + 12
                  return (
                    <Group key={`d${i}`}>
                      <Line points={[tx(prev), dimY, tx(pos), dimY]} stroke="#aaa" strokeWidth={1} />
                      <Line points={[tx(prev), dimY - 4, tx(prev), dimY + 4]} stroke="#aaa" strokeWidth={1} />
                      <Line points={[tx(pos), dimY - 4, tx(pos), dimY + 4]} stroke="#aaa" strokeWidth={1} />
                      <Text x={mx - 12} y={dimY + 5} text={`${dist}`} fontSize={10} fill="#555" />
                    </Group>
                  )
                })}
              </Layer>
            </Stage>
          </div>
        </>
      )}

      {result && (
        <div style={{ marginTop: 20, background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Результат</h2>
          <p style={{ color: '#666', fontSize: 13 }}>
            {wallType.toUpperCase()} · {gklLayers} слой ГКЛ · профиль {profileThickness === '06' ? '0.6' : '0.7'}мм
          </p>
          {result.needsOverlap && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: 10, borderRadius: 6, marginBottom: 12 }}>
              ⚠️ Высота {h} мм — промежуточные стойки наращиваются с перехлёстом
            </div>
          )}
          <p>ПН пол: <b>{result.uwFloor.toFixed(2)} м</b></p>
          <p>ПН потолок: <b>{result.uwCeiling.toFixed(2)} м</b></p>
          {result.lintel > 0 && <p>Перемычка над проёмом (ПН): <b>{result.lintel.toFixed(2)} м</b></p>}
          <p>Стоечный ПС: <b>{result.cwTotal.toFixed(2)} м</b></p>
          <p>Стоек всего: <b>{result.studsCount} шт</b></p>
          {result.aboveStuds > 0 && <p>Над проёмом: <b>{result.aboveStuds} шт</b> (высота {result.aboveStudHeight} мм)</p>}
          <p>ГКЛ ({gklLayers} сл.): <b>{result.gklArea.toFixed(2)} м²</b></p>
        </div>
      )}
    </div>
  )
}