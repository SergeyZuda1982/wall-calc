import { useState } from 'react'
import type { LiningInput, LiningResult } from './types'
import { calcLining } from './core/calcLining'
import { useProjectStore } from './store/useProjectStore'

const DEFAULT_INPUT: LiningInput = {
  liningType: 'c623',
  profileType: 'ps50',
  profileThickness: '06',
  gklLayers: 1,
  length: 3000,
  height: 2800,
  step: 600,
  hangerStep: 1000,
  abutment: 'both',
  doorPos: 0,
  doorWidth: 0,
  doorHeight: 0,
}

export default function LiningCalc() {
  const [form, setForm] = useState<LiningInput>(DEFAULT_INPUT)
  const [result, setResult] = useState<LiningResult | null>(null)
  const {
    linings, activeLiningId,
    addLining, updateLining, removeLining, setActiveLining,
  } = useProjectStore()

  function set<K extends keyof LiningInput>(key: K, value: LiningInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function calculate() {
    const res = calcLining(form)
    setResult(res)
  }

  const isC623 = form.liningType === 'c623'

  return (
    <div>
      {/* ─── Список облицовок ─── */}
      {linings.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={activeLiningId ?? ''}
            onChange={e => {
              const id = e.target.value
              if (!id) return
              const l = linings.find(l => l.id === id)
              if (l) { setActiveLining(l.id); setForm(l.input); setResult(l.result) }
            }}
            style={{ flex: 1, padding: '6px 8px', fontSize: 13,
              border: '1px solid #ccc', borderRadius: 4 }}>
            <option value="">— Выберите облицовку —</option>
            {linings.map(l => (
              <option key={l.id} value={l.id}>
                {l.label} · {l.input.length}×{l.input.height} · {l.input.liningType.toUpperCase()}
              </option>
            ))}
          </select>
          {activeLiningId && (
            <button onClick={() => { if (window.confirm('Удалить облицовку?')) removeLining(activeLiningId) }}
              style={{ padding: '5px 10px', fontSize: 13, cursor: 'pointer',
                background: '#fff', border: '1px solid #e05', color: '#e05', borderRadius: 4 }}>
              🗑
            </button>
          )}
        </div>
      )}

      {/* ─── Строка 1: тип облицовки, слои ГКЛ ─── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label style={{ fontSize: 13 }}>Тип облицовки</label><br />
          <select value={form.liningType}
            onChange={e => set('liningType', e.target.value as LiningInput['liningType'])}
            style={{ width: '100%', padding: 7 }}>
            <option value="c623">С623 — ПП 60×27 на подвесах</option>
            <option value="c625">С625 — ПС на стойках (без утеплителя)</option>
            <option value="c626">С626 — ПС на стойках (с утеплителем)</option>
          </select>
        </div>
        {!isC623 && (
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ fontSize: 13 }}>Тип профиля</label><br />
            <select value={form.profileType}
              onChange={e => set('profileType', e.target.value as LiningInput['profileType'])}
              style={{ width: '100%', padding: 7 }}>
              <option value="ps50">ПС 50×50</option>
              <option value="ps75">ПС 75×50</option>
              <option value="ps100">ПС 100×50</option>
            </select>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 13 }}>Слоёв ГКЛ</label><br />
          <select value={form.gklLayers}
            onChange={e => set('gklLayers', Number(e.target.value) as 1 | 2)}
            style={{ width: '100%', padding: 7 }}>
            <option value={1}>1 слой</option>
            <option value={2}>2 слоя</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={{ fontSize: 13 }}>Примыкание</label><br />
          <select value={form.abutment}
            onChange={e => set('abutment', e.target.value as LiningInput['abutment'])}
            style={{ width: '100%', padding: 7 }}>
            <option value="both">Стена — Стена</option>
            <option value="left">Стена — Свободно</option>
            <option value="right">Свободно — Стена</option>
            <option value="none">Без боковых</option>
          </select>
        </div>
      </div>

      {/* ─── Строка 2: размеры и шаг ─── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label style={{ fontSize: 13 }}>Шаг стоек (мм)</label><br />
          <select value={form.step}
            onChange={e => set('step', Number(e.target.value))}
            style={{ width: '100%', padding: 7 }}>
            <option value={600}>600</option>
            <option value={400}>400</option>
            <option value={300}>300</option>
          </select>
        </div>
        {isC623 && (
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 13 }}>Шаг подвесов (мм)</label><br />
            <select value={form.hangerStep}
              onChange={e => set('hangerStep', Number(e.target.value))}
              style={{ width: '100%', padding: 7 }}>
              {[500,600,700,800,900,1000,1100,1200,1300,1400,1500].map(v => (
                <option key={v} value={v}>{v}{v === 1000 ? ' (норма)' : ''}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Длина (мм)</label><br />
          <input type="number" value={form.length || ''}
            onChange={e => set('length', Number(e.target.value))}
            style={{ width: '100%', padding: 7, marginTop: 2 }} />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ fontSize: 13 }}>Высота (мм)</label><br />
          <input type="number" value={form.height || ''}
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

      {/* ─── Кнопки ─── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {linings.length > 0 && (
          <button onClick={() => { setActiveLining(null); setForm(DEFAULT_INPUT); setResult(null) }}
            style={{ padding: '10px 20px', fontSize: 15, cursor: 'pointer',
              background: '#fff', border: '1px solid #aaa', borderRadius: 4 }}>
            + Новая
          </button>
        )}
        <button onClick={calculate}
          style={{ padding: '10px 32px', fontSize: 15, cursor: 'pointer',
            background: '#f0f0f0', border: '1px solid #ccc', borderRadius: 4, flex: 1 }}>
          Рассчитать
        </button>
        <button
          onClick={() => {
            if (result) {
              if (activeLiningId) updateLining(activeLiningId, form, result)
              else addLining(form, result)
            }
          }}
          disabled={!result}
          style={{ padding: '10px 20px', fontSize: 15,
            cursor: result ? 'pointer' : 'default',
            background: result ? '#3a7bd5' : '#ccc',
            color: '#fff', border: 'none', borderRadius: 4, whiteSpace: 'nowrap' }}>
          {activeLiningId ? '💾 Обновить' : '➕ В объект'}
        </button>
      </div>

      {/* ─── Результат ─── */}
      {result && (
        <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Результат</h3>
          <p style={{ color: '#666', fontSize: 13 }}>
            {form.liningType.toUpperCase()} · {form.gklLayers} сл. ГКЛ
            {isC623 ? ' · ПП 60×27' : ` · ПС ${form.profileType === 'ps50' ? '50' : form.profileType === 'ps75' ? '75' : '100'}×50`}
          </p>
          {result.needsOverlap && (
            <div style={{ background: '#fff3cd', border: '1px solid #ffc107',
              padding: 10, borderRadius: 6, marginBottom: 12 }}>
              ⚠️ Высота {form.height}мм — стойки наращиваются
              {isC623 ? ` (удлинители: ${result.extenders} шт)` : ' с перехлёстом'}
            </div>
          )}
          <p>ПН {isC623 ? '28×27' : `${form.profileType === 'ps50' ? '50' : form.profileType === 'ps75' ? '75' : '100'}×40`}: <b>{result.guideRail.toFixed(2)} м</b></p>
          <p>{isC623 ? 'ПП 60×27' : `ПС ${form.profileType === 'ps50' ? '50' : form.profileType === 'ps75' ? '75' : '100'}×50`}: <b>{result.stud.toFixed(2)} м</b></p>
          <p>Стоек: <b>{result.studsCount} шт</b></p>
          {isC623 && <>
            <p>Прямые подвесы: <b>{result.hangers} шт</b></p>
            {result.extenders > 0 && <p>Удлинители профиля: <b>{result.extenders} шт</b></p>}
          </>}
          <p>ГКЛ ({form.gklLayers} сл.): <b>{result.gklArea.toFixed(2)} м²</b></p>
        </div>
      )}
    </div>
  )
}
