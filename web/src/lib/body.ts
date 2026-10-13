import { getAddress, hexToString, isAddress, isHex } from 'viem'
import { specBody, specFor, type SpecAnswerType } from './spec'

/**
 * Oracle question bodies: the exact JSON the mine sends to the IMD Intake (`oracle.request@oracle-1`).
 * The bytes go on chain for good (in the `Proposed` event) and their keccak is what `back` checks, so they are built
 * deterministically here: same inputs, same bytes.
 */

export const ANSWER_TYPES = ['bool', 'address', 'bytes32', 'uint256', 'address[]', 'bytes32[]'] as const
export type AnswerType = (typeof ANSWER_TYPES)[number]

export const MAX_BODY_BYTES = 16_384
export const MAX_QUESTION_CHARS = 2_000

export interface OracleBody {
  v: 1
  question: string
  chainId: number
  window: { hours: number } | { fromBlock: number; toBlock: number }
  answerType: AnswerType
  evidence: string
  panelSize: number
  quorum: number
  validForSeconds: number
  toleranceBps?: number
  [extra: string]: unknown
}

/** The body the mine composes for a question with the template defaults (24h window on Ethereum mainnet, chain
 * evidence, a panel of 5 with quorum 4); see spec.ts for the general form. */
export function buildBody(question: string, answerType: AnswerType): string {
  return specBody(specFor(question, answerType as SpecAnswerType))
}

const encoder = new TextEncoder()

export function bodyBytes(json: string): Uint8Array {
  return encoder.encode(json)
}

/** UTF-8 byte length (what the 16,384-byte limit counts). */
export function byteLength(json: string): number {
  return encoder.encode(json).length
}

export function bodyFits(json: string): boolean {
  const n = byteLength(json)
  return n > 0 && n <= MAX_BODY_BYTES
}

/** Reads a body back from chain bytes (hex) or a string. Returns null when it is not a JSON object. */
export function parseBody(input: string): { json: string; body: Partial<OracleBody> | null } {
  let json = input
  if (isHex(input)) {
    try {
      json = hexToString(input)
    } catch {
      return { json: input, body: null }
    }
  }
  try {
    const v = JSON.parse(json) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return { json, body: v as Partial<OracleBody> }
  } catch {
    /* not JSON */
  }
  return { json, body: null }
}

/* ───────────────────────────── template fields ───────────────────────────── */

export type FieldKind = 'address' | 'uint' | 'bytes32' | 'event' | 'decimals'

export interface Preset {
  label: string
  value: string
  note?: string
}

export interface TemplateField {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  help?: string
  presets?: Preset[]
  /** For `uint` amounts entered in whole units: the field holding the token decimals (or a fixed number). */
  unitHelper?: { decimals: number | string; symbol?: string }
  initial?: string
}

export interface Template {
  id: string
  title: string
  blurb: string
  answerType: AnswerType
  fields: TemplateField[]
  /** The question for validated values (keys of `fields`). */
  question(v: Record<string, string>): string
}

export type FieldCheck = { ok: true; value: string } | { ok: false; error: string }

const EVENT_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const SIZES = '(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)'
const TYPE_RE = new RegExp(`^(?:address|bool|string|bytes(?:[1-9]|[12]\\d|3[0-2])?|u?int${SIZES}?)(?:\\[\\d*\\])*$`)

/** `Name(type,type)` with canonical Solidity types; spaces after commas are tolerated and removed. */
function normalizeEvent(value: string): string | null {
  const m = /^([^()\s]+)\((.*)\)$/.exec(value.trim())
  if (!m || !EVENT_NAME_RE.test(m[1]!)) return null
  const params = m[2]!.trim() === '' ? [] : m[2]!.split(',').map((p) => p.trim())
  if (!params.every((p) => TYPE_RE.test(p))) return null
  return `${m[1]}(${params.join(',')})`
}
const UINT_MAX = 2n ** 256n - 1n

