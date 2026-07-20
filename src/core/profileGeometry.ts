import type { EdgeProfile } from '../types'

/**
 * Геометрия переменной высоты перегородки.
 *
 * Потолок и пол — две независимые ломаные линии по длине стены (EdgeProfile).
 * Высота стойки в точке x = ceiling(x) − floor(x), линейная интерполяция
 * между соседними точками каждой ломаной.
 *
 * Обратная совместимость: обычная плоская стена = flatProfile(l, h) для потолка
 * и flatProfile(l, 0) для пола.
 */

export function flatProfile(l: number, y: number): EdgeProfile {
  return [{ x: 0, y }, { x: l, y }]
}

export function sortProfile(profile: EdgeProfile): EdgeProfile {
  return [...profile].sort((a, b) => a.x - b.x)
}

/**
 * Приводит ломаную к корректному виду для расчёта длиной стены l:
 * - сортирует по x
 * - первая точка принудительно x=0, последняя x=l (контролируется UI, но
 *   подстраховываемся на случай рассинхрона после изменения длины стены)
 * - промежуточные точки зажимаются в [0, l]
 * - если точек меньше 2 — плоский профиль на уровне fallbackY
 */
export function normalizeProfile(
  points: EdgeProfile | undefined,
  l: number,
  fallbackY: number
): EdgeProfile {
  if (!points || points.length < 2) return flatProfile(l, fallbackY)
  const sorted = sortProfile(points).map(p => ({
    x: Math.min(Math.max(p.x, 0), l),
    y: p.y,
  }))
  sorted[0] = { ...sorted[0], x: 0 }
  sorted[sorted.length - 1] = { ...sorted[sorted.length - 1], x: l }
  return sorted
}

/**
 * Линейная интерполяция y(x) по ломаной линии.
 * За пределами диапазона точек — клампим к крайней точке.
 * Несколько точек с одинаковым x подряд (вертикальный перепад/ступень) —
 * на самом стыке возвращается y последней из них (правая часть ступени).
 */
export function interpolateY(profile: EdgeProfile, x: number): number {
  if (profile.length === 0) return 0
  const pts = sortProfile(profile)
  if (x <= pts[0].x) return pts[0].y
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y

  // Идём по всем сегментам и берём ПОСЛЕДНИЙ подходящий — на стыке между
  // сегментами (включая нулевую ширину — вертикальную ступень) это даёт
  // правую часть стыка, как и задокументировано.
  let result = pts[pts.length - 1].y
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (x >= a.x && x <= b.x) {
      result = b.x === a.x ? b.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)
    }
  }
  return result
}

/**
 * То же самое, но на стыке вертикальной ступени возвращает ЛЕВУЮ часть
 * (значение ДО перепада), а не правую. Нужна там, где x — это конец
 * отрезка/колонки (а не начало) и физически важно, что было ИМЕННО ДО
 * ступени, а не после (например, правая граница участка ГКЛ, упирающегося
 * в балку/ригель на потолке — высота этого участка должна браться до
 * скачка, а не после).
 * Берём ПЕРВЫЙ подходящий сегмент (а не последний, как в interpolateY) —
 * это и есть сегмент, который заканчивается в x, т.е. левая часть стыка.
 */
export function interpolateYLeft(profile: EdgeProfile, x: number): number {
  if (profile.length === 0) return 0
  const pts = sortProfile(profile)
  if (x <= pts[0].x) return pts[0].y
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (x >= a.x && x <= b.x) {
      return b.x === a.x ? a.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)
    }
  }
  return pts[pts.length - 1].y
}

/** Высота стойки в точке x = потолок(x) − пол(x). */
export function studHeightAt(x: number, ceilingProfile: EdgeProfile, floorProfile: EdgeProfile): number {
  return interpolateY(ceilingProfile, x) - interpolateY(floorProfile, x)
}

