/**
 * useTemplateStore.ts — библиотека шаблонов конструкций (пока только колонны).
 *
 * Осознанно ОТДЕЛЬНО от useProjectStore: шаблоны общие на все объекты
 * пользователя (сечения колонн часто повторяются между разными объектами),
 * а не привязаны к конкретному проекту. Хранится в своём ключе localStorage,
 * НЕ синхронизируется через Supabase (пока не просили — см. конспект задачи).
 *
 * Union-тип Template специально расширяемый: другие виды конструкций
 * (не колонны) добавляются сюда же новыми вариантами union, а не отдельным
 * стором — библиотека одна на все виды шаблонов.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PlanLineSpec } from '../types'

export type Template =
  | { id: string; kind: 'rectColumn'; name: string; widthMm: number; depthMm: number; spec?: PlanLineSpec }
  | { id: string; kind: 'roundColumn'; name: string; diameterMm: number; spec?: PlanLineSpec }

/** Omit, распределяющийся по union — обычный Omit<Template,'id'> схлопывает дискриминацию kind */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never
export type TemplateInput = DistributiveOmit<Template, 'id'>

export interface TemplateStore {
  templates: Template[]
  addTemplate: (t: TemplateInput) => string
  removeTemplate: (id: string) => void
  renameTemplate: (id: string, name: string) => void
}

export const useTemplateStore = create<TemplateStore>()(
  persist(
    (set) => ({
      templates: [],

      addTemplate: (t) => {
        const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2)}`
        set(s => ({ templates: [...s.templates, { ...t, id } as Template] }))
        return id
      },

      removeTemplate: (id) => {
        set(s => ({ templates: s.templates.filter(t => t.id !== id) }))
      },

      renameTemplate: (id, name) => {
        set(s => ({ templates: s.templates.map(t => t.id === id ? { ...t, name } : t) }))
      },
    }),
    {
      name: 'wall-calc-templates', // отдельный ключ в localStorage от wall-calc-projects
    }
  )
)
