import { useEffect, useRef, type ReactNode } from 'react'
import { phasePath } from './MoonGlyph'
import { prefersReducedMotion } from './ui'

/**
 * The home page's scroll story. Each chapter is a tall section whose stage sticks to the viewport while the page
 * scrolls through it; the scroll position becomes `--p` (0..1) and a few sub-phases on the chapter element, and the
 * illustrations are pure CSS transforms of those variables (compositor-only). Reduced motion and automated captures
 * get each chapter's finished frame in normal flow instead.
 */

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a))

function staticMode(): boolean {
  if (typeof window === 'undefined') return true
  const automated = (navigator as Navigator & { webdriver?: boolean }).webdriver === true
  return prefersReducedMotion() || automated
}

/** Writes the chapter's scroll progress into CSS variables (and calls `onProgress`) on every frame it moves. */
function useChapter(onProgress?: (p: number) => void) {
  const ref = useRef<HTMLElement>(null)
  const cb = useRef(onProgress)
  cb.current = onProgress
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = (p: number, entry = 1) => {
      el.style.setProperty('--e', entry.toFixed(4))
      el.style.setProperty('--p', p.toFixed(4))
      el.style.setProperty('--a', seg(p, 0, 0.35).toFixed(4))
      el.style.setProperty('--b', seg(p, 0.3, 0.65).toFixed(4))
      el.style.setProperty('--c', seg(p, 0.6, 0.95).toFixed(4))
      cb.current?.(p)
    }
    if (staticMode()) {
      el.classList.add('chapter-static')
      set(1)
      return
    }
    let raf = 0
    let last = -1
    const update = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const span = r.height - vh
      const p = span > 0 ? clamp(-r.top / span) : r.top < 0 ? 1 : 0
      // entry: 0 as the chapter's top comes up from the bottom of the screen, 1 once it reaches the header
      const entry = clamp((vh - r.top) / (vh * 0.75))
      const key = p + entry * 2
      if (Math.abs(key - last) < 0.0005) return
      last = key
      set(p, entry)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])
  return ref
}

function Chapter({
  n,
  title,
  children,
  stage,
  onProgress,
  flip,
}: {
  n: number
  title: ReactNode
  children: ReactNode
  stage: ReactNode
  onProgress?: (p: number) => void
  flip?: boolean
}) {
  const ref = useChapter(onProgress)
  return (
    <section ref={ref} className={['chapter', flip && 'chapter-flip'].filter(Boolean).join(' ')} aria-labelledby={`ch-${n}`}>
      <div className="chapter-sticky">
        <div className="chapter-text">
          <span className="chapter-n" aria-hidden="true">
            0{n}
          </span>
          <h2 id={`ch-${n}`}>{title}</h2>
          <div className="chapter-body">{children}</div>
        </div>
        <div className="chapter-stage" aria-hidden="true">
          <div className="stage-glow" />
          {stage}
        </div>
      </div>
    </section>
  )
}

/* ───────────── shared drawing bits ───────────── */

function Sky({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c1116" />
          <stop offset="0.55" stopColor="#11201f" />
          <stop offset="1" stopColor="#0d1918" />
        </linearGradient>
        <radialGradient id={`${id}-bubble`} cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.25" stopColor="#e6defe" />
          <stop offset="0.7" stopColor="#c9b8ff" stopOpacity="0.8" />
          <stop offset="1" stopColor="#c9b8ff" stopOpacity="0.2" />
        </radialGradient>
        <radialGradient id={`${id}-coin`} cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.5" stopColor="#ffcf4a" />
          <stop offset="1" stopColor="#d99a12" />
        </radialGradient>
      </defs>
      <rect width="600" height="440" rx="28" fill={`url(#${id}-sky)`} />
      <g className="stage-stars">
        {STARS.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#f3ead3" opacity={0.25 + (i % 5) * 0.12} />
        ))}
      </g>
    </>
  )
}

const STARS: [number, number, number][] = Array.from({ length: 46 }, (_, i) => {
  const x = (i * 137.5) % 600
  const y = ((i * 89.3) % 190) + 8
  return [x, y, i % 7 === 0 ? 1.6 : 0.9]
})

function Water({ y = 270 }: { y?: number }) {
  return (
    <g className="stage-water">
      <path d={`M0 ${y} Q 150 ${y - 10} 300 ${y - 4} T 600 ${y} V440 H0Z`} fill="#10201f" />
      <path d={`M0 ${y} Q 150 ${y - 10} 300 ${y - 4} T 600 ${y}`} fill="none" stroke="rgba(243,234,211,0.12)" />
    </g>
  )
}

