/**
 * laborPriceTiers.ts — разбивка площади/погонажа по ценовым уровням для
 * закрытия объёмов на оплату (обсуждено с Сергеем 04.09.2026). Смотри
 * KONSPEKT.md "роли, права доступа и сметы" — это часть будущего
 * `labor_priced` (см. TASKS.md / estimateAccess.ts, ещё не начат).
 *
 * Правило (со слов Сергея): перегородки/облицовка считаются по площади,
 * колонны (круглые/прямоугольные) — по погонажу высоты (обшивка узкая,
 * площадь никто не меряет). Порог 3000мм режет ОБА случая: часть
 * поверхности/высоты ДО 3000мм — по одной ставке, часть ВЫШЕ — по другой.
 * Для перегородок с уклонным потолком высота непостоянна по длине
 * (EdgeProfile), поэтому режем не саму стену "целиком по одну сторону",
 * а КАЖДУЮ вертикальную полоску по этому порогу и суммируем — один и тот
 * же пролёт может частично попасть в обе ставки (пример Сергея: перегородка
 * 6400мм, высота 4500→5200мм — вся выше порога, но у порога есть смысл,
 * если высота у уклона где-то ныряет ниже 3000).
 *
 * ⚠️ Ставки/порог — намеренно константы для MVP (см. PRICE_TIER_MM/
 * RATE_BELOW_MM_RUB_PER_M2 и т.п. ниже). Когда/если понадобится менять их
 * без правки кода (другой объект, другая цена) — вынести в настройки
 * проекта; этого пока не делаем, чтобы не проектировать вслепую.
 */

import type { EdgeProfile } from '../types'

export const PRICE_TIER_THRESHOLD_MM = 3000

/** Площадь/погонаж, разбитые по двум ценовым уровням (порог см. выше) */
export interface TierSplit {
  belowM2: number   // м², если считаем по площади (перегородки/облицовка)
  aboveM2: number
  belowM: number    // пог.м, если считаем по высоте (колонны)
  aboveM: number
}

function emptySplit(): TierSplit {
  return { belowM2: 0, aboveM2: 0, belowM: 0, aboveM: 0 }
}

function addSplit(a: TierSplit, b: TierSplit): TierSplit {
  return {
    belowM2: a.belowM2 + b.belowM2, aboveM2: a.aboveM2 + b.aboveM2,
    belowM: a.belowM + b.belowM, aboveM: a.aboveM + b.aboveM,
  }
}

/**
 * Площадь одного линейного участка (мм) с высотой, линейно меняющейся от
 * h1 до h2 (мм), разбитая порогом T (мм) на "ниже"/"выше". Каждая
 * вертикальная полоска x даёт min(h(x),T) в нижний уровень и
 * max(h(x)-T,0) в верхний — при пересечении порога внутри отрезка сам
 * отрезок делится в точке пересечения (h(x) линейна и монотонна на отрезке,
 * так что пересечение — не больше одного).
 */
function segmentAreaMm2(h1: number, h2: number, widthMm: number, T: number): { belowMm2: number; aboveMm2: number } {
  if (widthMm <= 0) return { belowMm2: 0, aboveMm2: 0 }
  const bothBelow = h1 <= T && h2 <= T
  const bothAbove = h1 >= T && h2 >= T
  if (bothBelow) return { belowMm2: widthMm * (h1 + h2) / 2, aboveMm2: 0 }
  if (bothAbove) return { belowMm2: widthMm * T, aboveMm2: widthMm * ((h1 - T) + (h2 - T)) / 2 }
  // ровно одно пересечение порога внутри отрезка (h1, h2 по разные стороны от T)
  const t = (T - h1) / (h2 - h1)
  const xCross = t * widthMm
  if (h1 <= T) {
    // растёт через порог: [0,xCross] целиком ниже (h1..T), [xCross,w] целиком выше (T..h2)
    return {
      belowMm2: xCross * (h1 + T) / 2 + (widthMm - xCross) * T,
      aboveMm2: (widthMm - xCross) * (h2 - T) / 2,
    }
  }
  // падает через порог: [0,xCross] целиком выше (h1..T), [xCross,w] целиком ниже (T..h2)
  return {
    belowMm2: xCross * T + (widthMm - xCross) * (T + h2) / 2,
    aboveMm2: xCross * (h1 - T) / 2,
  }
}

/** Ровный профиль без уклона — для стен/облицовки без CeilingSlope */
export function flatEdgeProfile(lengthMm: number, heightMm: number): EdgeProfile {
  return [{ x: 0, y: heightMm }, { x: lengthMm, y: heightMm }]
}

/**
 * Площадь поверхности (перегородка/облицовка) по высотному профилю вдоль
 * длины, разбитая порогом на два ценовых уровня. Точки профиля с
 * одинаковым x подряд (вертикальный перепад/ступень) дают нулевой отрезок —
 * своя площадь в расчёт не идёт (см. общее упрощение проекта для ступеней).
 */
export function areaByPriceTier(profile: EdgeProfile, thresholdMm: number = PRICE_TIER_THRESHOLD_MM): TierSplit {
  let belowMm2 = 0, aboveMm2 = 0
  for (let i = 0; i < profile.length - 1; i++) {
    const p1 = profile[i], p2 = profile[i + 1]
    const seg = segmentAreaMm2(p1.y, p2.y, p2.x - p1.x, thresholdMm)
    belowMm2 += seg.belowMm2
    aboveMm2 += seg.aboveMm2
  }
  return { belowM2: belowMm2 / 1_000_000, aboveM2: aboveMm2 / 1_000_000, belowM: 0, aboveM: 0 }
}

/**
 * Погонаж одной колонны (высота heightMm — одно число, из
 * ceilingSlopeHeightAt в точке центра колонны, без профиля), разбитый
 * порогом на два ценовых уровня.
 */
export function columnRunByPriceTier(heightMm: number, thresholdMm: number = PRICE_TIER_THRESHOLD_MM): TierSplit {
  const belowMm = Math.min(heightMm, thresholdMm)
  const aboveMm = Math.max(heightMm - thresholdMm, 0)
  return { belowM2: 0, aboveM2: 0, belowM: belowMm / 1000, aboveM: aboveMm / 1000 }
}

/** Суммирует несколько разбивок (по всем перегородкам/облицовкам/колоннам объекта) */
export function sumTierSplits(splits: TierSplit[]): TierSplit {
  return splits.reduce(addSplit, emptySplit())
}

/** Итоговая сумма в рублях по разбивке и двум ставкам (площадь и погонаж — одна и та же пара ставок, руб/м² и руб/пог.м численно совпадают по правилу Сергея, но это два разных смысла, поэтому split хранит оба) */
export function tierSplitCost(split: TierSplit, rateBelow: number, rateAbove: number): number {
  return (split.belowM2 + split.belowM) * rateBelow + (split.aboveM2 + split.aboveM) * rateAbove
}
