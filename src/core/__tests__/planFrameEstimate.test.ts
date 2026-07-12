import { describe, it, expect } from 'vitest'
import { calcPlanFrameEstimate } from '../planFrameEstimate'
import { resolveAllAttachments, attachmentMaterialOf, type AttachSurface } from '../attachmentResolver'
import type { PlanLine } from '../../types'

const SCALE = 1 // координаты линий заданы сразу в мм

function gklLine(id: string, x1: number, y1: number, x2: number, y2: number, overrides: Partial<PlanLine> = {}): PlanLine {
  const lengthMm = Math.round(Math.hypot(x2 - x1, y2 - y1))
  return {
    id, x1, y1, x2, y2,
    type: 'wall_new', lengthMm, label: id,
    spec: { material: 'gkl', subtype: 'ps50' },
    ...overrides,
  } as PlanLine
}

function liningLine(id: string, x1: number, y1: number, x2: number, y2: number, overrides: Partial<PlanLine> = {}): PlanLine {
  const lengthMm = Math.round(Math.hypot(x2 - x1, y2 - y1))
  return {
    id, x1, y1, x2, y2,
    type: 'wall_lining', lengthMm, label: id,
    spec: { material: 'gkl', subtype: 'frame_ps75', layers: 1 },
    ...overrides,
  } as PlanLine
}

function attachmentsFor(lines: PlanLine[]) {
  const surfaces: AttachSurface[] = lines.map(l => ({
    id: l.id, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
    halfPx: 37.5,
    material: attachmentMaterialOf(l.type, l.spec?.material),
  }))
  return resolveAllAttachments(surfaces)
}

describe('calcPlanFrameEstimate — перегородки (wall_new) НЕ дедуплицируются на 90°-углах', () => {
  it('угол двух перегородок — итог равен простой сумме по линиям (без вычета)', () => {
    const lines: PlanLine[] = [
      gklLine('P1', 0, 0, 2000, 0),
      gklLine('P2', 2000, 0, 2000, 2000),
    ]
    const attachments = attachmentsFor(lines)
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    const rawSum = est.partitions.perLine.reduce((s, p) => s + p.result.studsCount, 0)
    expect(est.partitions.studsCount).toBe(rawSum) // никакого вычета
  })

  it('замкнутый контур из 4 перегородок (короб) — итог = сумма по линиям, без дедупликации', () => {
    const lines: PlanLine[] = [
      gklLine('S1', 0, 0, 800, 0),
      gklLine('S2', 800, 0, 800, 450),
      gklLine('S3', 800, 450, 0, 450),
      gklLine('S4', 0, 450, 0, 0),
    ]
    const attachments = attachmentsFor(lines)
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    const rawSum = est.partitions.perLine.reduce((s, p) => s + p.result.studsCount, 0)
    // Раньше (до правки) здесь бы вычлось 4 стойки — теперь НЕ должно.
    expect(est.partitions.studsCount).toBe(rawSum)
  })
})

describe('calcPlanFrameEstimate — облицовка (wall_lining) ДЕДУПЛИЦИРУЕТСЯ на 90°-углах', () => {
  const lines: PlanLine[] = [
    liningLine('L1', 0, 0, 800, 0),
    liningLine('L2', 800, 0, 800, 450),
    liningLine('L3', 800, 450, 0, 450),
    liningLine('L4', 0, 450, 0, 0),
  ]
  const attachments = attachmentsFor(lines)

  it('короб из облицовки 800×450 — находит 4 угловых узла', () => {
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    expect(est.lining.cornerNodesCount).toBe(4)
  })

  it('итоговое число стоек меньше сырой суммы ровно на число узлов', () => {
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    expect(est.lining.studsCount).toBe(est.lining.studsCountRaw - est.lining.cornerNodesCount)
  })

  it('простой одиночный угол облицовки (2 сегмента) — дедуплицируется 1 узел', () => {
    const twoLines: PlanLine[] = [
      liningLine('A', 0, 0, 2000, 0),
      liningLine('B', 2000, 0, 2000, 2000),
    ]
    const att = attachmentsFor(twoLines)
    const est = calcPlanFrameEstimate(twoLines, att, SCALE)
    expect(est.lining.cornerNodesCount).toBe(1)
    expect(est.lining.studsCount).toBe(est.lining.studsCountRaw - 1)
  })
})

describe('calcPlanFrameEstimate — облицовка, начинающаяся от угла перегородки, НЕ дедуплицируется', () => {
  it('перегородка + облицовка сходятся под 90° — узел облицовка↔перегородка не считается', () => {
    const lines: PlanLine[] = [
      gklLine('P1', 0, 0, 0, 2000),        // перегородка вертикальная
      liningLine('L1', 0, 0, 1500, 0),     // облицовка стартует от того же угла, горизонтально
    ]
    const attachments = attachmentsFor(lines)
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)
    // Второй сегмент узла — перегородка (wall_new), не облицовка — не
    // попадает в liningLineIds, дедупликация не срабатывает.
    expect(est.lining.cornerNodesCount).toBe(0)
    const rawSum = est.lining.perLine.reduce((s, p) => s + p.result.studsCount, 0)
    expect(est.lining.studsCount).toBe(rawSum)
  })
})

describe('calcPlanFrameEstimate — смешанный план: перегородки без дедупликации + облицовка с дедупликацией, независимо друг от друга', () => {
  it('короб перегородок и отдельно короб облицовки на одном плане считаются раздельно и корректно', () => {
    const lines: PlanLine[] = [
      // Периметр из перегородок — без дедупликации
      gklLine('W1', 0, 0, 3000, 0),
      gklLine('W2', 3000, 0, 3000, 3000),
      gklLine('W3', 3000, 3000, 0, 3000),
      gklLine('W4', 0, 3000, 0, 0),
      // Отдельно стоящий короб облицовки (вокруг колонны/трубы) — с дедупликацией
      liningLine('C1', 5000, 5000, 5600, 5000),
      liningLine('C2', 5600, 5000, 5600, 5600),
      liningLine('C3', 5600, 5600, 5000, 5600),
      liningLine('C4', 5000, 5600, 5000, 5000),
    ]
    const attachments = attachmentsFor(lines)
    const est = calcPlanFrameEstimate(lines, attachments, SCALE)

    const partitionRawSum = est.partitions.perLine.reduce((s, p) => s + p.result.studsCount, 0)
    expect(est.partitions.studsCount).toBe(partitionRawSum)

    expect(est.lining.cornerNodesCount).toBe(4)
    expect(est.lining.studsCount).toBe(est.lining.studsCountRaw - 4)
  })
})
