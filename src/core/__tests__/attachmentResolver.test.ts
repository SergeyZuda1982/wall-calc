import { describe, it, expect } from 'vitest'
import {
  resolveLineAttachments,
  resolveAllAttachments,
  attachmentMaterialOf,
  type AttachSurface,
} from '../attachmentResolver'

describe('resolveLineAttachments — T-стык', () => {
  it('находит примыкание конца линии к телу соседней (грань толстой стены)', () => {
    // B — кирпичная стена 200мм (halfPx=10), ось y=50, x: 0..200
    const B: AttachSurface = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, material: 'brick' }
    // A — перегородка ГКЛ, конец на грани B (y=40, т.е. 50-10)
    const A: AttachSurface = { id: 'A', x1: 100, y1: 40, x2: 100, y2: 0, halfPx: 5, material: 'gkl_existing' }

    const res = resolveLineAttachments('A', [B, A])
    expect(res.start).toEqual({ neighborId: 'B', material: 'brick' })
    expect(res.end).toBeNull()
  })

  it('не находит примыкание, если конец далеко от соседа', () => {
    const B: AttachSurface = { id: 'B', x1: 0, y1: 50, x2: 200, y2: 50, halfPx: 10, material: 'concrete' }
    const A: AttachSurface = { id: 'A', x1: 100, y1: 20, x2: 100, y2: 0, halfPx: 5, material: 'gkl_existing' }

    const res = resolveLineAttachments('A', [B, A])
    expect(res.start).toBeNull()
    expect(res.end).toBeNull()
  })
})

describe('resolveLineAttachments — L-стык (общий конец)', () => {
  it('находит примыкание, когда концы двух линий совпадают (угол)', () => {
    const B: AttachSurface = { id: 'B', x1: 0, y1: 0, x2: 100, y2: 0, halfPx: 5, material: 'block' }
    const A: AttachSurface = { id: 'A', x1: 100, y1: 0, x2: 100, y2: 100, halfPx: 5, material: 'gkl_existing' }

    const res = resolveLineAttachments('A', [B, A])
    expect(res.start).toEqual({ neighborId: 'B', material: 'block' })
  })
})

describe('resolveLineAttachments — свободный конец', () => {
  it('конец без соседей — null с обеих сторон', () => {
    const A: AttachSurface = { id: 'A', x1: 0, y1: 0, x2: 100, y2: 0, halfPx: 5, material: 'gkl_existing' }
    const res = resolveLineAttachments('A', [A])
    expect(res.start).toBeNull()
    expect(res.end).toBeNull()
  })
})

describe('resolveAllAttachments — батч для всех линий', () => {
  it('резолвит оба конца перегородки между двух капитальных стен', () => {
    // Перегородка A зажата между двумя кирпичными стенами B (слева) и C (справа)
    const B: AttachSurface = { id: 'B', x1: 0, y1: -50, x2: 0, y2: 50, halfPx: 10, material: 'brick' }
    const C: AttachSurface = { id: 'C', x1: 200, y1: -50, x2: 200, y2: 50, halfPx: 10, material: 'concrete' }
    const A: AttachSurface = { id: 'A', x1: 10, y1: 0, x2: 190, y2: 0, halfPx: 5, material: 'gkl_existing' }

    const res = resolveAllAttachments([B, C, A])
    expect(res.get('A')!.start).toEqual({ neighborId: 'B', material: 'brick' })
    expect(res.get('A')!.end).toEqual({ neighborId: 'C', material: 'concrete' })
  })
})

describe('attachmentMaterialOf', () => {
  it('wall_existing маппит spec.material напрямую', () => {
    expect(attachmentMaterialOf('wall_existing', 'brick')).toBe('brick')
    expect(attachmentMaterialOf('wall_existing', 'block')).toBe('block')
    expect(attachmentMaterialOf('wall_existing', 'concrete')).toBe('concrete')
  })

  it('wall_existing без материала — unknown', () => {
    expect(attachmentMaterialOf('wall_existing', undefined)).toBe('unknown')
  })

  it('wall_new и wall_lining всегда gkl_existing независимо от spec', () => {
    expect(attachmentMaterialOf('wall_new', 'gkl')).toBe('gkl_existing')
    expect(attachmentMaterialOf('wall_lining', undefined)).toBe('gkl_existing')
  })

  it('ceiling/floor — unknown (не боковое примыкание)', () => {
    expect(attachmentMaterialOf('ceiling', undefined)).toBe('unknown')
    expect(attachmentMaterialOf('floor', undefined)).toBe('unknown')
  })
})
