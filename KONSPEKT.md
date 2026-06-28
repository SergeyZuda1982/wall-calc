# wall-calc — конспект проекта (актуальный на b51579b, 28.06.2026)

**Репо:** github.com/SergeyZuda1982/wall-calc
**Сайт:** https://sergeyzuda1982.github.io/wall-calc/
**Стек:** React + TypeScript + Vite + react-konva + Zustand + Supabase + vitest
**Хостинг:** GitHub Pages (автодеплой через Actions при git push)
**GitHub token:** выдаётся пользователем в чат при необходимости пуша (~30 дней)

⚠️ **ОБЯЗАТЕЛЬНОЕ ПРАВИЛО:** перед любой правкой — `git fetch origin && git reset --hard origin/main`.
Не доверяй конспектам из старых чатов на слово — сверяй с `git log -1` и реальными файлами.

---

## Концепция продукта

**Визуализированный калькулятор** — главное отличие от аналогов.
Пользователь выбирает материал/конструкцию ДО рисования и сразу видит её на плане.
Не "нарисовал серую линию → потом настроил" — а "выбрал кирпич → рисуешь кирпич".

**Логика объекта:**
```
Объект
└── Помещение (замкнутый контур wall_existing)
    ├── Стены периметра (wall_existing) — кирпич/блок/монолит/ГКЛ/остекление
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

## СЛЕДУЮЩАЯ ЗАДАЧА: материал до рисования + визуал

### Что меняем в левой панели

Сейчас: тип → потом материал в инспекторе справа.
Должно быть: выбрал материал = выбрал всё, сразу рисуешь с нужным визуалом.

**Структура левой панели:**
```
СУЩЕСТВУЮЩИЕ КОНСТРУКЦИИ
  🧱 Кирпич
  ⬜ Газоблок
  🔲 Монолит
  🪟 Остекление
  📋 ГКЛ (перегородка как существующая)

ПЕРЕГОРОДКИ
  ГКЛ · 600мм  ← шаг профиля выбран до рисования
  ГКЛ · 400мм
  ГКЛ · 300мм
  Пазогребень

ОБЛИЦОВКИ
  ГКЛ на профиле
  ГКЛ на клею
