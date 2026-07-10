/**
 * Универсальные 2D-геометрические примитивы проекта.
 *
 * Не привязаны к конкретному материалу (ГКЛ/ГВЛ/Сапфир/Аквамарин) и не
 * привязаны к профилю стены — это общий геометрический инструментарий,
 * который может пригодиться в любом раскрое или разметке, где нужно
 * обрезать прямоугольную заготовку наклонной линией.
 *
 * Профильная геометрия САМОЙ СТЕНЫ (уклон/ступени по её длине, интеграл
 * высоты и т.п.) — в profileGeometry.ts, он использует эти примитивы
 * как строительные блоки, а не наоборот.
 *
 * Примечание: дуга по хорде и стреле (арки, гнутые перегородки) — есть,
 * см. `arcFromChordAndSagitta`. Скруглённые углы и произвольные окружности
 * (не по хорде+стреле, а, например, пересечение отрезка с окружностью)
 * пока не реализованы — когда понадобятся, им место тоже здесь.
 */

export interface Point2D {
  x: number
  y: number
}

/** Площадь многоугольника (формула Гаусса/шнурков). Точки — по контуру,
 *  порядок обхода (по часовой/против часовой) не важен. */
export function polygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/** Периметр замкнутого многоугольника — сумма длин сторон по контуру
 *  (последняя точка соединяется с первой). Порядок обхода не важен. */
export function polygonPerimeter(points: Point2D[]): number {
  if (points.length < 2) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return sum
}

/** Одна сторона замкнутого многоугольника — для UI-выбора "с какой стены
 *  начинать раскладку" (см. CeilingCalc.tsx, пункт 5 плана по потолкам). */
export interface PolygonSide {
  /** Индекс стороны по порядку обхода контура (0 — от первой точки до второй). */
  index: number
  start: Point2D
  end: Point2D
  lengthMm: number
}

/** Разбивает замкнутый многоугольник на стороны (рёбра) — точка i к точке
 *  i+1, последняя точка замыкается на первую. Порядок обхода сохраняется
 *  как есть (не нормализуется по часовой/против часовой), стороны короче
 *  1мм пропускаются (защита от дублей/самопересечений при обводке). */
export function polygonSides(points: Point2D[]): PolygonSide[] {
  if (points.length < 2) return []
  const sides: PolygonSide[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const lengthMm = Math.hypot(b.x - a.x, b.y - a.y)
    if (lengthMm < 1) continue
    sides.push({ index: sides.length, start: a, end: b, lengthMm })
  }
  return sides
}

/**
 * Дуга, построенная по хорде (x1,y1)→(x2,y2) и стреле (H в классической
 * формуле R=(L²+H²)/2H, L — половина хорды).
 */
export interface ArcFromChord {
  cx: number
  cy: number
  radius: number
  /** Угол (рад) из центра на первую точку хорды */
  startAngle: number
  /** Угол (рад) из центра на вторую точку хорды */
  endAngle: number
  /**
   * Направление обхода от startAngle к endAngle — передавать БУКВАЛЬНО как
   * параметр `counterclockwise` в CanvasRenderingContext2D.arc()/Konva
   * sceneFunc: 'increasing' → false, 'decreasing' → true. Не путать со
   * "по/против часовой" в жизни — это именно то, чего ждёт canvas API.
   */
  sweepDirection: 'increasing' | 'decreasing'
  /** Угол дуги (рад), всегда положительный, (0, 2π) */
  sweep: number
  /** Длина дуги (не хорды!), в тех же единицах, что и координаты */
  arcLength: number
}

/**
 * Строит дугу по хорде и стреле — той самой H из формулы R=(L²+H²)/2H
 * (L — половина хорды, см. ОПРЕДЕЛЕНИЕ РАДИУСА ДУГИ). Знак sagitta задаёт
 * сторону выгиба: положительный — влево от направления x1→x2 в экранных
 * координатах (Y вниз), отрицательный — вправо. |sagitta| может быть
 * больше половины хорды — тогда получается "глубокая" дуга (больше
 * полуокружности), формула и это считает верно.
 *
 * Возвращает null, если хорда вырождена (x1,y1)≈(x2,y2) или sagitta≈0
 * (в последнем случае линия просто прямая, дуги нет).
 */
