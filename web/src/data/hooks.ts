import { useQuery } from '@tanstack/react-query'
import { erc20Abi, stringToHex, pad, type Address, type Hex } from 'viem'
import { hmmMineAbi } from '../abi'
import type { PondSeat } from '../pond/types'
import { useApp } from './app'
import { observeBlockTime, observeChainNow } from './clock'
import { devShareCeil, emittedAt, eraAt, nextHalvingAt, rateAt, roundAt, roundEnd, type Schedule } from '../lib/emission'

/** bytes32("oracle.request@oracle-1"): the oracle action the mine buys. */
export const ORACLE_ACTION: Hex = pad(stringToHex('oracle.request@oracle-1'), { size: 32, dir: 'right' })

const intakeAbi = [
  {
    type: 'function',
    name: 'priceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'action', type: 'bytes32' },
      { name: 'asset', type: 'address' },
    ],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
] as const

export interface MineStats {
  reserve: bigint
  genesis: bigint
  baseRate: bigint
  assigned: bigint
  claimed: bigint
  devOwed: bigint
  devPaid: bigint
  questions: bigint
  round: bigint
  roundEndsAt: bigint
  era: bigint
  rate: bigint
  pot: bigint
  roundShares: bigint
  price: bigint
  nextHalvingAt: bigint
  blockNumber: bigint
  blockTime: number
}

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const timestampAbi = [
  { type: 'function', name: 'getCurrentBlockTimestamp', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

/** `stats()` plus the block it was read at; polls. Also measures the chain's clock (pending block timestamp). */
export function useStats() {
  const { client, contracts, cfg } = useApp()
  return useQuery({
    queryKey: ['stats', contracts?.mine],
    enabled: Boolean(contracts),
    refetchInterval: Math.max(3_000, cfg.pollMs * 2),
    queryFn: async (): Promise<MineStats> => {
      const [s, block, pendingTs] = await Promise.all([
        client.readContract({ address: contracts!.mine, abi: hmmMineAbi, functionName: 'stats' }),
        client.getBlock({ blockTag: 'latest' }),
        client
          .readContract({ address: MULTICALL3, abi: timestampAbi, functionName: 'getCurrentBlockTimestamp', blockTag: 'pending' })
          .catch(() => null),
      ])
      if (pendingTs !== null) observeChainNow(Number(pendingTs))
      else observeBlockTime(Number(block.timestamp))
      return { ...s, blockNumber: block.number, blockTime: Number(block.timestamp) }
    },
  })
}

export interface LiveRound {
  live: boolean
  round: bigint
  roundEndsAt: bigint
  era: bigint
  rate: bigint
  perRound: bigint
  nextHalvingAt: bigint
  pot: bigint
  /** IMD of answered questions already sharing the current round. */
  roundShares: bigint
}

/**
 * The current round as of the chain clock, from the schedule. `stats()` is computed at the latest block, which on a
 * quiet chain can be minutes old; this rolls it forward (a round nobody answered has no shares, so its pot is just
 * the schedule minus what answered rounds took).
 */
export function useLiveRound(now: number): LiveRound | null {
  const stats = useStats().data
  const schedule = useSchedule()
  if (!stats || !schedule) return null
  return liveRound(schedule, stats, BigInt(now))
}

/** Pure: the round at chain time `t`, rolling a possibly stale `stats()` snapshot forward (see useLiveRound). */
export function liveRound(
  schedule: Schedule,
  stats: Pick<MineStats, 'round' | 'roundShares' | 'pot' | 'assigned'>,
  t: bigint,
): LiveRound {
  const live = t >= schedule.genesis
  const round = roundAt(schedule, t)
  const sameRound = round === stats.round && live
  const shares = sameRound ? stats.roundShares : 0n
  let pot = 0n
  if (live) {
    if (sameRound) pot = stats.pot
    else {
      const emitted = emittedAt(schedule, roundEnd(schedule, round)) - stats.assigned
      pot = emitted - devShareCeil(emitted, schedule.devBps)
    }
  }
  const rate = rateAt(schedule, live ? t : schedule.genesis)
  return {
    live,
    round,
    roundEndsAt: roundEnd(schedule, round),
    era: eraAt(schedule, t),
    rate,
    perRound: (rate * schedule.roundLength * (10_000n - schedule.devBps)) / 10_000n,
    nextHalvingAt: nextHalvingAt(schedule, t),
    pot,
    roundShares: shares,
  }
}

export interface MineConsts {
  roundLength: bigint
  eraLength: bigint
  devBps: bigint
  dev: Address
  steward: Address
  adapter: Address
  action: Hex
  genesisDelay: bigint
  minBacking: bigint
  fundingWindow: bigint
  maxQuestionBytes: bigint
  configDelay: bigint
  configVersion: number
  pendingAdapter: Address
  pendingAction: Hex
  pendingEta: bigint
  forwarder: Address
}

/** The mine's constants and (slow-changing) configuration. */
export function useMineConsts() {
  const { client, contracts } = useApp()
  return useQuery({
    queryKey: ['consts', contracts?.mine],
    enabled: Boolean(contracts),
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async (): Promise<MineConsts> => {
      const address = contracts!.mine
      // Typed loosely on purpose: one generic call per name keeps the compiler out of a deep instantiation.
      const read = <T,>(functionName: string) =>
        client.readContract({ address, abi: hmmMineAbi, functionName: functionName as never }) as Promise<T>
      const [
        roundLength,
        eraLength,
        devBps,
        dev,
        steward,
        adapter,
        action,
        genesisDelay,
        minBacking,
        fundingWindow,
        maxQuestionBytes,
        configDelay,
        configVersion,
        pendingAdapter,
        pendingAction,
        pendingEta,
        forwarder,
      ] = await Promise.all([
        read<bigint>('roundLength'),
        read<bigint>('eraLength'),
        read<bigint>('devBps'),
        read<Address>('dev'),
        read<Address>('steward'),
        read<Address>('adapter'),
        read<Hex>('action'),
        read<bigint>('genesisDelay'),
        read<bigint>('MIN_BACKING'),
        read<bigint>('FUNDING_WINDOW'),
        read<bigint>('MAX_QUESTION_BYTES'),
        read<bigint>('CONFIG_DELAY'),
        read<number>('configVersion'),
        read<Address>('pendingAdapter'),
        read<Hex>('pendingAction'),
        read<bigint>('pendingEta'),
        read<Address>('forwarder'),
      ])
      return {
        roundLength,
        eraLength,
        devBps,
        dev,
        steward,
        adapter,
        action,
        genesisDelay,
        minBacking,
        fundingWindow,
        maxQuestionBytes,
        configDelay,
        configVersion: Number(configVersion),
        pendingAdapter,
        pendingAction,
        pendingEta,
        forwarder,
      }
    },
  })
}

/** The emission schedule, once stats and constants are in. */
export function useSchedule(): Schedule | null {
  const stats = useStats().data
  const consts = useMineConsts().data
  if (!stats || !consts || stats.genesis === 0n) return null
  return {
    reserve: stats.reserve,
    genesis: stats.genesis,
    baseRate: stats.baseRate,
    roundLength: consts.roundLength,
    eraLength: consts.eraLength,
    devBps: consts.devBps,
  }
}

/** The Intake's current price for an oracle question in IMD (works before launch too). */
export function useIntakePrice() {
  const { client, cfg } = useApp()
  return useQuery({
    queryKey: ['intake-price', cfg.intake, cfg.imd],
    refetchInterval: 60_000,
    queryFn: () =>
      client.readContract({ address: cfg.intake, abi: intakeAbi, functionName: 'priceOf', args: [ORACLE_ACTION, cfg.imd] }),
  })
}

export interface Balances {
  imd: bigint
  hmm: bigint
  allowance: bigint
  eth: bigint
}

/** IMD/HMM/ETH balances and the IMD allowance for the mine. */
export function useBalances(account: Address | undefined) {
  const { client, contracts, cfg } = useApp()
  return useQuery({
    queryKey: ['balances', account, contracts?.mine],
    enabled: Boolean(account),
    refetchInterval: Math.max(4_000, cfg.pollMs * 3),
    queryFn: async (): Promise<Balances> => {
      const [imd, hmm, allowance, eth] = await Promise.all([
        client.readContract({ address: cfg.imd, abi: erc20Abi, functionName: 'balanceOf', args: [account!] }),
        contracts
          ? client.readContract({ address: contracts.hmm, abi: erc20Abi, functionName: 'balanceOf', args: [account!] })
          : Promise.resolve(0n),
        contracts
          ? client.readContract({
              address: cfg.imd,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [account!, contracts.mine],
            })
          : Promise.resolve(0n),
        client.getBalance({ address: account! }),
      ])
      return { imd, hmm, allowance, eth }
    },
  })
}

/** On-chain `claimable(id, who)` for a set of questions (authoritative; the UI also estimates from events). */
export function useClaimable(account: Address | undefined, ids: bigint[]) {
  const { client, contracts, cfg } = useApp()
  const key = ids.map(String).join(',')
  return useQuery({
    queryKey: ['claimable', account, contracts?.mine, key],
    enabled: Boolean(account && contracts && ids.length),
    refetchInterval: Math.max(4_000, cfg.pollMs * 3),
    queryFn: async () => {
      const values = await Promise.all(
        ids.map((id) =>
          client.readContract({
            address: contracts!.mine,
            abi: hmmMineAbi,
            functionName: 'claimable',
            args: [id, account!],
          }),
        ),
      )
      return new Map(ids.map((id, i) => [id.toString(), values[i] as bigint]))
    },
  })
}

/** A block's timestamp (cached forever). */
export function useBlockTime(block: bigint | undefined) {
  const { client } = useApp()
  return useQuery({
    queryKey: ['block-time', block?.toString()],
    enabled: block !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => Number((await client.getBlock({ blockNumber: block! })).timestamp),
  })
}

/* ───────────────────────────── IMD swarm API ───────────────────────────── */

export interface SwarmEvent {
  kind: string
  at: string
  tokenId?: number | null
  step?: string
  role?: string
  state?: string
}

export interface SwarmSnapshot {
  online: number | null
  working: number | null
  seatsEnrolled: number | null
  oraclesLastDay: number | null
  acceptedLastDay: number | null
  jobs: number | null
  launchesLive: number | null
  seats: PondSeat[]
  events: SwarmEvent[]
  at: number
}

type Num = number | null | undefined
interface RawSwarm {
  at?: number
  health?: {
    agentsOnline?: Num
    workingNow?: Num
    seatsEnrolled?: Num
    oraclesDoneLastDay?: Num
    acceptedLastDay?: Num
  }
  counts?: { jobs?: Num; launchesLive?: Num }
  seats?: Record<string, PondSeat> | PondSeat[]
  events?: SwarmEvent[]
}

const num = (v: Num): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The live swarm (api.imd.fun/swarm): online agents, seats, recent activity. Null fields = not reported. */
export function useSwarm() {
  const { cfg } = useApp()
  return useQuery({
    queryKey: ['swarm'],
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 2,
    queryFn: async (): Promise<SwarmSnapshot> => {
      const res = await fetch(`${cfg.imdApi}/swarm`, { referrerPolicy: 'no-referrer' })
      if (!res.ok) throw new Error(`swarm ${res.status}`)
      const raw = (await res.json()) as RawSwarm
      const seatsRaw = Array.isArray(raw.seats) ? raw.seats : Object.values(raw.seats ?? {})
      const seats = seatsRaw
        .filter((s) => typeof s?.tokenId === 'number')
        .map((s) => ({
          tokenId: s.tokenId,
          agentId: s.agentId,
          attempts: s.attempts,
          accepted: s.accepted,
          rejected: s.rejected,
          failed: s.failed,
          last: s.last,
          working: s.working,
        }))
        .sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''))
      return {
        online: num(raw.health?.agentsOnline),
        working: num(raw.health?.workingNow),
        seatsEnrolled: num(raw.health?.seatsEnrolled),
        oraclesLastDay: num(raw.health?.oraclesDoneLastDay),
        acceptedLastDay: num(raw.health?.acceptedLastDay),
        jobs: num(raw.counts?.jobs),
        launchesLive: num(raw.counts?.launchesLive),
        seats,
        events: Array.isArray(raw.events) ? raw.events.slice(0, 60) : [],
        at: typeof raw.at === 'number' ? raw.at : Date.now(),
      }
    },
  })
}

