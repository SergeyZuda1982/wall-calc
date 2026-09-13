/**
 * Точный геометрический расчёт каркаса П131 (П231) — самонесущий подвесной
 * потолок на одинарном/спаренном каркасе, БЕЗ подвесов и без плиты
 * перекрытия как опоры (см. data/ceilingData.ts P131_FRAME_RATES:
 * hanger_direct=0). Источник топологии: официальная страница системы,
 * knauf.ru/catalog/find-products-and-systems/p-131-p-231.html + уточнение
 * пользователя 11.09.2026 (см. ниже про замыкающий ПС); источник таблицы
 * предельных пролётов по сечению — официальная таблица «Технические
 * характеристики подвесного потолка П131 (П231)» (фото предоставлено
 * пользователем 11.09.2026, см. P131_MAX_SPAN_MM в data/ceilingData.ts).
 *
 * Устройство (проще, чем П112/П113 — один ряд профиля, без второго
 * перпендикулярного уровня):
 *
 *   ПН — крепится ТОЛЬКО к двум ДЛИННЫМ стенам помещения (не по всему
 *     периметру, в отличие от П112/П113 — подтверждено пользователем
 *     11.09.2026, совпадает с офиц. описанием Кнауфа). Формирует направляющий
 *     канал для ПС с обеих сторон пролёта. Сечение 40мм в глубину (50×40,
 *     75×40, 100×40).
 *   ПС замыкающий — крепится к двум КОРОТКИМ стенам (сечение 50мм в глубину:
 *     50×50, 75×50, 100×50 — тот же типоразмер по ширине, что и несущий, но
 *     физически ОТДЕЛЬНАЯ деталь, НЕ входит в шаг 500мм — подтверждено
 *     пользователем 11.09.2026, уточнение по скриншоту канваса). Длина
 *     каждого = пролёт B (та же длина, что и у несущего — оба идут поперёк,
 *     от одной ПН-рейки до другой).
 *   ПС несущий — тоже идёт ПОПЕРЁК, от одной ПН-рейки до другой, с шагом
 *     stepMm (официально ≤500мм), расставлен НАЧИНАЯ от одной из коротких
 *     стен (то есть от замыкающего ПС, а не от нуля координаты — те же
 *     позиции, что вернёт calcFrameRowPositions).
 *
 * Официальный предел пролёта B — ПО-РАЗНОМУ для каждого сечения ПС
 * (50/75/100) и для одинарного/спаренного, см. selectP131ProfileConfig.
 * Предполагается, что замыкающий ПС того же сечения/спаривания, что и
 * несущий (подобранного по тому же пролёту B) — отдельно не уточнялось,
 * это разумное умолчание для единообразия закупки на объект.
 *
 * Сечение ПН/ПС (50, 75 или 100мм) и одинарный/спаренный — НЕ вводятся
 * пользователем, а подбираются автоматически как минимально достаточные
 * под заданный пролёт B и число слоёв ГКЛ (подтверждено пользователем
 * 11.09.2026 — см. selectP131ProfileConfig).
 */

import type { CeilingLayers, P131ProfileWidth } from '../data/ceilingData'
import { P131_MAX_SPAN_MM, P131_PROFILE_WIDTHS } from '../data/ceilingData'
import {
  calcFrameRowPositions,
  KNAUF_WALL_OFFSET_MM,
  STANDARD_BAR_LENGTH_MM,
  type FrameLayoutMode,
} from './calcP112Frame'

export interface P131ProfileSelection {
  /** Подобранное сечение ПС/ПН, мм. */
  widthMm: P131ProfileWidth
  /** Спаренный ПС (шурупы LB, шаг ≤750мм) или одинарный. */
  paired: boolean
  /** Максимальный пролёт для этой конфигурации по офиц. таблице, мм —
   *  для справки/UI (насколько близко к пределу). */
  maxSpanMm: number
}

/**
 * Подбирает минимально достаточное сечение ПС (и одинарный/спаренный) для
 * заданного пролёта B и числа слоёв ГКЛ — перебор в естественном порядке
 * «от меньшего расхода материала к большему»: 50 одинарный → 50 спаренный →
 * 75 одинарный → 75 спаренный → 100 одинарный → 100 спаренный, возвращается
 * первый вариант, чьего лимита достаточно.
 *
 * (Проверено: пределы из P131_MAX_SPAN_MM монотонно НЕ убывают в этом
 * порядке для обоих значений layers — то есть порядок переборa совпадает
 * с сортировкой по возрастанию пропускной способности, тай-брейк на равных
 * пределах — в пользу более узкого сечения со спариванием, а не более
 * широкого одинарного, т.к. спаривание дешевле замены сечения по факту
 * закупки одного типоразмера на объект.)
 *
 * null — пролёт превышает предел даже для ПС100 спаренного (нужен другой
 * тип потолка либо промежуточная опора).
 */
export function selectP131ProfileConfig(spanMm: number, layers: CeilingLayers): P131ProfileSelection | null {
  const table = P131_MAX_SPAN_MM[layers]
  for (const widthMm of P131_PROFILE_WIDTHS) {
    const limits = table[widthMm]
    if (spanMm <= limits.single) return { widthMm, paired: false, maxSpanMm: limits.single }
    if (spanMm <= limits.paired) return { widthMm, paired: true, maxSpanMm: limits.paired }
  }
  return null
}

