import { describe, it, expect } from 'vitest'
import {
  createWorkProgress,
  applyTemplate,
  saveAsTemplate,
  currentStepIndex,
  currentStep,
  isNotStarted,
  isComplete,
  isBlocked,
  confirmStep,
  rejectStep,
  resetStep,
  progressPercent,
  aggregateProgressPercent,
} from '../workProgress'
import type { WorkStageTemplate } from '../../types'

const gklTemplate: WorkStageTemplate = {
  id: 'gkl_partition',
  label: 'Перегородка ГКЛ',
  steps: [
    { id: 's1', label: 'Разметка' },
    { id: 's2', label: 'Каркас' },
    { id: 's3', label: 'Зашивка стороны 1' },
    { id: 's4', label: 'Минвата' },
    { id: 's5', label: 'Зашивка стороны 2' },
  ],
}

describe('applyTemplate / createWorkProgress', () => {
  it('копирует шаги шаблона, все pending', () => {
    const p = applyTemplate(gklTemplate)
    expect(p.templateId).toBe('gkl_partition')
    expect(p.sourceTemplateLabel).toBe('Перегородка ГКЛ')
    expect(p.steps).toHaveLength(5)
    expect(p.steps.every(s => s.outcome === 'pending')).toBe(true)
    expect(p.steps[0]).toEqual({ stepId: 's1', label: 'Разметка', outcome: 'pending' })
  })

  it('createWorkProgress строит список с нуля, без templateId', () => {
    const p = createWorkProgress([{ id: 'a', label: 'Свой шаг' }])
    expect(p.templateId).toBeUndefined()
    expect(p.steps).toEqual([{ stepId: 'a', label: 'Свой шаг', outcome: 'pending' }])
  })

  it('правка шаблона после применения не влияет на уже применённый прогресс', () => {
    const p = applyTemplate(gklTemplate)
    const mutatedTemplate = { ...gklTemplate, steps: [...gklTemplate.steps, { id: 's6', label: 'Новый шаг' }] }
    expect(p.steps).toHaveLength(5)
    expect(mutatedTemplate.steps).toHaveLength(6)
  })
})

describe('saveAsTemplate', () => {
  it('строит шаблон только из id/label, без outcome/причин', () => {
    let p = applyTemplate(gklTemplate)
    p = confirmStep(p, 0, '2026-07-06T00:00:00.000Z')
    p = rejectStep(p, 1, 'waiting_materials')
    const tpl = saveAsTemplate(p, 'custom1', 'Мой шаблон')
    expect(tpl.id).toBe('custom1')
    expect(tpl.label).toBe('Мой шаблон')
    expect(tpl.steps).toEqual([
      { id: 's1', label: 'Разметка' },
      { id: 's2', label: 'Каркас' },
      { id: 's3', label: 'Зашивка стороны 1' },
      { id: 's4', label: 'Минвата' },
      { id: 's5', label: 'Зашивка стороны 2' },
    ])
  })
})

describe('currentStepIndex / currentStep', () => {
  it('первый шаг — текущий, если ничего не подтверждено', () => {
    const p = applyTemplate(gklTemplate)
    expect(currentStepIndex(p)).toBe(0)
    expect(currentStep(p)?.label).toBe('Разметка')
  })

  it('текущий — первый неподтверждённый после серии подтверждений', () => {
    let p = applyTemplate(gklTemplate)
    p = confirmStep(p, 0)
    p = confirmStep(p, 1)
    expect(currentStepIndex(p)).toBe(2)
    expect(currentStep(p)?.label).toBe('Зашивка стороны 1')
  })

  it('отклонённый шаг тоже считается текущим (не пропускается)', () => {
    let p = applyTemplate(gklTemplate)
    p = confirmStep(p, 0)
    p = rejectStep(p, 1, 'waiting_trades')
    expect(currentStepIndex(p)).toBe(1)
    expect(currentStep(p)?.outcome).toBe('rejected')
  })

  it('null, если всё подтверждено', () => {
    let p = applyTemplate({ id: 't', label: 't', steps: [{ id: 'a', label: 'A' }] })
    p = confirmStep(p, 0)
    expect(currentStepIndex(p)).toBeNull()
    expect(currentStep(p)).toBeNull()
  })
})

describe('isNotStarted / isComplete / isBlocked', () => {
  it('isNotStarted true для свежеприменённого шаблона', () => {
    expect(isNotStarted(applyTemplate(gklTemplate))).toBe(true)
  })

  it('isNotStarted false, как только один шаг тронут', () => {
    let p = applyTemplate(gklTemplate)
    p = confirmStep(p, 0)
    expect(isNotStarted(p)).toBe(false)
  })

  it('isComplete true только когда ВСЕ шаги подтверждены', () => {
    let p = applyTemplate(gklTemplate)
    gklTemplate.steps.forEach((_, i) => { p = confirmStep(p, i) })
    expect(isComplete(p)).toBe(true)
  })

  it('isComplete false для пустого списка шагов', () => {
    expect(isComplete({ steps: [] })).toBe(false)
  })

  it('isBlocked true, когда текущий шаг отклонён', () => {
    let p = applyTemplate(gklTemplate)
    p = rejectStep(p, 0, 'changes', 'уточняем у прораба')
    expect(isBlocked(p)).toBe(true)
  })
})