export interface OracleRequest {
  id: string
  status: string
  question: string
  answerType?: string
  createdAt?: string
  attestedAt?: string | null
}

/** Recent oracle questions network-wide (api.imd.fun/oracle/requests). */
export function useOracleFeed(limit = 20) {
  const { cfg } = useApp()
  return useQuery({
    queryKey: ['oracle-feed', limit],
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 2,
    queryFn: async (): Promise<OracleRequest[]> => {
      const res = await fetch(`${cfg.imdApi}/oracle/requests?limit=${limit}`, { referrerPolicy: 'no-referrer' })
      if (!res.ok) throw new Error(`oracle ${res.status}`)
      const raw = (await res.json()) as { requests?: OracleRequest[] }
      return (raw.requests ?? []).filter((r) => typeof r?.id === 'string')
    },
  })
}

export function useOracleCounts() {
  const { cfg } = useApp()
  return useQuery({
    queryKey: ['oracle-counts'],
    refetchInterval: 120_000,
    staleTime: 60_000,
    queryFn: async (): Promise<{ total: number; byStatus: Record<string, number> }> => {
      const res = await fetch(`${cfg.imdApi}/oracle/counts`, { referrerPolicy: 'no-referrer' })
      if (!res.ok) throw new Error(`counts ${res.status}`)
      return (await res.json()) as { total: number; byStatus: Record<string, number> }
    },
  })
}

