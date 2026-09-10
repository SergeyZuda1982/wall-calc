/**
 * Транзитный канал (07.09.2026, наклон Плиты/Потолка задаваемый прямо в
 * 3D, см. KONSPEKT.md) — тот же принцип, что useCeilingSeedStore.ts и
 * useZoneDrawStore.ts: одноразовая передача запроса из FloorPlan (кнопка
 * «📐 в 3D» в карточке Плиты/Потолка) во вкладку 3D, без persist.
 */

import { create } from 'zustand'

export interface SlopePickRequest {
  kind: 'slab' | 'ceiling'
  id: string
  nonce: number
}

interface SlopePickState {
  request: SlopePickRequest | null
  requestPick: (kind: 'slab' | 'ceiling', id: string) => void
  clearRequest: () => void
}

export const useSlopePickStore = create<SlopePickState>((set, get) => ({
  request: null,
  requestPick: (kind, id) => set({ request: { kind, id, nonce: (get().request?.nonce ?? 0) + 1 } }),
  clearRequest: () => set({ request: null }),
}))
