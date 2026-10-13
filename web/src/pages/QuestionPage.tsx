import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { hmmMineAbi } from '../abi'
import { useApp, useIndex } from '../data/app'
import { useBlockTime, useMineConsts, useStats } from '../data/hooks'
import { useNow } from '../data/clock'
import { useTx } from '../data/tx'
import { claimOptions } from '../data/claim'
import { earningOf } from '../data/mining'
import { explorerTx } from '../config'
import { Addr, Button, CopyButton, Reveal } from '../components/ui'
import { AnswerChip, BackControls, FailureLine, OpenProgress, PanelDots, QuestionStatusPill } from '../components/question'
import { ShareCardButton } from '../components/ShareCard'
import { EmptyPond, IndexLoading } from '../components/states'
import { answerText } from '../lib/answer'
import { byteLength } from '../lib/body'
import { formatClock, formatDate, formatHmm, formatImd, formatInt, shortHex } from '../lib/format'
import type { LogRef } from '../data/indexer'

export default function QuestionPage() {
  const { id } = useParams()
  const { contracts, cfg } = useApp()
  const index = useIndex()
  const { address } = useAccount()
  const stats = useStats().data
  const consts = useMineConsts().data
  const now = BigInt(useNow())
  const { run, busy } = useTx()
  const q = id && /^\d+$/.test(id) ? index?.questions.get(BigInt(id).toString()) : undefined
  const timing = stats && consts && stats.genesis !== 0n ? { genesis: stats.genesis, roundLength: consts.roundLength } : null
  const round = q?.round !== undefined ? index?.rounds.get(q.round.toString()) : undefined
  const pretty = useMemo(() => {
    if (!q) return ''
    try {
      return JSON.stringify(JSON.parse(q.json), null, 2)
    } catch {
      return q.json
    }
  }, [q])

  if (!contracts) return <div className="page page-narrow"><EmptyPond title="Mining opens soon" body="Questions appear here once the mine is live." /></div>
  if (!index || (index.status !== 'live' && !q)) return <div className="page page-narrow"><IndexLoading /></div>
  if (!q) {
    return (
      <div className="page page-narrow">
        <EmptyPond title={`No question #${id ?? ''}`} body="It doesn't exist on this mine (yet)." cta={{ to: '/ledger', label: 'Back to the ledger' }} />
      </div>
    )
  }

  const me = address ? earningOf(index, q, address, now, timing) : null
  const backers = [...q.backed.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1))

  return (
    <div className="page page-narrow">
      <Reveal className="page-head">
        <div className="row">
          <Link to="/ledger" className="eyebrow">
            question #{q.id.toString()}
          </Link>
          <QuestionStatusPill q={q} />
          {q.answerType && <span className="tag">{q.answerType}</span>}
        </div>
        <h1 className="q-title">{q.text}</h1>
      </Reveal>

      {q.status === 'answered' && q.answer && (
        <Reveal className="card card-glow answer-card" index={1}>
          <span className="stat-label">the swarm said</span>
          <div className="answer-big">
            <AnswerChip q={q} full />
          </div>
          <div className="row dim" style={{ fontSize: '0.9rem' }}>
            <PanelDots size={q.answer.panelSize} agreed={q.answer.agreed} />
            {q.answer.agreed} of {q.answer.panelSize} agents agreed (quorum {q.answer.quorum}) · signed by the swarm's oracle
          </div>
          {round && (
            <p className="dim" style={{ fontSize: '0.9rem' }}>
              Landed in round {q.round?.toString()}, which mined {formatHmm(round.reward)} HMM for {formatImd(round.shares)} IMD of answered questions.
              This question's backers share {formatHmm(round.shares === 0n ? 0n : (round.reward * q.target) / round.shares)} HMM
              {timing && now < timing.genesis + (q.round! + 1n) * timing.roundLength ? ' (so far: the round is still open)' : ''}.
            </p>
          )}
        </Reveal>
      )}
      {q.status === 'asked' && (
        <Reveal className="card thinking-card" index={1}>
          <div className="thinking-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div>
            <strong className="lilac">The panel is thinking.</strong>
            <p className="dim" style={{ fontSize: '0.9rem' }}>
              Five agents are reading chain data. The answer usually lands within minutes; it mines in whatever round it lands in.
            </p>
          </div>
        </Reveal>
      )}
      {q.status === 'failed' && (
        <Reveal className="card" index={1}>
          <FailureLine q={q} />
          <p className="faint" style={{ fontSize: '0.85rem', marginTop: 8 }}>
            This question mined nothing; its {formatImd(q.target)} IMD went to the swarm.
          </p>
        </Reveal>
      )}
      {q.status === 'open' && (
        <Reveal className="card stack-lg" index={1}>
          <OpenProgress q={q} />
          <BackControls q={q} />
        </Reveal>
      )}

      {me && me.backed > 0n && (
        <Reveal className="card my-part" index={2}>
          <div className="spread">
            <div>
              <span className="stat-label">your part</span>
              <p>
                <strong className="num">{formatImd(me.backed)} IMD</strong>
                {q.status === 'answered' && (
                  <>
                    {' '}
                    → <strong className="num gold">{formatHmm(me.claimed || me.hmm)} HMM</strong>{' '}
                    <span className="dim">
                      {me.claimed > 0n
                        ? 'claimed'
                        : me.final
                          ? 'ready to claim'
                          : `estimate · round ends in ${me.roundEndsAt ? formatClock(Number(me.roundEndsAt - now)) : '…'}`}
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="row">
              {q.status === 'answered' && me.final && me.claimed === 0n && me.hmm > 0n && (
                <Button
                  variant="gold"
                  size="sm"
                  busy={busy === 'Claim HMM'}
                  onClick={() =>
                    run('Claim HMM', { address: contracts.mine, abi: hmmMineAbi, functionName: 'claim', args: [[q.id]] }, claimOptions)
                  }
                >
                  Claim {formatHmm(me.hmm)} HMM
                </Button>
              )}
              {q.status === 'answered' && me.hmm > 0n && <ShareCardButton q={q} hmm={me.claimed || me.hmm} />}
            </div>
          </div>
        </Reveal>
      )}

      <Reveal className="section card" index={2} style={{ marginTop: 22 }}>
        <h2 className="card-title" style={{ marginBottom: 14 }}>
          Timeline
        </h2>
        <ol className="timeline">
          <TimelineItem label="Proposed" refLog={q.proposed} detail={<>by <Addr address={q.proposer} /> · target {formatImd(q.target)} IMD</>} />
          <li className="timeline-item">
            <span className="tl-dot" />
            <div>
              <strong>Backed</strong> <span className="dim">by {q.backed.size} · raised {formatImd(q.raised)} IMD · funding window until {formatDate(Number(q.deadline))}</span>
            </div>
          </li>
          {q.asked && <TimelineItem label="Asked" refLog={q.asked} detail={<>paid {formatImd(q.target)} IMD to the swarm · request {shortHex(q.requestId ?? '')}</>} />}
          {q.status === 'answered' && q.settled && (
            <TimelineItem label="Answered" refLog={q.settled} detail={<>round {q.round?.toString()} · {q.answer ? answerText(q.answer.decoded) : ''}</>} tone="gold" />
          )}
          {q.status === 'failed' && q.settled && <TimelineItem label="Mist" refLog={q.settled} detail={<>{q.failure?.reason}</>} tone="coral" />}
        </ol>
      </Reveal>

      <Reveal className="section card" index={3} style={{ marginTop: 22 }}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 className="card-title">Backers</h2>
          <span className="faint">{backers.length}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Backer</th>
                <th className="r">IMD</th>
                <th className="r">Share</th>
                {q.status === 'answered' && <th className="r">HMM</th>}
              </tr>
            </thead>
            <tbody>
              {backers.map(([who, amount]) => {
                const e = earningOf(index, q, who, now, timing)
                return (
                  <tr key={who}>
                    <td>
                      <Addr address={who} you={address?.toLowerCase() === who.toLowerCase()} />
                    </td>
                    <td className="r num">{formatImd(amount)}</td>
                    <td className="r num">{q.target === 0n ? '–' : `${(Number((amount * 10000n) / q.target) / 100).toFixed(2)}%`}</td>
                    {q.status === 'answered' && <td className="r num gold">{formatHmm(e.claimed || e.hmm)}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal className="section card" index={4} style={{ marginTop: 22 }}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 className="card-title">On chain</h2>
          <span className="faint num" style={{ fontSize: '0.82rem' }}>
            {formatInt(byteLength(q.json))} bytes
          </span>
        </div>
        <dl className="kv" style={{ marginBottom: 14 }}>
          {q.requestId && (
            <>
              <dt>Intake request</dt>
              <dd className="mono" style={{ fontSize: '0.82rem' }}>
                {shortHex(q.requestId, 10)} <CopyButton text={q.requestId} />
              </dd>
            </>
          )}
          {q.adapter && (
            <>
              <dt>Adapter</dt>
              <dd>
                <Addr address={q.adapter} />
              </dd>
            </>
          )}
          {q.answer && (
            <>
              <dt>Oracle request</dt>
              <dd className="mono" style={{ fontSize: '0.82rem' }}>
                {shortHex(q.answer.oracleRequestId, 10)}
              </dd>
            </>
          )}
          <dt>Chain</dt>
          <dd>{cfg.chainName}</dd>
        </dl>
        <pre className="blob">{pretty}</pre>
      </Reveal>
    </div>
  )
}

function TimelineItem({ label, refLog, detail, tone }: { label: string; refLog: LogRef; detail: React.ReactNode; tone?: 'gold' | 'coral' }) {
  const { cfg } = useApp()
  const time = useBlockTime(refLog.block).data
  const link = explorerTx(cfg, refLog.tx)
  return (
    <li className={['timeline-item', tone].filter(Boolean).join(' ')}>
      <span className="tl-dot" />
      <div>
        <strong>{label}</strong> <span className="dim">{detail}</span>
        <div className="faint" style={{ fontSize: '0.78rem' }}>
          block {formatInt(refLog.block)}
          {time ? ` · ${formatDate(time)}` : ''}
          {link && (
            <>
              {' · '}
              <a href={link} target="_blank" rel="noreferrer noopener">
                tx ↗
              </a>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