function Frog({ x, y, s = 1, className, style }: { x: number; y: number; s?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className={className} style={style}>
      <ellipse cx="0" cy="20" rx="44" ry="11" fill="#3f7d5c" />
      <circle className="frog-glow" cx="0" cy="-2" r="38" />
      <g className="frog-body">
        <ellipse cx="0" cy="4" rx="24" ry="18" fill="#8fd18a" stroke="#3f7d5c" strokeWidth="3" />
        <circle cx="-11" cy="-11" r="8" fill="#8fd18a" stroke="#3f7d5c" strokeWidth="3" />
        <circle cx="11" cy="-11" r="8" fill="#8fd18a" stroke="#3f7d5c" strokeWidth="3" />
        <circle cx="-11" cy="-11" r="5" fill="#fbf6e9" />
        <circle cx="11" cy="-11" r="5" fill="#fbf6e9" />
        <circle className="frog-pupil" cx="-10.5" cy="-12" r="2.4" fill="#0c1116" />
        <circle className="frog-pupil" cx="11.5" cy="-12" r="2.4" fill="#0c1116" />
        <ellipse cx="0" cy="9" rx="13" ry="8" fill="#d6f0c4" />
      </g>
    </g>
  )
}

/* ───────────── chapter stages ───────────── */

function DropStage() {
  return (
    <svg viewBox="0 0 600 440" className="stage stage-drop">
      <Sky id="drop" />
      <circle cx="500" cy="80" r="26" fill="#f3ead3" opacity="0.92" />
      <Water />
      <g className="drop-rings" fill="none" stroke="#c9b8ff">
        <ellipse className="ring r1" cx="300" cy="285" rx="70" ry="13" />
        <ellipse className="ring r2" cx="300" cy="285" rx="70" ry="13" />
        <ellipse className="ring r3" cx="300" cy="285" rx="70" ry="13" />
      </g>
      <Frog x={120} y={345} s={0.9} className="drop-frog" />
      <Frog x={480} y={352} s={0.85} className="drop-frog" />
      <Frog x={210} y={392} s={1.05} className="drop-frog" />
      <g className="drop-splash" fill="#e6defe">
        <circle cx="280" cy="270" r="3.5" className="d1" />
        <circle cx="318" cy="268" r="3" className="d2" />
        <circle cx="300" cy="262" r="4" className="d3" />
      </g>
      <g className="drop-bubble">
        <circle cx="300" cy="250" r="34" fill="url(#drop-bubble)" />
        <text x="300" y="262" textAnchor="middle" className="stage-q">
          ?
        </text>
      </g>
    </svg>
  )
}

const PANEL = [
  { x: 110, y: 330 },
  { x: 205, y: 372 },
  { x: 300, y: 388 },
  { x: 395, y: 372 },
  { x: 490, y: 330 },
]
const BUB = { x: 300, y: 175 }

function ThinkStage() {
  return (
    <svg viewBox="0 0 600 440" className="stage stage-think">
      <Sky id="think" />
      <Water y={250} />
      <g className="think-lines">
        {PANEL.map((f, i) => (
          <path
            key={i}
            pathLength={1}
            style={{ ['--i' as string]: i }}
            d={`M${f.x},${f.y - 26} Q ${(f.x + BUB.x) / 2},${f.y - 150} ${BUB.x},${BUB.y + 34}`}
          />
        ))}
      </g>
      {PANEL.map((f, i) => (
        <Frog key={i} x={f.x} y={f.y} s={0.9} className="think-frog" style={{ ['--i' as string]: i }} />
      ))}
      {PANEL.map((f, i) => (
        <g key={i} className="think-dots" style={{ ['--i' as string]: i }} transform={`translate(${f.x + 18} ${f.y - 52})`}>
          <circle cx="0" cy="0" r="3" />
          <circle cx="9" cy="-8" r="4.5" />
          <circle cx="21" cy="-18" r="6.5" />
        </g>
      ))}
      <g className="think-bubble">
        <circle cx={BUB.x} cy={BUB.y} r="36" fill="url(#think-bubble)" />
        <text x={BUB.x} y={BUB.y + 13} textAnchor="middle" className="stage-q">
          ?
        </text>
      </g>
    </svg>
  )
}

