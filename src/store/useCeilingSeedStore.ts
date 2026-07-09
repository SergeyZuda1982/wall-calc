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

export interface CeilingSeed {
  areaSqm: number
  perimeterM: number
  label: string
  holesCount: number
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