```

### Визуал материалов на холсте

**Кирпич** — двойная линия, штриховка кирпичным паттерном, красновато-коричневый
**Газоблок/пеноблок** — двойная линия, прямоугольные ячейки, серый
**Монолит** — толстая двойная линия, точечная штриховка, тёмно-серый
**ГКЛ (существующая)** — тонкая двойная линия, серый
**Остекление** — одиночная тонкая линия, голубой, без заливки

**Шаг профиля перегородки** (визуализируется внутри тела):
```
600мм:  ║    |    |    |    ║
400мм:  ║  |  |  |  |  |  ║
300мм:  ║ | | | | | | | | ║
```
Засечки рисуются в масштабе холста (scaleMmPerPx). Шаг сразу идёт в расчёт — не вводится повторно.

### Как это меняет код

- `drawType` сейчас = `PlanLineType`. Нужен `drawSpec: PlanLineSpec | null` — материал+подтип выбранные до рисования
- При `addPlanLine` сразу передаётся `spec: drawSpec`
- `getLineVisual` уже умеет рисовать по spec — ничего не ломается
- В левой панели: тип разворачивается в список материалов → выбор = `setDrawSpec`

---

## Что сделано (этот и предыдущий чаты)

### Трёхколоночный UI (до этого чата)
Левая панель (220px) + центр (холст + таблица) + правая панель (300px, инспектор).
Это уже реализовано и стабильно.

### Визуал холста (2b6e522)
- `DimLineShapes` — размерная линия с засечками, только при hover/select
- Штриховка 45° для wall_existing через clipFunc + calcHatch
- Snap-точки только при наведении, зелёный курсор при snap
- `selectedId` (холст) / `inspectorId` (правая панель) — разделены

### Room — автозамыкание периметра (d0119d2, 788830c)
- Тип Room: lineIds, areaM2, perimeterMm, label, templateName?
- chainStartPt (зелёный кружок) + chainLineIds (синхронно через addPlanLine→id)
- addPlanLine возвращает string (id) — нет race conditions с setTimeout
- Рендер Room: заливка + имя + площадь + периметр по центру

### Зум и панорамирование (cba4b32)
- Колёсико: zoom ×1.12/шаг, диапазон 0.1–20, к точке под курсором
- Space+ЛКМ или средняя кнопка: панорамирование
- stageScale/stagePos — визуальный zoom, мировые px и scaleMmPerPx не меняются
- Адаптивная сетка: только в видимой области, strokeWidth = 1/stageScale

### Ограничение черчения (cba4b32)
- pointInPolygon (ray casting)
- isPointAllowed: wall_existing — везде, остальное — только внутри Room

---

## Архитектура данных (types/index.ts)

```typescript
interface PlanLineSpec {
  material: string   // 'gkl' | 'brick' | 'gasblock' | 'concrete' | 'glass' | ...
  subtype?: string   // 'ps75' | '250' | 'step600' | ...
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
  templateName?: string  // шаблоны для ЖК
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

---

## Зум: архитектура

```
stageScale: число (1 по умолчанию, 0.1–20)
stagePos: {x, y} — смещение Stage в экранных px

Мир → экран:  screenX = worldX * stageScale + stagePos.x
Экран → мир:  worldX = (screenX - stagePos.x) / stageScale

Zoom к курсору:
  mouseWorldX = (sp.x - stagePos.x) / oldScale
  newPos.x = sp.x - mouseWorldX * newScale
```

---

## Прогресс-трекинг (концепция, реализация отложена)

Из обсуждения в другом чате — зафиксировано для проектирования:

- % выполнения считается автоматически по чек-листу этапов
- У каждого type+material свой набор этапов (progressStages.ts рядом с taxonomy)
- Роли пользователей с весами (рабочий < прораб < владелец) — кто выставил статус с большим весом, тот выигрывает при конфликте
- История изменений (кто, когда, этап, вес)
- Финишная отделка блокируется пока черновая не done
- Многопользовательность отложена, модель данных проектируем заранее
- getStatus() сейчас заглушка ('none'), UI статусов уже нарисован

```typescript
interface ConstructionProgress {
  lineId: string
  completedStageIds: string[]
  percent: number   // derived
  status: 'none' | 'in_progress' | 'done'   // derived
  lastChangedBy: { userId: string; roleWeight: number }
  history: ProgressHistoryEntry[]
}
```

---

## Текстуры материалов (концепция, частично)

- fillPatternImage в Konva — seamless растровые текстуры по полигону A→B→C→D
- fillPatternScale подгоняется под scaleMmPerPx (кирпичики реального размера)
- fillPatternRotation подгоняется под угол линии
- Источники CC0: Poly Haven (polyhaven.com), ambientCG (ambientcg.com)
- Для плана нужна текстура "в разрезе" (торец материала), не фасадная кладка
- Не сделано: выбрать текстуры, положить в src/assets/textures/, заменить fillColor → fillPatternImage

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

## Структура файлов

```
src/
  types/index.ts
  data/
    constructionTaxonomy.ts  — материалы + резолверы (ключевой файл)
    profiles.ts, maxHeight.ts, liningMaxHeight.ts, ceilingData.ts
  core/                      — 176 тестов (все зелёные)
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
  lib/supabase.ts
  App.tsx, CeilingCalc.tsx, LiningCalc.tsx
  FloorPlan.tsx            — ~1580 строк, главный файл плана
```

---

## Команды

```bash
git fetch origin && git reset --hard origin/main
npm install
npm run build   # без ошибок TS
npm test        # 176 тестов
git push        # нужен токен в remote URL
```
