import { describe, expect, it } from 'vitest'
import { numToText, parseNumText, stripLeadingZeros } from '../numInput'

describe('numInput', () => {
  it('убирает ведущие нули', () => {
    expect(stripLeadingZeros('022800')).toBe('22800')
    expect(stripLeadingZeros('0022800')).toBe('22800')
    expect(stripLeadingZeros('-007')).toBe('-7')
  })
  it('не трогает ноль, дроби и отрицательные', () => {
    for (const s of ['0', '0.5', '-0.5', '10', '100', '', '-', '1.50']) expect(stripLeadingZeros(s)).toBe(s)
  })
  it('разбор и вывод', () => {
    expect(parseNumText('')).toBe(0); expect(parseNumText('-')).toBe(0); expect(parseNumText('1,5')).toBe(1.5)
    expect(parseNumText('-300')).toBe(-300)
    expect(numToText(0)).toBe('0'); expect(numToText(12.345)).toBe('12.35'); expect(numToText(NaN)).toBe('0')
  })
})
