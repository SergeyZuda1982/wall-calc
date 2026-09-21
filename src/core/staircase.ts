/**
 * staircase.ts — чистая геометрия винтовой лестницы (Фаза 4 объекта в
 * Ростове, 20.09.2026, начали с винтовой — см. TASKS.md). Тот же принцип,
 * что уже применялся для аппроксимации окружности колонны 24-угольником
 * (columnStamp.ts, roundColumnPolygonPx) и для аппроксимации дуги N
 * сегментами (geometry2d.ts, sampleArcPoints) — здесь обобщён на "разбить
 * угловой ДИАПАЗОН на N шагов, с интерполяцией высоты по каждому шагу".
 * Сознательно вынесено в отдельный переиспользуемый приём, а не
 * продублировано внутри staircaseTo3D — тело дуги в T-стыке (открытый
 * пункт Фазы 3) — вероятный следующий потребитель того же приёма.
 *
 * Первый инкремент (см. TASKS.md "В работе"): только геометрия ступеней
 * винтовой лестницы. НЕ входит в этот файл: стыковка со стенами клетки,
 * материалы/раскрой проступей, прямомаршевый тип — каждое отдельной
 * будущей задачей.
 */

export interface Point2D {
  x: number
  y: number
}

/** мм → px по масштабу плана (мм на 1px) — та же конвенция, что в columnStamp.ts */
export function mmToPx(mm: number, scaleMmPx: number): number {
  return scaleMmPx > 0 ? mm / scaleMmPx : 0
}

/**
 * Число ступеней и фактическая высота подступенка по общему перепаду
 * высоты и ЖЕЛАЕМОЙ высоте подступенка — та же идея, что у
 * resolveRibBeamDropMm (core/ceilingSlope.ts): пользователь один раз
 * задаёт целевой параметр (там — отметку низа, здесь — комфортный
 * подступёнок), число ступеней подгоняется под целое так, чтобы
 * фактический подступёнок был БЛИЖАЙШИМ к целевому (не обязательно
 * меньше/больше — округление до ближайшего целого числа ступеней), и
 * лестница ровно попадает в реальный перепад высоты без "хвоста".
 *
 * totalHeightMm ≤ 0 или targetRiserMm ≤ 0 — вырожденный случай, возвращает
 * stepCount: 0 (вызывающий код должен считать лестницу неприменимой в
 * этой точке, а не рисовать 0 ступеней как валидную геометрию).
 */
export interface StaircaseStepsResolution {
  stepCount: number
  actualRiserMm: number
}

export function resolveStaircaseSteps(
  totalHeightMm: number,
  targetRiserMm: number,
): StaircaseStepsResolution {
  if (!(totalHeightMm > 0) || !(targetRiserMm > 0)) {
    return { stepCount: 0, actualRiserMm: 0 }
  }
  const rawCount = totalHeightMm / targetRiserMm
  const stepCount = Math.max(1, Math.round(rawCount))
  return { stepCount, actualRiserMm: totalHeightMm / stepCount }
}

/** Угловой диапазон одной ступени (радианы), знак totalAngleRad задаёт направление обхода. */
export interface StepAngleRange {
  angleFromRad: number
  angleToRad: number
}

/**
 * Угловые границы каждой ступени, равномерно поделив totalAngleRad на
 * stepCount шагов начиная с startAngleRad. totalAngleRad может быть
 * отрицательным (обход против часовой стрелки в экранных координатах,
 * Y вниз, тот же atan2-space, что и angleTo/columnStamp.ts) — знак
 * сохраняется в разнице angleToRad-angleFromRad каждого шага, так что
 * вызывающему коду не нужно отдельно передавать direction.
 *
 * stepCount ≤ 0 — пустой массив (вырожденная лестница, см.
 * resolveStaircaseSteps выше).
 */
export function spiralStepAngles(
  startAngleRad: number,
  totalAngleRad: number,
  stepCount: number,
): StepAngleRange[] {
  if (stepCount <= 0) return []
  const stepAngle = totalAngleRad / stepCount
  const ranges: StepAngleRange[] = []
  for (let i = 0; i < stepCount; i++) {
    ranges.push({
      angleFromRad: startAngleRad + i * stepAngle,
      angleToRad: startAngleRad + (i + 1) * stepAngle,
    })
  }
  return ranges
}

/**
 * Полигон одной клиновидной ступени (px) — сектор кольца между
 * innerRadiusPx и outerRadiusPx, от angleFromRad до angleToRad. Дуги
 * внешней и внутренней границ аппроксимированы arcSegments прямыми
 * отрезками каждая (по умолчанию 4 — ступень занимает малую долю полного
 * оборота, в отличие от колонны, которой нужны все 24 сегмента на полный
 * круг; 4 сегмента на типичный шаг ~15-20° дают ту же угловую плотность,
 * что 24 сегмента на 360°).
 *
 * innerRadiusPx может быть 0 — тогда внутренняя дуга вырождается в одну
 * точку (центр), сектор становится треугольным клином, а не кольцевым —
 * геометрически корректно для лестницы без центральной стойки/столба.
 *
 * Обход вершин: внешняя дуга от angleFrom к angleTo, затем внутренняя
 * дуга обратно от angleTo к angleFrom — обычный порядок для замкнутого
 * кольцевого сектора (совместим с той же конвенцией обхода по часовой
 * стрелке в экранных координатах, что и rectColumnCornersPx).
 */
export function spiralStepSectorPx(
  cx: number, cy: number,
  innerRadiusPx: number, outerRadiusPx: number,
  angleFromRad: number, angleToRad: number,
  arcSegments = 4,
): Point2D[] {
  const pts: Point2D[] = []
  for (let i = 0; i <= arcSegments; i++) {
    const t = i / arcSegments
    const a = angleFromRad + (angleToRad - angleFromRad) * t
    pts.push({ x: cx + outerRadiusPx * Math.cos(a), y: cy + outerRadiusPx * Math.sin(a) })
  }
  if (innerRadiusPx <= 1e-9) {
    // Вырожденная внутренняя дуга — клин сходится в центр одной точкой,
    // а не полноценной дугой (иначе получился бы вырожденный "нулевой"
    // сегмент дуги в каждой из arcSegments точек одного и того же центра).
    pts.push({ x: cx, y: cy })
    return pts
  }
  for (let i = 0; i <= arcSegments; i++) {
    const t = i / arcSegments
    const a = angleToRad + (angleFromRad - angleToRad) * t
    pts.push({ x: cx + innerRadiusPx * Math.cos(a), y: cy + innerRadiusPx * Math.sin(a) })
  }
  return pts
}
