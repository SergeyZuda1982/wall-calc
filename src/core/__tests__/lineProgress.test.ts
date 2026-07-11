import { describe, it, expect } from 'vitest'
import { lineProgressStatus, lineProgressColor, isLineBuiltForRender, lineProgressSummary, wallGklVisual3D } from '../lineProgress'
import { applyTemplate, confirmStep, rejectStep } from '../workProgress'
import type { PlanLine, WorkStageTemplate } from '../../types'

const tpl: WorkStageTemplate = {
  id: 'gkl_partition',
  label: 'Перегородка ГКЛ',
  steps: [
    { id: 's1', label: 'Разметка' },
    { id: 's2', label: 'Каркас' },
  ],
}

const gklFrameTpl: WorkStageTemplate = {
  id: 'gkl_partition_tagged',
  label: 'Перегородка ГКЛ (с тегами)',
  steps: [
    { id: 's1', label: 'Разметка' },
    { id: 's2', label: 'Каркас', meaning3D: 'frame' },
    { id: 's3', label: 'Зашивка стороны 1', meaning3D: 'sheet_a' },
    { id: 's4', label: 'Зашивка стороны 2', meaning3D: 'sheet_b' },
  ],
}

function line(patch: Partial<PlanLine> = {}): PlanLine {
  return { id: 'l1', x1: 0, y1: 0, x2: 100, y2: 0, type: 'wall_new', lengthMm: 1000, label: 'Л1', ...patch }
}

describe('lineProgressStatus', () => {
  it('legacy, если buildProgress не задан', () => {
    expect(lineProgressStatus(undefined)).toBe('legacy')
  })

  it('not_started для свежеприменённого шаблона', () => {
    expect(lineProgressStatus(applyTemplate(tpl))).toBe('not_started')
  })

  it('in_progress, когда часть шагов подтверждена', () => {
    const p = confirmStep(applyTemplate(tpl), 0)
    expect(lineProgressStatus(p)).toBe('in_progress')
  })

  it('blocked, когда текущий шаг отклонён', () => {
    const p = rejectStep(applyTemplate(tpl), 0, 'waiting_materials')
    expect(lineProgressStatus(p)).toBe('blocked')
  })

  it('complete, когда все шаги подтверждены', () => {
    let p = applyTemplate(tpl)
    p = confirmStep(p, 0)
    p = confirmStep(p, 1)
    expect(lineProgressStatus(p)).toBe('complete')
  })
})

describe('lineProgressColor', () => {
  it('возвращает разные цвета для разных статусов', () => {
    const legacy = lineProgressColor(undefined)
    const notStarted = lineProgressColor(applyTemplate(tpl))
    const blocked = lineProgressColor(rejectStep(applyTemplate(tpl), 0, 'changes'))
    const complete = lineProgressColor(confirmStep(confirmStep(applyTemplate(tpl), 0), 1))
    expect(legacy).toBe(notStarted) // legacy визуально = "запланировано", как раньше
    expect(blocked).not.toBe(notStarted)
    expect(complete).not.toBe(blocked)
  })
})

describe('isLineBuiltForRender', () => {
  it('capital всегда true, даже без buildProgress', () => {
    expect(isLineBuiltForRender(line({ category: 'capital' }))).toBe(true)
  })

  it('mutable без buildProgress — true (обратная совместимость)', () => {
    expect(isLineBuiltForRender(line({ category: 'mutable' }))).toBe(true)
  })

  it('mutable с не начатым buildProgress — false (осознанно скрыто)', () => {
    expect(isLineBuiltForRender(line({ category: 'mutable', buildProgress: applyTemplate(tpl) }))).toBe(false)
  })

  it('mutable как только первый шаг подтверждён — true', () => {
    const p = confirmStep(applyTemplate(tpl), 0)
    expect(isLineBuiltForRender(line({ category: 'mutable', buildProgress: p }))).toBe(true)
  })

  it('mutable, у которого buildProgress отклонён на первом шаге (ещё не начато) — false', () => {
    // ключевой edge case: rejectStep(0) без единого confirm — физически
    // ещё ничего не появилось (просто отклонили попытку начать), значит
    // геометрия должна остаться скрытой, несмотря на то что шаг уже "тронут"
    const p = rejectStep(applyTemplate(tpl), 0, 'waiting_materials')
    expect(isLineBuiltForRender(line({ category: 'mutable', buildProgress: p }))).toBe(false)
  })

  it('mutable: подтвердили первый шаг, потом отклонили второй — остаётся видимой', () => {
    let p = applyTemplate(tpl)
    p = confirmStep(p, 0)
    p = rejectStep(p, 1, 'waiting_trades')
    expect(isLineBuiltForRender(line({ category: 'mutable', buildProgress: p }))).toBe(true)
  })
})

