/**
 * Точный геометрический расчёт металлического каркаса П112 (двухуровневый).
 * Заменяет усреднённые расходы на м² (см. ceilingData.ts P112_FRAME_RATES) там,
 * где есть реальные размеры помещения — см. КОНСПЕКТ.md, сессия 05.07.2026,
 * правила получены от пользователя (монтажник, реальная практика объекта).
 *
 * 09.07.2026: добавлен второй режим раскладки ('knauf') — строго по
 * официальной таблице КНАУФ, серия 1.045.9-2.08.1-4, лист 40/76 (пользователь
 * прислал фото документа). ⚠️ Первая версия этого файла (тем же днём) путала
 * местами несущий/основной профиль и брала отступ от стены с постороннего
 * веб-источника — эта версия исправлена по официальному документу.
 *
 * ⚠️ 12.07.2026, ИСПРАВЛЕНИЕ: до этой правки подвес считался закреплённым
 * на НЕСУЩЕМ профиле (bearingCount рядов), а положение вдоль ряда
 * снэпалось к позициям основного. Пользователь прислал два официальных
 * чертежа КНАУФ (той же серии 1.045.9-2.08.1-4: лист "32 из 76" —
 * двухуровневый П112.1, и лист "40 из 76"/38 — одноуровневый П113.1) —
 * на ОБОИХ подвес визуально идёт прямо к профилю, подписанному
 * "расстояние между осями ОСНОВНЫХ профилей" (шаг c). Это относится и к
 * П113 (см. calcP113Frame.ts, там было верно с самого начала — оттуда и
 * пришло уточнение), и, как выяснилось, к П112 тоже — здесь было
 * НАОБОРОТ, несмотря на пометку в шапке файла об уже одной похожей
 * правке 09.07.2026 (та правка поправила таблицу межосевых расстояний,
 * но не эту деталь). Строки ниже (b — "верхний уровень, крепится
 * подвесами") тоже относятся уже не к несущему, а к основному профилю —
 * см. исправленный список терминов ниже.
 *
 * Термины, ТРИ РАЗНЫЕ величины (см. также ceilingData.ts):
 *   b — шаг НЕСУЩЕГО профиля — перпендикулярно основному, соединяется с
 *       ним двухуровневым соединителем (крабом), НЕ имеет собственных
 *       подвесов. По КНАУФ — НЕ свободный выбор: 500мм при поперечном
 *       монтаже ГСП/ГВЛ, 400мм при продольном (см. KNAUF_BEARING_STEP_BY_MOUNT).
 *   c — шаг ОСНОВНОГО профиля — верхний уровень (ближе к плите),
 *       КРЕПИТСЯ ПОДВЕСАМИ НАПРЯМУЮ, держит нагрузку и плоскость каркаса;
 *       к нему же в итоге крепится ГКЛ. Свободно выбирает пользователь
 *       (500-1200мм, см. CeilingStep).
 *   a — шаг ПОДВЕСОВ/дюбелей вдоль основного профиля — по КНАУФ зависит от
 *       c И направления монтажа (через b) И класса нагрузки, см.
 *       KNAUF_HANGER_SPACING_TABLE. Раньше по ошибке считался равным b —
 *       это верно только как приближение для 'user'-режима (реальная
 *       практика объекта), не для 'knauf'.
 *
 * Правило расстановки рядов для mode='user' (со слов пользователя, НЕ как у
 * стоек в перегородках — там половина шага от стены, здесь иначе):
 *   первый ряд — на расстоянии ОДНОГО ШАГА от стены (не 0, не пол-шага)
 *   далее — через шаг
 *   последний ряд — просто закрывает остаток у противоположной стены
 *                   (~20-30см), а не встаёт строго по сетке
 * Тот же принцип применяется к подвесам вдоль несущего профиля (тот же шаг,
 * см. calcP112FrameGeometry). Для mode='knauf' — см. FrameLayoutMode ниже.
 */

