import { describe, it, expect } from 'vitest'
import { BUILTIN_WORK_STAGE_TEMPLATES, findBuiltinTemplate } from '../workStageTemplates'
import { WORK_MATERIAL_CATALOG } from '../workMaterialCatalog'

function template(id: string) {
  const t = findBuiltinTemplate(id)
  if (!t) throw new Error(`template ${id} not found`)
  return t
}

function step(templateId: string, label: string) {
  const s = template(templateId).steps.find(s => s.label === label)
  if (!s) throw new Error(`step ${label} not found in ${templateId}`)
  return s
}

describe('BUILTIN_WORK_STAGE_TEMPLATES — materialKind разметка (20.07.2026)', () => {
  it('wall_paint: все 3 повторения "Грунтовка" получили тот же materialKind', () => {
    const grounds = template('wall_paint').steps.filter(s => s.label === 'Грунтовка')
    expect(grounds).toHaveLength(3)
    expect(grounds.every(s => s.materialKind === 'priming')).toBe(true)
  })

  it('wall_paint: Штукатурка гипсовая с толщиной, Шпаклёвка и Покраска без толщины', () => {
    expect(step('wall_paint', 'Штукатурка').materialKind).toBe('plaster_gypsum')
    expect(step('wall_paint', 'Штукатурка').materialThicknessMm).toBe(15)
    expect(step('wall_paint', 'Шпаклёвка').materialKind).toBe('putty')
    expect(step('wall_paint', 'Покраска/обои').materialKind).toBe('paint')
  })

  it('wall_tile: штукатурка цементная (не гипсовая), Плитка/Затирка БЕЗ materialKind (считает TileCalc)', () => {
    expect(step('wall_tile', 'Штукатурка цементная').materialKind).toBe('plaster_cement')
    expect(step('wall_tile', 'Плитка').materialKind).toBeUndefined()
    expect(step('wall_tile', 'Затирка').materialKind).toBeUndefined()
  })

  it('gkl_partition: НИ ОДИН шаг не имеет materialKind (материал уже точно считается отдельно)', () => {
    expect(template('gkl_partition').steps.every(s => s.materialKind === undefined)).toBe(true)
  })

  it('gkl_partition: meaning3D-теги не потерялись при переходе на общий helper', () => {
    expect(step('gkl_partition', 'Каркас').meaning3D).toBe('frame')
    expect(step('gkl_partition', 'Зашивка стороны 1').meaning3D).toBe('sheet_a')
    expect(step('gkl_partition', 'Зашивка стороны 2').meaning3D).toBe('sheet_b')
  })

  it('floor_screed_tile/floor_selfleveling: Стяжка везде с толщиной 50мм', () => {
    expect(step('floor_screed_tile', 'Стяжка').materialThicknessMm).toBe(50)
    expect(step('floor_selfleveling', 'Стяжка').materialThicknessMm).toBe(50)
  })

  it('floor_selfleveling: полная цепочка гидроизоляция→стяжка→наливной→ламинат размечена', () => {
    expect(step('floor_selfleveling', 'Гидроизоляция').materialKind).toBe('waterproofing')
    expect(step('floor_selfleveling', 'Наливной пол').materialKind).toBe('self_leveling')
    expect(step('floor_selfleveling', 'Наливной пол').materialThicknessMm).toBe(5)
    expect(step('floor_selfleveling', 'Ламинат/паркет').materialKind).toBe('flooring_laminate')
  })

  it('каждый проставленный materialKind реально существует в каталоге', () => {
    for (const t of BUILTIN_WORK_STAGE_TEMPLATES) {
      for (const s of t.steps) {
        if (s.materialKind) expect(WORK_MATERIAL_CATALOG[s.materialKind]).toBeDefined()
      }
    }
  })

  it('толщина проставлена только там, где материал реально толщино-зависимый', () => {
    for (const t of BUILTIN_WORK_STAGE_TEMPLATES) {
      for (const s of t.steps) {
        if (s.materialThicknessMm !== undefined && s.materialKind) {
          expect(WORK_MATERIAL_CATALOG[s.materialKind].thicknessDependent).toBe(true)
        }
      }
    }
  })
})
