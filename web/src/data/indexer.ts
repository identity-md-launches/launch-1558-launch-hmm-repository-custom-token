import { getAddress, parseEventLogs, type Address, type Hex, type PublicClient } from 'viem'
import { hmmMineAbi, swarmOracleAdapterAbi } from '../abi'
import { decodeAnswer, type DecodedAnswer } from '../lib/answer'
import { parseBody, type AnswerType, type OracleBody, ANSWER_TYPES } from '../lib/body'
import { bytes32ToAscii } from '../lib/reasons'
import { isHistoryLimit, RECENT_LOG_WINDOW } from './rpcErrors'

/**
 * Reads the mine's and its adapters' events from `deployBlock` in chunks, keeps everything in memory and polls for
 * new blocks. Everything the app shows about questions, rounds, backers and answers is derived from these logs, so
 * nothing is invented: before the first sync finishes the UI shows a loading state.
 */

export type QuestionStatus = 'open' | 'asked' | 'answered' | 'failed'

export interface LogRef {
  block: bigint
  tx: Hex
  logIndex: number
}

export interface QuestionRec {
  id: bigint
  proposer: Address
  target: bigint
  deadline: bigint
  bodyHex: Hex
  json: string
  body: Partial<OracleBody> | null
  text: string
  answerType: AnswerType | null
  raised: bigint
  /** IMD each backer put in (cumulative, never reduced: it is the share basis). */
  backed: Map<Address, bigint>
  refunded: Map<Address, bigint>
  claimed: Map<Address, bigint>
  status: QuestionStatus
  requestId?: Hex
  adapter?: Address
  round?: bigint
  shares?: bigint
  answer?: {
    decoded: DecodedAnswer
    answerType: number
    panelSize: number
    quorum: number
    agreed: number
    oracleRequestId: Hex
    chainId: bigint
  }
  failure?: {
    status: number
    reason: string
    agreed?: number
    answered?: number
    oracleRequestId?: Hex
  }
  proposed: LogRef
  asked?: LogRef
  settled?: LogRef
  /** Monotonic ordering key for "newest first". */
  order: number
}

export interface RoundRec {
  round: bigint
  emitted: bigint
  devShare: bigint
  reward: bigint
  shares: bigint
  questionIds: bigint[]
  opened: LogRef
}

export type FeedKind =
  | 'started'
  | 'proposed'
  | 'backed'
  | 'asked'
  | 'answered'
  | 'failed'
  | 'refunded'
  | 'claimed'
  | 'round'
  | 'devpaid'
  | 'config'

export interface FeedItem extends LogRef {
  key: string
  kind: FeedKind
  id?: bigint
  who?: Address
  amount?: bigint
  round?: bigint
  /** Arrived after the initial sync (animate it). */
  live: boolean
}

export interface MineConfigState {
  steward: Address | null
  pending: { adapter: Address; action: Hex; eta: bigint } | null
  applied: { adapter: Address; action: Hex; ref: LogRef }[]
}

export interface Totals {
  proposed: number
  asked: number
  answered: number
  failed: number
  open: number
  imdPaidToSwarm: bigint
  imdRaisedOpen: bigint
  uniqueMiners: number
  uniqueBackers: number
  hmmClaimed: bigint
  hmmAssigned: bigint
  devPaid: bigint
}

export interface IndexState {
  status: 'idle' | 'syncing' | 'live' | 'error'
  error: string | null
  /** 0..1 while catching up from deployBlock. */
  progress: number
  syncedTo: bigint
  head: bigint
  /** Set when the RPC would not serve the mine's older logs: events before this block are missing. */
  historyFrom: bigint | null
  started: { reserve: bigint; genesis: bigint; baseRate: bigint } | null
  questions: Map<string, QuestionRec>
  byRequest: Map<string, string>
  rounds: Map<string, RoundRec>
  feed: FeedItem[]
  config: MineConfigState
  totals: Totals
  version: number
}