/** Высота стойки в точке x, левая часть ступени — см. interpolateYLeft. */
export function studHeightAtLeft(x: number, ceilingProfile: EdgeProfile, floorProfile: EdgeProfile): number {
  return interpolateYLeft(ceilingProfile, x) - interpolateYLeft(floorProfile, x)
}

/**
 * Максимальная высота стойки по всей стене [0, l].
 * Разница двух кусочно-линейных функций сама кусочно-линейна, поэтому
 * экстремум всегда лежит в одной из точек перегиба любого из профилей.
 * На вертикальных ступенях проверяем ОБЕ стороны (до и после перепада) —
 * иначе можно пропустить более высокую сторону ступени.
 */
export function maxStudHeight(ceilingProfile: EdgeProfile, floorProfile: EdgeProfile, l: number): number {
  const xs = new Set<number>([0, l])
  for (const p of ceilingProfile) if (p.x >= 0 && p.x <= l) xs.add(p.x)
  for (const p of floorProfile) if (p.x >= 0 && p.x <= l) xs.add(p.x)
  const heights = [...xs].flatMap(x => [
    studHeightAt(x, ceilingProfile, floorProfile),
    studHeightAtLeft(x, ceilingProfile, floorProfile),
  ])
  return Math.max(...heights)
}

/**
 * Площадь между потолком и полом на участке [from, to] (для ГКЛ), мм².
 * Интегрируем трапециями по точкам перегиба обоих профилей внутри участка.
 */
export function integrateHeight(
  ceilingProfile: EdgeProfile,
  floorProfile: EdgeProfile,
  from: number,
  to: number
): number {
  if (to <= from) return 0
  const xs = new Set<number>([from, to])
  for (const p of ceilingProfile) if (p.x > from && p.x < to) xs.add(p.x)
  for (const p of floorProfile) if (p.x > from && p.x < to) xs.add(p.x)
  const points = [...xs].sort((a, b) => a - b)

  let area = 0
  for (let i = 0; i < points.length - 1; i++) {
    const x0 = points[i], x1 = points[i + 1]
    const h0 = studHeightAt(x0, ceilingProfile, floorProfile)
    const h1 = studHeightAtLeft(x1, ceilingProfile, floorProfile)
    area += (h0 + h1) / 2 * (x1 - x0)
  }
  return area
}

/**
 * Реальная длина ломаной профиля (направляющей) от fromX до toX в мм.
 * При скосе/ступенях возвращает гипотенузу, а не горизонтальную проекцию.
 * Корректно считает вертикальные участки (ступени с dy при одинаковом x).
 * Если профиль не задан (undefined или < 2 точек) — возвращает toX - fromX.
 */
export function profilePathLength(
  profile: EdgeProfile | undefined,
  fromX: number,
  toX: number,
): number {
  if (!profile || profile.length < 2 || toX <= fromX) return Math.max(0, toX - fromX)

  let length = 0

  for (let i = 0; i < profile.length - 1; i++) {
    const p1 = profile[i]
    const p2 = profile[i + 1]

    // Вертикальный участок (ступень): x не меняется, только y
    if (p1.x === p2.x) {
      if (p1.x >= fromX && p1.x <= toX) {
        length += Math.abs(p2.y - p1.y)
      }
      continue
    }

    const segMinX = Math.min(p1.x, p2.x)
    const segMaxX = Math.max(p1.x, p2.x)

    // Сегмент полностью вне диапазона — пропускаем
    if (segMaxX <= fromX || segMinX >= toX) continue

    // Обрезаем до [fromX, toX]
    const clipMin = Math.max(segMinX, fromX)
    const clipMax = Math.min(segMaxX, toX)

    // Интерполируем y на концах обрезанного отрезка
    const t1 = (clipMin - p1.x) / (p2.x - p1.x)
    const t2 = (clipMax - p1.x) / (p2.x - p1.x)
    const y1 = p1.y + t1 * (p2.y - p1.y)
    const y2 = p1.y + t2 * (p2.y - p1.y)

    length += Math.sqrt((clipMax - clipMin) ** 2 + (y2 - y1) ** 2)
  }

  return length
}
