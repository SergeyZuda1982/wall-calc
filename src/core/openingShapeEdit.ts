/**
 * Чистые функции редактирования OpeningShape для числового инспектора формы
 * проёма (Фаза 4a 2D-солвера, см. KONSPEKT.md / TASKS.md, 03.09.2026).
 *
 * Никакого нового представления не вводим — та же конвенция, что и для
 * линий стен: вершины + стрела дуги на ребро (sagittaMm), см. geometry2d.ts.
 * Косой срез (фаска) — это НЕ отдельный тип ребра, а просто прямое ребро
 * между обычными вершинами (добавил вершину, подвинул — получил скос).
 *
 * Намеренное упрощение: вставка/удаление вершины СБРАСЫВАЕТ все стрелы дуг
 * контура (edges → undefined, все рёбра становятся прямыми). Индекс ребра —
 * это позиция в массиве (edges[i] = points[i]→points[i+1]), при вставке/
 * удалении вершины она бы поехала для части рёбер — сброс проще и безопаснее
 * частичного переноса, а вставка/удаление вершины — редкое действие
 * (форма обычно правится через X/Y и стрелу, не через число вершин).
 */

import type { OpeningShape, OpeningShapeEdge, Point2D } from './geometry2d'

export const MIN_OPENING_SHAPE_VERTICES = 3

/** Прямоугольная форма по умолчанию — bounding box [0,width]×[0,height],
 *  обход по часовой начиная с левого нижнего угла. Без рёбер (все прямые) —
 *  эквивалентно отсутствию shape, но уже как редактируемый список вершин. */
export function defaultOpeningShape(width: number, height: number): OpeningShape {
  return {
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  }
}

/** Меняет координаты одной вершины (X и/или Y — можно только одно из двух).
 *  Рёбра/стрелы дуг не трогает. */
export function updateOpeningShapePoint(
  shape: OpeningShape, index: number, patch: Partial<Point2D>,
): OpeningShape {
  if (index < 0 || index >= shape.points.length) return shape
  const points = shape.points.map((p, i) => (i === index ? { ...p, ...patch } : p))
  return { ...shape, points }
}

/** Задаёт стрелу дуги H (мм) для ребра points[edgeIndex]→points[edgeIndex+1]
 *  (последнее — points[length-1]→points[0]). 0 или undefined — прямое ребро. */
export function setOpeningShapeEdgeSagitta(
  shape: OpeningShape, edgeIndex: number, sagittaMm: number | undefined,
): OpeningShape {
  const n = shape.points.length
  if (edgeIndex < 0 || edgeIndex >= n) return shape
  const edges: OpeningShapeEdge[] = []
  for (let i = 0; i < n; i++) edges.push({ ...(shape.edges?.[i] ?? {}) })
  edges[edgeIndex] = { sagitta: sagittaMm || undefined }
  return { ...shape, edges }
}

/** Вставляет новую вершину — середину ребра points[afterIndex]→points[afterIndex+1]
 *  (по модулю длины, т.е. afterIndex = length-1 вставляет в замыкающее ребро).
 *  Сбрасывает все стрелы дуг контура (см. пояснение в шапке файла). */
export function insertOpeningShapeVertexAfter(shape: OpeningShape, afterIndex: number): OpeningShape {
  const n = shape.points.length
  if (n === 0 || afterIndex < 0 || afterIndex >= n) return shape
  const a = shape.points[afterIndex]
  const b = shape.points[(afterIndex + 1) % n]
  const mid: Point2D = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const points = [
    ...shape.points.slice(0, afterIndex + 1),
    mid,
    ...shape.points.slice(afterIndex + 1),
  ]
  return { points }
}

/** Удаляет вершину по индексу. Не даёт уйти ниже MIN_OPENING_SHAPE_VERTICES.
 *  Сбрасывает все стрелы дуг контура (см. пояснение в шапке файла). */
export function removeOpeningShapeVertex(shape: OpeningShape, index: number): OpeningShape {
  if (shape.points.length <= MIN_OPENING_SHAPE_VERTICES) return shape
  if (index < 0 || index >= shape.points.length) return shape
  const points = shape.points.filter((_, i) => i !== index)
  return { points }
}
