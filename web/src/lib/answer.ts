import { decodeAbiParameters, getAddress, type Address, type Hex } from 'viem'
import { ANSWER_TYPES, type AnswerType } from './body'
import { formatInt, shortAddress, shortHex } from './format'

/** An answer as the adapter's `Thought` event carries it: `answerType` and `abi.encode(value)`. */
export type DecodedAnswer =
  | { type: 'bool'; value: boolean }
  | { type: 'address'; value: Address }
  | { type: 'bytes32'; value: Hex }
  | { type: 'uint256'; value: bigint }
  | { type: 'address[]'; value: readonly Address[] }
  | { type: 'bytes32[]'; value: readonly Hex[] }
  | { type: 'unknown'; value: Hex; answerType: number }
  /** The adapter leaves `answer` empty when it is longer than 128 bytes; only its hash is on chain. */
  | { type: 'withheld'; hash: Hex; answerType: number }

export function answerTypeName(code: number): AnswerType | null {
  return ANSWER_TYPES[code] ?? null
}

export function answerTypeCode(type: AnswerType): number {
  return ANSWER_TYPES.indexOf(type)
}

/** Decodes `abi.encode(value)` for the answer type code (bool 0, address 1, bytes32 2, uint256 3, address[] 4,
 * bytes32[] 5). Malformed data or an unknown type yields `{type: 'unknown'}` instead of throwing. */
export function decodeAnswer(answerType: number, data: Hex, answerHash?: Hex): DecodedAnswer {
  if ((data === '0x' || data === '0x0') && answerHash) return { type: 'withheld', hash: answerHash, answerType }
  const type = answerTypeName(answerType)
  if (!type) return { type: 'unknown', value: data, answerType }
  try {
    const [value] = decodeAbiParameters([{ type }], data)
    switch (type) {
      case 'bool':
        return { type, value: value as boolean }
      case 'address':
        return { type, value: getAddress(value as Address) }
      case 'bytes32':
        return { type, value: value as Hex }
      case 'uint256':
        return { type, value: value as bigint }
      case 'address[]':
        return { type, value: (value as readonly Address[]).map((a) => getAddress(a)) }
      case 'bytes32[]':
        return { type, value: value as readonly Hex[] }
    }
  } catch {
    return { type: 'unknown', value: data, answerType }
  }
}

/** A short label for an answer: "yes", "no", "1,234", "0xabcd…1234", "3 addresses". */
export function answerLabel(a: DecodedAnswer): string {
  switch (a.type) {
    case 'bool':
      return a.value ? 'yes' : 'no'
    case 'uint256':
      return a.value < 10n ** 15n ? formatInt(a.value) : compactBig(a.value)
    case 'address':
      return shortAddress(a.value)
    case 'bytes32':
      return shortHex(a.value)
    case 'address[]':
      return a.value.length === 1 ? shortAddress(a.value[0]!) : `${a.value.length} addresses`
    case 'bytes32[]':
      return a.value.length === 1 ? shortHex(a.value[0]!) : `${a.value.length} values`
    case 'unknown':
      return 'undecodable answer'
    case 'withheld':
      return 'long answer (hash only)'
  }
}

/** The full answer as text: exact numbers and full addresses. */
export function answerText(a: DecodedAnswer): string {
  switch (a.type) {
    case 'bool':
      return a.value ? 'yes (true)' : 'no (false)'
    case 'uint256':
      return formatInt(a.value)
    case 'address':
    case 'bytes32':
      return a.value
    case 'address[]':
    case 'bytes32[]':
      return a.value.length ? a.value.join('\n') : '(empty list)'
    case 'unknown':
      return `type ${a.answerType}: ${a.value}`
    case 'withheld':
      return `The answer is longer than 128 bytes, so only its hash is on chain: ${a.hash}`
  }
}

function compactBig(v: bigint): string {
  const s = v.toString()
  return `${s[0]}.${s.slice(1, 4)}e${s.length - 1}`
}