export interface SweepRow {
  id: bigint
  backing: bigint
  status: number
  round: bigint
  target: bigint
  raised: bigint
  deadline: bigint
  claimable: bigint
}

/**
 * Every question `account` still has IMD in, from views only (`backing`, `question`, `claimable` over all ids), so
 * claims and refunds work even when the RPC cannot serve old logs. Claimed backings read zero and drop out.
 */
export function useChainSweep(account: Address | undefined, enabled: boolean) {
  const { client, contracts } = useApp()
  const questions = useStats().data?.questions
  return useQuery({
    queryKey: ['sweep', contracts?.mine, account, questions?.toString()],
    enabled: Boolean(enabled && account && contracts && questions && questions > 0n),
    staleTime: 30_000,
    queryFn: async (): Promise<SweepRow[]> => {
      const mine = contracts!.mine
      const n = Number(questions)
      const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1))
      const held: { id: bigint; backing: bigint }[] = []
      for (let i = 0; i < ids.length; i += 250) {
        const part = ids.slice(i, i + 250)
        const res = await client.multicall({
          allowFailure: false,
          contracts: part.map((id) => ({ address: mine, abi: hmmMineAbi, functionName: 'backing' as const, args: [id, account!] as const })),
        })
        res.forEach((b, j) => {
          if ((b as bigint) > 0n) held.push({ id: part[j]!, backing: b as bigint })
        })
      }
      if (!held.length) return []
      const [qs, cl] = await Promise.all([
        client.multicall({
          allowFailure: false,
          contracts: held.map((h) => ({ address: mine, abi: hmmMineAbi, functionName: 'question' as const, args: [h.id] as const })),
        }),
        client.multicall({
          allowFailure: false,
          contracts: held.map((h) => ({ address: mine, abi: hmmMineAbi, functionName: 'claimable' as const, args: [h.id, account!] as const })),
        }),
      ])
      return held.map((h, i) => {
        const q = qs[i] as { status: number; round: number; target: bigint; raised: bigint; deadline: bigint }
        return {
          id: h.id,
          backing: h.backing,
          status: Number(q.status),
          round: BigInt(q.round),
          target: q.target,
          raised: q.raised,
          deadline: BigInt(q.deadline),
          claimable: cl[i] as bigint,
        }
      })
    },
  })
}
