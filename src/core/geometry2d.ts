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
 * Точки пересечения линии (axis='y' — горизонтальная, y=fixed; axis='x' —
 * вертикальная, x=fixed) с рёбрами одного или нескольких контуров.
 * Передав [внешний, дырка1, дырка2, ...] одним списком — дырки автоматически
 * обрабатываются по правилу чёт-нечёт (стандартный алгоритм скан-линии для
 * полигона с отверстиями, не требует явно помечать контур как "дырку").
 * Полуоткрытый интервал (a<=fixed && b>fixed) — защита от двойного счёта,
 * когда линия проходит ровно через вершину.
 */
export function scanlineCrossings(loops: Point2D[][], fixed: number, axis: 'x' | 'y'): number[] {
  const cross: number[] = []
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]
      const b = loop[(i + 1) % loop.length]
      const a1 = axis === 'y' ? a.y : a.x
      const b1 = axis === 'y' ? b.y : b.x
      const a2 = axis === 'y' ? a.x : a.y
      const b2 = axis === 'y' ? b.x : b.y
      if ((a1 <= fixed && b1 > fixed) || (b1 <= fixed && a1 > fixed)) {
        const t = (fixed - a1) / (b1 - a1)
        cross.push(a2 + t * (b2 - a2))
      }
    }
  }
  cross.sort((p, q) => p - q)
  return cross
}

/** Отрезки "внутри" контура (с учётом дырок) вдоль линии — пары точек из
 *  scanlineCrossings по правилу чёт-нечёт. Нечётное последнее пересечение
 *  (вырожденный случай — самопересечение/дефект контура) отбрасывается. */
export function insideSegments(loops: Point2D[][], fixed: number, axis: 'x' | 'y'): [number, number][] {
  const xs = scanlineCrossings(loops, fixed, axis)
  const segs: [number, number][] = []
  for (let i = 0; i + 1 < xs.length; i += 2) segs.push([xs[i], xs[i + 1]])
  return segs
}

/** Точка внутри контура (с учётом дырок) — через insideSegments по той же
 *  горизонтали. */
export function pointInPolygon(p: Point2D, loops: Point2D[][]): boolean {
  return insideSegments(loops, p.y, 'y').some(([a, b]) => p.x >= a && p.x <= b)
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
 * Пересечение двух ОТРЕЗКОВ (не бесконечных прямых, см. infiniteLineIntersection
 * для той версии). Возвращает точку и параметры t вдоль каждого отрезка
 * (0=начало, 1=конец), только если пересечение лежит В ПРЕДЕЛАХ обоих
 * отрезков (с небольшим допуском EPS на касание у самого края).
 * null — если отрезки параллельны/коллинеарны (общий случай, коллинеарное
 * перекрытие намеренно не обрабатывается — см. ограничение unionOfTwoQuads)
 * или пересечение вне хотя бы одного из отрезков.
 */
function segmentIntersection(
  a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D,
): { point: Point2D; t: number; u: number } | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-9) return null
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom
  const EPS = 1e-7
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null
  return { point: { x: a1.x + t * d1x, y: a1.y + t * d1y }, t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) }
}

/** Знаковая площадь (без Math.abs) — знак даёт направление обхода:
 *  >0 — против часовой (в математических координатах, Y вверх; при Y вниз
 *  на экране это визуально "по часовой", но для внутренней алгебры важен
 *  только сам факт согласованности знака, не визуальное направление). */
