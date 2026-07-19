/**
 * CeilingGridMesh.tsx — 3D-визуализация каркаса подвесного потолка П112/П113
 * (несущий/основной профиль, крабы, подвесы, минвата, фрагмент ГКЛ) для
 * Scene3D.tsx.
 *
 * Раскладка рядов — из core/ceilingGridGeometry.ts (чистые мм, переиспользует
 * calcFrameRowPositions из calcP112Frame.ts — то же правило расстановки,
 * что и в реальной смете). Здесь — только сборка three.js-мешей поверх этой
 * раскладки: сечения профилей строятся как THREE.Shape + ExtrudeGeometry
 * (реальный контур сечения даёт узнаваемость, не bevel/текстура), крабы —
 * крестовая пластина с отогнутыми лапками по краям лучей (см. crabGeometry,
 * правка 18.07.2026 по фото реальной детали), подвесы — стержень+пластина+
 * зажим, минвата — box с
 * шумом по вершинам верхней грани + процедурная fibrous-текстура на canvas,
 * ГКЛ — прямоугольник с фаской УК по кромке.
 *
 * 13.07.2026: поддержка П113 (ceilingType='p113', см. CeilingGridMeshProps) —
 * та же сборка мешей, но раскладка берётся из calcCeilingGridP113
 * (двухуровневая П112 vs одноуровневая П113 — разница только в том, как
 * заполнен bearingSegments, интерфейс результата один и тот же), и mainY/
 * bearingY схлопываются в один уровень (см. комментарий у их вычисления
 * ниже). Крабы для П113 (один уровень) рисуются crabGeometry() — плоская
 * крестовина с лапками, реальный одноуровневый соединитель. Для П112 (два
 * уровня) — отдельная twoLevelConnectorGeometry() (19.07.2026, по фото
 * реальной детали: гнутая скоба, не крестовина) — до этой правки П112 тоже
 * ошибочно рисовался crabGeometry() посередине между уровнями, см. историю
 * коммитов при необходимости. Подвес прямой (Hanger, П112) — с 19.07.2026
 * тоже по фото реальной детали: крюк-петля (hangerHookGeometry) + стержень
 * + зажим-струбцина с зубчатыми лапками (hangerClampGeometry) и отдельным
 * рычагом-эксцентриком (hangerLeverGeometry, свой тёмный материал
 * hangerLeverMat) — раньше зажим рисовался гнутой трубкой без струбцины и
 * рычага, см. историю коммитов.
 *
 * v1: без picking/интерактива (см. общий план "интерактивный 3D" в
 * KONSPEKT.md) — чисто визуальный слой поверх плоской плиты потолка,
 * которая уже рисуется в SlabOrColumn (Scene3D.tsx). Не заменяет её —
 * добавляется поверх/под ней.
 * v1 упрощение: подвесы/крабы рисуются обычными <mesh> (не инстансинг) —
 * при типичных размерах помещения это десятки объектов, не тысячи. Если на
 * больших планах (много помещений разом) станет тяжело — перевести на
 * drei <Instances>, раскладка (core/ceilingGridGeometry.ts) для этого уже
 * готова (все точки строго по сетке).
 *
 * 10.07.2026 — минимальная видимая толщина тонких элементов (несущий/
 * основной профиль ПП, стержень подвеса): при взгляде на помещение целиком
 * издалека эти элементы визуально сжимаются до долей пикселя и "теряются"
 * (см. KONSPEKT-снапшот сессии 09.07.2026, идея №1 из списка "3D-вид на
 * объекте"). См. ThinProfileMesh/HangerRod/useMinThicknessScale ниже —
 * каждый кадр домножают ТОЛЬКО поперечное сечение элемента (не длину) на
 * коэффициент из core/minScreenThickness.ts.
 * ⚠️ 13.07.2026: по умолчанию этот приём выключен (`maxScale=1` в
 * core/minScreenThickness.ts) — пользователь попросил честный масштаб:
 * профиль/подвес всегда в реальном физическом размере, тонкой чертой
 * издалека, корректно только при реальном приближении камеры, без
 * исключений и раздувания (было сначала 8x, потом 2x). Крабы и
 * пластина/зажим подвеса и так не были охвачены отдельно.
 */

import { useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { calcCeilingGrid, calcCeilingGridP113, clipCeilingGridToPolygon, splitSegmentByBarLength, DEFAULT_GRID_STEP_B, DEFAULT_GRID_STEP_C, DEFAULT_BEARING_ALONG_LENGTH, type CeilingGridSegment } from '../core/ceilingGridGeometry'
import { STANDARD_BAR_LENGTH_MM, type FrameLayoutMode } from '../core/calcP112Frame'
import { calcMinThicknessScale } from '../core/minScreenThickness'
import { mmToM } from '../core/planTo3D'

/**
 * Высота (Y), на которой физически висит зашивка ГКЛ — низ несущего
 * профиля минус половина его высоты минус половина толщины листа. Было
 * инлайн-константой внутри CeilingGridMesh (см. ниже), вынесено сюда,
 * чтобы CeilingCalc3DPreview.tsx мог разместить свой раскрой листов на
 * ТОЙ ЖЕ высоте, не дублируя "магические числа" (13.07.2026).
 */
export function calcGklLevelM(ceilingM: number, ceilingType: 'p112' | 'p113'): number {
  const dropToMainM = 0.12
  const mainY = ceilingM - dropToMainM
  const bearingY = ceilingType === 'p113' ? mainY : mainY - mmToM(27) - 0.003
  return bearingY - mmToM(27 / 2 + 12.5 / 2)
}


// ─── Минимальная видимая толщина тонких элементов (см. KONSPEKT, идея №1 из
// списка "3D-вид на объекте", 09.07.2026) ───────────────────────────────────
// Профиль ПП (60×27мм) и стержень подвеса (Ø4мм) при взгляде на помещение
// целиком издалека могут визуально сжаться до долей пикселя и "потеряться".
// calcMinThicknessScale (чистая математика, core/minScreenThickness.ts)
// считает, во сколько раз нужно раздуть поперечное сечение элемента на
// текущем расстоянии от камеры, чтобы оно не опускалось ниже MIN_PX
// пикселей на экране. Раздувается только поперечное сечение (see axes в
// useMinThicknessScale ниже) — длина элемента не меняется, чтобы соседние
// профили не наезжали друг на друга.
const MIN_THICKNESS_PX = 2.5

/**
 * Держит минимальный видимый размер объекта на экране: каждый кадр меряет
 * расстояние от камеры до мирового положения объекта и выставляет
 * mesh.scale по осям, заданным в `axes` (1 — масштабировать эту локальную
 * ось, 0 — не трогать, обычно так сохраняется ось вдоль длины элемента).
 *
 * `actualLocalSizeM` — реальный размер тонкого измерения в ЛОКАЛЬНЫХ
 * координатах геометрии (до масштаба самого mesh и до любых родительских
 * масштабов сцены, например кнопок визуального масштаба 1x/5x/10x —
 * см. Scene3D.tsx). Родительский масштаб учитывается отдельно через
 * getWorldScale, чтобы функция корректно работала на любом уровне
 * визуального масштаба.
 */
function useMinThicknessScale(
  ref: RefObject<THREE.Object3D>,
  actualLocalSizeM: number,
  axes: [number, number, number],
) {
  const { camera, size } = useThree()
  const worldPos = useRef(new THREE.Vector3())
  const parentScale = useRef(new THREE.Vector3(1, 1, 1))

  useFrame(() => {
    const obj = ref.current
    if (!obj || actualLocalSizeM <= 0) return
    const parent = obj.parent
    if (!parent) return

    parent.getWorldScale(parentScale.current)
    obj.getWorldPosition(worldPos.current)
    const distanceM = camera.position.distanceTo(worldPos.current)
    const fovYRad = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 50)
    const actualWorldSizeM = actualLocalSizeM * parentScale.current.x

    const k = calcMinThicknessScale({
      distanceM,
      fovYRad,
      viewportPxHeight: size.height,
      minPx: MIN_THICKNESS_PX,
      actualWorldSizeM,
    })

    obj.scale.set(axes[0] ? k : 1, axes[1] ? k : 1, axes[2] ? k : 1)
  })
}

