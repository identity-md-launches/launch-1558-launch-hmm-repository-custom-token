import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { erc20Abi, hexToString, maxUint256, parseEventLogs, type Address } from 'viem'
import { hmmMineAbi } from '../abi'
import { useApp } from '../data/app'
import { useBalances, useIntakePrice, useStats } from '../data/hooks'
import { useNow } from '../data/clock'
import { useTx } from '../data/tx'
import {
  byteLength,
  checkFreeform,
  fillTemplate,
  templates,
  toRawUnits,
  type AnswerType,
  type Template,
  type TemplateField,
} from '../lib/body'
import {
  MAX_QUESTION_BYTES,
  SPEC_ANSWER_TYPES,
  SPEC_CHAINS,
  badQuestionChars,
  minQuorum,
  specBody,
  specError,
  specFor,
  toAsciiQuestion,
  type Spec,
  type SpecAnswerType,
} from '../lib/spec'
import { checkQuestion } from '../lib/check'
import { humanizeReason } from '../lib/reasons'
import { formatDuration, formatImd, formatInt, formatUnitsFixed, parseAmount } from '../lib/format'
import { Button, ButtonLink, Notice, Reveal } from '../components/ui'
import { ConnectModal } from '../components/Wallet'
import { useTokenInfo } from '../data/token'
import { TemplateIcon } from '../components/icons'

const MIN_BACKING = 10n ** 16n

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const ANSWER_LABEL: Record<AnswerType, string> = {
  bool: 'yes / no',
  uint256: 'a number',
  address: 'an address',
  bytes32: 'a bytes32 value',
  'address[]': 'a list of addresses',
  'bytes32[]': 'a list of bytes32 values',
}

