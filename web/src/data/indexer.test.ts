import { describe, expect, it } from 'vitest'
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  pad,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { hmmMineAbi, swarmOracleAdapterAbi } from '../abi'
import { MineIndexer } from './indexer'
import { earningOf, leaderboard } from './mining'
import { specBody, specFor } from '../lib/spec'

const MINE: Address = '0x00000000000000000000000000000000000000aa'
const ADAPTER: Address = '0x00000000000000000000000000000000000000bb'
const ALICE: Address = getAddress('0x000000000000000000000000000000000000a11c')
const BOB: Address = getAddress('0x0000000000000000000000000000000000000b0b')
const E18 = 10n ** 18n

type RawLog = { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; logIndex: number; transactionHash: Hex }

function mineLog(eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex = 0): RawLog {
  return encode(hmmMineAbi, MINE, eventName, args, blockNumber, logIndex)
}

function adapterLog(eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex = 0): RawLog {
  return encode(swarmOracleAdapterAbi, ADAPTER, eventName, args, blockNumber, logIndex)
}

// Encodes an event the way a node returns it: indexed args in topics, the rest ABI-encoded in data.
function encode(abi: readonly unknown[], address: Address, eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex: number): RawLog {
  const item = (abi as { type: string; name: string; inputs: { name: string; type: string; indexed?: boolean }[] }[]).find(
    (x) => x.type === 'event' && x.name === eventName,
  )!
  const topics = (encodeEventTopics as (p: unknown) => Hex[])({ abi: [item], eventName, args })
  const plain = item.inputs.filter((i) => !i.indexed)
  const data = encodeAbiParameters(plain as never, plain.map((i) => args[i.name]) as never)
  return { address, topics, data, blockNumber, logIndex, transactionHash: keccak256(stringToHex(`${eventName}:${blockNumber}:${logIndex}`)) }
}

