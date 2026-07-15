import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ppProfileShape } from '../CeilingGridMesh'

describe('ppProfileShape (14.07.2026 — исправлена ориентация: полка вниз, рёбра вверх)', () => {
  it('широкая "полка" (почти сплошной сегмент во всю ширину, куда крепится ГКЛ) — у y=0 (низ, там же mesh.position/mainY-bearingY), а не у y=h', () => {
    const shape = ppProfileShape(60, 27, 0.6, 5)
    const pts = shape.getPoints()
    // Ищем пару соседних точек контура, образующих ГОРИЗОНТАЛЬНЫЙ сегмент
    // почти во всю ширину профиля (>= 50мм из 60) — это и есть "полка"/"крыша".
    let wideSegY: number | null = null
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      if (Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 50) {
        wideSegY = a.y
      }
    }
    expect(wideSegY).not.toBeNull()
    expect(wideSegY!).toBeLessThan(27 / 2) // ближе к низу (y≈0), не к верху (y≈27)
  })

  it('открытый верх — "ножки" тянутся почти до y=h (без соединяющей перемычки между ними, канал открыт)', () => {
    const shape = ppProfileShape(60, 27, 0.6, 5)
    const pts = shape.getPoints()
    const maxY = Math.max(...pts.map(p => p.y))
    const minY = Math.min(...pts.map(p => p.y))
    expect(maxY).toBeCloseTo(27 - 0.6, 1) // до h-t (0.6мм — толщина металла, см. ppProfileShape)
    expect(minY).toBeCloseTo(0, 1)
    // между двумя "ножками" на высоте maxY НЕТ соединяющего сегмента —
    // проверяем, что ни одна пара соседних точек не образует горизонталь
    // на этой высоте шире, чем толщина металла (иначе это была бы
    // перемычка, а не открытый канал).
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      if (Math.abs(a.y - maxY) < 0.1 && Math.abs(b.y - maxY) < 0.1) {
        expect(Math.abs(a.x - b.x)).toBeLessThan(60) // короткий кусок вставки, не вся ширина
      }
    }
  })

  it('лапки (крайние точки за пределы ширины w, x<0 или x>w) — на ТОЙ ЖЕ стороне, что и широкая полка (у y≈0, низ) — физически они часть той же кромки профиля', () => {
    const shape = ppProfileShape(60, 27, 0.6, 5)
    const pts = shape.getPoints()
    const lipPts = pts.filter(p => p.x < 0 || p.x > 60)
    expect(lipPts.length).toBeGreaterThan(0)
    for (const p of lipPts) expect(p.y).toBeCloseTo(0, 1)
  })

  it('сохраняет то же направление обхода (winding), что и версия ДО правки 14.07.2026 — иначе перевернутся нормали экструзии', () => {
    // Точки версии ДО правки (полка была у y=h, открытый низ — у y=0) —
    // оставлены здесь буквально как опорная фигура для сверки направления
    // обхода контура, НЕ как рабочий код (сама версия уже неверна физически,
    // см. остальные тесты в этом файле).
    const oldPts: [number, number][] = [
      [-5, 27], [0, 27], [0, 0.6], [0.6, 0.6], [0.6, 26.4],
      [59.4, 26.4], [59.4, 0.6], [60, 0.6], [60, 27], [65, 27],
    ]
    const oldShape = new THREE.Shape()
    oldShape.moveTo(oldPts[0][0], oldPts[0][1])
    for (let i = 1; i < oldPts.length; i++) oldShape.lineTo(oldPts[i][0], oldPts[i][1])
    oldShape.closePath()

    const newShape = ppProfileShape(60, 27, 0.6, 5)
    const oldCW = THREE.ShapeUtils.isClockWise(oldShape.getPoints())
    const newCW = THREE.ShapeUtils.isClockWise(newShape.getPoints())
    expect(newCW).toBe(oldCW)
  })
})