describe('lineProgressSummary', () => {
  it('legacy без прогресса', () => {
    expect(lineProgressSummary(undefined)).toBe('Прогресс не настроен')
  })

  it('показывает текущий шаг и процент', () => {
    const p = confirmStep(applyTemplate(tpl), 0)
    expect(lineProgressSummary(p)).toBe('В работе — Каркас · 50%')
  })

  it('готово без текущего шага в подписи', () => {
    let p = applyTemplate(tpl)
    p = confirmStep(p, 0)
    p = confirmStep(p, 1)
    expect(lineProgressSummary(p)).toBe('Готово · 100%')
  })
})

describe('wallGklVisual3D (10-11.07.2026, Этап 2 — 3D-каркас ГКЛ)', () => {
  it('не gkl (кладка/бетон) — null, эта функция не участвует', () => {
    const l = line({ type: 'wall_existing', spec: { material: 'brick' } })
    expect(wallGklVisual3D(l)).toBeNull()
  })

  it('wall_new без spec.material вообще — null (не gkl, категория не резолвится)', () => {
    expect(wallGklVisual3D(line())).toBeNull()
  })

  it('gkl, buildProgress не настроен — legacy (сплошная стена, как раньше)', () => {
    const l = line({ spec: { material: 'gkl' } })
    expect(wallGklVisual3D(l)).toEqual({ mode: 'legacy', sheetA: false, sheetB: false })
  })

  it('gkl, buildProgress настроен, но ничего не подтверждено — frame, обе стороны голые', () => {
    const l = line({ spec: { material: 'gkl' }, buildProgress: applyTemplate(gklFrameTpl) })
    expect(wallGklVisual3D(l)).toEqual({ mode: 'frame', sheetA: false, sheetB: false })
  })

  it('подтверждён шаг с тегом sheet_a — sheetA true, sheetB всё ещё false', () => {
    let p = applyTemplate(gklFrameTpl)
    p = confirmStep(p, 0) // Разметка
    p = confirmStep(p, 1) // Каркас
    p = confirmStep(p, 2) // Зашивка стороны 1 (sheet_a)
    const l = line({ spec: { material: 'gkl' }, buildProgress: p })
    expect(wallGklVisual3D(l)).toEqual({ mode: 'frame', sheetA: true, sheetB: false })
  })

  it('подтверждены обе обшивки — sheetA и sheetB true', () => {
    let p = applyTemplate(gklFrameTpl)
    for (let i = 0; i < 4; i++) p = confirmStep(p, i)
    const l = line({ spec: { material: 'gkl' }, buildProgress: p })
    expect(wallGklVisual3D(l)).toEqual({ mode: 'frame', sheetA: true, sheetB: true })
  })

  it('прогресс без тегов вообще (обычный шаблон tpl) — frame, но обе стороны голые (нет тегов — некому подтверждаться)', () => {
    const l = line({ spec: { material: 'gkl' }, buildProgress: applyTemplate(tpl) })
    expect(wallGklVisual3D(l)).toEqual({ mode: 'frame', sheetA: false, sheetB: false })
  })
})
