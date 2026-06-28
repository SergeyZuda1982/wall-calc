# wall-calc — конспект проекта (актуальный на cba4b32, 28.06.2026)

**Репо:** github.com/SergeyZuda1982/wall-calc
**Сайт:** https://sergeyzuda1982.github.io/wall-calc/
**Стек:** React + TypeScript + Vite + react-konva + Zustand + vitest
**Хостинг:** GitHub Pages (автодеплой через Actions при git push)
**GitHub token:** выдаётся пользователем в чат при необходимости пуша (срок ~30 дней)

⚠️ **ОБЯЗАТЕЛЬНОЕ ПРАВИЛО:** перед любой правкой — `git fetch origin && git reset --hard origin/main`. Последний известный коммит: **cba4b32**

---

## Концепция продукта

Визуализированный калькулятор — план как интерфейс, расчёт как цель.

Логика объекта:
1. Сначала периметр (wall_existing) → замыкается автоматически → создаётся Room
2. Пол и потолок — свойства помещения, площадь из Room.areaM2, автоматически
3. Облицовки на стенах периметра, перегородки внутри — только внутри Room
4. Шаблоны помещений (templateName в Room, для ЖК)

---

## Что сделано в этой сессии

### Визуал холста (2b6e522)
- DimLineShapes — размерная линия с засечками, только при hover/select
- Штриховка 45° для wall_existing через clipFunc
- Snap-точки только при наведении, зелёный курсор при snap

### selectedId / inspectorId (46753a8)
- selectedId — подсветка и drag на холсте
- inspectorId — правая панель только из таблицы или кнопки 👁

### Room — помещение (d0119d2, 788830c)
- Тип Room: lineIds, areaM2, perimeterMm, label, templateName?
- Автозамыкание: последняя точка снапается к chainStartPt → создаётся Room
- addPlanLine возвращает string (id) синхронно — chainLineIds без race conditions
- Рендер Room: заливка + имя + площадь + периметр по центру

### Зум и панорамирование (cba4b32)
- Колёсико мыши: zoom ×1.12/шаг, диапазон 0.1–20, к точке под курсором
- Space + ЛКМ или средняя кнопка: панорамирование
- stageScale/stagePos — только визуальный zoom, мировые координаты (px) не меняются
- scaleMmPerPx остаётся неизменным: lengthMm = dist_px × scaleMmPerPx
- Адаптивная сетка: только в видимой области, strokeWidth = 1/stageScale

### Ограничение черчения (cba4b32)
- pointInPolygon (ray casting) по полигону Room
- isPointAllowed: wall_existing — везде; wall_new/wall_lining — только внутри Room
- Если rooms.length = 0 — ограничений нет (нет периметра = свободно)

---

## СЛЕДУЮЩИЕ ЗАДАЧИ

1. **Таблица → Помещения** — показывать Room с площадью, внутри каждого список конструкций
2. **Привязка "Открыть полный расчёт"** — передача длины и конструкции из inspectorLine в калькулятор
3. **Пол/потолок из Room** — в инспекторе помещения выбрать тип пола/потолка, площадь автоматом
4. **Шаблоны помещений** — сохранить/загрузить Room как шаблон

---

## Архитектура зума

```
stageScale: number   (1 по умолчанию, 0.1–20)
stagePos: {x, y}    (смещение Stage в экранных px)

Перевод экран → мир:  worldX = (screenX - stagePos.x) / stageScale
Перевод мир → экран:  screenX = worldX * stageScale + stagePos.x

Zoom к курсору (handleWheel):
  mouseWorldX = (sp.x - stagePos.x) / oldScale
  newPos.x    = sp.x - mouseWorldX * newScale

Пан (Space+drag или СКМ+drag):
  panStartRef.current = {x, y, sx, sy}
  в handleMouseMove: stagePos = {sx + dx, sy + dy}
```

---

## Архитектура Room

```typescript
interface Room {
  id: string
  lineIds: string[]      // id линий периметра
  areaM2: number         // формула Гаусса
  perimeterMm: number
  label: string
  templateName?: string
}

// Замыкание:
// chainStartPt — первая точка (зелёный кружок)
// chainLineIds — синхронно: id = addPlanLine(...); setChainLineIds(prev=>[...prev,id])
// При snap к chainStartPt:
//   d >= 5 → добавить замыкающую линию, её id в allLineIds
//   d < 5  → allLineIds = chainLineIds (пользователь сам замкнул)
//   → setTimeout → Room из allLineIds
```

---

## Структура файлов

```
src/
  types/index.ts             — PlanLine, FloorPlan, PlanContour, PlanLineSpec, Room
  data/constructionTaxonomy.ts
  core/                      — 176 тестов (все зелёные)
  store/useProjectStore.ts   — addPlanLine → string (id)
  FloorPlan.tsx              — ~1580 строк
```

---

## Команды

```bash
git fetch origin && git reset --hard origin/main
npm run build   # без ошибок TS
npm test        # 176 тестов
git push        # нужен токен в remote URL
```
