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

/**
 * МАРШЕВАЯ лестница (Фаза 4 объекта в Ростове, второй инкремент,
 * 20.09.2026, см. types/index.ts StraightRunStaircase). Тот же общий
 * подступёнок на ВСЮ лестницу (не свой на каждый марш — так гарантированно
 * получается физически осмысленная лестница, одинаковый подступёнок на
 * всех маршах, как в реальности), а число ступеней РАСПРЕДЕЛЯЕТСЯ между
 * маршами пропорционально их длине в плане (методом наибольших остатков —
 * тот же принцип раскладки целых долей, что часто применяется для мест в
 * пропорциональных избирательных системах, здесь просто гарантирует, что
 * сумма ступеней по маршам ТОЧНО равна общему числу ступеней, без потери/
 * лишней ступени от округления каждого марша по отдельности).
 *
 * Площадки (flightLengthsPx с length=0, т.е. НЕ марши) сюда не передаются
 * вообще — вызывающий код (planTo3D.ts) фильтрует segments на marши перед
 * вызовом, эта функция работает только с длинами маршей.
 *
 * Марш с itemLength=0 (вырожденный, нулевая длина) получает 0 ступеней —
 * не может быть меньше нуля, но и гарантированного минимума 1 для НЕГО
 * нет (в отличие от остальных маршей с положительной длиной, которые
 * гарантированно получают хотя бы 1 ступень, если totalStepCount>0 и
 * marшей не больше totalStepCount).
 */
export interface StraightRunStepsResolution {
  totalStepCount: number
  actualRiserMm: number
  stepsPerFlight: number[] // тот же порядок и длина, что flightLengthsPx
}

export function resolveStraightRunSteps(
  totalHeightMm: number,
  targetRiserMm: number,
  flightLengthsPx: number[],
): StraightRunStepsResolution {
  const { stepCount: totalStepCount, actualRiserMm } = resolveStaircaseSteps(totalHeightMm, targetRiserMm)
  if (totalStepCount === 0 || flightLengthsPx.length === 0) {
    return { totalStepCount: 0, actualRiserMm: 0, stepsPerFlight: flightLengthsPx.map(() => 0) }
  }
  const totalLen = flightLengthsPx.reduce((s, l) => s + Math.max(0, l), 0)
  if (totalLen <= 0) {
    return { totalStepCount, actualRiserMm, stepsPerFlight: flightLengthsPx.map(() => 0) }
  }
  // Наибольшие остатки: сначала floor от пропорциональной доли каждого
  // марша, затем недостающие ступени (totalStepCount минус сумма floor'ов)
  // раздаются по одной маршам с САМОЙ БОЛЬШОЙ дробной частью — гарантирует
  // точную сумму без систематического смещения в пользу первых/последних
  // маршей (в отличие от, например, простого "остаток — последнему маршу").
  const raw = flightLengthsPx.map(l => (totalStepCount * Math.max(0, l)) / totalLen)
  const floors = raw.map(Math.floor)
  let remainder = totalStepCount - floors.reduce((s, f) => s + f, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)
  const stepsPerFlight = [...floors]
  for (let k = 0; k < order.length && remainder > 0; k++) {
    if (flightLengthsPx[order[k].i] <= 0) continue // марш нулевой длины ступень не получает
    stepsPerFlight[order[k].i]++
    remainder--
  }
  return { totalStepCount, actualRiserMm, stepsPerFlight }
}

/**
 * Прямоугольник одной ступени марша (px) — марш идёт от (x1,y1) к (x2,y2)
 * (направление подъёма), stepIndex-я ступень занимает долю
 * [stepIndex/stepCount .. (stepIndex+1)/stepCount] длины марша, во всю
 * ширину widthPx, симметрично относительно осевой линии марша.
 *
 * Вырожденный марш (x1,y1)=(x2,y2) — нулевая длина — возвращает вырожденный
 * прямоугольник (все 4 точки совпадают с (x1,y1)); вызывающий код такие
 * марши уже отсеивает через stepCount=0 в resolveStraightRunSteps выше, но
 * функция не падает и на настоящем нулевом векторе.
 */
export function flightStepRectPx(
  x1: number, y1: number, x2: number, y2: number,
  widthPx: number, stepIndex: number, stepCount: number,
): Point2D[] {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 1e-9 || stepCount <= 0) return [{ x: x1, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y1 }]
  const ux = dx / len, uy = dy / len   // вдоль марша
  const px = -uy, py = ux              // перпендикуляр (влево от направления подъёма)
  const half = widthPx / 2
  const sAlong = (stepIndex / stepCount) * len
  const eAlong = ((stepIndex + 1) / stepCount) * len
  const sx = x1 + ux * sAlong, sy = y1 + uy * sAlong
  const ex = x1 + ux * eAlong, ey = y1 + uy * eAlong
  return [
    { x: sx + px * half, y: sy + py * half },
    { x: ex + px * half, y: ey + py * half },
    { x: ex - px * half, y: ey - py * half },
    { x: sx - px * half, y: sy - py * half },
  ]
}
