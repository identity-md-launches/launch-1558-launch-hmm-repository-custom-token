import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

interface DeploymentFile {
  chainId?: number
  rpcUrl?: string
  imd?: string
}

/**
 * The devnet deployment (`../deployments/devnet.json`, or HMM_DEPLOYMENT=path) is used unless the env names the
 * contracts or asks for discovery/mainnet (VITE_MINE, VITE_FORWARDER, VITE_CHAIN_ID=1). It is baked into the bundle
 * at build time and, in `vite dev`, also served live at `/__hmm/deployment.json`, so a devnet restarted with new
 * addresses only needs a page reload.
 */
function hmmDeployment(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '')
  const path = resolve(process.cwd(), env.HMM_DEPLOYMENT ?? '../deployments/devnet.json')
  const useFile = !env.VITE_MINE && !env.VITE_FORWARDER && env.VITE_CHAIN_ID !== '1'
  const read = (): string | null => {
    if (!useFile || !existsSync(path)) return null
    try {
      return JSON.stringify(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return null
    }
  }
  return {
    name: 'hmm-deployment',
    config() {
      return { define: { __HMM_DEPLOYMENT__: read() ?? 'null' } }
    },
    configureServer(server) {
      if (!useFile) return
      server.watcher.add(path)
      server.watcher.on('change', (file) => {
        if (resolve(file) === path) server.ws.send({ type: 'full-reload' })
      })
      server.middlewares.use('/__hmm/deployment.json', (_req, res) => {
        const body = read()
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.statusCode = body ? 200 : 404
        res.end(body ?? '{"error":"no deployment file"}')
      })
    },
  }
}

/**
 * Dev-server stand-ins for the preview server's same-origin helpers on the devnet: `POST /faucet {address}` sends
 * 5 test IMD (from an IMD holder the fork impersonates) and 0.2 test ETH. Refuses anything but a local chain 31337.
 */
function devnetFaucet(rpcUrl: string | null, imd: string): Plugin {
  const HOLDER = '0xE54d6571aCa515614927F3A70B8957c2B511603C'
  const rpc = async (method: string, params: unknown[]) => {
    const r = await fetch(rpcUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const j = (await r.json()) as { result?: string; error?: { message: string } }
    if (j.error) throw new Error(j.error.message)
    return j.result as string
  }
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((ok, fail) => {
      let s = ''
      req.on('data', (c) => (s += c))
      req.on('end', () => ok(s))
      req.on('error', fail)
    })
  return {
    name: 'hmm-devnet-faucet',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/faucet', async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('content-type', 'application/json')
        try {
          if (!rpcUrl) throw new Error('no devnet')
          if (req.method !== 'POST') throw new Error('POST only')
          const { address } = JSON.parse(await readBody(req)) as { address?: string }
          if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('bad address')
          if (Number(await rpc('eth_chainId', [])) !== 31337) throw new Error('faucet is devnet only')
          const who = address.toLowerCase()
          const amount = 5n * 10n ** 18n
          const data = '0xa9059cbb' + who.slice(2).padStart(64, '0') + amount.toString(16).padStart(64, '0')
          const tx = await rpc('eth_sendTransaction', [{ from: HOLDER, to: imd, data }])
          const bal = BigInt(await rpc('eth_getBalance', [who, 'latest']))
          await rpc('anvil_setBalance', [who, '0x' + (bal + 2n * 10n ** 17n).toString(16)])
          res.end(JSON.stringify({ ok: true, imd: '5', eth: '0.2', tx }))
        } catch (e) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const deploymentPath = resolve(process.cwd(), env.HMM_DEPLOYMENT ?? '../deployments/devnet.json')
  let deployment: DeploymentFile = {}
  try {
    if (existsSync(deploymentPath)) deployment = JSON.parse(readFileSync(deploymentPath, 'utf8')) as DeploymentFile
  } catch {
    deployment = {}
  }
  const devnetRpc = deployment.chainId === 31337 && deployment.rpcUrl ? deployment.rpcUrl : null
  // Devnet builds only: the test wallets, their keys and the faucet UI are compiled out of every other build.
  const devnetBuild = env.VITE_CHAIN_ID
    ? env.VITE_CHAIN_ID === '31337' || env.VITE_CHAIN_ID === '1337'
    : !env.VITE_MINE && !env.VITE_FORWARDER && (deployment.chainId === 31337 || deployment.chainId === 1337)
  const imd = deployment.imd ?? '0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7'

  return {
    base: './',
    define: { __HMM_DEVNET__: JSON.stringify(devnetBuild) },
    plugins: [react(), hmmDeployment(mode), devnetFaucet(devnetRpc, imd)],
    server: {
      port: 5173,
      proxy: {
        // The IMD request checker refuses browser origins; in dev we call it from the server side without one.
        '/imd-check': {
          target: 'https://api.imd.fun',
          changeOrigin: true,
          rewrite: () => '/requests/check',
          configure: (proxy) => {
            proxy.on('proxyReq', (req) => {
              req.removeHeader('origin')
              req.removeHeader('referer')
              req.removeHeader('cookie')
            })
          },
        },
        // Same-origin devnet RPC (so VITE_RPC_URL=/rpc works in dev as it does on the preview server).
        ...(devnetRpc ? { '/rpc': { target: devnetRpc, changeOrigin: true, rewrite: () => '/' } } : {}),
      },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react'
            if (/[\\/](viem|ox|abitype|@noble|@scure|wagmi|@wagmi|@tanstack|zustand|mipd|eventemitter3)[\\/]/.test(id))
              return 'web3'
            return undefined
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
