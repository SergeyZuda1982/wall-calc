/**
 * Данные по подвесным потолкам КНАУФ
 * Источник: серия 1.045.9-2.08.1, таблицы 13, 16, 17, 18
 */

// ─── Типы ────────────────────────────────────────────────────────────────────

export type CeilingType = 'p112' | 'p113' | 'p131' | 'p19'
export type CeilingLayers = 1 | 2
export type CeilingMaterial = 'gsp' | 'gvl'
export type CeilingSheetThickness = 9.5 | 12.5

/** Шаг основных профилей c (мм) */
export type CeilingStep = 500 | 600 | 700 | 800 | 1000 | 1200

/** Нагрузка — по умолчанию лёгкая */
export type CeilingLoad = 'light' | 'medium' | 'heavy'

export interface CeilingSpec {
  type: CeilingType
  layers: CeilingLayers
  material: CeilingMaterial
  thickness: CeilingSheetThickness
  /** Шаг основных профилей c, мм */
  stepC: CeilingStep
  /** Площадь потолка, м² */
  areaSqm: number
  /** Периметр помещения, м (для ПНП/ПН по стенам) */
  perimeterM: number
  /**
   * НОВОЕ (сессия 05.07.2026, точный расчёт П112, см. calcP112Frame.ts):
   * Расстояние от плиты перекрытия до чернового (несущего) каркаса, мм.
   * Определяет тип подвеса (прямой/удлинённый/тяга 500 или 1000мм).
   * Без этого поля П112 считается по старому усреднённому расходу (fallback).
   */
  slabGapMm?: number
  /**
   * Шаг несущего (верхнего) профиля b, мм — переопределение вручную.
   * Не задан → дефолт из P112_HANGER_STEP[stepC] (та же таблица, что и для
   * шага подвесов — на объекте это одно и то же расстояние, см. КОНСПЕКТ.md).
   */
  stepB?: number
  /**
   * Несущий профиль идёт вдоль длины помещения (true) или вдоль ширины
   * (false). Нельзя определить автоматически — монтажник сам решает,
   * от какой стены отталкиваться.
   */
  bearingAlongLength?: boolean
  /**
   * НОВОЕ (09.07.2026): вариант раскладки рядов каркаса — 'user' (реальная
   * практика монтажника, была единственным режимом раньше, default) или
   * 'knauf' (строго по официальной сетке КНАУФ, см. calcP112Frame.ts).
   * Не задан → 'user', обратная совместимость.
   */
  layoutMode?: 'user' | 'knauf'
  /**
   * Направление монтажа КНАУФ-листов — определяет шаг несущего профиля b
   * (500 поперечно / 400 продольно). Используется ТОЛЬКО в layoutMode='knauf'
   * (в 'user' шаг несущего берётся из stepB/старой таблицы, как раньше).
   * Не задан → 'crosswise' (500мм, самый частый случай).
   */
  mountDirection?: CeilingMountDirection
  /**
   * Класс нагрузки на подвесы, кН/м² — определяет шаг подвесов a по
   * официальной таблице. Используется ТОЛЬКО в layoutMode='knauf'.
   * Не задан → 0.15 (обычный жилой объект без тяжёлых навесов).
   */
  loadClass?: CeilingLoadClass
}

// ─── Расход материалов на 1 м² ───────────────────────────────────────────────

/** Расход каркаса и крепежа на 1 м² (из таблиц Кнауф) */
export interface CeilingFrameRates {
  /** ПП 60×27, пог.м */
  pp6027_lm: number
  /** ПН 28×27 (только П113), пог.м — по периметру */
  pn2827_perimeter: boolean
  /** Соединитель двухуровневый (П112), шт */
  connector2lvl?: number
  /** Соединитель одноуровневый (П113), шт */
  connector1lvl?: number
  /** Удлинитель ПП 60×27, шт */
  extender_pp: number
  /** Прямой подвес, шт */
  hanger_direct: number
  /** Шуруп LN (крепление ПП в подвесе), шт */
  screw_ln: number
  /** Дюбель анкерный, шт */
  dowel: number
}

/** Расход обшивки и финишных материалов на 1 м² */
export interface CeilingSheetRates {
  /** ГСП/ГВЛ, м² (1.0 = 1 слой, 2.0 = 2 слоя) */
  sheet_m2: number
  /** Шуруп TN/MN 25мм (1й слой), шт */
  screw_25: number
  /** Шуруп TN/MN 35мм (2й слой), шт — 0 если 1 слой */
  screw_35: number
  /** Шпаклёвка для стыков, кг */
  putty_kg: number
  /** Лента армирующая, пог.м */
  tape_lm: number
  /** Грунтовка, кг */
  primer_kg: number
}

// ─── П112: металлический каркас двухуровневый, ПП 60×27 ─────────────────────
// Таблица 16

export const P112_FRAME_RATES: CeilingFrameRates = {
  pp6027_lm: 3.2,
  pn2827_perimeter: false,
  connector2lvl: 2.3,
  extender_pp: 0.6,
  hanger_direct: 1.3,
  screw_ln: 2.6,
  dowel: 1.3,
}

