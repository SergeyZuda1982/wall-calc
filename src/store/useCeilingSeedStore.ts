/**
 * Транзитный канал передачи данных из FloorPlan (плита-«карандаш», Slab)
 * во вкладку CeilingCalc — «отправить контур в расчёт потолка».
 *
 * Намеренно БЕЗ persist middleware: это одноразовая передача между двумя
 * компонентами в рамках одной сессии браузера, не факт проекта — не нужно
 * переживать перезагрузку страницы и не нужно сохраняться в localStorage/
 * Supabase (в отличие от самой геометрии Slab, которая уже сохраняется
 * как часть FloorPlan).
 */

import { create } from 'zustand'
import type { Point2D } from '../core/geometry2d'

export interface CeilingSeed {
  areaSqm: number
  perimeterM: number
  label: string
  holesCount: number
  /** Внешний контур (мм) обведённой фигуры (Плита/Потолок) — для
   *  визуального превью в CeilingCalc.tsx, дополняет числа площади/
   *  периметра "нарисованной" формой, как её видит пользователь на плане. */
  outerMm: Point2D[]
  /** Вырезы (мм) внутри контура — пусто, если их нет (у Ceiling их пока
   *  вообще нет, см. ceilingToCeilingSeed.ts). */
  holesMm: Point2D[][]
}

interface CeilingSeedState {
  seed: CeilingSeed | null
  setSeed: (seed: CeilingSeed) => void
  clearSeed: () => void
}

export const useCeilingSeedStore = create<CeilingSeedState>((set) => ({
  seed: null,
  setSeed: (seed) => set({ seed }),
  clearSeed: () => set({ seed: null }),
}))
