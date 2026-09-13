/**
 * lineReverse.ts — разворот направления линии плана (13.09.2026).
 *
 * Повод: у wall_lining (облицовка) лист ГКЛ рисуется в 3D всегда на ФИКСИРОВАННОЙ
 * стороне относительно направления x1→x2 (правая сторона по ходу рисования, см.
 * planTo3D.ts wallToBox3D rotationY = atan2(-dz, dx)). После перехода на непрерывное
 * рисование цепочкой (см. FloorPlan.tsx handleStageClick, тот же день) весь контур
 * обходится одним и тем же вращением — и если пользователь обвёл против часовой
 * стрелки, обшивка у ВСЕХ сторон короба оказывается развёрнута внутрь. Самый частый
 * случай — нужно развернуть уже нарисованную линию на месте, не перерисовывая её
 * (и не портя уже расставленные проёмы/крепёж/прогресс отделки).
 *
 * reverseLineDirection() меняет местами x1,y1 ↔ x2,y2 и переносит вместе с этим ВСЁ,
 * что было привязано к направлению/стороне линии:
 *  - openings: offsetMm отсчитывается от x1 — зеркалим вдоль длины
 *  - fastenerStart/fastenerEnd — просто меняются местами (start/end поменялись)
 *  - finishZonesA/B, finishProgressA/B: сторона A — нормаль по локальному +Z ПОСЛЕ
 *    поворота на rotationY (см. planTo3D.ts wallFaceFrame) — разворот направления
 *    переворачивает rotationY на 180°, то есть то, что было стороной A, становится
 *    стороной B, и наоборот. Для двусторонних (wall_new/wall_existing, sides===2)
 *    меняем местами A/B целиком. Для облицовки (wall_lining, sides===1) стороны B не
 *    существует — там нечего менять местами, но у зон finishZonesA outline.x задан
 *    "вдоль стены от начала линии" (см. types/index.ts FinishZone) — начало сменилось,
 *    зеркалим x внутри каждого outline.
 *  - buildProgress.steps с meaning3D 'sheet_a'/'sheet_b': та же логика стороны A/Б,
 *    что и выше — для sides===2 меняем местами, для sides===1 (лист всегда "sheet_a"
 *    физически единственный) не трогаем — это и есть желаемый эффект (тот же лист
 *    просто рисуется в 3D на другую сторону).
 *
 * НЕ трогает: communications (Communication[]) — они не хранятся на самой PlanLine
 * (см. types/index.ts), а на WallEntry/LiningEntry через wallId/liningId — вне скоупа
 * этой функции.
 */

import type { PlanLine, FinishZone, WorkProgress } from '../types'
import { finishSidesOf } from './finishResolver'

function mirrorZonesAlongLength(zones: FinishZone[] | undefined, lengthMm: number): FinishZone[] | undefined {
  if (!zones) return zones
  return zones.map(z => ({
    ...z,
    outline: z.outline?.map(p => ({ x: lengthMm - p.x, y: p.y })),
  }))
}

function swapSheetMeaning(progress: WorkProgress | undefined): WorkProgress | undefined {
  if (!progress) return progress
  return {
    ...progress,
    steps: progress.steps.map(s =>
      s.meaning3D === 'sheet_a' ? { ...s, meaning3D: 'sheet_b' }
      : s.meaning3D === 'sheet_b' ? { ...s, meaning3D: 'sheet_a' }
      : s
    ),
  }
}

export function reverseLineDirection(line: PlanLine): Partial<PlanLine> {
  const sides = finishSidesOf(line)
  const lengthMm = line.lengthMm

  const patch: Partial<PlanLine> = {
    x1: line.x2, y1: line.y2,
    x2: line.x1, y2: line.y1,
  }

  if (line.openings && line.openings.length > 0) {
    patch.openings = line.openings.map(o => ({
      ...o,
      offsetMm: lengthMm - o.offsetMm - o.widthMm,
    }))
  }

  if (line.fastenerStart || line.fastenerEnd) {
    patch.fastenerStart = line.fastenerEnd
    patch.fastenerEnd = line.fastenerStart
  }

  if (sides === 2) {
    // Двусторонняя конструкция: сторона A/Б физически меняются местами.
    if (line.finishZonesA || line.finishZonesB) {
      patch.finishZonesA = mirrorZonesAlongLength(line.finishZonesB, lengthMm)
      patch.finishZonesB = mirrorZonesAlongLength(line.finishZonesA, lengthMm)
    }
    if (line.finishProgressA || line.finishProgressB) {
      patch.finishProgressA = line.finishProgressB
      patch.finishProgressB = line.finishProgressA
    }
    if (line.buildProgress) {
      patch.buildProgress = swapSheetMeaning(line.buildProgress)
    }
  } else if (sides === 1) {
    // Односторонняя облицовка: сторона A остаётся стороной A (второй нет),
    // но начало отсчёта x вдоль стены сменилось — зеркалим только outline.
    if (line.finishZonesA) {
      patch.finishZonesA = mirrorZonesAlongLength(line.finishZonesA, lengthMm)
    }
    // finishProgressA / buildProgress не хранят позиций вдоль стены — не трогаем.
  }

  return patch
}