const FEED_CAP = 300
const eventsAbi = [...hmmMineAbi, ...swarmOracleAdapterAbi].filter((x) => x.type === 'event')

function emptyTotals(): Totals {
  return {
    proposed: 0,
    asked: 0,
    answered: 0,
    failed: 0,
    open: 0,
    imdPaidToSwarm: 0n,
    imdRaisedOpen: 0n,
    uniqueMiners: 0,
    uniqueBackers: 0,
    hmmClaimed: 0n,
    hmmAssigned: 0n,
    devPaid: 0n,
  }
}

function add(map: Map<Address, bigint>, who: Address, amount: bigint) {
  map.set(who, (map.get(who) ?? 0n) + amount)
}

export interface IndexerOptions {
  client: PublicClient
  mine: Address
  adapter: Address | null
  deployBlock: bigint
  chunk: bigint
  pollMs: number
}

type Listener = () => void
type LiveListener = (items: FeedItem[]) => void

export class MineIndexer {
  readonly state: IndexState = {
    status: 'idle',
    error: null,
    progress: 0,
    syncedTo: 0n,
    head: 0n,
    historyFrom: null,
    started: null,
    questions: new Map(),
    byRequest: new Map(),
    rounds: new Map(),
    feed: [],
    config: { steward: null, pending: null, applied: [] },
    totals: emptyTotals(),
    version: 0,
  }

  private listeners = new Set<Listener>()
  private liveListeners = new Set<LiveListener>()
  private adapters = new Set<string>()
  private chunk: bigint
  private readonly maxChunk: bigint
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private syncing = false
  private initialDone = false
  private failures = 0
  private again = false

