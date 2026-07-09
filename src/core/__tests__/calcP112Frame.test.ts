import { describe, it, expect } from 'vitest'
import {
  calcFrameRowPositions,
  resolveHangerKind,
  resolveKnaufHangerStep,
  resolveFrameParams,
  calcP112FrameGeometry,
  CLOSE_GAP_MM,
  KNAUF_WALL_OFFSET_MM,
} from '../calcP112Frame'

describe('calcFrameRowPositions', () => {
  it('первый ряд на расстоянии одного шага от стены, не 0 и не пол-шага', () => {
    const positions = calcFrameRowPositions(2800, 900)
    expect(positions[0]).toBe(900)
  })

  it('регулярные ряды идут через шаг, пока зазор до стены не станет большим', () => {
    // span=2800, step=900: 900,1800,2700 — зазор до стены 100мм (<=250), не двигаем
    const positions = calcFrameRowPositions(2800, 900)
    expect(positions).toEqual([900, 1800, 2700])
  })

  it('если естественный зазор до стены больше CLOSE_GAP_MM — последний ряд сдвигается ближе к стене', () => {
    // span=4000, step=900: регулярные 900,1800,2700,3600 — зазор до стены 400мм (>250) —
    // последний ряд подвигаем на 4000-250=3750, а не добавляем ещё один
    const positions = calcFrameRowPositions(4000, 900)
    expect(positions).toEqual([900, 1800, 2700, 3750])
    expect(4000 - positions[positions.length - 1]).toBe(CLOSE_GAP_MM)
  })

  it('если естественный остаток уже маленький — ряд не двигается', () => {
    const positions = calcFrameRowPositions(2800, 900)
    expect(positions[positions.length - 1]).toBe(2700) // зазор 100мм, в пределах нормы
  })

  it('пустой пролёт или нулевой шаг -> пустой массив', () => {
    expect(calcFrameRowPositions(0, 900)).toEqual([])
    expect(calcFrameRowPositions(4000, 0)).toEqual([])
  })

  it('маленькое помещение (меньше шага) — либо один закрывающий ряд, либо пусто', () => {
    const positions = calcFrameRowPositions(500, 900)
    expect(positions.length).toBeLessThanOrEqual(1)
  })

  it('явный wallOffsetMm работает и в mode=user (не только в knauf) — регресс-тест', () => {
    const withOffset = calcFrameRowPositions(4000, 600, { mode: 'user', wallOffsetMm: 100 })
    const withoutOffset = calcFrameRowPositions(4000, 600, { mode: 'user' })
    expect(withOffset[0]).toBe(100)
    expect(withoutOffset[0]).toBe(600)
    expect(withOffset).not.toEqual(withoutOffset)
  })

  describe('mode=knauf', () => {
    it('по умолчанию (без wallOffsetMm) первый ряд тоже на расстоянии одного шага — совпадает с user на старте', () => {
      const positions = calcFrameRowPositions(2800, 900, { mode: 'knauf' })
      expect(positions[0]).toBe(900)
    })

    it('с явным wallOffsetMm (несущий профиль, 100мм) — старт НЕ равен шагу', () => {
      // span=2800, step=500, offset=100: 100,600,1100,1600,2100,2600
      const positions = calcFrameRowPositions(2800, 500, { mode: 'knauf', wallOffsetMm: KNAUF_WALL_OFFSET_MM })
      expect(positions).toEqual([100, 600, 1100, 1600, 2100, 2600])
    })

    it('НЕ сжимает последний ряд — просто оставляет естественный остаток у стены как есть', () => {
      // span=4000, step=900: user подвигает последний ряд на 4000-250=3750 (сжатие),
      // knauf оставляет обычную сетку 900/1800/2700/3600 (остаток 400мм у стены — это ОК)
      const userPositions = calcFrameRowPositions(4000, 900, { mode: 'user' })
      const knaufPositions = calcFrameRowPositions(4000, 900, { mode: 'knauf' })
      expect(userPositions).toEqual([900, 1800, 2700, 3750])
      expect(knaufPositions).toEqual([900, 1800, 2700, 3600])
      expect(4000 - knaufPositions[knaufPositions.length - 1]).toBe(400)
    })

    it('расстояние между соседними рядами никогда не превышает номинальный шаг', () => {
      const positions = calcFrameRowPositions(5137, 600, { mode: 'knauf' })
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i] - positions[i - 1]).toBe(600)
      }
    })
  })
})

