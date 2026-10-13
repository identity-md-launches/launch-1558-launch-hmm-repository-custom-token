/**
 * DEV-ONLY lab for the Thinking Pond: mounts PondCanvas full-screen with FAKE data and buttons that exercise every
 * transition. Served by `vite` at /lab/pond.html; not part of the production build. Nothing here is real.
 */
import '@fontsource-variable/bricolage-grotesque'
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PondCanvas } from '../src/pond/PondCanvas'
import type { PondEngine } from '../src/pond/engine'
import type { PondHandle, PondPick, PondQuestion, PondSeat } from '../src/pond/types'

const FAKE_TEXTS = [
  'At the window’s closing block, was totalSupply() of the ERC-20 contract 0xD34a…63B7 on Ethereum mainnet greater than 1e24 (raw units, 18 decimals)?',
  'How many Transfer(address,address,uint256) logs did the contract 0xD34a…63B7 emit on Ethereum mainnet from the window’s first block through its last block, inclusive?',
  'At the window’s closing block, was the native ETH balance of address 0x9efa…7247 on Ethereum mainnet greater than 1000000000000000000 wei?',
  'What was sqrtPriceX96 of Uniswap v4 pool 0x4158…a704 in the Ethereum mainnet PoolManager at the window’s closing block?',
]

function fakeSeats(n: number): PondSeat[] {
  const seats: PondSeat[] = []
  for (let i = 0; i < n; i++) {
    seats.push({
      tokenId: i,
      agentId: String(50000 + i * 7),
      attempts: 100 + ((i * 37) % 900),
      accepted: 90 + ((i * 31) % 800),
      last: new Date(Date.now() - ((i * 7919) % 86_400) * 1000).toISOString(),
      working: i % 83 === 5,
    })
  }
  return seats
}

let nextId = 100

function initialQuestions(): PondQuestion[] {
  const qs: PondQuestion[] = []
  for (let i = 0; i < 9; i++) {
    qs.push({ id: String(i + 1), text: FAKE_TEXTS[i % 4], status: 'answered', answer: i % 2 ? 'yes' : '1,284', panelSize: 5, agreed: 5, order: i + 1 })
  }
  qs.push({ id: '20', text: FAKE_TEXTS[1], status: 'open', raised: 0.2, order: 20 })
  qs.push({ id: '21', text: FAKE_TEXTS[2], status: 'open', raised: 0.62, order: 21 })
  qs.push({ id: '30', text: FAKE_TEXTS[0], status: 'asked', panelSize: 5, order: 30 })
  return qs
}