// ─── Сечения профилей (мм) ──────────────────────────────────────────────────
// ПН 28×27 — направляющий, П-образный швеллер (используется по периметру,
// здесь — как несущий периметральный ряд не рисуем отдельно, только ПП-сетка).
// ПП 60×27 — несущий/основной, шляпный (омега) профиль с загнутыми "ушками".
// Размеры совпадают с расходными таблицами (см. data/ceilingData.ts:
// pp6027_lm) — не выдуманы отдельно для 3D.

export function ppProfileShape(width = 60, height = 27, t = 0.6, lip = 5): THREE.Shape {
  // 14.07.2026: сечение перевёрнуто относительно версии до этой правки —
  // раньше широкая полка (куда крепится ГКЛ) оказывалась у y=h (физически
  // выше подвеса/краба, "полкой вверх"), а открытый верх канала (концы двух
  // "ножек", которыми профиль заходит в паз краба/зажим подвеса) — у y=0
  // (физически ниже, "рёбрами вниз"). По факту наоборот: полка должна быть
  // внизу (лицом в комнату, к ней крепится ГКЛ), открытый верх — вверху
  // (к плите, там подвес/краб). См. фото от пользователя, 14.07.2026 —
  // сверено визуально с реальным профилем ПП60×27. Малые "лапки" (параметр
  // lip) физически расположены на ТОЙ ЖЕ кромке, что и широкая полка (это
  // отбортовка/усиление кромки полки, не отдельная деталь у открытого
  // верха) — поэтому они переехали вместе с полкой, тоже к y=0.
  //
  // Точки — зеркальное отражение (y' = height - y) прежней версии, но ещё и
  // в ОБРАТНОМ порядке обхода: одно только отражение развернуло бы контур в
  // другую сторону (CW↔CCW) и перевернуло бы нормали экструзии (профиль стал
  // бы тёмным/невидимым с обычного ракурса) — двойная правка (отражение +
  // разворот порядка) возвращает то же направление обхода, что было раньше,
  // сохраняя корректную ориентацию нормалей. Зафиксировано тестом
  // (CeilingGridMesh.profileShape.test.ts, "сохраняет то же направление
  // обхода") — без него эту деталь легко испортить незаметно.
  const s = new THREE.Shape()
  const w = width, h = height
  s.moveTo(w + lip, 0)
  s.lineTo(w, 0)
  s.lineTo(w, h - t)
  s.lineTo(w - t, h - t)
  s.lineTo(w - t, t)
  s.lineTo(t, t)
  s.lineTo(t, h - t)
  s.lineTo(0, h - t)
  s.lineTo(0, 0)
  s.lineTo(-lip, 0)
  s.closePath()
  return s
}

/** Экструзия сечения (мм, в плоскости XY) вдоль длины (мм) → geometry в метрах. */
export function extrudeProfileM(shape: THREE.Shape, lengthMm: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: lengthMm, bevelEnabled: false, curveSegments: 1 })
  geo.scale(0.001, 0.001, 0.001) // мм -> м
  return geo
}

/**
 * Обёртка над <mesh> для несущего/основного профиля — держит минимальную
 * видимую толщину сечения (см. useMinThicknessScale выше), не трогая длину
 * профиля (extrude идёт вдоль локального Z, поэтому масштабируются только
 * X/Y — сечение). `actualLocalHeightM` — реальная высота сечения профиля в
 * метрах (27мм для ПП, см. ppProfileShape) — консервативная оценка "самого
 * тонкого" измерения, которое рискует пропасть первым.
 */
export function ThinProfileMesh({
  geometry, material, position, rotation, actualLocalHeightM, onClick,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  position: [number, number, number]
  rotation: [number, number, number]
  actualLocalHeightM: number
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const ref = useRef<THREE.Mesh>(null!)
  useMinThicknessScale(ref, actualLocalHeightM, [1, 1, 0])
  return (
    <mesh ref={ref} geometry={geometry} material={material} position={position} rotation={rotation} castShadow onClick={onClick} />
  )
}

export const metalMat = new THREE.MeshStandardMaterial({ color: '#b7bcc2', metalness: 0.75, roughness: 0.42 })
export const crabMat = new THREE.MeshStandardMaterial({ color: '#9aa4ad', metalness: 0.6, roughness: 0.5 })
const gklMat = new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.92, metalness: 0 })
// 19.07.2026: рычаг-защёлка анкерного подвеса на фото — тёмный (воронёный/
// окрашенный) эксцентрик, заметно темнее оцинкованных пластин/крабов —
// отдельный материал для узнаваемости в 3D, см. hangerLeverGeometry ниже.
export const hangerLeverMat = new THREE.MeshStandardMaterial({ color: '#2e2e30', metalness: 0.35, roughness: 0.55 })

