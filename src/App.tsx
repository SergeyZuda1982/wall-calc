import { useState } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Arrow } from 'react-konva'
import type { WallInput } from './types'
import { PROFILES } from './data/profiles'
import { useWallCalc, CANVAS_W, PAD } from './hooks/useWallCalc'

const DEFAULT_INPUT: WallInput = {
  wallType: 'c111',
  profileType: 'ps50',
  profileThickness: '06',
  abutment: 'both',
  length: 6160,
  height: 3600,
  step: 600,
  firstStud: 600,
  doorPos: 0,
  doorWidth: 0,
  doorHeight: 0,
}

export default function App() {
  const [form, setForm] = useState(DEFAULT_INPUT)
  const {
    positions, snap, result, heightWarning, profileWidth,
    calculate, onDragEnd, addStud, removeStud,
  } = useWallCalc()

  function set<K extends keyof WallInput>(key: K, value: WallInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const { l, h, dw, dh, dp } = snap
  const scale = l > 0 ? (CANVAS_W - PAD * 2) / l : 1
  const canvasH = l > 0 ? h * scale + PAD * 2 + 50 : 300
  const studW = Math.max(profileWidth * scale, 4)
  const tx = (mm: number) => PAD + mm * scale
  const ty = (mm: number) => PAD + mm * scale
  const gklLayers = form.wallType === 'c112' ? 2 : 1

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 900 }}>
      <h1>Калькулятор перегородки</h1>

      {/* ─── Строка 1: тип, толщина, профиль, примыкание ─── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={{ fontSize: 13 }}>Тип перегородки</label><br />
          <select value={form.wallType}
            onChange={e => set('wallType', e.target.value as WallInput['wallType'])}
            style={{ width: '100%', padding: 7 }}>
            <option value="c111">С111 — 1 слой ГКЛ</option>
            <option value="c112">С112 — 2 слоя ГКЛ</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={{ fontSize: 13 }}>Толщина профиля</label><br />
          <select value={form.profileThickness}
            onChange={e => set('profileThickness', e.target.value as WallInput['profileThickness'])}
            style={{ width: '100%', padding: 7 }}>
            <option value="06">0.6 мм (стандарт)</option>
            <option value="07">0.7 мм (усиленный)</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 13 }}>Тип профиля</label><br />
          <select value={form.profileType}
            onChange={e => set('profileType', e.target.value as WallInput['profileType'])}
            style={{ width: '100%', padding: 7 }}>
            {PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 13 }}>Примыкание</label><br />
          <select value={form.abutment}
            onChange={e => set('abutment', e.target.value as WallInput['abutment'])}
            style={{ width: '100%', padding: 7 }}>
            <option value="both">Стена — Стена</option>
            <option value="left">Стена — Свободно</option>
            <option value="right">Свободно — Стена</option>
            <option value="none">Отдельностоящая</option>
          </select>
        </div>
      </div>

      {/* ─── Строка 2: шаг, первая стойка, длина, высота ─── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label style={{ fontSize: 13 }}>Шаг (мм)</label><br />
          <select value={form.step}
            onChange={e => {
              const s = Number(e.target.value)
              setForm(prev => ({ ...prev, step: s, firstStud: s }))
            }}
            style={{ width: '100%', padding: 7 }}>
            <option value={600}>600</option>
            <option value={400}>400</option>
            <option value={300}>300</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Первая стойка (мм)</label><br />
          <input type="number" value={form.firstStud}
            onChange={e => set('firstStud', Number(e.target.value))}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Длина (мм)</label><br />
          <input type="number" value={form.length}
            onChange={e => set('length', Number(e.target.value))}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Высота (мм)</label><br />
          <input type="number" value={form.height}
            onChange={e => set('height', Number(e.target.value))}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
      </div>

      {/* ─── Строка 3: проём ─── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Начало проёма (мм)</label><br />
          <input type="number" value={form.doorPos || ''}
            onChange={e => set('doorPos', Number(e.target.value))}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Ширина проёма (мм)</label><br />
          <input type="number" value={form.doorWidth || ''}
            onChange={e => set('doorWidth', Number(e.target.value))}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Высота проёма (мм)</label><br />
          <input type="number" value={form.doorHeight || ''}
            onChange={e => set('doorHeight', Number(e.target.value))}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
      </div>

      <button onClick={() => calculate(form)}
        style={{ padding: '10px 32px', fontSize: 15, cursor: 'pointer', marginBottom: 20 }}>
        Рассчитать
      </button>

      {/* ─── Предупреждение высоты ─── */}
      {heightWarning && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffc107',
          padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {heightWarning}
        </div>
      )}

      {/* ─── Чертёж ─── */}
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

                {/* размерные стрелки */}
                <Arrow points={[tx(0), PAD - 22, tx(l), PAD - 22]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Arrow points={[tx(l), PAD - 22, tx(0), PAD - 22]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Text x={tx(l / 2) - 25} y={PAD - 34} text={`${l} мм`} fontSize={11} fill="#444" />

                <Arrow points={[PAD - 22, ty(0) + 8, PAD - 22, ty(h) - 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Arrow points={[PAD - 22, ty(h) - 8, PAD - 22, ty(0) + 8]} stroke="#666" fill="#666" strokeWidth={1} pointerLength={6} pointerWidth={4} />
                <Text x={8} y={ty(h / 2)} text={`${h}`} fontSize={11} fill="#444" rotation={-90} />

                {/* направляющие */}
                <Rect x={tx(0)} y={ty(0)} width={l * scale} height={8} fill="#444" />
                {dw > 0 ? (
                  <>
                    <Rect x={tx(0)}       y={ty(h) - 8} width={dp * scale}           height={8} fill="#444" />
                    <Rect x={tx(dp + dw)} y={ty(h) - 8} width={(l - dp - dw) * scale} height={8} fill="#444" />
                  </>
                ) : (
                  <Rect x={tx(0)} y={ty(h) - 8} width={l * scale} height={8} fill="#444" />
                )}

                {/* проём */}
                {dw > 0 && <>
                  <Rect x={tx(dp)} y={ty(h) - dh * scale} width={dw * scale} height={dh * scale}
                    fill="#ddeeff" stroke="#88aacc" strokeWidth={1} />
                  <Rect x={tx(dp) - 10} y={ty(h) - dh * scale - 6} width={dw * scale + 20} height={6} fill="#666" />
                  <Text x={tx(dp) + dw * scale / 2 - 20} y={ty(h) - dh * scale / 2 - 6}
                    text={`${dw}×${dh}`} fontSize={11} fill="#336" />
                </>}

                {/* стойки */}
                {positions.map((pos) => {
                  const isFixed = pos === 0 || pos === l || pos === dp || pos === dp + dw
                  const isAbove = dw > 0 && pos > dp && pos < dp + dw
                  const sH = isAbove ? (h - dh) * scale - 6 : (h - 16) * scale
                  const sY = isAbove ? ty(h) - dh * scale - sH - 6 : ty(0) + 8
                  return (
                    <Group key={`s${pos}`} x={tx(pos) - studW / 2} y={0}
                      draggable={!isFixed}
                      dragBoundFunc={p => ({ x: p.x, y: 0 })}
                      onDragEnd={e => onDragEnd(pos, e.target.x() + studW / 2)}
                      onDblClick={() => removeStud(pos)}>
                      <Rect x={0} y={sY} width={studW} height={sH}
                        fill={isFixed ? '#3a7bd5' : '#6aaee8'}
                        stroke="#1a4fa0" strokeWidth={1} cornerRadius={2} />
                    </Group>
                  )
                })}

                {/* размерная цепочка */}
                {positions.map((pos, i) => {
                  if (i === 0) return null
                  const prev = positions[i - 1]
                  const dist = pos - prev
                  const mx = tx(prev) + (dist * scale) / 2
                  const dimY = ty(h) + 12
                  return (
                    <Group key={`d${pos}`}>
                      <Line points={[tx(prev), dimY, tx(pos), dimY]} stroke="#aaa" strokeWidth={1} />
                      <Line points={[tx(prev), dimY - 4, tx(prev), dimY + 4]} stroke="#aaa" strokeWidth={1} />
                      <Line points={[tx(pos),  dimY - 4, tx(pos),  dimY + 4]} stroke="#aaa" strokeWidth={1} />
                      <Text x={mx - 12} y={dimY + 5} text={`${dist}`} fontSize={10} fill="#555" />
                    </Group>
                  )
                })}
              </Layer>
            </Stage>
          </div>
        </>
      )}

      {/* ─── Результаты ─── */}
      {result && (
        <div style={{ marginTop: 20, background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>Результат</h2>
          <p style={{ color: '#666', fontSize: 13 }}>
            {form.wallType.toUpperCase()} · {gklLayers} слой ГКЛ · профиль {form.profileThickness === '06' ? '0.6' : '0.7'}мм
          </p>
          {result.needsOverlap && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107',
              padding: 10, borderRadius: 6, marginBottom: 12 }}>
              ⚠️ Высота {form.height} мм — промежуточные стойки наращиваются с перехлёстом
            </div>
          )}
          <p>ПН пол: <b>{result.uwFloor.toFixed(2)} м</b></p>
          <p>ПН потолок: <b>{result.uwCeiling.toFixed(2)} м</b></p>
          {result.lintel > 0 && <p>Перемычка над проёмом (ПН): <b>{result.lintel.toFixed(2)} м</b></p>}
          <p>Стоечный ПС: <b>{result.cwTotal.toFixed(2)} м</b></p>
          <p>Стоек всего: <b>{result.studsCount} шт</b></p>
          {result.aboveStuds > 0 &&
            <p>Над проёмом: <b>{result.aboveStuds} шт</b> (высота {result.aboveStudHeight} мм)</p>}
          <p>ГКЛ ({gklLayers} сл.): <b>{result.gklArea.toFixed(2)} м²</b></p>
        </div>
      )}
    </div>
  )
}
