/**
 * inclinedArc3D.ts — геометрия наклонной цилиндрической поверхности для 3D-вида
 * вкладки «Разметка дуги» (27.10.2026). Чистые числа, без three.js.
 *
 * Мировые координаты (метры): X — вдоль хорды от её центра, Y — вверх
 * (верхняя кромка на Y = 0, поверхность уходит вниз), Z — перпендикулярно
 * хорде в сторону выпуклости верхней дуги и дальше, куда сдвинута нижняя кромка.
 *
 * Верхняя кромка: (x, 0, y(x)), y(x) — прогиб дуги плана от хорды.
 * Нижняя кромка: (x, −(drop + δ(x)), y(x) + shift), где δ(x) — просадка
 * (0 в центре, edgeDroop у концов, по параболе). Это точное положение (перенос
 * верхней точки), а не развёртка.
 * Стойки — прямые между точками кромок, расставлены с шагом studStep мм
 * по длине кромки (по развёртке, как в таблице координат).
 */

import { inclinedEdgeTable, validateInclined, type InclinedInput } from './calcInclinedArc'

export interface InclinedSurface3D {
  /** Вершины сетки: (rows+1) рядов × (cols+1) колонок, ряд 0 — верхняя кромка, последний — нижняя. */
  positions: Float32Array
  /** Треугольники (индексы вершин). */
  indices: Uint32Array
  cols: number
  rows: number
  /** Верхняя и нижняя кромки как ломаные [x, y, z, …] (м). */
  topEdge: Float32Array
  bottomEdge: Float32Array
  /** Стойки: пары точек [x0,y0,z0, x1,y1,z1, …] (м). */
  studs: Float32Array
  studCount: number
  /** Габариты по осям, м: [x, y, z]. */
  size: [number, number, number]
}

const MM = 1 / 1000

export function buildInclinedSurface3D(
  input: InclinedInput,
  opts: { cols?: number; rows?: number; studStep?: number } = {},
): InclinedSurface3D | null {
  if (validateInclined(input)) return null
  const cols = Math.max(Math.round(opts.cols ?? 160), 8)
  const rows = Math.max(Math.round(opts.rows ?? 4), 1)
  const { chord, sagitta, drop, shift } = input
  const droop = input.edgeDroop ?? 0
  const R = (chord * chord) / (8 * sagitta) + sagitta / 2
  const yAt = (x: number) => Math.sqrt(Math.max(R * R - (x - chord / 2) ** 2, 0)) - (R - sagitta)
  const dAt = (x: number) => drop + droop * ((x - chord / 2) / (chord / 2)) ** 2

  const top = (x: number): [number, number, number] => [(x - chord / 2) * MM, 0, yAt(x) * MM]
  const bot = (x: number): [number, number, number] => [(x - chord / 2) * MM, -dAt(x) * MM, (yAt(x) + shift) * MM]

  const positions = new Float32Array((rows + 1) * (cols + 1) * 3)
  const topEdge = new Float32Array((cols + 1) * 3)
  const bottomEdge = new Float32Array((cols + 1) * 3)
  for (let c = 0; c <= cols; c++) {
    const x = (chord * c) / cols
    const a = top(x), b = bot(x)
    topEdge.set(a, c * 3)
    bottomEdge.set(b, c * 3)
    for (let r = 0; r <= rows; r++) {
      const t = r / rows
      const o = (r * (cols + 1) + c) * 3
      positions[o] = a[0] + (b[0] - a[0]) * t
      positions[o + 1] = a[1] + (b[1] - a[1]) * t
      positions[o + 2] = a[2] + (b[2] - a[2]) * t
    }
  }
  const indices = new Uint32Array(rows * cols * 6)
  let k = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c, i1 = i0 + 1, i2 = i0 + (cols + 1), i3 = i2 + 1
      indices[k++] = i0; indices[k++] = i2; indices[k++] = i1
      indices[k++] = i1; indices[k++] = i2; indices[k++] = i3
    }
  }

  const studStep = opts.studStep && opts.studStep > 0 ? opts.studStep : 400
  const pts = inclinedEdgeTable(input, studStep)
  const studs = new Float32Array(pts.length * 6)
  pts.forEach((p, i) => { studs.set(top(p.x), i * 6); studs.set(bot(p.x), i * 6 + 3) })

  let minY = 0, maxZ = 0
  for (let i = 1; i < bottomEdge.length; i += 3) minY = Math.min(minY, bottomEdge[i])
  for (let i = 2; i < bottomEdge.length; i += 3) maxZ = Math.max(maxZ, bottomEdge[i])
  return {
    positions, indices, cols, rows, topEdge, bottomEdge, studs, studCount: pts.length,
    size: [chord * MM, -minY, maxZ],
  }
}
