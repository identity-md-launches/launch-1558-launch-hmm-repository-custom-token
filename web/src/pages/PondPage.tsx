import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { PondCanvas } from '../pond/PondCanvas'
import type { PondHandle, PondLayout, PondPick, PondSeat } from '../pond/types'
import { useApp, useIndex } from '../data/app'
import { useLiveRound, useMineConsts, useOracleCounts, useOracleFeed, useStats, useSwarm } from '../data/hooks'
import { useNow } from '../data/clock'
import { pondMoon, pondQuestions } from '../data/pondFeed'
import type { FeedItem, IndexState } from '../data/indexer'
import { coinTarget } from '../components/Wallet'
import { AnimatedNumber, ButtonLink, Reveal, useReducedMotion } from '../components/ui'
import { AnswerChip, PanelDots, QuestionText } from '../components/question'
import { FrogMascot } from '../components/FrogMascot'
import { toast } from '../components/toast'
import { sound } from '../sound/engine'
import { answerLabel } from '../lib/answer'
import { humanizeReason } from '../lib/reasons'
import {
  compactNumber,
  formatAgo,
  formatClock,
  formatDuration,
  formatHmm,
  formatImd,
  formatInt,
  formatPercent,
  shortAddress,
  toNumber,
} from '../lib/format'

// Below the fold: loaded after the hero.
const ScrollStory = lazy(() => import('../components/ScrollStory').then((m) => ({ default: m.ScrollStory })))

