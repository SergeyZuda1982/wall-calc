import { describe, it, expect } from 'vitest'
import { isCeilingBuiltForRender, ceilingGklVisual3D } from '../ceilingProgress3D'
import { applyTemplate, confirmStep, rejectStep } from '../workProgress'
import type { WorkStageTemplate } from '../../types'

const tpl: WorkStageTemplate = {
  id: 'ceiling_gkl',
  label: 'Подвесной потолок ГКЛ',
  steps: [
    { id: 's1', label: 'Разметка' },
    { id: 's2', label: 'Каркас', meaning3D: 'frame' },
    { id: 's3', label: 'Минвата' },
    { id: 's4', label: 'Зашивка ГКЛ', meaning3D: 'sheet_a' },
    { id: 's5', label: 'Готово' },
  ],
}

const untaggedTpl: WorkStageTemplate = {
  id: 'custom_no_tags',
  label: 'Кастомный список без тегов',
  steps: [
    { id: 's1', label: 'Шаг 1' },
    { id: 's2', label: 'Шаг 2' },
  ],
}

describe('isCeilingBuiltForRender (13.09.2026, Этап 3 — прогресс потолка в 3D)', () => {
  it('ceilingProgress не задан — true (обратная совместимость, потолок всегда виден)', () => {
    expect(isCeilingBuiltForRender(undefined)).toBe(true)
  })

  it('ceilingProgress без шагов — true', () => {
    expect(isCeilingBuiltForRender({ steps: [] })).toBe(true)
  })

  it('свежеприменённый шаблон, ничего не подтверждено — false (осознанно скрыто)', () => {
    expect(isCeilingBuiltForRender(applyTemplate(tpl))).toBe(false)
  })

  it('подтверждён первый шаг — true, каркас/сетка уже видны', () => {
    const p = confirmStep(applyTemplate(tpl), 0)
    expect(isCeilingBuiltForRender(p)).toBe(true)
  })

  it('первый шаг отклонён без единого подтверждения — false (физически ещё ничего нет)', () => {
    const p = rejectStep(applyTemplate(tpl), 0, 'waiting_materials')
    expect(isCeilingBuiltForRender(p)).toBe(false)
  })
})

describe('ceilingGklVisual3D (13.09.2026, Этап 3 — обшивка ГКЛ потолка)', () => {
  it('ceilingProgress не задан — обшивка видна (финальный вид "как по проекту")', () => {
    expect(ceilingGklVisual3D(undefined)).toEqual({ showGkl: true })
  })

  it('прогресс настроен, но ничего не подтверждено — обшивка скрыта (честный прогресс)', () => {
    expect(ceilingGklVisual3D(applyTemplate(tpl))).toEqual({ showGkl: false })
  })

  it('подтверждены Разметка+Каркас, но не Зашивка ГКЛ — обшивка всё ещё скрыта', () => {
    let p = applyTemplate(tpl)
    p = confirmStep(p, 0)
    p = confirmStep(p, 1)
    expect(ceilingGklVisual3D(p)).toEqual({ showGkl: false })
  })

  it('подтверждён шаг с тегом sheet_a — обшивка видна', () => {
    let p = applyTemplate(tpl)
    for (let i = 0; i < 4; i++) p = confirmStep(p, i) // Разметка, Каркас, Минвата, Зашивка ГКЛ
    expect(ceilingGklVisual3D(p)).toEqual({ showGkl: true })
  })

  it('прогресс без тегов вообще — обшивка скрыта (некому подтверждаться)', () => {
    let p = applyTemplate(untaggedTpl)
    p = confirmStep(p, 0)
    p = confirmStep(p, 1)
    expect(ceilingGklVisual3D(p)).toEqual({ showGkl: false })
  })
})