function fakeClient(logs: RawLog[], head: bigint, oldestServed = 0n) {
  return {
    getBlockNumber: async () => head,
    getLogs: async ({ address, fromBlock, toBlock }: { address: Address[]; fromBlock: bigint; toBlock: bigint }) => {
      if (fromBlock < oldestServed) throw Object.assign(new Error('Archive requests require a personal token.'), { details: 'Archive requests require a personal token.' })
      const set = new Set(address.map((a) => a.toLowerCase()))
      return logs
        .filter((l) => set.has(l.address.toLowerCase()) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
        .map((l) => ({ ...l, blockHash: pad('0x01', { size: 32 }), transactionIndex: 0, removed: false }))
    },
  } as unknown as PublicClient
}

async function settle(ix: MineIndexer) {
  ix.start()
  for (let i = 0; i < 100 && ix.state.status !== 'live'; i++) await new Promise((r) => setTimeout(r, 5))
  ix.stop()
}

const q1 = specBody(specFor('Was it?', 'bool'))
const q2 = specBody(specFor('How many?', 'uint256'))
const rid1 = keccak256(stringToHex('r1'))
const rid2 = keccak256(stringToHex('r2'))
const b32 = (s: string) => pad(stringToHex(s), { size: 32, dir: 'right' })

const history: RawLog[] = [
  mineLog('Started', { reserve: 650_000_000n * E18, genesis: 1_000n, baseRate: 20n * E18 }, 100n),
  // #1: Alice solo-asks; answered in round 3
  mineLog('Proposed', { id: 1n, proposer: ALICE, target: E18 / 2n, deadline: 999_999n, body: stringToHex(q1) }, 110n, 0),
  mineLog('Backed', { id: 1n, backer: ALICE, amount: E18 / 2n, raised: E18 / 2n }, 110n, 1),
  mineLog('Asked', { id: 1n, requestId: rid1, adapter: ADAPTER }, 110n, 2),
  mineLog('RoundOpened', { round: 3n, emitted: 1_000n * E18, devShare: 50n * E18 }, 120n, 0),
  mineLog('Answered', { id: 1n, requestId: rid1, round: 3n, shares: E18 / 2n }, 120n, 1),
  adapterLog(
    'Thought',
    {
      requestId: rid1,
      oracleRequestId: b32('o1'),
      chainId: 1n,
      answerType: 0,
      answerHash: keccak256(encodeAbiParameters([{ type: 'bool' }], [true])),
      answer: encodeAbiParameters([{ type: 'bool' }], [true]),
      panelSize: 5,
      quorum: 4,
      agreed: 5,
    },
    120n,
    2,
  ),
  // #2: pooled by Alice (0.1) and Bob (0.4); the panel splits
  mineLog('Proposed', { id: 2n, proposer: ALICE, target: E18 / 2n, deadline: 999_999n, body: stringToHex(q2) }, 9_500n, 0),
  mineLog('Backed', { id: 2n, backer: ALICE, amount: E18 / 10n, raised: E18 / 10n }, 9_500n, 1),
  mineLog('Backed', { id: 2n, backer: BOB, amount: (E18 * 4n) / 10n, raised: E18 / 2n }, 9_600n, 0),
  mineLog('Asked', { id: 2n, requestId: rid2, adapter: ADAPTER }, 9_600n, 1),
  mineLog('Failed', { id: 2n, requestId: rid2, status: 2, reason: b32('disagreed') }, 9_700n, 0),
  adapterLog('Unanswered', { requestId: rid2, status: 2, reason: b32('disagreed'), agreed: 2, answered: 5 }, 9_700n, 1),
  // Alice claims #1
  mineLog('Claimed', { id: 1n, backer: ALICE, amount: 950n * E18 }, 9_800n, 0),
]

describe('MineIndexer', () => {
  it('rebuilds questions, rounds, answers, failures and totals from logs', async () => {
    const ix = new MineIndexer({ client: fakeClient(history, 10_000n), mine: MINE, adapter: null, deployBlock: 100n, chunk: 3_000n, pollMs: 60_000 })
    await settle(ix)
    const s = ix.state
    expect(s.status).toBe('live')
    expect(s.historyFrom).toBeNull()
    expect(s.started?.genesis).toBe(1_000n)

    const one = s.questions.get('1')!
    expect(one.status).toBe('answered')
    expect(one.text).toBe('Was it?')
    expect(one.answerType).toBe('bool')
    expect(one.round).toBe(3n)
    expect(one.answer?.decoded).toEqual({ type: 'bool', value: true })
    expect(one.answer?.agreed).toBe(5)

    const two = s.questions.get('2')!
    expect(two.status).toBe('failed')
    expect(two.failure).toMatchObject({ status: 2, reason: 'disagreed', agreed: 2, answered: 5 })
    expect(two.backed.size).toBe(2)

    const r3 = s.rounds.get('3')!
    expect(r3.reward).toBe(950n * E18)
    expect(r3.shares).toBe(E18 / 2n)
    expect(r3.questionIds).toEqual([1n])

    expect(s.totals).toMatchObject({ proposed: 2, asked: 2, answered: 1, failed: 1, open: 0, uniqueMiners: 1, uniqueBackers: 2 })
    expect(s.totals.imdPaidToSwarm).toBe(E18)
    expect(s.totals.hmmAssigned).toBe(1_000n * E18)
    expect(s.totals.hmmClaimed).toBe(950n * E18)
    expect(s.feed[0]?.kind).toBe('claimed')
  })

  it('finds the adapter from Asked events when none is configured', async () => {
    const ix = new MineIndexer({ client: fakeClient(history, 10_000n), mine: MINE, adapter: null, deployBlock: 100n, chunk: 50_000n, pollMs: 60_000 })
    await settle(ix)
    expect(ix.state.questions.get('1')?.answer).toBeDefined()
  })

  it('falls back to the recent window when the RPC refuses old logs, and says so', async () => {
    const head = 20_000n
    const ix = new MineIndexer({ client: fakeClient(history, head, 11_000n), mine: MINE, adapter: ADAPTER, deployBlock: 100n, chunk: 5_000n, pollMs: 60_000 })
    await settle(ix)
    expect(ix.state.status).toBe('live')
    expect(ix.state.historyFrom).toBe(head - 8_000n)
    expect(ix.state.questions.size).toBe(0)
  })

  it('feeds the mining accounting', async () => {
    const ix = new MineIndexer({ client: fakeClient(history, 10_000n), mine: MINE, adapter: ADAPTER, deployBlock: 100n, chunk: 50_000n, pollMs: 60_000 })
    await settle(ix)
    const timing = { genesis: 1_000n, roundLength: 600n }
    const e = earningOf(ix.state, ix.state.questions.get('1')!, ALICE, 10_000n, timing)
    expect(e).toMatchObject({ backed: E18 / 2n, claimed: 950n * E18, hmm: 950n * E18, final: true, claimable: 0n })
    const board = leaderboard(ix.state, 10_000n, timing)
    expect(board[0]).toMatchObject({ address: ALICE, hmm: 950n * E18, backed: 2, answered: 1 })
    expect(board[1]).toMatchObject({ address: BOB, hmm: 0n, backed: 1, answered: 0, imdPaid: (E18 * 4n) / 10n })
  })
})
