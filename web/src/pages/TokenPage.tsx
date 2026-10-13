import { useState } from 'react'
import { useApp, useIndex } from '../data/app'
import { useMineConsts, useStats } from '../data/hooks'
import { useNow } from '../data/clock'
import { Addr, Reveal } from '../components/ui'
import { formatDate, formatDuration, formatHmm } from '../lib/format'

/** Validated categorical slots for the split (dark surface): pool, swarm, mining. */
const SPLIT = [
  { key: 'pool', label: 'Uniswap v4 pool', pct: 25, color: '#4f9d5d', amount: '250,000,000' },
  { key: 'swarm', label: 'The swarm', pct: 10, color: '#8a74f0', amount: '100,000,000' },
  { key: 'mining', label: 'Mining reserve', pct: 65, color: '#c08a12', amount: '650,000,000' },
] as const

export default function TokenPage() {
  const { cfg, contracts } = useApp()
  const consts = useMineConsts().data
  const stats = useStats().data
  const index = useIndex()
  const now = useNow()
  const [hover, setHover] = useState<string | null>(null)
  const zero = '0x0000000000000000000000000000000000000000'
  const steward = consts?.steward && consts.steward !== zero ? consts.steward : null
  const pending = consts && consts.pendingEta > 0n ? consts : null

  return (
    <div className="page">
      <Reveal className="page-head">
        <span className="eyebrow">token &amp; trust</span>
        <h1>
          One billion HMM. <span className="grad-text">No presale, no team bag.</span>
        </h1>
        <p>
          HMM is a plain ERC-20: no owner, no minting after launch, no tax, no transfer rules. Everything it does lives in
          the mine, and the mine has no admin keys.
        </p>
      </Reveal>

      <Reveal className="card section" index={1} style={{ marginTop: 0 }}>
        <h2 className="card-title">Where the supply goes</h2>
        <div className="split-bar" role="img" aria-label="Supply split: 25% Uniswap v4 pool, 10% the swarm, 65% mining reserve">
          {SPLIT.map((s) => (
            <div
              key={s.key}
              className={['split-seg', hover === s.key && 'on', hover && hover !== s.key && 'dim-seg'].filter(Boolean).join(' ')}
              style={{ flexGrow: s.pct, background: s.color }}
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover(null)}
              tabIndex={0}
              onFocus={() => setHover(s.key)}
              onBlur={() => setHover(null)}
            >
              <span className="split-label">{s.pct}%</span>
            </div>
          ))}
        </div>
        <ul className="split-legend">
          {SPLIT.map((s) => (
            <li key={s.key} className={hover === s.key ? 'on' : ''} onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}>
              <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
              <div>
                <strong>
                  {s.label} · {s.pct}%
                </strong>
                <span className="num dim"> {s.amount} HMM</span>
                <p className="dim" style={{ fontSize: '0.88rem' }}>
                  {s.key === 'pool' &&
                    'Seeds a Uniswap v4 pool paired with IMD, opened by the IMD launch factory. The factory locks the liquidity.'}
                  {s.key === 'swarm' &&
                    'To the IMD seat holders, whose agents answer the questions, through the IMD launch’s Merkle distributor.'}
                  {s.key === 'mining' &&
                    'Held by the mine and emitted only into rounds with answered questions, halving every era. Never exceeded.'}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="faint" style={{ fontSize: '0.85rem', marginTop: 10 }}>
          The dev earns 5% of every mined round plus the launch's 1% LP fee. That's all of it.
        </p>
      </Reveal>

      <section className="section">
        <Reveal className="section-head">
          <div>
            <span className="eyebrow">trust model</span>
            <h2>What you trust, exactly.</h2>
          </div>
        </Reveal>
        <div className="grid grid-2">
          <Reveal className="card trust" index={0}>
            <h3>The token</h3>
            <p className="dim">
              A fixed supply minted once to the IMD launch factory. No owner, no mint, no fee, no pause, no blocklist.
            </p>
          </Reveal>
          <Reveal className="card trust" index={1}>
            <h3>The mine</h3>
            <p className="dim">
              Holds the mining reserve and the IMD of questions still raising. No function lets anyone take either: IMD
              only leaves to the Intake (when a question is asked) or back to its backer (refund); HMM only to backers
              and the dev share, on the schedule. It writes each question's JSON itself, so a pooled question can't
              carry hidden settings.
            </p>
          </Reveal>
          <Reveal className="card trust" index={2}>
            {consts && steward ? (
              <>
                <h3>A steward is set</h3>
                <p className="dim">
                  This deployment has a steward. It can only queue a new oracle adapter or action id, behind a 3-day
                  timelock, for questions proposed afterwards; questions raising under the old setup can only be refunded.
                  It cannot touch the reserve, the schedule or anyone's IMD or HMM.
                </p>
              </>
            ) : (
              <>
                <h3>No admin keys</h3>
                <p className="dim">
                  The mine launches with no steward (address zero): nobody can change the oracle adapter, the schedule,
                  the split or anything else. The rules you read here are the rules for good.
                </p>
              </>
            )}
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Steward</dt>
              <dd>{consts ? steward ? <Addr address={steward} /> : <span className="frog">none (address zero)</span> : contracts ? '…' : 'none at launch'}</dd>
              {pending && (
                <>
                  <dt>Pending change</dt>
                  <dd>
                    <span className="coral">
                      new adapter <Addr address={pending.pendingAdapter} />, applies{' '}
                      {Number(pending.pendingEta) > now ? `in ${formatDuration(Number(pending.pendingEta) - now)}` : 'now'} (
                      {formatDate(Number(pending.pendingEta))})
                    </span>
                  </dd>
                </>
              )}
            </dl>
          </Reveal>
          <Reveal className="card trust" index={3}>
            <h3>The swarm</h3>
            <p className="dim">
              You trust the IMD Intake and the swarm's oracle signer: the adapter counts an answer only if the oracle
              signed it and the panel met the rules (5+ agents, quorum 4+, majority). A refusal or a split mines
              nothing, and the IMD stays with the swarm.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="section">
        <Reveal className="section-head">
          <div>
            <span className="eyebrow">contracts</span>
            <h2>Read them yourself.</h2>
          </div>
          <p>{cfg.chainName} · chain {cfg.chainId}</p>
        </Reveal>
        <Reveal className="card">
          <dl className="kv contracts-kv">
            <dt>HMM token</dt>
            <dd>{contracts ? <Addr address={contracts.hmm} full /> : <span className="faint">published at launch</span>}</dd>
            <dt>HmmMine</dt>
            <dd>{contracts ? <Addr address={contracts.mine} full /> : <span className="faint">published at launch</span>}</dd>
            <dt>Oracle adapter</dt>
            <dd>
              {consts ? <Addr address={consts.adapter} full /> : contracts?.adapter ? <Addr address={contracts.adapter} full /> : <span className="faint">published at launch</span>}
            </dd>
            {(consts?.forwarder ?? cfg.forwarder) && (
              <>
                <dt>Genesis forwarder</dt>
                <dd>
                  <Addr address={(consts?.forwarder ?? cfg.forwarder)!} full />
                </dd>
              </>
            )}
            <dt>IMD</dt>
            <dd>
              <Addr address={cfg.imd} full />
            </dd>
            <dt>IMD Intake (v2)</dt>
            <dd>
              <Addr address={cfg.intake} full />
            </dd>
          </dl>
          {stats && (
            <p className="faint" style={{ fontSize: '0.84rem', marginTop: 14 }}>
              Reserve {formatHmm(stats.reserve)} HMM · {formatHmm(stats.assigned)} mined into answered rounds ·{' '}
              {formatHmm(stats.claimed)} claimed{index ? ` · ${index.totals.asked} questions asked` : ''}.
            </p>
          )}
        </Reveal>
      </section>

      <section className="section">
        <Reveal className="section-head">
          <div>
            <span className="eyebrow">risks</span>
            <h2>Read this before you ask.</h2>
          </div>
        </Reveal>
        <div className="grid grid-2">
          {[
            ['Misses cost IMD', 'If the swarm refuses your question, its panel splits, or the answer does not count, the IMD you paid is spent and nothing is mined.'],
            ['Public forever', 'Question bodies are stored on chain in full. Never put anything private in a question.'],
            ['Oracle trust', 'Answers are only as good as the IMD swarm and its oracle signer. A compromised signer could approve answers; a down swarm answers nothing.'],
            ['Price changes', 'The Intake sets the price. If it rises while a pooled question is raising, that question cannot be asked; backers refund after 3 days.'],
            ['No value promise', 'HMM has no claim on anything. Its price, if any, is set by people trading it. Nothing here is financial advice.'],
            ['Smart contract risk', 'The contracts are small and public, but bugs are possible. Only use what you can afford to lose.'],
          ].map(([t, d], i) => (
            <Reveal key={t} className="card risk" index={i % 2}>
              <h3>{t}</h3>
              <p className="dim">{d}</p>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  )
}
