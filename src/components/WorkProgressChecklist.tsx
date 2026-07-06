/**
 * WorkProgressChecklist.tsx — UI для одной поверхности (сторона линии,
 * само строительство конструкции и т.п.): применить/сохранить шаблон
 * + список этапов с подтверждением (✓) / отклонением (✗ + причина).
 *
 * Ничего не знает про PlanLine конкретно — принимает WorkProgress | undefined
 * и отдаёт наружу новый WorkProgress через onChange. Вызывающий код
 * (FloorPlan.tsx) сам решает, в какое поле линии это записать
 * (buildProgress / finishProgressA / finishProgressB).
 */

import { useState } from 'react'
import type { WorkProgress, WorkStageTemplate, StepRejectReason } from '../types'
import { STEP_REJECT_REASON_LABEL } from '../types'
import {
  createWorkProgress,
  applyTemplate,
  saveAsTemplate,
  confirmStep,
  rejectStep,
  resetStep,
  progressPercent,
} from '../core/workProgress'

interface Props {
  label: string
  progress: WorkProgress | undefined
  templates: WorkStageTemplate[]
  onChange: (next: WorkProgress) => void
  onSaveTemplate: (template: WorkStageTemplate) => void
}

const REASONS: StepRejectReason[] = ['waiting_materials', 'waiting_trades', 'changes', 'other']

export function WorkProgressChecklist({ label, progress, templates, onChange, onSaveTemplate }: Props) {
  const [pickedTemplateId, setPickedTemplateId] = useState('')

  if (!progress || progress.steps.length === 0) {
    return (
      <div style={{ marginBottom: 8, padding: '8px 8px', background: '#fafbfc', borderRadius: 5, border: '1px solid #eee' }}>
        <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>{label}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={pickedTemplateId}
            onChange={e => setPickedTemplateId(e.target.value)}
            style={{ flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 5, border: '1px solid #ddd' }}>
            <option value="">Выбрать шаблон этапов...</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button
            disabled={!pickedTemplateId}
            onClick={() => {
              const tpl = templates.find(t => t.id === pickedTemplateId)
              if (tpl) onChange(applyTemplate(tpl))
            }}
            style={{
              fontSize: 11, padding: '5px 10px', borderRadius: 5, border: '1px solid #3a7bd5',
              background: pickedTemplateId ? '#3a7bd5' : '#ccc', color: '#fff', cursor: pickedTemplateId ? 'pointer' : 'default',
            }}>
            Применить
          </button>
        </div>
        <button
          onClick={() => onChange(createWorkProgress([{ id: `s${Date.now()}`, label: 'Этап 1' }]))}
          style={{ marginTop: 6, fontSize: 10, color: '#3a7bd5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          + начать свой список с нуля
        </button>
      </div>
    )
  }

  const pct = progressPercent(progress)

  return (
    <div style={{ marginBottom: 8, padding: '8px 8px', background: '#fafbfc', borderRadius: 5, border: '1px solid #eee' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#555' }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: pct === 100 ? '#43a047' : '#666' }}>{pct}%</span>
      </div>

      {progress.steps.map((step, i) => (
        <div key={step.stepId} style={{ marginBottom: 4, padding: '4px 6px', borderRadius: 4, background: step.outcome === 'rejected' ? '#fff3f2' : '#fff', border: '1px solid #eee' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 12, flex: 1,
              color: step.outcome === 'confirmed' ? '#43a047' : step.outcome === 'rejected' ? '#e53935' : '#333',
              textDecoration: step.outcome === 'confirmed' ? 'line-through' : 'none',
            }}>
              {i + 1}. {step.label}
            </span>
            <button
              title="Подтвердить"
              onClick={() => onChange(confirmStep(progress, i))}
              style={{
                width: 26, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 13,
                border: step.outcome === 'confirmed' ? '1.5px solid #43a047' : '1px solid #ddd',
                background: step.outcome === 'confirmed' ? '#43a047' : '#fff',
                color: step.outcome === 'confirmed' ? '#fff' : '#43a047',
              }}>✓</button>
            <button
              title="Отклонить"
              onClick={() => onChange(rejectStep(progress, i, 'waiting_materials'))}
              style={{
                width: 26, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 13,
                border: step.outcome === 'rejected' ? '1.5px solid #e53935' : '1px solid #ddd',
                background: step.outcome === 'rejected' ? '#e53935' : '#fff',
                color: step.outcome === 'rejected' ? '#fff' : '#e53935',
              }}>✗</button>
            {step.outcome !== 'pending' && (
              <button title="Сбросить" onClick={() => onChange(resetStep(progress, i))}
                style={{ width: 22, height: 22, borderRadius: 4, cursor: 'pointer', fontSize: 11, border: '1px solid #ddd', background: '#fff', color: '#999' }}>
                ↺
              </button>
            )}
          </div>
          {step.outcome === 'rejected' && (
            <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={step.rejectReason ?? 'waiting_materials'}
                onChange={e => onChange(rejectStep(progress, i, e.target.value as StepRejectReason, step.rejectNote))}
                style={{ fontSize: 10, padding: '3px 4px', borderRadius: 4, border: '1px solid #f0b8b4' }}>
                {REASONS.map(r => <option key={r} value={r}>{STEP_REJECT_REASON_LABEL[r]}</option>)}
              </select>
              {step.rejectReason === 'other' && (
                <input type="text" placeholder="своя причина" value={step.rejectNote ?? ''}
                  onChange={e => onChange(rejectStep(progress, i, 'other', e.target.value))}
                  style={{ fontSize: 10, padding: '3px 4px', borderRadius: 4, border: '1px solid #f0b8b4', flex: 1, minWidth: 80 }} />
              )}
            </div>
          )}
        </div>
      ))}

      <button
        onClick={() => {
          const name = window.prompt('Название шаблона:', progress.sourceTemplateLabel ?? '')
          if (name) onSaveTemplate(saveAsTemplate(progress, `custom_${Date.now()}`, name))
        }}
        style={{ marginTop: 4, fontSize: 10, color: '#3a7bd5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        Сохранить как шаблон
      </button>
    </div>
  )
}
