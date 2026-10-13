import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { erc20Abi, maxUint256, type Address } from 'viem'
import { hmmMineAbi } from '../abi'
import { useApp } from '../data/app'
import { useBalances, useMineConsts, useStats } from '../data/hooks'
import { useQuery } from '@tanstack/react-query'
import { useNow } from '../data/clock'
import { useTx } from '../data/tx'
import { netBacking, type QuestionRec } from '../data/indexer'
import { answerLabel, answerText } from '../lib/answer'
import { humanizeReason, failureKind, FAILURE_KIND_LABEL } from '../lib/reasons'
import { formatDuration, formatImd, parseAmount } from '../lib/format'
import { Button, Notice, Progress, StatusPill } from './ui'

export function QuestionText({ q, link = true }: { q: QuestionRec; link?: boolean }) {
  const text = q.text.length > 400 ? `${q.text.slice(0, 400)}…` : q.text
  return <p className="q-text">{link ? <Link to={`/q/${q.id}`}>{text}</Link> : text}</p>
}

export function AnswerChip({ q, full }: { q: QuestionRec; full?: boolean }) {
  if (!q.answer) return <span className="answer-chip">answer pending</span>
  const d = q.answer.decoded
  const cls = d.type === 'bool' ? (d.value ? 'yes' : 'no') : ''
  return (
    <span className={['answer-chip', cls].filter(Boolean).join(' ')} title={answerText(d)}>
      {full ? answerText(d) : answerLabel(d)}
    </span>
  )
}

export function PanelDots({ size, agreed }: { size: number; agreed: number }) {
  const n = Math.min(size, 15)
  const on = Math.min(agreed, n)
  return (
    <span className="panel-dots" title={`${agreed} of ${size} agreed`} aria-label={`${agreed} of ${size} agents agreed`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < on ? 'on' : ''} />
      ))}
    </span>
  )
}

export function FailureLine({ q }: { q: QuestionRec }) {
  if (!q.failure) return null
  const h = humanizeReason(q.failure.reason)
  const kind = FAILURE_KIND_LABEL[failureKind(q.failure.status)]
  return (
    <div className="failure-line">
      <span className="coral">{h.title}</span>
      <span className="dim">
        {' '}
        · {kind}
        {q.failure.agreed !== undefined && q.failure.answered !== undefined && q.failure.answered > 0 && (
          <> · {q.failure.agreed} of {q.failure.answered} agreed</>
        )}
      </span>
      <div className="faint" style={{ fontSize: '0.8rem' }}>
        {h.detail}
      </div>
    </div>
  )
}

export function QuestionStatusPill({ q }: { q: QuestionRec }) {
  const now = useNow()
  if (q.status === 'open' && BigInt(now) > q.deadline) return <StatusPill status="failed" label="funding closed" />
  return <StatusPill status={q.status} />
}

