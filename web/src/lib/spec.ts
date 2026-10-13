import type { AnswerType } from './body'

/**
 * A question as the mine takes it: `propose(Spec spec, uint256 amount)`. The mine composes the JSON body on chain
 * from these fields (`bodyOf(spec)`), so nobody can slip extra fields into a pooled question. This module mirrors the
 * mine's rules and its composition byte for byte; the app still reads `bodyOf` from chain when it can and treats
 * that as the truth.
 */

export interface Spec {
  question: string
  /** 0 bool, 1 address, 2 bytes32, 3 uint256. */
  answerType: number
  /** 0 chain, 1 panel. */
  evidence: number
  chainId: number
  windowHours: number
  panelSize: number
  quorum: number
  /** uint256 answers only (0-10,000); 0 otherwise. */
  toleranceBps: number
}

export const SPEC_ANSWER_TYPES = ['bool', 'address', 'bytes32', 'uint256'] as const satisfies readonly AnswerType[]
export type SpecAnswerType = (typeof SPEC_ANSWER_TYPES)[number]
export const SPEC_EVIDENCE = ['chain', 'panel'] as const
export const SPEC_CHAINS: { id: number; name: string }[] = [
  { id: 1, name: 'Ethereum mainnet' },
  { id: 56, name: 'BNB Chain' },
  { id: 4663, name: 'Robinhood Chain' },
  { id: 8453, name: 'Base' },
  { id: 42161, name: 'Arbitrum One' },
]
export const VALID_FOR_SECONDS = 86_400
export const MAX_QUESTION_BYTES = 2_000

/** The defaults every template uses: Ethereum mainnet, last 24 hours, chain evidence, a panel of 5 with quorum 4. */
export function specFor(question: string, answerType: SpecAnswerType, overrides: Partial<Spec> = {}): Spec {
  return {
    question,
    answerType: SPEC_ANSWER_TYPES.indexOf(answerType),
    evidence: 0,
    chainId: 1,
    windowHours: 24,
    panelSize: 5,
    quorum: 4,
    toleranceBps: 0,
    ...overrides,
  }
}

/** `bodyOf(spec)`: the JSON the mine composes and pays the Intake for. */
export function specBody(s: Spec): string {
  const type = SPEC_ANSWER_TYPES[s.answerType] ?? 'bool'
  const evidence = SPEC_EVIDENCE[s.evidence] ?? 'chain'
  return (
    `{"v":1,"question":"${s.question}","chainId":${s.chainId},"window":{"hours":${s.windowHours}},` +
    `"answerType":"${type}","evidence":"${evidence}","panelSize":${s.panelSize},"quorum":${s.quorum},` +
    `"validForSeconds":${VALID_FOR_SECONDS}${type === 'uint256' ? `,"toleranceBps":${s.toleranceBps}` : ''}}`
  )
}

/** Characters the mine refuses in a question: anything outside printable ASCII, plus `"` and `\`. */
export function badQuestionChars(q: string): string[] {
  const bad = new Set<string>()
  for (const ch of q) {
    const c = ch.codePointAt(0)!
    if (c < 0x20 || c > 0x7e || ch === '"' || ch === '\\') bad.add(ch)
  }
  return [...bad]
}

const TYPOGRAPHIC: [RegExp, string][] = [
  [/[‘’‚‛′´`]/g, "'"],
  [/[“”„‟″"]/g, "'"],
  [/[‐-―−]/g, '-'],
  [/…/g, '...'],
  [/[  -​  　]/g, ' '],
  [/[\r\n\t]+/g, ' '],
  [/\\/g, '/'],
]

/** Rewrites typographic quotes, dashes, ellipses, odd spaces and line breaks into the ASCII the mine accepts. */
export function toAsciiQuestion(q: string): string {
  let s = q
  for (const [re, rep] of TYPOGRAPHIC) s = s.replace(re, rep)
  return s.replace(/ {2,}/g, ' ').trim()
}

/** The mine's rules, as a readable reason (null when the spec is acceptable). */
export function specError(s: Spec): string | null {
  const len = new TextEncoder().encode(s.question).length
  if (len === 0) return 'Write a question'
  if (len > MAX_QUESTION_BYTES) return `At most ${MAX_QUESTION_BYTES.toLocaleString('en-US')} characters`
  const bad = badQuestionChars(s.question)
  if (bad.length) {
    const shown = bad.map((c) => (c === '"' ? '"' : c === '\\' ? '\\' : c.trim() ? c : `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`))
    return `Plain ASCII only, without double quotes or backslashes (found ${shown.slice(0, 5).join(' ')})`
  }
  if (!(s.answerType >= 0 && s.answerType < SPEC_ANSWER_TYPES.length)) return 'Unsupported answer type'
  if (s.evidence !== 0 && s.evidence !== 1) return 'Unsupported evidence'
  if (!SPEC_CHAINS.some((c) => c.id === s.chainId)) return 'Unsupported chain'
  if (!Number.isInteger(s.windowHours) || s.windowHours < 1 || s.windowHours > 720) return 'Window must be 1 to 720 hours'
  if (!Number.isInteger(s.panelSize) || s.panelSize < 5 || s.panelSize > 100) return 'Panel must be 5 to 100 agents'
  if (!Number.isInteger(s.quorum) || s.quorum < 4 || s.quorum > s.panelSize || 2 * s.quorum <= s.panelSize)
    return 'Quorum must be at least 4, at most the panel, and a majority of it'
  if (SPEC_ANSWER_TYPES[s.answerType] === 'uint256') {
    if (!Number.isInteger(s.toleranceBps) || s.toleranceBps < 0 || s.toleranceBps > 10_000) return 'Tolerance must be 0 to 10,000 bps'
  } else if (s.toleranceBps !== 0) return 'Tolerance applies to number answers only'
  return null
}

/** The smallest valid quorum for a panel (at least 4 and a strict majority). */
export function minQuorum(panelSize: number): number {
  return Math.max(4, Math.floor(panelSize / 2) + 1)
}
