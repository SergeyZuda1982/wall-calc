import type { LiningInput, LiningResult, StudInfo, StudKind, Communication } from '../types'
import { COMM_HEADROOM_MIN } from '../types'
import { calcScrews } from './calcScrews'
import { buildCutList, BAR_LENGTH } from './cutList'
import { middleStudTotalLength, middleStudPieceCount } from './calcStudMaterial'
import type { Piece } from './cutList'
import { normalizeProfile, studHeightAt, integrateHeight, maxStudHeight, profilePathLength } from './profileGeometry'

const STUD_LENGTH = 3000

export function calcLining(input: LiningInput, positions: number[]): LiningResult {
  const { length: l, height: h, hangerStep, gklLayers, openings, layer1, layer2, plywoodInserts } = input
  const activeOpenings = openings.filter(o => o.width > 0)
  const activeCommunications = (input.communications ?? []).filter(c => c.width > 0)

  const isC623 = input.liningType === 'c623'

  // ─── Геометрия (плоская стена по умолчанию, либо ломаные линии) ──────────
  const ceilingProfile = normalizeProfile(input.ceilingProfile, l, h)
  const floorProfile = normalizeProfile(input.floorProfile, l, 0)
  const heightAt = (pos: number) => studHeightAt(pos, ceilingProfile, floorProfile)
  const worstHeight = maxStudHeight(ceilingProfile, floorProfile, l)

  // ─── Направляющие ────────────────────────────────────────────────────────
  // Напольная направляющая отсутствует под любым проёмом "от пола"
  // (sillHeight=0) — не только под дверью, но и под окном/проёмом без
  // подоконника (например, панорамное остекление в пол).
  const floorLevelOpenings = activeOpenings.filter(o => o.sillHeight === 0)

  // Реальные длины направляющих по ломаной (учитывают скат потолка/пола)
  const ceilingRail = profilePathLength(ceilingProfile, 0, l)
  const floorRail = (() => {
    let total = 0
    let cursor = 0
    for (const o of [...floorLevelOpenings].sort((a, b) => a.pos - b.pos)) {
      if (o.pos > cursor) total += profilePathLength(floorProfile, cursor, o.pos)
      cursor = o.pos + o.width
    }
    if (cursor < l) total += profilePathLength(floorProfile, cursor, l)
    return total
  })()
  const lintelTotal = activeOpenings.reduce((s, o) => s + (o.width + 400), 0)

  // Коммуникации (14.07.2026): нижняя перемычка всегда, верхняя — если запас
  // от верха коммуникации до верхнего ПН больше COMM_HEADROOM_MIN.
  function commHasTop(c: Communication): boolean {
    return heightAt(c.pos) - c.top > COMM_HEADROOM_MIN
  }
  const commLintelTotal = activeCommunications.reduce((s, c) => {
    const len = c.width + 400
    return s + len + (commHasTop(c) ? len : 0)
  }, 0)

  // Боковые направляющие (С623) — на той стороне(ах), где облицовка примыкает
  // к существующей стене (см. edgeKind ниже): pos=0 при abutment 'both'/'left',
  // pos=l при abutment 'both'/'right'. Длина — локальная высота в этой точке.
  let guideRail = 0
  if (isC623) {
    let sideRail = 0
    if (input.abutment === 'both' || input.abutment === 'left')  sideRail += heightAt(0)
    if (input.abutment === 'both' || input.abutment === 'right') sideRail += heightAt(l)
    guideRail = (floorRail + ceilingRail + sideRail + lintelTotal + commLintelTotal) / 1000
  } else {
    guideRail = (floorRail + ceilingRail + lintelTotal + commLintelTotal) / 1000
  }

  // ─── Стойки ──────────────────────────────────────────────────────────────
  const overlapMap: Record<string, number> = { ps50: 500, ps75: 750, ps100: 1000 }
  const overlap = overlapMap[input.profileType] ?? 750

  // Крайние стойки (pos===0 / pos===l) примыкают к существующей стене на стороне,
  // отмеченной в abutment как "Стена" — там стойка цельная, торец в торец, без
  // нахлёста (как wall-стойка в перегородке). Если сторона "Свободно" — оставляем
  // как обычную стойку с нахлёстом (она всё равно непрерывно держится подвесами/
  // кронштейнами на стене по всей высоте, в отличие от свободного края перегородки).
  function edgeKind(pos: number): 'wall' | 'middle' {
    if (pos === 0) return (input.abutment === 'both' || input.abutment === 'left') ? 'wall' : 'middle'
    if (pos === l) return (input.abutment === 'both' || input.abutment === 'right') ? 'wall' : 'middle'
    return 'middle'
  }

  function studLen(sh: number, kind: 'wall' | 'middle'): number {
    if (sh <= STUD_LENGTH || isC623) return sh
    if (kind === 'wall') return sh  // торец в торец, без нахлёста, длина = h
    // middle: n кусков с нахлёстом → h + (n-1)*overlap
    return middleStudTotalLength(sh, overlap)
  }

  function aboveHeight(pos: number): number | null {
    for (const o of activeOpenings) {
      if (pos > o.pos && pos < o.pos + o.width) {
        return heightAt(pos) - o.height - o.sillHeight
      }
    }
    return null
  }

  // Коммуникации: стойка ОСТАЁТСЯ на позиции (не становится door/window),
  // но режется на кусок под коммуникацией (всегда) и, если есть запас,
  // кусок над ней (см. commHasTop выше).
  function commSplit(pos: number): { belowLen: number; aboveLen: number; id: string } | null {
    for (const c of activeCommunications) {
      if (pos > c.pos && pos < c.pos + c.width) {
        const belowLen = c.bottom
        const aboveLen = commHasTop(c) ? (heightAt(pos) - c.top) : 0
        return { belowLen, aboveLen, id: c.id }
      }
    }
    return null
  }

  let studTotal = 0
  let aboveStuds = 0
  let hangers = 0
  let extenders = 0

  const countablePositions = isC623
    ? positions.filter(p => p !== 0 && p !== l)
    : positions

  for (const pos of countablePositions) {
    const above = aboveHeight(pos)
    const comm = above === null ? commSplit(pos) : null

    let sh: number // высота для hangers/extenders (C623) — общая по позиции
    if (above !== null) {
      sh = above
      studTotal += studLen(sh, 'middle')
      aboveStuds++
    } else if (comm !== null) {
      sh = comm.belowLen + comm.aboveLen
      studTotal += studLen(comm.belowLen, 'middle') + (comm.aboveLen > 0 ? studLen(comm.aboveLen, 'middle') : 0)
      aboveStuds++
    } else {
      sh = heightAt(pos)
      studTotal += studLen(sh, edgeKind(pos))
    }

    if (isC623) {
      hangers += Math.ceil(sh / hangerStep)
      extenders += Math.floor(sh / STUD_LENGTH)
    }
  }

  // ─── ГКЛ ─────────────────────────────────────────────────────────────────
  // Площадь между потолком и полом интегрируется по всей длине (для плоской
  // стены = l × h, как и раньше).
  const wallArea = integrateHeight(ceilingProfile, floorProfile, 0, l)
  const openingsArea = activeOpenings.reduce((s, o) => s + o.width * o.height, 0)
  const gklArea = ((wallArea - openingsArea) * gklLayers) / 1_000_000

  // ─── Раскрой ─────────────────────────────────────────────────────────────

  // ПН (или ПН 27×28 для С623): пол + потолок + боковые (С623) + перемычки
  const pnPcs: Piece[] = []

  // Пол (без дверных проёмов)
  let rem = floorRail
  while (rem > 0) {
    const c = Math.min(rem, BAR_LENGTH)
    pnPcs.push({ length: c, role: 'floor', label: `Пол ${c}мм`, mustBeWhole: false })
    rem -= c
  }

  // Потолок
  rem = ceilingRail
  while (rem > 0) {
    const c = Math.min(rem, BAR_LENGTH)
    pnPcs.push({ length: c, role: 'ceiling', label: `Потолок ${c}мм`, mustBeWhole: false })
    rem -= c
  }

  // Боковые направляющие (только С623) — те же стороны, что и в guideRail выше,
  // каждая по локальной высоте в своей точке (0 или l).
  if (isC623) {
    const sideAtZero = input.abutment === 'both' || input.abutment === 'left'
    const sideAtL    = input.abutment === 'both' || input.abutment === 'right'
    for (const sideHeight of [sideAtZero ? heightAt(0) : null, sideAtL ? heightAt(l) : null]) {
      if (sideHeight === null) continue
      rem = sideHeight
      while (rem > 0) {
        const c = Math.min(rem, BAR_LENGTH)
        pnPcs.push({ length: c, role: 'floor', label: `Боковая ${c}мм`, mustBeWhole: false })
        rem -= c
      }
    }
  }

  // Перемычки — целые куски
  for (const o of activeOpenings) {
    const len = o.width + 400
    pnPcs.push({ length: len, role: 'lintel', label: `Перемычка ${len}мм`, mustBeWhole: true })
  }

  // Перемычки коммуникаций — нижняя всегда, верхняя если запас > 400мм
  for (const c of activeCommunications) {
    const len = c.width + 400
    pnPcs.push({ length: len, role: 'lintel', label: `Перемычка под коммуникацией ${len}мм`, mustBeWhole: true })
    if (commHasTop(c)) {
      pnPcs.push({ length: len, role: 'lintel', label: `Перемычка над коммуникацией ${len}мм`, mustBeWhole: true })
    }
  }

  // ПС (С625/С626) или ПП 60×27 (С623): стойки
  const studPcs: Piece[] = []

  for (const pos of countablePositions) {
    const above = aboveHeight(pos)
    const sh = above !== null ? above : heightAt(pos)

    if (above !== null) {
      // Стойка попадает в зону проёма — только надпроёмная часть
      if (above > 0) {
        studPcs.push({ length: above, role: 'stud_part', label: `Над проёмом ${above}мм`, mustBeWhole: false })
      }
      // Подоконниковая часть (для оконных проёмов)
      const o = activeOpenings.find(o => pos > o.pos && pos < o.pos + o.width)
      if (o && o.sillHeight > 0) {
        studPcs.push({ length: o.sillHeight, role: 'stud_part', label: `Под подоконником ${o.sillHeight}мм`, mustBeWhole: false })
      }
    } else if (commSplit(pos) !== null) {
      // Стойка в зоне коммуникации — остаётся на позиции, режется на кусок
      // под коммуникацией (всегда) и, если есть запас, кусок над ней.
      const c = commSplit(pos)!
      if (c.belowLen > 0) {
        studPcs.push({ length: c.belowLen, role: 'stud_part', label: `Под коммуникацией ${c.belowLen}мм`, mustBeWhole: false })
      }
      if (c.aboveLen > 0) {
        studPcs.push({ length: c.aboveLen, role: 'stud_part', label: `Над коммуникацией ${c.aboveLen}мм`, mustBeWhole: false })
      }
    } else if (sh <= STUD_LENGTH) {
      // Высота вписывается в один профиль — один кусок
      studPcs.push({ length: sh, role: 'stud', label: `Стойка ${sh}мм`, mustBeWhole: false })
    } else if (isC623) {
      // С623: ПП 60×27 на подвесах — стыкуется удлинителями, без нахлёста.
      // n = ceil(h/3000) кусков: (n-1) × 3000 + остаток
      const nC623 = Math.ceil(sh / STUD_LENGTH)
      for (let i = 0; i < nC623 - 1; i++) {
        studPcs.push({ length: STUD_LENGTH, role: 'stud', label: `ПП 60×27 осн. ${STUD_LENGTH}мм`, mustBeWhole: false })
      }
      const restC623 = sh - (nC623 - 1) * STUD_LENGTH
      studPcs.push({ length: restC623, role: 'stud_part', label: `ПП 60×27 доп. ${restC623}мм`, mustBeWhole: false })
    } else if (edgeKind(pos) === 'wall') {
      // Крайняя стойка у стены — торец в торец, без нахлёста
      // n = ceil(h/3000) кусков: (n-1) × 3000 + остаток
      const nWall = Math.ceil(sh / STUD_LENGTH)
      for (let i = 0; i < nWall - 1; i++) {
        studPcs.push({ length: STUD_LENGTH, role: 'stud', label: `Стойка пристенная осн. ${STUD_LENGTH}мм`, mustBeWhole: false })
      }
      const restWall = sh - (nWall - 1) * STUD_LENGTH
      studPcs.push({ length: restWall, role: 'stud_part', label: `Стойка пристенная доп. ${restWall}мм`, mustBeWhole: false })
    } else {
      // Рядовая стойка, h > 3000 — n кусков с нахлёстом
      // n = 1 + ceil((h-3000)/step), step = 3000-overlap
      const step = STUD_LENGTH - overlap
      const n = middleStudPieceCount(sh, overlap)
      for (let i = 0; i < n - 1; i++) {
        studPcs.push({ length: STUD_LENGTH, role: 'stud', label: `Стойка осн. ${STUD_LENGTH}мм`, mustBeWhole: false })
      }
      const lastLen = sh - (n - 1) * step
      studPcs.push({ length: lastLen, role: 'stud_part', label: `Стойка доп. ${lastLen}мм`, mustBeWhole: false })
    }
  }

  const cutList = {
    pn:   buildCutList(pnPcs),
    stud: buildCutList(studPcs),
  }

  // ─── studInfos ───────────────────────────────────────────────────────────
  // Единый источник правды для отрисовки на canvas (как и в перегородке):
  // высота КАЖДОЙ стойки берётся отсюда, а не пересчитывается заново в
  // компоненте — чертёж физически не может разойтись со сметой.
  // height — это ВСЯ локальная высота (потолок−пол) в точке pos, а не
  // редуцированная "надпроёмная" длина (та считается отдельно в aboveHeight()
  // выше и используется только для материала/раскроя).
  const studInfos: StudInfo[] = positions.map((pos, idx) => {
    const insideOpening = activeOpenings.find(o => pos > o.pos && pos < o.pos + o.width)
    const onOpeningEdge = activeOpenings.find(o => pos === o.pos || pos === o.pos + o.width)
    const insideCommunication = !insideOpening ? activeCommunications.find(c => pos > c.pos && pos < c.pos + c.width) : undefined
    const kind: StudKind = insideOpening
      ? (insideOpening.type === 'door' ? 'door' : 'window')
      : (pos === 0 || pos === l) ? edgeKind(pos) : 'middle'
    // Чередование ориентации нахлёста — как и раньше в компоненте, просто
    // по чётности индекса в массиве позиций (визуальный приём, не влияет
    // на суммарный метраж, только на то, откуда "растёт" нахлёст).
    const orientation = idx % 2 === 0 ? 'down' : 'up'
    return {
      pos,
      kind,
      height: heightAt(pos),
      orientation,
      isAbove: !!insideOpening || !!insideCommunication,
      openingId: insideOpening?.id ?? onOpeningEdge?.id ?? null,
      communicationId: insideCommunication?.id ?? null,
    }
  })

  const screws = calcScrews(
    studInfos,
    openings,
    layer1,
    layer2,
    gklLayers as 1 | 2,
    1, // облицовка — одна сторона
    input.profileType === 'ps50' ? 500 : input.profileType === 'ps75' ? 750 : 1000,
    plywoodInserts,
    positions,
    activeCommunications,
    ceilingProfile,
    floorProfile,
  )

  return {
    guideRail,
    stud: studTotal / 1000,
    studsCount: countablePositions.length,
    hangers,
    extenders,
    gklArea,
    needsOverlap: worstHeight > STUD_LENGTH && !isC623,
    studInfos,
    cutList,
    rawPieces: { pn: pnPcs, stud: studPcs },
    screws,
  }
}