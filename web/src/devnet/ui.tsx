import { useState } from 'react'
import { useAccount, useConnectors, type Connector } from 'wagmi'
import { numberToHex } from 'viem'
import { useApp } from '../data/app'
import { useBalances } from '../data/hooks'
import { humanizeError, isUserRejection } from '../lib/errors'
import { Button } from '../components/ui'
import { toast } from '../components/toast'

/*
 * DEVNET ONLY. Loaded with a dynamic import behind the compile-time `__HMM_DEVNET__` constant, so none of this (or
 * the test keys) ships in other builds.
 */

/** Extra options in the connect dialog: a per-browser burner and the shared test accounts. */
export function DevnetConnect({ onPick, pending }: { onPick: (c: Connector) => void; pending: boolean }) {
  const connectors = useConnectors()
  const [showTest, setShowTest] = useState(false)
  const burner = connectors.find((c) => c.id === 'devnet-burner')
  const tests = connectors.filter((c) => c.id.startsWith('devnet-anvil-'))
  if (!burner) return null
  return (
    <>
      <div className="divider" />
      <div className="eyebrow">devnet only</div>
      <button className="connector" onClick={() => onPick(burner)} disabled={pending}>
        <span className="connector-letter" aria-hidden="true">
          ⚡
        </span>
        <span>
          Devnet burner
          <small className="dim" style={{ display: 'block', fontWeight: 400 }}>
            a fresh key kept in this browser; get test IMD from the faucet
          </small>
        </span>
      </button>
      <button className="link-btn" style={{ justifySelf: 'start', fontSize: '0.85rem' }} onClick={() => setShowTest((s) => !s)}>
        {showTest ? 'Hide' : 'Show'} shared test accounts
      </button>
      {showTest &&
        tests.map((c) => (
          <button key={c.uid} className="connector connector-sm" onClick={() => onPick(c)} disabled={pending}>
            <span className="connector-letter" aria-hidden="true">
              #
            </span>
            <span>{c.name}</span>
          </button>
        ))}
    </>
  )
}

async function addDevnetToWallet(rpcUrl: string, chainId: number, name: string) {
  const eth = (window as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } })
    .ethereum
  if (!eth) throw new Error('No browser wallet found.')
  await eth.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: numberToHex(chainId),
        chainName: name,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [rpcUrl],
      },
    ],
  })
}

export function DevnetTools({ compact }: { compact?: boolean }) {
  const { cfg } = useApp()
  const { address, connector } = useAccount()
  const [busy, setBusy] = useState<'faucet' | 'add' | null>(null)
  const balances = useBalances(address)
  if (!cfg.isDevnet) return null

  const faucet = async () => {
    if (!address || !cfg.faucetUrl) return
    setBusy('faucet')
    try {
      const res = await fetch(cfg.faucetUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; imd?: string; eth?: string; error?: string }
      if (!res.ok || !out.ok) throw new Error(out.error ?? `faucet unavailable (${res.status})`)
      toast.show({ kind: 'success', title: 'Test IMD on its way', body: `${out.imd} IMD and ${out.eth} ETH (devnet only).`, ttl: 7000 })
      setTimeout(() => void balances.refetch(), 1500)
    } catch (e) {
      toast.show({ kind: 'error', title: 'Faucet', body: e instanceof Error ? e.message : String(e), ttl: 9000 })
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
    setBusy('add')
    try {
      await addDevnetToWallet(cfg.rpcUrl, cfg.chainId, cfg.chainName)
      toast.show({ kind: 'success', title: 'Network added', body: `${cfg.chainName} (chain ${cfg.chainId}) is in your wallet.`, ttl: 6000 })
    } catch (e) {
      if (!isUserRejection(e)) toast.show({ kind: 'error', title: 'Add network', body: humanizeError(e), ttl: 9000 })
    } finally {
      setBusy(null)
    }
  }

  const injected = !connector || connector.type === 'injected'
  return (
    <div className={compact ? 'devnet-tools compact' : 'devnet-tools'}>
      {address && cfg.faucetUrl && (
        <Button size="sm" variant="lilac" onClick={faucet} busy={busy === 'faucet'}>
          Get test IMD
        </Button>
      )}
      {injected && (
        <Button size="sm" variant="ghost" onClick={add} busy={busy === 'add'}>
          Add {cfg.chainName} to wallet
        </Button>
      )}
    </div>
  )
}


/** The devnet card on My thoughts. */
export function DevnetCard() {
  const { cfg } = useApp()
  if (!cfg.isDevnet) return null
  return (
    <div className="card devnet-card">
      <div className="spread">
        <div>
          <strong>Devnet</strong>
          <p className="dim" style={{ fontSize: '0.88rem' }}>
            Test IMD and ETH are free here. {cfg.faucetNote}
          </p>
        </div>
        <DevnetTools />
      </div>
    </div>
  )
}