  constructor(private readonly opts: IndexerOptions) {
    this.chunk = opts.chunk
    this.maxChunk = opts.chunk * 4n
    if (opts.adapter) this.adapters.add(opts.adapter.toLowerCase())
    this.state.syncedTo = opts.deployBlock > 0n ? opts.deployBlock - 1n : 0n
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getVersion = (): number => this.state.version

  /** Called with feed items that arrive after the initial sync, in chain order. */
  onLive(fn: LiveListener): () => void {
    this.liveListeners.add(fn)
    return () => this.liveListeners.delete(fn)
  }

  start() {
    this.stopped = false
    void this.tick()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Poll now (e.g. right after the user's own transaction is mined); queued if a poll is in flight. */
  refresh() {
    if (this.syncing) {
      this.again = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    void this.tick()
  }

  private emit() {
    this.state.version++
    for (const fn of this.listeners) fn()
  }

  private schedule(ms: number) {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    const hidden = typeof document !== 'undefined' && document.hidden
    this.timer = setTimeout(() => void this.tick(), hidden ? Math.max(ms, 30_000) : ms)
  }

  private async tick() {
    if (this.syncing || this.stopped) return
    this.syncing = true
    try {
      const head = await this.opts.client.getBlockNumber({ cacheTime: 0 })
      this.state.head = head
      if (!this.initialDone) {
        this.state.status = 'syncing'
        this.emit()
      }
      const from0 = this.state.syncedTo + 1n
      const total = head >= from0 ? head - from0 + 1n : 0n
      let from = from0
      while (from <= head && !this.stopped) {
        const to = from + this.chunk - 1n > head ? head : from + this.chunk - 1n
        try {
          await this.fetchRange(from, to)
          this.state.syncedTo = to
          from = to + 1n
          if (this.chunk < this.maxChunk) this.chunk *= 2n
          if (!this.initialDone && total > 0n) this.state.progress = Number(to - from0 + 1n) / Number(total)
          this.emit()
        } catch (e) {
          if (this.chunk > 200n) {
            this.chunk /= 2n
            continue
          }
          if (!this.initialDone && isHistoryLimit(e) && head > RECENT_LOG_WINDOW && from < head - RECENT_LOG_WINDOW) {
            // The endpoint does not serve logs this old: index the recent window it does serve, and say so.
            from = head - RECENT_LOG_WINDOW
            this.state.syncedTo = from - 1n
            this.state.historyFrom = from
            this.chunk = this.opts.chunk
            continue
          }
          throw e
        }
      }
      this.failures = 0
      if (!this.initialDone) {
        this.initialDone = true
        this.state.progress = 1
      }
      this.state.status = 'live'
      this.state.error = null
      this.emit()
      this.schedule(this.opts.pollMs)
    } catch (e) {
      this.failures++
      this.state.status = this.initialDone ? 'live' : 'error'
      this.state.error = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e)
      this.emit()
      this.schedule(Math.min(60_000, this.opts.pollMs * 2 ** Math.min(this.failures, 5)))
    } finally {
      this.syncing = false
      if (this.again && !this.stopped) {
        this.again = false
        if (this.timer) clearTimeout(this.timer)
        void this.tick()
      }
    }
  }

  private async getLogs(addresses: Address[], from: bigint, to: bigint) {
    return this.opts.client.getLogs({ address: addresses, fromBlock: from, toBlock: to })
  }

  private async fetchRange(from: bigint, to: bigint) {
    const known = [this.opts.mine, ...[...this.adapters].map((a) => getAddress(a))]
    let logs = await this.getLogs(known, from, to)
    let parsed = parseEventLogs({ abi: eventsAbi, logs, strict: false })
    // An adapter seen for the first time in this range (a question asked through it, or a new config) may have
    // logged in the same range too: fetch it before processing, so its answers are not missed.
    const fresh = new Set<string>()
    for (const l of parsed) {
      if (l.address.toLowerCase() !== this.opts.mine.toLowerCase()) continue
      const a =
        l.eventName === 'Asked' || l.eventName === 'ConfigApplied'
          ? ((l.args as { adapter?: Address }).adapter ?? null)
          : null
      if (a && !this.adapters.has(a.toLowerCase())) fresh.add(a.toLowerCase())
    }
    if (fresh.size) {
      for (const a of fresh) this.adapters.add(a)
      const extra = await this.getLogs([...fresh].map((a) => getAddress(a)), from, to)
      logs = [...logs, ...extra]
      parsed = parseEventLogs({ abi: eventsAbi, logs, strict: false })
    }
    parsed.sort((a, b) =>
      a.blockNumber === b.blockNumber ? (a.logIndex ?? 0) - (b.logIndex ?? 0) : a.blockNumber! < b.blockNumber! ? -1 : 1,
    )
    const live: FeedItem[] = []
    for (const l of parsed) {
      const item = this.apply(l as unknown as ParsedLog)
      if (item) {
        item.live = this.initialDone
        this.state.feed.unshift(item)
        if (item.live) live.push(item)
      }
    }
    if (this.state.feed.length > FEED_CAP) this.state.feed.length = FEED_CAP
    this.recompute()
    if (live.length) for (const fn of this.liveListeners) fn(live)
  }

  private apply(l: ParsedLog): FeedItem | null {
    const isMine = l.address.toLowerCase() === this.opts.mine.toLowerCase()
    const ref: LogRef = { block: l.blockNumber, tx: l.transactionHash, logIndex: l.logIndex }
    const key = `${l.transactionHash}:${l.logIndex}`
    const order = Number(l.blockNumber) * 10_000 + l.logIndex
    const a = l.args as Record<string, unknown>
    const s = this.state
    const item = (kind: FeedKind, extra: Partial<FeedItem> = {}): FeedItem => ({ key, kind, live: false, ...ref, ...extra })

    if (isMine) {
      switch (l.eventName) {
        case 'Started': {
          s.started = { reserve: a.reserve as bigint, genesis: a.genesis as bigint, baseRate: a.baseRate as bigint }
          return item('started', { amount: a.reserve as bigint })
        }
        case 'Proposed': {
          const id = a.id as bigint
          const bodyHex = a.body as Hex
          const { json, body } = parseBody(bodyHex)
          const t = body?.answerType
          s.questions.set(id.toString(), {
            id,
            proposer: a.proposer as Address,
            target: a.target as bigint,
            deadline: a.deadline as bigint,
            bodyHex,
            json,
            body,
            text: typeof body?.question === 'string' ? body.question : json,
            answerType: t && (ANSWER_TYPES as readonly string[]).includes(t) ? (t as AnswerType) : null,
            raised: 0n,
            backed: new Map(),
            refunded: new Map(),
            claimed: new Map(),
            status: 'open',
            proposed: ref,
            order,
          })
          return item('proposed', { id, who: a.proposer as Address, amount: a.target as bigint })
        }
        case 'Backed': {
          const id = a.id as bigint
          const q = s.questions.get(id.toString())
          if (q) {
            add(q.backed, a.backer as Address, a.amount as bigint)
            q.raised = a.raised as bigint
          }
          return item('backed', { id, who: a.backer as Address, amount: a.amount as bigint })
        }
        case 'Asked': {
          const id = a.id as bigint
          const q = s.questions.get(id.toString())
          if (q) {
            q.status = 'asked'
            q.requestId = a.requestId as Hex
            q.adapter = a.adapter as Address
            q.asked = ref
            s.byRequest.set((a.requestId as Hex).toLowerCase(), id.toString())
          }
          return item('asked', { id, amount: q?.target })
        }
        case 'RoundOpened': {
          const r = a.round as bigint
          const emitted = a.emitted as bigint
          const devShare = a.devShare as bigint
          s.rounds.set(r.toString(), {
            round: r,
            emitted,
            devShare,
            reward: emitted - devShare,
            shares: 0n,
            questionIds: [],
            opened: ref,
          })
          return item('round', { round: r, amount: emitted - devShare })
        }
        case 'Answered': {
          const id = a.id as bigint
          const r = a.round as bigint
          const q = s.questions.get(id.toString())
          if (q) {
            q.status = 'answered'
            q.round = r
            q.shares = a.shares as bigint
            q.settled = ref
          }
          const round = s.rounds.get(r.toString())
          if (round) {
            round.shares += a.shares as bigint
            round.questionIds.push(id)
          }
          return item('answered', { id, round: r })
        }
        case 'Failed': {
          const id = a.id as bigint
          const q = s.questions.get(id.toString())
          if (q) {
            q.status = 'failed'
            q.settled = ref
            q.failure = { status: Number(a.status), reason: bytes32ToAscii(a.reason as Hex) }
          }
          return item('failed', { id })
        }
        case 'Refunded': {
          const id = a.id as bigint
          const q = s.questions.get(id.toString())
          if (q) {
            add(q.refunded, a.backer as Address, a.amount as bigint)
            q.raised -= a.amount as bigint
          }
          return item('refunded', { id, who: a.backer as Address, amount: a.amount as bigint })
        }
        case 'Claimed': {
          const id = a.id as bigint
          const q = s.questions.get(id.toString())
          if (q) add(q.claimed, a.backer as Address, a.amount as bigint)
          return item('claimed', { id, who: a.backer as Address, amount: a.amount as bigint })
        }
        case 'DevPaid':
          return item('devpaid', { who: a.dev as Address, amount: a.amount as bigint })
        case 'StewardChanged':
          s.config.steward = (a.next as Address) === '0x0000000000000000000000000000000000000000' ? null : (a.next as Address)
          return null
        case 'ConfigQueued':
          s.config.pending = { adapter: a.adapter as Address, action: a.action as Hex, eta: a.eta as bigint }
          return item('config')
        case 'ConfigCancelled':
          s.config.pending = null
          return item('config')
        case 'ConfigApplied':
          s.config.pending = null
          s.config.applied.push({ adapter: a.adapter as Address, action: a.action as Hex, ref })
          return null
        default:
          return null
      }
    }

    // adapter events, joined to questions by the Intake request id
    const rid = (a.requestId as Hex | undefined)?.toLowerCase()
    const qid = rid ? s.byRequest.get(rid) : undefined
    const q = qid ? s.questions.get(qid) : undefined
    if (!q) return null
    switch (l.eventName) {
      case 'Thought': {
        const type = Number(a.answerType)
        q.answer = {
          decoded: decodeAnswer(type, a.answer as Hex, a.answerHash as Hex | undefined),
          answerType: type,
          panelSize: Number(a.panelSize),
          quorum: Number(a.quorum),
          agreed: Number(a.agreed),
          oracleRequestId: a.oracleRequestId as Hex,
          chainId: a.chainId as bigint,
        }
        return null
      }
      case 'Rejected':
        q.failure = { ...(q.failure ?? { status: 3 }), reason: bytes32ToAscii(a.reason as Hex), oracleRequestId: a.oracleRequestId as Hex }
        return null
      case 'Unanswered':
        q.failure = {
          ...(q.failure ?? { status: Number(a.status) }),
          reason: bytes32ToAscii(a.reason as Hex),
          agreed: Number(a.agreed),
          answered: Number(a.answered),
        }
        return null
      default:
        return null
    }
  }

  private recompute() {
    const t = emptyTotals()
    const miners = new Set<string>()
    const backers = new Set<string>()
    for (const q of this.state.questions.values()) {
      t.proposed++
      for (const who of q.backed.keys()) backers.add(who.toLowerCase())
      for (const v of q.claimed.values()) t.hmmClaimed += v
      if (q.status === 'open') {
        t.open++
        t.imdRaisedOpen += q.raised
      } else {
        t.asked++
        t.imdPaidToSwarm += q.target
      }
      if (q.status === 'answered') {
        t.answered++
        for (const who of q.backed.keys()) miners.add(who.toLowerCase())
      }
      if (q.status === 'failed') t.failed++
    }
    for (const r of this.state.rounds.values()) t.hmmAssigned += r.emitted
    for (const f of this.state.feed) if (f.kind === 'devpaid' && f.amount) t.devPaid += f.amount
    t.uniqueMiners = miners.size
    t.uniqueBackers = backers.size
    this.state.totals = t
  }
}

interface ParsedLog {
  eventName: string
  args: unknown
  address: Address
  blockNumber: bigint
  transactionHash: Hex
  logIndex: number
}

/* ───────────────────────────── queries over the state ───────────────────────────── */

export function questionsByStatus(s: IndexState, status: QuestionStatus): QuestionRec[] {
  return [...s.questions.values()].filter((q) => q.status === status).sort((a, b) => b.order - a.order)
}

export function allQuestions(s: IndexState): QuestionRec[] {
  return [...s.questions.values()].sort((a, b) => b.order - a.order)
}

/** Net IMD `who` still has in question `q` (backed − refunded). Claims do not change it in this view. */
export function netBacking(q: QuestionRec, who: Address): bigint {
  const key = [...q.backed.keys()].find((k) => k.toLowerCase() === who.toLowerCase())
  if (!key) return 0n
  const refunded = [...q.refunded.entries()].find(([k]) => k.toLowerCase() === who.toLowerCase())?.[1] ?? 0n
  return (q.backed.get(key) ?? 0n) - refunded
}

export function claimedBy(q: QuestionRec, who: Address): bigint {
  return [...q.claimed.entries()].find(([k]) => k.toLowerCase() === who.toLowerCase())?.[1] ?? 0n
}

export function questionsBackedBy(s: IndexState, who: Address): QuestionRec[] {
  const w = who.toLowerCase()
  return allQuestions(s).filter((q) => [...q.backed.keys()].some((k) => k.toLowerCase() === w))
}

export function roundsNewestFirst(s: IndexState): RoundRec[] {
  return [...s.rounds.values()].sort((a, b) => (a.round < b.round ? 1 : -1))
}
