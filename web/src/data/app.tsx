import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { PublicClient } from 'viem'
import { getPublicClient } from 'wagmi/actions'
import type { Config } from 'wagmi'
import type { AppConfig, Contracts } from '../config'
import { discoverLaunch } from './discovery'
import { MineIndexer, type IndexState } from './indexer'

/** Launch status: `ready` once the mine is known; `prelaunch` while there is none (discovery keeps watching). */
export type LaunchStatus = 'ready' | 'discovering' | 'prelaunch' | 'error'

interface AppContextValue {
  cfg: AppConfig
  client: PublicClient
  contracts: Contracts | null
  launch: LaunchStatus
  launchError: string | null
  indexer: MineIndexer | null
}

const AppContext = createContext<AppContextValue | null>(null)

const RECHECK_MS = 60_000

export function AppProvider({ cfg, wagmi, children }: { cfg: AppConfig; wagmi: Config; children: ReactNode }) {
  const client = useMemo(() => getPublicClient(wagmi, { chainId: cfg.chainId }) as PublicClient, [wagmi, cfg.chainId])
  const [contracts, setContracts] = useState<Contracts | null>(cfg.contracts)
  const [launch, setLaunch] = useState<LaunchStatus>(
    cfg.contracts ? 'ready' : cfg.forwarder ? 'discovering' : 'prelaunch',
  )
  const [launchError, setLaunchError] = useState<string | null>(null)

  // Discovery: find the launch from the forwarder, and keep looking while it has not happened yet.
  useEffect(() => {
    if (cfg.contracts || !cfg.forwarder) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let from: bigint | null = null
    const run = async () => {
      try {
        const r = await discoverLaunch(client, cfg, from)
        if (cancelled) return
        setLaunchError(null)
        if (r.contracts) {
          setContracts(r.contracts)
          setLaunch('ready')
          return
        }
        from = r.scannedTo + 1n
        setLaunch('prelaunch')
      } catch (e) {
        if (cancelled) return
        setLaunchError(e instanceof Error ? e.message : String(e))
        setLaunch((s) => (s === 'discovering' ? 'error' : s))
      }
      timer = setTimeout(run, RECHECK_MS)
    }
    void run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [cfg, client])

  const indexer = useMemo(
    () =>
      contracts
        ? new MineIndexer({
            client,
            mine: contracts.mine,
            adapter: contracts.adapter,
            deployBlock: contracts.deployBlock,
            chunk: cfg.logChunk,
            pollMs: cfg.pollMs,
          })
        : null,
    [client, contracts, cfg.logChunk, cfg.pollMs],
  )
  useEffect(() => {
    if (!indexer) return
    indexer.start()
    const wake = () => {
      if (!document.hidden) indexer.refresh()
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      indexer.stop()
    }
  }, [indexer])

  const value = useMemo(
    () => ({ cfg, client, contracts, launch, launchError, indexer }),
    [cfg, client, contracts, launch, launchError, indexer],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const v = useContext(AppContext)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}

export function useConfig(): AppConfig {
  return useApp().cfg
}

const noop = () => () => {}
const zero = () => 0

/** The indexed chain state (re-renders on every change), or null when there is no mine yet. */
export function useIndex(): IndexState | null {
  const { indexer } = useApp()
  useSyncExternalStore(indexer?.subscribe ?? noop, indexer?.getVersion ?? zero)
  return indexer?.state ?? null
}
