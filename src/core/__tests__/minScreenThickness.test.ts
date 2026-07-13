import { describe, it, expect } from 'vitest'
import { calcMinThicknessScale } from '../minScreenThickness'

// Для наглядности тестов — типичная перспективная камера drei/three.js
// по умолчанию в проекте: fov 50° (см. Canvas в Scene3D.tsx).
const FOV_50_RAD = (50 * Math.PI) / 180

describe('calcMinThicknessScale', () => {
  it('элемент уже крупнее минимума на экране — коэффициент 1 (без раздутия)', () => {
    // Профиль 60мм с камеры в 1м при высоте вьюпорта 800px и fov 50°:
    // worldPerPixel = 2*1*tan(25°)/800 ≈ 0.001165 м/px -> 60мм займут ~51px,
    // сильно больше минимума в 2px.
    const k = calcMinThicknessScale({
      distanceM: 1,
      fovYRad: FOV_50_RAD,
      viewportPxHeight: 800,
      minPx: 2,
      actualWorldSizeM: 0.06,
    })
    expect(k).toBe(1)
  })

  it('элемент мельче минимума на большом расстоянии — коэффициент растёт пропорционально расстоянию', () => {
    const base = {
      fovYRad: FOV_50_RAD,
      viewportPxHeight: 800,
      minPx: 2,
      actualWorldSizeM: 0.002, // тонкий стержень подвеса, 2мм
      maxScale: 100, // явно выше потолка (13.07.2026: дефолт снижен до 2) — тест линейности роста, не потолка
    }
    const kNear = calcMinThicknessScale({ ...base, distanceM: 1 })
    const kFar = calcMinThicknessScale({ ...base, distanceM: 2 })
    expect(kFar).toBeGreaterThan(kNear)
    expect(kFar).toBeCloseTo(kNear * 2, 5) // коэффициент линеен по расстоянию (до maxScale)
  })

  it('коэффициент ограничен сверху maxScale на очень большом расстоянии', () => {
    const k = calcMinThicknessScale({
      distanceM: 1000,
      fovYRad: FOV_50_RAD,
      viewportPxHeight: 800,
      minPx: 3,
      actualWorldSizeM: 0.0006, // сталь профиля, 0.6мм
      maxScale: 8,
    })
    expect(k).toBe(8)
  })

  it('нулевой или отрицательный реальный размер — возвращает 1 (не делит на 0)', () => {
    expect(calcMinThicknessScale({
      distanceM: 10, fovYRad: FOV_50_RAD, viewportPxHeight: 800, minPx: 2, actualWorldSizeM: 0,
    })).toBe(1)
    expect(calcMinThicknessScale({
      distanceM: 10, fovYRad: FOV_50_RAD, viewportPxHeight: 800, minPx: 2, actualWorldSizeM: -1,
    })).toBe(1)
  })

  it('нулевое расстояние или высота вьюпорта — возвращает 1, не кидает и не даёт Infinity/NaN', () => {
    expect(calcMinThicknessScale({
      distanceM: 0, fovYRad: FOV_50_RAD, viewportPxHeight: 800, minPx: 2, actualWorldSizeM: 0.06,
    })).toBe(1)
    expect(calcMinThicknessScale({
      distanceM: 10, fovYRad: FOV_50_RAD, viewportPxHeight: 0, minPx: 2, actualWorldSizeM: 0.06,
    })).toBe(1)
  })

  it('дефолтный maxScale равен 2, если не передан (13.07.2026, было 8)', () => {
    const k = calcMinThicknessScale({
      distanceM: 10000, fovYRad: FOV_50_RAD, viewportPxHeight: 800, minPx: 2, actualWorldSizeM: 0.0006,
    })
    expect(k).toBe(2)
  })
})
