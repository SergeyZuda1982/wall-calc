import { describe, it, expect } from 'vitest'
import {
  calcFrameRowPositions,
  calcMainRowPositionsKnauf,
  calcBearingRowPositionsKnauf,
  snapHangerPositionsToAxis,
  resolveHangerKind,
  resolveKnaufHangerStep,
  resolveFrameParams,
  calcP112FrameGeometry,
  CLOSE_GAP_MM,
  KNAUF_WALL_OFFSET_MAIN_MM,
  KNAUF_WALL_OFFSET_BEARING_MM,
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

  // 11.07.2026: 'knauf' режим ПОЛНОСТЬЮ пересмотрен по фото официального
  // документа (лист «А-А, примыкание к стене видимым швом») — правила
  // теперь РАЗНЫЕ для основного (profileKind='main', допуск 150мм) и
  // несущего (profileKind='bearing', допуск 100мм) профиля. См.
  // calcMainRowPositionsKnauf/calcBearingRowPositionsKnauf ниже — прямые
  // тесты на сами функции содержат более полное покрытие; здесь —
  // проверка, что calcFrameRowPositions(mode:'knauf') корректно
  // делегирует по profileKind (default = 'main', обратная совместимость).
  describe('mode=knauf', () => {
    it("profileKind не передан -> по умолчанию 'main' (обратная совместимость)", () => {
      const viaDispatch = calcFrameRowPositions(2800, 900, { mode: 'knauf' })
      const direct = calcMainRowPositionsKnauf(2800, 900)
      expect(viaDispatch).toEqual(direct)
    })

    it("profileKind='main' делегирует в calcMainRowPositionsKnauf", () => {
      const viaDispatch = calcFrameRowPositions(4150, 1000, { mode: 'knauf', profileKind: 'main' })
      const direct = calcMainRowPositionsKnauf(4150, 1000)
      expect(viaDispatch).toEqual(direct)
    })

    it("profileKind='bearing' делегирует в calcBearingRowPositionsKnauf", () => {
      const viaDispatch = calcFrameRowPositions(3000, 500, { mode: 'knauf', profileKind: 'bearing' })
      const direct = calcBearingRowPositionsKnauf(3000, 500)
      expect(viaDispatch).toEqual(direct)
    })

    it('явный wallOffsetMm переопределяет дефолтный отступ по profileKind', () => {
      const positions = calcFrameRowPositions(2800, 500, { mode: 'knauf', profileKind: 'bearing', wallOffsetMm: 50 })
      expect(positions[0]).toBe(50)
    })
  })
})

describe('calcMainRowPositionsKnauf (ОСНОВНОЙ профиль, mode=knauf)', () => {
  it('первый ряд на wallOffsetMm (по умолчанию 150мм) от стены, далее строго через шаг', () => {
    // span=2800, step=900, offset=150 (default): 150,1050,1950 — до стены 850мм
    // (>150) -> добавляем ещё один ряд на 2800-150=2650
    const positions = calcMainRowPositionsKnauf(2800, 900)
    expect(positions).toEqual([150, 1050, 1950, 2650])
  })

  it('пример пользователя (11.07.2026): шаг c=1000, остаток от предпоследнего ровно 1000мм -> последний на +850', () => {
    // span=1150, step=1000, offset=150: регулярная сетка даёт только [150]
    // (следующий кандидат 1150 не < 1150). Остаток до стены = 1000 (=шаг,
    // ровно наивный следующий шаг попал бы в стену) -> добавляем ряд на
    // 1150-150=1000, то есть +850 от предыдущего (150+850=1000)
    const positions = calcMainRowPositionsKnauf(1150, 1000)
    expect(positions).toEqual([150, 1000])
    expect(positions[1] - positions[0]).toBe(850)
  })

  it('предпоследний ряд регулярной сетки ОСТАЁТСЯ на месте (не сдвигается) — добавляется ДОПОЛНИТЕЛЬНЫЙ последний', () => {
    // span=4150, step=1000, offset=150: регулярная сетка 150,1150,2150,3150
    // (3150<4150; следующий кандидат 4150 не <4150). Остаток=1000>150 ->
    // добавляем ряд на 4150-150=4000. 3150 должен ОСТАТЬСЯ в массиве.
    const positions = calcMainRowPositionsKnauf(4150, 1000)
    expect(positions).toEqual([150, 1150, 2150, 3150, 4000])
    expect(positions).toContain(3150) // предпоследний не тронут
  })

  it('если естественный остаток у стены уже ≤150мм — лишний ряд не добавляется', () => {
    // span=1300, step=1000, offset=150: сетка [150], next candidate 1150<1300
    // тоже пушится -> [150,1150], остаток=1300-1150=150 (<=150) -> без добавления
    const positions = calcMainRowPositionsKnauf(1300, 1000)
    expect(positions).toEqual([150, 1150])
  })

  it('нестандартный отступ через параметр wallOffsetMm', () => {
    const positions = calcMainRowPositionsKnauf(1150, 1000, 50)
    // сетка: 50,1050 (1050<1150; след.кандидат 2050 не<1150) -> остаток=1150-1050=100>50
    // -> доп. ряд на 1150-50=1100
    expect(positions).toEqual([50, 1050, 1100])
  })

  it('пустой пролёт или нулевой шаг -> пустой массив', () => {
    expect(calcMainRowPositionsKnauf(0, 900)).toEqual([])
    expect(calcMainRowPositionsKnauf(4000, 0)).toEqual([])
  })
})

