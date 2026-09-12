/**
 * Конфликты сетки подвесов потолка с ригелями (балками перекрытия).
 *
 * Контекст (репорт с объекта, зал ~150м², П112, отметка потолка 3300,
 * отметка плиты 3800, ригели на отметке ~3450, сечение ~300мм, шаг между
 * ригелями ~1400мм ± ): сам ригель находится ВЫШЕ уровня потолка, так что
 * высоту/опуск подвеса (gapMm/CeilingGapSpec) ригель не меняет — гап везде
 * одинаковый. Проблема физическая: в створе ригеля между верхом каркаса и
 * низом ригеля мало места для штатной тяги с зажимом, а менять узел на
 * прямой подвес неудобно — поэтому подвес должен становиться СТРОГО между
 * ригелями. Раньше это подбиралось на объекте вручную ("плавающий" шаг a).
 *
 * Ригель считается идущим ПОПЕРЁК одной оси помещения (length или width) и
 * перекрывающим всю протяжённость по другой оси — как и уклон плиты
 * (CeilingSlopeAxis в calcP112Frame.ts), та же система координат.
 * Запретная полоса вокруг ригеля = его сечение (widthMm) + технологический
 * зазор с каждой стороны (clearanceMm) — минимальное расстояние, чтобы
 * стандартная тяга с зажимом встала как обычно.
 *
 * Источник геометрии ригелей — намеренно НЕ фиксирован здесь (BeamObstacle
 * не хранит ссылку на rib_beam с плана): ригели на объекте не всегда
 * нарисованы (репорт пользователя 11.09.2026) — список могут формировать
 * как мост от нарисованных rib_beam (см. будущий ribBeamsToBeamObstacles),
 * так и ручной ввод прямо в форме калькулятора потолка.
 */

import { calcFrameRowPositions, type FrameLayoutMode, type FrameProfileKind } from './calcP112Frame'

export type BeamObstacleAxis = 'length' | 'width'

export interface BeamObstacle {
  /** Ось помещения, вдоль которой отложена позиция ригеля (та же ось, что
   *  hangerPositions/mainPositions в P112FrameGeometry). Ригель считается
   *  идущим поперёк этой оси на всю ширину/длину помещения. */
  axis: BeamObstacleAxis
  /** Позиция центра ригеля вдоль оси, мм. */
  posMm: number
  /** Ширина сечения ригеля по плану, мм. */
  widthMm: number
  label?: string
}

export interface HangerConflict {
  lengthMm: number
  widthMm: number
  beam: BeamObstacle
}

/** Половина запретной полосы вокруг ригеля: половина сечения + технологический зазор. */
export function exclusionHalfWidthMm(beam: BeamObstacle, clearanceMm: number): number {
  return beam.widthMm / 2 + Math.max(0, clearanceMm)
}

/**
 * Находит все подвесы (по их физическим позициям длина/ширина помещения —
 * тот же формат, что hangerLengthWidthPositions в calcP112Frame.ts), которые
 * попадают в запретную полосу хотя бы одного ригеля. Один подвес может
 * попасть в конфликт с несколькими ригелями сразу (даёт несколько записей) —
 * это осознанно, чтобы не терять информацию при подсчёте по каждому ригелю.
 */
export function findHangerBeamConflicts(
  hangerPositions: Array<{ lengthMm: number; widthMm: number }>,
  beams: BeamObstacle[],
  clearanceMm: number,
): HangerConflict[] {
  const conflicts: HangerConflict[] = []
  for (const pos of hangerPositions) {
    for (const beam of beams) {
      const axisPos = beam.axis === 'length' ? pos.lengthMm : pos.widthMm
      if (Math.abs(axisPos - beam.posMm) <= exclusionHalfWidthMm(beam, clearanceMm)) {
        conflicts.push({ lengthMm: pos.lengthMm, widthMm: pos.widthMm, beam })
      }
    }
  }
  return conflicts
}

/** Число уникальных подвесов в конфликте (в отличие от findHangerBeamConflicts,
 *  считает каждую позицию один раз, даже если она задела 2+ ригеля). */
export function countConflictingHangers(conflicts: HangerConflict[]): number {
  const seen = new Set<string>()
  for (const c of conflicts) seen.add(`${c.lengthMm}:${c.widthMm}`)
  return seen.size
}

export interface StepSuggestion {
  stepMm: number
  conflictingHangers: number
}

