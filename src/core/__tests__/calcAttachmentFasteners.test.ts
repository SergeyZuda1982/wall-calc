import { describe, it, expect } from 'vitest'
import {
  resolveEndFastener,
  fastenerCountByHeight,
  calcLineFasteners,
  calcProjectFasteners,
} from '../calcAttachmentFasteners'
import type { PlanLine } from '../../types'
import type { LineAttachments } from '../attachmentResolver'

describe('fastenerCountByHeight', () => {
  it('округляет вверх, без +1 (конвенция screwsByHeight)', () => {
    expect(fastenerCountByHeight(3000, 300)).toBe(10)
    expect(fastenerCountByHeight(3001, 300)).toBe(11)
    expect(fastenerCountByHeight(0, 300)).toBe(0)
    expect(fastenerCountByHeight(3000, 0)).toBe(0)
  })
})

describe('resolveEndFastener', () => {
  it('свободный край — null', () => {
    expect(resolveEndFastener(null, undefined)).toBeNull()
  })

  it('ручное переопределение побеждает дефолт', () => {
    const r = resolveEndFastener(
      { neighborId: 'X', material: 'concrete' },
      { type: 'roofing_screw', stepMm: 150 },
    )
    expect(r).toEqual({ type: 'roofing_screw', stepMm: 150 })
  })

  it('без override — дефолт по материалу', () => {
    expect(resolveEndFastener({ neighborId: 'X', material: 'block' }, undefined))
      .toEqual({ type: 'wood_screw_45', stepMm: 300 })
  })

  it('unknown материал без override — null (нечего считать)', () => {
    expect(resolveEndFastener({ neighborId: 'X', material: 'unknown' }, undefined)).toBeNull()
  })
})

describe('calcLineFasteners', () => {
  const baseLine: PlanLine = {
    id: 'L1', x1: 0, y1: 0, x2: 3000, y2: 0,
    type: 'wall_new', lengthMm: 3000, label: 'П-1',
  } as PlanLine

  it('считает оба конца по высоте линии (дефолт 3000)', () => {
    const attachments: LineAttachments = {
      start: { neighborId: 'A', material: 'brick' },
      end: { neighborId: 'B', material: 'block' },
    }
    const res = calcLineFasteners(baseLine, attachments)
    expect(res.start).toEqual({ spec: { type: 'dowel_6x40', stepMm: 300 }, qty: 10 })
    expect(res.end).toEqual({ spec: { type: 'wood_screw_45', stepMm: 300 }, qty: 10 })
  })

  it('использует line.heightMm если задан', () => {
    const line = { ...baseLine, heightMm: 2700 }
    const attachments: LineAttachments = { start: { neighborId: 'A', material: 'brick' }, end: null }
    const res = calcLineFasteners(line, attachments)
    expect(res.start!.qty).toBe(9) // ceil(2700/300)
    expect(res.end).toBeNull()
  })

  it('свободные оба конца — оба null', () => {
    const res = calcLineFasteners(baseLine, { start: null, end: null })
    expect(res.start).toBeNull()
    expect(res.end).toBeNull()
  })

  it('без attachments (undefined) — оба null, не падает', () => {
    const res = calcLineFasteners(baseLine, undefined)
    expect(res.start).toBeNull()
    expect(res.end).toBeNull()
  })

  it('ручной override перекрывает дефолт по материалу', () => {
    const line = { ...baseLine, fastenerStart: { type: 'roofing_screw' as const, stepMm: 200 } }
    const attachments: LineAttachments = { start: { neighborId: 'A', material: 'brick' }, end: null }
    const res = calcLineFasteners(line, attachments)
    expect(res.start).toEqual({ spec: { type: 'roofing_screw', stepMm: 200 }, qty: 15 }) // ceil(3000/200)
  })
})

describe('calcProjectFasteners', () => {
  it('суммирует крепёж по типу по всем линиям', () => {
    const lines: PlanLine[] = [
      { id: 'L1', x1: 0, y1: 0, x2: 3000, y2: 0, type: 'wall_new', lengthMm: 3000, label: 'П-1' } as PlanLine,
      { id: 'L2', x1: 0, y1: 0, x2: 3000, y2: 0, type: 'wall_new', lengthMm: 3000, label: 'П-2' } as PlanLine,
    ]
    const map = new Map<string, LineAttachments>([
      ['L1', { start: { neighborId: 'A', material: 'brick' }, end: null }],
      ['L2', { start: { neighborId: 'B', material: 'brick' }, end: { neighborId: 'C', material: 'block' } }],
    ])
    const totals = calcProjectFasteners(lines, map)
    expect(totals.get('dowel_6x40')).toBe(20)   // L1.start(10) + L2.start(10)
    expect(totals.get('wood_screw_45')).toBe(10) // L2.end(10)
  })
})