export interface P131FrameGeometry {
  /** Подобранное сечение/одинарный-спаренный ПС — null, если пролёт B
   *  превышает предел даже для ПС100 спаренного (см. spanWarning). */
  profileSelection: P131ProfileSelection | null
  /** Позиции НЕСУЩИХ (шаговых, шаг stepMm) ПС вдоль A, мм — БЕЗ двух
   *  замыкающих у коротких стен (см. endClosureCount). Начинаются от
   *  первой стены на расстоянии шага (та же логика, что и у main/bearing
   *  П112/П113 — см. calcFrameRowPositions). */
  psRunningPositions: number[]
  /** Число замыкающих ПС у коротких стен — 2 (по одному на каждую), если
   *  оба пролёта (A и B) положительные, иначе 0 (вырожденный случай). */
  endClosureCount: number
  /** Итоговое число ПОЗИЦИЙ ПС (psRunningPositions.length + endClosureCount)
   *  — ДО учёта спаривания (для спаренного физических кусков вдвое больше,
   *  см. psTotalLm). */
  psCount: number
  /** Длина каждого ПС (несущего и замыкающего — одинаковая), мм = пролёт B
   *  между двумя длинными стенами. */
  psLengthEachMm: number
  /** Суммарная длина ПС, пог.м (несущие + замыкающие вместе) — уже с учётом
   *  спаривания (при paired=true вдвое больше, чем
   *  psCount × psLengthEachMm / 1000). */
  psTotalLm: number
  /** Суммарная длина ПН, пог.м — по ДВУМ длинным стенам (= 2×A), не весь
   *  периметр помещения. */
  pnTotalLm: number
  /** Лишние куски (удлинители) ПС, если пролёт B больше длины хлыста
   *  3000мм — считаются на КАЖДЫЙ физический профиль (при паре — на оба),
   *  включая замыкающие. */
  psExtenders: number
  /** То же для ПН, если A больше длины хлыста. */
  pnExtenders: number
  /** Предупреждение, если пролёт превышает предел даже для ПС100 спаренного
   *  (profileSelection=null) — вместо геометрии используется запасной
   *  вариант (100мм спаренный) с явной пометкой превышения. */
  spanWarning?: string
}

/**
 * Геометрия каркаса П131 для прямоугольного помещения.
 *
 * pnAlongLength: ПН идёт по стенам вдоль длины помещения, true (ПС тогда
 * перекрывает пролёт по ширине), или вдоль ширины, false (ПС перекрывает
 * пролёт по длине) — как и bearingAlongLength/mainAlongLength у П112/П113,
 * не определяется автоматически (монтажник сам решает, от какой пары стен
 * отталкиваться).
 */
export function calcP131FrameGeometry(
  roomLengthMm: number,
  roomWidthMm: number,
  stepMm: number,
  pnAlongLength: boolean,
  layers: CeilingLayers,
  layoutMode: FrameLayoutMode = 'user',
  extra: { wallOffsetMm?: number } = {},
): P131FrameGeometry {
  // A — пролёт вдоль которого идут ПН-рейки (и вдоль которого расставлены
  //     ряды несущего ПС с шагом stepMm, начиная от короткой стены).
  // B — пролёт, который перекрывает каждый ПС (несущий и замыкающий) своей
  //     длиной.
  const A = pnAlongLength ? roomLengthMm : roomWidthMm
  const B = pnAlongLength ? roomWidthMm : roomLengthMm

  const defaultWallOffset = layoutMode === 'knauf' ? KNAUF_WALL_OFFSET_MM : undefined
  const wallOffsetMm = extra.wallOffsetMm ?? defaultWallOffset

  const psRunningPositions = calcFrameRowPositions(A, stepMm, { mode: layoutMode, wallOffsetMm })
  const endClosureCount = A > 0 && B > 0 ? 2 : 0
  const psCount = psRunningPositions.length + endClosureCount
  const psLengthEachMm = B

  const selection = selectP131ProfileConfig(B, layers)
  let spanWarning: string | undefined
  // Запасной вариант для расчёта материалов, если пролёт превышает предел
  // даже для самого прочного варианта (100мм спаренный) — считаем ПО НЕМУ,
  // чтобы смета не обнулялась, но явно предупреждаем, что по факту нужно
  // либо другое конструктивное решение, либо промежуточная опора.
  const effective = selection ?? { widthMm: 100 as P131ProfileWidth, paired: true, maxSpanMm: P131_MAX_SPAN_MM[layers][100].paired }
  if (!selection) {
    spanWarning = `Пролёт ${Math.round(B)}мм превышает максимально допустимый по офиц. таблице Кнауф ` +
      `даже для ПС100 спаренного (${effective.maxSpanMm}мм при ${layers} слое(ях) ГКЛ) — нужна ` +
      `промежуточная опора или другой тип потолка. Материалы ниже посчитаны по ПС100 спаренному ` +
      `как максимально прочному варианту этой системы, но по факту такой пролёт ею не перекрывается.`
  }

  const pairMultiplier = effective.paired ? 2 : 1
  const psTotalLm = (psCount * psLengthEachMm * pairMultiplier) / 1000

  const pnTotalLm = (2 * A) / 1000

  const psExtenders = psCount * pairMultiplier
    * Math.max(0, Math.ceil(psLengthEachMm / STANDARD_BAR_LENGTH_MM) - 1)
  const pnExtendersPerRail = Math.max(0, Math.ceil(A / STANDARD_BAR_LENGTH_MM) - 1)
  const pnExtenders = pnExtendersPerRail * 2

  return {
    profileSelection: selection, psRunningPositions, endClosureCount, psCount, psLengthEachMm, psTotalLm,
    pnTotalLm, psExtenders, pnExtenders, spanWarning,
  }
}
