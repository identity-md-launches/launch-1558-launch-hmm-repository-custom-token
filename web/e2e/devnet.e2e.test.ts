/**
 * End to end against a running devnet (deployments/devnet.json): the same modules the site uses (spec builder,
 * emission math, event indexer, mining accounting) against the real contracts and the swarm simulator.
 *
 *   npm run e2e                     # needs the devnet; takes up to ~12 minutes (it waits for a round to end)
 *   E2E_QUICK=1 npm run e2e         # skip the wait-for-round-end/claim part
 *
 * Uses anvil test accounts 3 and 4 (they hold devnet IMD) and signs locally, like the site's devnet wallets.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  hexToString,
  http,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hmmMineAbi, swarmOracleAdapterAbi } from '../src/abi'
import { DEVNET_TEST_KEYS } from '../src/devnet/keys'
import { MineIndexer } from '../src/data/indexer'
import { earningOf, leaderboard } from '../src/data/mining'
import { decodeAnswer, answerLabel } from '../src/lib/answer'
import { fillTemplate, templates } from '../src/lib/body'
import { emittedAt, rateAt, type Schedule } from '../src/lib/emission'
import { specBody, specFor, type Spec } from '../src/lib/spec'

const dep = JSON.parse(readFileSync(resolve(process.env.HMM_DEPLOYMENT ?? '../deployments/devnet.json'), 'utf8')) as {
  chainId: number
  rpcUrl: string
  mine: Address
  hmm: Address
  adapter: Address
  imd: Address
  deployBlock: number
}
const chain = defineChain({
  id: dep.chainId,
  name: 'hmm devnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [dep.rpcUrl] } },
})
const pub = createPublicClient({ chain, transport: http(dep.rpcUrl) }) as PublicClient
const alice = privateKeyToAccount(DEVNET_TEST_KEYS[3]!.key)
const bob = privateKeyToAccount(DEVNET_TEST_KEYS[4]!.key)
const walletOf = (account: typeof alice) => createWalletClient({ account, chain, transport: http(dep.rpcUrl) })
const QUICK = process.env.E2E_QUICK === '1'
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const timestampAbi = [
  { type: 'function', name: 'getCurrentBlockTimestamp', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...a: unknown[]) => console.log('  ·', ...a)

let schedule: Schedule
let price: bigint

async function send(account: typeof alice, request: Parameters<ReturnType<typeof walletOf>['writeContract']>[0]) {
  const hash = await walletOf(account).writeContract(request)
  const receipt = await pub.waitForTransactionReceipt({ hash })
  expect(receipt.status).toBe('success')
  return receipt
}

async function ensureAllowance(account: typeof alice, amount: bigint) {
  const allowance = await pub.readContract({ address: dep.imd, abi: erc20Abi, functionName: 'allowance', args: [account.address, dep.mine] })
  if (allowance >= amount) return
  await send(account, { address: dep.imd, abi: erc20Abi, functionName: 'approve', args: [dep.mine, amount], chain, account })
}

function supplyQuestion(): string {
  const t = templates().find((x) => x.id === 'supply-threshold')!
  // A fresh threshold each run, so runs are distinguishable in the ledger.
  const raw = (BigInt(1 + Math.floor(Math.random() * 900)) * 10n ** 21n).toString()
  const { question } = fillTemplate(t, { token: dep.imd, decimals: '18', raw })
  return question!
}

async function waitSettled(id: bigint, timeoutMs = 180_000): Promise<number> {
  const t0 = Date.now()
  for (;;) {
    const q = await pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'question', args: [id] })
    if (q.status === 3 || q.status === 4) return q.status
    if (Date.now() - t0 > timeoutMs) throw new Error(`question ${id} not settled after ${timeoutMs / 1000}s`)
    await sleep(3000)
  }
}

beforeAll(async () => {
  const [stats, roundLength, eraLength, devBps] = await Promise.all([
    pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'stats' }),
    pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'roundLength' }),
    pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'eraLength' }),
    pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'devBps' }),
  ])
  schedule = { reserve: stats.reserve, genesis: stats.genesis, baseRate: stats.baseRate, roundLength, eraLength, devBps }
  price = stats.price
  log(`mine ${dep.mine}: genesis ${stats.genesis}, ${stats.questions} questions so far, price ${price}`)
})

describe('devnet', () => {
  it('mirrors emittedAt and rateAt exactly', async () => {
    const g = schedule.genesis
    const E = schedule.eraLength
    const ts = [g - 1n, g, g + 1n, g + 599n, g + 600n, g + 12_345n, g + E - 1n, g + E, g + E + 7n, g + 3n * E + 42n, g + 64n * E, g + 70n * E]
    for (const t of ts) {
      const [chainEmitted, chainRate] = await Promise.all([
        pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'emittedAt', args: [t] }),
        pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'rateAt', args: [t] }),
      ])
      expect(emittedAt(schedule, t), `emittedAt(${t})`).toBe(chainEmitted)
      expect(rateAt(schedule, t), `rateAt(${t})`).toBe(chainRate)
    }
  })

  it('composes bodies exactly like bodyOf for every template', async () => {
    for (const t of templates()) {
      const values: Record<string, string> = {}
      for (const f of t.fields) values[f.key] = f.initial ?? (f.kind === 'address' ? dep.imd : f.kind === 'uint' ? '123456' : '18')
      const { question } = fillTemplate(t, values)
      const spec = specFor(question!, t.answerType as 'bool' | 'uint256')
      const onchain = await pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'bodyOf', args: [spec] })
      expect(hexToString(onchain), t.id).toBe(specBody(spec))
    }
  })

  let askedId = 0n
  let round = 0n

  it(
    'asks a template question solo and the swarm answers it',
    async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        await ensureAllowance(alice, price)
        const spec: Spec = specFor(supplyQuestion(), 'bool')
        const receipt = await send(alice, { address: dep.mine, abi: hmmMineAbi, functionName: 'propose', args: [spec, price], chain, account: alice })
        const [proposed] = parseEventLogs({ abi: hmmMineAbi, logs: receipt.logs, eventName: 'Proposed' })
        const asked = parseEventLogs({ abi: hmmMineAbi, logs: receipt.logs, eventName: 'Asked' })
        expect(proposed).toBeDefined()
        expect(asked.length).toBe(1)
        expect(hexToString(proposed!.args.body)).toBe(specBody(spec))
        const id = proposed!.args.id
        log(`asked #${id} (attempt ${attempt}); waiting for the swarm…`)
        const status = await waitSettled(id)
        if (status === 4) {
          log(`#${id} turned to mist (the simulator splits ~10%); asking again`)
          continue
        }
        const q = await pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'question', args: [id] })
        const thoughts = await pub.getContractEvents({
          address: q.adapter,
          abi: swarmOracleAdapterAbi,
          eventName: 'Thought',
          args: { requestId: q.requestId },
          fromBlock: receipt.blockNumber,
        })
        expect(thoughts.length).toBe(1)
        const t = thoughts[0]!.args
        const decoded = decodeAnswer(Number(t.answerType), t.answer as Hex)
        expect(decoded.type).toBe('bool')
        expect(Number(t.agreed)).toBeGreaterThanOrEqual(Number(t.quorum))
        log(`#${id} answered: ${answerLabel(decoded)} (${t.agreed}/${t.panelSize} agreed) in round ${q.round}`)
        askedId = id
        round = BigInt(q.round)
        return
      }
      throw new Error('four questions in a row turned to mist')
    },
    16 * 60_000,
  )

  it('pools a question: one proposes with 0.1 IMD, another completes it and it is asked', async () => {
    const part = 10n ** 17n
    await ensureAllowance(alice, part)
    const spec = specFor(supplyQuestion(), 'bool')
    const r1 = await send(alice, { address: dep.mine, abi: hmmMineAbi, functionName: 'propose', args: [spec, part], chain, account: alice })
    const [proposed] = parseEventLogs({ abi: hmmMineAbi, logs: r1.logs, eventName: 'Proposed' })
    const id = proposed!.args.id
    const left = proposed!.args.target - part
    expect(parseEventLogs({ abi: hmmMineAbi, logs: r1.logs, eventName: 'Asked' }).length).toBe(0)
    await ensureAllowance(bob, left)
    const r2 = await send(bob, { address: dep.mine, abi: hmmMineAbi, functionName: 'back', args: [id, left, proposed!.args.body], chain, account: bob })
    expect(parseEventLogs({ abi: hmmMineAbi, logs: r2.logs, eventName: 'Asked' }).length).toBe(1)
    log(`pooled #${id}: ${part} + ${left} → asked`)
  })

  it(
    'claims after the round ends, for exactly the share the app computes',
    async () => {
      if (QUICK || askedId === 0n) return
      // Wait on the chain's clock (the pending block's timestamp), not the wall clock: a forked devnet can run
      // behind it, and claim() quietly skips a round that has not ended at the block it lands in.
      const end = Number(schedule.genesis + (round + 1n) * schedule.roundLength)
      for (;;) {
        const chainNow = Number(
          await pub.readContract({ address: MULTICALL3, abi: timestampAbi, functionName: 'getCurrentBlockTimestamp', blockTag: 'pending' }),
        )
        if (chainNow >= end) break
        log(`round ${round} ends in ${end - chainNow}s of chain time…`)
        await sleep(Math.min(60, end - chainNow + 1) * 1000)
      }
      const [shares, reward] = await pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'rounds', args: [round] })
      const backing = await pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'backing', args: [askedId, alice.address] })
      const expected = (reward * backing) / shares
      const before = await pub.readContract({ address: dep.hmm, abi: erc20Abi, functionName: 'balanceOf', args: [alice.address] })
      const receipt = await send(alice, { address: dep.mine, abi: hmmMineAbi, functionName: 'claim', args: [[askedId]], chain, account: alice })
      const [claimed] = parseEventLogs({ abi: hmmMineAbi, logs: receipt.logs, eventName: 'Claimed' })
      const after = await pub.readContract({ address: dep.hmm, abi: erc20Abi, functionName: 'balanceOf', args: [alice.address] })
      expect(claimed?.args.amount).toBe(expected)
      expect(after - before).toBe(expected)
      log(`claimed ${expected} HMM-wei from #${askedId} (round ${round})`)

      // The app's indexer and accounting see the same thing.
      const indexer = new MineIndexer({ client: pub, mine: dep.mine, adapter: dep.adapter, deployBlock: BigInt(dep.deployBlock), chunk: 50_000n, pollMs: 60_000 })
      indexer.start()
      for (let i = 0; i < 60 && indexer.state.status !== 'live'; i++) await sleep(500)
      indexer.stop()
      expect(indexer.state.status).toBe('live')
      const q = indexer.state.questions.get(askedId.toString())!
      expect(q.status).toBe('answered')
      expect(q.round).toBe(round)
      const r = indexer.state.rounds.get(round.toString())!
      expect(r.reward).toBe(reward)
      expect(r.shares).toBe(shares)
      const e = earningOf(indexer.state, q, alice.address, BigInt(Math.floor(Date.now() / 1000)), {
        genesis: schedule.genesis,
        roundLength: schedule.roundLength,
      })
      expect(e.claimed).toBe(expected)
      expect(e.final).toBe(true)
      const stats = await pub.readContract({ address: dep.mine, abi: hmmMineAbi, functionName: 'stats' })
      expect(indexer.state.totals.hmmAssigned).toBe(stats.assigned)
      expect(indexer.state.totals.hmmClaimed).toBe(stats.claimed)
      expect(BigInt(indexer.state.totals.proposed)).toBe(stats.questions)
      const board = leaderboard(indexer.state, BigInt(Math.floor(Date.now() / 1000)), { genesis: schedule.genesis, roundLength: schedule.roundLength })
      expect(board.some((row) => row.address.toLowerCase() === alice.address.toLowerCase() && row.claimed >= expected)).toBe(true)
      log(`indexer: ${indexer.state.totals.answered} answered, ${indexer.state.totals.uniqueMiners} miners, assigned ${stats.assigned}`)
    },
    16 * 60_000,
  )
})
