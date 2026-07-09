/**
 * Точный геометрический расчёт металлического каркаса П112 (двухуровневый).
 * Заменяет усреднённые расходы на м² (см. ceilingData.ts P112_FRAME_RATES) там,
 * где есть реальные размеры помещения — см. КОНСПЕКТ.md, сессия 05.07.2026,
 * правила получены от пользователя (монтажник, реальная практика объекта).
 *
 * 09.07.2026: добавлен второй режим раскладки ('knauf') — строго по
 * официальной сетке КНАУФ (расстояния между осями профилей и отступы от
 * стены, серия 1.045.9-2.08.1), НЕ по практике монтажника. См. FrameLayoutMode.
 *
 * Термины (см. также ceilingData.ts):
 *   несущий профиль  (b) — верхний уровень, ближе к плите, крепится подвесами
 *   основной профиль (c) — нижний уровень, к нему крепится ГКЛ, шаг c выбирает
 *                          пользователь (500-1200мм, см. CeilingStep)
 *
 * Правило расстановки рядов (со слов пользователя, НЕ как у стоек в
 * перегородках — там половина шага от стены, здесь иначе):
 *   первый ряд — на расстоянии ОДНОГО ШАГА от стены (не 0, не пол-шага)
 *   далее — через шаг
 *   последний ряд — просто закрывает остаток у противоположной стены
 *                   (~20-30см), а не встаёт строго по сетке
 * Тот же принцип применяется к подвесам вдоль несущего профиля (тот же шаг,
 * см. calcP112FrameGeometry).
 */

export type HangerKind = 'direct' | 'direct_extended' | 'rod_500' | 'rod_1000'

export const HANGER_LABEL: Record<HangerKind, string> = {
  direct:          'Подвес прямой ПП 60×27',
  direct_extended: 'Подвес прямой удлинённый ПП 60×27 (200мм)',
  rod_500:         'Тяга с анкерным подвесом 500мм (под обрезку)',
  rod_1000:        'Тяга с анкерным подвесом 1000мм (под обрезку)',
}

/** ~20-30см от противоположной стены — реальная практика, не строгая сетка. */
export const CLOSE_GAP_MM = 250
/** Не добавлять ряд почти вплотную к предыдущему регулярному ряду. */
export const MIN_BAY_MM = 150
/** Стандартная длина профиля ПП 60×27 (бара), мм — подтверждено пользователем. */
export const STANDARD_BAR_LENGTH_MM = 3000

/**
 * Два варианта раскладки рядов профиля, запрошены пользователем 09.07.2026:
 *  'user'  — реальная практика монтажника: первый ряд на расстоянии ОДНОГО
 *            ШАГА от стены, последний ряд СЖИМАЕТСЯ ближе к дальней стене
 *            (не встаёт строго по сетке, экономит ряд/материал). Уже было
 *            реализовано раньше как единственный режим, теперь default.
 *  'knauf' — строго по официальной таблице КНАУФ (проверено поиском,
 *            источник gipsokart.ru/stroi-obzor.ru, серия 1.045.9-2.08.1):
 *            несущий профиль крепится на расстоянии 100мм от стены, ДАЛЕЕ
 *            шагом 500мм; основной профиль — на расстоянии ОДНОГО ШАГА c от
 *            стены (совпадает с 'user' в стартовой точке, отличие — только
 *            в последнем ряду). Последний ряд НЕ сжимается — расстояние до
 *            соседнего ряда никогда не должно превышать номинальный шаг
 *            (это норма нагрузки/прогиба, не эстетика), поэтому если
 *            естественный остаток у стены есть — он просто маленький,
 *            лишний ряд специально под него не добавляется.
 */
export type FrameLayoutMode = 'user' | 'knauf'

/** Несущий профиль по Кнауф — фиксированный отступ от стены 100мм, НЕ
 *  равен шагу (в отличие от основного профиля, где отступ = шагу). */
export const KNAUF_BEARING_WALL_OFFSET_MM = 100

/**
 * Позиции рядов профиля вдоль пролёта, мм от начальной стены.
 *
 * mode='user' (по умолчанию, обратная совместимость): первый ряд — на
 * расстоянии одного шага от стены, далее — через шаг. Если это оставляет
 * у противоположной стены зазор больше CLOSE_GAP_MM — последний ряд НЕ
 * добавляется отдельно, а просто сдвигается ближе к стене (реальная
 * практика: монтажник просто подвигает последний профиль, а не ставит
 * лишний ради нескольких см). Если естественный зазор уже небольшой
 * (≤ CLOSE_GAP_MM) — ряд остаётся на своей обычной, кратной шагу, позиции.
 *
 * mode='knauf': первый ряд — на wallOffsetMm от стены (по умолчанию тоже
 * один шаг, но для несущего профиля передавайте KNAUF_BEARING_WALL_OFFSET_MM
 * явно — там отступ фиксирован, не равен шагу), далее строго через шаг,
 * БЕЗ сжатия последнего ряда — остаток у дальней стены может быть меньше
 * шага, это нормально и ожидаемо, просто не даём расстоянию между рядами
 * превысить номинальный шаг ни в одном пролёте.
 */
export function calcFrameRowPositions(
  spanMm: number,
  stepMm: number,
  opts: { mode?: FrameLayoutMode; wallOffsetMm?: number } = {},
): number[] {
  const { mode = 'user', wallOffsetMm } = opts
  if (stepMm <= 0 || spanMm <= 0) return []

  if (mode === 'knauf') {
    const positions: number[] = []
    let pos = wallOffsetMm ?? stepMm
    while (pos < spanMm) {
      positions.push(pos)
      pos += stepMm
    }
    return positions
  }

  const positions: number[] = []
  let pos = stepMm
  while (pos < spanMm) {
    positions.push(pos)
    pos += stepMm
  }
  if (positions.length === 0) {
    // Помещение уже одного шага — но закрывающий ряд у дальней стены всё
    // равно может быть нужен, если для него достаточно места.
    const closing = spanMm - CLOSE_GAP_MM
    if (closing > MIN_BAY_MM) positions.push(closing)
    return positions
  }
  const last = positions[positions.length - 1]
  const gapToWall = spanMm - last
  if (gapToWall > CLOSE_GAP_MM) {
    positions[positions.length - 1] = spanMm - CLOSE_GAP_MM
  }
  return positions
}