export function arcFromChordAndSagitta(
  x1: number, y1: number, x2: number, y2: number, sagitta: number,
): ArcFromChord | null {
  const dx = x2 - x1, dy = y2 - y1
  const chord = Math.hypot(dx, dy)
  const H = Math.abs(sagitta)
  if (chord < 1e-9 || H < 1e-9) return null

  const L = chord / 2
  const R = (L * L + H * H) / (2 * H)
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const ux = dx / chord, uy = dy / chord
  const nx = -uy, ny = ux              // левая нормаль (unit) к направлению x1→x2
  const dirSign = sagitta >= 0 ? 1 : -1

  // Центр — на той же нормали, что и апекс дуги, но по другую сторону
  // хорды на (R-H) (может быть и отрицательным для "глубоких" дуг — тогда
  // центр оказывается по ту же сторону, что и апекс, что тоже верно).
  const cx = mx - dirSign * (R - H) * nx
  const cy = my - dirSign * (R - H) * ny

  const startAngle = Math.atan2(y1 - cy, x1 - cx)
  const endAngle   = Math.atan2(y2 - cy, x2 - cx)
  const apexX = mx + dirSign * H * nx, apexY = my + dirSign * H * ny
  const apexAngle = Math.atan2(apexY - cy, apexX - cx)

  const twoPi = Math.PI * 2
  const norm = (a: number) => ((a % twoPi) + twoPi) % twoPi
  const increasingSweep = norm(endAngle - startAngle)     // обход через РОСТ угла, 0..2π
  const apexOffset = norm(apexAngle - startAngle)

  // Апекс должен лежать на пути обхода — так понимаем, в какую сторону
  // реально нужно обходить (через рост угла или через убывание).
  const goesDecreasing = apexOffset > increasingSweep + 1e-9
  const sweep = goesDecreasing ? (twoPi - increasingSweep) : increasingSweep

  return {
    cx, cy, radius: R, startAngle, endAngle,
    sweepDirection: goesDecreasing ? 'decreasing' : 'increasing',
    sweep,
    arcLength: R * sweep,
  }
}

/**
 * Длина дуги по хорде и стреле — без координат, просто числа (мм или px,
 * главное чтобы обе величины были в одних единицах). sagitta=0 → просто
 * chordLen (линия прямая). Тонкая обёртка над arcFromChordAndSagitta —
 * не дублирует её математику отдельной тригонометрической веткой.
 */
export function arcLengthFromSagitta(chordLen: number, sagitta: number): number {
  const arc = arcFromChordAndSagitta(0, 0, chordLen, 0, sagitta)
  return arc ? arc.arcLength : chordLen
}

/**
 * Обратная задача к arcFromChordAndSagitta: стрела H по хорде и ЖЕЛАЕМОМУ
 * радиусу R (та же формула R=(L²+H²)/2H, решённая относительно H).
 *
 * Важный нюанс геометрии: при R > L (половина хорды) решения ДВА —
 * пологая дуга (deep=false, меньше полуокружности, H = R - √(R²-L²))
 * и глубокая (deep=true, больше полуокружности, H = R + √(R²-L²)).
 * По умолчанию (deep=false) — обычный, "архитектурный" случай.
 * При R = L — одно решение (ровно полуокружность, H = R = L).
 * При R < L — решений нет (хорда физически не влезает в окружность
 * такого маленького радиуса), возвращает null.
 *
 * Практический повод для этой функции: несколько арок на объекте с
 * РАЗНЫМ расстоянием между колоннами (разной хордой), но одним и тем
 * же радиусом R. Если вместо этого задавать одинаковую стрелу H на
 * каждой (что раньше и произошло на реальном объекте) — при разной
 * хорде получается РАЗНЫЙ, никак не связанный друг с другом радиус.
 */
export function sagittaFromRadius(chordLen: number, radius: number, deep = false): number | null {
  const L = Math.abs(chordLen) / 2
  if (radius < L - 1e-9) return null
  const d = Math.sqrt(Math.max(0, radius * radius - L * L))
  return deep ? radius + d : radius - d
}

/**
 * Точки вдоль дуги от начала к концу хорды (включительно), для рисования
 * полилинией на Canvas/Konva или для хитзоны выделения клика мышью.
 */
export function sampleArcPoints(arc: ArcFromChord, segments = 32): Point2D[] {
  const dir = arc.sweepDirection === 'decreasing' ? -1 : 1
  const pts: Point2D[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const a = arc.startAngle + dir * arc.sweep * t
    pts.push({ x: arc.cx + arc.radius * Math.cos(a), y: arc.cy + arc.radius * Math.sin(a) })
  }
  return pts
}