/** Validates and normalizes a field value (checksummed addresses, lowercase ids, canonical integers). */
export function checkField(kind: FieldKind, raw: string): FieldCheck {
  const value = raw.trim()
  if (!value) return { ok: false, error: 'Required' }
  switch (kind) {
    case 'address': {
      if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return { ok: false, error: 'Expected a 0x… address (40 hex characters)' }
      if (!isAddress(value, { strict: false })) return { ok: false, error: 'Not a valid address' }
      // A mixed-case address must carry a valid checksum; all-lower/upper is accepted and checksummed.
      const mixed = /[a-f]/.test(value.slice(2)) && /[A-F]/.test(value.slice(2))
      if (mixed && !isAddress(value, { strict: true })) return { ok: false, error: 'Checksum mismatch: check for a typo' }
      if (/^0x0{40}$/.test(value)) return { ok: false, error: 'The zero address is not a contract or holder' }
      return { ok: true, value: getAddress(value) }
    }
    case 'uint': {
      if (!/^\d+$/.test(value)) return { ok: false, error: 'Whole number, digits only' }
      const n = BigInt(value)
      if (n > UINT_MAX) return { ok: false, error: 'Too large for uint256' }
      return { ok: true, value: n.toString() }
    }
    case 'decimals': {
      if (!/^\d{1,2}$/.test(value) || Number(value) > 36) return { ok: false, error: '0 to 36' }
      return { ok: true, value: String(Number(value)) }
    }
    case 'bytes32': {
      if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return { ok: false, error: 'Expected 0x and 64 hex characters' }
      return { ok: true, value: value.toLowerCase() }
    }
    case 'event': {
      const normalized = normalizeEvent(value)
      if (!normalized) return { ok: false, error: 'Canonical signature, e.g. Transfer(address,address,uint256)' }
      return { ok: true, value: normalized }
    }
  }
}

/* ───────────────────────────── presets ───────────────────────────── */

export const IMD_TOKEN = '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7'
export const SIMD_VAULT = getAddress('0x9efa934d9fad4ae28c998a40195646b965a97247')
export const IMD_V4_POOL_ID = '0x415829f72e9f54531c26eae76f107618540e898a45d6ae35959e143f5faca704'
export const V4_POOL_MANAGER = '0x000000000004444c5dc75cb358380d2e3de08a90'

export const EVENT_PRESETS: Preset[] = [
  { label: 'Transfer', value: 'Transfer(address,address,uint256)', note: 'ERC-20 / ERC-721 transfers' },
  { label: 'Approval', value: 'Approval(address,address,uint256)', note: 'ERC-20 approvals' },
  { label: 'Deposit (ERC-4626)', value: 'Deposit(address,address,uint256,uint256)', note: 'vault deposits' },
  { label: 'Withdraw (ERC-4626)', value: 'Withdraw(address,address,address,uint256,uint256)', note: 'vault withdrawals' },
]

export function tokenPresets(extra: Preset[] = []): Preset[] {
  return [
    { label: 'IMD', value: IMD_TOKEN, note: 'the Identity.md token' },
    { label: 'sIMD vault', value: SIMD_VAULT, note: 'staked IMD' },
    ...extra,
  ]
}

/* ───────────────────────────── the vetted templates ───────────────────────────── */

/**
 * Question templates whose wording passed the swarm's check (2026-10-12). Keep the structure; only the parameters
 * change. Each names the chain, the window and the exact quantity, so a panel reads it one way.
 */