export default function AskPage() {
  const { cfg, contracts, launch, client } = useApp()
  const { address, isConnected } = useAccount()
  const stats = useStats().data
  const intakePrice = useIntakePrice().data
  const price = stats?.price ?? intakePrice ?? null
  const balances = useBalances(address)
  const now = useNow()
  const [params] = useSearchParams()

  const extraTokens = useMemo(
    () => (contracts && cfg.chainId === 1 ? [{ label: 'HMM', value: contracts.hmm, note: 'this coin' }] : []),
    [contracts, cfg.chainId],
  )
  const tpls = useMemo(() => templates(extraTokens), [extraTokens])
  const [tplId, setTplId] = useState<string>(() => params.get('t') ?? 'supply-threshold')
  const [values, setValues] = useState<Record<string, Record<string, string>>>({})
  const [free, setFree] = useState<FreeState>({
    question: '',
    answerType: 'bool',
    ack: false,
    evidence: 0,
    chainId: 1,
    windowHours: 24,
    panelSize: 5,
    quorum: 4,
    toleranceBps: 0,
  })
  const [mode, setMode] = useState<'solo' | 'pool'>('solo')
  const [amountText, setAmountText] = useState('0.1')
  const [unlimited, setUnlimited] = useState(false)
  const [showBytes, setShowBytes] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [done, setDone] = useState<{ id: bigint; solo: boolean } | null>(null)
  const { run, busy } = useTx()

  const isFree = tplId === 'free'
  const tpl = tpls.find((t) => t.id === tplId) ?? null
  const tplValues = useMemo(() => {
    if (!tpl) return {}
    const v = values[tpl.id] ?? {}
    return Object.fromEntries(tpl.fields.map((f) => [f.key, v[f.key] ?? f.initial ?? '']))
  }, [tpl, values])
  const filled = tpl ? fillTemplate(tpl, tplValues) : null
  const freeError = isFree ? checkFreeform(free.question) : null
  const question = isFree ? (freeError ? null : free.question.trim()) : (filled?.question ?? null)
  const answerType: SpecAnswerType = isFree ? free.answerType : ((tpl?.answerType ?? 'bool') as SpecAnswerType)
  const spec: Spec | null = question
    ? isFree
      ? specFor(question, answerType, {
          evidence: free.evidence,
          chainId: free.chainId,
          windowHours: free.windowHours,
          panelSize: free.panelSize,
          quorum: free.quorum,
          toleranceBps: answerType === 'uint256' ? free.toleranceBps : 0,
        })
      : specFor(question, answerType)
    : null
  const specErr = spec ? specError(spec) : null
  const localBody = spec && !specErr ? specBody(spec) : null
  // The mine composes the body on chain; read it back so what we show is exactly what gets paid for.
  const chainBody = useQuery({
    queryKey: ['bodyOf', contracts?.mine, localBody],
    enabled: Boolean(contracts && spec && !specErr),
    staleTime: Infinity,
    retry: 0,
    queryFn: async () =>
      hexToString(await client.readContract({ address: contracts!.mine, abi: hmmMineAbi, functionName: 'bodyOf', args: [spec!] })),
  })
  const body = chainBody.data ?? localBody
  const bodyMismatch = Boolean(chainBody.data && localBody && chainBody.data !== localBody)
  const bytes = body ? byteLength(body) : 0
  const qBytes = question ? byteLength(question) : isFree ? byteLength(free.question.trim()) : 0
  const tooBig = qBytes > MAX_QUESTION_BYTES

  // The swarm's free check (through the configured proxy), debounced.
  const checkSpecJson = spec && !specErr ? JSON.stringify({ ...spec, answerType }) : null
  const checkKey = useDebounced(checkSpecJson, 850)
  const check = useQuery({
    queryKey: ['check', checkKey],
    enabled: Boolean(cfg.checkUrl && checkKey),
    staleTime: 15 * 60_000,
    retry: 0,
    queryFn: ({ signal }) => {
      const sp = JSON.parse(checkKey!) as Omit<Spec, 'answerType'> & { answerType: SpecAnswerType }
      return checkQuestion(
        cfg.checkUrl!,
        {
          question: sp.question,
          answerType: sp.answerType,
          evidence: sp.evidence === 1 ? 'panel' : 'chain',
          chainId: sp.chainId,
          panelSize: sp.panelSize,
          toleranceBps: sp.toleranceBps,
        },
        signal,
      )
    },
  })
  const checkFresh = checkKey === checkSpecJson
  const blockers = check.data?.blockers ?? []

  // amount
  const poolAmount = parseAmount(amountText)
  const amount = mode === 'solo' ? price : poolAmount
  const amountError =
    mode === 'pool'
      ? poolAmount === null
        ? 'Enter an amount in IMD'
        : poolAmount < MIN_BACKING
          ? 'At least 0.01 IMD'
          : price !== null && poolAmount >= price
            ? 'That is the full price: choose "Solo ask"'
            : null
      : null

  const genesis = stats?.genesis ?? 0n
  const live = Boolean(contracts && stats && genesis !== 0n && BigInt(now) >= genesis)
  const bal = balances.data
  const needsApproval = Boolean(amount && bal && bal.allowance < amount)
  const short = Boolean(amount && bal && bal.imd < amount)

  let blocked: string | null = null
  if (!contracts) blocked = launch === 'discovering' ? 'Finding the mine…' : 'Mining opens soon'
  else if (!live) blocked = genesis > 0n ? `Mining opens in ${formatDuration(Number(genesis) - now)}` : 'Mining has not started'
  else if (!question) blocked = isFree ? (freeError ?? 'Write your question') : 'Fill in the blanks'
  else if (specErr) blocked = specErr
  else if (tooBig) blocked = 'The question is too long'
  else if (price === null) blocked = 'Reading the price…'
  else if (amountError) blocked = amountError
  else if (cfg.checkUrl && checkFresh && blockers.length) blocked = 'The swarm would refuse this question'
  else if (isFree && cfg.checkUrl && (!checkFresh || check.isFetching || !check.data))
    blocked = check.isError ? 'The check failed: try again' : 'Checking with the swarm…'
  else if (isFree && !free.ack) blocked = 'Tick the box to confirm you understand'
  else if (short) blocked = `Not enough IMD (you have ${formatImd(bal!.imd)})`

  const setField = (t: Template, key: string, v: string) =>
    setValues((all) => ({ ...all, [t.id]: { ...(all[t.id] ?? {}), [key]: v } }))

  const approve = () =>
    contracts &&
    amount &&
    run(
      'Approve IMD',
      {
        address: cfg.imd,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contracts.mine, unlimited ? maxUint256 : amount],
      },
      { success: unlimited ? 'The mine may now spend your IMD.' : `The mine may now spend ${formatImd(amount)} IMD.` },
    )

  const ask = async () => {
    if (!contracts || !spec || specErr || !amount) return
    const receipt = await run(
      mode === 'solo' ? 'Ask the swarm' : 'Propose the question',
      { address: contracts.mine, abi: hmmMineAbi, functionName: 'propose', args: [spec, amount] },
      { success: mode === 'solo' ? 'Asked. The panel is thinking.' : 'Proposed. Others can back it now.' },
    )
    if (!receipt) return
    const [proposed] = parseEventLogs({ abi: hmmMineAbi, logs: receipt.logs, eventName: 'Proposed' })
    const asked = parseEventLogs({ abi: hmmMineAbi, logs: receipt.logs, eventName: 'Asked' }).length > 0
    if (proposed) setDone({ id: proposed.args.id, solo: asked })
  }

  if (done) return <AskedCelebration id={done.id} solo={done.solo} onAgain={() => setDone(null)} />

  return (
    <div className="page ask-page">
      <Reveal className="page-head">
        <span className="eyebrow">ask the swarm</span>
        <h1>
          Ask a question. <span className="grad-text">If the swarm agrees, you mine.</span>
        </h1>
        <p>
          A panel of five IMD agents reads chain data and answers. When at least four agree and the oracle signs it,
          your question mines HMM in the round it lands in.{' '}
          {price !== null && (
            <>
              Asking costs <strong className="num">{formatImd(price)} IMD</strong> right now, paid to the swarm.
            </>
          )}
        </p>
      </Reveal>

      <div className="ask-grid">
        <div className="stack-lg">
          <Reveal as="section" index={1} className="card">
            <StepTitle n={1} title="Pick a question" sub="Vetted wordings the swarm reads one way. Fill in the blanks." />
            <div className="tpl-grid">
              {tpls.map((t) => (
                <button
                  key={t.id}
                  className={['tpl', tplId === t.id && 'on'].filter(Boolean).join(' ')}
                  onClick={() => setTplId(t.id)}
                  aria-pressed={tplId === t.id}
                >
                  <TemplateIcon id={t.id} />
                  <span className="tpl-title">{t.title}</span>
                  <span className="tpl-blurb">{t.blurb}</span>
                  <span className="tag">{ANSWER_LABEL[t.answerType]}</span>
                </button>
              ))}
              <button
                className={['tpl', 'tpl-free', tplId === 'free' && 'on'].filter(Boolean).join(' ')}
                onClick={() => setTplId('free')}
                aria-pressed={tplId === 'free'}
              >
                <TemplateIcon id="free" />
                <span className="tpl-title">Write your own</span>
                <span className="tpl-blurb">Free-form. Riskier: unclear questions get refused and still cost IMD.</span>
                <span className="tag">advanced</span>
              </button>
            </div>
          </Reveal>

          <Reveal as="section" index={2} className="card">
            <StepTitle
              n={2}
              title={isFree ? 'Write it' : 'Fill in the blanks'}
              sub={isFree ? 'Name the chain, the contract, the exact quantity and the block range.' : tpl?.blurb}
            />
            {isFree ? (
              <FreeForm free={free} setFree={setFree} error={free.question ? (freeError ?? specErr) : null} />
            ) : (
              tpl && (
                <div className="stack-lg">
                  {tpl.fields.map((f) => (
                    <FieldInput
                      key={f.key}
                      field={f}
                      value={tplValues[f.key] ?? ''}
                      error={tplValues[f.key] ? filled?.errors[f.key] : undefined}
                      decimals={unitDecimals(f, tplValues)}
                      onChange={(v) => setField(tpl, f.key, v)}
                    />
                  ))}
                </div>
              )
            )}
          </Reveal>

          <Reveal as="section" index={3} className="card">
            <StepTitle n={3} title="Pay for it" sub="Alone, or start it and let others chip in." />
            <div className="pay-modes" role="radiogroup" aria-label="How to pay">
              <button role="radio" aria-checked={mode === 'solo'} className={['pay-mode', mode === 'solo' && 'on'].filter(Boolean).join(' ')} onClick={() => setMode('solo')}>
                <strong>Solo ask</strong>
                <span>Pay the full {price !== null ? `${formatImd(price)} IMD` : 'price'} and it is asked right away. You mine the whole share.</span>
              </button>
              <button role="radio" aria-checked={mode === 'pool'} className={['pay-mode', mode === 'pool' && 'on'].filter(Boolean).join(' ')} onClick={() => setMode('pool')}>
                <strong>Start a pooled question</strong>
                <span>Put in from 0.01 IMD. Anyone can back the rest within 3 days; it is asked the moment it is full.</span>
              </button>
            </div>
            {mode === 'pool' && (
              <div className="field" style={{ marginTop: 16 }}>
                <label htmlFor="pool-amount">Your part</label>
                <div className="input-wrap">
                  <input
                    id="pool-amount"
                    className={['input', 'mono', amountError && amountText ? 'invalid' : ''].join(' ')}
                    inputMode="decimal"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                  />
                  <span className="input-suffix">IMD</span>
                </div>
                {amountError && amountText ? (
                  <span className="field-error">{amountError}</span>
                ) : (
                  <span className="field-help">
                    If it is not fully backed within 3 days, every backer can take their IMD back.
                  </span>
                )}
              </div>
            )}
          </Reveal>
        </div>

        <aside className="ask-side">
          <div className="card card-glow preview">
            <div className="spread">
              <span className="eyebrow">your question</span>
              <span className="tag">{ANSWER_LABEL[answerType]}</span>
            </div>
            <p className={['preview-q', !question && 'empty-q'].filter(Boolean).join(' ')}>
              {question ?? (isFree ? 'Your question appears here.' : 'Fill in the blanks to see the exact question.')}
            </p>
            <div className="preview-meta">
              <span>{SPEC_CHAINS.find((c) => c.id === (spec?.chainId ?? 1))?.name ?? 'Ethereum mainnet'}</span>
              <span>last {spec?.windowHours ?? 24} hours</span>
              <span>
                panel {spec?.panelSize ?? 5} · quorum {spec?.quorum ?? 4}
              </span>
              <span>{spec?.evidence === 1 ? 'panel evidence' : 'chain evidence'}</span>
            </div>

            <CheckPanel
              enabled={Boolean(cfg.checkUrl)}
              ready={Boolean(question && !tooBig)}
              loading={check.isFetching || (Boolean(question) && !checkFresh)}
              error={check.isError ? (check.error as Error).message : null}
              blockers={checkFresh ? blockers : []}
              suggestions={checkFresh ? (check.data?.suggestions ?? []) : []}
              online={check.data?.online ?? null}
              onRetry={() => void check.refetch()}
              freeForm={isFree}
            />

            <div className="bytes">
              <div className="spread">
                <button className="link-btn" onClick={() => setShowBytes((s) => !s)} aria-expanded={showBytes}>
                  {showBytes ? 'Hide' : 'Show'} the exact bytes that go on chain
                </button>
                <span className={['num', tooBig ? 'coral' : 'faint'].join(' ')} style={{ fontSize: '0.8rem' }}>
                  question {formatInt(qBytes)} / {formatInt(MAX_QUESTION_BYTES)} bytes
                </span>
              </div>
              <div className="bytes-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (qBytes / MAX_QUESTION_BYTES) * 100)}%` }} className={tooBig ? 'over' : ''} />
              </div>
              {showBytes && (
                <>
                  <pre className="blob">{body ?? '(nothing yet)'}</pre>
                  <span className="faint" style={{ fontSize: '0.78rem' }}>
                    {body
                      ? `${formatInt(bytes)} bytes, composed by the mine from your question (${chainBody.data ? 'read back from the contract' : 'preview'}).`
                      : ''}
                  </span>
                </>
              )}
              {bodyMismatch && (
                <Notice tone="coral">The contract composes this question differently than this page expected. The contract's version above is what will be paid for.</Notice>
              )}
            </div>

            <Notice tone="coral" icon="!">
              <strong>If the swarm refuses or can't agree, the IMD is spent and nothing is mined.</strong> The question
              is public on chain forever.
            </Notice>

            <div className="submit">
              <div className="spread" style={{ fontSize: '0.88rem' }}>
                <span className="dim">{mode === 'solo' ? 'You pay' : 'You put in'}</span>
                <strong className="num">{amount !== null ? `${formatImd(amount)} IMD` : '–'}</strong>
              </div>
              {bal && (
                <div className="spread faint" style={{ fontSize: '0.8rem' }}>
                  <span>Your IMD</span>
                  <span className="num">{formatImd(bal.imd)}</span>
                </div>
              )}
              {!isConnected ? (
                <Button variant="primary" size="lg" onClick={() => setConnectOpen(true)}>
                  Connect a wallet to ask
                </Button>
              ) : needsApproval && !blocked ? (
                <div className="stack">
                  <label className="check">
                    <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
                    <span>Approve unlimited IMD for the mine (skip this step next time)</span>
                  </label>
                  <Button variant="lilac" size="lg" onClick={approve} busy={busy === 'Approve IMD'}>
                    Step 1 of 2 · Approve {unlimited ? 'IMD' : `${formatImd(amount!)} IMD`}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  shine={!blocked}
                  disabled={Boolean(blocked)}
                  busy={busy === 'Ask the swarm' || busy === 'Propose the question'}
                  onClick={ask}
                >
                  {blocked ?? (mode === 'solo' ? `Ask the swarm · ${formatImd(amount!)} IMD` : `Propose · ${formatImd(amount!)} IMD`)}
                </Button>
              )}
              {__HMM_DEVNET__ && cfg.isDevnet && isConnected && bal && bal.imd === 0n && (
                <p className="faint" style={{ fontSize: '0.8rem' }}>
                  No test IMD? Use “Get test IMD” in the wallet menu.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </div>
  )
}

function unitDecimals(f: TemplateField, values: Record<string, string>): number | null {
  if (!f.unitHelper) return null
  const d = f.unitHelper.decimals
  if (typeof d === 'number') return d
  const n = Number(values[d])
  return Number.isInteger(n) && n >= 0 && n <= 36 ? n : null
}

function StepTitle({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="step-title">
      <span className="step-n" aria-hidden="true">
        {n}
      </span>
      <div>
        <h2 className="card-title">{title}</h2>
        {sub && <p className="dim" style={{ fontSize: '0.9rem' }}>{sub}</p>}
      </div>
    </div>
  )
}

function FieldInput({
  field,
  value,
  error,
  decimals,
  onChange,
}: {
  field: TemplateField
  value: string
  error?: string
  decimals: number | null
  onChange: (v: string) => void
}) {
  const id = `f-${field.key}`
  const [units, setUnits] = useState('')
  const valid = Boolean(value) && !error
  const info = useTokenInfo(field.kind === 'address' && valid ? (value as Address) : undefined)
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      {field.presets && (
        <div className="chips">
          {field.presets.map((p) => (
            <button
              key={p.value}
              type="button"
              className={['chip', value.toLowerCase() === p.value.toLowerCase() && 'on'].filter(Boolean).join(' ')}
              onClick={() => onChange(p.value)}
              title={p.note ?? p.value}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="input-wrap">
        <input
          id={id}
          className={['input', 'mono', error ? 'invalid' : valid ? 'valid' : ''].join(' ')}
          value={value}
          placeholder={field.placeholder}
          spellCheck={false}
          autoComplete="off"
          inputMode={field.kind === 'uint' || field.kind === 'decimals' ? 'numeric' : 'text'}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help`}
        />
        {valid && <span className="input-suffix frog">✓</span>}
      </div>
      <span id={`${id}-help`} className={error ? 'field-error' : 'field-help'}>
        {error ??
          (field.kind === 'address' && valid
            ? info.data
              ? info.data.kind === 'token'
                ? `${info.data.symbol ?? 'token'}${info.data.name ? ` · ${info.data.name}` : ''}${info.data.decimals !== null ? ` · ${info.data.decimals} decimals` : ''}`
                : info.data.kind === 'contract'
                  ? 'a contract'
                  : 'an account (no contract code)'
              : 'checking…'
            : field.help)}
      </span>
      {decimals !== null && (
        <div className="unit-helper">
          <input
            className="input mono"
            style={{ minHeight: 38, fontSize: '0.82rem' }}
            placeholder={`or type an amount in whole ${field.unitHelper?.symbol ?? 'tokens'}`}
            value={units}
            inputMode="decimal"
            onChange={(e) => {
              setUnits(e.target.value)
              const raw = toRawUnits(e.target.value, decimals)
              if (raw !== null) onChange(raw)
            }}
            aria-label={`${field.label} in whole units`}
          />
          {valid && /^\d+$/.test(value) && (
            <span className="faint num" style={{ fontSize: '0.78rem' }}>
              = {formatUnitsFixed(BigInt(value), decimals, { maxFrac: 6 })} {field.unitHelper?.symbol ?? ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

interface FreeState {
  question: string
  answerType: SpecAnswerType
  ack: boolean
  evidence: number
  chainId: number
  windowHours: number
  panelSize: number
  quorum: number
  toleranceBps: number
}

function FreeForm({
  free,
  setFree,
  error,
}: {
  free: FreeState
  setFree: (f: FreeState) => void
  error: string | null
}) {
  const [advanced, setAdvanced] = useState(false)
  const bad = badQuestionChars(free.question)
  const set = (patch: Partial<FreeState>) => setFree({ ...free, ...patch })
  return (
    <div className="stack-lg">
      <Notice tone="lilac" icon="i">
        Free-form questions fail more often. The swarm refuses anything it can read two ways or cannot settle from
        its evidence, and a refused or split question still spends the IMD. Start from a template when you can.
      </Notice>
      <div className="field">
        <label htmlFor="free-q">Question</label>
        <textarea
          id="free-q"
          className={['textarea', error ? 'invalid' : ''].join(' ')}
          value={free.question}
          maxLength={2400}
          placeholder="At the window's closing block, was ... on Ethereum mainnet greater than ...?"
          onChange={(e) => set({ question: e.target.value })}
        />
        {error ? <span className="field-error">{error}</span> : <span className="field-help">{byteLength(free.question)} / 2,000 characters · plain ASCII, no double quotes or backslashes</span>}
        {bad.length > 0 && (
          <button type="button" className="chip" style={{ justifySelf: 'start' }} onClick={() => set({ question: toAsciiQuestion(free.question) })}>
            Clean it up: replace curly quotes, dashes and line breaks
          </button>
        )}
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="free-t">The answer is</label>
          <select id="free-t" className="select" value={free.answerType} onChange={(e) => set({ answerType: e.target.value as SpecAnswerType, toleranceBps: 0 })}>
            {SPEC_ANSWER_TYPES.map((t) => (
              <option key={t} value={t}>
                {ANSWER_LABEL[t]} ({t})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="free-c">About</label>
          <select id="free-c" className="select" value={free.chainId} onChange={(e) => set({ chainId: Number(e.target.value) })}>
            {SPEC_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button type="button" className="link-btn" style={{ justifySelf: 'start', fontSize: '0.88rem' }} onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
        {advanced ? 'Hide' : 'Show'} panel and window settings
      </button>
      {advanced && (
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="free-e">Evidence</label>
            <select id="free-e" className="select" value={free.evidence} onChange={(e) => set({ evidence: Number(e.target.value) })}>
              <option value={0}>chain: reproduced from chain data</option>
              <option value={1}>panel: public sources, panel consensus</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="free-w">Window (hours before the ask)</label>
            <input id="free-w" className="input mono" type="number" min={1} max={720} value={free.windowHours} onChange={(e) => set({ windowHours: Math.round(Number(e.target.value)) })} />
          </div>
          <div className="field">
            <label htmlFor="free-p">Panel size (5–100)</label>
            <input
              id="free-p"
              className="input mono"
              type="number"
              min={5}
              max={100}
              value={free.panelSize}
              onChange={(e) => {
                const p = Math.round(Number(e.target.value))
                set({ panelSize: p, quorum: Math.max(free.quorum, minQuorum(p)) })
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="free-qu">Quorum (at least 4 and a majority)</label>
            <input id="free-qu" className="input mono" type="number" min={4} max={free.panelSize} value={free.quorum} onChange={(e) => set({ quorum: Math.round(Number(e.target.value)) })} />
          </div>
          {free.answerType === 'uint256' && (
            <div className="field">
              <label htmlFor="free-tol">Tolerance (bps answers may differ)</label>
              <input id="free-tol" className="input mono" type="number" min={0} max={10000} value={free.toleranceBps} onChange={(e) => set({ toleranceBps: Math.round(Number(e.target.value)) })} />
            </div>
          )}
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={free.ack} onChange={(e) => set({ ack: e.target.checked })} />
        <span>I understand that if the swarm refuses this question or its panel cannot agree, my IMD is spent and nothing is mined.</span>
      </label>
    </div>
  )
}

function CheckPanel({
  enabled,
  ready,
  loading,
  error,
  blockers,
  suggestions,
  online,
  onRetry,
  freeForm,
}: {
  enabled: boolean
  ready: boolean
  loading: boolean
  error: string | null
  blockers: { code: string; detail?: string }[]
  suggestions: { code: string; detail?: string }[]
  online: number | null
  onRetry: () => void
  freeForm: boolean
}) {
  if (!enabled) {
    return (
      <div className="check-panel">
        <span className="check-dot muted" />
        <span className="dim">
          {freeForm ? 'The swarm check is not available on this site: double-check your wording.' : 'Vetted template: this wording passed the swarm check.'}
        </span>
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="check-panel">
        <span className="check-dot muted" />
        <span className="dim">The swarm checks your question as you type.</span>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="check-panel">
        <span className="spinner lilac" />
        <span className="dim">Asking the swarm whether it would take this question…</span>
      </div>
    )
  }
  if (error) {
    return (
      <div className="check-panel">
        <span className="check-dot coral" />
        <span className="dim">
          Couldn't run the check ({error}).{' '}
          <button className="link-btn" onClick={onRetry}>
            Try again
          </button>
        </span>
      </div>
    )
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {blockers.length === 0 ? (
        <div className="check-panel ok">
          <span className="check-dot frog" />
          <span>
            The swarm would take this question.{online !== null && <span className="dim"> {formatInt(online)} agents online.</span>}
          </span>
        </div>
      ) : (
        blockers.map((b) => {
          const h = humanizeReason(b.code)
          return (
            <div key={b.code} className="check-panel bad">
              <span className="check-dot coral" />
              <span>
                <strong>{h.title}.</strong> <span className="dim">{b.detail ?? h.detail}</span>
              </span>
            </div>
          )
        })
      )}
      {suggestions.map((s) => {
        const h = humanizeReason(s.code)
        return (
          <div key={s.code} className="check-panel hint">
            <span className="check-dot lilac" />
            <span className="dim">
              <span className="lilac">Hint:</span> {s.detail ?? h.detail}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function AskedCelebration({ id, solo, onAgain }: { id: bigint; solo: boolean; onAgain: () => void }) {
  const link = `${window.location.origin}${window.location.pathname}#/q/${id}`
  return (
    <div className="page page-narrow">
      <Reveal className="card card-glow celebrate">
        <div className="celebrate-bubble" aria-hidden="true">
          <span>?</span>
        </div>
        <span className="eyebrow">{solo ? 'asked' : 'proposed'}</span>
        <h1 style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
          {solo ? (
            <>
              Question #{id.toString()} is with the swarm.
            </>
          ) : (
            <>Question #{id.toString()} is raising.</>
          )}
        </h1>
        <p className="dim" style={{ fontSize: '1.05rem' }}>
          {solo
            ? 'A panel of five is thinking it over. When they agree and the oracle signs, it mines HMM in the current round, claimable when the round ends.'
            : 'It is asked the moment it is fully backed. Share it: anyone can chip in from 0.01 IMD within 3 days.'}
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          <ButtonLink to="/" variant="primary">
            Watch the pond
          </ButtonLink>
          <ButtonLink to={`/q/${id}`}>Follow question #{id.toString()}</ButtonLink>
          <Button variant="ghost" onClick={onAgain}>
            Ask another
          </Button>
        </div>
        {!solo && (
          <p className="faint mono" style={{ fontSize: '0.8rem', marginTop: 12, overflowWrap: 'anywhere' }}>
            {link}
          </p>
        )}
        <p className="faint" style={{ fontSize: '0.85rem', marginTop: 4 }}>
          Your thoughts live in <Link to="/me">My thoughts</Link>.
        </p>
      </Reveal>
    </div>
  )
}
