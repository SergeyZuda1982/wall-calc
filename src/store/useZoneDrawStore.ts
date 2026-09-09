/**
 * Транзитный канал (07.09.2026, Фаза B — 3D-рисование зон отделки, см.
 * KONSPEKT.md) передачи запроса из FloorPlan (кнопка «Нарисовать зону на
 * 3D» в чек-листе отделки стороны линии) во вкладку 3D (Scene3D.tsx) —
 * тот же принцип, что и useCeilingSeedStore.ts (одноразовая передача
 * между двумя компонентами в рамках сессии, БЕЗ persist).
 *
 * nonce растёт при каждом запросе — даже повторный клик на ту же
 * сторону (после отмены рисования) должен снова сработать, а не
 * проигнорироваться как "то же самое значение".
 */

import { create } from 'zustand'

export interface ZoneDrawRequest {
  lineId: string
  side: 'A' | 'B'
  nonce: number
}

interface ZoneDrawState {
  request: ZoneDrawRequest | null
  requestDraw: (lineId: string, side: 'A' | 'B') => void
  clearRequest: () => void
}

export const useZoneDrawStore = create<ZoneDrawState>((set, get) => ({
  request: null,
  requestDraw: (lineId, side) => set({ request: { lineId, side, nonce: (get().request?.nonce ?? 0) + 1 } }),
  clearRequest: () => set({ request: null }),
}))
