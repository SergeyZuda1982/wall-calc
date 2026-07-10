/**
 * duplicateFloorPlan.ts — чистая логика дублирования плана этажа (для
 * "Дублировать этаж"). Вынесена из useProjectStore.ts, чтобы протестировать
 * без zustand/localStorage — сам стор только генерирует id счётчик через
 * Date.now()/Math.random и оборачивает в immutable-обновление уровня.
 *
 * Раньше (баг, найден 05.07.2026) дублирование давало линиям/помещениям/
 * контурам НОВЫЕ id, но Room.lineIds/PlanContour.lineIds продолжали
 * указывать на СТАРЫЕ id линий — которых на скопированном этаже уже нет.
 * Итог: все помещения (и старые прямоугольные колонны — Room+4 линии)
 * пропадали на дублированном этаже, просто молча не рендерились (contour
 * не находил свои линии). Слабо заметно, пока 3D показывал только один
 * этаж — стало сразу видно, когда 3D научился показывать все этажи разом.
 */

import type { FloorPlan } from '../types'

/** Генератор id — вынесен параметром, чтобы тесты могли подставить предсказуемый счётчик вместо Date.now()/Math.random */
export type IdGen = (prefix: string) => string

export function defaultIdGen(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

/**
 * Копия плана этажа с полностью новыми id везде (линии/помещения/контуры/
 * плиты/колонны) — и корректно перенесёнными lineIds у rooms/contours на
 * новые id соответствующих линий.
 */
export function duplicateFloorPlanGeometry(src: FloorPlan, idGen: IdGen = defaultIdGen): FloorPlan {
  const lineIdMap = new Map<string, string>()
  const lines = src.lines.map(l => {
    const newId = `${idGen('pl')}_${l.id}` // хвост старого id — как было в исходном коде, для отладки полезно
    lineIdMap.set(l.id, newId)
    return { ...l, id: newId }
  })
  const remapLineIds = (ids: string[]) => ids.map(oldId => lineIdMap.get(oldId)).filter((x): x is string => !!x)

  return {
    ...src,
    lines,
    rooms: src.rooms.map(r => ({ ...r, id: idGen('rm'), lineIds: remapLineIds(r.lineIds) })),
    contours: src.contours.map(c => ({ ...c, id: idGen('pc'), lineIds: remapLineIds(c.lineIds) })),
    slabs: (src.slabs ?? []).map(sl => ({ ...sl, id: idGen('sb') })),
    ceilings: (src.ceilings ?? []).map(cl => ({ ...cl, id: idGen('cl') })),
    roundColumns: (src.roundColumns ?? []).map(rc => ({ ...rc, id: idGen('rc') })),
    rectColumns: (src.rectColumns ?? []).map(rc => ({ ...rc, id: idGen('rec') })),
    freeformStructures: (src.freeformStructures ?? []).map(fs => ({ ...fs, id: idGen('fs') })),
  }
}