function MineStage() {
  const agree = [0, 1, 2, 4]
  return (
    <svg viewBox="0 0 600 440" className="stage stage-mine">
      <Sky id="mine" />
      <Water y={250} />
      <g className="mine-lines">
        {PANEL.map((f, i) => (
          <path key={i} className={agree.includes(i) ? 'agree' : 'dissent'} d={`M${f.x},${f.y - 26} Q ${(f.x + BUB.x) / 2},${f.y - 150} ${BUB.x},${BUB.y + 34}`} />
        ))}
      </g>
      <g className="mine-lines-gold">
        {PANEL.filter((_, i) => agree.includes(i)).map((f, i) => (
          <path key={i} d={`M${f.x},${f.y - 26} Q ${(f.x + BUB.x) / 2},${f.y - 150} ${BUB.x},${BUB.y + 34}`} />
        ))}
      </g>
      {PANEL.map((f, i) => (
        <Frog key={i} x={f.x} y={f.y} s={0.9} className={['mine-frog', agree.includes(i) ? 'agree' : 'dissent'].join(' ')} style={{ ['--i' as string]: i }} />
      ))}
      <g className="mine-bubble">
        <circle cx={BUB.x} cy={BUB.y} r="36" fill="url(#mine-bubble)" />
        <text x={BUB.x} y={BUB.y + 13} textAnchor="middle" className="stage-q">
          ?
        </text>
      </g>
      <g className="mine-seal">
        <circle cx={BUB.x} cy={BUB.y} r="46" fill="none" stroke="#ffcf4a" strokeWidth="3" strokeDasharray="6 5" />
        <path d={`M${BUB.x - 14} ${BUB.y} l9 9 l19 -20`} fill="none" stroke="#ffcf4a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x={BUB.x} y={BUB.y + 74} textAnchor="middle" className="stage-cap mine-tally">
        4 of 5 agree · signed
      </text>
      <g className="mine-coin">
        <circle cx={BUB.x} cy={BUB.y} r="30" fill="url(#mine-coin)" stroke="#b07a0a" strokeWidth="2.5" />
        <text x={BUB.x} y={BUB.y + 11} textAnchor="middle" className="stage-h">
          h
        </text>
      </g>
      {[
        { x: 120, y: 70, r: 22, pct: '60%' },
        { x: 300, y: 48, r: 14, pct: '25%' },
        { x: 480, y: 70, r: 11, pct: '15%' },
      ].map((c, i) => (
        <g key={i} className="mine-share" style={{ ['--i' as string]: i, ['--tx' as string]: `${c.x - BUB.x}px`, ['--ty' as string]: `${c.y - BUB.y + 40}px` }}>
          <g className="mine-share-coin">
            <circle cx={BUB.x} cy={BUB.y - 40} r={c.r} fill="url(#mine-coin)" stroke="#b07a0a" strokeWidth="2" />
          </g>
          <text x={c.x} y={c.y + c.r + 22} textAnchor="middle" className="stage-cap mine-pct">
            {c.pct}
          </text>
        </g>
      ))}
    </svg>
  )
}

