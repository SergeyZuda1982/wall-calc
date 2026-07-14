import * as THREE from 'three'

/**
 * wallProfileGeometry.ts — сечения профилей каркаса ГКЛ-стены (ПС/ПН) для 3D.
 *
 * 14.07.2026: продолжение темы "3D для облицовок/перегородок, аналогично
 * потолкам" — раньше (Scene3D.tsx, WallMesh) стойки и направляющие рисовались
 * простыми прямоугольными boxGeometry (см. FRAME_PROFILE_W_M/FRAME_TRACK_H_M
 * в Scene3D.tsx). Здесь — по образцу ppProfileShape/extrudeProfileM в
 * CeilingGridMesh.tsx: реальное сечение через THREE.Shape+ExtrudeGeometry,
 * даёт узнаваемый С-образный профиль вместо бруска.
 *
 * ПС (стоечный) и ПН (направляющий) — оба открытый С-образный швеллер
 * (в отличие от ПП 60×27 у потолка — тот шляпный/омега с загнутыми "ушками",
 * см. ppProfileShape). Реальные размеры по каталогу КНАУФ: ширина (глубина в
 * толщу стены) — по подтипу профиля (50/75/100мм, см. ProfileType/
 * resolveWallProfileType в planLineToWallInput.ts), лицевая полка (та грань,
 * к которой крепится ГКЛ) — 50мм у ПС, 40мм у ПН (ПН короче, чтобы ПС
 * вставлялся внутрь по всей высоте). Толщина металла — 0.6мм, как у
 * потолочных профилей (ppProfileShape).
 *
 * Ориентация: сечение строится в локальной плоскости так, чтобы после
 * экструзии и одного поворота на 90° длина профиля совпала с нужной мировой
 * осью группы стены (X — вдоль стены, для направляющих; Y — вертикаль, для
 * стоек), а лицевая полка/глубина — с двумя другими. См. csFlangeDepthShape/
 * csDepthFlangeShape ниже и тесты (wallProfileGeometry.test.ts) — там же
 * зафиксирован bounding box результата, чтобы не полагаться на ручной вывод
 * матриц поворота "на глаз" (в отличие от CeilingGridMesh.tsx, тут нет
 * визуального способа перепроверить, поэтому ориентация покрыта тестами).
 */

export const STUD_FLANGE_MM = 50   // ПС — лицевая полка (видимая грань, крепится ГКЛ)
export const TRACK_FLANGE_MM = 40  // ПН — короче ПС, чтобы стойка входила внутрь
export const PROFILE_WALL_T_MM = 0.6

/**
 * С-образное сечение, полка (открытая сторона) — вдоль X, центрирована
 * [-flange/2, flange/2]; глубина (спинка, соединяющая полки) — вдоль Y,
 * центрирована [-depth/2, depth/2]. Открытая сторона канала смотрит на +X.
 */
export function csFlangeDepthShape(flangeMm: number, depthMm: number, t = PROFILE_WALL_T_MM): THREE.Shape {
  const f = flangeMm, d = depthMm
  const s = new THREE.Shape()
  s.moveTo(-f / 2, -d / 2)
  s.lineTo(f / 2, -d / 2)
  s.lineTo(f / 2, -d / 2 + t)
  s.lineTo(-f / 2 + t, -d / 2 + t)
  s.lineTo(-f / 2 + t, d / 2 - t)
  s.lineTo(f / 2, d / 2 - t)
  s.lineTo(f / 2, d / 2)
  s.lineTo(-f / 2, d / 2)
  s.closePath()
  return s
}

/** То же сечение, но с транспонированными осями (глубина — по X, полка — по Y). */
export function csDepthFlangeShape(flangeMm: number, depthMm: number, t = PROFILE_WALL_T_MM): THREE.Shape {
  const f = flangeMm, d = depthMm
  const s = new THREE.Shape()
  s.moveTo(-d / 2, -f / 2)
  s.lineTo(-d / 2, f / 2)
  s.lineTo(-d / 2 + t, f / 2)
  s.lineTo(-d / 2 + t, -f / 2 + t)
  s.lineTo(d / 2 - t, -f / 2 + t)
  s.lineTo(d / 2 - t, f / 2)
  s.lineTo(d / 2, f / 2)
  s.lineTo(d / 2, -f / 2)
  s.closePath()
  return s
}

/**
 * Геометрия С-профиля (мм на входе → метры на выходе), центрирована по всем
 * трём локальным осям (как boxGeometry по умолчанию — старый код в
 * Scene3D.tsx ставил boxGeometry в `position` без доп. смещения, эта
 * геометрия должна встать на то же место без правок вызывающего кода).
 *
 * axis='y' — стойка (ПС): длина идёт по Y (вертикаль), полка — по X, глубина
 *   (толщина стены) — по Z.
 * axis='x' — направляющая (ПН): длина идёт по X (вдоль стены), полка — по Y,
 *   глубина — по Z.
 */
export function wallProfileGeometryM(
  lengthMm: number, depthMm: number, flangeMm: number, axis: 'x' | 'y', t = PROFILE_WALL_T_MM,
): THREE.BufferGeometry {
  const shape = axis === 'y'
    ? csFlangeDepthShape(flangeMm, depthMm, t)
    : csDepthFlangeShape(flangeMm, depthMm, t)
  const geo = new THREE.ExtrudeGeometry(shape, { depth: lengthMm, bevelEnabled: false, curveSegments: 1 })
  geo.translate(0, 0, -lengthMm / 2) // экструзия всегда растёт от Z=0 — центрируем
  if (axis === 'y') geo.rotateX(Math.PI / 2)
  else geo.rotateY(Math.PI / 2)
  geo.scale(0.001, 0.001, 0.001) // мм -> м
  return geo
}
