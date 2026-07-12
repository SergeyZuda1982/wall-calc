import { describe, it, expect } from 'vitest'
import {
  calcFrameRowPositions,
  snapHangerPositionsToAxis,
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

  it('подвесы: hangersTotal = mainCount * hangersPerMain', () => {
    const geo = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true)
    expect(geo.hangersTotal).toBe(geo.mainCount * geo.hangersPerMain)
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
      const withoutStepA = calcP112FrameGeometry(4000, 3000, 600, 300, 50, true, 'user')
      const withStepA = calcP112FrameGeometry(4000, 3000, 600, 300, 50, true, 'user', { stepA: 1200 })
      expect(withStepA.hangersPerMain).not.toBe(withoutStepA.hangersPerMain)
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
    // c=1200, поперечный, нагрузка 0.30 -> прочерк в таблице (единственное
    // доступное значение в строке — 900, при нагрузке 0.15)
    const r = resolveKnaufHangerStep(1200, 'crosswise', 0.30)
    expect(r.stepAMm).toBe(900)
    expect(r.warning).toBeDefined()
  })

  it('продольный монтаж при лёгкой нагрузке (0.15) — тоже запрещённая комбинация, есть предупреждение', () => {
    const r = resolveKnaufHangerStep(800, 'lengthwise', 0.15)
    expect(r.stepAMm).toBe(650) // единственное доступное значение в строке
    expect(r.warning).toBeDefined()
  })

  // 11.07.2026: c=500..1200 теперь ПОЛНОСТЬЮ покрыты официальной таблицей
  // для поперечного монтажа (сверено по фото документа) — это и есть
  // основной баг, который чинит эта сессия: раньше c=500/600/700/900/1100
  // ошибочно считались отсутствующими в таблице.
  it('c=600 (раньше ошибочно считался отсутствующим в таблице) — теперь есть точное значение, без предупреждения', () => {
    const r = resolveKnaufHangerStep(600, 'crosswise', 0.15)
    expect(r.stepAMm).toBe(1150)
    expect(r.warning).toBeUndefined()
  })

  it('весь диапазон c=500..1200 при нагрузке 0.15 (поперечный монтаж) — точные значения по таблице', () => {
    expect(resolveKnaufHangerStep(500, 'crosswise', 0.15).stepAMm).toBe(1200)
    expect(resolveKnaufHangerStep(700, 'crosswise', 0.15).stepAMm).toBe(1100)
    expect(resolveKnaufHangerStep(900, 'crosswise', 0.15).stepAMm).toBe(1000)
    expect(resolveKnaufHangerStep(1100, 'crosswise', 0.15).stepAMm).toBe(900)
  })

  it('c=900 при нагрузке 0.50 -> прочерк в таблице, берёт наименьший доступный (1000 при 0.15)', () => {
    const r = resolveKnaufHangerStep(900, 'crosswise', 0.50)
    expect(r.stepAMm).toBe(800) // доступны 1000(0.15) и 800(0.30) — наименьший 800
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
    const r = resolveFrameParams({ stepC: 1200, layoutMode: 'knauf', mountDirection: 'crosswise', loadClass: 0.30 })
    expect(r.warning).toBeDefined()
  })
})