export function templates(extraTokens: Preset[] = []): Template[] {
  const tokens = tokenPresets(extraTokens)
  return [
    {
      id: 'log-count',
      title: 'Count events',
      blurb: 'How many times a contract emitted an event in the last 24 hours.',
      answerType: 'uint256',
      fields: [
        { key: 'event', label: 'Event', kind: 'event', presets: EVENT_PRESETS, initial: EVENT_PRESETS[0]!.value },
        { key: 'address', label: 'Contract', kind: 'address', placeholder: '0x…', presets: tokens, initial: IMD_TOKEN },
      ],
      question: (v) =>
        `How many ${v.event} logs did the contract ${v.address} emit on Ethereum mainnet from the window's first block through its last block, inclusive?`,
    },
    {
      id: 'log-threshold',
      title: 'More events than…?',
      blurb: 'Did a contract emit more than N events in the last 24 hours? (yes/no)',
      answerType: 'bool',
      fields: [
        { key: 'address', label: 'Contract', kind: 'address', placeholder: '0x…', presets: tokens, initial: IMD_TOKEN },
        { key: 'n', label: 'More than', kind: 'uint', placeholder: '100', initial: '100' },
        { key: 'event', label: 'Event', kind: 'event', presets: EVENT_PRESETS, initial: EVENT_PRESETS[0]!.value },
      ],
      question: (v) =>
        `From the window's first block through its last block on Ethereum mainnet, did the contract ${v.address} emit more than ${v.n} ${v.event} logs?`,
    },
    {
      id: 'balance-threshold',
      title: 'Token balance above…?',
      blurb: "Was an address's ERC-20 balance above a line at the window's close? (yes/no)",
      answerType: 'bool',
      fields: [
        { key: 'holder', label: 'Holder', kind: 'address', placeholder: '0x…', presets: [{ label: 'sIMD vault', value: SIMD_VAULT }] },
        { key: 'token', label: 'Token', kind: 'address', placeholder: '0x…', presets: tokens, initial: IMD_TOKEN },
        {
          key: 'raw',
          label: 'Greater than (raw units)',
          kind: 'uint',
          placeholder: '1000000000000000000000',
          help: 'Raw units: 1 token with 18 decimals is 1 followed by 18 zeros.',
          unitHelper: { decimals: 18 },
        },
      ],
      question: (v) =>
        `At the window's closing block, was balanceOf(${v.holder}) on the ERC-20 contract ${v.token} on Ethereum mainnet greater than ${v.raw} (raw units)?`,
    },
    {
      id: 'supply-threshold',
      title: 'Total supply above…?',
      blurb: "Was a token's totalSupply() above a line at the window's close? (yes/no)",
      answerType: 'bool',
      fields: [
        { key: 'token', label: 'Token', kind: 'address', placeholder: '0x…', presets: tokens, initial: IMD_TOKEN },
        { key: 'decimals', label: 'Token decimals', kind: 'decimals', initial: '18' },
        {
          key: 'raw',
          label: 'Greater than (raw units)',
          kind: 'uint',
          placeholder: '1000000000000000000000000',
          unitHelper: { decimals: 'decimals' },
        },
      ],
      question: (v) =>
        `At the window's closing block, was totalSupply() of the ERC-20 contract ${v.token} on Ethereum mainnet greater than ${v.raw} (raw units, ${v.decimals} decimals)?`,
    },
    {
      id: 'eth-balance',
      title: 'ETH balance above…?',
      blurb: "Did an address hold more than X ETH at the window's close? (yes/no)",
      answerType: 'bool',
      fields: [
        { key: 'address', label: 'Address', kind: 'address', placeholder: '0x…', presets: [{ label: 'sIMD vault', value: SIMD_VAULT }] },
        {
          key: 'wei',
          label: 'Greater than (wei)',
          kind: 'uint',
          placeholder: '1000000000000000000',
          help: '1 ETH = 1000000000000000000 wei.',
          unitHelper: { decimals: 18, symbol: 'ETH' },
        },
      ],
      question: (v) =>
        `At the window's closing block, was the native ETH balance of address ${v.address} on Ethereum mainnet greater than ${v.wei} wei?`,
    },
    {
      id: 'pool-price',
      title: 'Uniswap v4 pool price',
      blurb: "A v4 pool's sqrtPriceX96 at the window's close (a number).",
      answerType: 'uint256',
      fields: [
        {
          key: 'poolId',
          label: 'Pool id',
          kind: 'bytes32',
          placeholder: '0x… (32 bytes)',
          presets: [{ label: 'IMD v4 pool', value: IMD_V4_POOL_ID }],
          initial: IMD_V4_POOL_ID,
        },
      ],
      question: (v) =>
        `What was sqrtPriceX96 of Uniswap v4 pool ${v.poolId} in the Ethereum mainnet PoolManager ${V4_POOL_MANAGER} at the window's closing block?`,
    },
  ]
}

/** Validates every field of a template; returns the question when all pass. */
export function fillTemplate(
  t: Template,
  values: Record<string, string>,
): { question: string | null; errors: Record<string, string>; normalized: Record<string, string> } {
  const errors: Record<string, string> = {}
  const normalized: Record<string, string> = {}
  for (const f of t.fields) {
    const r = checkField(f.kind, values[f.key] ?? '')
    if (r.ok) normalized[f.key] = r.value
    else errors[f.key] = r.error
  }
  return { question: Object.keys(errors).length ? null : t.question(normalized), errors, normalized }
}

/** Whole units → raw units string ("1.5", 18 → "1500000000000000000"); null if invalid. */
export function toRawUnits(amount: string, decimals: number): string | null {
  const s = amount.trim().replace(/,/g, '')
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const [w = '0', f = ''] = s.split('.')
  if (f.length > decimals) return null
  const raw = BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0') || '0')
  return raw.toString()
}

/** A free-form question is acceptable to send only with these basics (the check proxy judges the wording). */
export function checkFreeform(question: string): string | null {
  const q = question.trim()
  if (q.length < 12) return 'Too short to be one clear question'
  if (q.length > MAX_QUESTION_CHARS) return `At most ${MAX_QUESTION_CHARS.toLocaleString()} characters`
  return null
}
