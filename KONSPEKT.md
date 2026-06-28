# wall-calc — конспект проекта (актуальный на 788830c, 28.06.2026)

**Репо:** github.com/SergeyZuda1982/wall-calc
**Сайт:** https://sergeyzuda1982.github.io/wall-calc/
**Стек:** React + TypeScript + Vite + react-konva + Zustand + vitest
**Хостинг:** GitHub Pages (автодеплой через Actions при git push)
**GitHub token:** выдаётся пользователем в чат при необходимости пуша (срок ~30 дней)

⚠️ **ОБЯЗАТЕЛЬНОЕ ПРАВИЛО:** перед любой правкой — `git fetch origin && git reset --hard origin/main`. Последний известный коммит: **788830c**

---

## Концепция продукта (важно!)

Визуализированный калькулятор — план как интерфейс, расчёт как цель.

Правильная логика объекта:
- Сначала периметр (wall_existing) → потом всё внутри
- Пол и потолок — свойства помещения (не отдельные линии), площадь автоматом
- После создания периметра — черчение только внутри него
- Шаблоны помещений (для ЖК с типовыми квартирами)

---

## Что сделано в этой сессии

### Визуал холста (2b6e522)
- DimLineShapes — размерная линия с засечками, только при hover/select
- Штриховка 45° для wall_existing через clipFunc + calcHatch
- Snap-точки только при наведении, зелёный курсор при snap

### selectedId / inspectorId (46753a8)
- selectedId — подсветка и drag на холсте
- inspectorId — правая панель только из таблицы или кнопки

### Room — помещение (d0119d2, 788830c)
- Тип Room: lineIds, areaM2, perimeterMm, label, templateName?
- FloorPlan.rooms[] в store + addRoom/removeRoom/updateRoom
- Автозамыкание: последняя точка → chainStartPt → Room создаётся
- addPlanLine возвращает string (id) синхронно — без race conditions
- chainLineIds накапливается синхронно
- Рендер Room: заливка + имя + площадь + периметр

---

## СЛЕДУЮЩИЕ ЗАДАЧИ

1. Ограничение черчения внутри периметра (ray casting)
2. Таблица → показывать помещения, внутри каждого — конструкции
3. Привязка кнопки "Открыть полный расчёт" → передача длины и конструкции
4. Шаблоны помещений

---

## Структура файлов

```
src/
  types/index.ts             — PlanLine, FloorPlan, PlanContour, PlanLineSpec, Room
  data/constructionTaxonomy.ts
  core/                      — расчёты (169 тестов, все зелёные)
  components/
    ConstructionSpecSelector.tsx
    BoardSpecSelector.tsx
    SheetLayoutCanvas.tsx
  store/useProjectStore.ts   — addPlanLine → string (id)
  FloorPlan.tsx              — ~1480 строк, главный файл
```

---

## Логика замыкания периметра

```
chainStartPt — первая точка цепочки (зелёный кружок)
chainLineIds — синхронно: id = addPlanLine(...); setChainLineIds(prev=>[...prev,id])

Замыкание (клик близко к chainStartPt):
  d >= 5 → добавить замыкающую линию, её id добавить в allLineIds
  d < 5  → не добавлять (пользователь сам дошёл до начала)
  → создать Room из allLineIds (setTimeout для store update)
  → сбросить drawing/chainStartPt/chainLineIds
```

---

## Команды

```bash
git fetch origin && git reset --hard origin/main
npm run build   # без ошибок TS
npm test        # 169 тестов
git push        # нужен токен в remote URL
```
