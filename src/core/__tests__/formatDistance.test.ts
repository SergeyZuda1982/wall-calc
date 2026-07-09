import { describe, it, expect } from 'vitest'
import { formatDistanceM } from '../formatDistance'

describe('formatDistanceM', () => {
  it('меньше 1 м — миллиметры, целое число', () => {
    expect(formatDistanceM(0.6)).toBe('600 мм')
    expect(formatDistanceM(0.0006)).toBe('1 мм') // округление вверх до 1мм
    expect(formatDistanceM(0.0004)).toBe('0 мм') // округление вниз
  })

  it('1 м и больше — метры, 2 знака после запятой', () => {
    expect(formatDistanceM(1)).toBe('1.00 м')
    expect(formatDistanceM(3.456)).toBe('3.46 м')
    expect(formatDistanceM(12)).toBe('12.00 м')
  })

  it('граница ровно 1 м — метры, не миллиметры', () => {
    expect(formatDistanceM(1)).toBe('1.00 м')
  })

  it('некорректные значения — тире, не кидает исключение', () => {
    expect(formatDistanceM(-1)).toBe('—')
    expect(formatDistanceM(NaN)).toBe('—')
    expect(formatDistanceM(Infinity)).toBe('—')
  })

  it('ноль — 0 мм', () => {
    expect(formatDistanceM(0)).toBe('0 мм')
  })
})
