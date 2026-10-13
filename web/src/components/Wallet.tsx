import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain, type Connector } from 'wagmi'
import { useApp } from '../data/app'
import { useBalances } from '../data/hooks'
import { formatHmm, formatImd, formatUnitsFixed, shortAddress } from '../lib/format'
import { humanizeError, isUserRejection } from '../lib/errors'
import { AnimatedNumber, Button, CopyButton, Modal, Notice } from './ui'
import { toast } from './toast'
import { toNumber } from '../lib/format'

// Devnet-only UI: compiled out of other builds (`__HMM_DEVNET__` is a compile-time constant).
const DevnetConnect = __HMM_DEVNET__ ? lazy(() => import('../devnet/ui').then((m) => ({ default: m.DevnetConnect }))) : null
export const DevnetTools = __HMM_DEVNET__ ? lazy(() => import('../devnet/ui').then((m) => ({ default: m.DevnetTools }))) : null
const DevnetCardLazy = __HMM_DEVNET__ ? lazy(() => import('../devnet/ui').then((m) => ({ default: m.DevnetCard }))) : null

/** The devnet card for My thoughts (nothing in other builds). */
export function DevnetCard() {
  const { cfg } = useApp()
  if (!DevnetCardLazy || !cfg.isDevnet) return null
  return (
    <Suspense fallback={null}>
      <DevnetCardLazy />
    </Suspense>
  )
}

/** The wallet button's element: coins fly to it. */
export const coinTarget: { el: HTMLElement | null } = { el: null }

function connectorIcon(c: Connector) {
  if (c.icon) return <img src={c.icon} alt="" width={22} height={22} style={{ borderRadius: 6 }} />
  const letter = c.name.trim()[0]?.toUpperCase() ?? '?'
  return (
    <span className="connector-letter" aria-hidden="true">
      {letter}
    </span>
  )
}

export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { cfg } = useApp()
  const connectors = useConnectors()
  const { connectAsync, isPending, variables } = useConnect()
  const [error, setError] = useState<string | null>(null)

  const wallets = useMemo(() => {
    const list = connectors.filter((c) => c.type !== 'localKey')
    // Prefer EIP-6963 announced wallets; keep the generic injected one only if nothing announced itself.
    const announced = list.filter((c) => c.id !== 'injected')
    return announced.length ? announced : list
  }, [connectors])
  const hasInjected = typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum)

  const go = async (c: Connector) => {
    setError(null)
    try {
      await connectAsync({ connector: c, chainId: cfg.chainId })
      onClose()
    } catch (e) {
      if (!isUserRejection(e)) setError(humanizeError(e))
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Connect a wallet">
      <div className="stack">
        {wallets.map((c) => (
          <button
            key={c.uid}
            className="connector"
            onClick={() => go(c)}
            disabled={isPending}
            aria-busy={isPending && variables?.connector === c}
          >
            {connectorIcon(c)}
            <span>{c.id === 'injected' ? (hasInjected ? 'Browser wallet' : 'Browser wallet (none found)') : c.name}</span>
            {isPending && variables?.connector === c && <span className="spinner" />}
          </button>
        ))}
        {!hasInjected && wallets.every((c) => c.id === 'injected') && (
          <p className="dim" style={{ fontSize: '0.88rem' }}>
            No browser wallet found. Install an Ethereum wallet such as MetaMask or Rabby, then reload.
          </p>
        )}
        {DevnetConnect && cfg.isDevnet && (
          <Suspense fallback={null}>
            <DevnetConnect onPick={go} pending={isPending} />
          </Suspense>
        )}
        {error && <Notice tone="coral">{error}</Notice>}
        <p className="faint" style={{ fontSize: '0.8rem' }}>
          hmm never asks for your seed phrase. Every transaction is shown in your wallet before you sign.
        </p>
      </div>
    </Modal>
  )
}

export function WalletButton() {
  const { cfg } = useApp()
  const { address, isConnected, chainId, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { switchChainAsync, isPending: switching } = useSwitchChain()
  const [connectOpen, setConnectOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const balances = useBalances(address)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    coinTarget.el = btn.current
    return () => {
      if (coinTarget.el === btn.current) coinTarget.el = null
    }
  })

  useEffect(() => {
    if (!menu) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (!isConnected || !address) {
    return (
      <>
        <Button ref={btn} variant="primary" size="sm" onClick={() => setConnectOpen(true)} className="wallet-btn">
          Connect
        </Button>
        <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      </>
    )
  }

  if (chainId !== cfg.chainId) {
    return (
      <Button
        ref={btn}
        variant="danger"
        size="sm"
        busy={switching}
        onClick={() =>
          switchChainAsync({ chainId: cfg.chainId }).catch((e) => {
            if (!isUserRejection(e)) toast.show({ kind: 'error', title: 'Switch network', body: humanizeError(e), ttl: 9000 })
          })
        }
      >
        Switch to {cfg.chainName}
      </Button>
    )
  }

  const hmm = balances.data ? toNumber(balances.data.hmm) : null
  return (
    <div className="wallet" ref={ref}>
      <button
        ref={btn}
        className="btn btn-sm wallet-btn wallet-connected"
        onClick={() => setMenu((m) => !m)}
        aria-expanded={menu}
        aria-haspopup="menu"
      >
        <span className="wallet-dot" aria-hidden="true" />
        <span className="mono">{shortAddress(address)}</span>
        {hmm !== null && hmm > 0 && (
          <span className="wallet-hmm">
            <AnimatedNumber value={hmm} format={(n) => formatHmm(BigInt(Math.floor(n * 1e6)) * 10n ** 12n)} />
            <small> HMM</small>
          </span>
        )}
      </button>
      {menu && (
        <div className="wallet-menu" role="menu">
          <div className="spread">
            <span className="mono" style={{ fontSize: '0.85rem' }}>
              {shortAddress(address, 6)}
            </span>
            <CopyButton text={address} label="Copy address" />
          </div>
          <dl className="kv" style={{ margin: '12px 0' }}>
            <dt>HMM</dt>
            <dd className="num gold">{balances.data ? formatHmm(balances.data.hmm, { compact: false }) : '…'}</dd>
            <dt>IMD</dt>
            <dd className="num">{balances.data ? formatImd(balances.data.imd) : '…'}</dd>
            <dt>ETH</dt>
            <dd className="num">{balances.data ? formatUnitsFixed(balances.data.eth, 18, { maxFrac: 4 }) : '…'}</dd>
          </dl>
          <div className="stack" style={{ gap: 8 }}>
            <Link className="btn btn-sm" to="/me" onClick={() => setMenu(false)}>
              My thoughts
            </Link>
            {DevnetTools && cfg.isDevnet && (
              <Suspense fallback={null}>
                <DevnetTools compact />
              </Suspense>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMenu(false)
                disconnect({ connector })
              }}
            >
              Disconnect
            </Button>
          </div>
          {connector?.type === 'localKey' && (
            <p className="faint" style={{ fontSize: '0.75rem', marginTop: 10 }}>
              Devnet test wallet: its key lives in this browser and is worthless anywhere else.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
