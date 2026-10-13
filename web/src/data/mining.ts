import type { Address } from 'viem'
import { shareOf } from '../lib/emission'
import { claimedBy, netBacking, type IndexState, type QuestionRec } from './indexer'

/**
 * What each backer mined, from events: a backer of an answered question gets `reward * backed / shares` of the
 * round it landed in (the contract's `claimable`). Until the round ends more answers can join it, so amounts in the
 * current round are estimates that can only shrink.
 */

export interface RoundTiming {
  genesis: bigint
  roundLength: bigint
}

export function roundEndOf(t: RoundTiming, r: bigint): bigint {
  return t.genesis + (r + 1n) * t.roundLength
}

export interface Earning {
  q: QuestionRec
  backed: bigint
  /** HMM for this backer (exact once the round ended; an estimate before). */
  hmm: bigint
  claimed: bigint
  /** Round ended and not yet claimed. */
  claimable: bigint
  final: boolean
  roundEndsAt: bigint | null
}

export function earningOf(s: IndexState, q: QuestionRec, who: Address, now: bigint, timing: RoundTiming | null): Earning {
  const backed = netBacking(q, who)
  const claimed = claimedBy(q, who)
  let hmm = 0n
  let final = false
  let roundEndsAt: bigint | null = null
  if (q.status === 'answered' && q.round !== undefined) {
    const round = s.rounds.get(q.round.toString())
    if (round) hmm = claimed > 0n ? claimed : shareOf(round.reward, backed, round.shares)
    if (timing) {
      roundEndsAt = roundEndOf(timing, q.round)
      final = now >= roundEndsAt
    }
  }
  return { q, backed, hmm, claimed, claimable: final && claimed === 0n ? hmm : 0n, final, roundEndsAt }
}

export interface MinerRow {
  address: Address
  /** HMM mined: claimed + claimable + this round's estimate. */
  hmm: bigint
  claimed: bigint
  claimable: bigint
  pending: bigint
  backed: number
  answered: number
  /** IMD that went to the swarm through questions this address backed (asked ones only). */
  imdPaid: bigint
  /** IMD still sitting in open questions. */
  imdOpen: bigint
}

export function leaderboard(s: IndexState, now: bigint, timing: RoundTiming | null): MinerRow[] {
  const rows = new Map<string, MinerRow>()
  for (const q of s.questions.values()) {
    for (const who of q.backed.keys()) {
      const key = who.toLowerCase()
      let row = rows.get(key)
      if (!row) {
        row = { address: who, hmm: 0n, claimed: 0n, claimable: 0n, pending: 0n, backed: 0, answered: 0, imdPaid: 0n, imdOpen: 0n }
        rows.set(key, row)
      }
      const e = earningOf(s, q, who, now, timing)
      row.backed++
      if (q.status === 'open') row.imdOpen += e.backed
      else row.imdPaid += e.backed
      if (q.status === 'answered') {
        row.answered++
        row.hmm += e.hmm
        row.claimed += e.claimed
        if (e.final) row.claimable += e.claimable
        else row.pending += e.hmm
      }
    }
  }
  return [...rows.values()].sort((a, b) =>
    a.hmm !== b.hmm ? (a.hmm < b.hmm ? 1 : -1) : a.imdPaid !== b.imdPaid ? (a.imdPaid < b.imdPaid ? 1 : -1) : b.backed - a.backed,
  )
}