// ─── Минвата: box с шумом по вершинам верха + процедурная текстура ─────────

function noisyWoolGeometry(wM: number, dM: number, hM: number, segX = 8, segZ = 8): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(wM, hM, dM, segX, 2, segZ)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    if (y > hM * 0.3) {
      const nx = pos.getX(i), nz = pos.getZ(i)
      const n = (Math.sin(nx * 18) * Math.cos(nz * 21) * 0.003) + (Math.random() - 0.5) * 0.0025
      pos.setY(i, y + n)
    }
  }
  geo.computeVertexNormals()
  return geo
}

let cachedWoolTexture: THREE.CanvasTexture | null = null
function fibrousTexture(): THREE.CanvasTexture {
  if (cachedWoolTexture) return cachedWoolTexture
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#c9a68a'
  ctx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256
    const len = 4 + Math.random() * 10
    const ang = Math.random() * Math.PI
    ctx.strokeStyle = `rgba(${180 + Math.random() * 40 | 0},${140 + Math.random() * 40 | 0},${100 + Math.random() * 30 | 0},${0.15 + Math.random() * 0.2})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    ctx.stroke()
  }
  cachedWoolTexture = new THREE.CanvasTexture(c)
  cachedWoolTexture.wrapS = cachedWoolTexture.wrapT = THREE.RepeatWrapping
  cachedWoolTexture.repeat.set(2, 2)
  return cachedWoolTexture
}

// ─── Краб (соединитель одноуровневый) — крестовая пластина с лапками ───────
// 18.07.2026: по фото от пользователя (реальный краб) — плоская крестовина
// была неполной: на реальной детали по краю каждого из 4 лучей есть
// ОТОГНУТАЯ ВНИЗ лапка (защёлкивается на полку профиля с двух сторон), а не
// просто плоский контур, как рисовалось раньше. Добавлены 4 лапки — тонкие
// прямоугольные "флажки", отогнутые на 90° от плоскости пластины вниз (в ту
// же сторону, что и толщина экструзии), по одной на конец каждого луча,
// шириной вдоль луча = ширине самого луча (не отдельная деталь).
// Пока без прорези/паза на лапке — как и у остальной геометрии крепежа в
// этом файле (см. HangerStripP113 выше), для распознаваемости в масштабе
// сцены достаточно силуэта, паз не читается на таком размере.

function crabLegBoxMm(axis: 'x' | 'y', sign: 1 | -1, armHalfWidthMm: number, tipMm: number, legDropMm: number, plateThickMm: number): THREE.BufferGeometry {
  const legThicknessMm = 1.4 // толщина металла лапки, как у пластины
  const w = axis === 'y' ? 2 * armHalfWidthMm : legThicknessMm
  const h = axis === 'x' ? 2 * armHalfWidthMm : legThicknessMm
  const geo = new THREE.BoxGeometry(w, h, legDropMm)
  const posX = axis === 'x' ? sign * tipMm : 0
  const posY = axis === 'y' ? sign * tipMm : 0
  geo.translate(posX, posY, plateThickMm + legDropMm / 2)
  return geo
}

export function crabGeometry(sizeMm = 22, thickMm = 1.4, legDropMm = 8): THREE.BufferGeometry {
  const s = new THREE.Shape()
  const a = sizeMm, b = sizeMm * 0.28
  s.moveTo(-b, -a); s.lineTo(b, -a); s.lineTo(b, -b); s.lineTo(a, -b)
  s.lineTo(a, b); s.lineTo(b, b); s.lineTo(b, a); s.lineTo(-b, a)
  s.lineTo(-b, b); s.lineTo(-a, b); s.lineTo(-a, -b); s.lineTo(-b, -b)
  s.closePath()
  const toNonIndexedIfNeeded = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g)
  const plate = toNonIndexedIfNeeded(new THREE.ExtrudeGeometry(s, { depth: thickMm, bevelEnabled: false, curveSegments: 1 }))

  // 4 лапки, по одной на конец каждого луча.
  const legs = [
    crabLegBoxMm('y', -1, b, a, legDropMm, thickMm), // нижний луч
    crabLegBoxMm('y', 1, b, a, legDropMm, thickMm),  // верхний луч
    crabLegBoxMm('x', -1, b, a, legDropMm, thickMm), // левый луч
    crabLegBoxMm('x', 1, b, a, legDropMm, thickMm),  // правый луч
  ].map(toNonIndexedIfNeeded)

  // mergeGeometries требует единый набор атрибутов И одинаковое наличие
  // индекса у всех геометрий разом — ExtrudeGeometry и BoxGeometry по
  // умолчанию расходятся, поэтому обе стороны приведены к non-indexed выше.
  const geo = mergeGeometries([plate, ...legs], false) ?? plate
  geo.rotateX(Math.PI / 2)
  geo.scale(0.001, 0.001, 0.001)
  return geo
}

// ─── Двухуровневый соединитель (П112, main↔bearing на разных уровнях) ──────
// 19.07.2026: по фото от пользователя — деталь СОВСЕМ другой формы, чем
// одноуровневый краб (crabGeometry выше): не плоская крестовина, а гнутая
// скоба. Верхняя пластина цепляется за основной (верхний) профиль, от неё
// вниз идут два крюка-"лапы" по бокам, которые на уровне несущего (нижнего)
// профиля загибаются внутрь и обхватывают его снизу. Раньше на этом месте
// стояла crabGeometry() (см. комментарий в шапке файла) — визуально
// неверно, это был следующий пункт в списке по фото (конспект 18.07.2026,
// часть 2, пункт 2).
//
// gapMm — вертикальный зазор между основным и несущим профилем; передаётся
// из места вызова как (mainY - bearingY) в мм, а не жёстко зашит здесь, —
// чтобы деталь оставалась верной при любых будущих изменениях раскладки
// уровней (mainY/bearingY считаются в CeilingGridMesh, см. ниже).

export function twoLevelConnectorGeometry(
  gapMm = 30,
  spanMm = 16,     // расстояние между двумя лапами (тот же порядок, что и полу-размер краба)
  plateMm = 20,    // сторона верхней пластины
  thickMm = 1.4,   // толщина металла, как у краба
  hookMm = 6,      // длина загиба лапы под несущим профилем
): THREE.BufferGeometry {
  const toNonIndexedIfNeeded = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g)
  const depthMm = plateMm * 0.5
  const halfSpan = spanMm / 2

  // верхняя пластина — цепляется за основной (верхний) профиль
  const topPlate = new THREE.BoxGeometry(plateMm, thickMm, plateMm)
  topPlate.translate(0, -thickMm / 2, 0)

  const legsAndHooks: THREE.BufferGeometry[] = [topPlate]
  for (const sign of [-1, 1] as const) {
    // вертикальная "лапа" — от пластины вниз через весь зазор до уровня
    // несущего профиля
    const leg = new THREE.BoxGeometry(thickMm, gapMm, depthMm)
    leg.translate(sign * halfSpan, -gapMm / 2 - thickMm / 2, 0)
    legsAndHooks.push(leg)

    // загиб-крюк на конце лапы, обхватывающий несущий профиль снизу —
    // отгибается ВНУТРЬ (к центру детали), а не наружу, как лапки
    // одноуровневого краба выше
    const hook = new THREE.BoxGeometry(hookMm, thickMm, depthMm)
    hook.translate(sign * (halfSpan - hookMm / 2), -(gapMm + thickMm / 2), 0)
    legsAndHooks.push(hook)
  }

  // тот же приём, что и в crabGeometry: BoxGeometry не индексирована по
  // умолчанию, но приводим явно на случай будущих правок этой функции
  const geo = mergeGeometries(legsAndHooks.map(toNonIndexedIfNeeded), false) ?? topPlate
  geo.scale(0.001, 0.001, 0.001)
  return geo
}

/** Стержень подвеса — тонкий (Ø4мм), держит минимальную видимую толщину сечения. */
function HangerRod({ dropM }: { dropM: number }) {
  const ref = useRef<THREE.Mesh>(null!)
  useMinThicknessScale(ref, 0.004, [1, 0, 1]) // диаметр 4мм, ось Y (длина стержня) не трогаем
  return (
    <mesh ref={ref} material={crabMat} position={[0, -dropM / 2, 0]} castShadow>
      <cylinderGeometry args={[0.002, 0.002, dropM, 6]} />
    </mesh>
  )
}

// ─── Анкерный подвес (прямой, П112) — крюк-петля + стержень + зажим-струбцина
// с рычагом-защёлкой ──────────────────────────────────────────────────────
// 19.07.2026: по фото от пользователя — деталь целиком гнётся из одного
// прутка на одном конце (крюк-петля наверху, входит в анкер/шпильку в
// плите), а зажим внизу — НЕ гнутая трубка (было раньше, см. историю
// коммитов), а отдельный узел из трёх элементов: плоская пластина сверху
// профиля ПП, две зубчатые боковые лапки-струбцины по бокам профиля и
// отдельный поворотный рычаг-эксцентрик (кулачок), который при повороте
// заклинивает зажим на профиле. На фото рычаг темнее оцинкованного металла
// (см. hangerLeverMat выше) и закреплён на отдельной оси — здесь
// зафиксирован в положении "защёлкнуто" (не анимируется).

let cachedHangerHookGeo: THREE.BufferGeometry | null = null
/** Крюк-петля наверху стержня — гнутый пруток с плоским скруглённым носиком, цепляется за анкер в плите. */
export function hangerHookGeometry(): THREE.BufferGeometry {
  if (cachedHangerHookGeo) return cachedHangerHookGeo
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.006, 0),
    new THREE.Vector3(0.007, 0.011, 0),
    new THREE.Vector3(0.013, 0.008, 0),
    new THREE.Vector3(0.012, 0.001, 0),
    new THREE.Vector3(0.008, -0.001, 0),
  ])
  cachedHangerHookGeo = new THREE.TubeGeometry(curve, 16, 0.002, 6, false)
  return cachedHangerHookGeo
}

/**
 * Зажим — пластина сверху профиля + 2 зубчатые боковые лапки-струбцины (без
 * рычага, тот отдельным мешем). Не кэшируется (в отличие от
 * hangerHookGeometry без параметров) — принимает аргументы, кэш по одному
 * значению вернул бы устаревшую геометрию при других параметрах.
 */
export function hangerClampGeometry(profileWidthMm = 60, profileHeightMm = 27, thickMm = 1.4, toothCount = 3): THREE.BufferGeometry {
  const toNonIndexedIfNeeded = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g)
  const depthMm = 20
  const halfWidth = profileWidthMm / 2
  const toothMm = 3.5
  const toothThickMm = 1.4

  // пластина сверху — ложится на верхнюю полку профиля
  const topPlate = new THREE.BoxGeometry(profileWidthMm + 2 * thickMm, thickMm, depthMm)
  topPlate.translate(0, -thickMm / 2, 0)

  const parts: THREE.BufferGeometry[] = [topPlate]
  for (const sign of [-1, 1] as const) {
    // основная боковая лапка — вдоль наружной грани профиля
    const leg = new THREE.BoxGeometry(thickMm, profileHeightMm, depthMm)
    leg.translate(sign * (halfWidth + thickMm / 2), -profileHeightMm / 2 - thickMm, 0)
    parts.push(leg)

    // зубцы — короткие выступы внутрь по высоте лапки (зубчатый край на
    // фото — реальная деталь охватывает профиль зубчатым краем, не гладким)
    for (let i = 0; i < toothCount; i++) {
      const ty = -thickMm - ((i + 0.5) / toothCount) * profileHeightMm
      const tooth = new THREE.BoxGeometry(toothMm, toothThickMm, depthMm * 0.6)
      tooth.translate(sign * (halfWidth - toothMm / 2), ty, 0)
      parts.push(tooth)
    }
  }

  const geo = mergeGeometries(parts.map(toNonIndexedIfNeeded), false) ?? topPlate
  geo.scale(0.001, 0.001, 0.001)
  return geo
}

/** Рычаг-эксцентрик зажима — плоская лопатка с осью поворота на одном конце (см. hangerLeverMat). Не кэшируется — см. hangerClampGeometry. */
export function hangerLeverGeometry(profileWidthMm = 60): THREE.BufferGeometry {
  const lengthMm = profileWidthMm * 0.55
  const geo = new THREE.BoxGeometry(lengthMm, 2, 7)
  geo.translate(-lengthMm / 2, 0, 0) // пивот на одном конце — ось поворота рычага
  geo.scale(0.001, 0.001, 0.001)
  return geo
}

/** Подвес прямой (анкерный, П112): крюк-петля у плиты + стержень + зажим-струбцина с рычагом-защёлкой на профиле. */
export function Hanger({ x, y, z, dropM, onClick }: {
  x: number; y: number; z: number; dropM: number
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  return (
    <group position={[x, y, z]} onClick={onClick}>
      <mesh geometry={hangerHookGeometry()} material={crabMat} castShadow />
      <HangerRod dropM={dropM} />
      <group position={[0, -dropM, 0]}>
        <mesh geometry={hangerClampGeometry()} material={crabMat} castShadow />
        {/* рычаг-защёлка — зафиксирован в положении "защёлкнуто" (повёрнут к
            профилю), пивот у стержня, лопатка уходит наружу вбок */}
        <mesh
          geometry={hangerLeverGeometry()}
          material={hangerLeverMat}
          position={[0.004, -0.006, 0]}
          rotation={[0, 0, -0.6]}
          castShadow
        />
      </group>
    </group>
  )
}

// ─── Удлинитель профиля ПП60×27 (КНАУФ-удлинитель профилей) ────────────────
// 19.07.2026: пункт 4 списка сверки крепежа потолка. Первая версия плана
// (снаружи, крупнее сечения) была неверна — пользователь прислал офиц. фото
// с сайта knauf.ru и уточнил: деталь вставляется ВНУТРЬ канала двух
// соединяемых профилей (в месте, где обычного бара 3000мм не хватает на всю
// длину сегмента), а не надевается снаружи. Сечение — тот же "шляпный"
// профиль (ppProfileShape), что и у самого ПП60×27, просто чуть меньше по
// габаритам, чтобы заходить внутрь канала. Длина ~150мм — справочник
// материалов (data/ceilingData.ts, extender_pp) хранит только цену за
// штуку, не длину детали, это ориентировочное значение по типовым деталям
// на рынке, не измерено по фото (масштаб на фото КНАУФ не был указан).
export const EXTENDER_LENGTH_MM = 150

export function profileExtenderGeometry(lengthMm = EXTENDER_LENGTH_MM): THREE.BufferGeometry {
  const shape = ppProfileShape(58, 25, 0.6, 4)
  return extrudeProfileM(shape, lengthMm)
}

// 14.07.2026: по фото от пользователя — для П113 подвес рисуется не как
// стержень+пластина+зажим (Hanger выше, используется для П112), а как
// настоящий "прямой подвес" с перфорированной лентой.
// 15.07.2026, ИСПРАВЛЕНИЕ по новым фото: первая версия (петля-крюк наверху +
// одна лента по центру до профиля) была неверна — пользователь прислал фото
// реальной детали целиком. Это заводская П-образная скоба, ОДНА деталь, а
// НЕ лента, сложенная монтажником: плоская пластина наверху (2 круглых
// отверстия под дюбель-гвозди по краям + 1 овальная прорезь посередине,
// крепится к плите) переходит в ДВЕ перфорированные "ножки", которые
// обхватывают профиль ПП60×27 СНАРУЖИ с двух сторон (не одна лента по
// центру профиля) — на фото видно ещё и саморез через профиль в ножку,
// геометрически не показываем (не читается в масштабе сцены). Круглые
// отверстия под дюбели/овальную прорезь на пластине тоже не моделируем
// отдельной геометрией/текстурой — плата маленькая, разница на 3D-масштабе
// сцены не читается, а перфорация ножек (главный визуальный маркер детали)
// сохранена через ту же canvas-текстуру, что и раньше.
//
// Перфорация — не отдельная геометрия (дорого по полигонам на каждый
// подвес), а canvas-текстура с РЕАЛЬНОЙ прозрачностью в дырках (alphaTest,
// не имитация цветом) — тот же приём, что и fibrousTexture() для минваты
// выше, только с прозрачностью вместо цветового шума.

let cachedHangerStripTexture: THREE.CanvasTexture | null = null
function hangerStripTexture(): THREE.CanvasTexture {
  if (cachedHangerStripTexture) return cachedHangerStripTexture
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 512
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#c9ced3'
  ctx.fillRect(0, 0, c.width, c.height)
  // лёгкий шум металла (прокатной поверхности)
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(150,155,160,${0.05 + Math.random() * 0.12})`
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 1)
  }
  // ряды круглых отверстий в шахматном порядке — вырезаны по-настоящему
  // (destination-out => alpha=0), не просто закрашены другим цветом.
  ctx.globalCompositeOperation = 'destination-out'
  const rows = 24, r = 5.5
  const rowStepPx = c.height / rows
  for (let row = 0; row < rows; row++) {
    const y = rowStepPx * (row + 0.5)
    const xOff = (row % 2) * (c.width / 4)
    for (const xBase of [c.width * 0.28, c.width * 0.72]) {
      ctx.beginPath()
      ctx.arc(xBase + xOff - c.width / 8, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  cachedHangerStripTexture = new THREE.CanvasTexture(c)
  cachedHangerStripTexture.wrapS = THREE.ClampToEdgeWrapping
  cachedHangerStripTexture.wrapT = THREE.RepeatWrapping
  return cachedHangerStripTexture
}

const HANGER_STRIP_WIDTH_M = 0.03 // ширина одной "ножки" скобы (~30мм по каталогу)
// Половина ширины профиля ПП60×27 (см. ppProfileShape(width=60) — дефолт
// там же), ножки охватывают профиль СНАРУЖИ по этой границе.
const HANGER_PROFILE_HALF_WIDTH_M = 0.03
// Расстояние от центра профиля до центра каждой ножки: внутренний край
// ножки — точно на грани профиля, ножка добавляет свою полуширину наружу.
const HANGER_LEG_OFFSET_M = HANGER_PROFILE_HALF_WIDTH_M + HANGER_STRIP_WIDTH_M / 2
const HANGER_PLATE_WIDTH_M = 2 * HANGER_LEG_OFFSET_M // пластина соединяет обе ножки поверху

/** Подвес прямой перфорированный (П113) — П-образная скоба: пластина у
 *  плиты + две перфорированные ножки, обхватывающие основной профиль с
 *  двух сторон (см. фото от пользователя, 15.07.2026).
 *  rotationY ДОЛЖЕН совпадать с углом поворота основного профиля в этой
 *  точке (тот же `alongX`/`angle`, что передаётся в ThinProfileMesh для
 *  main-сегмента) — иначе ножки лягут вдоль профиля, а не поперёк него. */
export function HangerStripP113({ x, y, z, dropM, rotationY = 0, onClick }: {
  x: number; y: number; z: number; dropM: number; rotationY?: number
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const tex = useMemo(() => hangerStripTexture(), [])
  const stripMat = useMemo(() => new THREE.MeshStandardMaterial({
    map: tex, color: '#c9ced3', metalness: 0.55, roughness: 0.55,
    transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
  }), [tex])
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#c9ced3', metalness: 0.55, roughness: 0.5, side: THREE.DoubleSide,
  }), [])

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]} onClick={onClick}>
      {/* верхняя пластина — крепится к плите дюбель-гвоздями (2 отверстия
          по краям + овальная прорезь посередине на реальной детали, не
          моделируем — см. комментарий выше про масштаб сцены) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={plateMat} castShadow>
        <planeGeometry args={[HANGER_PLATE_WIDTH_M, HANGER_STRIP_WIDTH_M]} />
      </mesh>
      {/* две перфорированные ножки — обхватывают профиль с двух сторон
          СНАРУЖИ, а не одна лента по центру, как в первой версии */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * HANGER_LEG_OFFSET_M, -dropM / 2, 0]}
          rotation={[0, Math.PI / 2, 0]}
          material={stripMat}
          castShadow
        >
          <planeGeometry args={[HANGER_STRIP_WIDTH_M, dropM]} />
        </mesh>
      ))}
    </group>
  )
}