import type { CeilingLoadClass, CeilingMountDirection, CeilingStep } from '../data/ceilingData'
import {
  KNAUF_HANGER_SPACING_TABLE, KNAUF_BEARING_STEP_BY_MOUNT,
  KNAUF_WALL_OFFSET_MAIN_MM, KNAUF_WALL_OFFSET_BEARING_MM,
  P112_HANGER_STEP, P113_HANGER_STEP,
} from '../data/ceilingData'

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
 *  'knauf' — строго по официальным правилам КНАУФ. 11.07.2026: ПОЛНОСТЬЮ
 *            ПЕРЕСМОТРЕНО по фото официального документа (лист «А-А,
 *            примыкание к стене видимым швом», сессия 11.07.2026) —
 *            выяснилось, что раньше здесь было верно только для несущего
 *            профиля (частично), а у основного профиля вообще другое
 *            правило. См. calcMainRowPositionsKnauf /
 *            calcBearingRowPositionsKnauf ниже — это ДВА РАЗНЫХ алгоритма,
 *            не один общий:
 *              - ОСНОВНОЙ профиль (шаг c): первый ряд ≤150мм от стены,
 *                далее строго шаг c (регулярная сетка). Если у последнего
 *                ряда сетки до противоположной стены остаётся больше
 *                150мм — добавляется ЕЩЁ ОДИН ряд на ≤150мм от стены;
 *                предпоследний (последний ряд регулярной сетки) при этом
 *                остаётся на месте, не сдвигается. Финишный пролёт между
 *                ними получается короче c.
 *              - НЕСУЩИЙ профиль (шаг b): «чистая» сетка от стены (b, 2b,
 *                3b, ...), шаг НИКОГДА не подгоняется. У каждой стены —
 *                ОТДЕЛЬНЫЙ дополнительный профиль на ≤100мм от стены (та
 *                же плоскость, что и остальные несущие — см. фото), если
 *                ближайшая точка сетки дальше 100мм.
 *            То есть оба профиля на самом деле следуют ОДНОМУ принципу —
 *            «добавить лишний ряд у стены, не сдвигать регулярную сетку»,
 *            отличаются только допуском (150 vs 100мм) и тем, что у
 *            несущего сетка не привязана к первому ряду (считается от
 *            самой стены, 0/b/2b/...), а у основного — привязана
 *            (0+wallOffset/+c/+2c/...).
 *            Раньше единый код одинаково (и неверно) применял отступ
 *            ≤100мм и «нет сжатия последнего ряда» к ОБОИМ профилям.
 */
export type FrameLayoutMode = 'user' | 'knauf'

/** Какой из двух профилей каркаса П112 считаем — правила расстановки
 *  рядов у них теперь РАЗНЫЕ в mode='knauf' (см. FrameLayoutMode выше). */
export type FrameProfileKind = 'main' | 'bearing'

/**
 * Отступ от стены до первого/последнего ряда НЕСУЩЕГО профиля по КНАУФ —
 * ≤100мм (см. FrameLayoutMode выше). Официально максимум, берём как есть
 * (частая практика — ставить максимально близко, насколько разрешено).
 */
export { KNAUF_WALL_OFFSET_BEARING_MM, KNAUF_WALL_OFFSET_MAIN_MM }
/** @deprecated используйте KNAUF_WALL_OFFSET_BEARING_MM для несущего
 *  профиля или KNAUF_WALL_OFFSET_MAIN_MM для основного — переименовано
 *  11.07.2026, когда выяснилось (фото документа, лист «А-А»), что у
 *  основного и несущего профиля отступы РАЗНЫЕ (150 и 100мм
 *  соответственно), а не одно общее число ≤100мм на оба, как считалось
 *  раньше (09.07.2026). Оставлено для обратной совместимости. */
export const KNAUF_WALL_OFFSET_MM = KNAUF_WALL_OFFSET_BEARING_MM
/** @deprecated см. KNAUF_WALL_OFFSET_BEARING_MM. */
export const KNAUF_BEARING_WALL_OFFSET_MM = KNAUF_WALL_OFFSET_BEARING_MM