describe('resolveHangerKind', () => {
  it('≤100мм — обычный прямой подвес', () => {
    expect(resolveHangerKind(50).kind).toBe('direct')
    expect(resolveHangerKind(100).kind).toBe('direct')
  })
  it('100-200мм — удлинённый прямой подвес', () => {
    expect(resolveHangerKind(150).kind).toBe('direct_extended')
    expect(resolveHangerKind(200).kind).toBe('direct_extended')
  })
  it('200-500мм — тяга 500мм', () => {
    expect(resolveHangerKind(300).kind).toBe('rod_500')
    expect(resolveHangerKind(500).kind).toBe('rod_500')
  })
  it('500-1000мм — тяга 1000мм', () => {
    expect(resolveHangerKind(700).kind).toBe('rod_1000')
    expect(resolveHangerKind(1000).kind).toBe('rod_1000')
  })
  it('>1000мм — тяга 1000мм с предупреждением', () => {
    const r = resolveHangerKind(1200)
    expect(r.kind).toBe('rod_1000')
    expect(r.warning).toBeDefined()
  })
})

describe('calcP112FrameGeometry', () => {
  it('считает раздельно несущий/основной каркас и соединители по пересечениям', () => {
    const geo = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true)
    // bearingAlongLength=true: A=roomLength=4000 (длина профиля), B=roomWidth=3000 (шаг поперёк)
    expect(geo.bearingLengthEachMm).toBe(4000)
    expect(geo.mainLengthEachMm).toBe(3000)
    expect(geo.connectorsTotal).toBe(geo.bearingCount * geo.mainCount)
  })

  it('разворот каркаса (bearingAlongLength=false) меняет местами A/B', () => {
    const geoA = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true)
    const geoB = calcP112FrameGeometry(4000, 3000, 600, 900, 50, false)
    expect(geoB.bearingLengthEachMm).toBe(3000)
    expect(geoB.mainLengthEachMm).toBe(4000)
    expect(geoA.bearingLengthEachMm).not.toBe(geoB.bearingLengthEachMm)
  })

  it('удлинитель нужен только если длина профиля превышает стандартный бар (3000мм)', () => {
    const short = calcP112FrameGeometry(2900, 2900, 600, 900, 50, true)
    expect(short.bearingExtenders).toBe(0)
    expect(short.mainExtenders).toBe(0)

    const long = calcP112FrameGeometry(6500, 3000, 600, 900, 50, true)
    // несущий профиль длиной 6500мм требует 1 удлинитель на профиль (ceil(6500/3000)-1=2)
    expect(long.bearingExtenders).toBe(long.bearingCount * 2)
  })

  it('подвесы: hangersTotal = bearingCount * hangersPerBearing', () => {
    const geo = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true)
    expect(geo.hangersTotal).toBe(geo.bearingCount * geo.hangersPerBearing)
  })

  it('тип подвеса прокидывается из slabGapMm', () => {
    const geo = calcP112FrameGeometry(4000, 3000, 600, 900, 700, true)
    expect(geo.hangerKind).toBe('rod_1000')
  })

  describe('layoutMode', () => {
    it('по умолчанию (не передан) — совпадает со старым поведением (user)', () => {
      const withDefault = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true)
      const withUser = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true, 'user')
      expect(withDefault).toEqual(withUser)
    })

    it('knauf даёт несущему профилю фиксированный отступ 100мм от стены, а не отступ=шагу', () => {
      // B=3000 (шаг несущего поперёк), stepB=500 -> knauf: 100,600,1100,1600,2100,2600 (6 рядов)
      // user: 500,1000,1500,2000,2500(зазор500>250->сдвиг)=2750 (5 рядов, обычная формула)
      const geoKnauf = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'knauf')
      const geoUser = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'user')
      expect(geoKnauf.bearingCount).toBe(6)
      expect(geoKnauf.bearingCount).not.toBe(geoUser.bearingCount)
    })

    it('соединители по-прежнему считаются как bearingCount × mainCount в обоих режимах', () => {
      const geo = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'knauf')
      expect(geo.connectorsTotal).toBe(geo.bearingCount * geo.mainCount)
    })

    it('knauf применяет отступ ≤100мм и к ОСНОВНОМУ профилю тоже (не только к несущему)', () => {
      // A=4000, stepC=600 -> knauf: 100,700,1300,1900,2500,3100,3700 (7 рядов)
      // user (отступ=шагу): 600,1200,1800,2400,3000,3600(зазор400<=250? нет,>250->сдвиг)=3750 (6 рядов)
      const geoKnauf = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'knauf')
      const geoUser = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'user')
      expect(geoKnauf.mainCount).toBe(7)
      expect(geoKnauf.mainCount).not.toBe(geoUser.mainCount)
    })

    it('extra.stepA переопределяет шаг подвесов НЕЗАВИСИМО от stepB', () => {
      const withoutStepA = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true, 'user')
      const withStepA = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true, 'user', { stepA: 1200 })
      expect(withStepA.hangersPerBearing).not.toBe(withoutStepA.hangersPerBearing)
    })

    it('extra.wallOffsetMainMm/wallOffsetBearingMm можно переопределить явно поверх layoutMode', () => {
      const geo = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'user', {
        wallOffsetMainMm: KNAUF_WALL_OFFSET_MM, wallOffsetBearingMm: KNAUF_WALL_OFFSET_MM,
      })
      // 'user' обычно не сжимает отступ до 100мм — с явным extra это происходит и в user-режиме
      const plainUser = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'user')
      expect(geo.mainCount).not.toBe(plainUser.mainCount)
    })
  })
})