/** Back an open question (approving IMD first if needed); completing it asks it in the same transaction. */
export function BackControls({ q, compact }: { q: QuestionRec; compact?: boolean }) {
  const { cfg, contracts, client } = useApp()
  const { address, isConnected } = useAccount()
  const balances = useBalances(address)
  const price = useStats().data?.price ?? null
  const configVersion = useMineConsts().data?.configVersion ?? 0
  // A question proposed under an older oracle config can never be asked (ConfigChanged); only possible if the
  // config ever changed, so only checked then.
  const version = useQuery({
    queryKey: ['q-version', contracts?.mine, q.id.toString()],
    enabled: Boolean(contracts && configVersion > 0),
    staleTime: Infinity,
    queryFn: async () =>
      Number((await client.readContract({ address: contracts!.mine, abi: hmmMineAbi, functionName: 'question', args: [q.id] })).version),
  }).data
  const stale = configVersion > 0 && version !== undefined && version !== configVersion
  const now = useNow()
  const { run, busy } = useTx()
  const left = q.target - q.raised
  const [text, setText] = useState('')
  const [unlimited, setUnlimited] = useState(false)
  const expired = BigInt(now) > q.deadline
  const mine = address ? netBacking(q, address) : 0n

  if (!contracts) return null
  if (expired) {
    if (!isConnected || mine <= 0n) return null
    return (
      <div className="row">
        <Button
          variant="danger"
          size="sm"
          busy={busy === 'Refund'}
          onClick={() =>
            run('Refund', { address: contracts.mine, abi: hmmMineAbi, functionName: 'refund', args: [q.id] }, { success: `${formatImd(mine)} IMD returned.` })
          }
        >
          Refund my {formatImd(mine)} IMD
        </Button>
      </div>
    )
  }

  const priceRose = price !== null && price > q.target
  if (stale) {
    return (
      <Notice tone="coral">
        This question was proposed under an older oracle setup, so it can't be asked any more. Backers can refund
        after its 3-day window.
      </Notice>
    )
  }
  const typed = text ? parseAmount(text) : null
  const amount = typed === null ? null : typed > left ? left : typed
  const completes = amount !== null && amount === left
  const tooSmall = amount !== null && amount < (left < 10n ** 16n ? left : 10n ** 16n)
  const bal = balances.data
  const needsApproval = Boolean(amount && bal && bal.allowance < amount)
  const short = Boolean(amount && bal && bal.imd < amount)

  let blocked: string | null = null
  if (!isConnected) blocked = 'Connect a wallet to back'
  else if (!text) blocked = 'Enter an amount'
  else if (typed === null) blocked = 'Not a valid amount'
  else if (tooSmall) blocked = 'At least 0.01 IMD'
  else if (completes && priceRose) blocked = "Can't complete: the price rose"
  else if (short) blocked = 'Not enough IMD'

  const back = () =>
    amount &&
    run(
      completes ? 'Complete & ask' : 'Back the question',
      { address: contracts.mine, abi: hmmMineAbi, functionName: 'back', args: [q.id, amount, q.bodyHex] },
      { success: completes ? 'Fully backed and asked. The panel is thinking.' : `Backed with ${formatImd(amount)} IMD.` },
    )
  const approve = () =>
    amount &&
    run(
      'Approve IMD',
      { address: cfg.imd, abi: erc20Abi, functionName: 'approve', args: [contracts.mine, unlimited ? maxUint256 : amount] },
      { success: 'Approved.' },
    )

  return (
    <div className="stack" style={{ gap: 10 }}>
      {priceRose && (
        <Notice tone="coral">
          The Intake's price rose to {formatImd(price!)} IMD since this question was proposed at {formatImd(q.target)}{' '}
          IMD, so it can't be asked. Backers can refund after the deadline.
        </Notice>
      )}
      <div className="back-form">
        <div className="input-wrap">
          <input
            className="input mono"
            inputMode="decimal"
            placeholder={`0.01 – ${formatImd(left)}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={`Amount of IMD to back question ${q.id}`}
          />
          <span className="input-suffix">IMD</span>
        </div>
        {!compact && (
          <div className="chips" style={{ alignSelf: 'center' }}>
            {left > 10n ** 16n && (
              <button className="chip" onClick={() => setText('0.01')}>
                0.01
              </button>
            )}
            {left > 10n ** 17n && (
              <button className="chip" onClick={() => setText('0.1')}>
                0.1
              </button>
            )}
            <button className="chip" onClick={() => setText(formatImd(left).replace(/,/g, ''))}>
              the rest · {formatImd(left)}
            </button>
          </div>
        )}
      </div>
      {needsApproval && !blocked ? (
        <div className="row">
          <Button variant="lilac" size="sm" onClick={approve} busy={busy === 'Approve IMD'}>
            Approve {unlimited ? 'IMD' : `${formatImd(amount!)} IMD`}
          </Button>
          <label className="check" style={{ fontSize: '0.8rem' }}>
            <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
            unlimited
          </label>
        </div>
      ) : (
        <div className="row">
          <Button
            variant={completes ? 'primary' : 'default'}
            size="sm"
            disabled={Boolean(blocked)}
            busy={busy === 'Complete & ask' || busy === 'Back the question'}
            onClick={back}
          >
            {blocked ?? (completes ? `Complete & ask · ${formatImd(amount!)} IMD` : `Back · ${formatImd(amount!)} IMD`)}
          </Button>
          {completes && !blocked && <span className="faint" style={{ fontSize: '0.8rem' }}>Completing it asks the swarm in the same transaction.</span>}
        </div>
      )}
    </div>
  )
}

export function OpenProgress({ q }: { q: QuestionRec }) {
  const now = useNow()
  const frac = q.target === 0n ? 0 : Number((q.raised * 10_000n) / q.target) / 10_000
  const left = Number(q.deadline) - now
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="spread" style={{ fontSize: '0.86rem' }}>
        <span>
          <strong className="num">{formatImd(q.raised)}</strong>
          <span className="dim"> of {formatImd(q.target)} IMD</span>
        </span>
        <span className={left > 0 ? 'dim' : 'coral'}>{left > 0 ? `${formatDuration(left)} left` : 'funding closed'}</span>
      </div>
      <Progress value={frac} />
      <span className="faint" style={{ fontSize: '0.8rem' }}>
        {q.backed.size} backer{q.backed.size === 1 ? '' : 's'}
      </span>
    </div>
  )
}

export function backerShare(q: QuestionRec, who: Address): number {
  const mine = netBacking(q, who)
  return q.target === 0n ? 0 : Number((mine * 10_000n) / q.target) / 10_000
}
