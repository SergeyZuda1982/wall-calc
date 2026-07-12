import { describe, it, expect } from 'vitest'
import { calcPlanFrameEstimate } from '../planFrameEstimate'
import { resolveAllAttachments, attachmentMaterialOf, type AttachSurface } from '../attachmentResolver'
import type { PlanLine } from '../../types'

// scaleMmPx = 1 (координаты линий заданы сразу в мм) — упрощает фикстуры,
// совпадает с подходом в planLineToWallInput.test.ts.
const SCALE = 1

function gklLine(id: string, x1: number, y1: number, x2: number, y2: number, overrides: Partial<PlanLine> = {}): PlanLine {
  const lengthMm = Math.round(Math.hypot(x2 - x1, y2 - y1))
  return {
    id, x1, y1, x2, y2,
    type: 'wall_new', lengthMm, label: id,
    spec: { material: 'gkl', subtype: 'ps50' },
    ...overrides,
  } as PlanLine
}

function capitalLine(id: string, x1: number, y1: number, x2: number, y2: number): PlanLine {
  const lengthMm = Math.round(Math.hypot(x2 - x1, y2 - y1))
  return {
    id, x1, y1, x2, y2,
    type: 'wall_existing', lengthMm, label: id,
    spec: { material: 'brick', subtype: '250' },
  } as PlanLine
}

function attachmentsFor(lines: PlanLine[]) {
  const surfaces: AttachSurface[] = lines.map(l => ({
    id: l.id, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
    halfPx: 37.5, // половина толщины ps50 (~75мм) при scaleMmPx=1
    material: attachmentMaterialOf(l.type, l.spec?.material),
  }))
  return resolveAllAttachments(surfaces)
}

describe('calcPlanFrameEstimate — короб 800×450 (пример из спецификации)', () => {
  const lines: PlanLine[] = [
    gklLine('S1', 0, 0, 800, 0),
    gklLine('S2', 800, 0, 800, 450),
    gklLine('S3', 800, 450, 0, 450),
    gklLine('S4', 0, 450, 0, 0),
  ]
  const attachments = attachmentsFor(lines)

  it('находит все 4 угловых узла замкнутого контура', () => {
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    expect(est.cornerNodesCount).toBe(4)
  })

  it('итоговое число стоек меньше суммы по линиям ровно на число угловых узлов', () => {
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    expect(est.studsCount).toBe(est.studsCountRaw - est.cornerNodesCount)
  })

  it('итоговый метраж ПС меньше сырой суммы (вычтена высота дублирующихся угловых стоек)', () => {
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    // Высота по умолчанию 3000мм (heightMm не задан) -> каждая дублирующаяся
    // угловая стойка = 3м, 4 узла = 12м вычета.
    expect(est.cwTotalMRaw - est.cwTotalM).toBeCloseTo(12, 5)
  })

  it('объединённый раскрой (studCutList) не пуст и укладывается в прутки 3000мм', () => {
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    expect(est.studCutList.totalBars).toBeGreaterThan(0)
    for (const bar of est.studCutList.bars) {
      const used = bar.pieces.reduce((s, p) => s + p.piece.length, 0)
      expect(used).toBeLessThanOrEqual(3000)
    }
  })
})

describe('calcPlanFrameEstimate — простой одиночный угол (2 сегмента)', () => {
  it('дедуплицирует ровно один узел', () => {
    const lines: PlanLine[] = [
      gklLine('A', 0, 0, 2000, 0),
      gklLine('B', 2000, 0, 2000, 2000),
    ]
    const attachments = attachmentsFor(lines)
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    expect(est.cornerNodesCount).toBe(1)
    expect(est.studsCount).toBe(est.studsCountRaw - 1)
  })
})

describe('calcPlanFrameEstimate — примыкание к капитальной стене (узел А) НЕ трогается', () => {
  it('gkl-перегородка упирается торцом в капитальную стену под 90° — не считается угловым узлом дедупликации', () => {
    const lines: PlanLine[] = [
      capitalLine('CAP', 0, 0, 3000, 0),
      gklLine('P1', 0, 0, 0, 2000), // конец P1 совпадает с концом CAP, угол 90°
    ]
    const attachments = attachmentsFor(lines)
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    // CAP не участвует в planLinesToWallInputs (wall_existing) — узел
    // с её участием не может быть угловым узлом дедупликации каркаса.
    expect(est.cornerNodesCount).toBe(0)
    expect(est.studsCount).toBe(est.studsCountRaw)
  })
})

describe('calcPlanFrameEstimate — Т-стык двух gkl-перегородок не дедуплицируется', () => {
  it('перегородка примыкает серединой к телу другой (Т-стык) — не 90°-угол конец=конец', () => {
    const lines: PlanLine[] = [
      gklLine('Main', 0, 0, 3000, 0),
      gklLine('Branch', 1500, 0, 1500, 1500), // конец Branch на ТЕЛЕ Main, не на конце
    ]
    const attachments = attachmentsFor(lines)
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    expect(est.cornerNodesCount).toBe(0)
    expect(est.studsCount).toBe(est.studsCountRaw)
  })
})

describe('calcPlanFrameEstimate — torets-v-torets (180°, одна ось) не дедуплицируется', () => {
  it('две перегородки на одной оси стык в стык — не угол', () => {
    const lines: PlanLine[] = [
      gklLine('L1', 0, 0, 1500, 0),
      gklLine('L2', 1500, 0, 3000, 0),
    ]
    const attachments = attachmentsFor(lines)
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    expect(est.cornerNodesCount).toBe(0)
  })
})
