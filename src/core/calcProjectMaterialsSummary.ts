/**
 * calcProjectMaterialsSummary.ts — сводная смета количеств по ВСЕМУ объекту
 * (тип "materials_qty", см. KONSPEKT.md "роли, права доступа и сметы").
 * 18.09.2026, первая версия.
 *
 * ПРИНЦИП: ничего не считаем заново — только суммируем то, что уже считают
 * существующие движки (calcProjectCutList/calcProjectSheetLayout/calcCeiling/
 * calcRoomMaterials), каждый из которых уже покрыт тестами. Эта функция —
 * склейка их результатов в один список по видам материала, с разбивкой
 * "откуда взялось" по видам работ (не по конкретным конструкциям — иначе
 * список становится нечитаемым на объекте с полусотней стен).
 *
 * СОЗНАТЕЛЬНО НЕ ВХОДИТ (v1):
 * - Плитка — TileCalc.tsx ничего не сохраняет в проект (чисто локальный
 *   калькулятор, input в useState), агрегировать нечего. Нужна отдельная
 *   задача — завести персистентные "поверхности под плитку" в Room/PlanLine,
 *   как уже сделано для отделки (WorkProgress). Отмечено предупреждением.
 * - П19 (многоуровневый потолок) — calcCeiling() для него возвращает пустой
 *   materials (расчёт по индивидуальному проекту), попадает в warnings.
 * - Материал колонн (RoundColumn/RectColumn) — у них есть только геометрия+
 *   spec, точного расчёта расхода профиля/листа по ним нет нигде в коде
 *   (closingVolumesReport.ts считает по ним только СТОИМОСТЬ по тарифу
 *   труда, не расход материала). Отдельная задача.
 * - Цены — их нет вообще нигде в проекте (только laborPriceTiers.ts —
 *   ставка труда). Эта смета только про количество.
 */
import type { WallEntry, LiningEntry } from '../store/useProjectStore'
import type { Ceiling, Room, PlanLine, BoardSpec } from '../types'
import { calcProjectCutList, type ProfilePool } from './calcProjectCutList'
import {
  calcProjectSheetLayout, buildSurfaceInputs, buildCeilingSurfaceInputs,
  type SurfaceSheetInput, type PolygonSurfaceInput,
} from './calcProjectSheetLayout'
import { calcCeiling } from './calcCeiling'
import { calcRoomMaterials } from './calcRoomMaterials'
import type { MaterialKind } from '../data/workMaterialCatalog'
import { getBoardSubtypeAbbr } from '../data/constructionTaxonomy'

export interface MaterialSummaryRow {
  label: string
  unit: string
  /** Основное число (листы/шт/кг и т.п.) — уже округлено под партию, где это уместно. */
  qty: number
  /** Доп. строка под числом (напр. "18 шт" под площадью плитки) — опционально. */
  qtySub?: string
  /** "стены — 22 шт, потолки — 16 шт" — по видам работ, приблизительно (см. заголовок файла). */
  sources: string
}

export interface MaterialSummaryGroup {
  title: string
  hint?: string
  rows: MaterialSummaryRow[]
}

export interface ProjectMaterialsSummary {
  groups: MaterialSummaryGroup[]
  warnings: string[]
  totalRows: number
}

const POOL_LABELS: Record<ProfilePool, string> = {
  pn_50: 'ПН 50×40', pn_75: 'ПН 75×40', pn_100: 'ПН 100×40',
  ps_50: 'ПС 50×50', ps_75: 'ПС 75×50', ps_100: 'ПС 100×50',
  pp_60x27: 'ПП 60×27', pn_27x28: 'ПН 27×28',
}
const POOL_ORDER: ProfilePool[] = ['pn_27x28', 'pp_60x27', 'pn_50', 'ps_50', 'pn_75', 'ps_75', 'pn_100', 'ps_100']

function boardSpecKey(b: BoardSpec): string { return `${b.material}_${b.thickness}` }
function boardSpecLabel(b: BoardSpec): string {
  if (b.material === 'gvl') return `ГВЛ ${b.thickness}мм`
  if (b.material === 'sapphire') return `ГКЛ Сапфир ${b.thickness}мм`
  if (b.material === 'aquamarine') return `ГКЛ Аквамарин ${b.thickness}мм`
  const abbr = getBoardSubtypeAbbr(b.subtype ?? undefined)
  return `${abbr || 'ГКЛ'} ${b.thickness}мм`
}

const PACKAGE_UNIT_LABEL: Record<string, string> = {
  bag: 'меш.', can: 'банка', bucket: 'ведро', pack: 'уп.',
}

/** Источник по трём видам работ — "стены — 12, облицовка — 3, потолки — 5". Опускает нулевые. */
function joinSources(parts: [string, number][]): string {
  return parts.filter(([, v]) => v > 0).map(([label, v]) => `${label} — ${v}`).join(', ') || '—'
}