/**
 * Обрезает прямоугольник [x1,x2] × [y1,y2] наклонной верхней границей —
 * прямой линией от точки (x1, topAtX1) до точки (x2, topAtX2).
 * Возвращает то, что остаётся НИЖЕ этой линии — то есть реальный кусок
 * материала, если линия — это уклон потолка (или, отражённая по Y,
 * уклон/ступень пола).
 *
 * Результат:
 * — линия целиком выше y2 на всём участке [x1,x2] → реза нет вообще,
 *   возвращается исходный прямоугольник (4 точки, тот же порядок)
 * — линия целиком ниже y1 → материала здесь нет, пустой массив
 * — иначе — многоугольник (треугольник, трапеция или пятиугольник,
 *   в зависимости от того, где именно линия входит/выходит из
 *   прямоугольника) — 3–5 точек по контуру
 *
 * Общая функция для любого материала, который кроится прямоугольными
 * листами/плитами и обрезается по наклонной границе (уклон стены).
 */
export function clipRectBySlopedTop(
  x1: number, x2: number, y1: number, y2: number,
  topAtX1: number, topAtX2: number,
): Point2D[] {
  if (x2 <= x1 || y2 <= y1) return []

  const lineAt = (x: number) => topAtX1 + (topAtX2 - topAtX1) * (x - x1) / (x2 - x1)
  const EPS = 1e-6
  const isIn = (p: Point2D) => p.y <= lineAt(p.x) + EPS

  // Прямоугольник обходим по контуру: низ-лево → низ-право → верх-право → верх-лево.
  // Стороны прямоугольника всегда либо строго вертикальные, либо строго
  // горизонтальные — этим пользуется intersect() ниже.
  const rect: Point2D[] = [
    { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 },
  ]

  const slope = (topAtX2 - topAtX1) / (x2 - x1)

  const intersect = (a: Point2D, b: Point2D): Point2D => {
    if (a.x === b.x) {
      // Вертикальная сторона — x зафиксирован, ищем y на линии в этой точке
      return { x: a.x, y: lineAt(a.x) }
    }
    // Горизонтальная сторона (a.y === b.y) — ищем x, где lineAt(x) == a.y
    if (slope === 0) return { x: a.x, y: a.y }
    const x = x1 + (a.y - topAtX1) / slope
    return { x, y: a.y }
  }

  // Sutherland–Hodgman, отсечение по одной полуплоскости y <= lineAt(x)
  const out: Point2D[] = []
  for (let i = 0; i < rect.length; i++) {
    const cur = rect[i]
    const prev = rect[(i + rect.length - 1) % rect.length]
    const curIn = isIn(cur)
    const prevIn = isIn(prev)
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersect(prev, cur))
    }
  }
  return out
}

/**
 * Пересечение двух БЕСКОНЕЧНЫХ прямых (каждая задана двумя точками).
 * В отличие от пересечения ОТРЕЗКОВ — неважно, лежит ли точка пересечения
 * в пределах самих отрезков: линия как раз для того и обрезается/
 * продлевается ДО этой точки инструментом "обрезать/продлить".
 *
 * Возвращает null, если прямые параллельны (или совпадают — в этом
 * случае "до какой точки продлевать" не определено).
 */
export function infiniteLineIntersection(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): Point2D | null {
  const d1x = x2 - x1, d1y = y2 - y1
  const d2x = x4 - x3, d2y = y4 - y3
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-9) return null  // параллельны или вырождены
  const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / denom
  return { x: x1 + t * d1x, y: y1 + t * d1y }
}

/**
 * Инструмент "Проём" (клик по стене на плане, см. FloorPlan.tsx,
 * placeOpeningOnLine) — офсет проёма считается ВСЕГДА от точки (x1,y1)
 * линии в данных (PlanOpening.offsetMm), но линия могла быть начерчена
 * с любого конца. Пользователь целится глазом в точку на подложке —
 * эта функция проецирует клик на ось линии и центрирует проём на нём,
 * без ручного счёта "от какого конца я вообще чертил эту стену".
 *
 * @param lineLengthMm  длина линии в мм (для итогового офсета — не px*scale,
 *   чтобы не разойтись с уже сохранённым PlanLine.lengthMm при округлениях)
 * @returns null, если ширина проёма больше длины самой линии (стена слишком короткая)
 */
export function openingOffsetFromClick(
  x1: number, y1: number, x2: number, y2: number, lineLengthMm: number,
  clickX: number, clickY: number, widthMm: number,
): number | null {
  if (widthMm > lineLengthMm) return null
  const dx = x2 - x1, dy = y2 - y1
  const lenPx2 = dx * dx + dy * dy
  if (lenPx2 === 0) return null
  const t = ((clickX - x1) * dx + (clickY - y1) * dy) / lenPx2
  const tClamped = Math.max(0, Math.min(1, t))
  const rawOffsetMm = tClamped * lineLengthMm
  return Math.max(0, Math.min(lineLengthMm - widthMm, rawOffsetMm - widthMm / 2))
}
