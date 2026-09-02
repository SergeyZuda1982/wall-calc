/**
 * useDoubleFrameCalc.ts — интерактивный расчёт двойного каркаса С115/С116
 * (01.09.2026). Зеркалит useWallCalc.ts почти один в один: та же механика
 * перетаскивания/добавления/удаления стойки мышкой на канвасе. Отличие —
 * ОДНА сетка позиций стоек управляет ДВУМЯ независимыми рядами каркаса
 * (frameA/frameB, см. calcDoubleFrame.ts) вместо одного CalcResult.
 *
 * Специально НЕ переиспользует useWallCalc() напрямую (а не параметризует
 * его "режимом") — чтобы ни одной строкой не рисковать поведением обычных
 * С111/С112, которое уже отлажено и покрыто тестами.
 */
import { useState, useRef } from 'react'
import { CANVAS_W, PAD } from '../constants'
import type { CalcResult, DrawingSnap, EdgeProfile, BoardSpec, DoubleFrameType, PlywoodInsert } from '../types'
import { DEFAULT_BOARD_SPEC } from '../types'
import { getProfile, DEFAULT_PROFILE } from '../data/profiles'
import { buildPositions, buildFromPhase } from '../core/buildPositions'
import { normalizeProfile, maxStudHeight } from '../core/profileGeometry'
import {
  calcDoubleFrameFromPositions, calcDoubleFrameExtras,
  type DoubleFrameInput, type DoubleFrameResult,
} from '../core/calcDoubleFrame'
import { getDoubleFrameThicknessMm } from '../data/constructionTaxonomy'

/** Часть DoubleFrameResult, не зависящая от positions (см. calcDoubleFrameExtras) — вычисляется один раз в calculate(). */
type DoubleFrameExtras = Pick<DoubleFrameResult, 'separatorAreaM2' | 'tapeStrips' | 'extraLayerAreaM2' | 'extraLayerScrews'>

export interface UseDoubleFrameCalcReturn {
  positions: number[]
  snap: DrawingSnap
  resultA: CalcResult | null
  resultB: CalcResult | null
  extras: DoubleFrameExtras | null
  thicknessMm: number
  sealingTapeLm: number
  profileWidth: number
  currentFirstStud: number
  currentStep: number

  calculate: (input: DoubleFrameInput) => void
  onDragEnd: (studPos: number, xpx: number) => void
  onRightDragEnd: (_studPos: number, xpx: number, startXpx: number) => void
  shiftGrid: (deltaMm: number) => void
  addStud: (xpx: number) => void
  removeStud: (studPos: number) => void
}

