import { describe, it, expect } from 'vitest'
import { calcStepMaterial, WORK_MATERIAL_CATALOG } from '../workMaterialCatalog'

describe('calcStepMaterial', () => {
  it('толщино-зависимый материал (штукатурка): расход растёт линейно с толщиной', () => {
    const at15 = calcStepMaterial('plaster_gypsum', 20, { thicknessMm: 15 })
    const at30 = calcStepMaterial('plaster_gypsum', 20, { thicknessMm: 30 })
    expect(at30.totalMass).toBeCloseTo(at15.totalMass * 2, 5)
  })

  it('слои НЕ толщино-зависимого материала (покраска): 3 слоя дают больше расхода, чем 2 — не хардкод', () => {
    const twoCoats = calcStepMaterial('paint', 20, { layers: 2 })
    const threeCoats = calcStepMaterial('paint', 20, { layers: 3 })
    expect(threeCoats.totalMass).toBeGreaterThan(twoCoats.totalMass)
    expect(threeCoats.totalMass).toBeCloseTo(twoCoats.totalMass * 1.5, 5)
  })

  it('без явной толщины/слоёв — берёт дефолт из каталога', () => {
    const withDefault = calcStepMaterial('paint', 20)
    const explicit = calcStepMaterial('paint', 20, { layers: WORK_MATERIAL_CATALOG.paint.defaultLayers })
    expect(withDefault.totalMass).toBeCloseTo(explicit.totalMass, 10)
  })

  it('округление до упаковки — всегда вверх (никогда не меньше требуемого)', () => {
    const r = calcStepMaterial('priming', 5, { layers: 1 })
    expect(r.packages * r.rate.packageSize).toBeGreaterThanOrEqual(r.totalMass)
    expect((r.packages - 1) * r.rate.packageSize).toBeLessThan(r.totalMass)
  })

  it('гипсовая и цементно-песчаная штукатурка — разные расходы на той же толщине', () => {
    const gypsum = calcStepMaterial('plaster_gypsum', 20, { thicknessMm: 15 })
    const cement = calcStepMaterial('plaster_cement', 20, { thicknessMm: 15 })
    expect(gypsum.totalMass).not.toBeCloseTo(cement.totalMass, 0)
  })

  it('декоративная штукатурка не толщино-зависима (толщина задаётся зерном, не мм)', () => {
    expect(WORK_MATERIAL_CATALOG.plaster_decorative.thicknessDependent).toBe(false)
  })

  it('единицы измерения: сухие смеси — кг, жидкости — л', () => {
    expect(WORK_MATERIAL_CATALOG.plaster_gypsum.massUnit).toBe('kg')
    expect(WORK_MATERIAL_CATALOG.screed.massUnit).toBe('kg')
    expect(WORK_MATERIAL_CATALOG.priming.massUnit).toBe('l')
    expect(WORK_MATERIAL_CATALOG.paint.massUnit).toBe('l')
  })

  it('все 12 материалов каталога валидны (положительный расход и размер упаковки)', () => {
    for (const rate of Object.values(WORK_MATERIAL_CATALOG)) {
      expect(rate.ratePerM2).toBeGreaterThan(0)
      expect(rate.packageSize).toBeGreaterThan(0)
      expect(rate.wasteFactor).toBeGreaterThanOrEqual(0)
    }
    expect(Object.keys(WORK_MATERIAL_CATALOG).length).toBe(12)
  })

  it('нулевая площадь — ноль материала, ноль упаковок', () => {
    const r = calcStepMaterial('paint', 0)
    expect(r.totalMass).toBe(0)
    expect(r.packages).toBe(0)
  })
})
