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

/** Одна именованная зона (одна Плита или один Потолок с плана), из которых
 *  может состоять расчёт. При отправке одной сущности зона всего одна —
 *  при объединении (см. combineCeilingSeeds.ts) зон несколько, каждая со
 *  своим названием и геометрией, чтобы в CeilingCalc.tsx можно было
 *  показать не только общий итог, но и что именно в него вошло. */
export interface CeilingSeedZone {
  label: string
  areaSqm: number
  perimeterM: number
  /** Внешний контур (мм) — для визуального превью в CeilingCalc.tsx. */
  outerMm: Point2D[]
  /** Вырезы (мм) внутри контура — пусто, если их нет. */
  holesMm: Point2D[][]
}

export interface CeilingSeed {
  /** Отображаемое название — либо название единственной зоны, либо
   *  объединение через " + " (см. combineCeilingSeeds.ts). */
  label: string
  /** Сумма площадей всех зон. */
  areaSqm: number
  /** Сумма периметров всех зон по отдельности (сознательный выбор —
   *  простой и предсказуемый способ, даёт запас материала на профиль
   *  примыкания вместо точного вычитания внутренних границ между
   *  зонами; обсуждено с пользователем 10.07.2026). */
  perimeterM: number
  holesCount: number
  /** Зоны, из которых состоит расчёт — 1, если пришла одна Плита/Потолок;
   *  2+, если несколько объединены через "Объединить N → Потолок". */
  zones: CeilingSeedZone[]
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