export function useDoubleFrameCalc(): UseDoubleFrameCalcReturn {
  const [positions, setPositions] = useState<number[]>([])
  const [snap, setSnap] = useState<DrawingSnap>({ l: 0, h: 0, openings: [], communications: [], ceilingProfile: [], floorProfile: [] })
  const [resultA, setResultA] = useState<CalcResult | null>(null)
  const [resultB, setResultB] = useState<CalcResult | null>(null)
  const [extras, setExtras] = useState<DoubleFrameExtras | null>(null)
  const [thicknessMm, setThicknessMm] = useState(0)
  const [sealingTapeLm, setSealingTapeLm] = useState(0)
  const [currentFirstStud, setCurrentFirstStud] = useState(0)
  const [currentStep, setCurrentStep] = useState(0)

  const profileRef = useRef(DEFAULT_PROFILE)
  const abutmentRef = useRef<string>('both')
  const dfTypeRef = useRef<DoubleFrameType>('c115_1')
  const overlapRef = useRef(DEFAULT_PROFILE.overlap)
  const stepRef = useRef(600)
  const phaseRef = useRef(0)
  const gridShiftRef = useRef(0)
  const layerA1Ref = useRef<BoardSpec>(DEFAULT_BOARD_SPEC)
  const layerA2Ref = useRef<BoardSpec>(DEFAULT_BOARD_SPEC)
  const layerB1Ref = useRef<BoardSpec>(DEFAULT_BOARD_SPEC)
  const layerB2Ref = useRef<BoardSpec>(DEFAULT_BOARD_SPEC)
  const layerB3Ref = useRef<BoardSpec | undefined>(undefined)
  const plywoodARef = useRef<PlywoodInsert[]>([])
  const plywoodBRef = useRef<PlywoodInsert[]>([])
  const gapMmRef = useRef<number | undefined>(undefined)
  const profileTypeRef = useRef<import('../types').ProfileType>('ps50')

  // Стойки, которые нельзя удалить или двигать — как у useWallCalc.ts:
  // крайние (0, l) + торцевые стойки проёмов.
  function isFixed(p: number, s: DrawingSnap): boolean {
    if (p === 0 || p === s.l) return true
    for (const o of s.openings) {
      if (o.width > 0 && (p === o.pos || p === o.pos + o.width)) return true
    }
    return false
  }

  function _update(next: number[], currentSnap: DrawingSnap) {
    setPositions(next)
    const { frameA, frameB } = calcDoubleFrameFromPositions(
      next, currentSnap.ceilingProfile, currentSnap.floorProfile, currentSnap.l,
      currentSnap.openings, abutmentRef.current, overlapRef.current, dfTypeRef.current,
      layerA1Ref.current, layerA2Ref.current, layerB1Ref.current, layerB2Ref.current,
      plywoodARef.current, plywoodBRef.current,
    )
    setResultA(frameA)
    setResultB(frameB)
    setSealingTapeLm(frameA.sealingTapeLm + frameB.sealingTapeLm)
    // extras (разделитель/штучная лента/3-й слой) от positions не зависят
    // (см. calcDoubleFrameExtras) — пересчитываем на каждый драг только
    // потому, что frameB под рукой уже есть; результат не меняется.
    setExtras(calcDoubleFrameExtras(
      dfTypeRef.current, next, currentSnap.ceilingProfile, currentSnap.floorProfile,
      currentSnap.l, stepRef.current, currentSnap.openings, overlapRef.current,
      frameB, layerB3Ref.current,
    ))
  }

  function calculate(input: DoubleFrameInput) {
    const { dfType, profileType, abutment,
            length: l, height: h, step: s, firstStud, openings } = input

    if (!l || !h || !s) return

    const profile = getProfile(profileType)
    profileRef.current = { ...profile, overlap: input.overlap || profile.overlap }
    abutmentRef.current = abutment
    dfTypeRef.current = dfType
    profileTypeRef.current = profileType
    overlapRef.current = input.overlap || profile.overlap
    stepRef.current = s
    layerA1Ref.current = input.layerA1
    layerA2Ref.current = input.layerA2
    layerB1Ref.current = input.layerB1
    layerB2Ref.current = input.layerB2
    layerB3Ref.current = input.layerB3
    plywoodARef.current = input.plywoodInsertsA ?? []
    plywoodBRef.current = input.plywoodInsertsB ?? []
    gapMmRef.current = input.gapMm

    const ceilingProfile: EdgeProfile = normalizeProfile(input.ceilingProfile, l, h)
    const floorProfile: EdgeProfile = normalizeProfile(input.floorProfile, l, 0)
    // Известное упрощение (пока нет таблиц макс. высоты для С115/С116, см.
    // data/maxHeight.ts) — предупреждение о превышении высоты здесь не
    // выводится, как у одинарной стены; сама высота всё равно учитывается
    // корректно в геометрии/раскрое.
    void maxStudHeight(ceilingProfile, floorProfile, l)

    setThicknessMm(getDoubleFrameThicknessMm(dfType, profileType, input.gapMm))

    const { positions: studs, phase } = buildPositions(l, s, firstStud, openings)
    const newSnap: DrawingSnap = { l, h, openings, communications: [], ceilingProfile, floorProfile }

    phaseRef.current = phase
    gridShiftRef.current = 0
    setCurrentFirstStud(phase)
    setCurrentStep(s)
    setSnap(newSnap)
    _update(studs, newSnap)
  }

  function onDragEnd(studPos: number, xpx: number) {
    if (!snap.l) return
    const sc = (CANVAS_W - PAD * 2) / snap.l
    const newMm = Math.round((xpx - PAD) / sc / 100) * 100
    const clamped = Math.max(1, Math.min(snap.l - 1, newMm))
    const next = positions.map(p => {
      if (isFixed(p, snap)) return p
      if (p === studPos) return clamped
      return p
    })
    _update([...new Set(next)].sort((a, b) => a - b), snap)
  }

  function onRightDragEnd(_studPos: number, xpx: number, startXpx: number) {
    if (!snap.l) return
    const sc = (CANVAS_W - PAD * 2) / snap.l
    const deltaMm = Math.round((xpx - startXpx) / sc / 100) * 100
    if (deltaMm === 0) return
    gridShiftRef.current += deltaMm
    _rebuildWithShift()
  }

  function shiftGrid(deltaMm: number) {
    if (!snap.l || deltaMm === 0) return
    gridShiftRef.current += deltaMm
    _rebuildWithShift()
  }

  function _rebuildWithShift() {
    if (!snap.l) return
    const newPhase = phaseRef.current + gridShiftRef.current
    const { positions: next, phase: actualPhase } = buildFromPhase(snap.l, stepRef.current, newPhase, snap.openings)
    setCurrentFirstStud(actualPhase)
    _update(next, snap)
  }

  function addStud(xpx: number) {
    if (!snap.l) return
    const sc = (CANVAS_W - PAD * 2) / snap.l
    const mm = Math.round((xpx - PAD) / sc / 100) * 100
    if (mm <= 0 || mm >= snap.l) return
    _update([...new Set([...positions, mm])].sort((a, b) => a - b), snap)
  }

  function removeStud(studPos: number) {
    if (isFixed(studPos, snap)) return
    _update(positions.filter(p => p !== studPos), snap)
  }

  return {
    positions, snap, resultA, resultB, extras, thicknessMm, sealingTapeLm,
    profileWidth: profileRef.current.width,
    currentFirstStud, currentStep,
    calculate, onDragEnd, onRightDragEnd, shiftGrid, addStud, removeStud,
  }
}