export const P112_SHEET_RATES: Record<CeilingLayers, CeilingSheetRates> = {
  1: {
    sheet_m2: 1.0,
    screw_25: 17,
    screw_35: 0,
    putty_kg: 0.4,
    tape_lm: 1.2,
    primer_kg: 0.1,
  },
  2: {
    sheet_m2: 2.0,
    screw_25: 9,
    screw_35: 17,
    putty_kg: 0.6,
    tape_lm: 1.2,
    primer_kg: 0.1,
  },
}

// ─── П113: металлический каркас одноуровневый, ПП 60×27 + ПН 28×27 ──────────
// Таблица 17

export const P113_FRAME_RATES: CeilingFrameRates = {
  pp6027_lm: 2.9,
  pn2827_perimeter: true,     // ПН 28×27 идёт по периметру
  connector1lvl: 1.7,
  extender_pp: 0.2,
  hanger_direct: 0.7,
  screw_ln: 1.4,
  dowel: 0.7,
}

export const P113_SHEET_RATES: Record<CeilingLayers, CeilingSheetRates> = {
  1: {
    sheet_m2: 1.0,
    screw_25: 23,
    screw_35: 0,
    putty_kg: 0.4,
    tape_lm: 1.2,
    primer_kg: 0.1,
  },
  2: {
    sheet_m2: 2.0,
    screw_25: 9,
    screw_35: 23,
    putty_kg: 0.6,
    tape_lm: 1.2,
    primer_kg: 0.1,
  },
}

// ─── П131: каркас из перегородочных профилей ПС/ПН без подвесов ──────────────
// Таблица 18

export const P131_FRAME_RATES: CeilingFrameRates = {
  pp6027_lm: 0,               // нет ПП профилей
  pn2827_perimeter: false,
  extender_pp: 0,
  hanger_direct: 0,           // нет подвесов
  screw_ln: 0,
  dowel: 0,
}

/** Расход специфичных материалов П131 на 1 м² */
export interface P131SpecialRates {
  /** ПН 50(75,100)/40, пог.м */
  pn_profile_lm: number
  /** Лента уплотнительная, пог.м */
  seal_tape_lm: number
  /** Шуруп 4.3×35 с прессшайбой (крепление ПН к конструкциям из ГСП), шт */
  screw_pn_gsp: number
  /** Дюбель анкерный (крепление ПН к кирпичу/бетону), шт */
  dowel_pn: number
  /** ПС профиль (несущий), пог.м на м² */
  ps_profile_lm: number
  /** Шуруп LB (скрепление ПС и ПН), шт */
  screw_lb: number
}

export const P131_SPECIAL_RATES: Record<CeilingLayers, P131SpecialRates> = {
  1: {
    pn_profile_lm: 0.8,
    seal_tape_lm: 0.8,
    screw_pn_gsp: 2.7,
    dowel_pn: 2.8,
    ps_profile_lm: 1.9,
    screw_lb: 1.7,
  },
  2: {
    pn_profile_lm: 0.8,
    seal_tape_lm: 0.8,
    screw_pn_gsp: 2.7,
    dowel_pn: 2.8,
    ps_profile_lm: 3.8,   // спаренный ПС
    screw_lb: 3.2,
  },
}

export const P131_SHEET_RATES: Record<CeilingLayers, CeilingSheetRates> = {
  1: {
    sheet_m2: 1.0,
    screw_25: 19,
    screw_35: 0,
    putty_kg: 0.2,
    tape_lm: 0.35,
    primer_kg: 0.1,
  },
  2: {
    sheet_m2: 2.0,
    screw_25: 14,
    screw_35: 19,
    putty_kg: 0.4,
    tape_lm: 0.35,
    primer_kg: 0.1,
  },
}

// ─── Межосевые расстояния подвесов -а- (мм) ──────────────────────────────────
// Таблица 13, нагрузка ≤ 0.15 кН/м² (по умолчанию)

/** Шаг подвесов для П112 при нагрузке ≤0.15 кН/м² */
export const P112_HANGER_STEP: Partial<Record<CeilingStep, number>> = {
  500: 1200,
  600: 1150,
  700: 1100,
  800: 1050,
  1000: 950,
  1200: 900,
}

/** Шаг подвесов для П113 при нагрузке ≤0.15 кН/м² */
export const P113_HANGER_STEP: Partial<Record<CeilingStep, number>> = {
  800: 1050,
  1000: 950,
  1200: 900,
}

// ─── Официальная таблица КНАУФ "Межосевые расстояния при устройстве каркаса" ─
// Источник: серия 1.045.9-2.08.1-4, лист 40 из 76 (прислан пользователем
// 09.07.2026, фото официального документа). Три РАЗНЫЕ величины, ранее в
// коде путались местами:
//   c (шаг ОСНОВНОГО профиля)  — 800/1000/1200мм, выбирает пользователь
//   b (шаг НЕСУЩЕГО профиля)   — 500мм (поперечный монтаж ГСП/ГВЛ) ИЛИ
//                                 400мм (продольный монтаж) — НЕ свободный
//                                 выбор, жёстко зависит от направления
//                                 укладки листов на потолке
//   a (шаг ПОДВЕСОВ/дюбелей)   — зависит от c, направления монтажа (через
//                                 связанное с ним b) И класса нагрузки