export interface CeilingGridMeshProps {
  /** контур помещения, метры, план сверху (x,z) — как RoomPolygon3D.points */
  roomPoints: { x: number; z: number }[]
  /** высота нижней плоскости плиты перекрытия (низ потолка комнаты), метры */
  ceilingM: number
  stepB?: number
  stepC?: number
  /** макс. допустимый шаг подвесов (см. ceilingGridGeometry.ts) — не задан
   *  -> = stepB, та же практика, что и в calcP112Frame/CeilingCalc.tsx. */
  stepA?: number
  bearingAlongLength?: boolean
  /** 13.07.2026: тип потолка — определяет топологию сетки и высоту профилей.
   *  'p112' (по умолчанию) — двухуровневая система (calcCeilingGrid,
   *  mainY/bearingY разнесены по высоте, двухуровневый краб между ними).
   *  'p113' — одноуровневая (calcCeilingGridP113, несущий режется короткими
   *  вставками, оба профиля физически на одном уровне — см. calcP113Frame.ts).
   *  bearingAlongLength для 'p113' переиспользуется как mainAlongLength
   *  (ориентация СПЛОШНОГО профиля) — то же поле спецификации, что и у П112,
   *  см. calcCeiling.ts, ветка hasPreciseGeometryP113. */
  ceilingType?: 'p112' | 'p113'
  showWool?: boolean
  showGkl?: boolean
  /**
   * "Фокус на элемент" (10.07.2026) — идея №4 из списка "3D-вид на объекте"
   * (см. KONSPEKT.md). Клик по узлу каркаса (профиль/краб/подвес) → камера
   * подлетает к нему. Переиспользует тот же механизм CameraRig/FocusTarget,
   * что и клик по табличке помещения (RoomLabelTag, см. Scene3D.tsx).
   *
   * measuring — тот же паттерн, что и у WallMesh (см. Scene3D.tsx): пока
   * активен инструмент измерения, клик НЕ перехватывается фокусом — должен
   * всплыть на группу и стать точкой измерения (можно измерять расстояние
   * между узлами каркаса, это разумный сценарий).
   */
  onFocusElement?: (localTarget: THREE.Vector3, localDistance: number) => void
  measuring?: boolean
  /** 16.07.2026: режим раскладки (см. calcP112FrameGeometry/calcFrameRowPositions)
   *  — ОБЯЗАТЕЛЬНО передавать из реальной спецификации (ceilingSpec.layoutMode),
   *  иначе для layoutMode='knauf' число рядов в 3D разойдётся со сметой и
   *  2D-схемой (calcCeilingGrid раньше молча считал как mode='user', репорт
   *  пользователя со скриншотами 2D/3D одной и той же комнаты). Не задан ->
   *  'user' (прежнее поведение). */
  layoutMode?: FrameLayoutMode
  /** Отступ основного/несущего профиля от стены, мм — как у
   *  calcP112FrameGeometry (extra.wallOffsetMainMm/wallOffsetBearingMm). */
  wallOffsetMainMm?: number
  wallOffsetBearingMm?: number
}

