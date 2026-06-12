import { useState, useRef } from 'react'
import type { WallInput, CalcResult, DrawingSnap } from '../types'
import { getProfile, DEFAULT_PROFILE } from '../data/profiles'
import { getMaxHeight } from '../data/maxHeight'
import { buildPositions, buildFromPhase } from '../core/buildPositions'
import { calcResults } from '../core/calcResults'

const CANVAS_W = 820
const PAD = 60

export interface UseWallCalcReturn {
  positions: number[]
  snap: DrawingSnap
  result: CalcResult | null
  heightWarning: string | null
  profileWidth: number

  calculate: (input: WallInput) => void
  onDragEnd: (studPos: number, xpx: number) => void
  onRightDragEnd: (_studPos: number, xpx: number, startXpx: number) => void
  shiftGrid: (deltaMm: number) => void
  addStud: (xpx: number) => void
  removeStud: (studPos: number) => void
}

export function useWallCalc(): UseWallCalcReturn {
  const [positions, setPositions] = useState<number[]>([])
  const [snap, setSnap] = useState<DrawingSnap>({ l: 0, h: 0, openings: [] })
  const [result, setResult] = useState<CalcResult | null>(null)
  const [heightWarning, setHeightWarning] = useState<string | null>(null)

  const profileRef = useRef(DEFAULT_PROFILE)
  const abutmentRef = useRef('both')
  const wallTypeRef = useRef('c111')
  const overlapRef = useRef(DEFAULT_PROFILE.overlap)
  const stepRef = useRef(600)
  const phaseRef = useRef(0)       // фаза периодической сетки (мм, 0..step-1)
  const gridShiftRef = useRef(0)   // накопленный пользовательский сдвиг (мм)

  function isFixed(p: number, s: DrawingSnap): boolean {
    if (p === 0 || p === s.l) return true
    for (const o of s.openings) {
      if (o.width > 0 && (p === o.pos || p === o.pos + o.width)) return true
    }
    return false
  }

  function _update(next: number[], currentSnap: DrawingSnap) {
    setPositions(next)
    const res = calcResults(
      next, currentSnap.h, currentSnap.l,
      currentSnap.openings,
      abutmentRef.current, overlapRef.current,
      wallTypeRef.current === 'c112' ? 2 : 1,
    )
    setResult(res)
  }

  function calculate(input: WallInput) {
    const { wallType, profileType, profileThickness, abutment,
            length: l, height: h, step: s, firstStud, openings } = input

    if (!l || !h || !s) return

    const profile = getProfile(profileType)
    const effectiveOverlap = input.customOverlap != null && input.customOverlap >= 100
      ? input.customOverlap
      : profile.overlap

    profileRef.current = { ...profile, overlap: effectiveOverlap }
    abutmentRef.current = abutment
    wallTypeRef.current = wallType
    overlapRef.current = effectiveOverlap
    stepRef.current = s

    const maxH = getMaxHeight(wallType, profileType, s, profileThickness)
    if (maxH > 0 && h > maxH) {
      const thickLabel = profileThickness === '06' ? '0.6' : '0.7'
      setHeightWarning(
        `⚠️ Высота ${(h / 1000).toFixed(2)}м превышает максимально допустимую ` +
        `${(maxH / 1000).toFixed(2)}м по Кнауф для ${profileType.toUpperCase()}, ` +
        `шаг ${s}мм, профиль ${thickLabel}мм.`
      )
    } else {
      setHeightWarning(null)
    }

    const { positions: studs, phase } = buildPositions(l, s, firstStud, openings)
    const newSnap: DrawingSnap = { l, h, openings }

    phaseRef.current = phase
    gridShiftRef.current = 0
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

  // Пересобирает сетку с новой фазой = базовая фаза + накопленный сдвиг.
  // Сетка периодическая, поэтому при сдвиге больше шага стойка автоматически
  // "появляется" с противоположного края. Конфликт MIN_GAP с проёмами
  // проверяется заново.
  function _rebuildWithShift() {
    if (!snap.l) return
    const newPhase = phaseRef.current + gridShiftRef.current
    const { positions: next } = buildFromPhase(snap.l, stepRef.current, newPhase, snap.openings)
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
    positions, snap, result, heightWarning,
    profileWidth: profileRef.current.width,
    calculate, onDragEnd, onRightDragEnd, shiftGrid, addStud, removeStud,
  }
}

export { CANVAS_W, PAD }
