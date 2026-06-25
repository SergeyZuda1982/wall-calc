## wall-calc — конспект проекта (актуальный на 7c34b98, 25.06.2026)

**Репо:** github.com/SergeyZuda1982/wall-calc  
**Сайт:** https://sergeyzuda1982.github.io/wall-calc/  
**Стек:** React + TypeScript + Vite + react-konva + Zustand + vitest  
**Хостинг:** GitHub Pages (автодеплой через Actions при git push)  
**GitHub token:** выдаётся пользователем в чат при необходимости пуша (срок ~30 дней)

**Стиль работы:** код даётся полными файлами, Claude пушит сам через git.

⚠️ **ОБЯЗАТЕЛЬНОЕ ПРАВИЛО — синхронизация состояния:**  
Несколько чатов могут параллельно работать над одним репо. **Перед любой правкой кода — сначала `git fetch origin` / `git log origin/main -5`, сверить с локальной копией, при расхождении подтянуть актуальное (`git reset --hard origin/main`).** Не полагаться на код "из памяти" истории чата. Последний известный коммит: **`7c34b98`**.

---

### Структура файлов

```
src/
  types/index.ts               — ProfilePoint, EdgeProfile, ProfileTemplate,
                                  StudInfo, WallInput/LiningInput + layer1/layer2/plywoodInserts,
                                  BoardMaterial, BoardSpec, GklSubtype,
                                  DEFAULT_BOARD_SPEC, boardLabel(), migrateBoard(),
                                  PlywoodInsert, ScrewResult,
                                  BoardPiece, BoardColumn (+ jointYs: number[]),
                                  BoardOffcut, BoardLayerLayout, BoardSheetResult,
                                  BOARD_LABEL, screwCode()
  constants.ts                 — CANVAS_W=820, PAD=60
  data/profiles.ts, maxHeight.ts, liningMaxHeight.ts
  core/
    profileGeometry.ts         — interpolateY, studHeightAt, maxStudHeight,
                                  integrateHeight, normalizeProfile, flatProfile,
                                  profilePathLength
    buildPositions.ts          — attachStudHeights, buildFromPhase (возвращает { positions, phase })
    calcResults.ts             — принимает layer1/layer2/plywoodInserts → возвращает screws
    calcStudMaterial.ts        — длина стойки с нахлёстом (per-stud)
    calcScrews.ts              — calcScrews() — LN11/TN/MN/XTN/wood screws
    calcLining.ts              — переведён на ceilingProfile/floorProfile
    calcSheetLayout.ts         — раскрой листов ГСП (см. ниже)
    cutList.ts, calcProjectCutList.ts
  core/__tests__/              — 141 vitest тест
  components/
    ProfileEditor.tsx          — редактор профиля + шаблоны
    BoardSpecSelector.tsx      — каскадный селектор BoardSpec
    SheetLayoutCanvas.tsx      — canvas раскладки листов (БЕЗ встроенной статистики)
  hooks/
    useWallCalc.ts             — возвращает currentFirstStud, currentStep (актуальная фаза)
    useContainerWidth.ts
  store/useProjectStore.ts     — миграция layer1/layer2 string → BoardSpec
  App.tsx, LiningCalc.tsx
```

---

### Что реализовано (полная картина)

**BoardSpec** — полная спецификация листа:
```typescript
interface BoardSpec {
  material:    'gkl' | 'gvl' | 'sapphire' | 'aquamarine'
  subtype:     GklSubtype | null
  thickness:   number              // 9.5 | 10 | 12.5
  sheetWidth:  number              // 1200 (всегда)
  sheetLength: number              // 2500 | 2700 | 3000
}
```

**Раскрой листов ГСП — текущее состояние (calcSheetLayout.ts)**

Полностью реализован для перегородок. Для облицовок — **НЕ подключён** (следующая задача).

**Ключевые алгоритмы:**

*Горизонтальный разбег (п.8.16 Кнауф):*
- Схема 4 значений vOffset: `{0, SL/4, SL/2, 3*SL/4}` (для SL=2500: 0, 625, 1250, 1875мм)
- `vOffset = ((slot + (layer===2 ? 2 : 0) + sideIndex) % 4) * (SL/4)`
- `slot = sheetSlot(x1, firstW)` — номер листа по x-позиции колонки (не по индексу i!)
- Математически доказано: `|slot_L1 - slot_L2| ≤ 1`, поэтому минимальный разбег везде ≥ SL/4 = 625мм ≥ 400мм
- Реальный разбег может быть любым ≥400мм (норматив), наш алгоритм гарантирует ≥625мм

*Пул обрезков:*
- Один `sharedPool: PoolItem[]` на всю перегородку (4 экземпляра: Ст.А Сл.1 → Ст.А Сл.2 → Ст.Б Сл.1 → Ст.Б Сл.2)
- Порядок обработки обеспечивает максимальное переиспользование обрезков
- Финальные обрезки возвращаются как `finalOffcuts: BoardOffcut[]`

*Соглашение о pos в Opening:*
- `pos` = **левый край** проёма (не центр!)
- `oL = op.pos`, `oR = op.pos + op.width`