/**
 * Подбирает шаг подвеса (stepA) без конфликтов с ригелями, ближайший к
 * желаемому — той же формулой позиций, что и реальный расчёт каркаса
 * (calcFrameRowPositions), чтобы предложенный шаг был на 100% тем, что
 * реально применится, а не приближением. Перебор в диапазоне
 * [desiredStepMm - searchRangeMm, +searchRangeMm] с шагом incrementMm,
 * дополнительно ограничен [minStepMm, maxStepMm].
 *
 * Если в диапазоне поиска есть шаг(и) без единого конфликта — возвращает
 * ближайший к desiredStepMm из них. Если чистого варианта не нашлось —
 * возвращает шаг с минимальным числом задетых подвесов (тоже ближайший при
 * равенстве), чтобы дать пользователю хоть какое-то улучшение, а не пусто.
 * beams фильтруются по оси (только совпадающие с axis участвуют — ригель
 * поперёк другой оси на эту сетку не влияет).
 */
export function suggestConflictFreeHangerStep(
  spanMm: number,
  desiredStepMm: number,
  beams: BeamObstacle[],
  axis: BeamObstacleAxis,
  clearanceMm: number,
  opts: { mode?: FrameLayoutMode; wallOffsetMm?: number; profileKind?: FrameProfileKind } = {},
  searchRangeMm = 150,
  incrementMm = 10,
  minStepMm = 300,
  maxStepMm = 1200,
): StepSuggestion | null {
  const relevantBeams = beams.filter(b => b.axis === axis)
  if (relevantBeams.length === 0 || spanMm <= 0) return null

  return suggestConflictFreeStepGeneric(
    desiredStepMm,
    step => {
      const positions = calcFrameRowPositions(spanMm, step, opts)
      return positions.reduce(
        (n, pos) =>
          n +
          (relevantBeams.some(beam => Math.abs(pos - beam.posMm) <= exclusionHalfWidthMm(beam, clearanceMm)) ? 1 : 0),
        0,
      )
    },
    { searchRangeMm, incrementMm, minStepMm, maxStepMm },
  )
}

/**
 * Общий перебор шага без привязки к конкретной геометрии каркаса —
 * evaluateStep(stepMm) должен вернуть число подвесов в конфликте ПРИ ЭТОМ
 * шаге, посчитанное ЧЕСТНО (той же функцией, что и реальный расчёт) — не
 * приближение. Используется suggestConflictFreeHangerStep (прямоугольный
 * каркас, calcFrameRowPositions) и CeilingCalc.tsx для полигонального
 * контура (calcPolygonP112Frame даёт hangerPoints напрямую в локальных
 * (u,v), см. ribBeamsToBeamObstacles.ts — та же система координат).
 *
 * Раздельно от suggestConflictFreeHangerStep, а не единственная реализация
 * "снизу", чтобы не тянуть тяжёлый calcPolygonP112Frame (весь каркас
 * произвольного контура) в модуль, которому в прямоугольном случае это не
 * нужно — сюда передаётся уже готовое число конфликтов.
 */
export function suggestConflictFreeStepGeneric(
  desiredStepMm: number,
  evaluateStep: (stepMm: number) => number,
  opts: { searchRangeMm?: number; incrementMm?: number; minStepMm?: number; maxStepMm?: number } = {},
): StepSuggestion | null {
  const { searchRangeMm = 150, incrementMm = 10, minStepMm = 300, maxStepMm = 1200 } = opts
  if (desiredStepMm <= 0) return null

  const lo = Math.max(minStepMm, desiredStepMm - searchRangeMm)
  const hi = Math.min(maxStepMm, desiredStepMm + searchRangeMm)
  if (lo > hi) return null

  let best: StepSuggestion | null = null
  // Округляем до incrementMm от lo, чтобы сетка перебора была стабильной
  // независимо от desiredStepMm (не влияет на корректность, только на то,
  // какие именно значения проверяются).
  const start = Math.ceil(lo / incrementMm) * incrementMm
  for (let step = start; step <= hi; step += incrementMm) {
    const candidate: StepSuggestion = { stepMm: step, conflictingHangers: evaluateStep(step) }
    if (
      !best ||
      candidate.conflictingHangers < best.conflictingHangers ||
      (candidate.conflictingHangers === best.conflictingHangers &&
        Math.abs(candidate.stepMm - desiredStepMm) < Math.abs(best.stepMm - desiredStepMm))
    ) {
      best = candidate
    }
  }
  return best
}
