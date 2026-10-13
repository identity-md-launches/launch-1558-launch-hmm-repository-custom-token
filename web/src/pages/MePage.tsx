import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { hmmMineAbi } from '../abi'
import { useApp, useIndex } from '../data/app'
import { useBalances, useChainSweep, useClaimable, useMineConsts, useStats, type SweepRow } from '../data/hooks'
import { useNow } from '../data/clock'
import { useTx } from '../data/tx'
import { claimOptions } from '../data/claim'
import { questionsBackedBy } from '../data/indexer'
import { earningOf, type Earning } from '../data/mining'
import { AnimatedNumber, Button, Reveal } from '../components/ui'
import { AnswerChip, BackControls, FailureLine, OpenProgress, QuestionStatusPill, QuestionText, PanelDots } from '../components/question'
import { ShareCardButton } from '../components/ShareCard'
import { ConnectModal, DevnetCard } from '../components/Wallet'
import { EmptyPond, HistoryNotice, IndexLoading } from '../components/states'
import { formatClock, formatHmm, formatHmmFloat, formatImd, formatImdFloat, toNumber } from '../lib/format'

export default function MePage() {
  const { contracts } = useApp()
  const { address, isConnected } = useAccount()
  const index = useIndex()
  const stats = useStats().data
  const consts = useMineConsts().data
  const balances = useBalances(address)
  const now = BigInt(useNow())
  const { run, busy } = useTx()
  const [connectOpen, setConnectOpen] = useState(false)

  const timing = stats && consts && stats.genesis !== 0n ? { genesis: stats.genesis, roundLength: consts.roundLength } : null
  const mine = useMemo(() => (index && address ? questionsBackedBy(index, address) : []), [index, address, index?.version])
  const earnings: Earning[] = useMemo(
    () => (index && address ? mine.map((q) => earningOf(index, q, address, now, timing)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mine, address, now, timing?.genesis, timing?.roundLength, index?.version],
  )
  const answeredIds = earnings.filter((e) => e.q.status === 'answered' && e.claimed === 0n).map((e) => e.q.id)
  const onchain = useClaimable(address, answeredIds).data

  // When the RPC could not serve old logs, find the rest of this wallet's questions from views alone.
  const partial = Boolean(index && index.historyFrom !== null)
  const sweep = useChainSweep(address, partial).data ?? []
  const orphans = sweep.filter((r) => !index?.questions.has(r.id.toString()))
  const claimIds = [
    ...earnings.filter((e) => e.claimable > 0n || (onchain?.get(e.q.id.toString()) ?? 0n) > 0n).map((e) => e.q.id),
    ...orphans.filter((r) => r.claimable > 0n).map((r) => r.id),
  ]
  const claimableTotal =
    earnings.reduce((s, e) => s + (onchain?.get(e.q.id.toString()) || e.claimable), 0n) +
    orphans.reduce((s, r) => s + r.claimable, 0n)
  const pending = earnings.filter((e) => e.q.status === 'answered' && !e.final).reduce((s, e) => s + e.hmm, 0n)
  const claimed = earnings.reduce((s, e) => s + e.claimed, 0n)
  const imdPaid = earnings.filter((e) => e.q.status !== 'open').reduce((s, e) => s + e.backed, 0n)

  if (!isConnected || !address) {
    return (
      <div className="page page-narrow">
        <Reveal className="page-head">
          <span className="eyebrow">my thoughts</span>
          <h1>Your questions and what they mined.</h1>
        </Reveal>
        <EmptyPond title="Connect a wallet" body="See the questions you backed, what they mined, and claim your HMM.">
          <Button variant="primary" onClick={() => setConnectOpen(true)}>
            Connect
          </Button>
        </EmptyPond>
        <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      </div>
    )
  }

  const claimAll = () =>
    contracts &&
    run(
      'Claim HMM',
      { address: contracts.mine, abi: hmmMineAbi, functionName: 'claim', args: [claimIds] },
      claimOptions,
    )

  return (
    <div className="page">
      <Reveal className="page-head">
        <span className="eyebrow">my thoughts</span>
        <h1>Your questions and what they mined.</h1>
      </Reveal>
      <HistoryNotice />

      <DevnetCard />

      <Reveal index={1} className="me-stats grid grid-4" style={{ marginTop: 18 }}>
        <div className="card stat">
          <span className="stat-label">HMM in your wallet</span>
          <span className="stat-value gold">
            <AnimatedNumber value={balances.data ? toNumber(balances.data.hmm) : null} format={formatHmmFloat} exact={balances.data ? formatHmm(balances.data.hmm) : undefined} />
          </span>
          <span className="stat-sub">{balances.data ? `${formatImd(balances.data.imd)} IMD` : ' '}</span>
        </div>
        <div className="card stat card-glow">
          <span className="stat-label">Claimable now</span>
          <span className="stat-value">
            <AnimatedNumber value={toNumber(claimableTotal)} format={formatHmmFloat} exact={formatHmm(claimableTotal)} />
            <small>HMM</small>
          </span>
          <Button variant="gold" size="sm" shine={claimIds.length > 0} disabled={claimIds.length === 0} busy={busy === 'Claim HMM'} onClick={claimAll}>
            {claimIds.length ? `Claim all (${claimIds.length})` : 'Nothing to claim yet'}
          </Button>
        </div>
        <div className="card stat">
          <span className="stat-label">Mining this round</span>
          <span className="stat-value">
            <AnimatedNumber value={toNumber(pending)} format={formatHmmFloat} exact={formatHmm(pending)} />
            <small>HMM</small>
          </span>
          <span className="stat-sub">estimate; final when the round ends</span>
        </div>
        <div className="card stat">
          <span className="stat-label">IMD paid to the swarm</span>
          <span className="stat-value">
            <AnimatedNumber value={toNumber(imdPaid)} format={formatImdFloat} exact={formatImd(imdPaid)} />
            <small>IMD</small>
          </span>
          <span className="stat-sub">{formatHmm(claimed)} HMM claimed so far</span>
        </div>
      </Reveal>

      <section className="section" style={{ marginTop: 40 }}>
        {!contracts ? (
          <EmptyPond title="Mining opens soon" body="Once the mine is live, the questions you back show up here." />
        ) : !index || (index.status !== 'live' && index.questions.size === 0) ? (
          <IndexLoading />
        ) : earnings.length === 0 && orphans.length === 0 ? (
          <EmptyPond title="No thoughts yet" body="Ask the swarm something. If the panel agrees, you mine HMM." cta={{ to: '/ask', label: 'Ask a question' }} />
        ) : (
          <div className="q-list">
            {earnings.map((e, i) => (
              <MyRow key={e.q.id.toString()} e={e} index={i} now={now} chainClaimable={onchain?.get(e.q.id.toString())} />
            ))}
            {orphans.map((r) => (
              <OlderRow key={r.id.toString()} r={r} now={now} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function MyRow({ e, index, now, chainClaimable }: { e: Earning; index: number; now: bigint; chainClaimable?: bigint }) {
  const q = e.q
  const share = q.target === 0n ? 0 : Number((e.backed * 10_000n) / q.target) / 100
  return (
    <Reveal index={Math.min(index, 6)} className="card q-card hoverable">
      <div className="spread">
        <span className="q-id">#{q.id.toString()}</span>
        <div className="row" style={{ gap: 8 }}>
          {q.answerType && <span className="tag">{q.answerType}</span>}
          <QuestionStatusPill q={q} />
        </div>
      </div>
      <QuestionText q={q} />
      <div className="q-meta">
        <span>
          you put in <strong className="num">{formatImd(e.backed)} IMD</strong> ({share.toFixed(share < 1 ? 2 : 0)}% of it)
        </span>
        {q.status === 'answered' && q.answer && (
          <span className="row" style={{ gap: 8 }}>
            the swarm said <AnswerChip q={q} /> <PanelDots size={q.answer.panelSize} agreed={q.answer.agreed} />
          </span>
        )}
      </div>
      {q.status === 'open' && (
        <>
          <OpenProgress q={q} />
          <BackControls q={q} compact />
        </>
      )}
      {q.status === 'asked' && <p className="lilac" style={{ fontSize: '0.9rem' }}>The panel is thinking…</p>}
      {q.status === 'failed' && (
        <>
          <FailureLine q={q} />
          <p className="faint" style={{ fontSize: '0.82rem' }}>
            This question mined nothing. The IMD paid for it went to the swarm.
          </p>
        </>
      )}
      {q.status === 'answered' && (
        <div className="spread mined-line">
          <div>
            {e.claimed > 0n ? (
              <span>
                Claimed <strong className="gold num">{formatHmm(e.claimed)} HMM</strong>
              </span>
            ) : e.final ? (
              <span>
                Ready to claim <strong className="gold num">{formatHmm(chainClaimable || e.hmm)} HMM</strong>
              </span>
            ) : (
              <span>
                Mining ≈ <strong className="gold num">{formatHmm(e.hmm)} HMM</strong>
                <span className="dim">
                  {' '}
                  · round {q.round?.toString()} ends in {e.roundEndsAt ? formatClock(Number(e.roundEndsAt - now)) : '…'}
                </span>
              </span>
            )}
          </div>
          <div className="row">
            <Link className="btn btn-sm btn-ghost" to={`/q/${q.id}`}>
              Details
            </Link>
            {e.hmm > 0n && <ShareCardButton q={q} hmm={e.claimed || chainClaimable || e.hmm} />}
          </div>
        </div>
      )}
    </Reveal>
  )
}

const STATUS_NAMES = ['unknown', 'raising', 'thinking', 'answered', 'mist']

/** A question found through views only (its text is in logs this RPC does not serve). */
function OlderRow({ r, now }: { r: SweepRow; now: bigint }) {
  const { contracts } = useApp()
  const { run, busy } = useTx()
  const refundable = r.status === 1 && now > r.deadline
  return (
    <div className="card q-card">
      <div className="spread">
        <span className="q-id">#{r.id.toString()}</span>
        <span className="pill">{STATUS_NAMES[r.status] ?? 'unknown'}</span>
      </div>
      <p className="dim" style={{ fontSize: '0.9rem' }}>
        An older question: its text is in history this site's RPC does not serve. You have {formatImd(r.backing)} IMD in
        it.
      </p>
      <div className="row">
        {r.claimable > 0n && <span className="gold num">{formatHmm(r.claimable)} HMM claimable</span>}
        {refundable && contracts && (
          <Button
            variant="danger"
            size="sm"
            busy={busy === 'Refund'}
            onClick={() => run('Refund', { address: contracts.mine, abi: hmmMineAbi, functionName: 'refund', args: [r.id] }, { success: 'Refunded.' })}
          >
            Refund {formatImd(r.backing)} IMD
          </Button>
        )}
      </div>
    </div>
  )
}