/** Фиксированная дистанция фокуса для мелких узлов каркаса (метры, локальные
 *  координаты — до domножения на visualScale в Scene3D). Единая для всех
 *  типов элементов (профиль/краб/подвес) — они все примерно одного порядка
 *  величины (десятки см), не требуют разных дистанций для узнаваемости. */
const ELEMENT_FOCUS_DISTANCE_M = 1.0

/**
 * Собирает 3D-каркас подвесного потолка для ОДНОГО помещения. Раскладка
 * рядов по-прежнему считается по bounding box контура (см.
 * ceilingGridGeometry.ts) — но результат подрезается по фактическому
 * многоугольнику roomPoints (clipCeilingGridToPolygon, 13.07.2026), так что
 * визуально профиль не выходит за пределы реальной комнаты, даже если она
 * непрямоугольная или повёрнута относительно мировых осей.
 */
export default function CeilingGridMesh({
  roomPoints, ceilingM, stepB = DEFAULT_GRID_STEP_B, stepC = DEFAULT_GRID_STEP_C, stepA,
  bearingAlongLength = DEFAULT_BEARING_ALONG_LENGTH, ceilingType = 'p112', showWool = true, showGkl = true,
  onFocusElement, measuring = false, layoutMode = 'user', wallOffsetMainMm, wallOffsetBearingMm,
}: CeilingGridMeshProps) {
  // См. WallMesh (Scene3D.tsx) — тот же паттерн: пока активно измерение,
  // клик не перехватывается фокусом, просто ничего не делаем и даём событию
  // всплыть на группу (её onClick — handleMeasureClick в Scene3D).
  function focusableClick(localTarget: THREE.Vector3) {
    return (e: ThreeEvent<MouseEvent>) => {
      if (measuring || !onFocusElement) return
      e.stopPropagation()
      onFocusElement(localTarget, ELEMENT_FOCUS_DISTANCE_M)
    }
  }
  const bbox = useMemo(() => {
    if (roomPoints.length < 3) return null
    const xs = roomPoints.map(p => p.x)
    const zs = roomPoints.map(p => p.z)
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
  }, [roomPoints])

  const grid = useMemo(() => {
    if (!bbox) return null
    const lengthMm = (bbox.maxX - bbox.minX) * 1000
    const widthMm = (bbox.maxZ - bbox.minZ) * 1000
    const rawGrid = ceilingType === 'p113'
      ? calcCeilingGridP113({
          lengthMm, widthMm, stepB, stepC, mainAlongLength: bearingAlongLength, stepA,
          layoutMode, wallOffsetMainMm, wallOffsetBearingMm,
        })
      : calcCeilingGrid({
          lengthMm, widthMm, stepB, stepC, bearingAlongLength, stepA,
          layoutMode, wallOffsetMainMm, wallOffsetBearingMm,
        })
    // 13.07.2026: rawGrid построен по bbox (см. calcCeilingGrid) — торчит
    // за пределы фактического контура, если комната непрямоугольная или
    // просто повёрнута относительно мировых осей (тогда и AABB шире самой
    // комнаты). Подрезаем по реальному roomPoints, переведённому в ту же
    // локальную систему координат, что и сегменты grid (мм, ноль — угол
    // bbox). См. clipCeilingGridToPolygon в ceilingGridGeometry.ts.
    const polygonLocalMm = roomPoints.map(p => ({
      x: (p.x - bbox.minX) * 1000,
      y: (p.z - bbox.minZ) * 1000,
    }))
    return clipCeilingGridToPolygon(rawGrid, polygonLocalMm)
  }, [bbox, stepB, stepC, bearingAlongLength, stepA, ceilingType, roomPoints, layoutMode, wallOffsetMainMm, wallOffsetBearingMm])

  // Вертикальная раскладка уровней относительно низа плиты (ceilingM), вниз:
  // 12.07.2026, ИСПРАВЛЕНИЕ: подвес крепится к ОСНОВНОМУ профилю (верхний
  // уровень), несущий — ниже, соединён с основным крабом, к несущему же
  // крепится ГКЛ (см. calcP112Frame.ts, шапка файла — было наоборот).
  // 13.07.2026: у П113 (одноуровневая система) такого разноса по высоте нет
  // вообще — оба профиля физически на одном уровне, соединены плоским
  // одноуровневым соединителем (не двухуровневым крабом), см.
  // calcP113Frame.ts, шапка файла. bearingY === mainY в этом случае — весь
  // код ниже (крабы/ГКЛ/минвата) не различает типы отдельно, просто получает
  // одинаковые Y для обоих профилей и корректно "схлопывается" сам.
  const dropToMainM = 0.12   // типичный вылет прямого подвеса, для показа
  const mainY = ceilingM - dropToMainM
  const bearingY = ceilingType === 'p113' ? mainY : mainY - mmToM(27) - 0.003
  const gklY = calcGklLevelM(ceilingM, ceilingType)
  const woolY = mainY - mmToM(20)

  const ppShape = useMemo(() => ppProfileShape(), [])

  if (!bbox || !grid) return null

  // 19.07.2026: рендер одной линии профиля (несущей или основной) с разбивкой
  // на куски по STANDARD_BAR_LENGTH_MM и удлинителями в стыках — см.
  // splitSegmentByBarLength (ceilingGridGeometry.ts, чистая математика) и
  // profileExtenderGeometry выше. Общая функция для bearingSegments и
  // mainSegments — раньше был один map с одним ThinProfileMesh на весь
  // сегмент, теперь сегмент может дать несколько кусков + мешей удлинителя.
  function renderProfileRun(segments: CeilingGridSegment[], y: number, keyPrefix: string) {
    return segments.flatMap((seg, i) => {
      const { pieces, joints } = splitSegmentByBarLength(seg, STANDARD_BAR_LENGTH_MM)
      const alongX = Math.abs(seg.z1 - seg.z2) < 1e-6
      const rotation: [number, number, number] = alongX ? [0, Math.PI / 2, 0] : [0, 0, 0]
      const segLenMm = Math.hypot(seg.x2 - seg.x1, seg.z2 - seg.z1)
      const ux = segLenMm > 0 ? (seg.x2 - seg.x1) / segLenMm : 0
      const uz = segLenMm > 0 ? (seg.z2 - seg.z1) / segLenMm : 0

      const pieceMeshes = pieces.map((piece, j) => {
        const lengthMm = Math.hypot(piece.x2 - piece.x1, piece.z2 - piece.z1)
        const geo = extrudeProfileM(ppShape, lengthMm)
        const midX = bbox!.minX + (piece.x1 + piece.x2) / 2 / 1000
        const midZ = bbox!.minZ + (piece.z1 + piece.z2) / 2 / 1000
        return (
          <ThinProfileMesh
            key={`${keyPrefix}-${i}-${j}`}
            geometry={geo}
            material={metalMat}
            position={[bbox!.minX + piece.x1 / 1000, y, bbox!.minZ + piece.z1 / 1000]}
            rotation={rotation}
            actualLocalHeightM={0.027}
            onClick={focusableClick(new THREE.Vector3(midX, y, midZ))}
          />
        )
      })

      // удлинитель центрируется на шве — сдвиг назад по направлению
      // сегмента на половину длины удлинителя (входит в оба соседних куска)
      const extenderMeshes = joints.map((joint, j) => {
        const startX = joint.x - ux * (EXTENDER_LENGTH_MM / 2)
        const startZ = joint.z - uz * (EXTENDER_LENGTH_MM / 2)
        return (
          <mesh
            key={`${keyPrefix}-ext-${i}-${j}`}
            geometry={profileExtenderGeometry(EXTENDER_LENGTH_MM)}
            material={metalMat}
            position={[bbox!.minX + startX / 1000, y, bbox!.minZ + startZ / 1000]}
            rotation={rotation}
            castShadow
          />
        )
      })

      return [...pieceMeshes, ...extenderMeshes]
    })
  }

  return (
    <group>
      {/* несущий профиль */}
      {renderProfileRun(grid.bearingSegments, bearingY, 'bearing')}

      {/* основной профиль (перпендикулярно несущему) */}
      {renderProfileRun(grid.mainSegments, mainY, 'main')}


      {/* соединители на пересечениях: П113 — один уровень, реальный
          одноуровневый краб (crabGeometry, плоская крестовина с лапками),
          П112 — два уровня, реальная гнутая скоба (twoLevelConnectorGeometry,
          19.07.2026, см. комментарий над функцией) */}
      {grid.crabPoints.map((p, i) => {
        const cx = bbox.minX + p.x / 1000, cz = bbox.minZ + p.z / 1000
        if (ceilingType === 'p113') {
          const cy = (bearingY + mainY) / 2
          return (
            <mesh
              key={`crab-${i}`}
              geometry={crabGeometry()}
              material={crabMat}
              position={[cx, cy, cz]}
              castShadow
              onClick={focusableClick(new THREE.Vector3(cx, cy, cz))}
            />
          )
        }
        const gapMm = (mainY - bearingY) * 1000
        return (
          <mesh
            key={`crab-${i}`}
            geometry={twoLevelConnectorGeometry(gapMm)}
            material={crabMat}
            position={[cx, mainY, cz]}
            castShadow
            onClick={focusableClick(new THREE.Vector3(cx, mainY, cz))}
          />
        )
      })}

      {/* подвесы вдоль основного профиля — П113: перфорированная лента (по
          фото), П112: стержень+пластина+зажим (см. Hanger/HangerStripP113
          выше, 14.07.2026) */}
      {grid.hangerPoints.map((p, i) => {
        const hx = bbox.minX + p.x / 1000, hz = bbox.minZ + p.z / 1000
        const hy = ceilingM - dropToMainM / 2
        const click = focusableClick(new THREE.Vector3(hx, hy, hz))
        if (ceilingType === 'p113') {
          // тот же alongX, что и у ThinProfileMesh main-сегментов выше —
          // main-профиль у П113 идёт в одном направлении по всей сетке
          // (mainAlongLength === bearingAlongLength, см. calcCeilingGridP113).
          const rotationY = bearingAlongLength ? Math.PI / 2 : 0
          return (
            <HangerStripP113
              key={`hanger-${i}`}
              x={hx} y={ceilingM} z={hz} dropM={dropToMainM}
              rotationY={rotationY}
              onClick={click}
            />
          )
        }
        return (
          <Hanger
            key={`hanger-${i}`}
            x={hx} y={ceilingM} z={hz} dropM={dropToMainM}
            onClick={click}
          />
        )
      })}

      {/* минвата — фрагменты в части ячеек, только для наглядности */}
      {showWool && grid.mainSegments.length > 1 && grid.bearingSegments.length > 1 && (
        <MineralWoolFill bbox={bbox} grid={grid} y={woolY} />
      )}

      {/* ГКЛ — фрагмент листа снизу, показывает вид уже зашитого участка */}
      {showGkl && (
        <GklFragment bbox={bbox} y={gklY} />
      )}
    </group>
  )
}