/**
 * Тип подвеса по зазору "плита -> черновой (несущий) каркас", мм.
 * Правила со слов пользователя:
 *   ≤100мм         — обычный прямой подвес
 *   100-200мм       — удлинённый прямой подвес (раб. длина 200мм)
 *   200-500мм       — тяга с анкерным подвесом 500мм (подрезается)
 *   500-1000мм      — тяга с анкерным подвесом 1000мм (подрезается)
 *   >1000мм         — тяга 1000мм как есть, с предупреждением (нестандартный случай)
 */
export function resolveHangerKind(slabGapMm: number): { kind: HangerKind; warning?: string } {
  if (slabGapMm <= 100) return { kind: 'direct' }
  if (slabGapMm <= 200) return { kind: 'direct_extended' }
  if (slabGapMm <= 500) return { kind: 'rod_500' }
  if (slabGapMm <= 1000) return { kind: 'rod_1000' }
  return {
    kind: 'rod_1000',
    warning: `Зазор до плиты ${slabGapMm}мм больше 1000мм — тяга 1000мм может не подойти, проверить на месте`,
  }
}

export interface P112FrameGeometry {
  /** Число рядов несущего профиля (поперёк направления A). */
  bearingCount: number
  /** Длина каждого несущего профиля, мм (= пролёт A). */
  bearingLengthEachMm: number
  bearingTotalLm: number
  /** Число подвесов на одном несущем профиле. */
  hangersPerBearing: number
  hangersTotal: number
  /** Число рядов основного профиля (поперёк направления A, шаг c). */
  mainCount: number
  /** Длина каждого основного профиля, мм (= пролёт B). */
  mainLengthEachMm: number
  mainTotalLm: number
  /** Соединитель двухуровневый — по пересечениям (bearingCount × mainCount). */
  connectorsTotal: number
  bearingExtenders: number
  mainExtenders: number
  hangerKind: HangerKind
  hangerWarning?: string
}

/**
 * Геометрия каркаса П112 для прямоугольного помещения без препятствий
 * (коммуникации/короба — отдельная задача, см. КОНСПЕКТ.md).
 *
 * bearingAlongLength: несущий профиль идёт вдоль длины помещения (true) или
 * вдоль ширины (false) — направление, откуда "отталкивается" монтажник,
 * не определяется автоматически (нельзя знать заранее, как удобнее на объекте).
 */
export function calcP112FrameGeometry(
  roomLengthMm: number,
  roomWidthMm: number,
  stepC: number,
  stepB: number,
  slabGapMm: number,
  bearingAlongLength: boolean,
  layoutMode: FrameLayoutMode = 'user',
): P112FrameGeometry {
  // A — пролёт вдоль которого идёт (своей длиной) несущий профиль
  // B — пролёт поперёк которого несущий профиль расставлен с шагом stepB
  const A = bearingAlongLength ? roomLengthMm : roomWidthMm
  const B = bearingAlongLength ? roomWidthMm : roomLengthMm

  // Несущий профиль (ряды поперёк B) — единственное место, где 'knauf'
  // использует ДРУГОЙ (не равный шагу) отступ от стены, см. KONSPEKT/поиск.
  const bearingOpts = layoutMode === 'knauf'
    ? { mode: layoutMode, wallOffsetMm: KNAUF_BEARING_WALL_OFFSET_MM }
    : { mode: layoutMode }
  const bearingCount = calcFrameRowPositions(B, stepB, bearingOpts).length
  const bearingLengthEachMm = A
  const bearingTotalLm = (bearingCount * bearingLengthEachMm) / 1000

  // Подвесы вдоль несущего профиля — тот же шаг, что и между несущими рядами
  // (см. пояснение пользователя: "такое же расстояние выдерживают и между подвесами").
  // Официальный отступ от торцевой стены для подвесов Кнауф отдельно не
  // оговаривает — используем тот же принцип, что и для основного профиля
  // (отступ = шагу в обоих режимах, разница только в сжатии последнего).
  const hangersPerBearing = calcFrameRowPositions(A, stepB, { mode: layoutMode }).length
  const hangersTotal = bearingCount * hangersPerBearing

  // Основной профиль — перпендикулярно несущему, расставлен вдоль A с шагом c
  const mainCount = calcFrameRowPositions(A, stepC, { mode: layoutMode }).length
  const mainLengthEachMm = B
  const mainTotalLm = (mainCount * mainLengthEachMm) / 1000

  const connectorsTotal = bearingCount * mainCount

  const bearingExtenders = bearingCount * Math.max(0, Math.ceil(bearingLengthEachMm / STANDARD_BAR_LENGTH_MM) - 1)
  const mainExtenders = mainCount * Math.max(0, Math.ceil(mainLengthEachMm / STANDARD_BAR_LENGTH_MM) - 1)

  const { kind, warning } = resolveHangerKind(slabGapMm)

  return {
    bearingCount, bearingLengthEachMm, bearingTotalLm,
    hangersPerBearing, hangersTotal,
    mainCount, mainLengthEachMm, mainTotalLm,
    connectorsTotal, bearingExtenders, mainExtenders,
    hangerKind: kind, hangerWarning: warning,
  }
}
