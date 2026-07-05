/**
 * columnStamp.ts — чистая геометрия для штампа шаблонов колонн (без Konva/React).
 *
 * Прямоугольная колонна задаётся центром + шириной/глубиной (мм) + углом
 * поворота вокруг центра (радианы, 0 = ширина вдоль оси X плана). Штамповка
 * генерирует 4 угла прямоугольника в px — дальше они превращаются в 4
 * PlanLine (wall_existing), которые для остального кода неотличимы от
 * нарисованных вручную (см. FloorPlan.tsx, режим 'stamp').
 */

export interface Point2D {
  x: number
  y: number
}

/** мм → px по масштабу плана (мм на 1px) */
export function mmToPx(mm: number, scaleMmPx: number): number {
  return scaleMmPx > 0 ? mm / scaleMmPx : 0
}

/**
 * Углы прямоугольника (px), по порядку обхода (по часовой стрелке в
 * экранных координатах, где Y растёт вниз) — так же, как их обходит
 * рисование карандашом/цепочкой стен: p0 → p1 → p2 → p3 → (замыкание на p0).
 *
 * widthMm — размер вдоль направления angleRad, depthMm — поперёк.
 */
export function rectColumnCornersPx(
  cx: number, cy: number,
  widthMm: number, depthMm: number,
  angleRad: number,
  scaleMmPx: number,
): [Point2D, Point2D, Point2D, Point2D] {
  const hw = mmToPx(widthMm, scaleMmPx) / 2
  const hd = mmToPx(depthMm, scaleMmPx) / 2
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)

  // Локальные углы прямоугольника (до поворота), обход по часовой стрелке
  // в экранных координатах (Y вниз): (-hw,-hd) → (hw,-hd) → (hw,hd) → (-hw,hd)
  const local: Point2D[] = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ]

  return local.map(p => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  })) as [Point2D, Point2D, Point2D, Point2D]
}

/** Угол (радианы) от центра к точке — как в handleStageClick/atan2 (Y вниз, стандартный screen-space atan2) */
export function angleTo(cx: number, cy: number, x: number, y: number): number {
  return Math.atan2(y - cy, x - cx)
}

/**
 * Привязка угла к шагу stepDeg градусов (по умолчанию 15°) — Shift во
 * время штамповки прямоугольной колонны, аналогично orthoMode в draw.
 */
export function snapAngleToStep(angleRad: number, stepDeg = 15): number {
  const stepRad = (stepDeg * Math.PI) / 180
  return Math.round(angleRad / stepRad) * stepRad
}

/**
 * Снап центра новой колонны в ряд с уже поставленными — Ctrl во время
 * штамповки, аналогично orthoMode (⊾ 90°) для черчения линий. Проблема
 * без этого: на объекте десятки одинаковых колонн, вручную попасть точно
 * в один ряд по X или Y почти нереально — колонна чуть съезжает в сторону.
 *
 * Берём ближайшую уже поставленную колонну (по прямому расстоянию центров)
 * и прилипаем к той её координате (X или Y), по которой курсор уже ближе —
 * то есть достраиваем ряд в том направлении, в котором он уже начат.
 * Если колонн ещё нет — возвращаем точку без изменений (нечему прилипать).
 */
/** Ближайшая уже поставленная колонна к точке (для превью-линии снапа в ряд) */
export function nearestColumnCenter(
  x: number, y: number,
  existing: { cx: number; cy: number }[],
): { cx: number; cy: number } | null {
  if (existing.length === 0) return null
  let nearest = existing[0]
  let bestDist = Infinity
  for (const c of existing) {
    const d = Math.hypot(c.cx - x, c.cy - y)
    if (d < bestDist) { bestDist = d; nearest = c }
  }
  return nearest
}

export function snapToColumnRow(
  x: number, y: number,
  existing: { cx: number; cy: number }[],
): Point2D {
  const nearest = nearestColumnCenter(x, y, existing)
  if (!nearest) return { x, y }
  const dx = Math.abs(nearest.cx - x)
  const dy = Math.abs(nearest.cy - y)
  return dx <= dy ? { x: nearest.cx, y } : { x, y: nearest.cy }
}


export function rectPerimeterMm(widthMm: number, depthMm: number): number {
  return 2 * (widthMm + depthMm)
}

/** Площадь прямоугольника (м²) — для заполнения Room.areaM2 */
export function rectAreaM2(widthMm: number, depthMm: number): number {
  return (widthMm / 1000) * (depthMm / 1000)
}
