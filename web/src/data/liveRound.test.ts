import { describe, expect, it } from 'vitest'
import { liveRound } from './hooks'
import { baseRateFor, devShareCeil, emittedAt, potAt, roundEnd, type Schedule } from '../lib/emission'

const E18 = 10n ** 18n
const RESERVE = 650_000_000n * E18
const ERA = 180n * 86_400n
const G = 1_800_000_000n
const s: Schedule = { reserve: RESERVE, genesis: G, baseRate: baseRateFor(RESERVE, ERA), roundLength: 600n, eraLength: ERA, devBps: 500n }

describe('liveRound', () => {
  it('uses the snapshot while it is the current round', () => {
    const t = G + 5n * 600n + 100n
    const lr = liveRound(s, { round: 5n, roundShares: 7n * E18, pot: 123n, assigned: 0n }, t)
    expect(lr).toMatchObject({ live: true, round: 5n, pot: 123n, roundShares: 7n * E18, roundEndsAt: G + 6n * 600n, era: 0n })
    expect(lr.perRound).toBe((s.baseRate * 600n * 9_500n) / 10_000n)
  })

  it('rolls a stale snapshot forward: the new round has no answers and the pot keeps growing', () => {
    // the snapshot was taken in round 5 (which got answers); the chain clock is now in round 8
    const assigned = emittedAt(s, roundEnd(s, 5n))
    const t = G + 8n * 600n + 10n
    const lr = liveRound(s, { round: 5n, roundShares: 7n * E18, pot: 999n, assigned }, t)
    const emitted = emittedAt(s, roundEnd(s, 8n)) - assigned
    expect(lr.round).toBe(8n)
    expect(lr.roundShares).toBe(0n)
    expect(lr.pot).toBe(emitted - devShareCeil(emitted, 500n))
    // three empty rounds (6, 7, 8) of emission, minus the dev share
    expect(lr.pot).toBe(potAt(s, t, assigned))
  })

  it('is not live before genesis', () => {
    const lr = liveRound(s, { round: 0n, roundShares: 0n, pot: 0n, assigned: 0n }, G - 10n)
    expect(lr.live).toBe(false)
    expect(lr.pot).toBe(0n)
    expect(lr.roundEndsAt).toBe(G + 600n)
  })

  it('reports the era and the next halving', () => {
    const lr = liveRound(s, { round: 0n, roundShares: 0n, pot: 0n, assigned: 0n }, G + ERA + 5n)
    expect(lr.era).toBe(1n)
    expect(lr.nextHalvingAt).toBe(G + 2n * ERA)
    expect(lr.rate).toBe(s.baseRate / 2n)
  })
})
