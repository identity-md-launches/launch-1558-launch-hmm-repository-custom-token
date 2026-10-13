import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles/global.css'
import './styles/app.css'
import './styles/pages.css'
import { loadConfig } from './config'
import { appChain, makeWagmiConfig } from './wagmi'
import { AppProvider } from './data/app'
import { App } from './App'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      structuralSharing: false,
    },
  },
})

async function boot() {
  const cfg = await loadConfig()
  // Devnet test wallets exist only in devnet builds: `__HMM_DEVNET__` is a compile-time constant, so other builds
  // drop this import (and the test keys) entirely.
  let extra: Parameters<typeof makeWagmiConfig>[1] = []
  if (__HMM_DEVNET__ && cfg.isDevnet) {
    const { devnetConnectors } = await import('./devnet/connectors')
    extra = devnetConnectors(appChain(cfg), cfg.rpcUrl)
  }
  const wagmi = makeWagmiConfig(cfg, extra)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <WagmiProvider config={wagmi}>
        <QueryClientProvider client={queryClient}>
          <AppProvider cfg={cfg} wagmi={wagmi}>
            <App />
          </AppProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  )
}

void boot()
