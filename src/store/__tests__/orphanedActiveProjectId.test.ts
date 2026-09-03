// @vitest-environment node
//
// Реальный кейс с объекта (03.09.2026): activeProjectId в сторе разошёлся
// с projects[] (осиротевшая ссылка — projects.find(p => p.id ===
// activeProjectId) возвращал undefined, подтверждено пользователем через
// консоль браузера). Точный триггер (подозрение — гонка вокруг облачной
// синхронизации cloud.loadActiveProjectEntry/hydrateProject) не пойман, но
// симптом воспроизводим напрямую: 2D-план (плоское зеркало floorPlan)
// продолжал работать и показывать нарисованное, а 3D (читает state.levels)
// показывал "нечего показывать" — потому что applyFloorPlanToProjects
// раньше в этой ситуации молча пропускал запись в levels[] навсегда, пока
// пользователь не создавал новый проект вручную.
//
// Этот тест эмулирует рассинхронизацию напрямую через setState (тем самым,
// какая бы гонка её ни вызвала — в реальности) и проверяет, что стор
// САМОЛЕЧИТСЯ на следующее же действие, а не остаётся тихо сломанным.
import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from '../useProjectStore'

describe('самолечение осиротевшего activeProjectId', () => {
  beforeEach(() => {
    useProjectStore.setState({ projects: [], activeProjectId: null }, false)
  })

  it('applyFloorPlanToProjects (через addSlab) лечит activeProjectId и снова пишет в levels[]', () => {
    useProjectStore.getState().createProject('Объект A')
    const realProjectId = useProjectStore.getState().activeProjectId
    expect(realProjectId).toBeTruthy()

    // Эмулируем реальный симптом: activeProjectId указывает в никуда, хотя
    // projects[] по-прежнему содержит настоящий проект.
    useProjectStore.setState({ activeProjectId: 'osirotevshiy-id-kotorogo-net' }, false)

    // Пользователь рисует плиту — это идёт через updateActiveFloorPlan →
    // applyFloorPlanToProjects (то самое место, где раньше запись в
    // levels[] молча пропускалась).
    useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }, { x: 0, y: 300 }])

    const s = useProjectStore.getState()
    // activeProjectId исцелился — снова указывает на реальный проект
    // (первый доступный, раз осиротевший id ни на что не похож).
    expect(s.activeProjectId).toBe(realProjectId)
    // И, что критично для 3D: плита реально попала в levels[], а не только
    // в плоское зеркало floorPlan.
    expect(s.floorPlan.slabs.length).toBe(1)
    expect(s.levels[0]?.floorPlan.slabs.length).toBe(1)
  })

  it('syncActive (через addLevel) лечит activeProjectId', () => {
    useProjectStore.getState().createProject('Объект B')
    const realProjectId = useProjectStore.getState().activeProjectId

    useProjectStore.setState({ activeProjectId: 'ещё-один-осиротевший-id' }, false)
    useProjectStore.getState().addLevel('Этаж 2', 3000)

    const s = useProjectStore.getState()
    expect(s.activeProjectId).toBe(realProjectId)
    expect(s.levels.length).toBe(2) // "Этаж 1" (из createProject) + новый "Этаж 2"
  })

  it('если проектов вообще нет — не падает и просто ничего не лечит', () => {
    expect(() => {
      useProjectStore.setState({ activeProjectId: 'что-то' }, false)
      useProjectStore.getState().addSlab([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }])
    }).not.toThrow()
    expect(useProjectStore.getState().activeProjectId).toBeNull()
  })
})
