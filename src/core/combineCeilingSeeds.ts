/**
 * Объединение нескольких именованных зон (Плита/Потолок с плана) в один
 * CeilingSeed для калькулятора потолка — пункт 4 из плана продолжения темы
 * потолков (KONSPEKT.md 10.07.2026): "несколько помещений 1/2/3 под одним
 * потолком" не всегда должны считаться по отдельности, иногда нужен один
 * расчёт материалов на всё сразу, но с сохранением того, что именно вошло.
 *
 * Периметр — сумма периметров зон по отдельности (не периметр внешнего
 * контура объединения). Это сознательный выбор пользователя: проще
 * технически (не нужно вычислять объединение полигонов и вычитать общие
 * границы между зонами), даёт небольшой запас материала на профиль
 * примыкания (ПН) вместо возможного недобора, если контуры зон на самом
 * деле разделены (обведены по отдельности, а не одним контуром).
 */

import type { CeilingSeedZone, CeilingSeed } from '../store/useCeilingSeedStore'

export function combineCeilingSeeds(zones: CeilingSeedZone[]): CeilingSeed {
  if (zones.length === 0) {
    throw new Error('combineCeilingSeeds: нужна хотя бы одна зона')
  }

  const areaSqm = Math.round(zones.reduce((sum, z) => sum + z.areaSqm, 0) * 100) / 100
  const perimeterM = Math.round(zones.reduce((sum, z) => sum + z.perimeterM, 0) * 100) / 100
  const holesCount = zones.reduce((sum, z) => sum + z.holesMm.length, 0)
  const label = zones.map(z => z.label).join(' + ')

  return { label, areaSqm, perimeterM, holesCount, zones }
}
