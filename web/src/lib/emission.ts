/**
 * HmmMine's emission schedule, mirrored exactly (bigint, same integer math) so the app can draw the curve, project
 * the pot and compute claimable amounts without a round trip. Keep in sync with src/HmmMine.sol.
 */

export const MAX_ERAS = 64n
export const BPS = 10_000n

export interface Schedule {
  /** HMM the mine holds for mining (set once by `start`). */
  reserve: bigint
  /** Unix seconds of the first round; 0 before `start`. */
  genesis: bigint
  /** HMM per second in era 0: reserve / (2 * eraLength). */
  baseRate: bigint
  roundLength: bigint
  eraLength: bigint
  devBps: bigint
}

/** `start()`: rate = balance / (2 * eraLength), so the geometric series never exceeds the reserve. */
export function baseRateFor(reserve: bigint, eraLength: bigint): bigint {
  return reserve / (2n * eraLength)
}

/** `emittedAt(t)`: HMM emitted by the schedule from genesis to `t`, whether or not rounds were answered. */
export function emittedAt(s: Schedule, t: bigint): bigint {
  const g = s.genesis
  if (g === 0n || t <= g) return 0n
  const elapsed = t - g
  const era = elapsed / s.eraLength
  let rate = s.baseRate
  const full = era < MAX_ERAS ? era : MAX_ERAS
  let total = 0n
  for (let i = 0n; i < full; i++) {
    total += rate * s.eraLength
    rate >>= 1n
  }
  if (era < MAX_ERAS) total += rate * (elapsed - era * s.eraLength)
  return total
}

/** `rateAt(t)`: emission per second at `t`. */
export function rateAt(s: Schedule, t: bigint): bigint {
  const g = s.genesis
  if (g === 0n || t < g) return 0n
  const era = (t - g) / s.eraLength
  return era < MAX_ERAS ? s.baseRate >> era : 0n
}

/** The halving era at `t` (0 before genesis), as `stats()` computes it. */
export function eraAt(s: Schedule, t: bigint): bigint {
  if (s.genesis === 0n) return 0n
  const at = t < s.genesis ? s.genesis : t
  return (at - s.genesis) / s.eraLength
}

/** `currentRound()` at time `t`: zero before genesis. */
export function roundAt(s: Schedule, t: bigint): bigint {
  if (s.genesis === 0n || t < s.genesis) return 0n
  return (t - s.genesis) / s.roundLength
}

export function roundStart(s: Schedule, r: bigint): bigint {
  return s.genesis + r * s.roundLength
}

/** `roundEnd(r)`: rewards of round r are claimable from this time on. */
export function roundEnd(s: Schedule, r: bigint): bigint {
  return s.genesis + (r + 1n) * s.roundLength
}

export function nextHalvingAt(s: Schedule, t: bigint): bigint {
  return s.genesis + (eraAt(s, t) + 1n) * s.eraLength
}

/** The dev share of an emission, rounded up (as in `credit`). */
export function devShareCeil(emitted: bigint, devBps: bigint): bigint {
  return (emitted * devBps + BPS - 1n) / BPS
}

/**
 * `pot()` at time `t`: what the current round's backers would share if it ended now. If the round already has an
 * answer its reward is fixed (`roundReward`); otherwise it is everything emitted up to the round's end that no
 * answered round took yet, minus the dev share.
 */
export function potAt(
  s: Schedule,
  t: bigint,
  assigned: bigint,
  current: { shares: bigint; reward: bigint } = { shares: 0n, reward: 0n },
): bigint {
  if (s.genesis === 0n || t < s.genesis) return 0n
  if (current.shares !== 0n) return current.reward
  const emitted = emittedAt(s, roundEnd(s, roundAt(s, t))) - assigned
  return emitted - devShareCeil(emitted, s.devBps)
}

/** One full round's emission at time `t` (before the dev share), ignoring an era boundary inside the round. */
export function roundEmissionAt(s: Schedule, t: bigint): bigint {
  return rateAt(s, t) * s.roundLength
}

/** A backer's HMM from an answered round: `mulDiv(reward, amount, shares)` (rounded down). */
export function shareOf(reward: bigint, amount: bigint, shares: bigint): bigint {
  if (shares === 0n) return 0n
  return (reward * amount) / shares
}

/** Samples the cumulative schedule for charts: `points` evenly spaced times from genesis over `span` seconds. */
export function scheduleCurve(
  s: Schedule,
  span: bigint,
  points = 120,
): { t: bigint; emitted: bigint; rate: bigint }[] {
  const out: { t: bigint; emitted: bigint; rate: bigint }[] = []
  if (s.genesis === 0n) return out
  for (let i = 0; i <= points; i++) {
    const t = s.genesis + (span * BigInt(i)) / BigInt(points)
    out.push({ t, emitted: emittedAt(s, t), rate: rateAt(s, t) })
  }
  return out
}

/** Total the schedule will ever emit (the 64-era geometric sum); at most the reserve. */
export function totalScheduled(s: Schedule): bigint {
  let rate = s.baseRate
  let total = 0n
  for (let i = 0n; i < MAX_ERAS; i++) {
    total += rate * s.eraLength
    rate >>= 1n
  }
  return total
}
