import { describe, expect, it } from 'vitest'
import {
  type Schedule,
  baseRateFor,
  devShareCeil,
  emittedAt,
  eraAt,
  nextHalvingAt,
  potAt,
  rateAt,
  roundAt,
  roundEnd,
  roundStart,
  shareOf,
  totalScheduled,
} from './emission'

const E18 = 10n ** 18n
const RESERVE = 650_000_000n * E18
const ERA = 180n * 86_400n
const ROUND = 600n
const G = 1_800_000_000n

const sched: Schedule = {
  reserve: RESERVE,
  genesis: G,
  baseRate: baseRateFor(RESERVE, ERA),
  roundLength: ROUND,
  eraLength: ERA,
  devBps: 500n,
}

describe('baseRate', () => {
  it('is reserve / (2 * era) with integer division', () => {
    expect(sched.baseRate).toBe(RESERVE / (2n * ERA))
    expect(sched.baseRate).toBe(20_897_633_744_855_967_078n)
  })
})

describe('emittedAt', () => {
  it('is zero before and at genesis, and before start', () => {
    expect(emittedAt(sched, G - 1n)).toBe(0n)
    expect(emittedAt(sched, G)).toBe(0n)
    expect(emittedAt({ ...sched, genesis: 0n }, G + 1000n)).toBe(0n)
  })
  it('grows linearly inside an era', () => {
    expect(emittedAt(sched, G + 1n)).toBe(sched.baseRate)
    expect(emittedAt(sched, G + 19n * ROUND)).toBe(sched.baseRate * 19n * ROUND)
  })
  it('halves the rate every era', () => {
    expect(emittedAt(sched, G + ERA)).toBe(sched.baseRate * ERA)
    expect(emittedAt(sched, G + 2n * ERA)).toBe(sched.baseRate * ERA + (sched.baseRate / 2n) * ERA)
    expect(emittedAt(sched, G + 2n * ERA + 10n)).toBe(
      sched.baseRate * ERA + (sched.baseRate >> 1n) * ERA + (sched.baseRate >> 2n) * 10n,
    )
  })
  it('never exceeds the reserve and stops after 64 eras', () => {
    const end = emittedAt(sched, G + 64n * ERA)
    expect(end).toBeLessThanOrEqual(RESERVE)
    expect(emittedAt(sched, G + 64n * ERA + 12345n)).toBe(end)
    expect(emittedAt(sched, 2n ** 64n - 1n)).toBe(end)
    expect(end).toBe(totalScheduled(sched))
    // The geometric series leaves only rounding dust behind: < 2 * era from the base division plus < 1 * era
    // per halving shift.
    expect(RESERVE - end).toBeLessThan(66n * ERA)
  })
})

describe('rateAt', () => {
  it('steps down by halves', () => {
    expect(rateAt(sched, G - 1n)).toBe(0n)
    expect(rateAt(sched, G)).toBe(sched.baseRate)
    expect(rateAt(sched, G + ERA - 1n)).toBe(sched.baseRate)
    expect(rateAt(sched, G + ERA)).toBe(sched.baseRate / 2n)
    expect(rateAt(sched, G + 3n * ERA)).toBe(sched.baseRate / 8n)
    expect(rateAt(sched, G + 64n * ERA)).toBe(0n)
  })
})

describe('rounds and eras', () => {
  it('numbers rounds from genesis', () => {
    expect(roundAt(sched, G - 5n)).toBe(0n)
    expect(roundAt(sched, G)).toBe(0n)
    expect(roundAt(sched, G + ROUND - 1n)).toBe(0n)
    expect(roundAt(sched, G + ROUND)).toBe(1n)
    expect(roundStart(sched, 3n)).toBe(G + 3n * ROUND)
    expect(roundEnd(sched, 3n)).toBe(G + 4n * ROUND)
  })
  it('computes era and next halving like stats()', () => {
    expect(eraAt(sched, G - 100n)).toBe(0n)
    expect(eraAt(sched, G + ERA)).toBe(1n)
    expect(nextHalvingAt(sched, G + 5n)).toBe(G + ERA)
    expect(nextHalvingAt(sched, G + ERA + 5n)).toBe(G + 2n * ERA)
  })
})

describe('pot and shares', () => {
  it('rolls empty rounds into the pot, minus the dev share rounded up', () => {
    const t = G + 19n * ROUND + 30n
    const emitted = emittedAt(sched, roundEnd(sched, 19n))
    expect(emitted).toBe(sched.baseRate * 20n * ROUND)
    expect(potAt(sched, t, 0n)).toBe(emitted - devShareCeil(emitted, 500n))
    // after an answered round took everything up to its end, only the new rounds count
    const assigned = emittedAt(sched, roundEnd(sched, 9n))
    expect(potAt(sched, t, assigned)).toBe(
      sched.baseRate * 10n * ROUND - devShareCeil(sched.baseRate * 10n * ROUND, 500n),
    )
  })
  it('is the fixed reward once the round has an answer, and zero before genesis', () => {
    expect(potAt(sched, G + 10n, 0n, { shares: 5n, reward: 77n })).toBe(77n)
    expect(potAt(sched, G - 10n, 0n)).toBe(0n)
  })
  it('rounds the dev share up and backer shares down', () => {
    expect(devShareCeil(10_000n, 500n)).toBe(500n)
    expect(devShareCeil(10_001n, 500n)).toBe(501n)
    expect(shareOf(100n, 1n, 3n)).toBe(33n)
    expect(shareOf(100n, 1n, 0n)).toBe(0n)
  })
})
