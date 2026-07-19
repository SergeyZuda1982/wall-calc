import { describe, it, expect } from 'vitest'
import { splitSegmentByBarLength, type CeilingGridSegment } from '../ceilingGridGeometry'

// 19.07.2026 — пункт 4 списка сверки крепежа потолка: удлинитель ПП60×27.
// Правило раскроя подтверждено пользователем: полные бары от начала
// сегмента, короткий остаток в конце (не деление длины поровну на N
// кусков) — см. комментарий у splitSegmentByBarLength.

describe('splitSegmentByBarLength', () => {
  it('сегмент короче барной длины возвращается одним куском без стыков', () => {
    const seg: CeilingGridSegment = { x1: 0, z1: 0, x2: 2500, z2: 0 }
    const { pieces, joints } = splitSegmentByBarLength(seg, 3000)
    expect(pieces).toEqual([seg])
    expect(joints).toEqual([])
  })

  it('сегмент ровно барной длины — один кусок, без стыков (граничный случай)', () => {
    const seg: CeilingGridSegment = { x1: 0, z1: 0, x2: 3000, z2: 0 }
    const { pieces, joints } = splitSegmentByBarLength(seg, 3000)
    expect(pieces.length).toBe(1)
    expect(joints.length).toBe(0)
  })

  it('сегмент длиннее барной длины — полные бары от начала, короткий остаток в конце', () => {
    // 7000мм при баре 3000мм: 3000 + 3000 + 1000 (остаток), 2 стыка
    const seg: CeilingGridSegment = { x1: 0, z1: 0, x2: 7000, z2: 0 }
    const { pieces, joints } = splitSegmentByBarLength(seg, 3000)
    expect(pieces.length).toBe(3)
    expect(pieces[0]).toEqual({ x1: 0, z1: 0, x2: 3000, z2: 0 })
    expect(pieces[1]).toEqual({ x1: 3000, z1: 0, x2: 6000, z2: 0 })
    expect(pieces[2]).toEqual({ x1: 6000, z1: 0, x2: 7000, z2: 0 }) // короткий остаток, не 3000
    expect(joints).toEqual([{ x: 3000, z: 0 }, { x: 6000, z: 0 }])
  })

  it('точное кратное барной длины (6000/3000) — 2 куска по 3000, 1 стык, без огрызка', () => {
    const seg: CeilingGridSegment = { x1: 0, z1: 0, x2: 6000, z2: 0 }
    const { pieces, joints } = splitSegmentByBarLength(seg, 3000)
    expect(pieces.length).toBe(2)
    expect(pieces.every(p => Math.hypot(p.x2 - p.x1, p.z2 - p.z1) === 3000)).toBe(true)
    expect(joints.length).toBe(1)
  })

  it('работает для сегмента вдоль Z (не только вдоль X)', () => {
    const seg: CeilingGridSegment = { x1: 100, z1: 0, x2: 100, z2: 6500 }
    const { pieces, joints } = splitSegmentByBarLength(seg, 3000)
    expect(pieces.length).toBe(3)
    for (const p of pieces) expect(p.x1).toBe(100) // X не меняется, идёт по Z
    expect(joints.length).toBe(2)
  })

  it('куски идут подряд без разрывов и без нахлёста — конец одного равен началу следующего', () => {
    const seg: CeilingGridSegment = { x1: 0, z1: 0, x2: 10000, z2: 0 }
    const { pieces } = splitSegmentByBarLength(seg, 3000)
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].x1).toBeCloseTo(pieces[i - 1].x2, 6)
      expect(pieces[i].z1).toBeCloseTo(pieces[i - 1].z2, 6)
    }
    expect(pieces[0].x1).toBe(seg.x1)
    expect(pieces[pieces.length - 1].x2).toBeCloseTo(seg.x2, 6)
  })

  it('сумма длин кусков равна исходной длине сегмента (ничего не теряется и не добавляется)', () => {
    const seg: CeilingGridSegment = { x1: 0, z1: 0, x2: 8123, z2: 0 }
    const { pieces } = splitSegmentByBarLength(seg, 3000)
    const totalLen = pieces.reduce((sum, p) => sum + Math.hypot(p.x2 - p.x1, p.z2 - p.z1), 0)
    expect(totalLen).toBeCloseTo(8123, 6)
  })

  it('число стыков совпадает с формулой сметы (ceil(length/bar)-1)', () => {
    const lengthMm = 9500
    const barLengthMm = 3000
    const seg: CeilingGridSegment = { x1: 0, z1: 0, x2: lengthMm, z2: 0 }
    const { joints } = splitSegmentByBarLength(seg, barLengthMm)
    expect(joints.length).toBe(Math.ceil(lengthMm / barLengthMm) - 1)
  })
})