describe('resolveKnaufHangerStep', () => {
  it('точная комбинация из таблицы — возвращает табличное значение без предупреждения', () => {
    const r = resolveKnaufHangerStep(800, 'crosswise', 0.15)
    expect(r.stepAMm).toBe(1050)
    expect(r.warning).toBeUndefined()
  })

  it('другая нагрузка/шаг — другое табличное значение', () => {
    expect(resolveKnaufHangerStep(1000, 'crosswise', 0.30).stepAMm).toBe(750)
    expect(resolveKnaufHangerStep(1200, 'crosswise', 0.15).stepAMm).toBe(900)
  })

  it('продольный монтаж — фиксированный шаг 650мм только при нагрузке 0.50', () => {
    expect(resolveKnaufHangerStep(1000, 'lengthwise', 0.50).stepAMm).toBe(650)
  })

  it('запрещённая комбинация (прочерк в таблице) — берёт наименьший доступный шаг и предупреждает', () => {
    // c=1200, поперечный, нагрузка 0.40 -> прочерк в таблице
    const r = resolveKnaufHangerStep(1200, 'crosswise', 0.40)
    expect(r.stepAMm).toBe(700) // наименьший доступный в этой строке (900,700)
    expect(r.warning).toBeDefined()
  })

  it('продольный монтаж при лёгкой нагрузке (0.15) — тоже запрещённая комбинация, есть предупреждение', () => {
    const r = resolveKnaufHangerStep(800, 'lengthwise', 0.15)
    expect(r.stepAMm).toBe(650) // единственное доступное значение в строке
    expect(r.warning).toBeDefined()
  })

  it('шаг c вне таблицы (500/600/700) — грубый запасной вариант с предупреждением', () => {
    const r = resolveKnaufHangerStep(600, 'crosswise', 0.15)
    expect(r.stepAMm).toBe(600)
    expect(r.warning).toBeDefined()
  })
})

describe('resolveFrameParams', () => {
  it("mode='user' без userStepB — берёт дефолт из старой таблицы P112_HANGER_STEP, stepA = stepB", () => {
    const r = resolveFrameParams({ stepC: 600, layoutMode: 'user' })
    expect(r.stepA).toBe(r.stepB)
    expect(r.wallOffsetMainMm).toBeUndefined()
    expect(r.wallOffsetBearingMm).toBeUndefined()
  })

  it("mode='user' с userStepB — переопределяет дефолт, stepA всё равно = stepB", () => {
    const r = resolveFrameParams({ stepC: 600, layoutMode: 'user', userStepB: 1234 })
    expect(r.stepB).toBe(1234)
    expect(r.stepA).toBe(1234)
  })

  it("mode='knauf' поперечный монтаж — stepB=500, stepA из таблицы, отступ ≤100мм для обоих", () => {
    const r = resolveFrameParams({ stepC: 800, layoutMode: 'knauf', mountDirection: 'crosswise', loadClass: 0.15 })
    expect(r.stepB).toBe(500)
    expect(r.stepA).toBe(1050)
    expect(r.wallOffsetMainMm).toBe(KNAUF_WALL_OFFSET_MM)
    expect(r.wallOffsetBearingMm).toBe(KNAUF_WALL_OFFSET_MM)
    expect(r.warning).toBeUndefined()
  })

  it("mode='knauf' продольный монтаж — stepB=400", () => {
    const r = resolveFrameParams({ stepC: 800, layoutMode: 'knauf', mountDirection: 'lengthwise', loadClass: 0.50 })
    expect(r.stepB).toBe(400)
    expect(r.stepA).toBe(650)
  })

  it("mode='knauf' без mountDirection/loadClass — дефолт поперечный + 0.15", () => {
    const r = resolveFrameParams({ stepC: 1000, layoutMode: 'knauf' })
    expect(r.stepB).toBe(500)
    expect(r.stepA).toBe(950)
  })

  it("mode='knauf' с запрещённой комбинацией — предупреждение прокидывается наружу", () => {
    const r = resolveFrameParams({ stepC: 1200, layoutMode: 'knauf', mountDirection: 'crosswise', loadClass: 0.40 })
    expect(r.warning).toBeDefined()
  })
})
