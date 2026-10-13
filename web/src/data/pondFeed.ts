import type { Address } from 'viem'
import type { PondMoon, PondQuestion } from '../pond/types'
import { answerLabel } from '../lib/answer'
import { humanizeReason } from '../lib/reasons'
import { toNumber } from '../lib/format'
import type { IndexState, QuestionRec } from './indexer'
import type { LiveRound } from './hooks'

function orderOf(q: QuestionRec): number {
  const ref = q.settled ?? q.asked ?? q.proposed
  return Number(ref.block) * 10_000 + ref.logIndex
}

export function backedBy(q: QuestionRec, who: Address | undefined): boolean {
  if (!who) return false
  const w = who.toLowerCase()
  for (const k of q.backed.keys()) if (k.toLowerCase() === w) return true
  return false
}

/** The questions as the pond shows them. */
export function pondQuestions(index: IndexState | null, who: Address | undefined, now: number): PondQuestion[] {
  if (!index) return []
  const out: PondQuestion[] = []
  for (const q of index.questions.values()) {
    // Open questions past their deadline are no longer buds: they can only be refunded.
    if (q.status === 'open' && BigInt(now) > q.deadline) continue
    out.push({
      id: q.id.toString(),
      text: q.text,
      status: q.status,
      raised: q.target === 0n ? 0 : Math.min(1, Number((q.raised * 1000n) / q.target) / 1000),
      panelSize: q.answer?.panelSize,
      agreed: q.answer?.agreed,
      answer: q.answer ? answerLabel(q.answer.decoded) : undefined,
      reason: q.failure ? humanizeReason(q.failure.reason).title : undefined,
      mine: backedBy(q, who),
      order: orderOf(q),
    })
  }
  return out
}

/** The moon from the live round: phase by era, ring by round progress, reflection by the pot. */
export function pondMoon(live: LiveRound | null, roundLength: bigint | undefined, now: number): PondMoon {
  if (!live || !live.live || !roundLength) return { live: false, era: 0, roundProgress: 0, roundsInPot: 0 }
  const len = Number(roundLength)
  const left = Math.max(0, Number(live.roundEndsAt) - now)
  const perRound = toNumber(live.perRound)
  return {
    live: true,
    era: Number(live.era),
    roundProgress: Math.max(0, Math.min(1, 1 - left / len)),
    roundsInPot: perRound > 0 ? toNumber(live.pot) / perRound : 0,
  }
}
