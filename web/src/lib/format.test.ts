import { describe, expect, it } from 'vitest'
import {
  compactNumber,
  formatAgo,
  formatClock,
  formatDuration,
  formatHmm,
  formatImd,
  formatInt,
  formatPercent,
  formatUnitsFixed,
  parseAmount,
  shortAddress,
} from './format'

const E18 = 10n ** 18n

describe('amounts', () => {
  it('formats base units exactly with separators', () => {
    expect(formatUnitsFixed(1_234_567n * E18 + 891_000_000_000_000_000n, 18, { maxFrac: 2 })).toBe('1,234,567.89')
    expect(formatUnitsFixed(5n * 10n ** 17n)).toBe('0.5')
    expect(formatUnitsFixed(0n)).toBe('0')
    expect(formatUnitsFixed(E18, 18, { minFrac: 2 })).toBe('1.00')
    expect(formatUnitsFixed(-15n * 10n ** 17n)).toBe('-1.5')
  })
  it('cuts rather than rounds, and flags dust', () => {
    expect(formatUnitsFixed(999_999_999_999_999_999n, 18, { maxFrac: 2 })).toBe('0.99')
    expect(formatUnitsFixed(1n, 18, { maxFrac: 4 })).toBe('<0.0001')
  })
  it('formats IMD and HMM', () => {
    expect(formatImd(10n ** 16n)).toBe('0.01')
    expect(formatImd(499_200_000_000_000_000_000n)).toBe('499.2')
    expect(formatHmm(11_913_941_936_728_395_061_590n)).toBe('11,913.94')
    expect(formatHmm(650_000_000n * E18)).toBe('650M')
    expect(formatHmm(650_000_000n * E18, { compact: false })).toBe('650,000,000')
  })
  it('parses typed amounts without floats', () => {
    expect(parseAmount('0.5')).toBe(5n * 10n ** 17n)
    expect(parseAmount('1,000.25')).toBe(1000_250_000_000_000_000_000n)
    expect(parseAmount('.01')).toBe(10n ** 16n)
    expect(parseAmount('1e3')).toBeNull()
    expect(parseAmount('-1')).toBeNull()
    expect(parseAmount('0.0000000000000000001')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

describe('numbers', () => {
  it('groups integers', () => {
    expect(formatInt(1012)).toBe('1,012')
    expect(formatInt(12_345_678_901_234_567_890n)).toBe('12,345,678,901,234,567,890')
    expect(formatInt(-1500)).toBe('-1,500')
  })
  it('compacts', () => {
    expect(compactNumber(1234)).toBe('1.23k')
    expect(compactNumber(650_000_000)).toBe('650M')
    expect(compactNumber(999)).toBe('999')
    expect(compactNumber(0)).toBe('0')
    expect(compactNumber(0.5)).toBe('0.5')
  })
  it('percentages', () => {
    expect(formatPercent(0.65)).toBe('65%')
    expect(formatPercent(0.1234, 2)).toBe('12.34%')
    expect(formatPercent(0.00001)).toBe('<0.1%')
  })
})

describe('time', () => {
  it('durations', () => {
    expect(formatDuration(252)).toBe('4m 12s')
    expect(formatDuration(7500)).toBe('2h 05m')
    expect(formatDuration(179 * 86400 + 3 * 3600 + 5)).toBe('179d 3h')
    expect(formatDuration(-3)).toBe('0s')
  })
  it('clocks', () => {
    expect(formatClock(599)).toBe('09:59')
    expect(formatClock(3723)).toBe('1:02:03')
    expect(formatClock(-1)).toBe('00:00')
  })
  it('ago', () => {
    expect(formatAgo(2)).toBe('just now')
    expect(formatAgo(42)).toBe('42s ago')
    expect(formatAgo(3 * 3600)).toBe('3h ago')
  })
  it('short addresses', () => {
    expect(shortAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')).toBe('0xf39F…2266')
  })
})