function MineralWoolFill({
  bbox, grid, y,
}: {
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number }
  grid: ReturnType<typeof calcCeilingGrid>
  y: number
}) {
  // Границы ячеек по X — координаты всех "вертикальных" линий сетки (x1===x2,
  // линия идёт вдоль Z), независимо от того, несущий это профиль или основной
  // (кто из них вертикален — зависит от bearingAlongLength, см.
  // ceilingGridGeometry.ts). То же для Z с "горизонтальными" линиями (z1===z2).
  const allSegments = useMemo(() => [...grid.bearingSegments, ...grid.mainSegments], [grid])
  const cellsX = useMemo(() => {
    const xs = [0, ...allSegments.filter(s => s.x1 === s.x2).map(s => s.x1), (bbox.maxX - bbox.minX) * 1000]
      .filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b)
    return xs
  }, [allSegments, bbox])
  const cellsZ = useMemo(() => {
    const zs = [0, ...allSegments.filter(s => s.z1 === s.z2).map(s => s.z1), (bbox.maxZ - bbox.minZ) * 1000]
      .filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b)
    return zs
  }, [allSegments, bbox])

  const cells: { x: number; z: number; w: number; d: number }[] = []
  for (let i = 0; i < cellsX.length - 1; i++) {
    for (let j = 0; j < cellsZ.length - 1; j++) {
      if ((i + j) % 3 === 0) continue // не все ячейки — часть остаётся под открытый вид ГКЛ
      const w = cellsX[i + 1] - cellsX[i]
      const d = cellsZ[j + 1] - cellsZ[j]
      if (w < 100 || d < 100) continue
      cells.push({ x: (cellsX[i] + cellsX[i + 1]) / 2, z: (cellsZ[j] + cellsZ[j + 1]) / 2, w, d })
    }
  }

  const tex = useMemo(() => fibrousTexture(), [])
  const woolMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }), [tex])

  return (
    <>
      {cells.map((c, i) => {
        const geo = noisyWoolGeometry(c.w / 1000 - 0.02, c.d / 1000 - 0.02, 0.04)
        return (
          <mesh
            key={i}
            geometry={geo}
            material={woolMat}
            position={[bbox.minX + c.x / 1000, y, bbox.minZ + c.z / 1000]}
            castShadow
          />
        )
      })}
    </>
  )
}