describe('snapHangerPositionsToAxis', () => {
  it('пустой список позиций основного профиля -> пустой список подвесов', () => {
    expect(snapHangerPositionsToAxis([], 1150)).toEqual([])
  })

  it('одна позиция основного профиля -> один подвес именно на ней', () => {
    expect(snapHangerPositionsToAxis([600], 1150)).toEqual([600])
  })

  it('все подвесы — подмножество mainPositions (никогда не создаёт новых точек)', () => {
    const main = [700, 1300, 1900, 2500, 3100, 3850]
    const result = snapHangerPositionsToAxis(main, 1150)
    for (const p of result) expect(main).toContain(p)
  })

  it('всегда включает первую и последнюю позицию основного профиля', () => {
    const main = [700, 1300, 1900, 2500, 3100, 3850]
    const result = snapHangerPositionsToAxis(main, 1150)
    expect(result[0]).toBe(main[0])
    expect(result[result.length - 1]).toBe(main[main.length - 1])
  })

  it('реальный кейс из фото пользователя: c=600, a=1150 -> подвес на каждом основном профиле', () => {
    const main = [600, 1200, 1800, 2400, 3000, 3600]
    const result = snapHangerPositionsToAxis(main, 1150)
    expect(result).toEqual([600, 1200, 1800, 2400, 3000, 3600])
  })

  it('шаг основного профиля намного меньше a -> подвесы реже, но строго на позициях основного профиля', () => {
    const main = [300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000]
    const result = snapHangerPositionsToAxis(main, 1000)
    for (let i = 1; i < result.length; i++) {
      expect(result[i] - result[i - 1]).toBeLessThanOrEqual(1000)
    }
    for (const p of result) expect(main).toContain(p)
    expect(result[0]).toBe(300)
    expect(result[result.length - 1]).toBe(3000)
  })

  it('a меньше шага основного профиля -> берёт каждую позицию, не зависает', () => {
    const main = [800, 1600, 2400, 3200]
    const result = snapHangerPositionsToAxis(main, 100)
    expect(result).toEqual(main)
  })
})

describe('calcP112FrameGeometry — подвесы строго на оси, крепятся к основному профилю (12.07.2026, было наоборот)', () => {
  it('hangerPositions — подмножество bearingPositions, не независимая сетка', () => {
    const geo = calcP112FrameGeometry(4000, 4000, 600, 1150, 300, true, 'user')
    for (const hp of geo.hangerPositions) {
      expect(geo.bearingPositions).toContain(hp)
    }
  })

  it('реальный кейс (4000x4000, c=600, b=1150, user, stepA=stepB) — подвес на каждом несущем профиле', () => {
    const geo = calcP112FrameGeometry(4000, 4000, 600, 1150, 300, true, 'user', { stepA: 1150 })
    // stepA == stepB -> ни одну позицию несущего пропустить нельзя
    expect(geo.hangerPositions).toEqual(geo.bearingPositions)
    expect(geo.hangersPerMain).toBe(geo.bearingCount)
  })

  it('mainPositions/bearingPositions присутствуют и согласованы со счётчиками', () => {
    const geo = calcP112FrameGeometry(4000, 4000, 600, 1150, 300, true, 'user')
    expect(geo.mainPositions.length).toBe(geo.mainCount)
    expect(geo.bearingPositions.length).toBe(geo.bearingCount)
    expect(geo.hangerPositions.length).toBe(geo.hangersPerMain)
  })

  it('hangersTotal = hangersPerMain × mainCount', () => {
    const geo = calcP112FrameGeometry(5000, 3500, 1000, 500, 300, true, 'knauf', { stepA: 950, wallOffsetMainMm: 100, wallOffsetBearingMm: 100 })
    expect(geo.hangersTotal).toBe(geo.hangersPerMain * geo.mainCount)
  })
})

describe('resolveFrameParams — ceilingType (10.07.2026, поддержка П113)', () => {
  it("ceilingType не задан -> старое поведение (P112_HANGER_STEP)", () => {
    const r = resolveFrameParams({ stepC: 600, layoutMode: 'user' })
    expect(r.stepB).toBe(1150)
  })

  it("ceilingType='p112' явно -> тот же P112_HANGER_STEP", () => {
    const r = resolveFrameParams({ stepC: 600, layoutMode: 'user', ceilingType: 'p112' })
    expect(r.stepB).toBe(1150)
  })

  it("ceilingType='p113', c=800 -> значение П113, отличное от П112", () => {
    const r = resolveFrameParams({ stepC: 800, layoutMode: 'user', ceilingType: 'p113' })
    expect(r.stepB).toBe(1050)
  })

  it("ceilingType='p113', c=600 (нет в таблице П113) -> fallback 950, НЕ значение П112 (1150)", () => {
    const r = resolveFrameParams({ stepC: 600, layoutMode: 'user', ceilingType: 'p113' })
    expect(r.stepB).toBe(950)
    expect(r.stepB).not.toBe(1150)
  })

  it("ceilingType='p113' с userStepB — пользовательское значение в приоритете", () => {
    const r = resolveFrameParams({ stepC: 600, layoutMode: 'user', ceilingType: 'p113', userStepB: 777 })
    expect(r.stepB).toBe(777)
  })
})
