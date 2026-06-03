import { useState, useRef } from 'react'
import type { WallInput, CalcResult, DrawingSnap } from '../types'
import { getProfile, DEFAULT_PROFILE } from '../data/profiles'
import { getMaxHeight } from '../data/maxHeight'
import { buildPositions } from '../core/buildPositions'
import { calcResults } from '../core/calcResults'

const CANVAS_W = 820
const PAD = 60

export interface UseWallCalcReturn {
  // состояние
  positions: number[]
  snap: DrawingSnap
  result: CalcResult | null
  heightWarning: string | null
  profileWidth: number  // ширина текущего профиля в мм (для чертежа)

  // действия
  calculate: (input: WallInput) => void
  onDragEnd: (studPos: number, xpx: number) => void
  addStud: (xpx: number) => void
  removeStud: (studPos: number) => void
}

export function useWallCalc(): UseWallCalcReturn {
  const [positions, setPositions] = useState<number[]>([])
  const [snap, setSnap] = useState<DrawingSnap>({ l: 0, h: 0, dw: 0, dh: 0, dp: 0 })
  const [result, setResult] = useState<CalcResult | null>(null)
  const [heightWarning, setHeightWarning] = useState<string | null>(null)

  // ref вместо state — чтобы чертёж не ре-рендерился при каждом драге
  const profileRef = useRef(DEFAULT_PROFILE)

  // ─── Приватный пересчёт по уже готовым позициям + снапшоту ─────────────────
  function _update(next: number[], currentSnap: DrawingSnap) {
    setPositions(next)
    setResult(calcResults(
      next,
      currentSnap.h,
      currentSnap.l,
      currentSnap.dw,
      currentSnap.dh,
      currentSnap.dp,
      // abutment не нужен в snap — передаётся через calculate
      // но нам нужен для calcResults... решение: храним в ref
      abutmentRef.current,
      profileRef.current.overlap,
    ))
  }

  const abutmentRef = useRef('both')

  // ─── Основной расчёт ────────────────────────────────────────────────────────
  function calculate(input: WallInput) {
    const { wallType, profileType, profileThickness, abutment,
            length: l, height: h, step: s, firstStud,
            doorPos: dp, doorWidth: dw, doorHeight: dh } = input

    if (!l || !h || !s) return

    const profile = getProfile(profileType)
    profileRef.current = profile
    abutmentRef.current = abutment

    // Проверка максимальной высоты по Кнауф
    const maxH = getMaxHeight(wallType, profileType, s, profileThickness)
    if (maxH > 0 && h > maxH) {
      const thickLabel = profileThickness === '06' ? '0.6' : '0.7'
      setHeightWarning(
        `⚠️ Высота ${(h / 1000).toFixed(2)}м превышает максимально допустимую ` +
        `${(maxH / 1000).toFixed(2)}м по Кнауф для ${profileType.toUpperCase()}, ` +
        `шаг ${s}мм, профиль ${thickLabel}мм. Уменьшите шаг или возьмите профиль большего размера.`
      )
    } else {
      setHeightWarning(null)
    }

    const studs = buildPositions(l, s, firstStud, dp, dw)
    const newSnap: DrawingSnap = { l, h, dw, dh, dp }

    setSnap(newSnap)
    setPositions(studs)
    setResult(calcResults(studs, h, l, dw, dh, dp, abutment, profile.overlap))
  }

  // ─── Перемещение стойки (исправленный onDragEnd) ────────────────────────────
  // Принимает позицию стойки в мм (а не индекс!) — так индекс не может съехать
  function onDragEnd(studPos: number, xpx: number) {
    if (!snap.l) return
    const sc = (CANVAS_W - PAD * 2) / snap.l
    const newMm = Math.round((xpx - PAD) / sc / 100) * 100
    const clamped = Math.max(1, Math.min(snap.l - 1, newMm))
    const delta = clamped - studPos

    const next = positions.map((p) => {
      // крайние и дверные — не трогаем
      if (p === 0 || p === snap.l) return p
      if (snap.dw > 0 && (p === snap.dp || p === snap.dp + snap.dw)) return p
      // двигаем только ту стойку, которую тащат
      if (p === studPos) return clamped
      return p
    })

    _update([...new Set(next)].sort((a, b) => a - b), snap)
  }

  // ─── Добавить стойку ────────────────────────────────────────────────────────
  function addStud(xpx: number) {
    if (!snap.l) return
    const sc = (CANVAS_W - PAD * 2) / snap.l
    const mm = Math.round((xpx - PAD) / sc / 100) * 100
    if (mm <= 0 || mm >= snap.l) return
    _update([...new Set([...positions, mm])].sort((a, b) => a - b), snap)
  }

  // ─── Удалить стойку ─────────────────────────────────────────────────────────
  function removeStud(studPos: number) {
    const { l, dp, dw } = snap
    // защита от удаления фиксированных стоек
    if (studPos === 0 || studPos === l) return
    if (dw > 0 && (studPos === dp || studPos === dp + dw)) return
    _update(positions.filter(p => p !== studPos), snap)
  }

  return {
    positions,
    snap,
    result,
    heightWarning,
    profileWidth: profileRef.current.width,
    calculate,
    onDragEnd,
    addStud,
    removeStud,
  }
}

export { CANVAS_W, PAD }
