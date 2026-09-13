/**
 * Точный геометрический расчёт каркаса П131 (П231) — самонесущий подвесной
 * потолок на одинарном/спаренном каркасе, БЕЗ подвесов и без плиты
 * перекрытия как опоры (см. data/ceilingData.ts P131_FRAME_RATES:
 * hanger_direct=0). Источник топологии: официальная страница системы,
 * knauf.ru/catalog/find-products-and-systems/p-131-p-231.html.
 *
 * Устройство (проще, чем П112/П113 — один ряд профиля, без второго
 * перпендикулярного уровня):
 *
 *   ПН — крепится ТОЛЬКО к двум ДЛИННЫМ стенам помещения (не по всему
 *     периметру, в отличие от П112/П113 — подтверждено пользователем
 *     11.09.2026, совпадает с офиц. описанием Кнауфа). Формирует направляющий
 *     канал для ПС с обеих сторон пролёта.
 *   ПС — несущий, идёт ПОПЕРЁК, от одной ПН-рейки до другой. Длина каждого
 *     ПС = пролёт B (расстояние между двумя длинными стенами) — именно
 *     этот пролёт официально ограничен (см. P131_MAX_SPAN_SINGLE_MM).
 *     Межосевой шаг ПС — вдоль длинных стен (пролёт A), где ПС расставлены с
 *     шагом stepMm (официально ≤500мм на одинарном профиле).
 *   Спаренный ПС (2 профиля, стенками друг к другу, шурупы LB с шагом
 *     ≤750мм) — используется при layers=2 в этом калькуляторе (см.
 *     P131_SPECIAL_RATES: ps_profile_lm вдвое больше при layers=2), даёт
 *     больший пролёт без официально задокументированного верхнего предела —
 *     поэтому предупреждение о превышении пролёта выводим ТОЛЬКО для
 *     одинарного (layers=1) случая.
 *
 * Никакого второго (перпендикулярного) ряда профиля, подвесов или
 * соединителей в этой системе нет — ПС вставляется концами прямо в канал
 * ПН и крепится шурупами LB, ГКЛ крепится напрямую к ПС.
 */

import type { CeilingLayers } from '../data/ceilingData'
import { P131_MAX_SPAN_SINGLE_MM } from '../data/ceilingData'
import {
  calcFrameRowPositions,
  KNAUF_WALL_OFFSET_MM,
  STANDARD_BAR_LENGTH_MM,
  type FrameLayoutMode,
} from './calcP112Frame'

export interface P131FrameGeometry {
  /** Число ПС-профилей (несущих), перекрывающих пролёт между двумя ПН. */
  psCount: number
  /** Длина каждого ПС, мм = пролёт B между двумя длинными стенами. */
  psLengthEachMm: number
  /** Суммарная длина ПС, пог.м (при layers=2 — уже с учётом спаривания,
   *  то есть вдвое больше, чем psCount × psLengthEachMm / 1000). */
  psTotalLm: number
  /** Позиции ПС вдоль A (вдоль длинных стен), мм. */
  psPositions: number[]
  /** Суммарная длина ПН, пог.м — по ДВУМ длинным стенам (= 2×A), не весь
   *  периметр помещения. */
  pnTotalLm: number
  /** Лишние куски (удлинители) ПС, если пролёт B больше длины хлыста
   *  3000мм — на объекте такое уже нетипично для этой системы (пролёт
   *  официально ограничен 4250мм на одинарном), но не полагаемся на «обычно». */
  psExtenders: number
  /** То же для ПН, если A больше длины хлыста. */
  pnExtenders: number
  /** Предупреждение, если пролёт превышает официальный лимит Кнауфа
   *  (только для одинарного ПС, layers=1 — см. шапку файла). */
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
  //     ряды ПС с шагом stepMm).
  // B — пролёт, который перекрывает каждый ПС своей длиной.
  const A = pnAlongLength ? roomLengthMm : roomWidthMm
  const B = pnAlongLength ? roomWidthMm : roomLengthMm

  const defaultWallOffset = layoutMode === 'knauf' ? KNAUF_WALL_OFFSET_MM : undefined
  const wallOffsetMm = extra.wallOffsetMm ?? defaultWallOffset

  const psPositions = calcFrameRowPositions(A, stepMm, { mode: layoutMode, wallOffsetMm })
  const psCount = psPositions.length
  const psLengthEachMm = B

  // Спаренный ПС (layers=2) — по факту два физических профиля на каждую
  // позицию, отсюда множитель 2 в суммарной длине (см. P131_SPECIAL_RATES,
  // где ps_profile_lm при layers=2 ровно вдвое больше, чем при layers=1).
  const pairMultiplier = layers === 2 ? 2 : 1
  const psTotalLm = (psCount * psLengthEachMm * pairMultiplier) / 1000

  const pnTotalLm = (2 * A) / 1000

  const psExtenders = psCount * pairMultiplier
    * Math.max(0, Math.ceil(psLengthEachMm / STANDARD_BAR_LENGTH_MM) - 1)
  const pnExtendersPerRail = Math.max(0, Math.ceil(A / STANDARD_BAR_LENGTH_MM) - 1)
  const pnExtenders = pnExtendersPerRail * 2

  let spanWarning: string | undefined
  if (layers === 1 && B > P131_MAX_SPAN_SINGLE_MM) {
    spanWarning = `Пролёт ${Math.round(B)}мм превышает официальный лимит Кнауфа для одинарного ПС ` +
      `(${P131_MAX_SPAN_SINGLE_MM}мм) — рассмотрите спаренный ПС (2 слоя ГКЛ) или другой тип потолка`
  }

  return {
    psCount, psLengthEachMm, psTotalLm, psPositions,
    pnTotalLm, psExtenders, pnExtenders, spanWarning,
  }
}