function GklFragment({ bbox, y }: { bbox: { minX: number; maxX: number; minZ: number; maxZ: number }; y: number }) {
  const wM = Math.min(bbox.maxX - bbox.minX, 1.2)
  const dM = Math.min(bbox.maxZ - bbox.minZ, 1.2)
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    const thickness = 12.5, chamfer = 3
    s.moveTo(0, 0)
    s.lineTo(0, thickness - chamfer)
    s.lineTo(chamfer * 0.6, thickness)
    s.lineTo(1000 * wM - chamfer * 0.6, thickness)
    s.lineTo(1000 * wM, thickness - chamfer)
    s.lineTo(1000 * wM, 0)
    s.lineTo(0, 0)
    // shape в плоскости XY: X — ширина листа (wM), Y — толщина 12.5мм;
    // extrude вдоль Z даёт длину dM — без дополнительного поворота, чтобы
    // не путать местами X/Z листа относительно bbox комнаты.
    const g = new THREE.ExtrudeGeometry(s, { depth: 1000 * dM, bevelEnabled: false, curveSegments: 1 })
    g.scale(0.001, 0.001, 0.001)
    return g
  }, [wM, dM])

  return (
    <mesh
      geometry={geo}
      material={gklMat}
      position={[bbox.minX, y, bbox.minZ]}
      receiveShadow
      castShadow
    />
  )
}
