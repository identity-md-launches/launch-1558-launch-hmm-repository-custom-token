import { createConnector } from 'wagmi'
import {
  createWalletClient,
  hexToBigInt,
  http,
  numberToHex,
  SwitchChainError,
  type Chain,
  type EIP1193RequestFn,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

/**
 * DEVNET ONLY. A wallet whose key lives in this page: transactions are signed here and sent as
 * `eth_sendRawTransaction`, so it works through a read-only RPC proxy. Used for a per-browser burner (funded by the
 * devnet faucet) and anvil's public test accounts. Never offered on mainnet.
 */

const BURNER_KEY = 'hmm.devnet.burner'

export function burnerKey(): Hex {
  let k = localStorage.getItem(BURNER_KEY) as Hex | null
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) {
    k = generatePrivateKey()
    localStorage.setItem(BURNER_KEY, k)
  }
  return k
}

export function burnerAddress(): `0x${string}` {
  return privateKeyToAccount(burnerKey()).address
}

type TxParams = { to?: Hex; data?: Hex; value?: Hex; gas?: Hex; nonce?: Hex }

export function localKeyConnector(opts: { id: string; name: string; chain: Chain; rpcUrl: string; key: () => Hex }) {
  const flag = `hmm.devnet.connected.${opts.id}`
  return createConnector((config) => {
    const account = () => privateKeyToAccount(opts.key())
    const wallet = () =>
      createWalletClient({ account: account(), chain: opts.chain, transport: http(opts.rpcUrl) })
    let rpcId = 0
    const forward = async (method: string, params: unknown) => {
      const res = await fetch(opts.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params: params ?? [] }),
      })
      const json = (await res.json()) as { result?: unknown; error?: { code: number; message: string } }
      if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code })
      return json.result
    }
    const request: EIP1193RequestFn = (async ({ method, params }: { method: string; params?: unknown }) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account().address]
        case 'eth_chainId':
          return numberToHex(opts.chain.id)
        case 'wallet_switchEthereumChain': {
          const id = Number((params as [{ chainId: Hex }])[0].chainId)
          if (id !== opts.chain.id) throw new SwitchChainError(new Error(`only ${opts.chain.name}`))
          return null
        }
        case 'eth_sendTransaction': {
          const tx = (params as [TxParams])[0]
          return wallet().sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? hexToBigInt(tx.value) : undefined,
            gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
          })
        }
        case 'personal_sign': {
          const [data] = params as [Hex, Hex]
          return account().signMessage({ message: { raw: data } })
        }
        case 'eth_signTypedData_v4': {
          const [, json] = params as [Hex, string]
          return account().signTypedData(JSON.parse(json))
        }
        default:
          return forward(method, params)
      }
    }) as EIP1193RequestFn
    const provider = { request, on: () => {}, removeListener: () => {} }

    return {
      id: opts.id,
      name: opts.name,
      type: 'localKey',
      async connect() {
        localStorage.setItem(flag, '1')
        return { accounts: [account().address], chainId: opts.chain.id } as never
      },
      async disconnect() {
        localStorage.removeItem(flag)
      },
      async getAccounts() {
        return [account().address]
      },
      async getChainId() {
        return opts.chain.id
      },
      async getProvider() {
        return provider
      },
      async isAuthorized() {
        return localStorage.getItem(flag) === '1'
      },
      async switchChain({ chainId }) {
        if (chainId !== opts.chain.id) throw new SwitchChainError(new Error(`only ${opts.chain.name}`))
        return opts.chain
      },
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {
        config.emitter.emit('disconnect')
      },
    }
  })
}
