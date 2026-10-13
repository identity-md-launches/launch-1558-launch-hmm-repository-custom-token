import type { ReactNode } from 'react'
import { useIndex } from '../data/app'
import { FrogMascot } from './FrogMascot'
import { ButtonLink, Notice, Progress } from './ui'
import { formatInt } from '../lib/format'

/** An honest empty state with the frog. */
export function EmptyPond({
  title,
  body,
  cta,
  children,
}: {
  title: string
  body?: ReactNode
  cta?: { to: string; label: string }
  children?: ReactNode
}) {
  return (
    <div className="card empty">
      <FrogMascot size={96} />
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {cta && (
        <ButtonLink to={cta.to} variant="primary">
          {cta.label}
        </ButtonLink>
      )}
      {children}
    </div>
  )
}

/** While the indexer catches up with the mine's history. */
export function IndexLoading() {
  const index = useIndex()
  const pct = index?.progress ?? 0
  return (
    <div className="card empty" aria-busy="true">
      <FrogMascot size={80} />
      <h3>Reading the pond's history…</h3>
      <p>Every question, answer and round comes straight from the mine's events on chain.</p>
      <div style={{ width: 'min(320px, 80%)' }}>
        <Progress value={pct} tone="frog" />
      </div>
      {index?.status === 'error' && <p className="coral">Having trouble reaching the chain ({index.error}). Retrying…</p>}
    </div>
  )
}

/** Shown when the RPC would not serve the mine's older logs. */
export function HistoryNotice() {
  const index = useIndex()
  if (!index || index.historyFrom === null) return null
  return (
    <div style={{ marginBottom: 18 }}>
      <Notice tone="lilac" icon="i">
        This site's RPC only serves recent history, so activity before block {formatInt(index.historyFrom)} isn't listed
        here. Contract totals (the pot, HMM mined) and what you can claim are read directly and are complete.
      </Notice>
    </div>
  )
}