function Lab() {
  const handle = useRef<PondHandle | null>(null)
  const wallet = useRef<HTMLButtonElement>(null)
  const pondBox = useRef<HTMLDivElement>(null)
  const [questions, setQuestions] = useState<PondQuestion[]>(initialQuestions)
  const [era, setEra] = useState(0)
  const [pot, setPot] = useState(3)
  const [live, setLive] = useState(true)
  const [reduced, setReduced] = useState(false)
  const [mine, setMine] = useState(true)
  const [online, setOnline] = useState(1012)
  const [log, setLog] = useState<string[]>([])
  const [perf, setPerf] = useState('')
  const [bounce, setBounce] = useState(0)
  const [quietOn, setQuietOn] = useState(false)
  const [introKey, setIntroKey] = useState(0)
  const [intro, setIntro] = useState(() => new URLSearchParams(location.search).has('intro'))
  const [sounds, setSounds] = useState<string[]>([])
  const clock = useRef(0.35)
  const quietRect = () => (innerWidth >= 800 ? { x: 60, y: 110, w: Math.min(600, innerWidth * 0.42), h: 430 } : null)

  const say = useCallback((s: string) => setLog((l) => [s, ...l].slice(0, 6)), [])

  const onHandle = useCallback((h: PondHandle | null) => {
    handle.current = h
    if (!h) return
    h.setCoinTarget(() => {
      const b = wallet.current?.getBoundingClientRect()
      const p = pondBox.current?.getBoundingClientRect()
      if (!b || !p) return null
      return { x: b.left + b.width / 2 - p.left, y: b.top + b.height / 2 - p.top }
    })
  }, [])

  useEffect(() => {
    handle.current?.setSwarm({ online, seats: fakeSeats(1047) })
  }, [online, introKey])

  useEffect(() => {
    handle.current?.setQuietZone(quietOn ? quietRect() : null)
  }, [quietOn, introKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    handle.current?.setQuestions(questions)
  }, [questions, introKey])

  // a compressed fake round clock: one "round" per minute
  useEffect(() => {
    const push = () => handle.current?.setMoon({ live, era, roundProgress: clock.current, roundsInPot: pot })
    push()
    const id = window.setInterval(() => {
      clock.current = (clock.current + 1 / 60) % 1
      push()
      const e = handle.current as PondEngine | null
      if (e?.perf) {
        const p = e.perf
        setPerf(`cpu ${p.cpuMs.toFixed(2)}ms · frame ${p.frameMs.toFixed(1)}ms · gl×${p.glScale.toFixed(2)} · frogs ${p.frogs} · particles ${p.particles} · ${p.webgl ? 'webgl2' : '2d fallback'}`)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [live, era, pot, introKey])

  const update = (fn: (qs: PondQuestion[]) => PondQuestion[]) => setQuestions((qs) => fn(qs))
  const api = {
    ask: () => update((qs) => [...qs, { id: String(++nextId), text: FAKE_TEXTS[nextId % 4], status: 'asked', panelSize: 5, mine, order: nextId }]),
    answer: () =>
      update((qs) => {
        const a = qs.find((q) => q.status === 'asked')
        return a ? qs.map((q) => (q === a ? { ...q, status: 'answered', answer: 'yes', agreed: 5, mine } : q)) : qs
      }),
    fail: () =>
      update((qs) => {
        const a = qs.find((q) => q.status === 'asked')
        return a ? qs.map((q) => (q === a ? { ...q, status: 'failed', reason: 'the panel disagreed' } : q)) : qs
      }),
    bud: () => update((qs) => [...qs, { id: String(++nextId), text: FAKE_TEXTS[nextId % 4], status: 'open', raised: 0.05, order: nextId }]),
    back: () =>
      update((qs) => {
        const o = qs.find((q) => q.status === 'open')
        if (!o) return qs
        const r = Math.min(1, (o.raised ?? 0) + 0.2)
        return qs.map((q) => (q === o ? (r >= 1 ? { ...q, raised: 1, status: 'asked', panelSize: 5, mine } : { ...q, raised: r }) : q))
      }),
    croak: () => handle.current?.croak(),
    clear: () => setQuestions([]),
    reset: () => setQuestions(initialQuestions()),
    era: (d: number) => setEra((e) => Math.max(0, Math.min(6, e + d))),
    pot: (d: number) => setPot((p) => Math.max(0, Math.round(d > 0 ? p * 2 + 1 : p / 2))),
    live: () => setLive((v) => !v),
    quiet: () => setQuietOn((v) => !v),
    replayIntro: () => {
      setIntro(true)
      setIntroKey((k) => k + 1)
    },
    skipIntro: () => handle.current?.skipIntro(),
    sounds: () => sounds,
    reduced: () => setReduced((v) => !v),
    mine: () => setMine((v) => !v),
    online: (n: number) => setOnline(n),
    ripple: (x: number, y: number, s = 1) => handle.current?.ripple(x, y, s),
    engine: () => handle.current as PondEngine | null,
  }
  ;(window as unknown as { lab: typeof api }).lab = api

  const onPick = (p: PondPick) => {
    say(`pick ${p.kind}${'id' in p ? ' #' + p.id : ''}${p.kind === 'frog' ? ' seat ' + (p.seat?.tokenId ?? '–') : ''} @${Math.round(p.x)},${Math.round(p.y)}`)
  }

  const btn: React.CSSProperties = {
    font: '600 12px system-ui',
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid rgba(243,234,211,.25)',
    background: 'rgba(12,17,22,.7)',
    color: '#f3ead3',
    cursor: 'pointer',
  }
  return (
    <div ref={pondBox} style={{ position: 'fixed', inset: 0 }}>
      <PondCanvas
        key={`pond-${introKey}`}
        intro={intro}
        onIntroDone={() => say('intro done')}
        onSound={(kind, strength, pan) =>
          setSounds((l) => [`${kind} ${strength.toFixed(2)} ${pan >= 0 ? '+' : ''}${pan.toFixed(2)}`, ...l].slice(0, 8))
        }
        handleRef={onHandle}
        reducedMotion={reduced}
        onPick={onPick}
        onHover={(p) => p && say(`hover ${p.kind}`)}
        onCoinLanded={(id) => {
          say(`coin landed #${id}`)
          setBounce((b) => b + 1)
        }}
        onLayout={(l) => say(`layout ${l.width}×${l.height} horizon ${l.horizon} moon ${Math.round(l.moon.x)},${Math.round(l.moon.y)} r${Math.round(l.moon.r)}`)}
      />
      <button
        ref={wallet}
        key={`wallet-${bounce}`}
        style={{ ...btn, position: 'absolute', top: 14, right: 16, animation: bounce ? 'labBounce .5s' : undefined }}
      >
        fake wallet
      </button>
      <style>{'@keyframes labBounce{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}'}</style>
      {quietOn && quietRect() && (
        <div
          style={{
            position: 'absolute',
            left: quietRect()!.x,
            top: quietRect()!.y,
            width: quietRect()!.w,
            height: quietRect()!.h,
            border: '1px dashed rgba(255,122,107,.6)',
            borderRadius: 12,
            pointerEvents: 'none',
            font: '600 11px system-ui',
            color: 'rgba(255,122,107,.8)',
            padding: 8,
          }}
        >
          quiet zone (where the hero copy sits)
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          font: '700 11px system-ui',
          letterSpacing: '.08em',
          color: '#ff7a6b',
          background: 'rgba(12,17,22,.75)',
          padding: '4px 8px',
          borderRadius: 6,
        }}
      >
        POND LAB · FAKE DATA · DEV ONLY
      </div>
      <div
        className="lab-controls"
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 12,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <button style={btn} onClick={api.ask}>ask</button>
        <button style={btn} onClick={api.answer}>answer</button>
        <button style={btn} onClick={api.fail}>fail</button>
        <button style={btn} onClick={api.bud}>new bud</button>
        <button style={btn} onClick={api.back}>back +20%</button>
        <button style={btn} onClick={api.croak}>croak</button>
        <button style={btn} onClick={() => api.era(-1)}>era −</button>
        <button style={btn} onClick={() => api.era(1)}>era + ({era})</button>
        <button style={btn} onClick={() => api.pot(-1)}>pot −</button>
        <button style={btn} onClick={() => api.pot(1)}>pot + ({pot})</button>
        <button style={btn} onClick={api.live}>{live ? 'live ✓' : 'pre-launch'}</button>
        <button style={btn} onClick={api.reduced}>{reduced ? 'reduced motion ✓' : 'full motion'}</button>
        <button style={btn} onClick={api.mine}>{mine ? 'mine ✓' : 'not mine'}</button>
        <button style={btn} onClick={() => api.online(online > 300 ? 120 : 1012)}>online {online}</button>
        <button style={btn} onClick={api.quiet}>{quietOn ? 'quiet zone ✓' : 'quiet zone'}</button>
        <button style={btn} onClick={api.replayIntro}>replay intro</button>
        <button style={btn} onClick={api.skipIntro}>skip intro</button>
        <span style={{ font: '11px ui-monospace, monospace', opacity: 0.8, color: '#c9b8ff' }}>♪ {sounds.join(' · ') || 'no sound cues yet'}</span>
        <span style={{ font: '11px ui-monospace, monospace', opacity: 0.75 }}>{perf}</span>
        <span style={{ font: '11px ui-monospace, monospace', opacity: 0.6, width: '100%' }}>{log.join('  ·  ')}</span>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