export function calcProjectMaterialsSummary(
  walls: WallEntry[],
  linings: LiningEntry[],
  ceilings: Ceiling[],
  rooms: Room[],
  allLines: PlanLine[],
  scaleMmPx: number,
): ProjectMaterialsSummary {
  const warnings: string[] = []

  // ─── Профиль ────────────────────────────────────────────────────────────
  // Считаем 4 раза (полный + по каждому виду работ отдельно) — раскрой
  // общий даёт реальную оптимизацию (обрезки шарятся между стеной и
  // потолком), а раздельные вызовы нужны только для колонки "источник"
  // (сколько бы понадобилось прутков, если бы считать этот вид работ в
  // одиночку — оценка, не строгая арифметика, т.к. общий пул экономит
  // за счёт совместной упаковки).
  const cutAll = calcProjectCutList(walls, linings, ceilings)
  const cutWalls = calcProjectCutList(walls, [], [])
  const cutLinings = calcProjectCutList([], linings, [])
  const cutCeilings = calcProjectCutList([], [], ceilings)

  const profileRows: MaterialSummaryRow[] = []
  for (const pool of POOL_ORDER) {
    const total = cutAll.pools[pool]?.totalBars ?? 0
    if (total <= 0) continue
    profileRows.push({
      label: POOL_LABELS[pool], unit: 'прут. 3м', qty: total,
      sources: joinSources([
        ['стены', cutWalls.pools[pool]?.totalBars ?? 0],
        ['облицовка', cutLinings.pools[pool]?.totalBars ?? 0],
        ['потолки', cutCeilings.pools[pool]?.totalBars ?? 0],
      ]),
    })
  }

  // ─── ГКЛ-листы ──────────────────────────────────────────────────────────
  // Та же логика: общий вызов даёт реальное число листов (с шарингом
  // обрезков между стеной/облицовкой/потолком одной спецификации),
  // источник — из отдельных вызовов на каждый вид работ.
  const wallLiningSurfaces = buildSurfaceInputs(walls, linings)
  const ceilingSurfaces = buildCeilingSurfaceInputs(ceilings, scaleMmPx)
  const sheetAll = calcProjectSheetLayout(wallLiningSurfaces, ceilingSurfaces)
  const sheetWallsOnly = calcProjectSheetLayout(buildSurfaceInputs(walls, []), [])
  const sheetLiningsOnly = calcProjectSheetLayout(buildSurfaceInputs([], linings), [])
  const sheetCeilingsOnly = calcProjectSheetLayout([], ceilingSurfaces)

  function sheetsBySpec(
    surfaces: SurfaceSheetInput[], polySurfaces: PolygonSurfaceInput[],
    result: ReturnType<typeof calcProjectSheetLayout>,
  ): Map<string, number> {
    const specById = new Map<string, BoardSpec>()
    for (const s of surfaces) specById.set(s.id, s.layer1)
    for (const s of polySurfaces) specById.set(s.id, s.layer1)
    const out = new Map<string, number>()
    for (const r of result.surfaces) {
      const spec = specById.get(r.id)
      if (!spec) continue
      const key = boardSpecKey(spec)
      out.set(key, (out.get(key) ?? 0) + r.result.totalSheetsNeeded)
    }
    return out
  }
  const allBySpec = sheetsBySpec(wallLiningSurfaces, ceilingSurfaces, sheetAll)
  const wallsBySpec = sheetsBySpec(buildSurfaceInputs(walls, []), [], sheetWallsOnly)
  const liningsBySpec = sheetsBySpec(buildSurfaceInputs([], linings), [], sheetLiningsOnly)
  const ceilingsBySpec = sheetsBySpec([], ceilingSurfaces, sheetCeilingsOnly)

  const specLabels = new Map<string, string>()
  for (const s of [...wallLiningSurfaces]) specLabels.set(boardSpecKey(s.layer1), boardSpecLabel(s.layer1))
  for (const s of ceilingSurfaces) specLabels.set(boardSpecKey(s.layer1), boardSpecLabel(s.layer1))

  const sheetRows: MaterialSummaryRow[] = []
  for (const [key, qty] of allBySpec) {
    if (qty <= 0) continue
    sheetRows.push({
      label: specLabels.get(key) ?? key, unit: 'лист', qty,
      sources: joinSources([
        ['стены', wallsBySpec.get(key) ?? 0],
        ['облицовка', liningsBySpec.get(key) ?? 0],
        ['потолки', ceilingsBySpec.get(key) ?? 0],
      ]),
    })
  }

  // ─── Крепёж и подвесы ───────────────────────────────────────────────────
  // Стены/облицовка — точный ScrewResult (реальные позиции стоек).
  // Потолки — приблизительный расход на м² (calcCeiling.materials), т.к.
  // у потолков нет позиционного расчёта крепежа, как у стен — честно
  // разного качества источники, но другого пока в коде нет.
  let ln11 = 0, tn25 = 0, tn35 = 0
  let ln11W = 0, tn25W = 0, tn35W = 0
  let ln11L = 0, tn25L = 0, tn35L = 0
  for (const w of walls) {
    const screws = w.kind === 'double'
      ? null // двойной каркас — свой формат результата, screws не в CalcResult; пропускаем в v1
      : w.result?.screws
    if (!screws) continue
    ln11 += screws.ln11; tn25 += screws.count25; tn35 += screws.count35
    ln11W += screws.ln11; tn25W += screws.count25; tn35W += screws.count35
  }
  for (const l of linings) {
    const screws = l.result?.screws
    if (!screws) continue
    ln11 += screws.ln11; tn25 += screws.count25; tn35 += screws.count35
    ln11L += screws.ln11; tn25L += screws.count25; tn35L += screws.count35
  }
  let ceilScrews = 0, ceilTape = 0, ceilHangers = 0
  const ceilingMatByName = new Map<string, number>()
  for (const c of ceilings) {
    if (!c.ceilingSpec) continue
    const r = calcCeiling(c.ceilingSpec)
    if (c.ceilingSpec.type === 'p19') {
      warnings.push(`Потолок «${c.label}» (П19, многоуровневый) не учтён в смете — считается по индивидуальному проекту.`)
      continue
    }
    for (const m of r.materials) {
      if (/шуруп|саморез|дюбель/i.test(m.name)) ceilScrews += m.qty
      else if (/подвес/i.test(m.name)) ceilHangers += m.qty
      else if (/лента/i.test(m.name)) ceilTape += m.qty
      ceilingMatByName.set(m.name, (ceilingMatByName.get(m.name) ?? 0) + m.qty)
    }
  }

  const fastenerRows: MaterialSummaryRow[] = []
  if (tn25 + tn35 > 0) fastenerRows.push({
    label: 'Саморез TN/MN/XTN 25-35мм (обшивка)', unit: 'шт', qty: tn25 + tn35,
    sources: joinSources([['стены', tn25W + tn35W], ['облицовка', tn25L + tn35L]]),
  })
  if (ln11 > 0) fastenerRows.push({
    label: 'Саморез LN 11мм (клопы, металл-металл)', unit: 'шт', qty: ln11,
    sources: joinSources([['стены', ln11W], ['облицовка', ln11L]]),
  })
  if (ceilScrews > 0) fastenerRows.push({
    label: 'Саморезы/дюбели каркаса потолка', unit: 'шт', qty: Math.round(ceilScrews),
    sources: 'потолки — оценочно, на м² (нет позиционного расчёта)',
  })
  if (ceilHangers > 0) fastenerRows.push({
    label: 'Подвесы', unit: 'шт', qty: Math.round(ceilHangers), sources: 'потолки П112/П113',
  })
  if (ceilTape > 0) fastenerRows.push({
    label: 'Лента уплотнительная', unit: 'пог.м', qty: Math.round(ceilTape), sources: 'потолки',
  })

  // ─── Отделочные материалы (грунтовка/штукатурка/шпаклёвка/краска и т.п.) ──
  const finishTotals = new Map<MaterialKind, { totalMass: number; packageSize: number; label: string; unit: string; roomCount: number }>()
  for (const room of rooms) {
    if (room.isColumn) continue
    const { pooled } = calcRoomMaterials(room, allLines)
    for (const kind of Object.keys(pooled) as MaterialKind[]) {
      const acc = pooled[kind]!
      const existing = finishTotals.get(kind)
      finishTotals.set(kind, {
        totalMass: (existing?.totalMass ?? 0) + acc.totalMass,
        packageSize: acc.rate.packageSize,
        label: acc.rate.label,
        unit: PACKAGE_UNIT_LABEL[acc.rate.packageUnit] ?? acc.rate.packageUnit,
        roomCount: (existing?.roomCount ?? 0) + 1,
      })
    }
  }
  const finishRows: MaterialSummaryRow[] = []
  for (const [, v] of finishTotals) {
    const packages = v.packageSize > 0 ? Math.ceil(v.totalMass / v.packageSize) : 0
    if (packages <= 0) continue
    finishRows.push({
      label: v.label, unit: v.unit, qty: packages,
      sources: `${v.roomCount} ${v.roomCount === 1 ? 'помещение' : v.roomCount < 5 ? 'помещения' : 'помещений'}`,
    })
  }

  const groups: MaterialSummaryGroup[] = [
    { title: 'ГКЛ-листы', rows: sheetRows },
    { title: 'Профиль', rows: profileRows },
    { title: 'Крепёж и подвесы', rows: fastenerRows },
    {
      title: 'Отделочные материалы', rows: finishRows,
      hint: 'Только там, где на стене/потолке/полу отмечен этап отделки — не по голому каркасу.',
    },
  ]

  if (ceilings.length === 0 && walls.length === 0) {
    warnings.push('В проекте пока нет ни одной стены/потолка — считать нечего.')
  }
  warnings.push('Плитка не входит в смету — калькулятор плитки (TileCalc) пока не сохраняет данные в проект.')

  const totalRows = groups.reduce((s, g) => s + g.rows.length, 0)
  return { groups, warnings, totalRows }
}
