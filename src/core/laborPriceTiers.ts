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

import type { EdgeProfile, Opening } from '../types'
import { interpolateY, interpolateYLeft } from './profileGeometry'

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


/** Площадь по обе стороны горизонтальной отметки (мм от нуля плана), м² */
export interface BoundarySplit {
  belowM2: number
  aboveM2: number
}

/**
 * Площадь стены между полом и потолком, разбитая горизонтальной отметкой
 * boundaryMm (абсолютная отметка, как у профилей потолка/пола — при ровном
 * полу на нуле это просто «высота от пола»). Работает для любых кусочно-
 * линейных профилей потолка и пола (уклон, ломаная, ступени): участок
 * режется в точках перегиба обоих профилей и в точках пересечения отметки,
 * между ними всё линейно, поэтому трапеции дают точный результат.
 *
 * Проёмы (если переданы) считаются прямоугольниками по bounding box и
 * возвращаются отдельно, чтобы вызывающий код сам решил, вычитать ли их.
 */
export function wallAreaByBoundary(
  ceilingProfile: EdgeProfile,
  floorProfile: EdgeProfile,
  lengthMm: number,
  boundaryMm: number,
  openings: Opening[] = [],
): { gross: BoundarySplit; openings: BoundarySplit; net: BoundarySplit } {
  const T = boundaryMm
  const below = (c: number, f: number) => Math.max(0, Math.min(c, T) - Math.min(f, T))
  const above = (c: number, f: number) => Math.max(0, c - Math.max(f, T))

  const xs = new Set<number>([0, lengthMm])
  for (const p of ceilingProfile) if (p.x > 0 && p.x < lengthMm) xs.add(p.x)
  for (const p of floorProfile) if (p.x > 0 && p.x < lengthMm) xs.add(p.x)
  const xsSorted = [...xs].sort((a, b) => a - b)

  let belowMm2 = 0, aboveMm2 = 0
  for (let i = 0; i < xsSorted.length - 1; i++) {
    const a = xsSorted[i], b = xsSorted[i + 1]
    const w = b - a
    if (w <= 0) continue
    // c, f на концах участка: слева — правая часть стыка, справа — левая (ступени)
    const c0 = interpolateY(ceilingProfile, a), c1 = interpolateYLeft(ceilingProfile, b)
    const f0 = interpolateY(floorProfile, a), f1 = interpolateYLeft(floorProfile, b)
    const cAt = (x: number) => c0 + ((x - a) / w) * (c1 - c0)
    const fAt = (x: number) => f0 + ((x - a) / w) * (f1 - f0)
    // точки излома подынтегральных функций: пересечения отметки потолком/полом
    const cuts = [a, b]
    for (const [v0, v1] of [[c0, c1], [f0, f1]] as const) {
      if ((v0 - T) * (v1 - T) < 0) cuts.push(a + ((T - v0) / (v1 - v0)) * w)
    }
    cuts.sort((x, y) => x - y)
    for (let j = 0; j < cuts.length - 1; j++) {
      const x0 = cuts[j], x1 = cuts[j + 1]
      if (x1 <= x0) continue
      belowMm2 += (x1 - x0) * (below(cAt(x0), fAt(x0)) + below(cAt(x1), fAt(x1))) / 2
      aboveMm2 += (x1 - x0) * (above(cAt(x0), fAt(x0)) + above(cAt(x1), fAt(x1))) / 2
    }
  }

  let opBelow = 0, opAbove = 0
  for (const o of openings) {
    const floorY = interpolateY(floorProfile, o.pos + o.width / 2)
    const bottom = floorY + o.sillHeight
    const top = bottom + o.height
    opBelow += o.width * below(top, bottom)
    opAbove += o.width * above(top, bottom)
  }

  const toM2 = (mm2: number) => mm2 / 1_000_000
  const gross = { belowM2: toM2(belowMm2), aboveM2: toM2(aboveMm2) }
  const op = { belowM2: toM2(opBelow), aboveM2: toM2(opAbove) }
  return {
    gross, openings: op,
    net: { belowM2: Math.max(0, gross.belowM2 - op.belowM2), aboveM2: Math.max(0, gross.aboveM2 - op.aboveM2) },
  }
}
