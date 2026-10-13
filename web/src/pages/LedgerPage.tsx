import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useIndex } from '../data/app'
import { useLiveRound, useMineConsts, useStats } from '../data/hooks'
import { useNow } from '../data/clock'
import { questionsByStatus, roundsNewestFirst, type RoundRec } from '../data/indexer'
import { AnimatedNumber, Reveal } from '../components/ui'
import { AnswerChip, FailureLine, PanelDots, QuestionText } from '../components/question'
import { EmptyPond, HistoryNotice, IndexLoading } from '../components/states'
import { formatClock, formatDate, formatHmm, formatHmmFloat, formatImd, formatInt, plural, toNumber } from '../lib/format'

export default function LedgerPage() {
  const { contracts } = useApp()
  const index = useIndex()
  const stats = useStats().data
  const consts = useMineConsts().data
  const now = useNow()
  const lr = useLiveRound(now)
  const [tab, setTab] = useState<'blocks' | 'mist'>('blocks')

  const rounds = index ? roundsNewestFirst(index) : []
  const failed = index ? questionsByStatus(index, 'failed') : []
  const thinking = index ? questionsByStatus(index, 'asked') : []
  const genesis = stats?.genesis ?? 0n
  const roundLength = consts?.roundLength ?? 600n

  return (
    <div className="page">
      <Reveal className="page-head">
        <span className="eyebrow">the ledger</span>
        <h1>Every block is a round the swarm answered.</h1>
        <p>
          Rounds last {consts ? `${Number(consts.roundLength) / 60} minutes` : '10 minutes'}. The first answer that lands
          in a round opens it as a block with everything emitted since the last answered round; its backers share it
          by the IMD they paid. Rounds without an answer emit nothing: their HMM rolls into the next block.
        </p>
      </Reveal>
      <HistoryNotice />

      {!contracts ? (
        <EmptyPond title="No blocks yet" body="The ledger starts with the first answered question after mining opens." />
      ) : !index || (index.status !== 'live' && index.questions.size === 0) ? (
        <IndexLoading />
      ) : (
        <>
          {lr && lr.live && (
            <Reveal className="card current-round card-glow" index={1}>
              <div className="spread">
                <div className="stack" style={{ gap: 4 }}>
                  <span className="eyebrow">round {lr.round.toString()} · in progress</span>
                  <span className="stat-value gold">
                    <AnimatedNumber value={toNumber(lr.pot)} format={formatHmmFloat} exact={formatHmm(lr.pot)} /> <small>HMM in the pot</small>
                  </span>
                </div>
                <div className="stack" style={{ gap: 4, textAlign: 'right' }}>
                  <span className="stat-label">ends in</span>
                  <span className="stat-value num">{formatClock(Number(lr.roundEndsAt) - now)}</span>
                </div>
              </div>
              <p className="dim" style={{ fontSize: '0.9rem', marginTop: 10 }}>
                {lr.roundShares > 0n
                  ? `Already answered this round: ${formatImd(lr.roundShares)} IMD of questions share the pot.`
                  : thinking.length
                    ? `${plural(thinking.length, 'question')} with the swarm right now. The first answer claims this pot for its backers.`
                    : 'No answer yet this round. If none lands, the pot rolls into the next round.'}
              </p>
            </Reveal>
          )}

          <div className="spread" style={{ margin: '28px 0 18px' }}>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'blocks'} className={['tab', tab === 'blocks' && 'on'].filter(Boolean).join(' ')} onClick={() => setTab('blocks')}>
                Blocks<span className="count">{rounds.length}</span>
              </button>
              <button role="tab" aria-selected={tab === 'mist'} className={['tab', tab === 'mist' && 'on'].filter(Boolean).join(' ')} onClick={() => setTab('mist')}>
                Mist<span className="count">{failed.length}</span>
              </button>
            </div>
            <span className="faint" style={{ fontSize: '0.84rem' }}>
              {formatInt(index.totals.answered)} answered · {formatInt(index.totals.failed)} mist ·{' '}
              {formatInt(index.totals.asked - index.totals.answered - index.totals.failed)} thinking
            </span>
          </div>

          {tab === 'blocks' ? (
            rounds.length === 0 ? (
              <EmptyPond title="No answered rounds yet" body="Ask a question: the first answer opens block one." cta={{ to: '/ask', label: 'Ask the swarm' }} />
            ) : (
              <div className="blocks">
                {rounds.map((r, i) => (
                  <Block
                    key={r.round.toString()}
                    r={r}
                    prev={rounds[i + 1]}
                    index={i}
                    genesis={genesis}
                    roundLength={roundLength}
                    now={now}
                  />
                ))}
              </div>
            )
          ) : failed.length === 0 ? (
            <EmptyPond title="No mist" body="Every question asked so far was answered or is still being thought about." />
          ) : (
            <div className="q-list">
              {failed.map((q, i) => (
                <Reveal key={q.id.toString()} index={Math.min(i, 6)} className="card q-card">
                  <div className="spread">
                    <span className="q-id">#{q.id.toString()}</span>
                    <span className="pill pill-failed">
                      <span className="dot" /> mist
                    </span>
                  </div>
                  <QuestionText q={q} />
                  <FailureLine q={q} />
                  <span className="faint" style={{ fontSize: '0.8rem' }}>
                    {formatImd(q.target)} IMD spent, nothing mined.
                  </span>
                </Reveal>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Block({
  r,
  prev,
  index,
  genesis,
  roundLength,
  now,
}: {
  r: RoundRec
  prev?: RoundRec
  index: number
  genesis: bigint
  roundLength: bigint
  now: number
}) {
  const idx = useIndex()
  const start = Number(genesis + r.round * roundLength)
  const end = start + Number(roundLength)
  const rolled = prev ? Number(r.round - prev.round - 1n) : Number(r.round)
  const ongoing = now < end
  return (
    <Reveal index={Math.min(index, 6)} className={['card', 'block', ongoing && 'block-live'].filter(Boolean).join(' ')}>
      <div className="block-head">
        <div className="block-num">
          <span className="stat-label">block</span>
          <span className="num">{r.round.toString()}</span>
        </div>
        <div className="block-stats">
          <div className="stat">
            <span className="stat-label">mined</span>
            <span className="stat-value gold">{formatHmm(r.reward)}</span>
            <span className="stat-sub">+ {formatHmm(r.devShare)} dev share</span>
          </div>
          <div className="stat">
            <span className="stat-label">rolled in</span>
            <span className="stat-value">{rolled}</span>
            <span className="stat-sub">empty round{rolled === 1 ? '' : 's'} before it</span>
          </div>
          <div className="stat">
            <span className="stat-label">shares</span>
            <span className="stat-value">{formatImd(r.shares)}</span>
            <span className="stat-sub">IMD paid · {plural(r.questionIds.length, 'question')}</span>
          </div>
        </div>
        <span className="faint block-time">
          {genesis !== 0n ? (ongoing ? 'in progress' : `ended ${formatDate(end)}`) : ''}
        </span>
      </div>
      <div className="block-qs">
        {r.questionIds.map((id) => {
          const q = idx?.questions.get(id.toString())
          if (!q) return null
          const per = r.shares === 0n ? 0n : (r.reward * q.target) / r.shares
          return (
            <div key={id.toString()} className="block-q">
              <div className="spread">
                <Link to={`/q/${id}`} className="q-id">
                  #{id.toString()}
                </Link>
                <div className="row" style={{ gap: 8 }}>
                  <AnswerChip q={q} />
                  {q.answer && <PanelDots size={q.answer.panelSize} agreed={q.answer.agreed} />}
                </div>
              </div>
              <QuestionText q={q} />
              <span className="faint" style={{ fontSize: '0.8rem' }}>
                {plural(q.backed.size, 'backer')} shared {formatHmm(per)} HMM
              </span>
            </div>
          )
        })}
      </div>
    </Reveal>
  )
}