describe('confirmStep / rejectStep / resetStep', () => {
  it('confirmStep пишет confirmedAt и чистит причину отказа', () => {
    let p = applyTemplate(gklTemplate)
    p = rejectStep(p, 0, 'waiting_materials')
    p = confirmStep(p, 0, '2026-07-06T12:00:00.000Z')
    expect(p.steps[0]).toEqual({ stepId: 's1', label: 'Разметка', outcome: 'confirmed', rejectReason: undefined, rejectNote: undefined, confirmedAt: '2026-07-06T12:00:00.000Z' })
  })

  it('rejectStep с other сохраняет rejectNote, с другими причинами — не сохраняет', () => {
    let p = applyTemplate(gklTemplate)
    p = rejectStep(p, 0, 'other', 'своя причина текстом')
    expect(p.steps[0].rejectReason).toBe('other')
    expect(p.steps[0].rejectNote).toBe('своя причина текстом')

    p = rejectStep(p, 1, 'waiting_trades', 'этот текст должен быть проигнорирован')
    expect(p.steps[1].rejectReason).toBe('waiting_trades')
    expect(p.steps[1].rejectNote).toBeUndefined()
  })

  it('resetStep возвращает шаг к pending без confirmedAt/причины', () => {
    let p = applyTemplate(gklTemplate)
    p = confirmStep(p, 0)
    p = resetStep(p, 0)
    expect(p.steps[0]).toEqual({ stepId: 's1', label: 'Разметка', outcome: 'pending' })
  })

  it('не мутирует исходный объект (иммутабельность)', () => {
    const p1 = applyTemplate(gklTemplate)
    const p2 = confirmStep(p1, 0)
    expect(p1.steps[0].outcome).toBe('pending')
    expect(p2.steps[0].outcome).toBe('confirmed')
  })
})

describe('progressPercent', () => {
  it('0% для свежего шаблона (5 шагов)', () => {
    expect(progressPercent(applyTemplate(gklTemplate))).toBe(0)
  })

  it('округляет корректно (2 из 5 = 40%)', () => {
    let p = applyTemplate(gklTemplate)
    p = confirmStep(p, 0)
    p = confirmStep(p, 1)
    expect(progressPercent(p)).toBe(40)
  })

  it('100% когда всё подтверждено', () => {
    let p = applyTemplate(gklTemplate)
    gklTemplate.steps.forEach((_, i) => { p = confirmStep(p, i) })
    expect(progressPercent(p)).toBe(100)
  })

  it('0% для пустого списка шагов (не NaN/деление на 0)', () => {
    expect(progressPercent({ steps: [] })).toBe(0)
  })

  it('отклонённый шаг не считается прогрессом', () => {
    let p = applyTemplate(gklTemplate)
    p = confirmStep(p, 0)
    p = rejectStep(p, 1, 'changes')
    expect(progressPercent(p)).toBe(20)
  })
})

describe('aggregateProgressPercent', () => {
  it('считает суммарно по шагам, не как среднее процентов', () => {
    // линия A: 1 шаг, подтверждён (100%)
    let a = createWorkProgress([{ id: 'a1', label: 'Единственный шаг' }])
    a = confirmStep(a, 0)
    // линия B: 5 шагов (как ГКЛ), 0 подтверждено (0%)
    const b = applyTemplate(gklTemplate)
    // среднее процентов было бы (100+0)/2=50%, а по сумме шагов: 1 из 6 = 16.67 → 17%
    expect(aggregateProgressPercent([a, b])).toBe(17)
  })

  it('0% для пустого массива', () => {
    expect(aggregateProgressPercent([])).toBe(0)
  })

  it('игнорирует линии без шагов вообще', () => {
    let a = createWorkProgress([{ id: 'a1', label: 'Шаг' }])
    a = confirmStep(a, 0)
    expect(aggregateProgressPercent([a, { steps: [] }])).toBe(100)
  })
})

describe('userId на StepProgress (кто подтвердил/отклонил шаг)', () => {
  it('confirmStep пишет userId последним аргументом, не ломая старый вызов с confirmedAt', () => {
    let p = applyTemplate(gklTemplate)
    p = confirmStep(p, 0, '2026-07-06T00:00:00.000Z', 'user-1')
    expect(p.steps[0].confirmedAt).toBe('2026-07-06T00:00:00.000Z')
    expect(p.steps[0].userId).toBe('user-1')
  })

  it('confirmStep без userId оставляет поле undefined', () => {
    let p = applyTemplate(gklTemplate)
    p = confirmStep(p, 0)
    expect(p.steps[0].userId).toBeUndefined()
  })

  it('rejectStep пишет userId пятым аргументом', () => {
    let p = applyTemplate(gklTemplate)
    p = rejectStep(p, 0, 'waiting_trades', undefined, 'user-2')
    expect(p.steps[0].userId).toBe('user-2')
    expect(p.steps[0].rejectReason).toBe('waiting_trades')
  })
})
