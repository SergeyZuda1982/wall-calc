# wall-calc — конспект проекта (актуальный на 1f93d4b, 29.06.2026)

**Репо:** github.com/SergeyZuda1982/wall-calc
**Сайт:** https://sergeyzuda1982.github.io/wall-calc/
**Стек:** React + TypeScript + Vite + react-konva + Zustand + vitest
**Хостинг:** GitHub Pages (автодеплой через Actions при git push)
**GitHub token:** выдаётся пользователем в чат при необходимости пуша (~30 дней)

⚠️ **ОБЯЗАТЕЛЬНОЕ ПРАВИЛО:** перед любой правкой — `git fetch origin && git reset --hard origin/main`.
Не доверяй конспектам из старых чатов на слово — сверяй с `git log -1` и реальными файлами.

⚠️ **Supabase не используем.** Авторизация по номеру телефона недоступна, данные должны храниться в РФ. Файлы Supabase в репо пока не трогаем, но логику на них не строим. Альтернатива (свой бэкенд / localStorage-first) — отдельная задача.

---

## Концепция продукта

**Визуализированный калькулятор** — главное отличие от аналогов.
Пользователь выбирает материал/конструкцию ДО рисования и сразу видит её на плане.
Не "нарисовал серую линию → потом настроил" — а "выбрал кирпич → рисуешь кирпич".

**Логика объекта:**
```
Объект
└── Помещение (замкнутый контур wall_existing)
    ├── Стены периметра (wall_existing) — кирпич/блок/монолит/остекление
    │   └── Облицовки (wall_lining) — привязаны к стене периметра
    ├── Перегородки (wall_new) — внутри периметра
    ├── Пол — свойство помещения, площадь = Room.areaM2 (автоматически)
    └── Потолок — свойство помещения, площадь = Room.areaM2 (автоматически)
```

**Ключевые принципы:**
- Сначала периметр → потом всё остальное внутри
- Пол и потолок — не линии, а свойства помещения
- Черчение только внутри Room (после создания периметра)
- Выбор материала до рисования → визуал сразу на холсте

---

## Что сделано в этом чате (коммиты 64ac473 → 1f93d4b)

### 1. Левая панель — дерево материалов (64ac473)
- `drawSpec: PlanLineSpec | null` — новое состояние, хранит материал+подтип выбранные ДО рисования
- `expandedMaterial: string | null` — аккордеон в левой панели
- Левая панель разбита на секции: Существующие стены / Перегородки / Облицовки / Потолки / Полы
- Материал без подтипов → клик = сразу draw mode
- Материал с подтипами → клик раскрывает список, клик по подтипу = draw mode
- `addPlanLine` везде получает `spec: drawSpec ?? undefined`
- Параллельная линия копирует `spec` от источника
- Preview-линия и курсор снапа используют цвет из `getLineVisual(drawType, drawSpec?.material, drawSpec?.subtype)`
- Убраны `LINE_LABELS`, `LINE_ICONS` (более не нужны)
- TAXONOMY экспортируется из `constructionTaxonomy.ts` для левой панели
- **179 тестов**

### 2. Управление рисованием — только ЛКМ, ПКМ = отмена (fbae0b6)
- `handleStageClick`: только `button === 0` (левая кнопка)
- После окончания линии `setDrawing(null)` — не автостарт следующей
- `handleStageContextMenu`: ПКМ сбрасывает `drawing` / `chainStartPt` / `chainLineIds`
- При новом клике в draw mode: если рядом с концом последней линии цепочки → продолжаем; иначе новая цепочка
- Замыкание комнаты (зелёный кружок) работает как раньше

### 3. Shift+клик на endpoint — переактивация линии (30bab14)
- В draw mode (когда `drawing === null`): Shift+ЛКМ рядом с концом линии
- Линия удаляется, рисование начинается от противоположного конца
- Удобно для: укоротить / удлинить / развернуть без переключения в select
- Обычный клик — без изменений (нет конфликта с чертежом)
- Порог снапа при проверке тоже `snapThresh` (экранные пиксели)

### 4. Толщины для wall_existing (ac756f7)
В `constructionTaxonomy.ts` добавлены подтипы с реальными мм:
- **Кирпич**: 120 / 250 / 380 / 510 / 640мм (½…2½ кирпича)
- **Блок / Газобетон**: 100 / 150 / 200 / 250 / 300 / 400мм (убран Ракушняк)
- **Монолит / Бетон**: 150 / 180 / 200 / 250 / 300мм
- **Тип неизвестен**: без подтипов → одиночная линия

`getWallThicknessMm` для `wall_existing`: `subtype → parseInt(subtype)`;
fallback для старых линий без подтипа: кирпич 250, остальное 200.

### 5. Минимальная длина линии (13426a0)
- Было: `d < 5px` → при масштабе 140мм/px минимум ~700мм
- Стало: `lengthMm < 10` → минимум 10мм при любом масштабе

### 6. Fix: stale closure stagePos/stageScale (5cd48e7)
`handleStageClick` и `handleMouseMove` захватывали `stagePos`/`stageScale`
из замыкания момента создания useCallback → после зума/пана координаты клика
считались неверно → начало линии ставилось не там.

**Исправление:** `stagePosRef` / `stageScaleRef` обновляются при каждом рендере,
`getPos` и обработчики движения читают через рефы — всегда актуально.