function MoonStage({ moon }: { moon: React.RefObject<SVGPathElement> }) {
  const heights = [1, 0.5, 0.25, 0.125]
  return (
    <svg viewBox="0 0 600 440" className="stage stage-moon">
      <Sky id="moonst" />
      <defs>
        <radialGradient id="moonst-face" cx="40%" cy="35%" r="75%">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="0.7" stopColor="#f3ead3" />
          <stop offset="1" stopColor="#d9cdb0" />
        </radialGradient>
        <radialGradient id="moonst-halo">
          <stop offset="0.4" stopColor="#f3ead3" stopOpacity="0.22" />
          <stop offset="1" stopColor="#f3ead3" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="300" cy="150" r="140" fill="url(#moonst-halo)" className="moon-halo-st" />
      <circle cx="300" cy="150" r="84" fill="#1b2a2c" />
      <path ref={moon} id="moonst-lit" d={phasePath(300, 150, 84, 1)} fill="url(#moonst-face)" />
      <clipPath id="moonst-clip">
        <use href="#moonst-lit" />
      </clipPath>
      <g fill="#c9bf9f" opacity="0.32" clipPath="url(#moonst-clip)">
        <circle cx="276" cy="128" r="12" />
        <circle cx="326" cy="166" r="17" />
        <circle cx="290" cy="190" r="8" />
      </g>
      <g className="moon-eras">
        {heights.map((h, i) => (
          <g key={i} className="moon-era" style={{ ['--i' as string]: i }}>
            <rect x={150 + i * 85} y={420 - h * 150} width="22" height={h * 150} rx="4" />
            <text x={161 + i * 85} y={430} textAnchor="middle" className="stage-cap">
              era {i}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}

function FairStage() {
  const badges = ['No presale', 'No team allocation', 'No admin keys', 'No owner, mint or tax', 'LP locked by the launch factory']
  return (
    <svg viewBox="0 0 600 440" className="stage stage-fair">
      <Sky id="fair" />
      <g className="fair-bar">
        <rect className="fair-seg s-mine" x="40" y="120" width="338" height="58" rx="10" fill="#c08a12" />
        <rect className="fair-seg s-pool" x="382" y="120" width="128" height="58" rx="10" fill="#4f9d5d" />
        <rect className="fair-seg s-swarm" x="514" y="120" width="46" height="58" rx="10" fill="#8a74f0" />
        <text x="209" y="157" textAnchor="middle" className="fair-label">
          65% mined
        </text>
        <text x="446" y="157" textAnchor="middle" className="fair-label">
          25% pool
        </text>
        <text x="537" y="157" textAnchor="middle" className="fair-label">
          10%
        </text>
      </g>
      <text x="300" y="96" textAnchor="middle" className="stage-cap fair-total">
        1,000,000,000 HMM
      </text>
      <g className="fair-badges">
        {badges.map((b, i) => (
          <g key={b} transform={`translate(${i % 2 === 0 ? 70 : 316} ${222 + Math.floor(i / 2) * 58})`}>
            <g className="fair-badge" style={{ ['--i' as string]: i }}>
              <rect width={i === 4 ? 460 : 214} height="42" rx="21" fill="rgba(143,209,138,0.1)" stroke="rgba(143,209,138,0.45)" />
              <circle cx="22" cy="21" r="10" fill="#8fd18a" />
              <path d="M17 21l3.5 3.5 6.5-7" fill="none" stroke="#0c1116" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <text x="42" y="26" className="fair-badge-t">
                {b}
              </text>
            </g>
          </g>
        ))}
      </g>
    </svg>
  )
}

/* ───────────── the story ───────────── */

export function ScrollStory() {
  const moon = useRef<SVGPathElement>(null)
  const onMoon = (p: number) => {
    // lit fraction 1/2^era, scrubbing continuously from era 0 to era 3
    const era = 3 * seg(p, 0.1, 0.9)
    const lit = Math.pow(2, -era)
    const path = moon.current
    if (!path) return
    path.setAttribute('d', phasePath(300, 150, 84, lit))
    const chapter = path.closest('.chapter') as HTMLElement | null
    chapter?.style.setProperty('--era', era.toFixed(3))
    chapter?.style.setProperty('--lit', lit.toFixed(3))
  }
  return (
    <div className="story">
      <Chapter n={1} title={<>Drop a question.</>} stage={<DropStage />}>
        <p>
          Pick a question about the chain and pay the IMD swarm's price for it: alone, or start it and let others chip
          in from 0.01 IMD. The moment it holds the full price, the mine asks the swarm.
        </p>
      </Chapter>
      <Chapter n={2} title={<>A panel thinks.</>} stage={<ThinkStage />} flip>
        <p>
          A panel of at least five IMD agents, people's AI workers bound to IMD seats, reads the chain and answers on
          its own. Nobody sees the others' answers first.
        </p>
      </Chapter>
      <Chapter n={3} title={<>They agree. You mine.</>} stage={<MineStage />}>
        <p>
          At least four agents, and a majority of the panel, must give the same answer, and the swarm's oracle must
          sign it; the mine checks both. The answer lands in the current 10-minute round, and when the round ends its
          backers share that round's HMM by the IMD they paid.
        </p>
        <p className="dim">A split or refused question mines nothing.</p>
      </Chapter>
      <Chapter n={4} title={<>The moon halves.</>} stage={<MoonStage moon={moon} />} onProgress={onMoon} flip>
        <p>
          65% of all HMM is mined on a fixed schedule from genesis: a steady rate that halves every 180 days, so the
          reserve is never exceeded. A round nobody answers emits nothing; its HMM rolls into the next answered one.
        </p>
      </Chapter>
      <Chapter n={5} title={<>No admin keys. A fair launch.</>} stage={<FairStage />}>
        <p>
          One billion HMM: 65% is mined, 25% seeds a Uniswap v4 pool with IMD (the launch factory locks the liquidity)
          and 10% goes to the IMD seat holders. No presale, no team allocation. The token has no owner, mint or tax, and
          the mine launches with no admin keys.
        </p>
        <p className="dim">The dev earns 5% of every mined round and the launch's 1% LP fee.</p>
      </Chapter>
    </div>
  )
}