export function PondPage() {
  const { contracts, launch, indexer } = useApp()
  const index = useIndex()
  const stats = useStats().data
  const consts = useMineConsts().data
  const swarm = useSwarm()
  const oracle = useOracleFeed(24).data
  const oracleCounts = useOracleCounts().data
  const { address } = useAccount()
  const reduced = useReducedMotion()
  const now = useNow()
  const navigate = useNavigate()
  const pond = useRef<PondHandle | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [layout, setLayout] = useState<PondLayout | null>(null)
  const copy = useRef<HTMLDivElement>(null)
  // First visit in this session: the camera glides down from the stars, then the copy fades in. Never under reduced
  // motion or in automated captures; any input skips it.
  const [playIntro] = useState(() => {
    if (typeof window === 'undefined') return false
    const automated = (navigator as Navigator & { webdriver?: boolean }).webdriver === true
    let seen = false
    try {
      seen = sessionStorage.getItem('hmm.intro') === '1'
    } catch {
      seen = false
    }
    return !seen && !automated && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  const [introDone, setIntroDone] = useState(!playIntro)
  const onIntroDone = useCallback(() => {
    setIntroDone(true)
    try {
      sessionStorage.setItem('hmm.intro', '1')
    } catch {
      /* private mode */
    }
  }, [])
  useEffect(() => {
    if (introDone) return
    const skip = () => pond.current?.skipIntro()
    const opts = { passive: true, capture: true } as AddEventListenerOptions
    const events = ['pointerdown', 'wheel', 'keydown', 'touchstart', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, skip, opts))
    return () => events.forEach((e) => window.removeEventListener(e, skip, opts))
  }, [introDone])

  // The hero copy is a quiet zone on wide screens: frogs fade under it and no thought bubbles cover it.
  useEffect(() => {
    if (!ready) return
    const box = host.current
    const text = copy.current
    if (!box || !text) return
    const measure = () => {
      const b = box.getBoundingClientRect()
      const r = text.getBoundingClientRect()
      if (b.width < 900) return pond.current?.setQuietZone(null)
      const pad = 28
      pond.current?.setQuietZone({ x: r.left - b.left - pad, y: r.top - b.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    ro.observe(text)
    return () => ro.disconnect()
  }, [ready])
  const [pick, setPick] = useState<PondPick | null>(null)
  const [hover, setHover] = useState<PondPick | null>(null)

  const handleRef = useCallback((h: PondHandle | null) => {
    pond.current = h
    setReady(Boolean(h))
  }, [])

  // swarm → frogs
  useEffect(() => {
    if (!ready) return
    pond.current?.setSwarm({ online: swarm.data?.online ?? null, seats: swarm.data?.seats ?? [] })
  }, [ready, swarm.data])

  // stats → moon (ticks every second for the round ring)
  const liveRound = useLiveRound(now)
  const moon = pondMoon(liveRound, consts?.roundLength, now)
  useEffect(() => {
    if (ready) pond.current?.setMoon(moon)
  }, [ready, moon.live, moon.era, moon.roundsInPot, Math.floor(moon.roundProgress * 600)]) // eslint-disable-line react-hooks/exhaustive-deps

  // chain questions → bubbles, buds, fireflies (diffed by the engine)
  const minute = Math.floor(now / 60)
  const questions = useMemo(() => pondQuestions(index, address, now), [index?.version, address, minute]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ready) pond.current?.setQuestions(questions)
  }, [ready, questions])

  // coins fly to the wallet button
  useEffect(() => {
    if (!ready) return
    pond.current?.setCoinTarget(() => {
      const el = coinTarget.el
      const box = host.current
      if (!el || !box) return null
      const r = el.getBoundingClientRect()
      const c = box.getBoundingClientRect()
      return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top }
    })
  }, [ready])

  // ambient life: replay recent swarm activity as croaks; new oracle questions network-wide make frogs think
  useEffect(() => {
    if (!ready || reduced) return
    const events = (swarm.data?.events ?? []).filter((e) => typeof e.tokenId === 'number')
    if (!events.length) return
    let i = 0
    const t = setInterval(() => {
      const e = events[i++ % events.length]!
      pond.current?.croak(e.tokenId!)
    }, 2600)
    return () => clearInterval(t)
  }, [ready, reduced, swarm.data])
  const seenOracle = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!ready || !oracle) return
    if (!seenOracle.current) {
      seenOracle.current = new Set(oracle.map((r) => r.id))
      return
    }
    for (const r of oracle) {
      if (seenOracle.current.has(r.id)) continue
      seenOracle.current.add(r.id)
      pond.current?.croak()
    }
  }, [ready, oracle])

  // live chain events → a splash where it happened
  useEffect(() => {
    if (!indexer) return
    return indexer.onLive((items) => {
      if (items.some((i) => i.kind === 'round')) pond.current?.ripple(window.innerWidth * 0.5, window.innerHeight * 0.72, 0.6)
    })
  }, [indexer])

  const onCoinLanded = useCallback(
    (id: string) => {
      const el = coinTarget.el
      if (el) {
        el.classList.remove('coin-hit')
        void el.offsetWidth
        el.classList.add('coin-hit')
      }
      const q = index?.questions.get(id)
      if (q && address && [...q.backed.keys()].some((k) => k.toLowerCase() === address.toLowerCase())) {
        toast.show({ kind: 'mined', title: `#${id} mined`, body: 'Your share is claimable when the round ends.', ttl: 7000 })
      }
    },
    [index, address],
  )

  const onPick = useCallback((p: PondPick) => {
    setPick(p)
  }, [])

  // Escape closes the card
  useEffect(() => {
    if (!pick) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPick(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pick])

  const live = moon.live
  const genesis = stats?.genesis ?? 0n

  return (
    <div className="pond-page">
      <section className="pond-hero" ref={host} aria-label="The Thinking Pond">
        <PondCanvas
          className="pond-canvas"
          reducedMotion={reduced}
          handleRef={handleRef}
          onPick={onPick}
          onHover={setHover}
          onCoinLanded={onCoinLanded}
          onLayout={setLayout}
          intro={playIntro}
          onIntroDone={onIntroDone}
          onSound={(kind, strength, pan) => sound.play(kind, strength, pan)}
        />
        <p className="sr-only">
          An animated pond at night. {swarm.data?.online ? `${formatInt(swarm.data.online)} IMD agents are online, drawn as frogs on lily pads.` : ''}{' '}
          {index ? `${index.totals.asked - index.totals.answered - index.totals.failed} questions are being thought about, ${index.totals.answered} have been answered.` : ''}
        </p>

        <div className={['pond-overlay', introDone ? 'intro-in' : 'intro-wait'].join(' ')}>
          <div className="pond-copy" ref={copy}>
            <span className="eyebrow">proof of thought</span>
            <h1>
              The coin you mine <span className="grad-text">by asking.</span>
            </h1>
            <p>
              Ask the IMD swarm a question. If its panel of agents agrees on a signed answer, the people who paid for
              the question mine HMM. Every HMM stands for a question the swarm agreed on.
            </p>
            <div className="row">
              <ButtonLink to="/ask" variant="primary" size="lg">
                Ask the swarm
              </ButtonLink>
              <ButtonLink to="/how" size="lg" variant="ghost">
                How it works
              </ButtonLink>
            </div>
            <p className="pond-hint faint">Tap the water. Poke a frog. Catch a firefly.</p>
          </div>

          {layout && (
            <div
              className="moon-labels"
              style={{
                left: Math.min(layout.moon.x + layout.moon.r * 1.6, layout.width - 210),
                top: layout.moon.y - layout.moon.r * 0.6,
              }}
            >
              {live && liveRound ? (
                <>
                  <span className="moon-label">
                    <span className="faint">round {formatInt(liveRound.round)}</span>
                    <strong className="num">{formatClock(Number(liveRound.roundEndsAt) - now)}</strong>
                  </span>
                  <span className="moon-label">
                    <span className="faint">era {formatInt(liveRound.era)} · halving in</span>
                    <strong className="num">{formatDuration(Number(liveRound.nextHalvingAt) - now)}</strong>
                  </span>
                </>
              ) : (
                <span className="moon-label">
                  <span className="faint">the moon has not risen</span>
                  <strong>
                    {contracts && genesis > 0n ? `mining opens in ${formatDuration(Number(genesis) - now)}` : launch === 'discovering' ? 'looking for the mine…' : 'mining opens soon'}
                  </strong>
                </span>
              )}
            </div>
          )}

          {hover && !pick && <HoverTip hover={hover} index={index} />}
          {pick && <PickCard pick={pick} index={index} onClose={() => setPick(null)} onAsk={() => navigate('/ask')} layout={layout} />}

          <StatsStrip />
        </div>
      </section>

      <Ticker />

      <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
        <ScrollStory />
      </Suspense>

      <div className="page pond-below">
        <Reveal className="section-head">
          <div>
            <span className="eyebrow">right now</span>
            <h2>What the pond is thinking about.</h2>
          </div>
          <ButtonLink to="/ledger">The full ledger</ButtonLink>
        </Reveal>
        <RightNow index={index} />

        <section className="section">
          <Reveal className="section-head">
            <div>
              <span className="eyebrow">the swarm</span>
              <h2>{swarm.data?.online ? <><AnimatedNumber value={swarm.data.online} format={(n) => formatInt(Math.round(n))} /> agents online.</> : 'The IMD swarm.'}</h2>
            </div>
            <p>
              Every frog is a seat in the IMD swarm: someone's AI worker that takes jobs and answers oracle questions,
              for hmm and for everyone else.
            </p>
          </Reveal>
          <div className="grid grid-4">
            <Reveal className="card stat" index={0}>
              <span className="stat-label">agents online</span>
              <span className="stat-value">{swarm.data?.online != null ? <AnimatedNumber value={swarm.data.online} format={(n) => formatInt(Math.round(n))} /> : '–'}</span>
              <span className="stat-sub">{swarm.data?.working != null ? `${formatInt(swarm.data.working)} working right now` : swarm.isError ? 'swarm API unreachable' : ' '}</span>
            </Reveal>
            <Reveal className="card stat" index={1}>
              <span className="stat-label">oracle answers, last day</span>
              <span className="stat-value">{swarm.data?.oraclesLastDay != null ? <AnimatedNumber value={swarm.data.oraclesLastDay} format={(n) => formatInt(Math.round(n))} /> : '–'}</span>
              <span className="stat-sub">network-wide</span>
            </Reveal>
            <Reveal className="card stat" index={2}>
              <span className="stat-label">oracle questions ever</span>
              <span className="stat-value">{oracleCounts ? <AnimatedNumber value={oracleCounts.total} format={(n) => formatInt(Math.round(n))} /> : '–'}</span>
              <span className="stat-sub">
                {oracleCounts?.byStatus?.attested != null && oracleCounts.total > 0
                  ? `${formatPercent(oracleCounts.byStatus.attested / oracleCounts.total, 0)} attested`
                  : ' '}
              </span>
            </Reveal>
            <Reveal className="card stat" index={3}>
              <span className="stat-label">seats enrolled</span>
              <span className="stat-value">{swarm.data?.seatsEnrolled != null ? <AnimatedNumber value={swarm.data.seatsEnrolled} format={(n) => formatInt(Math.round(n))} /> : '–'}</span>
              <span className="stat-sub">of 2,000 seat NFTs</span>
            </Reveal>
          </div>
          {oracle && oracle.length > 0 && (
            <Reveal className="card section elsewhere" index={1} style={{ marginTop: 18 }}>
              <div className="spread" style={{ marginBottom: 10 }}>
                <h3 className="card-title">Elsewhere in the swarm</h3>
                <span className="faint" style={{ fontSize: '0.8rem' }}>
                  live from api.imd.fun
                </span>
              </div>
              <ul className="elsewhere-list">
                {oracle.slice(0, 8).map((r) => (
                  <li key={r.id}>
                    <span className={`pill ${r.status === 'attested' ? 'pill-answered' : r.status === 'disagreed' || r.status === 'refused' || r.status === 'blocked' ? 'pill-failed' : 'pill-asked'}`}>
                      <span className="dot" />
                      {r.status}
                    </span>
                    <span className="elsewhere-q">{r.question.length > 140 ? `${r.question.slice(0, 140)}…` : r.question}</span>
                    <span className="faint nowrap">{r.createdAt ? formatAgo((Date.now() - Date.parse(r.createdAt)) / 1000) : ''}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          )}
        </section>

        <section className="section">
          <Reveal className="section-head">
            <div>
              <span className="eyebrow">how it works</span>
              <h2>Ask, think, agree, mine.</h2>
            </div>
            <ButtonLink to="/how">See it animated</ButtonLink>
          </Reveal>
          <div className="grid grid-4 how-teaser">
            {[
              ['Ask', 'Pay the swarm’s price in IMD for a question, alone or pooled from 0.01 IMD.'],
              ['Think', 'A panel of five or more IMD agents reads chain data and answers independently.'],
              ['Agree', 'Four or more, and a majority, must agree. The oracle signs; the mine verifies.'],
              ['Mine', 'The round’s HMM goes to the backers of its answered questions, by IMD paid.'],
            ].map(([t, d], i) => (
              <Reveal key={t} className="card how-mini" index={i}>
                <span className="how-mini-n">{i + 1}</span>
                <h3>{t}</h3>
                <p className="dim">{d}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <Reveal className="card section cta-card">
          <FrogMascot size={120} />
          <div>
            <h2>Got a question about the chain?</h2>
            <p className="dim">Ask it. If the swarm agrees, you mine.</p>
          </div>
          <ButtonLink to="/ask" variant="primary" size="lg">
            Ask the swarm
          </ButtonLink>
        </Reveal>
      </div>
    </div>
  )
}

/* ───────────── stats strip ───────────── */

function StatsStrip() {
  const { contracts } = useApp()
  const index = useIndex()
  const stats = useStats().data
  const swarm = useSwarm().data
  const now = useNow()
  const lr = useLiveRound(now)

  if (!contracts || !lr || !lr.live || !stats) {
    return (
      <div className="stats-strip prelaunch" role="region" aria-label="Pond stats">
        <div className="strip-stat wide">
          <span className="stat-label">mining</span>
          <span className="strip-v">{contracts && stats && stats.genesis > 0n ? `opens in ${formatDuration(Number(stats.genesis) - now)}` : 'opens soon'}</span>
        </div>
        <div className="strip-stat">
          <span className="stat-label">agents online</span>
          <span className="strip-v num">{swarm?.online != null ? formatInt(swarm.online) : '–'}</span>
        </div>
        <div className="strip-stat">
          <span className="stat-label">supply</span>
          <span className="strip-v num">1B HMM</span>
        </div>
        <div className="strip-stat">
          <span className="stat-label">mining reserve</span>
          <span className="strip-v num">65%</span>
        </div>
        <div className="strip-stat">
          <span className="stat-label">halving</span>
          <span className="strip-v">every 180 days</span>
        </div>
      </div>
    )
  }
  const t = index?.totals
  return (
    <div className="stats-strip" role="region" aria-label="Pond stats">
      <div className="strip-stat strip-pot">
        <span className="stat-label">pot</span>
        <span className="strip-v gold">
          <AnimatedNumber value={toNumber(lr.pot)} format={(n) => compactNumber(n)} exact={compactNumber(toNumber(lr.pot))} />
          <small> HMM</small>
        </span>
      </div>
      <div className="strip-stat">
        <span className="stat-label">round {formatInt(lr.round)} ends</span>
        <span className="strip-v num">{formatClock(Number(lr.roundEndsAt) - now)}</span>
      </div>
      <div className="strip-stat">
        <span className="stat-label">era {formatInt(lr.era)}</span>
        <span className="strip-v num">{compactNumber(toNumber(lr.perRound))}/round</span>
      </div>
      <div className="strip-stat">
        <span className="stat-label">asked</span>
        <span className="strip-v num">{t ? <AnimatedNumber value={t.asked} format={(n) => formatInt(Math.round(n))} /> : '–'}</span>
      </div>
      <div className="strip-stat">
        <span className="stat-label">answered</span>
        <span className="strip-v num">{t ? <AnimatedNumber value={t.answered} format={(n) => formatInt(Math.round(n))} /> : '–'}</span>
      </div>
      <div className="strip-stat">
        <span className="stat-label">miners</span>
        <span className="strip-v num">{t ? <AnimatedNumber value={t.uniqueMiners} format={(n) => formatInt(Math.round(n))} /> : '–'}</span>
      </div>
      <div className="strip-stat">
        <span className="stat-label">IMD to the swarm</span>
        <span className="strip-v num">{t ? <AnimatedNumber value={toNumber(t.imdPaidToSwarm)} format={(n) => compactNumber(n)} /> : '–'}</span>
      </div>
      <div className="strip-stat">
        <span className="stat-label">HMM mined</span>
        <span className="strip-v num">
          <AnimatedNumber value={toNumber(stats.assigned)} format={(n) => compactNumber(n)} />
        </span>
      </div>
    </div>
  )
}

/* ───────────── live ledger ticker ───────────── */

function feedText(f: FeedItem, index: IndexState): { text: string; tone: string } {
  const q = f.id !== undefined ? index.questions.get(f.id.toString()) : undefined
  const who = f.who ? shortAddress(f.who) : ''
  switch (f.kind) {
    case 'proposed':
      return { text: `#${f.id} proposed · ${formatImd(f.amount ?? 0n)} IMD`, tone: 'lilac' }
    case 'backed':
      return { text: `${who} backed #${f.id} · ${formatImd(f.amount ?? 0n)} IMD`, tone: '' }
    case 'asked':
      return { text: `#${f.id} asked · the panel is thinking`, tone: 'lilac' }
    case 'answered':
      return { text: `#${f.id} answered: ${q?.answer ? answerLabel(q.answer.decoded) : '…'} · round ${f.round}`, tone: 'gold' }
    case 'failed':
      return { text: `#${f.id} mist · ${q?.failure ? humanizeReason(q.failure.reason).title.toLowerCase() : 'no answer'}`, tone: 'coral' }
    case 'round':
      return { text: `block ${f.round} · ${formatHmm(f.amount ?? 0n)} HMM to its backers`, tone: 'gold' }
    case 'claimed':
      return { text: `${who} claimed ${formatHmm(f.amount ?? 0n)} HMM`, tone: 'frog' }
    case 'refunded':
      return { text: `${who} refunded ${formatImd(f.amount ?? 0n)} IMD from #${f.id}`, tone: '' }
    case 'devpaid':
      return { text: `dev share paid · ${formatHmm(f.amount ?? 0n)} HMM`, tone: '' }
    case 'started':
      return { text: `mining started · ${compactNumber(toNumber(f.amount ?? 0n))} HMM reserve`, tone: 'gold' }
    default:
      return { text: 'config changed', tone: 'coral' }
  }
}

function Ticker() {
  const { contracts } = useApp()
  const index = useIndex()
  const items = index ? index.feed.slice(0, 24) : []
  if (!contracts) {
    return (
      <div className="ticker" aria-label="Live ledger">
        <div className="ticker-static">
          <span className="ticker-live">ledger</span> The ledger starts when mining opens. Until then the frogs are
          warming up.
        </div>
      </div>
    )
  }
  if (!index || items.length === 0) {
    return (
      <div className="ticker" aria-label="Live ledger">
        <div className="ticker-static">
          <span className="ticker-live">live</span>
          {index && index.status === 'live' ? 'The pond is quiet. Be the first to ask the swarm something.' : 'Reading the ledger…'}
        </div>
      </div>
    )
  }
  const row = items.map((f) => {
    const { text, tone } = feedText(f, index)
    return (
      <Link key={f.key} to={f.id !== undefined ? `/q/${f.id}` : '/ledger'} className={['ticker-item', tone].filter(Boolean).join(' ')}>
        <i aria-hidden="true" />
        {text}
      </Link>
    )
  })
  return (
    <div className="ticker" aria-label="Live ledger">
      <span className="ticker-live">live</span>
      <div className="ticker-track">
        <div className="ticker-run" style={{ animationDuration: `${Math.max(30, items.length * 5)}s` }}>
          {row}
          <span aria-hidden="true" className="ticker-dup">
            {row}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ───────────── right now: thinking + latest answers ───────────── */

function RightNow({ index }: { index: IndexState | null }) {
  const { contracts } = useApp()
  if (!contracts) {
    return (
      <div className="card empty">
        <FrogMascot size={90} />
        <h3>Mining opens soon.</h3>
        <p>When the mine goes live, every question asked through it shows up here as it is thought about and answered.</p>
        <ButtonLink to="/how">How it works</ButtonLink>
      </div>
    )
  }
  if (!index || (index.status !== 'live' && index.questions.size === 0)) {
    return (
      <div className="card empty" aria-busy="true">
        <span className="spinner" />
        <p>Reading the pond's history from chain…</p>
      </div>
    )
  }
  const all = [...index.questions.values()].sort((a, b) => b.order - a.order)
  const thinking = all.filter((q) => q.status === 'asked').slice(0, 4)
  const answered = all
    .filter((q) => q.status === 'answered')
    .sort((a, b) => Number((b.settled?.block ?? 0n) - (a.settled?.block ?? 0n)))
    .slice(0, 6)
  if (!thinking.length && !answered.length) {
    return (
      <div className="card empty">
        <FrogMascot size={90} />
        <h3>The pond is quiet.</h3>
        <p>No question has been answered yet. The first one takes everything emitted so far.</p>
        <ButtonLink to="/ask" variant="primary">
          Ask the first question
        </ButtonLink>
      </div>
    )
  }
  return (
    <div className="grid grid-2 right-now">
      <div className="stack">
        <h3 className="card-title lilac">Thinking</h3>
        {thinking.length === 0 ? (
          <div className="card dim" style={{ fontSize: '0.9rem' }}>
            Nothing with the swarm right now.
          </div>
        ) : (
          thinking.map((q, i) => (
            <Reveal key={q.id.toString()} className="card q-card thinking hoverable" index={i}>
              <div className="spread">
                <span className="q-id">#{q.id.toString()}</span>
                <span className="pill pill-asked">
                  <span className="dot" />
                  thinking
                </span>
              </div>
              <QuestionText q={q} />
            </Reveal>
          ))
        )}
      </div>
      <div className="stack">
        <h3 className="card-title gold">Latest answers</h3>
        {answered.length === 0 ? (
          <div className="card dim" style={{ fontSize: '0.9rem' }}>
            No answers yet.
          </div>
        ) : (
          answered.map((q, i) => (
            <Reveal key={q.id.toString()} className="card q-card hoverable" index={i}>
              <div className="spread">
                <span className="q-id">#{q.id.toString()} · round {q.round?.toString()}</span>
                <div className="row" style={{ gap: 8 }}>
                  <AnswerChip q={q} />
                  {q.answer && <PanelDots size={q.answer.panelSize} agreed={q.answer.agreed} />}
                </div>
              </div>
              <QuestionText q={q} />
            </Reveal>
          ))
        )}
      </div>
    </div>
  )
}

/* ───────────── hover tip & pick cards ───────────── */

function seatLine(s: PondSeat | null) {
  if (!s) return 'an IMD agent'
  return `seat #${s.tokenId}${s.working ? ' · working' : ''}`
}

function HoverTip({ hover, index }: { hover: PondPick; index: IndexState | null }) {
  let text = ''
  if (hover.kind === 'frog') text = seatLine(hover.seat)
  else if (hover.kind === 'firefly' || hover.kind === 'bud' || hover.kind === 'bubble') {
    const q = index?.questions.get(hover.id)
    text = q ? `#${q.id} · ${hover.kind === 'firefly' && q.answer ? answerLabel(q.answer.decoded) : hover.kind === 'bud' ? 'raising' : 'thinking'}` : `#${hover.id}`
  } else if (hover.kind === 'moon') text = 'the moon: emission'
  else return null
  return (
    <div className="pond-tip" style={{ left: hover.x + 14, top: hover.y - 34 }} aria-hidden="true">
      {text}
    </div>
  )
}

function PickCard({
  pick,
  index,
  onClose,
  onAsk,
  layout,
}: {
  pick: PondPick
  index: IndexState | null
  onClose: () => void
  onAsk: () => void
  layout: PondLayout | null
}) {
  const now = useNow()
  const lr = useLiveRound(now)
  const w = layout?.width ?? window.innerWidth
  const h = layout?.height ?? window.innerHeight
  const left = Math.max(12, Math.min(pick.x + 16, w - 332))
  const top = Math.max(80, Math.min(pick.y - 40, h - 330))
  const q = 'id' in pick ? index?.questions.get(pick.id) : undefined

  let body: React.ReactNode = null
  if (pick.kind === 'water') {
    body = (
      <>
        <span className="eyebrow">plip</span>
        <h3>Ask the swarm something?</h3>
        <p className="dim">A question dropped in the pond gets a panel of agents. If they agree, you mine.</p>
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={onAsk}>
            Ask a question
          </button>
          <Link to="/open" className="btn btn-sm btn-ghost">
            Back one
          </Link>
        </div>
      </>
    )
  } else if (pick.kind === 'frog') {
    const s = pick.seat
    body = (
      <>
        <span className="eyebrow">{s ? `seat #${s.tokenId}` : 'an agent'}</span>
        <h3>{s?.working ? 'Working right now.' : 'Ribbit. Thinking about it.'}</h3>
        {s ? (
          <dl className="kv">
            {s.agentId && (
              <>
                <dt>agent</dt>
                <dd className="mono">{s.agentId}</dd>
              </>
            )}
            {s.accepted !== undefined && s.attempts !== undefined && (
              <>
                <dt>accepted</dt>
                <dd>
                  {formatInt(s.accepted)} of {formatInt(s.attempts)} jobs
                </dd>
              </>
            )}
            {s.last && (
              <>
                <dt>last active</dt>
                <dd>{formatAgo((Date.now() - Date.parse(s.last)) / 1000)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="dim">The swarm's seat list is unavailable right now.</p>
        )}
        <p className="faint" style={{ fontSize: '0.8rem' }}>
          Each frog is an IMD seat: an AI worker that answers oracle questions, hmm's included.
        </p>
      </>
    )
  } else if (pick.kind === 'moon') {
    body = (
      <>
        <span className="eyebrow">the moon</span>
        <h3>{lr?.live ? `Era ${lr.era} · ${formatPercent(1 / 2 ** Number(lr.era), 0)} lit` : 'Not risen yet'}</h3>
        {lr?.live ? (
          <dl className="kv">
            <dt>pot</dt>
            <dd className="gold num">{formatHmm(lr.pot)} HMM</dd>
            <dt>round ends</dt>
            <dd className="num">{formatClock(Number(lr.roundEndsAt) - now)}</dd>
            <dt>next halving</dt>
            <dd>{formatDuration(Number(lr.nextHalvingAt) - now)}</dd>
          </dl>
        ) : (
          <p className="dim">The moon rises when mining opens. Its phase shows the halving era; its ring ticks each round.</p>
        )}
        <Link to="/moon" className="btn btn-sm">
          The emission schedule
        </Link>
      </>
    )
  } else if (q) {
    body = (
      <>
        <span className="eyebrow">
          #{q.id.toString()} · {q.status === 'answered' ? 'answered' : q.status === 'asked' ? 'thinking' : q.status === 'open' ? 'raising' : 'mist'}
        </span>
        <p className="pick-q">{q.text.length > 220 ? `${q.text.slice(0, 220)}…` : q.text}</p>
        {q.status === 'answered' && q.answer && (
          <div className="row">
            <span className="dim">the swarm said</span>
            <AnswerChip q={q} />
            <PanelDots size={q.answer.panelSize} agreed={q.answer.agreed} />
          </div>
        )}
        {q.status === 'open' && (
          <p className="dim">
            {formatImd(q.raised)} of {formatImd(q.target)} IMD raised · {formatDuration(Number(q.deadline) - now)} left
          </p>
        )}
        {q.status === 'asked' && <p className="lilac">A panel is deliberating.</p>}
        {q.status === 'failed' && q.failure && <p className="coral">{humanizeReason(q.failure.reason).title}</p>}
        <Link to={`/q/${q.id}`} className="btn btn-sm">
          {q.status === 'open' ? 'Back it' : 'Open the question'}
        </Link>
      </>
    )
  } else {
    body = <p className="dim">This question is still being read from chain.</p>
  }

  return (
    <div className="pick-card" style={{ left, top }} role="dialog" aria-label="Pond detail">
      <button className="pick-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {body}
    </div>
  )
}