### 7. Fix: снап в экранных пикселях (1f93d4b)
- Было: `SNAP_PX = 18` мировых пикселей → при масштабе 38мм/px = 684мм радиус снапа
- Стало: `SNAP_SCREEN_PX = 18 / stageScale` мировых пикселей = всегда 18 экранных
- Исправлено везде: `applySnap`, `handleMove` (draw + drag end1/end2/line), `handleStageClick`
- `snapPoint` принимает опциональный `threshPx` параметр

---

## Архитектура данных (types/index.ts)

```typescript
interface PlanLineSpec {
  material: string   // 'gkl' | 'brick' | 'block' | 'concrete' | 'glass' | 'unknown'
  subtype?: string   // для wall_new: 'ps50'|'ps75'|'ps100'|...
                     // для wall_existing: '120'|'250'|'380'|... (мм числом)
}

interface PlanLine {
  id: string
  x1: number; y1: number; x2: number; y2: number  // мировые px
  type: PlanLineType   // 'wall_new' | 'wall_lining' | 'wall_existing' | 'ceiling' | 'floor'
  lengthMm: number
  label: string        // П-1, С-1 — автогенерация
  spec?: PlanLineSpec
  wallId?: string; liningId?: string
}

interface Room {
  id: string
  lineIds: string[]
  areaM2: number       // формула Гаусса
  perimeterMm: number
  label: string
  templateName?: string
}

interface FloorPlan {
  scaleMmPerPx: number
  lines: PlanLine[]
  contours: PlanContour[]
  rooms: Room[]
}
```

Толщина, цвет, штриховка — НЕ хранятся на линии, вычисляются резолверами:
- `getWallThicknessMm(type, material, subtype)` → мм
- `getLineVisual(type, material, subtype)` → `{ strokeWidth, dash, colorOverride, thicknessMm, fillColor }`
- `getSpecAbbr(type, material, subtype)` → "ГКЛ·ПС75"
- `TAXONOMY: Record<PlanLineType, TaxonomyNode[]>` — экспортируется для левой панели

---

## Зум: архитектура

```
stageScale: число (1 по умолчанию, 0.1–20)
stagePos: {x, y} — смещение Stage в экранных px
stagePosRef / stageScaleRef — рефы, всегда актуальны в колбэках

Мир → экран:  screenX = worldX * stageScale + stagePos.x
Экран → мир:  worldX = (screenX - stagePos.x) / stageScale

Snap порог:   SNAP_SCREEN_PX / stageScale  (всегда 18 экранных px)
```

---

## Управление на холсте

| Действие | Результат |
|---|---|
| ЛКМ (draw mode, drawing=null) | Начало линии |
| ЛКМ (draw mode, drawing≠null) | Конец линии, drawing=null |
| Shift+ЛКМ на endpoint | Удалить линию, начать от противоположного конца |
| ПКМ (draw mode) | Отмена текущего сегмента и цепочки |
| Space+ЛКМ / СКМ | Панорамирование |
| Колёсико | Зум к курсору |
| R | Режим стирания (erase) |

---

## Известные баги/долги

1. getStatus() — заглушка, всегда 'none'
2. Кнопка "Открыть полный расчёт" — пустой колбэк
3. Кнопки "Дублировать" (⧉) и "Меню" (⋮) — без обработчиков
4. Высота в таблице — хардкод 3000мм
5. Крайние стойки торчат за периметр на canvas
6. Размеры проёмов от центра до центра вместо внутренний край
7. Упаковки саморезов: TN/MN/XTN→1000, LN→500

---

## Следующие задачи (приоритет)

1. **Связать план с расчётным модулем** — перегородка/облицовка на плане → её данные в калькулятор (кнопка "Открыть полный расчёт")
2. **Закрыть баги**: высота 3000мм хардкод, крайние стойки за периметр
3. **localStorage-first** хранение (вместо Supabase) — проекты живут в браузере

---

## Структура файлов

```
src/
  types/index.ts
  data/
    constructionTaxonomy.ts  — TAXONOMY + резолверы (ключевой файл)
    profiles.ts, maxHeight.ts, liningMaxHeight.ts, ceilingData.ts
  core/                      — 179 тестов (все зелёные)
    calcResults.ts, calcLining.ts, calcCeiling.ts
    calcSheetLayout.ts, calcProjectSheetLayout.ts
    calcScrews.ts, calcStudMaterial.ts
  components/
    ConstructionSpecSelector.tsx
    BoardSpecSelector.tsx, SheetLayoutCanvas.tsx
    AuthModal.tsx, ProjectsPanel.tsx
  store/
    useProjectStore.ts   — addPlanLine → string (id)
    useAuthStore.ts, useProjectsStore.ts
  hooks/
    useWallCalc.ts, useContainerWidth.ts, useSupabaseSync.ts
  lib/supabase.ts          — не используем, не трогаем
  App.tsx, CeilingCalc.tsx, LiningCalc.tsx
  FloorPlan.tsx            — ~1620 строк, главный файл плана
```

---

## Команды

```bash
git fetch origin && git reset --hard origin/main
npm install
npm run build   # без ошибок TS
npm test        # 179 тестов
git push        # нужен токен в remote URL
```