**BoardSheetResult:**
```typescript
interface BoardSheetResult {
  layer1: BoardLayerLayout         // Ст.А Сл.1
  layer2: BoardLayerLayout | null  // Ст.А Сл.2
  sideB_layer1: BoardLayerLayout | null  // Ст.Б Сл.1
  sideB_layer2: BoardLayerLayout | null  // Ст.Б Сл.2
  totalSheetsNeeded: number
  totalUsedAreaM2: number
  totalSheetAreaM2: number
  totalOffcutAreaM2: number
  totalWastePercent: number
  finalOffcuts: BoardOffcut[]      // финальный пул после всех 4 слоёв
}
```

**BoardColumn:**
```typescript
interface BoardColumn {
  x1: number; x2: number
  pieces: BoardPiece[]
  jointYs: number[]  // высоты горизонтальных стыков (мм от пола) — для canvas
}
```

**UI раскроя (App.tsx):**
- Вкладки: **Ст.А / Ст.Б** + **Слой 1 / Слой 2**
- Per-layer статистика: Листов / В работе / Куплено (без offcutAreaM2 — некорректно при shared pool)
- Синий блок "Перегородка (4 экз. × общий пул)": суммарные цифры
- **Панель остатков** (коллапсируемая, кнопка "🪚 Остатки: N шт, X.XX м²"):
  - Цветные прямоугольники пропорционально реальным размерам
  - Цвет по площади: зелёный ≥0.5м², бирюзовый ≥0.2м², синий ≥0.08м², оранжевый — меньше
  - Тултип с размерами и площадью
  - State: `showOffcuts` в App.tsx

**Синхронизация раскроя со сдвигом гребёнки:**
- `useWallCalc` возвращает `currentFirstStud` и `currentStep` (обновляются после shiftGrid)
- `calcSheetLayout` использует `currentFirstStud || form.firstStud`
- `useEffect` синхронизирует `form.firstStud` → при повторном «рассчитать» позиция сохраняется

**SheetLayoutCanvas.tsx:**
- Статистика УДАЛЕНА из компонента (находится в App.tsx)
- Рисует горизонтальные стыки per-column из `column.jointYs`

---

### Что реализовано ранее (стабильно)

**BoardSpec + BoardSpecSelector** — каскадные дропдауны  
**Переменная геометрия потолка/пола** — полностью для перегородки и облицовки  
**Длина направляющих ПН** — по реальной ломаной (`profilePathLength`)  
**Псевдо-3D отрисовка профилей**  
**Расчёт саморезов** — LN11/TN/MN/XTN/wood по Кнауф-правилам  
**Закладные из фанеры** — форма, canvas, саморезы по дереву  
**Утеплитель** — чекбокс  
**Мобильная версия** — useContainerWidth, touch-action

---

### Следующие задачи (приоритет)

**1. ПЕРВОЕ: Раскрой листов для облицовок (LiningCalc)**
- `calcSheetLayout` уже написан, нужно подключить в `LiningCalc.tsx`
- Облицовка — **одна сторона** (`sides=1`), `sideIndex=0`
- Параметры те же: wallL, wallH, firstStud, step, openings, layer1/layer2 spec
- Отличие от перегородки: нет Ст.Б вкладки, синий блок "Облицовка (2 слоя × общий пул)"
- Нужно добавить `currentFirstStud`/`currentStep` в `useLiningCalc` (если есть такой хук) или LiningCalc напрямую
- `showOffcuts` state — свой для LiningCalc

**2. Стыки листов на стойке рамы двери (п.8.16)**
- Норматив: стык ГКЛ НЕ должен приходиться на стойку дверной коробки
- Текущий код намеренно ставит границу колонки на `op.pos` и `op.pos+op.width`
- Нужно либо сдвигать границу, либо выводить предупреждение

**3. Минимальные свесы (Схема 4 Кнауф)**
- ≥150мм полоса листа рядом с проёмом
- ≥400мм над перемычкой (или лист на всю высоту если <400мм)
- ≥200мм минимальный кусок над углом проёма

**4. PDF-экспорт, монетизация/бэкенд**

---

### Известные нерешённые баги/долги

1. Раскрой листов для облицовки — не подключён
2. Крайние стойки (pos=0/pos=L) торчат за периметр на canvas
3. Размеры проёмов считаются от центра до центра вместо внутренний край-внутренний край
4. Упаковки саморезов: TN/MN/XTN→1000 шт, LN→500 шт
5. Вычет площади фанеры из ГКЛ если суммарная > 3м²
6. Тесты на calcScrews и calcSheetLayout
7. Pre-existing eslint: App.tsx `kind as any`, useWallCalc.ts ref-access, calcLining.ts

---

### Монтажные правила стоек (стабильно)

**wall:** торец в торец, без нахлёста  
**middle:** n-кусковая с нахлёстом, step=3000-overlap  
**free:** N основных + отдельный соединительный на каждый стык  
Нахлёст (Кнауф): ПС50→500, ПС75→750, ПС100→1000

---

### Команды

```bash
git fetch origin && git log origin/main -3   # ВСЕГДА перед правками
npm install                                   # при первом клоне
npm run dev                                   # локальный сервер
npm run build                                 # сборка (tsc -b && vite build)
npm test                                      # vitest — сейчас 141 тест
git push                                      # деплой через GitHub Actions
```

---

Копируй, открывай новый чат 😄
