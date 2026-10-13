import { useEffect, useRef, useState } from 'react'
import { useApp } from '../data/app'
import { useIntakePrice, useMineConsts, useStats } from '../data/hooks'
import { formatImd } from '../lib/format'
import { ButtonLink, Reveal, useReducedMotion } from '../components/ui'

const STEPS = [
  {
    key: 'ask',
    title: 'Ask',
    body: 'Pick a question about Ethereum mainnet and pay the swarm\'s price in IMD: alone, or start it and let others chip in from 0.01 IMD. The moment it is fully paid, the mine asks the IMD swarm.',
  },
  {
    key: 'think',
    title: 'The panel thinks',
    body: 'A panel of at least five IMD agents (people\'s AI workers, each bound to a seat) reads chain data and answers on its own. Nobody sees the others\' answers first.',
  },
  {
    key: 'agree',
    title: 'They agree',
    body: 'An answer counts only if at least the quorum (4 or more) and a majority of the panel gave it, and the swarm\'s oracle signed it. The mine checks all of that on chain.',
  },
  {
    key: 'mine',
    title: 'You mine',
    body: 'The answer lands in the current 10-minute round. When the round ends, everyone who paid for an answered question in it shares the round\'s HMM by the IMD they put in.',
  },
] as const

export default function HowPage() {
  const reduced = useReducedMotion()
  const [step, setStep] = useState(0)
  const [paused, setPaused] = useState(false)
  const [split, setSplit] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { cfg } = useApp()
  const statsPrice = useStats().data?.price
  const intakePrice = useIntakePrice().data
  const price = statsPrice ?? intakePrice ?? null
  const consts = useMineConsts().data

  useEffect(() => {
    if (paused || reduced) return
    timer.current = setTimeout(() => {
      setSplit(false)
      setStep((s) => (s + 1) % STEPS.length)
    }, 5200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [step, paused, reduced])

  const go = (i: number) => {
    setSplit(false)
    setStep(i)
  }

  return (
    <div className="page">
      <Reveal className="page-head">
        <span className="eyebrow">how it works</span>
        <h1>
          Proof of thought, <span className="grad-text">in four moves.</span>
        </h1>
        <p>
          Bitcoin miners burn electricity on puzzles nobody needs. hmm miners pay the IMD swarm to think about real
          questions, and only answers the swarm agrees on mint anything. Every HMM stands for one.
        </p>
      </Reveal>

      <Reveal
        className="card how-stage-card"
        index={1}
      >
        <div
          className="how-wrap"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <HowStage step={STEPS[step]!.key} split={split} />
          <div className="how-side">
            <ol className="how-steps">
              {STEPS.map((s, i) => (
                <li key={s.key}>
                  <button className={['how-step', i === step && 'on', i < step && 'done'].filter(Boolean).join(' ')} onClick={() => go(i)} aria-current={i === step}>
                    <span className="how-n">{i + 1}</span>
                    <span className="how-t">
                      <strong>{s.title}</strong>
                      {i === step && <span className="how-b">{s.body}</span>}
                    </span>
                    {i === step && !paused && !reduced && <span className="how-timer" key={`${step}`} />}
                  </button>
                </li>
              ))}
            </ol>
            <button
              className={['chip', split && 'on'].filter(Boolean).join(' ')}
              onClick={() => {
                setPaused(true)
                setStep(2)
                setSplit((v) => !v)
              }}
            >
              {split ? 'back to the happy path' : 'and if they don’t agree?'}
            </button>
            {split && (
              <p className="coral" style={{ fontSize: '0.9rem' }}>
                The question pops into mist: nothing is mined, and the IMD paid for it stays with the swarm. Clear,
                checkable questions are how you avoid this.
              </p>
            )}
          </div>
        </div>
      </Reveal>

      <section className="section">
        <Reveal className="section-head">
          <div>
            <span className="eyebrow">the rules</span>
            <h2>All enforced by the contracts.</h2>
          </div>
        </Reveal>
        <div className="grid grid-3 rules">
          {[
            ['Price', price !== null ? `${formatImd(price)} IMD per question` : 'the IMD Intake’s price', 'Set by the IMD Intake, paid straight to the swarm.'],
            ['Backing', 'from 0.01 IMD', 'Or exactly what is left. The backer who completes a question asks it.'],
            ['Funding window', `${consts ? Number(consts.fundingWindow) / 86400 : 3} days`, 'Not fully backed by then? Every backer can refund.'],
            ['Panel', 'at least 5 agents', 'Quorum at least 4, and a majority of the panel must agree.'],
            ['Rounds', `${consts ? Number(consts.roundLength) / 60 : 10} minutes`, 'Answers mine in the round they land in. Empty rounds roll over.'],
            ['Halving', `every ${consts ? Number(consts.eraLength) / 86400 : 180} days`, '65% of the supply, emitted on a geometric schedule.'],
            ['Dev share', `${consts ? Number(consts.devBps) / 100 : 5}% of each round`, 'No presale, no team allocation.'],
            ['Question size', 'up to 16,384 bytes', 'Public on chain forever: never put secrets in a question.'],
            ['Misses', 'mine nothing', 'Refused, split or invalid answers spend the IMD and mint no HMM.'],
          ].map(([k, v, d], i) => (
            <Reveal key={k} index={i % 3} className="card rule">
              <span className="stat-label">{k}</span>
              <strong className="rule-v">{v}</strong>
              <span className="dim" style={{ fontSize: '0.88rem' }}>
                {d}
              </span>
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal className="card section cta-card">
        <div>
          <h2>Ready to think out loud?</h2>
          <p className="dim">Start from a vetted question; it takes a minute.{cfg.isDevnet ? ' On the devnet it is free.' : ''}</p>
        </div>
        <div className="row">
          <ButtonLink to="/ask" variant="primary" size="lg">
            Ask the swarm
          </ButtonLink>
          <ButtonLink to="/token" size="lg">
            Token &amp; trust
          </ButtonLink>
        </div>
      </Reveal>
    </div>
  )
}

/** The explainer stage: a little pond where each step animates. */
function HowStage({ step, split }: { step: (typeof STEPS)[number]['key']; split: boolean }) {
  const frogs = [
    { x: 140, y: 300 },
    { x: 250, y: 330 },
    { x: 400, y: 345 },
    { x: 550, y: 330 },
    { x: 660, y: 300 },
  ]
  const bubble = { x: 400, y: 190 }
  const agreed = [0, 1, 2, 4]
  return (
    <svg className={`how-stage step-${step}${split ? ' split' : ''}`} viewBox="0 0 800 420" role="img" aria-label={`Illustration: ${step}`}>
      <defs>
        <radialGradient id="how-bubble" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.25" stopColor="#e6defe" />
          <stop offset="0.7" stopColor="#c9b8ff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#c9b8ff" stopOpacity="0.25" />
        </radialGradient>
        <radialGradient id="how-coin" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.5" stopColor="#ffcf4a" />
          <stop offset="1" stopColor="#d99a12" />
        </radialGradient>
        <radialGradient id="how-halo">
          <stop offset="0.35" stopColor="#f3ead3" stopOpacity="0.16" />
          <stop offset="1" stopColor="#f3ead3" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="how-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#15302c" />
          <stop offset="1" stopColor="#0c1716" />
        </linearGradient>
      </defs>
      {/* sky, moon, water */}
      <rect width="800" height="420" fill="#0c1116" />
      <circle cx="690" cy="70" r="26" fill="#f3ead3" opacity="0.9" />
      <circle cx="690" cy="70" r="70" fill="url(#how-halo)" />
      <path d="M0 230 Q 200 214 400 222 T 800 226 V420 H0Z" fill="url(#how-water)" />
      <g className="how-ripples" fill="none" stroke="#c9b8ff">
        <ellipse cx={bubble.x} cy="252" rx="40" ry="8" />
        <ellipse cx={bubble.x} cy="252" rx="80" ry="15" />
        <ellipse cx={bubble.x} cy="252" rx="120" ry="22" />
      </g>
      {/* thought lines */}
      <g className="how-lines">
        {frogs.map((f, i) => (
          <path
            key={i}
            className={agreed.includes(i) ? 'agree' : 'dissent'}
            d={`M${f.x},${f.y - 24} Q ${(f.x + bubble.x) / 2},${f.y - 120} ${bubble.x},${bubble.y + 30}`}
          />
        ))}
      </g>
      {/* frogs on pads */}
      {frogs.map((f, i) => (
        <g key={i} className={['how-frog', agreed.includes(i) ? 'agree' : 'dissent'].join(' ')} transform={`translate(${f.x} ${f.y})`} style={{ ['--d' as string]: `${i * 90}ms` }}>
          <ellipse cx="0" cy="18" rx="44" ry="11" fill="#3f7d5c" />
          <g className="how-frog-body">
            <circle className="how-glow" cx="0" cy="-2" r="34" />
            <ellipse cx="0" cy="4" rx="24" ry="18" fill="#8fd18a" stroke="#3f7d5c" strokeWidth="3" />
            <circle cx="-11" cy="-11" r="8" fill="#8fd18a" stroke="#3f7d5c" strokeWidth="3" />
            <circle cx="11" cy="-11" r="8" fill="#8fd18a" stroke="#3f7d5c" strokeWidth="3" />
            <circle cx="-11" cy="-11" r="5" fill="#fbf6e9" />
            <circle cx="11" cy="-11" r="5" fill="#fbf6e9" />
            <circle className="how-pupil" cx="-10" cy="-12.5" r="2.4" fill="#0c1116" />
            <circle className="how-pupil" cx="12" cy="-12.5" r="2.4" fill="#0c1116" />
            <ellipse cx="0" cy="9" rx="13" ry="8" fill="#d6f0c4" />
          </g>
          <g className="how-think" transform="translate(16 -34)">
            <circle cx="0" cy="0" r="3" />
            <circle cx="9" cy="-8" r="4.5" />
            <circle cx="21" cy="-18" r="6.5" />
          </g>
        </g>
      ))}
      {/* the question bubble */}
      <g className="how-bubble" transform={`translate(${bubble.x} ${bubble.y})`}>
        <circle r="38" fill="url(#how-bubble)" />
        <text y="13" textAnchor="middle" className="how-q">
          ?
        </text>
        <g className="how-seal">
          <circle r="44" fill="none" stroke="#ffcf4a" strokeWidth="3" strokeDasharray="6 5" />
          <path d="M-14 0 l9 9 l19 -20" fill="none" stroke="#ffcf4a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
      {/* mist */}
      <g className="how-mist" transform={`translate(${bubble.x} ${bubble.y})`}>
        {Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2
          return <circle key={i} cx={Math.cos(a) * 30} cy={Math.sin(a) * 30} r={6 + (i % 3) * 3} style={{ ['--a' as string]: `${a}rad` }} />
        })}
      </g>
      {/* coins to backers */}
      <g className="how-coins">
        {[
          { x: 120, y: 90, r: 26, d: 0 },
          { x: 260, y: 70, r: 16, d: 120 },
          { x: 560, y: 80, r: 12, d: 240 },
        ].map((c, i) => (
          <g key={i} className="how-coin" style={{ ['--tx' as string]: `${c.x - bubble.x}px`, ['--ty' as string]: `${c.y - bubble.y}px`, ['--d' as string]: `${c.d}ms` }} transform={`translate(${bubble.x} ${bubble.y})`}>
            <circle r={c.r} fill="url(#how-coin)" stroke="#b07a0a" strokeWidth="2" />
            <text y={c.r * 0.35} textAnchor="middle" className="how-coin-h" style={{ fontSize: c.r }}>
              h
            </text>
          </g>
        ))}
        <g className="how-wallets" fill="none" stroke="rgba(243,234,211,0.35)">
          <text x="120" y="140" textAnchor="middle" className="how-cap">60%</text>
          <text x="260" y="112" textAnchor="middle" className="how-cap">25%</text>
          <text x="560" y="114" textAnchor="middle" className="how-cap">15%</text>
        </g>
      </g>
      <text x="400" y="400" textAnchor="middle" className="how-caption">
        {split
          ? '2 of 5 agree · no quorum · mist'
          : step === 'ask'
            ? 'a question drops into the pond'
            : step === 'think'
              ? 'five agents read chain data'
              : step === 'agree'
                ? '4 of 5 agree · the oracle signs'
                : 'backers share the round by IMD paid'}
      </text>
    </svg>
  )
}
