import * as THREE from 'three'

/**
 * slantedTopBoxGeometry.ts — короб с наклонной (но по-прежнему ПЛОСКОЙ)
 * верхней гранью, для стен/облицовок под наклонным потолком (12.09.2026,
 * найдено на объекте: Ceiling.slope настроен и верно учитывается в 2D-смете
 * "Конструкции на плане" — см. core/ceilingSlope.ts, — но 3D всегда рисовал
 * стену плоским coxом высотой line.heightMm/DEFAULT_HEIGHT_MM, потолок с
 * уклоном при этом никак стены не резал).
 *
 * Потолок наклонён линейно только ВДОЛЬ стены (см. SlopePlane —
 * перпендикулярно линии p1→p2 высота постоянна), поэтому верх короба —
 * ровно ОДНА плоскость, а не скрученная поверхность: все 6 граней остаются
 * плоскими четырёхугольниками, топология та же, что у THREE.BoxGeometry —
 * просто верхние 4 вершины смещены по Y индивидуально (левая пара — на
 * hLeft, правая — на hRight) вместо общего sy.
 *
 * Центрирована как обычный boxGeometry(sx, sy, sz): низ всегда плоский на
 * y = -max(hLeft,hRight)/2. При hLeft === hRight результат идентичен
 * boxGeometry(sx, hLeft, sz) — старое поведение не меняется там, где уклон
 * не задан (см. вызывающий код в Scene3D.tsx, WallMesh: используется только
 * когда box.topYAtFromM/topYAtToM реально заданы).
 *
 * Каждая грань строится из СВОИХ 4 вершин (не расшарены с соседними
 * гранями) — ради плоского (flat) затенения по грани через
 * computeVertexNormals(), как у обычного boxGeometry, а не сглаженного
 * (иначе наклонная плоскость визуально "перетекала" бы в боковые грани).
 *
 * hLeft — высота (метры) в грани x = -sx/2 (сторона alongFromM у WallBox3D).
 * hRight — высота (метры) в грани x = +sx/2 (сторона alongToM).
 * Ориентация всех 6 граней (порядок вершин на грань) проверена через
 * знак векторного произведения — см. тест slantedTopBoxGeometry.test.ts
 * (нормали должны смотреть НАРУЖУ короба).
 */
export function slantedTopBoxGeometry(sx: number, sz: number, hLeft: number, hRight: number): THREE.BufferGeometry {
  const maxH = Math.max(hLeft, hRight)
  const x0 = -sx / 2, x1 = sx / 2
  const z0 = -sz / 2, z1 = sz / 2
  const yBot = -maxH / 2
  const yTopL = hLeft - maxH / 2
  const yTopR = hRight - maxH / 2

  // Именование: [л(x0)/п(x1)][низ/верх][зад(z0)/перед(z1)].
  const lbb: [number, number, number] = [x0, yBot, z0]
  const lbf: [number, number, number] = [x0, yBot, z1]
  const rbb: [number, number, number] = [x1, yBot, z0]
  const rbf: [number, number, number] = [x1, yBot, z1]
  const ltb: [number, number, number] = [x0, yTopL, z0]
  const ltf: [number, number, number] = [x0, yTopL, z1]
  const rtb: [number, number, number] = [x1, yTopR, z0]
  const rtf: [number, number, number] = [x1, yTopR, z1]

  // Порядок вершин на каждой грани подобран так, чтобы нормаль (правило
  // правой руки) смотрела наружу короба — см. рассуждение и проверку в
  // тесте. uv — стандартный квадрат [0,0]-[1,0]-[1,1]-[0,1] по порядку.
  const faces: [number, number, number][][] = [
    [lbf, rbf, rtf, ltf],   // перед (+Z)
    [lbb, ltb, rtb, rbb],   // зад (-Z)
    [rbb, rtb, rtf, rbf],   // право (+X)
    [lbb, lbf, ltf, ltb],   // лево (-X)
    [lbb, rbb, rbf, lbf],   // низ (-Y)
    [ltb, ltf, rtf, rtb],   // верх (наклонная плоскость)
  ]
  const quadUv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]

  const positions: number[] = []
  const uvs: number[] = []
  for (const [a, b, c, d] of faces) {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d)
    uvs.push(...quadUv[0], ...quadUv[1], ...quadUv[2], ...quadUv[0], ...quadUv[2], ...quadUv[3])
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.computeVertexNormals()
  return geo
}
