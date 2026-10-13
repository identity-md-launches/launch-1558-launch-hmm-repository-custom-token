import { getAddress, isAddress, type Address } from 'viem'

/**
 * Where the app points. Sources, in order:
 * 1. explicit env (`VITE_MINE`, `VITE_HMM`, `VITE_ADAPTER`, `VITE_DEPLOY_BLOCK`);
 * 2. a deployment file (`../deployments/devnet.json` or HMM_DEPLOYMENT), baked in at build time and, in `vite dev`,
 *    re-read on every load from `/__hmm/deployment.json`;
 * 3. discovery (`VITE_FORWARDER`): the mine is found at runtime from the GenesisForwarder's `Forwarded` log, so a
 *    mainnet build needs no contract addresses and flips from pre-launch to live by itself;
 * 4. none: pre-launch mode (the swarm, the explainer and the composer work; nothing to read on chain).
 * URLs may be relative (`/rpc`, `/imd-check`): they resolve against the page's location at runtime.
 */

export interface Deployment {
  chainId: number
  rpcUrl: string
  hmm: string
  mine: string
  adapter: string
  imd?: string
  intake?: string
  deployBlock: number | string
  faucet?: string
  dev?: string
  steward?: string
  forwarder?: string
  oracleSigner?: string
  launchNumber?: number
}

declare const __HMM_DEPLOYMENT__: Deployment | null

/** The hmm contracts of one launch. */
export interface Contracts {
  hmm: Address
  mine: Address
  /** The adapter at configuration time; the mine's current `adapter()` is read live as well. */
  adapter: Address | null
  /** First block to index from. */
  deployBlock: bigint
  launchNumber: bigint | null
}

export interface AppConfig {
  chainId: number
  chainName: string
  /** Absolute RPC URL (relative values are resolved against the page). */
  rpcUrl: string
  /** Contracts known at boot (env or deployment file); null when they must be discovered or do not exist yet. */
  contracts: Contracts | null
  imd: Address
  intake: Address
  /** GenesisForwarder to discover the launch from (mainnet). */
  forwarder: Address | null
  forwarderBlock: bigint | null
  launchNumber: bigint | null
  explorer: string | null
  checkUrl: string | null
  /** Devnet faucet (POST {address}); null off the devnet. */
  faucetUrl: string | null
  faucetNote: string | null
  /** Local test chain (anvil). */
  isDevnet: boolean
  source: 'env' | 'deployment' | 'discovery' | 'none'
  logChunk: bigint
  pollMs: number
  /** The IMD swarm's public API (read-only, CORS-enabled). */
  imdApi: string
}

export const MAINNET_IMD = getAddress('0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7')
export const MAINNET_INTAKE = getAddress('0xa43e6f75ee006411f79ac1c84120606c2330de82')
export const DEFAULT_MAINNET_RPC = 'https://ethereum-rpc.publicnode.com'

const env = import.meta.env

function addr(value: unknown): Address | null {
  return typeof value === 'string' && isAddress(value.trim(), { strict: false }) ? getAddress(value.trim()) : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function big(value: unknown): bigint | null {
  const s = typeof value === 'number' ? String(value) : str(value)
  return s && /^\d+$/.test(s) ? BigInt(s) : null
}

/** Relative URLs ("/rpc", "./rpc") resolve against the page; absolute ones pass through. */
export function absoluteUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url
  if (typeof window === 'undefined') return url
  return new URL(url, window.location.href).href
}

function isDevnetChain(id: number) {
  return id === 31337 || id === 1337
}

function chainName(id: number): string {
  if (id === 1) return 'Ethereum'
  if (isDevnetChain(id)) return 'hmm devnet'
  return `chain ${id}`
}

function explorerFor(id: number): string | null {
  return id === 1 ? 'https://etherscan.io' : null
}

