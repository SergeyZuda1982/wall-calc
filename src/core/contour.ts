/**
 * contour.ts — сборка замкнутого контура (помещение/колонна) из списка id линий
 * плана в упорядоченный список точек. Вынесено из FloorPlan.tsx, чтобы
 * переиспользовать и в 2D-рендере, и в переводчике плана в 3D (planTo3D.ts).
 */

import type { PlanLine } from '../types'

export function extractContourPoints(lineIds: string[], lines: PlanLine[]): { x: number; y: number }[] {
  const sel = lineIds.map(id => lines.find(l => l.id === id)).filter(Boolean) as PlanLine[]
  if (sel.length < 3) return []
  const pts: { x: number; y: number }[] = []
  let current = sel[0]
  const used = new Set([current.id])
  pts.push({ x: current.x1, y: current.y1 }, { x: current.x2, y: current.y2 })
  let prevEnd = { x: current.x2, y: current.y2 }
  for (let i = 1; i < sel.length; i++) {
    const next = sel.find(l => !used.has(l.id) && (
      (Math.abs(l.x1 - prevEnd.x) < 2 && Math.abs(l.y1 - prevEnd.y) < 2) ||
      (Math.abs(l.x2 - prevEnd.x) < 2 && Math.abs(l.y2 - prevEnd.y) < 2)
    ))
    if (!next) break
    used.add(next.id)
    if (Math.abs(next.x1 - prevEnd.x) < 2 && Math.abs(next.y1 - prevEnd.y) < 2) {
      prevEnd = { x: next.x2, y: next.y2 }
    } else {
      prevEnd = { x: next.x1, y: next.y1 }
    }
    pts.push(prevEnd)
  }
  return pts
}
