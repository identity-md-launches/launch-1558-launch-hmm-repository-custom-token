import type { Hex } from 'viem'

/**
 * Failure and check codes, made readable. Chain codes are short ASCII right-padded to bytes32 (`bytes32("disagreed")`);
 * the IMD docs promise codes are added, never renamed, so unknown ones fall back to a readable form of the code.
 */

/** `Failed.status`: 1 = the plane refused the ask, 2 = no answer (e.g. the panel split), 3 = an answer that did not
 * count (rejected by the adapter). */
export type FailureKind = 'refused' | 'unanswered' | 'rejected' | 'unknown'

export function failureKind(status: number): FailureKind {
  return status === 1 ? 'refused' : status === 2 ? 'unanswered' : status === 3 ? 'rejected' : 'unknown'
}

export const FAILURE_KIND_LABEL: Record<FailureKind, string> = {
  refused: 'refused',
  unanswered: 'no answer',
  rejected: 'answer did not count',
  unknown: 'failed',
}

/** bytes32 → its ASCII text without the zero padding. Non-printable bytes make it return the hex. */
export function bytes32ToAscii(value: Hex): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  let out = ''
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16)
    if (c === 0) break
    if (c < 0x20 || c > 0x7e) return value
    out += String.fromCharCode(c)
  }
  return out
}

interface Reason {
  title: string
  detail: string
}

const REASONS: Record<string, Reason> = {
  // status 2: the work ended without an answer
  disagreed: { title: 'The panel disagreed', detail: 'Too few agents gave the same answer to reach the quorum.' },
  mismatch: { title: "Answers didn't match the evidence", detail: 'The answer could not be reproduced from chain data.' },
  deleted: { title: 'The oracle request was withdrawn', detail: 'The swarm removed the request before it was answered.' },
  cancelled: { title: 'The job was cancelled', detail: 'The swarm cancelled the work before it finished.' },
  blocked: { title: 'The swarm blocked the request', detail: 'The work could not proceed.' },
  superseded: { title: 'Superseded', detail: 'A newer run replaced this one.' },
  // status 1: the plane refused the ask
  body_refused: {
    title: 'The swarm refused the question',
    detail: 'Its wording or scope failed the screen (for example ambiguous or not answerable from evidence).',
  },
  body_invalid: { title: 'The question body was invalid', detail: 'A field was missing or out of range.' },
  body_not_json: { title: 'The question was not valid JSON', detail: 'The body could not be read as a JSON object.' },
  unknown_action: { title: 'Unknown action', detail: 'The Intake did not recognise the action id.' },
  action_not_sold: { title: 'Action not sold', detail: 'The action is not for sale in this asset.' },
  wrong_asset: { title: 'Wrong payment asset', detail: 'The question was paid in an asset the plane does not take.' },
  short_payment: { title: 'Payment too small', detail: 'Less than the price was paid.' },
  deliver_invalid: { title: 'Invalid delivery', detail: 'The callback settings were not accepted.' },
  delivery_chain_not_supported: { title: 'Chain not supported', detail: 'The swarm does not deliver to this chain.' },
  two_destinations: { title: 'Two destinations', detail: 'The request named more than one place to deliver to.' },
  testnet_only: { title: 'Testnet only', detail: 'This request is only served on a test network.' },
  admission_refused: { title: 'Not admitted', detail: 'The plane did not admit the request.' },
  // status 3: an answer arrived but the adapter did not count it
  reused: { title: 'Answer already counted', detail: 'This signed oracle answer was used for another question.' },
  panel_too_small: { title: 'Panel too small', detail: 'Fewer than the 5 agents the mine requires answered.' },
  quorum_too_low: { title: 'Quorum too low', detail: 'The quorum was below the 4 the mine requires.' },
  not_agreed: { title: 'Not enough agreement', detail: 'Fewer than the quorum, or not a majority, agreed.' },
  expired: { title: 'The signed answer expired', detail: 'It arrived after its validity window.' },
  bad_signature: { title: 'Bad signature', detail: "The answer was not signed by the swarm's oracle key." },
  // POST /requests/check blockers and suggestions
  ambiguous_question: {
    title: 'Ambiguous question',
    detail: 'It can be read more than one way. Name the exact quantity, the contract and the block range.',
  },
  not_answerable: { title: 'Not answerable from evidence', detail: 'The panel could not settle it from the chosen evidence.' },
  quorum_unreachable: { title: 'Quorum unreachable', detail: 'Not enough seats took work recently to reach the quorum.' },
  wording: {
    title: 'Wording could be tighter',
    detail: 'It may be read more than one way. Naming the period, the unit or the term you mean makes a split less likely.',
  },
  invalid_input: { title: 'Invalid input', detail: 'The checker could not read the question.' },
  request_too_large: { title: 'Too large', detail: 'The question is over the size limit.' },
  slow_down: { title: 'Slow down', detail: 'The checker is rate limiting; try again in a moment.' },
}

/** "panel_too_small" → "Panel too small". */
export function readableCode(code: string): string {
  const s = code.replace(/[_-]+/g, ' ').trim()
  return s ? s[0]!.toUpperCase() + s.slice(1) : 'Unknown reason'
}

/** A human title and explanation for a code (ASCII string or bytes32 hex). */
export function humanizeReason(codeOrHex: string): Reason & { code: string } {
  const code = codeOrHex.startsWith('0x') ? bytes32ToAscii(codeOrHex as Hex) : codeOrHex
  const known = REASONS[code]
  if (known) return { code, ...known }
  if (!code) return { code, title: 'No reason given', detail: 'The swarm did not say why.' }
  return { code, title: readableCode(code), detail: 'Reported by the swarm.' }
}
