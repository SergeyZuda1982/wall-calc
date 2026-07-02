/**
 * attachmentResolver.ts — определяет, к чему физически примыкает каждый конец линии.
 *
 * В отличие от wallJoin.ts (который корректирует геометрию рендера стыков),
 * этот модуль ничего не рисует — только отвечает на вопрос "к чему прикручена
 * эта сторона стойки: к соседней конструкции (и какой у неё материал) или
 * конец свободный". Результат используется резолвером крепежа (fastenerCatalog)
 * и в перспективе — переводчиком PlanLine → SurfaceSheetInput.
 *
 * Использует ту же геометрию T/L-стыка, что и wallJoin.ts (общий конец —
 * L, конец на теле соседа — T), но не корректирует координаты, только
 * определяет факт примыкания и возвращает id соседа.
 */

import type { AttachmentMaterial, PlanLineType } from '../types'

/**
 * Определяет AttachmentMaterial соседней линии плана по её типу и материалу
 * спецификации. Используется при построении AttachSurface[] в FloorPlan.tsx
 * перед вызовом resolveLineAttachments/resolveAllAttachments.
 *
 * wall_existing: материал берётся из spec.material (brick/block/concrete),
 * при отсутствии — 'unknown' (существующая стена, тип не задан).
 * wall_new/wall_lining: любая ГКЛ-конструкция считается 'gkl_existing' —
 * с точки зрения соседней стойки неважно, "новая" она или "существующая"
 * в системе статусов (workStatus), важно что она физически из ГКЛ.
 * ceiling/floor: не являются боковым примыканием, 'unknown' по умолчанию
 * (эти типы не должны попадать в AttachSurface[] бокового резолва).
 */
export function attachmentMaterialOf(
  type: PlanLineType,
  specMaterial: string | undefined,
): AttachmentMaterial {
  if (type === 'wall_existing') {
    if (specMaterial === 'brick') return 'brick'
    if (specMaterial === 'block') return 'block'
    if (specMaterial === 'concrete') return 'concrete'
    return 'unknown'
  }
  if (type === 'wall_new' || type === 'wall_lining') {
    return 'gkl_existing'
  }
  return 'unknown'
}

const JOIN_EPS = 3 // допуск совпадения точек, px — совпадает с wallJoin.ts

export interface AttachSurface {
  id: string
  x1: number; y1: number
  x2: number; y2: number
  halfPx: number             // половина толщины в мировых px
  material: AttachmentMaterial
}

export interface EndAttachment {
  neighborId: string
  material: AttachmentMaterial
}

export interface LineAttachments {
  start: EndAttachment | null // конец (x1,y1)
  end: EndAttachment | null   // конец (x2,y2)
}

function d2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2
}

/** Параметр t проекции точки P на прямую AB (0=A, 1=B). */
function projT(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-9) return 0
  return ((px - ax) * dx + (py - ay) * dy) / l2
}

/**
 * Проверяет примыкание одного конца (px,py) линии A к линии B:
 * L (px,py совпадает с одним из концов B) или T (px,py лежит на теле B,
 * в пределах полосы толщины B — та же логика допуска, что в wallJoin.ts).
 */
function endTouchesSurface(
  px: number, py: number,
  b: AttachSurface,
): boolean {
  // L: совпадение с любым концом B
  const EPS2 = JOIN_EPS * JOIN_EPS
  if (d2(px, py, b.x1, b.y1) <= EPS2) return true
  if (d2(px, py, b.x2, b.y2) <= EPS2) return true

  // T: проекция на тело B, допуск = вся полоса толщины B (не только ось)
  const bLen = Math.sqrt(d2(b.x1, b.y1, b.x2, b.y2))
  if (bLen < 1) return false
  const t = projT(px, py, b.x1, b.y1, b.x2, b.y2)
  if (t <= JOIN_EPS / bLen || t >= 1 - JOIN_EPS / bLen) return false
  const cx = b.x1 + t * (b.x2 - b.x1), cy = b.y1 + t * (b.y2 - b.y1)
  const distToAxis = Math.sqrt(d2(px, py, cx, cy))
  return distToAxis <= b.halfPx + JOIN_EPS
}

/**
 * Резолвит примыкания для одной линии относительно всех остальных поверхностей.
 * Если конец касается нескольких соседей — берётся первый найденный (порядок
 * массива surfaces = порядок приоритета, обычно порядок создания на плане).
 */
export function resolveLineAttachments(
  lineId: string,
  surfaces: AttachSurface[],
): LineAttachments {
  const self = surfaces.find(s => s.id === lineId)
  if (!self) return { start: null, end: null }

  let start: EndAttachment | null = null
  let end: EndAttachment | null = null

  for (const other of surfaces) {
    if (other.id === lineId) continue
    if (!start && endTouchesSurface(self.x1, self.y1, other)) {
      start = { neighborId: other.id, material: other.material }
    }
    if (!end && endTouchesSurface(self.x2, self.y2, other)) {
      end = { neighborId: other.id, material: other.material }
    }
    if (start && end) break
  }

  return { start, end }
}

/** Батч-версия: резолвит примыкания для всех линий сразу. */
export function resolveAllAttachments(
  surfaces: AttachSurface[],
): Map<string, LineAttachments> {
  const res = new Map<string, LineAttachments>()
  for (const s of surfaces) {
    res.set(s.id, resolveLineAttachments(s.id, surfaces))
  }
  return res
}
