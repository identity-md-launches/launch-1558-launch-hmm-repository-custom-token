import { getAddress, parseAbiItem, type Address, type PublicClient } from 'viem'
import { hmmMineAbi } from '../abi'
import type { AppConfig, Contracts } from '../config'
import { isHistoryLimit } from './rpcErrors'

/**
 * Finds the hmm launch from the GenesisForwarder: `forward(n)` moves a launch's mining reserve into its mine and
 * emits `Forwarded(launchNumber, token, mine, amount)`. A copycat launch can name the same forwarder, so a
 * candidate counts only if its mine says it mines that token through this forwarder (and, unless a launch number is
 * pinned, its token is the "HMM" token); the earliest such launch wins.
 */

const forwarded = parseAbiItem(
  'event Forwarded(uint64 indexed launchNumber, address indexed token, address indexed mine, uint256 amount)',
)
const symbolAbi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

const SCAN_BACK = 200_000n

interface Cached {
  hmm: string
  mine: string
  deployBlock: string
  launchNumber: string
}

function cacheKey(cfg: AppConfig) {
  return `hmm.discovery.${cfg.chainId}.${cfg.forwarder?.toLowerCase()}`
}

async function verify(client: PublicClient, cfg: AppConfig, token: Address, mine: Address): Promise<boolean> {
  try {
    const [t, f] = await Promise.all([
      client.readContract({ address: mine, abi: hmmMineAbi, functionName: 'token' }),
      client.readContract({ address: mine, abi: hmmMineAbi, functionName: 'forwarder' }),
    ])
    if (getAddress(t) !== getAddress(token) || getAddress(f) !== cfg.forwarder) return false
    if (cfg.launchNumber === null) {
      const symbol = await client.readContract({ address: token, abi: symbolAbi, functionName: 'symbol' })
      if (symbol !== 'HMM') return false
    }
    return true
  } catch {
    return false
  }
}

async function withAdapter(client: PublicClient, c: Omit<Contracts, 'adapter'>): Promise<Contracts> {
  let adapter: Address | null = null
  try {
    adapter = await client.readContract({ address: c.mine, abi: hmmMineAbi, functionName: 'adapter' })
  } catch {
    adapter = null
  }
  return { ...c, adapter }
}

export interface DiscoveryResult {
  contracts: Contracts | null
  /** Last block scanned; resume from the next one. */
  scannedTo: bigint
}

/** Scans `Forwarded` logs from `from` (default: the cached result, VITE_FORWARDER_BLOCK, or the last ~200k blocks). */
export async function discoverLaunch(
  client: PublicClient,
  cfg: AppConfig,
  from: bigint | null,
  onProgress?: (fraction: number) => void,
): Promise<DiscoveryResult> {
  if (!cfg.forwarder) return { contracts: null, scannedTo: 0n }
  const head = await client.getBlockNumber({ cacheTime: 0 })

  if (from === null) {
    try {
      const raw = localStorage.getItem(cacheKey(cfg))
      if (raw) {
        const c = JSON.parse(raw) as Cached
        const hmm = getAddress(c.hmm)
        const mine = getAddress(c.mine)
        if (await verify(client, cfg, hmm, mine)) {
          const contracts = await withAdapter(client, {
            hmm,
            mine,
            deployBlock: BigInt(c.deployBlock),
            launchNumber: BigInt(c.launchNumber),
          })
          return { contracts, scannedTo: head }
        }
      }
    } catch {
      /* stale cache: scan */
    }
  }

  // Newest first: the recent window, which every RPC serves, is covered before older history, and an endpoint that
  // refuses old ranges ends the scan quietly instead of failing it.
  const floor = from ?? cfg.forwarderBlock ?? (head > SCAN_BACK ? head - SCAN_BACK : 0n)
  let chunk = cfg.logChunk
  let to = head
  const total = head >= floor ? head - floor + 1n : 0n
  const found: { token: Address; mine: Address; launchNumber: bigint; block: bigint; logIndex: number }[] = []
  while (to >= floor) {
    const start = to - chunk + 1n < floor ? floor : to - chunk + 1n
    let logs
    try {
      logs = await client.getLogs({
        address: cfg.forwarder,
        event: forwarded,
        args: cfg.launchNumber !== null ? { launchNumber: cfg.launchNumber } : undefined,
        fromBlock: start,
        toBlock: to,
      })
    } catch (e) {
      if (chunk > 500n) {
        chunk /= 2n
        continue
      }
      if (isHistoryLimit(e)) break
      throw e
    }
    for (const log of logs) {
      const { token, mine, launchNumber } = log.args
      if (token && mine && launchNumber !== undefined)
        found.push({ token, mine, launchNumber: BigInt(launchNumber), block: log.blockNumber, logIndex: log.logIndex })
    }
    if (total > 0n) onProgress?.(Number(head - start + 1n) / Number(total))
    if (start === 0n) break
    to = start - 1n
  }
  found.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1))
  for (const f of found) {
    if (!(await verify(client, cfg, f.token, f.mine))) continue
    const contracts = await withAdapter(client, {
      hmm: getAddress(f.token),
      mine: getAddress(f.mine),
      deployBlock: f.block,
      launchNumber: f.launchNumber,
    })
    try {
      localStorage.setItem(
        cacheKey(cfg),
        JSON.stringify({
          hmm: contracts.hmm,
          mine: contracts.mine,
          deployBlock: contracts.deployBlock.toString(),
          launchNumber: f.launchNumber.toString(),
        } satisfies Cached),
      )
    } catch {
      /* storage full or blocked: fine */
    }
    return { contracts, scannedTo: head }
  }
  return { contracts: null, scannedTo: head }
}