/**
 * НЕСУЩИЙ профиль, mode='knauf' — «чистая» сетка от стены (позиции b, 2b,
 * 3b, ...), шаг между рядами НИКОГДА не подгоняется под ширину помещения
 * (в отличие от основного профиля, см. calcMainRowPositionsKnauf). У
 * каждой стены — ОТДЕЛЬНЫЙ дополнительный профиль на wallOffsetMm (≤100мм)
 * от стены, добавляется ТОЛЬКО если ближайшая точка регулярной сетки
 * дальше wallOffsetMm — иначе крайний ряд сетки уже сам годится, доп.
 * профиль не нужен. Ничего не сдвигается и не сжимается, просто иногда
 * появляется лишний ряд у стены. См. фото 11.07.2026, лист «А-А,
 * Примыкание к стене видимым швом»: та же плоскость, что и все несущие
 * профили — это не отдельный вид элемента, а полноправный дополнительный
 * несущий профиль вне регулярной сетки.
 */
export function calcBearingRowPositionsKnauf(
  spanMm: number,
  stepMm: number,
  wallOffsetMm: number = KNAUF_WALL_OFFSET_BEARING_MM,
): number[] {
  if (stepMm <= 0 || spanMm <= 0) return []

  const grid: number[] = []
  let pos = stepMm
  while (pos < spanMm) {
    grid.push(pos)
    pos += stepMm
  }

  const positions: number[] = []
  const firstGridPos = grid.length > 0 ? grid[0] : spanMm
  if (firstGridPos > wallOffsetMm) {
    positions.push(Math.min(wallOffsetMm, spanMm))
  }
  positions.push(...grid)
  const lastGridPos = grid.length > 0 ? grid[grid.length - 1] : 0
  const gapToFarWall = spanMm - lastGridPos
  if (gapToFarWall > wallOffsetMm) {
    positions.push(spanMm - wallOffsetMm)
  }
  return positions
}

/**
 * ОСНОВНОЙ профиль, mode='knauf' — первый ряд на wallOffsetMm (≤150мм) от
 * стены, далее строго через шаг c — обычная регулярная сетка. Если у
 * последнего ряда регулярной сетки остаётся до противоположной стены
 * больше wallOffsetMm — добавляется ЕЩЁ ОДИН (дополнительный) ряд на
 * wallOffsetMm от стены; предпоследний (последний ряд регулярной сетки)
 * при этом остаётся на месте, НЕ сдвигается. Финишный пролёт (между
 * предпоследним и новым последним рядом) получается короче c — это и
 * есть смысл правила, а не замена последней позиции сетки на новую (в
 * отличие от несущего профиля выше — там точно так же ДОБАВЛЯЕТСЯ
 * дополнительный ряд, не сдвигается существующий, так что оба профиля на
 * самом деле следуют одному и тому же принципу «добавить, не двигать»).
 * Если остаток уже ≤wallOffsetMm — последний ряд регулярной сетки уже
 * годится сам по себе, ничего добавлять не нужно.
 *
 * Пример от пользователя (11.07.2026): шаг c=1000, предпоследний ряд уже
 * на месте, до стены от него остаётся ровно 1000мм (=c, наивный
 * следующий шаг попал бы точно в стену) — новый последний ряд ставится
 * не на +1000 (вплотную к стене), а на +850 от предпоследнего
 * (=1000-150, чтобы попасть точно в допуск ≤150мм).
 */
export function calcMainRowPositionsKnauf(
  spanMm: number,
  stepMm: number,
  wallOffsetMm: number = KNAUF_WALL_OFFSET_MAIN_MM,
): number[] {
  if (stepMm <= 0 || spanMm <= 0) return []

  const positions: number[] = []
  let pos = wallOffsetMm
  while (pos < spanMm) {
    positions.push(pos)
    pos += stepMm
  }
  if (positions.length === 0) return positions

  const last = positions[positions.length - 1]
  const gapToWall = spanMm - last
  if (gapToWall > wallOffsetMm) {
    positions.push(spanMm - wallOffsetMm)
  }
  return positions
}