function signedArea(points: Point2D[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** Многоугольник в порядке обхода "против часовой" (по знаку площади) —
 *  внутренний помощник unionOfTwoQuads, чтобы обе фигуры были в едином
 *  соглашении об обходе перед сборкой контура объединения. */
function toCCW(points: Point2D[]): Point2D[] {
  return signedArea(points) < 0 ? [...points].reverse() : points
}

/**
 * Объединение (union) двух выпуклых многоугольников (в частности, двух
 * прямоугольников стены — face+/face- по всей длине, БЕЗ обрезки под
 * стык) — внешний контур их объединения, без произвольно проведённых
 * отрезков: каждое ребро результата лежит либо на настоящей грани A,
 * либо на настоящей грани B. См. KONSPEKT.md 13.07.2026 — правильная
 * замена симметричного митра (applyL) для L-стыков стен разной толщины:
 * текущий митр (пересечение face+/face+ и face-/face-) корректен только
 * при равной толщине, при разной — даёт "флажок" (см. конспект). Union
 * не требует знания, какая сторона интерьер/экстерьер — попутно снимает
 * и этот вопрос для данной задачи.
 *
 * Реализация — общий алгоритм (аналог Вейлера-Азертона для объединения
 * двух простых многоугольников): находит все точки пересечения границ,
 * вставляет их как доп. вершины в обе фигуры, классифицирует получившиеся
 * рёбра-фрагменты по принадлежности "снаружи другой фигуры" (через уже
 * существующий pointInPolygon — чёт-нечётное правило), и обходит только
 * внешние фрагменты, переключаясь между A и B в точках пересечения.
 * Работает не только для строго выпуклых A/B, но выпуклость входа —
 * гарантия того, что результат для двух прямоугольников стен ожидаемо
 * "простой" (без множественных несвязных контуров).
 *
 * Ограничения (см. KONSPEKT.md "Открытые вопросы" — на будущее, не
 * блокирует основной кейс L-стыков под ненулевым углом):
 * — коллинеарное перекрытие рёбер (края A и B лежат на одной прямой на
 *   каком-то участке) не обрабатывается как особый случай — такое рёбро
 *   просто не даёт пересечения (denom≈0 в segmentIntersection), что для
 *   двух стен под РЕАЛЬНЫМ углом (не 0° и не 180°, для которых L-стык
 *   вообще не имеет смысла) не должно возникать;
 * — если границы A и B не пересекаются вовсе (фигуры физически не
 *   соприкасаются) или одна целиком внутри другой — возвращает null,
 *   вызывающий код (applyL) должен предусмотреть откат на старый
 *   симметричный митр как fallback.
 *
 * @returns упорядоченный (против часовой) контур объединения, 4 и более
 *   точек, либо null в вырожденных случаях (см. ограничения выше).
 */
export function unionOfTwoQuads(quadA: Point2D[], quadB: Point2D[]): Point2D[] | null {
  if (quadA.length < 3 || quadB.length < 3) return null
  const A = toCCW(quadA)
  const B = toCCW(quadB)

  // ── шаг 1: все точки пересечения границ A и B ──────────────────────────
  interface Cross { id: number; point: Point2D; edgeA: number; tA: number; edgeB: number; tB: number }
  const rawCrossings: Cross[] = []
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length]
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j], b2 = B[(j + 1) % B.length]
      const hit = segmentIntersection(a1, a2, b1, b2)
      if (hit) rawCrossings.push({ id: -1, point: hit.point, edgeA: i, tA: hit.t, edgeB: j, tB: hit.u })
    }
  }
  if (rawCrossings.length === 0) return null // не соприкасаются — нет объединения-полигона, откат на fallback

  // Дедупликация почти совпадающих точек (напр. пересечение ровно в вершине,
  // засчитанное с двух смежных рёбер) — сливаем в одну с общим id.
  const DEDUP_EPS2 = 1e-4
  const crossings: Cross[] = []
  for (const c of rawCrossings) {
    const dup = crossings.find(k => d2p(k.point, c.point) < DEDUP_EPS2)
    if (dup) continue
    crossings.push({ ...c, id: crossings.length })
  }

  // ── шаг 2: augmented-контуры — исходные вершины + точки пересечения ────
  interface AugVertex { key: string; pt: Point2D }
  function buildAugmented(poly: Point2D[], polyTag: 'A' | 'B'): AugVertex[] {
    const byEdge = new Map<number, Cross[]>()
    for (const c of crossings) {
      const edge = polyTag === 'A' ? c.edgeA : c.edgeB
      if (!byEdge.has(edge)) byEdge.set(edge, [])
      byEdge.get(edge)!.push(c)
    }
    const out: AugVertex[] = []
    for (let i = 0; i < poly.length; i++) {
      out.push({ key: `${polyTag}${i}`, pt: poly[i] })
      const cs = (byEdge.get(i) ?? []).slice().sort((x, y) => {
        const tx = polyTag === 'A' ? x.tA : x.tB
        const ty = polyTag === 'A' ? y.tA : y.tB
        return tx - ty
      })
      for (const c of cs) out.push({ key: `C${c.id}`, pt: c.point })
    }
    return out
  }
  const augA = buildAugmented(A, 'A')
  const augB = buildAugmented(B, 'B')

  // ── шаг 3: классификация фрагментов — снаружи ДРУГОЙ фигуры ли фрагмент ─
  function outsideFragments(aug: AugVertex[], other: Point2D[]): [AugVertex, AugVertex][] {
    const out: [AugVertex, AugVertex][] = []
    for (let i = 0; i < aug.length; i++) {
      const p = aug[i], q = aug[(i + 1) % aug.length]
      if (p.key === q.key) continue // вырожденный (нулевой) фрагмент — пропуск
      const mid = { x: (p.pt.x + q.pt.x) / 2, y: (p.pt.y + q.pt.y) / 2 }
      if (!pointInPolygon(mid, [other])) out.push([p, q])
    }
    return out
  }
  const fragsA = outsideFragments(augA, B)
  const fragsB = outsideFragments(augB, A)
  const allFrags = [...fragsA, ...fragsB]
  if (allFrags.length === 0) return null // одна фигура целиком внутри другой (или наоборот) — откат на fallback

  // ── шаг 4: обход — next[key] = следующая вершина по внешнему контуру ───
  const next = new Map<string, AugVertex>()
  for (const [p, q] of allFrags) next.set(p.key, q)

  const startKey = allFrags[0][0].key
  const contour: Point2D[] = []
  let curKey = startKey
  const seen = new Set<string>()
  for (let guard = 0; guard < allFrags.length + 1; guard++) {
    if (seen.has(curKey)) break
    seen.add(curKey)
    const cur = next.get(curKey)
    if (!cur) return null // разрыв контура (не должно происходить при корректной топологии) — fallback
    contour.push(cur.pt)
    curKey = cur.key
    if (curKey === startKey) break
  }
  if (contour.length < 3 || curKey !== startKey) return null // контур не замкнулся — fallback

  return contour
}

function d2p(a: Point2D, b: Point2D): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
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
