/**
 * calcInclinedArc.ts — дуга на наклонной цилиндрической поверхности (27.10.2026).
 *
 * Случай: верхняя и нижняя кромки поверхности — одинаковые дуги в плане
 * (хорда c, стрела s), нижняя получена переносом верхней на `shift` мм по
 * горизонтали (перпендикулярно хорде) и `drop` мм вниз. Такая поверхность
 * цилиндрическая (развёртываемая): все стойки параллельны и одной длины
 * L = √(shift² + drop²), лист ложится без складок.
 *
 * Углы: sin α = drop / L, cos α = shift / L (α — наклон стоек к горизонту).
 *
 * Развёртка: u — длина по сечению поверхности, перпендикулярному стойкам,
 * w — координата вдоль стоек. Точка дуги плана (x вдоль хорды, y — прогиб от
 * хорды) попадает в развёртку в (u(x), y·cos α), где
 *   u'(x) = √(1 + (sin α · y'(x))²).
 * Кромка в развёртке — дуга, близкая к круговой (отклонение от окружности
 * по хорде/стреле ниже ≈1 мм на 20 м): хорда = полная длина u, стрела = s·cos α.
 * Нижняя кромка — та же кривая, сдвинутая на L вдоль w.
 */

export interface InclinedInput {
  /** Хорда дуги в плане, мм. */
  chord: number
  /** Стрела дуги в плане, мм. */
  sagitta: number
  /** Опуск от верхней кромки до нижней по вертикали, мм. */
  drop: number
  /** Расстояние между дугами по горизонтали (перпендикулярно хорде), мм. */
  shift: number
  /**
   * Просадка нижней кромки у краёв относительно центра, мм по вертикали
   * (неровный потолок: в центре опуск `drop`, у концов `drop + edgeDroop`,
   * между ними по параболе). Верхняя кромка не меняется. По умолчанию 0.
   */
  edgeDroop?: number
  /**
   * Стрела нижней дуги в плане, мм (по умолчанию равна `sagitta` — дуги одинаковые).
   * Хорда та же. Расстояние `shift` — между вершинами дуг (центр к центру), поэтому у краёв
   * расстояние между дугами по горизонтали равно shift − (bottomSagitta − sagitta).
   * Нижняя дуга выпуклее верхней (стрела больше) → стойки у краёв короче, и наоборот.
   * Первый порядок: при разных стрелах поверхность строго не цилиндрическая.
   */
  bottomSagitta?: number
}

export interface InclinedResult {
  /** Длина стойки по наклону, мм. */
  rulingLength: number
  sinA: number
  cosA: number
  /** Угол наклона стоек к горизонту, градусы. */
  angleDeg: number
  /** Радиус дуги в плане, мм. */
  planRadius: number
  /** Длина дуги в плане, мм. */
  planArcLength: number
  /** Длина кромки по поверхности (по сечению ⟂ стоек), мм. Хорда развёртки. */
  devChord: number
  /** Стрела сечения ⟂ стоек = s·sin α, мм. */
  sagittaAcross: number
  /** Стрела кромки в развёртке = s·cos α, мм. */
  devSagitta: number
  /** Радиус круговой аппроксимации кромки в развёртке, мм. */
  devRadius: number
  /** Площадь одной стороны поверхности, м². */
  areaM2: number
  /** Добавка к длине стойки у краёв, мм: просадка (edgeDroop · sin α) минус разница стрел (Δs · cos α). Может быть < 0. */
  droopAlong: number
  /** Длина стойки у краёв, мм. */
  rulingLengthEdge: number
}

export interface InclinedPoint {
  /** Положение вдоль развёртки от левого конца, мм. */
  u: number
  /** Ордината верхней кромки от хорды развёртки (к выпуклости), мм. */
  w: number
  /** Ордината нижней кромки от той же хорды: w + L + просадка по параболе, мм. */
  wBottom: number
  /** Положение в плане вдоль хорды от левого конца, мм. */
  x: number
  /** Прогиб в плане от хорды, мм. */
  y: number
}

export function validateInclined(i: InclinedInput): string | null {
  if (!(i.chord > 0)) return 'Хорда должна быть больше 0'
  if (!(i.sagitta > 0 && i.sagitta <= i.chord / 2)) return 'Стрела должна быть от 0 до половины хорды'
  if (!(i.drop > 0)) return 'Опуск должен быть больше 0'
  if (i.edgeDroop !== undefined && !(i.edgeDroop >= 0)) return 'Просадка нижней кромки не может быть отрицательной'
  if (i.bottomSagitta !== undefined) {
    if (!(i.bottomSagitta > 0 && i.bottomSagitta <= i.chord / 2)) return 'Стрела нижней дуги должна быть от 0 до половины хорды'
    if (!(i.shift - (i.bottomSagitta - i.sagitta) > 0)) return 'Нижняя дуга слишком выпуклая: у краёв расстояние между дугами по горизонтали становится ≤ 0'
  }
  if (!(i.shift > 0)) return 'Расстояние между дугами по горизонтали должно быть больше 0 (при 0 поверхность вертикальная, и дуга на развёртке — прямая)'
  return null
}