describe('calcBearingRowPositionsKnauf (НЕСУЩИЙ профиль, mode=knauf)', () => {
  it('регулярная сетка от стены (b,2b,3b,...) + доп. профиль ≤100мм у каждой стены', () => {
    // span=3000, step=500: сетка 500,1000,1500,2000,2500 (2500<3000, next
    // 3000 не <3000). Ближняя стена: 500>100 -> доп.профиль на 100.
    // Дальняя: остаток=3000-2500=500>100 -> доп.профиль на 3000-100=2900.
    const positions = calcBearingRowPositionsKnauf(3000, 500)
    expect(positions).toEqual([100, 500, 1000, 1500, 2000, 2500, 2900])
  })

  it('шаг между рядами регулярной сетки НИКОГДА не отличается от номинального (не считая доп. профилей у стен)', () => {
    const positions = calcBearingRowPositionsKnauf(5137, 600)
    // средние ряды (без первого и последнего — это доп. профили у стен)
    for (let i = 2; i < positions.length - 2; i++) {
      expect(positions[i] - positions[i - 1]).toBe(600)
    }
  })

  it('если крайняя точка сетки уже сама попадает в допуск — доп. профиль НЕ добавляется', () => {
    // span=2733, step=500: сетка 500..2500, остаток=233 -> добавляем доп.
    // Проверим случай, где остаток уже мал: span=2580 -> сетка 500..2500,
    // остаток=80 (<=100) -> без доп. профиля у дальней стены
    const positions = calcBearingRowPositionsKnauf(2580, 500)
    expect(positions[positions.length - 1]).toBe(2500) // не 2480
  })

  it('нестандартный отступ через параметр wallOffsetMm', () => {
    const positions = calcBearingRowPositionsKnauf(3000, 500, 50)
    expect(positions[0]).toBe(50)
    expect(positions[positions.length - 1]).toBe(2950)
  })

  it('пустой пролёт или нулевой шаг -> пустой массив', () => {
    expect(calcBearingRowPositionsKnauf(0, 500)).toEqual([])
    expect(calcBearingRowPositionsKnauf(3000, 0)).toEqual([])
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

    it('knauf: несущий профиль — сетка от стены + доп. профиль ≤100мм у каждой стены', () => {
      // B=3000, stepB=500 -> knauf: 100,500,1000,1500,2000,2500,2900 (7 рядов,
      // см. calcBearingRowPositionsKnauf)
      const geoKnauf = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'knauf')
      const geoUser = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'user')
      expect(geoKnauf.bearingCount).toBe(7)
      expect(geoKnauf.bearingCount).not.toBe(geoUser.bearingCount)
    })

    it('соединители по-прежнему считаются как bearingCount × mainCount в обоих режимах', () => {
      const geo = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'knauf')
      expect(geo.connectorsTotal).toBe(geo.bearingCount * geo.mainCount)
    })

    it('knauf: основной профиль — своя сетка (шаг 150мм от стены) + доп. ряд у дальней стены, если нужно', () => {
      // A=4000, stepC=600 -> knauf: 150,750,1350,1950,2550,3150,3750,3850 (8 рядов)
      const geoKnauf = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'knauf')
      const geoUser = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'user')
      expect(geoKnauf.mainCount).toBe(8)
      expect(geoKnauf.mainCount).not.toBe(geoUser.mainCount)
    })

    it('extra.stepA переопределяет шаг подвесов НЕЗАВИСИМО от stepB', () => {
      const withoutStepA = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true, 'user')
      const withStepA = calcP112FrameGeometry(4000, 3000, 600, 900, 50, true, 'user', { stepA: 1200 })
      expect(withStepA.hangersPerBearing).not.toBe(withoutStepA.hangersPerBearing)
    })

    it('extra.wallOffsetMainMm/wallOffsetBearingMm можно переопределить явно поверх layoutMode', () => {
      const geo = calcP112FrameGeometry(4000, 3000, 600, 500, 50, true, 'user', {
        wallOffsetMainMm: KNAUF_WALL_OFFSET_MAIN_MM, wallOffsetBearingMm: KNAUF_WALL_OFFSET_BEARING_MM,
      })
      // 'user' обычно не сжимает отступ до 100/150мм — с явным extra это происходит и в user-режиме
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

  it("mode='knauf' поперечный монтаж — stepB=500, stepA из таблицы, разные отступы для основного (150) и несущего (100)", () => {
    const r = resolveFrameParams({ stepC: 800, layoutMode: 'knauf', mountDirection: 'crosswise', loadClass: 0.15 })
    expect(r.stepB).toBe(500)
    expect(r.stepA).toBe(1050)
    expect(r.wallOffsetMainMm).toBe(KNAUF_WALL_OFFSET_MAIN_MM)
    expect(r.wallOffsetBearingMm).toBe(KNAUF_WALL_OFFSET_BEARING_MM)
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

describe('calcP112FrameGeometry — подвесы строго на оси основного профиля (10.07.2026)', () => {
  it('hangerPositions — подмножество mainPositions, не независимая сетка', () => {
    const geo = calcP112FrameGeometry(4000, 4000, 600, 1150, 300, true, 'user')
    for (const hp of geo.hangerPositions) {
      expect(geo.mainPositions).toContain(hp)
    }
  })

  it('реальный кейс пользователя (4000x4000, c=600, b=1150, user) — подвес на каждом основном профиле', () => {
    const geo = calcP112FrameGeometry(4000, 4000, 600, 1150, 300, true, 'user', { stepA: 1150 })
    expect(geo.mainPositions).toEqual([600, 1200, 1800, 2400, 3000, 3750])
    expect(geo.hangerPositions).toEqual(geo.mainPositions)
    expect(geo.hangersPerBearing).toBe(6)
  })

  it('mainPositions/bearingPositions присутствуют и согласованы со счётчиками', () => {
    const geo = calcP112FrameGeometry(4000, 4000, 600, 1150, 300, true, 'user')
    expect(geo.mainPositions.length).toBe(geo.mainCount)
    expect(geo.bearingPositions.length).toBe(geo.bearingCount)
    expect(geo.hangerPositions.length).toBe(geo.hangersPerBearing)
  })

  it('hangersTotal = hangersPerBearing × bearingCount', () => {
    const geo = calcP112FrameGeometry(5000, 3500, 1000, 500, 300, true, 'knauf', { stepA: 950, wallOffsetMainMm: 100, wallOffsetBearingMm: 100 })
    expect(geo.hangersTotal).toBe(geo.hangersPerBearing * geo.bearingCount)
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
