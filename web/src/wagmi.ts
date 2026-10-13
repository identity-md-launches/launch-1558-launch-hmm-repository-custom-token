import { createConfig, http, injected, type Config, type CreateConnectorFn } from 'wagmi'
import { defineChain, type Chain } from 'viem'
import { mainnet } from 'viem/chains'
import type { AppConfig } from './config'

export function appChain(cfg: AppConfig): Chain {
  if (cfg.chainId === 1) {
    return { ...mainnet, rpcUrls: { default: { http: [cfg.rpcUrl] } } }
  }
  return defineChain({
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    // The devnet is a fork of mainnet, so Multicall3 is there too.
    contracts: cfg.isDevnet ? { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } } : undefined,
    testnet: cfg.isDevnet,
  })
}

/** `extra`: devnet-only connectors, loaded by main.tsx only in devnet builds. */
export function makeWagmiConfig(cfg: AppConfig, extra: CreateConnectorFn[] = []): Config {
  const chain = appChain(cfg)
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true }), ...extra]
  return createConfig({
    chains: [chain],
    connectors,
    transports: { [chain.id]: http(cfg.rpcUrl, { batch: { wait: 16 } }) },
    multiInjectedProviderDiscovery: true,
    pollingInterval: cfg.isDevnet ? 1_000 : 4_000,
  })
}
