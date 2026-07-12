/**
 * frameCornerNodes.ts — поиск 90°-угловых узлов между сегментами каркаса
 * (узел Е из чертежей Кнауф С111/С112) для дедупликации угловой стойки.
 *
 * См. TASKS.md / KONSPEKT.md "дедупликация угловой стойки на 90°-примыканиях"
 * (короба/ниши/колонны, любые перегородки/облицовки).
 *
 * Отдельно от wallJoin.ts:computeJoinAngles (та же геометрия L-стыка + угол),
 * но здесь дополнительно нужны ТЕГИ КОНЦОВ (aEnd/bEnd — 'end1'|'end2'), чтобы
 * сопоставить найденный угол с конкретной позицией стойки (0 или length) в
 * StudInfo[] конкретной линии — computeJoinAngles этого не отдаёт наружу
 * (не нужно было для его текущих потребителей — бейдж угла на плане).
 * Геометрия/допуск (JOIN_EPS=3px) намеренно совпадают с wallJoin.ts, чтобы
 * не расходиться с уже отрисованными на плане стыками.
 *
 * Строго прямой угол (допуск 1–2°) — по подтверждению пользователя,
 * скошенные примыкания сейчас вне скоупа задачи (падают под старое
 * поведение — T-стык/крест/торец/капстена/свободный конец).
 */

export interface CornerJoinInput {
  id: string
  x1: number; y1: number
  x2: number; y2: number
}

export type WallEnd = 'end1' | 'end2'

export interface FrameCornerNode {
  aId: string; aEnd: WallEnd
  bId: string; bEnd: WallEnd
  /** Точка узла, мировые px */
  x: number; y: number
  angleDeg: number
}

const JOIN_EPS = 3 // допуск совпадения точек, px — совпадает с wallJoin.ts
const CORNER_TARGET_DEG = 90
const CORNER_ANGLE_TOLERANCE_DEG = 2

function d2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2
}

/** true, если угол (в градусах) — прямой в пределах допуска. */
export function isRightAngle(angleDeg: number): boolean {
  return Math.abs(angleDeg - CORNER_TARGET_DEG) <= CORNER_ANGLE_TOLERANCE_DEG
}

/**
 * Находит все 90°-угловые узлы (L-стык, конец=конец, угол≈90°) среди
 * переданных сегментов. Возвращает по одной записи на каждую совпавшую
 * пару концов, прошедшую проверку угла — остальные L-стыки (не 90°) и
 * T-стыки/кресты сюда не попадают (действует старое поведение).
 *
 * Не решает, что делать с найденными узлами (это на стороне
 * агрегатора — см. planFrameEstimate.ts): здесь только геометрия.
 */
export function findFrameCornerNodes(walls: CornerJoinInput[]): FrameCornerNode[] {
  const result: FrameCornerNode[] = []
  const EPS2 = JOIN_EPS * JOIN_EPS

  for (let i = 0; i < walls.length; i++) {
    const a = walls[i]
    const dxA = a.x2 - a.x1, dyA = a.y2 - a.y1
    const lenA = Math.sqrt(dxA * dxA + dyA * dyA)
    if (lenA < 1) continue

    for (let j = i + 1; j < walls.length; j++) {
      const b = walls[j]
      const dxB = b.x2 - b.x1, dyB = b.y2 - b.y1
      const lenB = Math.sqrt(dxB * dxB + dyB * dyB)
      if (lenB < 1) continue

      const aEnds: [number, number, WallEnd][] = [
        [a.x1, a.y1, 'end1'], [a.x2, a.y2, 'end2'],
      ]
      const bEnds: [number, number, WallEnd][] = [
        [b.x1, b.y1, 'end1'], [b.x2, b.y2, 'end2'],
      ]

      for (const [ax, ay, aEnd] of aEnds) {
        for (const [bx, by, bEnd] of bEnds) {
          if (d2(ax, ay, bx, by) > EPS2) continue

          // Направления ОТ точки стыка наружу вдоль каждого сегмента
          const vax = aEnd === 'end1' ? dxA / lenA : -dxA / lenA
          const vay = aEnd === 'end1' ? dyA / lenA : -dyA / lenA
          const vbx = bEnd === 'end1' ? dxB / lenB : -dxB / lenB
          const vby = bEnd === 'end1' ? dyB / lenB : -dyB / lenB

          const dot = vax * vbx + vay * vby
          const clamped = Math.max(-1, Math.min(1, dot))
          const angleDeg = Math.acos(clamped) * 180 / Math.PI

          if (!isRightAngle(angleDeg)) continue

          result.push({ aId: a.id, aEnd, bId: b.id, bEnd, x: ax, y: ay, angleDeg })
        }
      }
    }
  }

  return result
}