/**
 * Позиции рядов профиля вдоль пролёта, мм от начальной стены.
 *
 * mode='user' (по умолчанию, обратная совместимость): первый ряд — на
 * wallOffsetMm от стены (не задан → один шаг, как раньше), далее — через
 * шаг. Если это оставляет у противоположной стены зазор больше CLOSE_GAP_MM
 * — последний ряд НЕ добавляется отдельно, а просто сдвигается ближе к
 * стене (реальная практика: монтажник просто подвигает последний профиль,
 * а не ставит лишний ради нескольких см). Если естественный зазор уже
 * небольшой (≤ CLOSE_GAP_MM) — ряд остаётся на своей обычной позиции.
 *
 * mode='knauf': делегирует в calcMainRowPositionsKnauf/
 * calcBearingRowPositionsKnauf по profileKind (см. их описание — правила
 * теперь РАЗНЫЕ для основного и несущего профиля, 11.07.2026). Если
 * profileKind не передан — по умолчанию 'main' (обратная совместимость со
 * старыми вызовами, где различия между профилями ещё не было).
 */
export function calcFrameRowPositions(
  spanMm: number,
  stepMm: number,
  opts: { mode?: FrameLayoutMode; wallOffsetMm?: number; profileKind?: FrameProfileKind } = {},
): number[] {
  const { mode = 'user', wallOffsetMm, profileKind = 'main' } = opts
  if (stepMm <= 0 || spanMm <= 0) return []

  if (mode === 'knauf') {
    return profileKind === 'bearing'
      ? calcBearingRowPositionsKnauf(spanMm, stepMm, wallOffsetMm ?? KNAUF_WALL_OFFSET_BEARING_MM)
      : calcMainRowPositionsKnauf(spanMm, stepMm, wallOffsetMm ?? KNAUF_WALL_OFFSET_MAIN_MM)
  }

  const positions: number[] = []
  let pos = wallOffsetMm ?? stepMm
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
 * Как calcFrameRowPositions, но для диапазона [minMm, maxMm] вместо [0, span]
 * — нужно, когда выбранная стена старта раскладки НЕ находится в самом
 * крайнем углу контура (см. calcPolygonP112Frame.ts) и часть контура лежит
 * "по другую сторону" от стены (minMm < 0). 12.07.2026: раньше в этом случае
 * та часть контура просто не получала рядов профиля — теперь строим их и в
 * отрицательную сторону, зеркально по тем же правилам первого отступа/
 * сжатия последнего ряда (правило то же самое, "дальняя стена" в зеркальной
 * половине — это просто minMm, край контура, а не физическая стена).
 *
 * 0 (позиция самой выбранной стены) в результат никогда не попадает — ряды
 * всегда начинаются с отступа (шаг или wallOffsetMm), что для 0, что для
 * отрицательной стороны.
 */
export function calcFrameRowPositionsSigned(
  minMm: number,
  maxMm: number,
  stepMm: number,
  opts: { mode?: FrameLayoutMode; wallOffsetMm?: number; profileKind?: FrameProfileKind } = {},
): number[] {
  const positive = calcFrameRowPositions(Math.max(0, maxMm), stepMm, opts)
  if (minMm >= 0) return positive
  const negativeMirrored = calcFrameRowPositions(-minMm, stepMm, opts)
  const negative = negativeMirrored.map(p => -p).sort((a, b) => a - b)
  return [...negative, ...positive]
}

/**
 * 10.07.2026: подвес обязательно должен висеть строго в точке пересечения
 * основной/несущий (там же соединитель), не по независимой сетке "шаг a от
 * стены". Раньше подвесы считались отдельной сеткой через stepA — из-за
 * этого они физически "не попадали" ни в одно пересечение (см. KONSPEKT.md,
 * жалоба "подвесы слетели с оси").
 *
 * 12.07.2026: подвес физически крепится к ОСНОВНОМУ профилю (не к
 * несущему, см. исправление в шапке файла) — значит СНЭПАТЬ нужно позиции
 * НЕСУЩЕГО профиля (это и есть точки пересечения вдоль пробега основного).
 * Параметр функции по-прежнему называется обобщённо (та же функция
 * переиспользуется и в calcP113Frame.ts, где физически наоборот основной
 * снэпается по несущему) — конкретный смысл аргумента задаёт вызывающий код.
 *
 * Официальная таблица (лист 40/76 КНАУФ) даёт a — это МАКСИМАЛЬНО
 * допустимое расстояние между соседними подвесами при заданной нагрузке,
 * а не обязательный шаг. Раз подвес обязан стоять в точке пересечения,
 * реальная расстановка — это подмножество позиций профиля-оси: берём
 * первую позицию, дальше жадно продвигаемся к САМОЙ ДАЛЬНЕЙ следующей
 * позиции, которая ещё не превышает maxHangerStepMm от последнего
 * выбранного подвеса. Если шаг оси почти равен или больше a — придётся
 * ставить подвес на КАЖДОМ пересечении (пропускать нельзя, иначе превысим
 * допустимое расстояние a).
 *
 * Всегда включает первую и последнюю позицию — первое и последнее
 * пересечение вдоль профиля тоже должны быть подвешены.
 */
export function snapHangerPositionsToAxis(
  axisPositions: number[],
  maxHangerStepMm: number,
): number[] {
  if (axisPositions.length === 0) return []
  const result: number[] = [axisPositions[0]]
  let i = 0
  while (i < axisPositions.length - 1) {
    let j = i
    while (
      j + 1 < axisPositions.length &&
      axisPositions[j + 1] - axisPositions[i] <= maxHangerStepMm
    ) {
      j++
    }
    if (j === i) {
      // даже ближайшая следующая позиция превышает max — деваться некуда,
      // на объекте так и будет (a задан слишком маленьким относительно c)
      j = i + 1
    }
    result.push(axisPositions[j])
    i = j
  }
  return result
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

export interface KnaufHangerStepResult {
  stepAMm: number
  warning?: string
}

/**
 * Шаг подвесов a, мм, строго по официальной таблице КНАУФ
 * (KNAUF_HANGER_SPACING_TABLE). Для 'crosswise' (П112) таблица покрывает
 * весь диапазон c=500..1200 (сверено по фото документа 11.07.2026) — этот
 * фолбэк на "нет данных для c" на практике больше не должен срабатывать для
 * П112. Для 'lengthwise' (задел под П113, см. ceilingData.ts) диапазон
 * по-прежнему неполный, фолбэк актуален до сверки П113 по своему документу.
 * Если для точной комбинации c+направление+нагрузка в таблице стоит прочерк
 * (недопустимо) — берём наименьший (самый частый, самый безопасный запас)
 * шаг из этой же строки таблицы и явно предупреждаем, вместо того чтобы
 * тихо посчитать неверно.
 */
export function resolveKnaufHangerStep(
  stepC: number,
  mountDirection: CeilingMountDirection,
  loadClass: CeilingLoadClass,
): KnaufHangerStepResult {
  const row = KNAUF_HANGER_SPACING_TABLE[mountDirection]?.[stepC as CeilingStep]
  if (!row) {
    return {
      stepAMm: stepC,
      warning: `Для шага основного профиля c=${stepC}мм нет данных в официальной ` +
        `таблице КНАУФ для этого направления монтажа — шаг подвесов взят ` +
        `приблизительно (=c), уточните по документации на месте.`,
    }
  }

  const direct = row[loadClass]
  if (direct != null) return { stepAMm: direct }

  const available = Object.values(row).filter((v): v is number => v != null)
  const mountLabel = mountDirection === 'crosswise' ? 'поперечном' : 'продольном'
  if (available.length > 0) {
    const fallback = Math.min(...available)
    return {
      stepAMm: fallback,
      warning: `По таблице КНАУФ комбинация c=${stepC}мм + нагрузка ≤${loadClass} кН/м² ` +
        `при ${mountLabel} монтаже не допускается (прочерк в таблице) — взят более ` +
        `частый шаг подвесов ${fallback}мм (запас в безопасную сторону), сверьте на месте.`,
    }
  }
  return {
    stepAMm: stepC,
    warning: `По таблице КНАУФ ни один шаг подвесов не допускается для c=${stepC}мм ` +
      `при ${mountLabel} монтаже — шаг подвесов взят приблизительно (=c), сверьте по документации.`,
  }
}

export interface ResolvedFrameParams {
  /** Шаг несущего профиля, мм. */
  stepB: number
  /** Шаг подвесов вдоль несущего профиля, мм — ОТДЕЛЬНАЯ величина от stepB
   *  (раньше в коде ошибочно считались равными, см. шапку файла). */
  stepA: number
  wallOffsetMainMm?: number
  wallOffsetBearingMm?: number
  warning?: string
}

/** Дефолт шага подвесов a в режиме 'user' (15.07.2026), когда пользователь
 *  явно не задал stepA — подтверждено пользователем как типичная практика
 *  объекта для П112 и П113 (не привязан к stepC/таблице, в отличие от
 *  'knauf' — там шаг подвесов всегда по официальной таблице). */
export const DEFAULT_USER_HANGER_STEP_MM = 800

/**
 * Единая точка правды для параметров каркаса — используется и сметой
 * (calcCeiling.ts), и превью-канвасом (CeilingCalc.tsx), чтобы они не могли
 * разойтись (как уже почти случилось с layoutMode — превью считало своими
 * силами параллельно со сметой).
 *
 * mode='user': stepB — явно заданный пользователем или из старой таблицы
 * P112_HANGER_STEP/P113_HANGER_STEP (обратная совместимость), иначе резервный
 * дефолт 1000/950. stepA — НЕЗАВИСИМО от stepB: явно заданный пользователем
 * (userStepA) или DEFAULT_USER_HANGER_STEP_MM (800мм).
 * [15.07.2026: раньше stepA молча приравнивался к stepB — пользователь
 * подтвердил на реальном объекте (П113, c=400, монтаж «вдоль» — ГКЛ ложится
 * прямо на основной профиль, несущий/подвесы — независимые расстояния,
 * несущий вообще может стоять только у стыков листов), что это разные,
 * свободно выбираемые величины. См. CeilingSpec.stepA, ceilingData.ts.]
 *
 * mode='knauf': stepB — жёстко по направлению монтажа (400/500), stepA — по
 * официальной таблице (resolveKnaufHangerStep), отступ от стены ≤100мм для
 * обоих профилей. userStepA здесь НЕ читается (официальная таблица, не
 * свободный выбор).
 */
export function resolveFrameParams(opts: {
  stepC: number
  layoutMode: FrameLayoutMode
  userStepB?: number
  /** НОВОЕ (15.07.2026) — шаг подвесов, независимый от userStepB.
   *  Используется только в mode='user'. */
  userStepA?: number
  mountDirection?: CeilingMountDirection
  loadClass?: CeilingLoadClass
  /** П112/П113 — своя таблица дефолтного шага b в 'user'-режиме. Не задан
   *  → 'p112' (старое поведение, обратная совместимость). */
  ceilingType?: 'p112' | 'p113'
}): ResolvedFrameParams {
  if (opts.layoutMode === 'knauf') {
    const mountDirection = opts.mountDirection ?? 'crosswise'
    const loadClass = opts.loadClass ?? 0.15
    const stepB = KNAUF_BEARING_STEP_BY_MOUNT[mountDirection]
    const { stepAMm, warning } = resolveKnaufHangerStep(opts.stepC, mountDirection, loadClass)
    return {
      stepB, stepA: stepAMm,
      wallOffsetMainMm: KNAUF_WALL_OFFSET_MAIN_MM, wallOffsetBearingMm: KNAUF_WALL_OFFSET_BEARING_MM,
      warning,
    }
  }
  const table = opts.ceilingType === 'p113' ? P113_HANGER_STEP : P112_HANGER_STEP
  const fallback = opts.ceilingType === 'p113' ? 950 : 1000
  const stepB = opts.userStepB ?? (table[opts.stepC as CeilingStep] ?? fallback)
  const stepA = opts.userStepA ?? DEFAULT_USER_HANGER_STEP_MM
  return { stepB, stepA }
}

export interface P112FrameGeometry {
  /** Число рядов несущего профиля (поперёк направления A). Соединяется с
   *  основным двухуровневым соединителем, собственных подвесов не имеет. */
  bearingCount: number
  /** Длина каждого несущего профиля, мм (= пролёт A). */
  bearingLengthEachMm: number
  bearingTotalLm: number
  /** Позиции рядов несущего профиля вдоль B, мм (для превью-канваса). */
  bearingPositions: number[]
  /** Число рядов основного профиля (поперёк направления A, шаг c). Крепится
   *  подвесами напрямую к плите — держит нагрузку и плоскость каркаса. */
  mainCount: number
  /** Длина каждого основного профиля, мм (= пролёт B). */
  mainLengthEachMm: number
  mainTotalLm: number
  /** Позиции рядов основного профиля вдоль A, мм (для превью-канваса). */
  mainPositions: number[]
  /** Число подвесов на одном основном профиле. */
  hangersPerMain: number
  hangersTotal: number
  /** Позиции подвесов вдоль B, мм — ПОДМНОЖЕСТВО bearingPositions (подвес
   *  крепится к основному профилю строго в точке пересечения с несущим,
   *  см. snapHangerPositionsToAxis). Одни и те же для каждого ряда
   *  основного профиля. */
  hangerPositions: number[]
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
  extra: { stepA?: number; wallOffsetMainMm?: number; wallOffsetBearingMm?: number } = {},
): P112FrameGeometry {
  // A — пролёт вдоль которого идёт (своей длиной) несущий профиль
  // B — пролёт поперёк которого несущий профиль расставлен с шагом stepB
  const A = bearingAlongLength ? roomLengthMm : roomWidthMm
  const B = bearingAlongLength ? roomWidthMm : roomLengthMm

  const defaultWallOffsetBearing = layoutMode === 'knauf' ? KNAUF_WALL_OFFSET_BEARING_MM : undefined
  const defaultWallOffsetMain = layoutMode === 'knauf' ? KNAUF_WALL_OFFSET_MAIN_MM : undefined
  const wallOffsetBearingMm = extra.wallOffsetBearingMm ?? defaultWallOffsetBearing
  const wallOffsetMainMm = extra.wallOffsetMainMm ?? defaultWallOffsetMain

  // Несущий профиль (ряды поперёк B).
  const bearingPositions = calcFrameRowPositions(
    B, stepB, { mode: layoutMode, wallOffsetMm: wallOffsetBearingMm, profileKind: 'bearing' },
  )
  const bearingCount = bearingPositions.length
  const bearingLengthEachMm = A
  const bearingTotalLm = (bearingCount * bearingLengthEachMm) / 1000

  // Основной профиль — перпендикулярно несущему, расставлен вдоль A с шагом c
  const mainPositions = calcFrameRowPositions(
    A, stepC, { mode: layoutMode, wallOffsetMm: wallOffsetMainMm, profileKind: 'main' },
  )
  const mainCount = mainPositions.length
  const mainLengthEachMm = B
  const mainTotalLm = (mainCount * mainLengthEachMm) / 1000

  // 12.07.2026: подвес физически крепится к ОСНОВНОМУ профилю (см.
  // исправление в шапке файла — было наоборот) — берём ТЕ ЖЕ bearingPositions
  // как ось снэпа (это точки пересечения вдоль пробега основного профиля),
  // не отдельную сетку. stepA здесь — это МАКСИМАЛЬНО допустимое расстояние
  // между подвесами по таблице (не обязательный шаг), не задан явно -> = stepB
  // (старое поведение 'user': на объекте это часто одно и то же расстояние
  // по факту).
  const stepA = extra.stepA ?? stepB
  const hangerPositions = snapHangerPositionsToAxis(bearingPositions, stepA)
  const hangersPerMain = hangerPositions.length
  const hangersTotal = mainCount * hangersPerMain

  const connectorsTotal = bearingCount * mainCount

  const bearingExtenders = bearingCount * Math.max(0, Math.ceil(bearingLengthEachMm / STANDARD_BAR_LENGTH_MM) - 1)
  const mainExtenders = mainCount * Math.max(0, Math.ceil(mainLengthEachMm / STANDARD_BAR_LENGTH_MM) - 1)

  const { kind, warning } = resolveHangerKind(slabGapMm)

  return {
    bearingCount, bearingLengthEachMm, bearingTotalLm, bearingPositions,
    mainCount, mainLengthEachMm, mainTotalLm, mainPositions,
    hangersPerMain, hangersTotal, hangerPositions,
    connectorsTotal, bearingExtenders, mainExtenders,
    hangerKind: kind, hangerWarning: warning,
  }
}