function base(chainId: number) {
  const devnet = isDevnetChain(chainId)
  const explorerEnv = env.VITE_EXPLORER as string | undefined
  const check = str(env.VITE_CHECK_URL) ?? (env.DEV ? '/imd-check' : null)
  const faucet = __HMM_DEVNET__ && devnet ? (str(env.VITE_FAUCET_URL) ?? '/faucet') : null
  return {
    chainId,
    chainName: chainName(chainId),
    imd: addr(env.VITE_IMD) ?? MAINNET_IMD,
    intake: addr(env.VITE_INTAKE) ?? MAINNET_INTAKE,
    explorer: explorerEnv === '' ? null : (str(explorerEnv) ?? explorerFor(chainId)),
    checkUrl: check ? absoluteUrl(check) : null,
    faucetUrl: faucet ? absoluteUrl(faucet) : null,
    isDevnet: devnet,
    logChunk: big(env.VITE_LOG_CHUNK) ?? (devnet ? 50_000n : 20_000n),
    pollMs: devnet ? 2_000 : 12_000,
    imdApi: 'https://api.imd.fun',
  }
}

function envContracts(fallbackBlock: bigint | null): Contracts | null {
  const mine = addr(env.VITE_MINE)
  const hmm = addr(env.VITE_HMM)
  if (!mine || !hmm) return null
  return {
    hmm,
    mine,
    adapter: addr(env.VITE_ADAPTER),
    deployBlock: big(env.VITE_DEPLOY_BLOCK) ?? fallbackBlock ?? 0n,
    launchNumber: big(env.VITE_LAUNCH_NUMBER),
  }
}

function fromDeployment(d: Deployment): AppConfig {
  const chainId = Number(str(env.VITE_CHAIN_ID) ?? d.chainId)
  const b = base(chainId)
  const fileContracts: Contracts | null =
    addr(d.mine) && addr(d.hmm)
      ? {
          hmm: addr(d.hmm)!,
          mine: addr(d.mine)!,
          adapter: addr(d.adapter),
          deployBlock: big(d.deployBlock) ?? 0n,
          launchNumber: big(d.launchNumber),
        }
      : null
  return {
    ...b,
    imd: addr(env.VITE_IMD) ?? addr(d.imd) ?? MAINNET_IMD,
    intake: addr(env.VITE_INTAKE) ?? addr(d.intake) ?? MAINNET_INTAKE,
    rpcUrl: absoluteUrl(str(env.VITE_RPC_URL) ?? d.rpcUrl),
    contracts: envContracts(fileContracts?.deployBlock ?? null) ?? fileContracts,
    forwarder: addr(env.VITE_FORWARDER) ?? addr(d.forwarder),
    forwarderBlock: big(env.VITE_FORWARDER_BLOCK),
    launchNumber: big(env.VITE_LAUNCH_NUMBER) ?? big(d.launchNumber),
    faucetNote: str(d.faucet),
    source: 'deployment',
  }
}

function fromEnv(): AppConfig {
  const chainId = Number(str(env.VITE_CHAIN_ID) ?? '1')
  const b = base(chainId)
  const contracts = envContracts(null)
  const forwarder = addr(env.VITE_FORWARDER)
  return {
    ...b,
    rpcUrl: absoluteUrl(str(env.VITE_RPC_URL) ?? (chainId === 1 ? DEFAULT_MAINNET_RPC : 'http://127.0.0.1:8545')),
    contracts,
    forwarder,
    forwarderBlock: big(env.VITE_FORWARDER_BLOCK),
    launchNumber: big(env.VITE_LAUNCH_NUMBER),
    faucetNote: null,
    source: contracts ? 'env' : forwarder ? 'discovery' : 'none',
  }
}

/** Resolves the config once at boot. */
export async function loadConfig(): Promise<AppConfig> {
  if (str(env.VITE_MINE) || str(env.VITE_FORWARDER) || str(env.VITE_CHAIN_ID) === '1') return fromEnv()
  if (env.DEV) {
    try {
      const res = await fetch('./__hmm/deployment.json', { cache: 'no-store' })
      if (res.ok) return fromDeployment((await res.json()) as Deployment)
    } catch {
      /* fall through to the baked-in copy */
    }
  }
  if (typeof __HMM_DEPLOYMENT__ !== 'undefined' && __HMM_DEPLOYMENT__) return fromDeployment(__HMM_DEPLOYMENT__)
  return fromEnv()
}

export function explorerAddress(cfg: AppConfig, address: string): string | null {
  return cfg.explorer ? `${cfg.explorer}/address/${address}` : null
}

export function explorerTx(cfg: AppConfig, hash: string): string | null {
  return cfg.explorer ? `${cfg.explorer}/tx/${hash}` : null
}