/** Класс нагрузки на подвесы, кН/м² — из той же таблицы. */
export type CeilingLoadClass = 0.15 | 0.30 | 0.40 | 0.50
export const CEILING_LOAD_CLASS_OPTIONS: CeilingLoadClass[] = [0.15, 0.30, 0.40, 0.50]

/** Направление монтажа КНАУФ-листов на потолке — определяет фиксированный
 *  шаг несущего профиля b (см. таблицу), НЕ выбирается отдельно от него. */
export type CeilingMountDirection = 'crosswise' | 'lengthwise'
export const CEILING_MOUNT_DIRECTION_LABELS: Record<CeilingMountDirection, string> = {
  crosswise: 'Поперечно (b=500мм)',
  lengthwise: 'Продольно (b=400мм)',
}

/** Шаг несущего профиля b, мм — жёстко по направлению монтажа листов. */
export const KNAUF_BEARING_STEP_BY_MOUNT: Record<CeilingMountDirection, number> = {
  crosswise: 500,
  lengthwise: 400,
}

/**
 * Шаг подвесов a, мм, по официальной таблице. null = комбинация не
 * допускается (в оригинальной таблице на этом месте прочерк «-»).
 * Только для c ∈ {800,1000,1200} — таблица не покрывает 500/600/700
 * (это отдельные значения CeilingStep, применимые только к 'user'-режиму).
 */
export const KNAUF_HANGER_SPACING_TABLE: Record<
  CeilingMountDirection,
  Partial<Record<CeilingStep, Partial<Record<CeilingLoadClass, number | null>>>>
> = {
  crosswise: {
    800:  { 0.15: 1050, 0.30: 800, 0.40: 750, 0.50: null },
    1000: { 0.15: 950,  0.30: 750, 0.40: 700, 0.50: null },
    1200: { 0.15: 900,  0.30: 700, 0.40: null, 0.50: null },
  },
  lengthwise: {
    800:  { 0.15: null, 0.30: null, 0.40: null, 0.50: 650 },
    1000: { 0.15: null, 0.30: null, 0.40: null, 0.50: 650 },
    1200: { 0.15: null, 0.30: null, 0.40: null, 0.50: 650 },
  },
}

/**
 * Отступ от стены до первого/последнего ряда НЕСУЩЕГО профиля, мм — деталь
 * «А-А, Примыкание к стене видимым швом» (сессия 11.07.2026, фото
 * пользователя): «≤100» от стены до оси несущего профиля. Официально это
 * МАКСИМУМ (профиль можно ставить и ближе), для расчёта берём как есть —
 * самая частая практика (ставить максимально близко, насколько разрешено).
 *
 * ⚠️ ИСТОРИЯ ОШИБКИ (11.07.2026): раньше (09.07.2026) в коде было ОДНО
 * общее число ≤100мм, ошибочно применявшееся и к основному, и к несущему
 * профилю («выяснилось, что отступ применяется к ОБОИМ профилям» — эта
 * более ранняя запись была неверной). На деле у основного профиля другой
 * отступ и другая логика последнего ряда — см. KNAUF_WALL_OFFSET_MAIN_MM
 * и calcMainRowPositionsKnauf/calcBearingRowPositionsKnauf в
 * calcP112Frame.ts.
 */
export const KNAUF_WALL_OFFSET_BEARING_MM = 100

/**
 * Отступ от стены до первого/последнего ряда ОСНОВНОГО профиля, мм —
 * авторское правило пользователя (монтажник, реальная практика объекта,
 * сессия 11.07.2026), НЕ факсимиле чертежа КНАУФ (в отличие от
 * KNAUF_WALL_OFFSET_BEARING_MM выше, который взят прямо с фото
 * документа). В отличие от несущего профиля, у основного ПОСЛЕДНИЙ пролёт
 * может быть короче номинального шага c, чтобы вписаться в этот допуск —
 * см. calcMainRowPositionsKnauf в calcP112Frame.ts.
 */
export const KNAUF_WALL_OFFSET_MAIN_MM = 150

// ─── Метки типов ─────────────────────────────────────────────────────────────

export const CEILING_TYPE_LABELS: Record<CeilingType, string> = {
  p112: 'П112 — металлический каркас двухуровневый',
  p113: 'П113 — металлический каркас одноуровневый (низкие помещения)',
  p131: 'П131 — каркас из профилей перегородок (узкие помещения)',
  p19:  'П19 — многоуровневый / архитектурный (в разработке)',
}

export const CEILING_STEP_OPTIONS: CeilingStep[] = [500, 600, 700, 800, 1000, 1200]

// ─── Расширенный тип с размерами комнаты для раскроя ─────────────────────────

export interface CeilingSpecFull extends CeilingSpec {
  roomLengthMm: number
  roomWidthMm: number
  sheetLengthMm: number
}