const planRadiusOf = (c: number, s: number) => (c * c) / (8 * s) + s / 2

/** Добавка к длине стойки у краёв: просадка и разница стрел (первый порядок). */
function edgeAlongOf(i: InclinedInput, sinA: number, cosA: number): number {
  const dS = (i.bottomSagitta ?? i.sagitta) - i.sagitta
  return (i.edgeDroop ?? 0) * sinA - dS * cosA
}

/** Кумулятивная длина u вдоль хорды: таблица узлов по x ∈ [0, chord]. */
function buildU(i: InclinedInput, n: number): { xs: Float64Array; us: Float64Array } {
  const R = planRadiusOf(i.chord, i.sagitta)
  const L = Math.hypot(i.shift, i.drop)
  const sinA = i.drop / L
  const yAt = (x: number) => Math.sqrt(Math.max(R * R - (x - i.chord / 2) ** 2, 0)) - (R - i.sagitta)
  const xs = new Float64Array(n + 1)
  const us = new Float64Array(n + 1)
  for (let k = 0; k <= n; k++) xs[k] = (i.chord * k) / n
  for (let k = 1; k <= n; k++) {
    const dy = yAt(xs[k]) - yAt(xs[k - 1])
    us[k] = us[k - 1] + Math.hypot(xs[k] - xs[k - 1], dy * sinA)
  }
  return { xs, us }
}

export function calcInclined(i: InclinedInput): InclinedResult {
  const R = planRadiusOf(i.chord, i.sagitta)
  const L = Math.hypot(i.shift, i.drop)
  const sinA = i.drop / L
  const cosA = i.shift / L
  const theta = Math.asin(Math.min(i.chord / 2 / R, 1))
  const { us } = buildU(i, 8000)
  const devChord = us[us.length - 1]
  const droopAlong = edgeAlongOf(i, sinA, cosA)
  const devSagitta = i.sagitta * cosA
  const devRadius = devSagitta > 0 ? (devChord * devChord) / (8 * devSagitta) + devSagitta / 2 : Infinity
  return {
    rulingLength: L, sinA, cosA, angleDeg: (Math.atan2(i.drop, i.shift) * 180) / Math.PI,
    planRadius: R, planArcLength: 2 * R * theta,
    devChord, sagittaAcross: i.sagitta * sinA, devSagitta, devRadius,
    // параболическая добавка: среднее по длине = 1/3 от краевого значения
    areaM2: (devChord * (L + droopAlong / 3)) / 1e6,
    droopAlong, rulingLengthEdge: L + droopAlong,
  }
}

/**
 * Точки кромки в развёртке через каждые stepU мм по u (точное положение, не по
 * аппроксимирующей окружности), включая оба конца.
 */
export function inclinedEdgeTable(i: InclinedInput, stepU: number): InclinedPoint[] {
  const n = 8000
  const R = planRadiusOf(i.chord, i.sagitta)
  const L = Math.hypot(i.shift, i.drop)
  const cosA = i.shift / L
  const droopAlong = edgeAlongOf(i, i.drop / L, cosA)
  const { xs, us } = buildU(i, n)
  const total = us[n]
  const yAt = (x: number) => Math.sqrt(Math.max(R * R - (x - i.chord / 2) ** 2, 0)) - (R - i.sagitta)
  const step = Math.max(stepU, 1)
  const targets: number[] = []
  for (let u = 0; u < total - 1e-6; u += step) targets.push(u)
  targets.push(total)
  let k = 0
  return targets.map(u => {
    while (k < n - 1 && us[k + 1] < u) k++
    const du = us[k + 1] - us[k]
    const f = du > 0 ? (u - us[k]) / du : 0
    const x = xs[k] + f * (xs[k + 1] - xs[k])
    const y = yAt(x)
    const t = (u - total / 2) / (total / 2)
    const w = y * cosA
    return {
      u: Math.round(u * 10) / 10, w: Math.round(w * 10) / 10,
      wBottom: Math.round((w + L + droopAlong * t * t) * 10) / 10,
      x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
    }
  })
}
