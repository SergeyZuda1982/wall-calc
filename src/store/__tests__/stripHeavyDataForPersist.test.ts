import { describe, it, expect } from 'vitest'
import { stripHeavyDataForPersist } from '../useProjectStore'
import type { ProjectEntry } from '../useProjectStore'
import { emptyLevel } from '../../types'

function projectWithBackground(dataUrl: string): ProjectEntry {
  const level = emptyLevel('Этаж 1', 0)
  level.floorPlan.backgroundImage = {
    dataUrl, x: 0, y: 0, width: 100, height: 100, opacity: 1, locked: false,
  }
  return {
    id: 'p1', name: 'Проект', walls: [], linings: [], profileTemplates: [],
    levels: [level], activeLevelId: level.id, createdAt: new Date().toISOString(),
  }
}

describe('stripHeavyDataForPersist', () => {
  it('вырезает dataUrl подложки, оставляя остальные поля', () => {
    const projects = [projectWithBackground('data:image/png;base64,AAAAVERYLONGBASE64...')]
    const stripped = stripHeavyDataForPersist(projects)
    const bg = stripped[0].levels[0].floorPlan.backgroundImage!
    expect(bg.dataUrl).toBe('')
    expect(bg.x).toBe(0)
    expect(bg.width).toBe(100)
    expect(bg.opacity).toBe(1)
  })

  it('не падает, если подложки нет вообще', () => {
    const level = emptyLevel('Этаж 1', 0)
    const project: ProjectEntry = {
      id: 'p1', name: 'Проект', walls: [], linings: [], profileTemplates: [],
      levels: [level], activeLevelId: level.id, createdAt: new Date().toISOString(),
    }
    const stripped = stripHeavyDataForPersist([project])
    expect(stripped[0].levels[0].floorPlan.backgroundImage).toBeFalsy()
  })

  it('обрабатывает несколько этажей независимо', () => {
    const l1 = emptyLevel('Этаж 1', 0)
    l1.floorPlan.backgroundImage = { dataUrl: 'data:aaa', x: 0, y: 0, width: 1, height: 1, opacity: 1, locked: false }
    const l2 = emptyLevel('Этаж 2', 3000)
    // l2 без подложки
    const project: ProjectEntry = {
      id: 'p1', name: 'Проект', walls: [], linings: [], profileTemplates: [],
      levels: [l1, l2], activeLevelId: l1.id, createdAt: new Date().toISOString(),
    }
    const stripped = stripHeavyDataForPersist([project])
    expect(stripped[0].levels[0].floorPlan.backgroundImage!.dataUrl).toBe('')
    expect(stripped[0].levels[1].floorPlan.backgroundImage).toBeFalsy()
  })

  it('не мутирует исходный массив projects (иммутабельность)', () => {
    const projects = [projectWithBackground('data:realbase64')]
    const originalDataUrl = projects[0].levels[0].floorPlan.backgroundImage!.dataUrl
    stripHeavyDataForPersist(projects)
    expect(projects[0].levels[0].floorPlan.backgroundImage!.dataUrl).toBe(originalDataUrl)
  })

  // 08.07.2026: mepBackgrounds (вентиляция/электрика) должны обрезаться
  // точно так же, как архитектурная backgroundImage — иначе они пишутся
  // в localStorage полновесными, тогда как реальный источник правды теперь
  // IndexedDB (см. bgIndexedDb.ts, ensureBackgroundsLoaded).
  it('вырезает dataUrl у mepBackgrounds (вентиляция и электрика), оставляя остальные поля', () => {
    const level = emptyLevel('Этаж 1', 0)
    level.floorPlan.mepBackgrounds = {
      ventilation: { dataUrl: 'data:vent-base64', x: 1, y: 2, width: 300, height: 400, opacity: 0.6, locked: true },
      electrical: { dataUrl: 'data:elec-base64', x: 3, y: 4, width: 500, height: 600, opacity: 0.5, locked: true },
    }
    const project: ProjectEntry = {
      id: 'p1', name: 'Проект', walls: [], linings: [], profileTemplates: [],
      levels: [level], activeLevelId: level.id, createdAt: new Date().toISOString(),
    }
    const stripped = stripHeavyDataForPersist([project])
    const mep = stripped[0].levels[0].floorPlan.mepBackgrounds!
    expect(mep.ventilation!.dataUrl).toBe('')
    expect(mep.ventilation!.width).toBe(300)
    expect(mep.electrical!.dataUrl).toBe('')
    expect(mep.electrical!.opacity).toBe(0.5)
  })

  it('mepBackgrounds с только одной заданной дисциплиной — вторая остаётся undefined, не падает', () => {
    const level = emptyLevel('Этаж 1', 0)
    level.floorPlan.mepBackgrounds = {
      ventilation: { dataUrl: 'data:vent-base64', x: 0, y: 0, width: 100, height: 100, opacity: 1, locked: false },
    }
    const project: ProjectEntry = {
      id: 'p1', name: 'Проект', walls: [], linings: [], profileTemplates: [],
      levels: [level], activeLevelId: level.id, createdAt: new Date().toISOString(),
    }
    const stripped = stripHeavyDataForPersist([project])
    const mep = stripped[0].levels[0].floorPlan.mepBackgrounds!
    expect(mep.ventilation!.dataUrl).toBe('')
    expect(mep.electrical).toBeFalsy()
  })

  it('этаж без каких-либо подложек (ни архитектурной, ни mep) проходит без изменений', () => {
    const level = emptyLevel('Этаж 1', 0)
    const project: ProjectEntry = {
      id: 'p1', name: 'Проект', walls: [], linings: [], profileTemplates: [],
      levels: [level], activeLevelId: level.id, createdAt: new Date().toISOString(),
    }
    const stripped = stripHeavyDataForPersist([project])
    expect(stripped[0].levels[0].floorPlan.backgroundImage).toBeFalsy()
    expect(stripped[0].levels[0].floorPlan.mepBackgrounds).toEqual({})
  })
})
