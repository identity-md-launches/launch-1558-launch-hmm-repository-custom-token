/**
 * The Thinking Pond engine: owns the canvases, the animation loop, input and every living thing in the pond.
 * Implements `PondHandle`; `PondCanvas` mounts it.
 */
import type { Layout, ScreenPoint } from './camera'
import { computeLayout, moonAt, project, toWater } from './camera'
import type { Frog, Pad, Slot } from './crowd'
import { Crowd, quietFactor } from './crowd'
import type { Meteor } from './effects'
import {
  Fireflies,
  Particles,
  Reeds,
  drawBubble,
  drawBud,
  drawCoin,
  drawMeteor,
  drawRing,
  drawThoughtLines,
  questionColor,
  resetGlyphs,
} from './effects'
import { Water2D } from './fallback2d'
import { approach, clamp, easeInOutCubic, easeOutBack, easeOutCubic, lerp, mulberry32, smoothstep, treeHeight } from './rng'
import { MoonPainter } from './moon'
import { WaveSim } from './sim'
import type { BubbleKind } from './sprites'
import { BUBBLE_H, bubbleSprite, glowSprite, resetTextSprites } from './sprites'
import type { PondHandle, PondLayout, PondMoon, PondPick, PondQuestion, PondRect, PondSeat, PondSoundKind } from './types'
import { WaterGL } from './water-gl'
import { palette } from '../theme'

export interface EngineCallbacks {
  onPick?: (pick: PondPick) => void
  onHover?: (pick: PondPick | null) => void
  onCoinLanded?: (questionId: string) => void
  onLayout?: (layout: PondLayout) => void
  onIntroDone?: () => void
  onSound?: (kind: PondSoundKind, strength: number, pan: number) => void
}

type BubbleState = 'drop' | 'rise' | 'float' | 'converge' | 'coin' | 'fly' | 'fade' | 'wobble' | 'leave'

interface Bubble {
  id: string
  q: PondQuestion
  x: number
  z: number
  y: number
  vy: number
  state: BubbleState
  t: number
  panel: Frog[]
  slot: Slot | null
  g: number
  c: number
  alpha: number
  squish: number
  spin: number
  /** Height the coin starts rising from. */
  y0: number
  from: { x: number; y: number } | null
  hover: number
  hoverTarget: number
  nextDots: number
  mine: boolean
  sx: number
  sy: number
  R: number
  k: number
}

interface Bud {
  id: string
  q: PondQuestion
  pad: Pad | null
  x: number
  z: number
  raised: number
  target: number
  pulse: number
  appear: number
  open: number
  state: 'grow' | 'idle' | 'bloom' | 'sink'
  t: number
  hover: number
  hoverTarget: number
  sx: number
  sy: number
  k: number
}

interface Croak {
  frog: Frog
  kind: BubbleKind
  t: number
  dur: number
}

interface Seed {
  x: number
  z: number
  y: number
  vy: number
  t: number
  landed: boolean
  frogs: Frog[]
}

interface Fish {
  x: number
  z: number
  t: number
  dur: number
  dir: number
  len: number
  splashed: number
}

const BUBBLE_R_BASE = 0.15
const FLOAT_Y = 0.11
const MAX_FIREFLIES = 48
const SEED = 0x51ab
const RISE_MS = 3400
/** A launch noticed this soon after the pond appeared is data arriving, not a moonrise to watch. */
const SETTLE_MS = 4500
/** The first-visit intro: from the stars down to the pond. */
const INTRO_MS = 2900
const INTRO_SKIP_MS = 300
/** Fewest milliseconds between two cues of a kind. */
const SOUND_GAP: Record<PondSoundKind, number> = { croak: 140, plip: 70, splash: 160, chime: 160, pop: 160 }

const hidden =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0'

export class PondEngine implements PondHandle {
  private container: HTMLElement
  private wrap: HTMLDivElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private water: WaterGL | null = null
  private water2d: Water2D | null = null
  private L: Layout | null = null
  private sim: WaveSim | null = null
  private crowd: Crowd | null = null
  private flies: Fireflies | null = null
  private particles = new Particles()
  private reeds = new Reeds()
  private rnd = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0)
  private pt: ScreenPoint = { x: 0, y: 0, k: 1 }

  private t = 0
  private last = 0
  private raf = 0
  private visible = true
  private onscreen = true
  private reduced: boolean
  private disposed = false
  private dpr = 1
  private glScale = 1
  private glMax = 1.5
  private slowMs = 0
  private fastMs = 0
  private frameEma = 16.7

  private pointer: { x: number; y: number } | null = null
  private down: { x: number; y: number; t: number } | null = null
  private dragging = false
  private lastWake: { x: number; y: number } | null = null
  private hoverKey = ''
  /** Question bubble radius and bud scale for the current layout (smaller on portrait screens). */
  private bubbleR = BUBBLE_R_BASE
  private budScale = 1
  private hoverFrog: Frog | null = null
  private lastTrail: { x: number; y: number; t: number } | null = null

  /** Wall clock shared by every time-based animation; the lab's `advance` fast-forwards it. */
  private timeShift = 0
  private frozenAt = 0
  private clock(): number {
    return (this.frozenAt || performance.now()) + this.timeShift
  }

  /** Lab/testing: stop (or resume) the loop and the wall clock; `advance` then steps time deterministically. */
  setPaused(on: boolean): void {
    if (on === this.debug.paused) return
    if (on) this.frozenAt = performance.now()
    else {
      this.timeShift -= performance.now() - this.frozenAt
      this.frozenAt = 0
    }
    this.debug.paused = on
    if (!on) this.kick()
  }

  private quiet: PondRect | null = null
  private quietKey = ''
  private quietTimer = 0
  private moonPainter = new MoonPainter()

  private introOn = false
  private introStart = 0
  private introSkipAt = 0
  private introSkipFrom = 0
  private introP = 1
  private introDoneSent = false
  private introCroaks = 0
  private introPlops = 0
  private lastSound: Record<PondSoundKind, number> = { croak: 0, plip: 0, splash: 0, chime: 0, pop: 0 }
  private lastAmbientSound = 0

  private online: number | null = null
  private seats: PondSeat[] = []
  private moonTarget: PondMoon = { live: false, era: 0, roundProgress: 0, roundsInPot: 0 }
  private moonInit = false
  private bornAt = performance.now()
  private rise = 0
  /** Wall-clock moonrise: from `riseFrom` at `riseAt` toward the target over RISE_MS. */
  private riseFrom = 0
  private riseAt = 0
  private phase = 0
  private gladeSigma = 0.05
  private gladeGain = 0.4
  private ringAlpha = 0
  private progress = 0
  private flash = 0
  private layoutSent = ''
  private layoutAt = 0

  private questions = new Map<string, PondQuestion>()
  private qInit = false
  private pendingQs: PondQuestion[] | null = null
  private bubbles = new Map<string, Bubble>()
  private buds = new Map<string, Bud>()
  private croaks: Croak[] = []
  private seeds: Seed[] = []
  private meteors: Meteor[] = []
  private fish: Fish[] = []
  private ripples2d: { x: number; y: number; age: number; strength: number }[] = []
  private hopping = new Set<Frog>()
  private coinTarget: (() => { x: number; y: number } | null) | null = null

  private nextCroak = 1
  private nextDrop = 0
  private nextFish = 14
  private nextMeteor = 9
  private nextWorking = 2

  /** Rough timings for the lab. */
  readonly perf = { cpuMs: 0, frameMs: 16.7, glScale: 1, frogs: 0, particles: 0, webgl: false, simMs: 0, waterMs: 0, drawMs: 0, updateMs: 0 }
  /** Lab switches. */
  readonly debug = { fixedScale: false, paused: false }

  private ro: ResizeObserver
  private io: IntersectionObserver | null = null

  constructor(
    container: HTMLElement,
    private cb: EngineCallbacks,
    reducedMotion: boolean,
    intro = false,
  ) {
    this.container = container
    this.reduced = reducedMotion
    this.introOn = intro && !reducedMotion
    this.introP = this.introOn ? 0 : 1
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;touch-action:pan-y;-webkit-tap-highlight-color:transparent'
    const bg = document.createElement('canvas')
    const fg = document.createElement('canvas')
    for (const c of [bg, fg]) {
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
      c.setAttribute('aria-hidden', 'true')
    }
    wrap.append(bg, fg)
    const desc = document.createElement('p')
    desc.style.cssText = hidden
    desc.textContent =
      'An animated night pond. Each frog is an IMD agent that is online; glowing fireflies are questions the swarm answered; lotus buds are questions still raising IMD; the moon’s phase follows the halving era and its ring ticks through the current ten-minute round.'
    wrap.append(desc)
    container.append(wrap)
    this.wrap = wrap
    this.canvas = fg
    this.ctx = fg.getContext('2d')!

    this.water = WaterGL.create(bg)
    if (!this.water) {
      // a canvas that failed to give WebGL2 may still give 2D; use a fresh one to be safe
      const c2 = document.createElement('canvas')
      c2.style.cssText = bg.style.cssText
      c2.setAttribute('aria-hidden', 'true')
      wrap.replaceChild(c2, bg)
      this.water2d = new Water2D(c2)
    }
    this.perf.webgl = !!this.water

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver(
        (entries) => {
          this.onscreen = entries.some((e) => e.isIntersecting)
          this.kick()
        },
        { threshold: 0 },
      )
      this.io.observe(container)
    }
    document.addEventListener('visibilitychange', this.onVisibility)
    wrap.addEventListener('pointermove', this.onPointerMove)
    wrap.addEventListener('pointerdown', this.onPointerDown)
    wrap.addEventListener('pointerup', this.onPointerUp)
    wrap.addEventListener('pointerleave', this.onPointerLeave)
    wrap.addEventListener('pointercancel', this.onPointerLeave)
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    fonts?.ready.then(() => {
      resetTextSprites()
      resetGlyphs()
      this.invalidate()
    })
    this.particles.onLand = (x, z) => {
      if (!this.L) return
      project(this.L, x, 0, z, this.pt)
      this.sound('plip', 0.08 + this.rnd() * 0.07, this.pt.x, true)
    }
    this.resize()
    if (this.introOn) this.crowd?.sleep()
    else queueMicrotask(() => !this.disposed && this.introDone())
    this.kick()
  }

  /* ───────────────────────────── handle ───────────────────────────── */

  setSwarm(input: { online: number | null; seats: PondSeat[] }): void {
    // Stored first, so a call that arrives before the first layout is applied when the pond is built.
    const n = input?.online
    this.online = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : null
    this.seats = Array.isArray(input?.seats) ? input.seats : []
    if (this.crowd) {
      this.crowd.setSeats(this.seats)
      this.crowd.setCount(this.frogCount(), this.reduced)
      this.perf.frogs = this.crowd.count
      for (const b of this.bubbles.values()) {
        if ((b.state === 'float' || b.state === 'drop' || b.state === 'rise') && b.panel.some((f) => !f.active)) this.pickPanel(b)
      }
      for (const s of this.seeds) s.frogs = s.frogs.filter((f) => f.active)
    }
    this.invalidate()
  }

  setMoon(input: PondMoon): void {
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    const moon: PondMoon = {
      live: !!input?.live,
      era: Math.max(0, num(input?.era, 0)),
      roundProgress: clamp(num(input?.roundProgress, 0), 0, 1),
      roundsInPot: Math.max(0, num(input?.roundsInPot, 0)),
    }
    const prev = this.moonTarget
    this.moonTarget = moon
    const settling = this.clock() - this.bornAt < SETTLE_MS
    if (moon.live !== prev.live) {
      if (!this.moonInit || settling || this.reduced) {
        // first word, or data arriving while the page loads: no moonrise, just be where we belong
        this.rise = moon.live ? 1 : 0
        this.riseFrom = this.rise
        this.ringAlpha = moon.live ? 1 : 0
      } else {
        this.riseFrom = this.rise
        this.riseAt = this.clock()
      }
    }
    if (!this.moonInit) {
      this.moonInit = true
      this.rise = moon.live ? 1 : 0
      this.riseFrom = this.rise
      this.ringAlpha = moon.live ? 1 : 0
      this.phase = this.phaseFor(moon.era)
      this.progress = clamp(moon.roundProgress, 0, 1)
      const [s, g] = this.gladeFor(moon)
      this.gladeSigma = s
      this.gladeGain = g
    } else if (moon.live && prev.live && moon.roundProgress + 0.5 < prev.roundProgress) {
      this.roundTurned()
    }
    this.invalidate()
  }

  setQuestions(list: PondQuestion[]): void {
    if (!this.crowd || !this.L) {
      this.pendingQs = list
      return
    }
    // The first call, or a call that brings many questions at once (a backfill after loading), shows everything at
    // rest; live changes arrive a few at a time and animate.
    const fresh = list.reduce((n, q) => n + (this.questions.has(q.id) ? 0 : 1), 0)
    const changed = list.reduce((n, q) => {
      const p = this.questions.get(q.id)
      return n + (p && p.status !== q.status ? 1 : 0)
    }, 0)
    const first = !this.qInit || fresh > 3
    const bulk = changed > 6
    this.qInit = true
    const next = new Map<string, PondQuestion>()
    for (const q of list) next.set(q.id, q)
    for (const q of list) {
      const prev = this.questions.get(q.id)
      if (!prev) {
        if (first || this.reduced) this.spawnResting(q)
        else this.spawnNew(q)
      } else if (prev.status !== q.status) {
        if (bulk) {
          this.removeVisual(prev.id)
          this.spawnResting(q)
        } else this.transition(prev, q)
      } else if (q.status === 'open') {
        const bud = this.buds.get(q.id)
        if (bud) {
          bud.q = q
          const r = clamp(q.raised ?? 0, 0, 1)
          if (r > bud.target + 1e-6 && !this.reduced) this.budPulse(bud)
          bud.target = r
          if (this.reduced) bud.raised = r
        }
      } else {
        const b = this.bubbles.get(q.id)
        if (b) {
          b.q = q
          b.mine = !!q.mine
        }
      }
    }
    for (const [id, prev] of this.questions) if (!next.has(id)) this.removeQuestion(prev)
    this.questions = next
    this.capFireflies()
    this.invalidate()
  }

  croak(tokenId?: number): void {
    if (!this.crowd) return
    let f: Frog | null = null
    if (tokenId !== undefined) f = this.crowd.frogOfSeat(tokenId)
    if (!f) f = this.crowd.randomFrog(this.rnd)
    if (f) this.say(f, 'hmm')
  }

  ripple(x: number, y: number, strength = 1): void {
    if (!this.L) return
    const w = toWater(this.L, x, y)
    if (!w) return
    this.splashAt(w.x, w.z, strength, x, y)
  }

  setCoinTarget(fn: (() => { x: number; y: number } | null) | null): void {
    this.coinTarget = fn
  }

  setReducedMotion(v: boolean): void {
    if (v === this.reduced) return
    this.reduced = v
    if (v) {
      if (this.introOn) {
        this.introOn = false
        this.introP = 1
        for (const f of this.crowd?.frogs ?? []) f.wake = 1
        this.introDone()
      }
      this.sim?.calm()
      this.particles.clear()
      this.croaks.length = 0
      this.seeds.length = 0
      this.meteors.length = 0
      this.fish.length = 0
      this.rise = this.moonTarget.live ? 1 : 0
      this.riseFrom = this.rise
      for (const f of this.crowd?.frogs ?? []) f.appear = 1
      for (const b of [...this.bubbles.values()]) this.settleBubble(b)
    }
    this.kick()
    this.invalidate()
  }

  setQuietZone(rect: PondRect | null): void {
    const ok =
      !!rect && [rect.x, rect.y, rect.w, rect.h].every((v) => typeof v === 'number' && Number.isFinite(v)) && rect.w > 4 && rect.h > 4
    const q = ok ? { x: rect!.x, y: rect!.y, w: rect!.w, h: rect!.h } : null
    this.quiet = q
    // the fade follows at once; the pond's layout (fewer pads under the zone, more elsewhere) follows shortly
    this.crowd?.setQuiet(q)
    const key = q ? [q.x, q.y, q.w, q.h].map((v) => Math.round(v / 32)).join(',') : ''
    if (key !== this.quietKey) {
      this.quietKey = key
      if (this.quietTimer) window.clearTimeout(this.quietTimer)
      this.quietTimer = 0
      const early = this.clock() - this.bornAt < 900 || (this.introOn && this.introP < 0.35)
      if (early) this.buildCrowd()
      else
        this.quietTimer = window.setTimeout(() => {
          this.quietTimer = 0
          if (!this.disposed) this.buildCrowd()
        }, 260)
    }
    this.invalidate()
  }

  skipIntro(): void {
    if (!this.introOn || this.introSkipAt) return
    this.introSkipAt = this.clock()
    this.introSkipFrom = this.introP
    // no burst of wake-up croaks while hurrying
    this.introCroaks = 99
    this.introPlops = 99
    this.kick()
  }

  private introDone(): void {
    if (this.introDoneSent) return
    this.introDoneSent = true
    this.cb.onIntroDone?.()
  }

  /** Vertical offset of the whole scene while the intro's view glides down from the stars (0 at rest). */
  private introOffset(): number {
    if (this.introP >= 1 || !this.L) return 0
    const L = this.L
    const u = easeInOutCubic(clamp(this.introP / 0.8, 0, 1))
    return (1 - u) * (L.height - L.horizon + L.height * 0.22)
  }

  private updateIntro(): void {
    if (!this.introOn || !this.crowd || !this.L) return
    const now = this.clock()
    if (!this.introStart) this.introStart = now
    let p = (now - this.introStart) / INTRO_MS
    if (this.introSkipAt) {
      const u = clamp((now - this.introSkipAt) / INTRO_SKIP_MS, 0, 1)
      p = Math.max(p, lerp(this.introSkipFrom, 1, easeOutCubic(u)))
      if (u >= 1) p = 1
    }
    p = clamp(p, 0, 1)
    this.introP = p
    // a shooting star while we look at the sky
    if (p > 0.1 && p < 0.2 && !this.meteors.length && !this.introSkipAt) {
      const off = this.introOffset()
      this.spawnMeteor(this.L.width * (0.35 + this.rnd() * 0.3), -off + this.L.height * 0.22)
    }
    // the first ripples as the view arrives, and a few frogs say hmm as they wake
    const plops = [0.52, 0.63, 0.74, 0.85]
    while (this.introPlops < plops.length && p >= plops[this.introPlops]) {
      this.introPlops++
      const L = this.L
      const w = toWater(L, L.width * (0.2 + this.rnd() * 0.6), L.horizon + (L.height - L.horizon) * (0.35 + this.rnd() * 0.5))
      if (w && quietFactor(this.quiet, L.cx + (w.x * L.f) / w.z, L.horizon + (L.f * L.camH) / w.z) > 0.9) {
        this.sim?.splash(w.x, w.z, 0.04, 0.02)
        this.particles.droplets(w.x, w.z, 5, 0.6, this.rnd)
      }
    }
    const croaks = [0.6, 0.7, 0.8, 0.9]
    while (this.introCroaks < croaks.length && p >= croaks[this.introCroaks]) {
      this.introCroaks++
      const f = this.crowd.randomFrog(this.rnd, 7)
      if (f) {
        f.wake = Math.max(f.wake, 0.5)
        this.say(f, 'hmm')
        this.sound('croak', 0.25, f.sx, true)
      }
    }
    if (p >= 1) {
      this.introOn = false
      this.introP = 1
      for (const f of this.crowd.frogs) if (f.wake < 1) f.wake = Math.max(f.wake, 0.5)
      this.emitLayout(true)
      this.introDone()
    }
  }

  /** Emits a sound cue (rate-limited per kind; ambient cues are rarer and quiet). */
  private sound(kind: PondSoundKind, strength: number, x: number, ambient = false): void {
    const cb = this.cb.onSound
    if (!cb || !this.L) return
    const now = this.clock()
    if (now - this.lastSound[kind] < SOUND_GAP[kind]) return
    if (ambient) {
      const gap = kind === 'croak' ? 6000 : 140
      if (now - (kind === 'croak' ? this.lastAmbientSound : this.lastSound.plip) < gap) return
      if (kind === 'croak') this.lastAmbientSound = now
      strength = Math.min(strength, 0.3)
    }
    this.lastSound[kind] = now
    cb(kind, clamp(strength, 0, 1), clamp((x / this.L.width) * 2 - 1, -1, 1))
  }

  /** Lab/testing: run the simulation forward `seconds` in 60 Hz steps, then draw one frame. */
  advance(seconds: number): void {
    if (!this.L || !this.crowd || !this.sim || !this.flies) return
    const n = Math.max(1, Math.round(seconds * 60))
    for (let i = 0; i < n; i++) {
      this.timeShift += 1000 / 60
      if (!this.reduced) this.t += 1 / 60
      this.update(this.reduced ? 0 : 1 / 60, this.reduced)
    }
    this.render()
  }

  dispose(): void {
    this.disposed = true
    if (this.quietTimer) window.clearTimeout(this.quietTimer)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ro.disconnect()
    this.io?.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.wrap.removeEventListener('pointermove', this.onPointerMove)
    this.wrap.removeEventListener('pointerdown', this.onPointerDown)
    this.wrap.removeEventListener('pointerup', this.onPointerUp)
    this.wrap.removeEventListener('pointerleave', this.onPointerLeave)
    this.wrap.removeEventListener('pointercancel', this.onPointerLeave)
    this.water?.dispose()
    this.water2d?.dispose()
    this.wrap.remove()
  }

  /* ───────────────────────────── layout ───────────────────────────── */

  private capFor(L: Layout): number {
    if (L.width < 700) return 220
    return clamp(Math.round((L.width * L.height) / 2160), 320, 600)
  }

  private frogCount(): number {
    if (!this.crowd) return 0
    const cap = this.crowd.frogs.length
    if (this.online === null) return Math.round(cap * 0.5)
    return Math.min(cap, Math.max(0, this.online))
  }

  private resize(): void {
    if (this.disposed) return
    const r = this.container.getBoundingClientRect()
    const w = Math.round(r.width)
    const h = Math.round(r.height)
    if (w < 2 || h < 2) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (this.L && w === this.L.width && h === this.L.height && dpr === this.dpr) return
    this.dpr = dpr
    this.glMax = Math.min(dpr, 1.5)
    if (!this.L) this.glScale = this.glMax
    this.glScale = Math.min(this.glScale, this.glMax)
    const L = computeLayout(w, h)
    this.L = L
    this.bubbleR = BUBBLE_R_BASE * (L.portrait ? 0.78 : 1)
    this.budScale = L.portrait ? 0.82 : 1
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.water?.resize(w, h, this.glScale)
    this.water2d?.resize(w, h, Math.min(dpr, 1.5))
    const area = w * h
    this.sim = new WaveSim(L, area > 900_000 ? 44_000 : area > 420_000 ? 34_000 : 24_000)
    if (this.flies) this.flies.setLayout(L)
    else {
      this.flies = new Fireflies(L)
      this.flies.quiet = (x, y) => quietFactor(this.quiet, x, y, 0.1, 50)
    }
    this.reeds.build(L, mulberry32(77))
    this.buildCrowd()
    if (this.pendingQs) {
      const qs = this.pendingQs
      this.pendingQs = null
      this.setQuestions(qs)
    }
    this.emitLayout(true)
    this.invalidate()
  }

  /** (Re)lays the pond out for the current size and quiet zone, keeping counts, seats, the intro and the questions. */
  private buildCrowd(): void {
    const L = this.L
    if (!L) return
    this.crowd = new Crowd(L, this.capFor(L), SEED, this.quiet)
    this.crowd.clock = () => this.clock()
    this.crowd.setSeats(this.seats)
    this.crowd.setCount(this.frogCount(), true)
    if (this.introOn) for (const f of this.crowd.frogs) f.wake = this.introP >= f.wakeAt ? 1 : 0
    this.perf.frogs = this.crowd.count
    this.hopping.clear()
    this.hoverFrog = null
    this.croaks.length = 0
    this.seeds.length = 0
    this.relayoutQuestions()
    this.invalidate()
  }

  private relayoutQuestions(): void {
    const crowd = this.crowd
    if (!crowd) return
    for (const bud of this.buds.values()) {
      const pad = crowd.freePad(this.rnd)
      bud.pad = pad
      if (pad) {
        pad.bud = true
        bud.x = pad.x
        bud.z = pad.z
      } else this.randomSpot(bud)
    }
    for (const b of this.bubbles.values()) {
      b.slot = null
      const s = this.takeSlot(b.id)
      if (s) {
        b.x = s.x
        b.z = s.z
        b.slot = s
      } else this.randomSpot(b)
      if (b.state === 'float' || b.state === 'drop' || b.state === 'rise') this.pickPanel(b)
      else b.panel = []
    }
  }

  private emitLayout(force: boolean): void {
    const L = this.L
    if (!L || !this.cb.onLayout) return
    const m = this.moonScreen()
    m.y += this.introOffset()
    const key = `${L.width}|${L.height}|${Math.round(m.x)}|${Math.round(m.y)}|${Math.round(m.r)}`
    if (!force && key === this.layoutSent) return
    const now = performance.now()
    if (!force && now - this.layoutAt < 120) return
    this.layoutSent = key
    this.layoutAt = now
    this.cb.onLayout({ width: L.width, height: L.height, horizon: L.horizon + this.introOffset(), moon: { x: m.x, y: m.y, r: m.r } })
  }

  /* ───────────────────────────── loop ───────────────────────────── */

  private onVisibility = () => {
    this.visible = document.visibilityState !== 'hidden'
    this.kick()
  }

  private shouldRun(): boolean {
    return !this.disposed && !this.reduced && this.visible && this.onscreen
  }

  private kick(): void {
    if (this.disposed || this.raf) return
    if (this.shouldRun()) {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  /** Renders one frame soon even when the loop is paused (reduced motion). */
  private invalidate(): void {
    if (this.disposed || this.raf) return
    if (!this.visible) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    if (this.disposed || this.debug.paused) return
    const L = this.L
    if (!L || !this.crowd || !this.sim || !this.flies) {
      this.kick()
      return
    }
    const interval = Math.max(1, now - this.last)
    const dt = Math.min(0.05, interval / 1000)
    this.last = now
    const calm = this.reduced
    const c0 = performance.now()
    if (!calm) this.t += dt
    this.update(calm ? 0 : dt, calm)
    const u1 = performance.now()
    this.perf.updateMs += (u1 - c0 - this.perf.updateMs) * 0.1
    this.render()
    const cpu = performance.now() - c0
    this.perf.cpuMs += (cpu - this.perf.cpuMs) * 0.1
    this.frameEma += (interval - this.frameEma) * 0.08
    this.perf.frameMs = this.frameEma
    this.perf.particles = this.particles.count
    this.adaptResolution(interval)
    if (this.shouldRun()) this.raf = requestAnimationFrame(this.frame)
  }

  private adaptResolution(interval: number): void {
    if (!this.water || this.reduced || this.debug.fixedScale || !this.L) return
    if (interval > 200) return
    if (this.frameEma > 26) this.slowMs += interval
    else this.slowMs = 0
    if (this.frameEma < 18) this.fastMs += interval
    else this.fastMs = 0
    if (this.slowMs > 1500 && this.glScale > 0.56) {
      this.glScale = Math.max(0.55, this.glScale * 0.8)
      this.water.resize(this.L.width, this.L.height, this.glScale)
      this.slowMs = 0
    } else if (this.fastMs > 5000 && this.glScale < this.glMax) {
      this.glScale = Math.min(this.glMax, this.glScale * 1.15)
      this.water.resize(this.L.width, this.L.height, this.glScale)
      this.fastMs = 0
    }
    this.perf.glScale = this.glScale
  }

  /* ───────────────────────────── update ───────────────────────────── */

  private update(dt: number, calm: boolean): void {
    const sim = this.sim!
    const crowd = this.crowd!
    this.updateIntro()
    this.updateMoon(dt)
    if (!calm) {
      if (this.introP > 0.6) this.ambient()
      const s0 = performance.now()
      sim.update(dt)
      this.perf.simMs += (performance.now() - s0 - this.perf.simMs) * 0.1
    }
    // hops land with a splash
    for (const f of this.hopping) {
      const before = f.hopT
      if (before < 0) {
        this.hopping.delete(f)
        continue
      }
      if (before < 0.56 && before + dt >= 0.56) {
        sim.splash(f.pad.x, f.pad.z, 0.05, 0.012)
        this.particles.droplets(f.pad.x, f.pad.z, 7, 0.6, this.rnd)
        this.sound('plip', 0.3, f.sx)
      }
    }
    crowd.update(dt, this.t, this.rnd, this.introOn ? null : this.pointer, calm, this.clock(), this.introOn ? this.introP : 1)
    crowd.place(sim, this.t, calm)
    this.updateBuds(dt, calm)
    this.updateBubbles(dt, calm)
    this.updateSeeds(dt)
    this.updateFish(dt)
    this.flies!.update(dt, this.t, this.rnd, this.pointer, calm)
    this.particles.update(dt, sim)
    for (const c of this.croaks) c.t += dt
    this.croaks = this.croaks.filter((c) => c.t < c.dur)
    for (const m of this.meteors) m.t += dt
    this.meteors = this.meteors.filter((m) => m.t < m.max)
    for (const r of this.ripples2d) r.age += dt
    this.ripples2d = this.ripples2d.filter((r) => r.age < 2.4)
    this.flash = Math.max(0, this.flash - dt * 1.4)
  }

  private phaseFor(era: number): number {
    const lit = Math.pow(2, -Math.max(0, era))
    return Math.acos(clamp(2 * lit - 1, -1, 1))
  }

  private gladeFor(m: PondMoon): [number, number] {
    const pn = clamp(Math.log2(1 + Math.max(0, m.roundsInPot)) / Math.log2(65), 0, 1)
    const sigma = 0.045 + 0.085 * pn
    const gain = (0.55 + 1.25 * pn) * (m.live ? 1 : 0.28)
    return [sigma, gain]
  }

  private updateMoon(dt: number): void {
    const m = this.moonTarget
    const target = m.live ? 1 : 0
    if (this.reduced) this.rise = target
    else if (this.rise !== target) {
      // wall clock, not frame time: a slow device still sees the moon rise in a few seconds
      const u = clamp((this.clock() - this.riseAt) / RISE_MS, 0, 1)
      this.rise = lerp(this.riseFrom, target, u)
      if (u >= 1) this.rise = target
    }
    const ph = this.phaseFor(m.era)
    const [s, g] = this.gladeFor(m)
    if (this.reduced) {
      this.phase = ph
      this.gladeSigma = s
      this.gladeGain = g
    } else {
      this.phase = approach(this.phase, ph, dt, 0.7)
      this.gladeSigma = approach(this.gladeSigma, s, dt, 1.2)
      this.gladeGain = approach(this.gladeGain, g, dt, 1.2)
    }
    const e = easeInOutCubic(this.rise)
    const ringT = m.live ? smoothstep(0.72, 1, e) : 0
    // follows the (already smooth, wall-clock) rise directly
    this.ringAlpha = ringT
    const p = clamp(m.roundProgress, 0, 1)
    if (this.reduced || Math.abs(p - this.progress) > 0.2) this.progress = p
    else this.progress = approach(this.progress, p, dt, 0.25)
    this.emitLayout(false)
  }

  private moonScreen(): { x: number; y: number; r: number; e: number } {
    const L = this.L!
    const e = easeInOutCubic(this.rise)
    const r = L.moon.r * (1 + 0.14 * (1 - e))
    const yLow = L.horizon - L.moon.r * 0.32
    return { x: L.moon.x + (1 - e) * L.moon.r * 0.9, y: lerp(yLow, L.moon.y, e), r, e }
  }

  private roundTurned(): void {
    if (this.reduced || !this.L) return
    this.flash = 1
    const m = this.moonScreen()
    this.particles.sparks(m.x, m.y - m.r * 1.5, 10, palette.gold, 50, this.rnd)
    // a ring on the water under the moon
    const L = this.L
    const y = L.horizon + (L.horizon - m.y) * 0.9
    const w = toWater(L, m.x, Math.min(L.height - 4, y))
    if (w) this.sim?.splash(w.x, w.z, 0.09, 0.012)
  }

  private ambient(): void {
    const L = this.L!
    const t = this.t
    const rnd = this.rnd
    if (t > this.nextDrop) {
      // a raindrop, an insect touching down
      const y = L.horizon + 4 + Math.pow(rnd(), 1.6) * (L.height - L.horizon - 4)
      const w = toWater(L, rnd() * L.width, y)
      if (w) this.sim!.splash(w.x, w.z, 0.016 + rnd() * 0.018, 0.0016 + rnd() * 0.0028)
      this.nextDrop = t + 0.18 + rnd() * 0.65
    }
    if (t > this.nextCroak) {
      const f = this.crowd!.randomFrog(rnd)
      if (f && this.say(f, 'hmm')) this.sound('croak', 0.18 + rnd() * 0.1, f.sx, true)
      this.nextCroak = t + 0.9 + rnd() * 1.8
    }
    if (t > this.nextWorking) {
      const working = this.crowd!.frogs.filter((f) => f.active && f.working && f.pad.onScreen)
      if (working.length) this.say(working[Math.floor(rnd() * working.length)], 'dots')
      this.nextWorking = t + 2.5 + rnd() * 3
    }
    if (t > this.nextFish) {
      this.spawnFish()
      this.nextFish = t + 22 + rnd() * 40
    }
    if (t > this.nextMeteor) {
      this.spawnMeteor(rnd() * L.width, rnd() * L.horizon * 0.5)
      this.nextMeteor = t + 16 + rnd() * 34
    }
  }

  private say(f: Frog, kind: BubbleKind): boolean {
    if (this.reduced) return false
    if (this.croaks.length > 14) return false
    if (this.croaks.some((c) => c.frog === f)) return false
    if (this.quiet) {
      // no thought bubbles in the quiet zone: neither over the frog nor where the bubble would float
      const hb = clamp(f.fh * 0.9, 24, 54)
      const x0 = f.sx
      const y0 = f.sy - f.fh * 1.02 - hb
      if (quietFactor(this.quiet, f.sx, f.sy - f.fh, 0, 24) < 1) return false
      if (quietFactor(this.quiet, x0 + hb * 1.6, y0, 0, 24) < 1 || quietFactor(this.quiet, x0, y0, 0, 24) < 1) return false
    }
    this.croaks.push({ frog: f, kind, t: 0, dur: kind === 'hmm' ? 2.1 : 1.6 })
    // the croak shivers the water around the pad
    if (kind === 'hmm') this.sim?.splash(f.pad.x, f.pad.z, 0.035, 0.004)
    return true
  }

  private spawnFish(): void {
    const L = this.L!
    for (let tries = 0; tries < 10; tries++) {
      const z = 2.2 + this.rnd() * (L.portrait ? 4 : 6)
      const x = (this.rnd() * 2 - 1) * 0.8 * L.sHalf * z
      const nearPad = this.crowd!.pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 0.35)
      if (nearPad) continue
      const k = L.f / z
      if (quietFactor(this.quiet, L.cx + x * k, L.horizon + L.camH * k, 0, 40) < 1) continue
      this.fish.push({ x, z, t: 0, dur: 0.85, dir: this.rnd() < 0.5 ? -1 : 1, len: 0.42, splashed: 0 })
      return
    }
  }

  private spawnMeteor(x: number, y: number): void {
    if (this.reduced) return
    const dir = this.rnd() < 0.5 ? -1 : 1
    this.meteors.push({ x, y, dx: dir * (120 + this.rnd() * 140), dy: 50 + this.rnd() * 70, len: 50 + this.rnd() * 60, t: 0, max: 0.8 + this.rnd() * 0.5 })
  }

  private updateSeeds(dt: number): void {
    for (const s of this.seeds) {
      if (!s.landed) {
        s.vy -= 7 * dt
        s.y += s.vy * dt
        if (s.y <= 0.03) {
          s.landed = true
          s.y = 0.03
          this.sim?.splash(s.x, s.z, 0.05, 0.016)
          this.particles.droplets(s.x, s.z, 9, 0.75, this.rnd)
          project(this.L!, s.x, 0, s.z, this.pt)
          this.sound('plip', 0.3, this.pt.x)
          for (const f of s.frogs) this.say(f, 'ask')
        }
      } else s.t += dt
      project(this.L!, s.x, s.y, s.z, this.pt)
      for (const f of s.frogs) f.focus = { x: this.pt.x, y: this.pt.y }
    }
    const done = this.seeds.filter((s) => s.t > 2.6)
    for (const s of done) for (const f of s.frogs) if (!f.panel) f.focus = null
    this.seeds = this.seeds.filter((s) => s.t <= 2.6)
  }

  private updateFish(dt: number): void {
    for (const f of this.fish) {
      f.t += dt
      const u = f.t / f.dur
      const x0 = f.x - (f.dir * f.len) / 2
      if (f.splashed === 0) {
        f.splashed = 1
        this.sim?.splash(x0, f.z, 0.04, 0.012)
        this.particles.droplets(x0, f.z, 6, 0.6, this.rnd)
      }
      if (f.splashed === 1 && u >= 1) {
        f.splashed = 2
        const x1 = f.x + (f.dir * f.len) / 2
        this.sim?.splash(x1, f.z, 0.05, 0.016)
        this.particles.droplets(x1, f.z, 9, 0.7, this.rnd)
      }
    }
    this.fish = this.fish.filter((f) => f.t < f.dur + 0.05)
  }

  /* ───────────────────────────── questions ───────────────────────────── */

  private randomSpot(o: { x: number; z: number }): void {
    const L = this.L!
    for (let tries = 0; tries < 16; tries++) {
      o.z = 2.4 + this.rnd() * (L.portrait ? 2.5 : 3.6)
      o.x = (this.rnd() * 2 - 1) * 0.7 * L.sHalf * o.z
      const k = L.f / o.z
      if (quietFactor(this.quiet, L.cx + o.x * k, L.horizon + (L.camH - 0.2) * k, 0, 0.4 * k + 30) >= 1) return
    }
  }

  private takeSlot(id: string): Slot | null {
    const crowd = this.crowd
    if (!crowd) return null
    const free = crowd.slots.filter((s) => !s.used)
    if (!free.length) return null
    const s = free[Math.floor(this.rnd() * free.length)]
    s.used = id
    return s
  }

  private freeSlot(b: Bubble): void {
    if (b.slot && b.slot.used === b.id) b.slot.used = null
    b.slot = null
  }

  private pickPanel(b: Bubble): void {
    for (const f of b.panel) if (f.panel === b.id) this.releaseFrog(f, 0)
    const n = clamp(Math.round(b.q.panelSize ?? 5), 1, 12)
    b.panel = this.crowd!.nearest(b.x, b.z, n, (f) => f.panel !== null)
    for (const f of b.panel) {
      f.panel = b.id
      f.glowTarget = 0.9
      f.glowColor = 'lilac'
    }
  }

  private releaseFrog(f: Frog, glow: number): void {
    f.panel = null
    f.focus = null
    f.glowTarget = glow
  }

  /** Removes a bubble and gives back its panel and slot. */
  private dropBubble(id: string): void {
    const b = this.bubbles.get(id)
    if (!b) return
    for (const f of b.panel) if (f.panel === id) this.releaseFrog(f, 0)
    b.panel = []
    this.freeSlot(b)
    this.bubbles.delete(id)
  }

  /** A bubble's story is over: remove it if it is still the one on record for its id. */
  private finishBubble(b: Bubble): void {
    if (this.bubbles.get(b.id) === b) this.dropBubble(b.id)
  }

  private dropBud(id: string): void {
    const bud = this.buds.get(id)
    if (!bud) return
    if (bud.pad) bud.pad.bud = false
    this.buds.delete(id)
  }

  private newBubble(q: PondQuestion, state: BubbleState, at?: { x: number; z: number }): Bubble {
    this.dropBubble(q.id)
    const b: Bubble = {
      id: q.id,
      q,
      x: 0,
      z: 3,
      y: FLOAT_Y,
      vy: 0,
      state,
      t: 0,
      panel: [],
      slot: null,
      g: 0,
      c: 0,
      alpha: 1,
      squish: 0,
      spin: 0,
      y0: FLOAT_Y,
      from: null,
      hover: 0,
      hoverTarget: 0,
      nextDots: this.t + 0.8 + this.rnd() * 1.5,
      mine: !!q.mine,
      sx: 0,
      sy: 0,
      R: 0,
      k: 1,
    }
    if (at) {
      b.x = at.x
      b.z = at.z
    } else {
      const s = this.takeSlot(q.id)
      if (s) {
        b.slot = s
        b.x = s.x
        b.z = s.z
      } else this.randomSpot(b)
    }
    this.bubbles.set(q.id, b)
    return b
  }

  private newBud(q: PondQuestion, appear: number): Bud {
    this.dropBud(q.id)
    const crowd = this.crowd!
    const pad = crowd.freePad(this.rnd)
    const bud: Bud = {
      id: q.id,
      q,
      pad,
      x: 0,
      z: 3,
      raised: clamp(q.raised ?? 0, 0, 1),
      target: clamp(q.raised ?? 0, 0, 1),
      pulse: 0,
      appear,
      open: 0,
      state: appear >= 1 ? 'idle' : 'grow',
      t: 0,
      hover: 0,
      hoverTarget: 0,
      sx: 0,
      sy: 0,
      k: 1,
    }
    if (pad) {
      pad.bud = true
      bud.x = pad.x
      bud.z = pad.z
    } else this.randomSpot(bud)
    this.buds.set(q.id, bud)
    return bud
  }

  private spawnResting(q: PondQuestion): void {
    if (q.status === 'open') this.newBud(q, 1)
    else if (q.status === 'asked') {
      const b = this.newBubble(q, 'float')
      this.pickPanel(b)
    } else if (q.status === 'answered') this.flies!.add(q.id, q.order, this.rnd)
  }

  private spawnNew(q: PondQuestion): void {
    if (q.status === 'open') {
      const bud = this.newBud(q, 0)
      this.sim?.splash(bud.x, bud.z, 0.05, 0.012)
    } else if (q.status === 'asked') {
      const b = this.newBubble(q, 'drop')
      b.y = 2.6 + this.rnd() * 0.6
      b.vy = 0
      this.pickPanel(b)
    } else if (q.status === 'answered') {
      const z = 2.4 + this.rnd() * 3
      const x = (this.rnd() * 2 - 1) * 0.6 * this.L!.sHalf * z
      this.sim?.splash(x, z, 0.06, 0.02)
      this.particles.droplets(x, z, 12, 0.9, this.rnd)
      this.flies!.add(q.id, q.order, this.rnd, { x, y: 0.05, z })
    } else if (q.status === 'failed') {
      const z = 2.4 + this.rnd() * 3
      const x = (this.rnd() * 2 - 1) * 0.6 * this.L!.sHalf * z
      project(this.L!, x, 0.1, z, this.pt)
      this.particles.mist(this.pt.x, this.pt.y, 14, palette.coral, 40, this.rnd)
      this.sound('pop', 0.5, this.pt.x)
    }
  }

  private transition(prev: PondQuestion, q: PondQuestion): void {
    if (this.reduced) {
      this.removeVisual(prev.id)
      this.spawnResting(q)
      return
    }
    if (prev.status === 'open') {
      const bud = this.buds.get(q.id)
      const at = bud ? { x: bud.x, z: bud.z } : undefined
      if (bud) {
        bud.state = 'bloom'
        bud.t = 0
        bud.q = q
      }
      if (q.status === 'asked') {
        const b = this.newBubble(q, 'rise', at)
        b.y = 0.02
        b.vy = 1.5
        this.pickPanel(b)
        project(this.L!, b.x, 0, b.z, this.pt)
        this.sound('splash', 0.45, this.pt.x)
      } else if (q.status === 'answered') {
        const b = this.newBubble(q, 'coin', at)
        b.y = 0.05
        b.y0 = 0.05
        this.coinBurst(b)
        this.sound('chime', b.mine ? 1 : 0.75, this.pt.x)
      } else {
        if (bud) bud.state = 'sink'
        if (at) {
          project(this.L!, at.x, 0.08, at.z, this.pt)
          this.particles.mist(this.pt.x, this.pt.y, 16, palette.coral, 40, this.rnd)
        }
      }
      return
    }
    if (prev.status === 'asked') {
      const b = this.bubbles.get(q.id)
      if (!b) {
        this.spawnNew(q)
        return
      }
      b.q = q
      b.mine = !!q.mine
      if (q.status === 'answered') {
        // A panel bigger than the one we lit? light the extra frogs too.
        const n = clamp(Math.round(q.panelSize ?? 5), 1, 12)
        if (n > b.panel.length) {
          const extra = this.crowd!.nearest(b.x, b.z, n - b.panel.length, (f) => f.panel !== null)
          for (const f of extra) {
            f.panel = b.id
            f.glowTarget = 0.9
            f.glowColor = 'lilac'
            b.panel.push(f)
          }
        }
        b.state = 'converge'
        b.t = 0
      } else if (q.status === 'failed') {
        b.state = 'wobble'
        b.t = 0
        for (const f of b.panel) {
          f.glowColor = 'coral'
          f.glowTarget = 1
        }
      }
      return
    }
    // answered/failed are final; anything else: show the new state
    this.removeVisual(prev.id)
    this.spawnNew(q)
  }

  private removeVisual(id: string): void {
    this.dropBud(id)
    this.dropBubble(id)
    this.flies?.map.delete(id)
  }

  private removeQuestion(prev: PondQuestion): void {
    if (this.reduced) {
      this.removeVisual(prev.id)
      return
    }
    const bud = this.buds.get(prev.id)
    if (bud && bud.state !== 'sink') {
      bud.state = 'sink'
      bud.t = 0
    }
    const b = this.bubbles.get(prev.id)
    if (b && (b.state === 'float' || b.state === 'drop' || b.state === 'rise')) {
      b.state = 'leave'
      b.t = 0
    }
    this.flies?.leave(prev.id)
  }

  private capFireflies(): void {
    const flies = this.flies
    if (!flies) return
    const live = [...flies.map.values()].filter((f) => !f.leaving)
    if (live.length <= MAX_FIREFLIES) return
    live.sort((a, b) => a.order - b.order)
    for (let i = 0; i < live.length - MAX_FIREFLIES; i++) {
      if (this.reduced) flies.map.delete(live[i].id)
      else flies.leave(live[i].id)
    }
  }

  private settleBubble(b: Bubble): void {
    if (b.state === 'drop' || b.state === 'rise') {
      b.state = 'float'
      b.y = FLOAT_Y
      b.vy = 0
    } else if (b.state !== 'float') {
      const q = b.q
      this.removeVisual(b.id)
      if (q.status === 'answered' && !this.flies!.map.has(q.id)) this.flies!.add(q.id, q.order, this.rnd)
    }
  }

  private budPulse(bud: Bud): void {
    bud.pulse = 1
    this.sim?.splash(bud.x, bud.z, 0.05, 0.01)
    project(this.L!, bud.x, 0.08, bud.z, this.pt)
    this.particles.sparks(this.pt.x, this.pt.y - 10, 8, palette.gold, 40, this.rnd)
  }

  private coinBurst(b: Bubble): void {
    this.sim?.splash(b.x, b.z, 0.07, 0.03)
    this.particles.droplets(b.x, b.z, 18, 1, this.rnd)
    project(this.L!, b.x, 0.12, b.z, this.pt)
    this.particles.sparks(this.pt.x, this.pt.y, 12, palette.gold, 70, this.rnd)
  }

  private updateBuds(dt: number, calm: boolean): void {
    for (const bud of [...this.buds.values()]) {
      bud.t += dt
      bud.hover += (bud.hoverTarget - bud.hover) * Math.min(1, dt * 10)
      bud.pulse = Math.max(0, bud.pulse - dt * 1.6)
      bud.raised = calm ? bud.target : approach(bud.raised, bud.target, dt, 0.35)
      if (bud.state === 'grow') {
        bud.appear = Math.min(1, bud.t / 0.7)
        if (bud.t >= 0.7) bud.state = 'idle'
      } else if (bud.state === 'bloom') {
        bud.open = easeOutCubic(bud.t / 0.6)
        if (bud.t > 0.6) bud.appear = Math.max(0, 1 - (bud.t - 0.6) / 1.4)
        if (bud.t > 2.0) this.removeBud(bud)
      } else if (bud.state === 'sink') {
        bud.appear = Math.max(0, bud.appear - dt / 0.8)
        if (bud.appear <= 0) this.removeBud(bud)
      }
      if (bud.pad) {
        bud.sx = bud.pad.sx
        bud.sy = bud.pad.sy
        bud.k = bud.pad.k
      } else {
        const h = this.sim ? this.sim.heightAt(bud.x, bud.z) * 2.4 : 0
        project(this.L!, bud.x, h, bud.z, this.pt)
        bud.sx = this.pt.x
        bud.sy = this.pt.y
        bud.k = this.pt.k
      }
    }
  }

  private removeBud(bud: Bud): void {
    // a bud replaced by a newer one for the same id already gave its pad back
    if (this.buds.get(bud.id) === bud) this.dropBud(bud.id)
  }

  private updateBubbles(dt: number, calm: boolean): void {
    const L = this.L!
    const sim = this.sim!
    for (const b of [...this.bubbles.values()]) {
      b.t += dt
      b.hover += (b.hoverTarget - b.hover) * Math.min(1, dt * 10)
      switch (b.state) {
        case 'drop': {
          b.vy -= 7.5 * dt
          b.y += b.vy * dt
          if (b.y <= FLOAT_Y) {
            b.y = FLOAT_Y
            b.vy = -b.vy * 0.18
            b.state = 'float'
            sim.splash(b.x, b.z, 0.12, 0.085)
            this.particles.droplets(b.x, b.z, 30, 1.2, this.rnd)
            this.sound('splash', 0.9, b.sx)
          }
          break
        }
        case 'rise': {
          b.vy -= 3 * dt
          b.y += b.vy * dt
          if (b.vy < 0 && b.y <= FLOAT_Y + 0.02) b.state = 'float'
          break
        }
        case 'float':
        case 'leave': {
          const target = FLOAT_Y + sim.heightAt(b.x, b.z) * 2.4 + (calm ? 0 : 0.012 * Math.sin(this.t * 1.4 + b.x))
          if (calm) b.y = target
          else {
            b.vy += (target - b.y) * 28 * dt
            b.vy *= Math.exp(-dt * 4)
            b.y += b.vy * dt
          }
          if (b.state === 'float' && !calm && this.t > b.nextDots && b.panel.length) {
            this.say(b.panel[Math.floor(this.rnd() * b.panel.length)], 'dots')
            b.nextDots = this.t + 1.1 + this.rnd() * 1.6
          }
          if (b.state === 'leave') {
            b.alpha = Math.max(0, 1 - b.t / 0.8)
            if (b.t > 0.8) this.finishBubble(b)
          }
          break
        }
        case 'converge': {
          const u = clamp(b.t / 0.95, 0, 1)
          b.g = easeInOutCubic(u)
          for (const f of b.panel) {
            f.glowColor = u > 0.4 ? 'gold' : 'lilac'
            f.glowTarget = 1
          }
          if (b.t >= 0.95) {
            b.state = 'coin'
            b.t = 0
            b.y0 = b.y
            b.vy = 0
            this.coinBurst(b)
            this.sound('chime', b.mine ? 1 : 0.75, b.sx)
            const panel = b.panel
            b.panel = []
            panel.forEach((f, i) => {
              this.releaseFrog(f, 0)
              f.glowColor = 'gold'
              f.glow = 1
              window.setTimeout(() => {
                if (!this.disposed && f.hopT < 0) {
                  this.crowd?.hop(f)
                  this.hopping.add(f)
                }
              }, 60 + i * 70)
            })
            this.freeSlot(b)
          }
          break
        }
        case 'coin': {
          const u = clamp(b.t / 0.65, 0, 1)
          b.y = lerp(b.y0, Math.max(b.y0 + 0.3, 0.62), easeOutCubic(u))
          b.spin += dt * 11
          if (u >= 1) {
            const target = b.mine && this.coinTarget ? this.coinTarget() : null
            project(L, b.x, b.y, b.z, this.pt)
            if (target) {
              b.state = 'fly'
              b.from = { x: this.pt.x, y: this.pt.y }
            } else {
              b.state = 'fade'
              this.flies!.add(b.id, b.q.order, this.rnd, { x: b.x, y: b.y, z: b.z })
            }
            b.t = 0
          }
          break
        }
        case 'fly': {
          b.spin += dt * 14
          const u = clamp(b.t / 1.05, 0, 1)
          const target = (this.coinTarget && this.coinTarget()) || { x: L.width - 40, y: 24 }
          const p = this.coinPath(b, target, easeInOutCubic(u))
          if (this.rnd() < 0.7) this.particles.sparks(p.x, p.y, 1, palette.gold, 18, this.rnd)
          if (u >= 1) {
            this.particles.sparks(target.x, target.y, 16, palette.gold, 90, this.rnd)
            this.cb.onCoinLanded?.(b.id)
            this.flies!.add(b.id, b.q.order, this.rnd, { x: b.x, y: 0.1, z: b.z })
            this.finishBubble(b)
          }
          break
        }
        case 'fade': {
          b.spin += dt * 6
          b.alpha = Math.max(0, 1 - b.t / 0.6)
          if (b.t > 0.6) this.finishBubble(b)
          break
        }
        case 'wobble': {
          const u = clamp(b.t / 0.8, 0, 1)
          b.c = easeOutCubic(u)
          b.squish = Math.sin(b.t * 30) * 0.13 * u
          if (b.t >= 0.8) {
            project(L, b.x, b.y + this.bubbleR, b.z, this.pt)
            const R = this.bubbleR * this.pt.k
            this.particles.mist(this.pt.x, this.pt.y, 34, palette.coral, R * 3.2, this.rnd, R * 0.55)
            this.particles.ring(this.pt.x, this.pt.y, R, palette.coral)
            this.particles.sparks(this.pt.x, this.pt.y, 8, palette.coral, R * 2.6, this.rnd)
            sim.splash(b.x, b.z, 0.06, 0.02)
            this.particles.droplets(b.x, b.z, 10, 0.8, this.rnd)
            this.sound('pop', 0.85, this.pt.x)
            for (const f of b.panel) this.releaseFrog(f, 0)
            this.freeSlot(b)
            this.finishBubble(b)
          }
          break
        }
      }
      // screen placement
      project(L, b.x, b.y + this.bubbleR, b.z, this.pt)
      b.sx = this.pt.x
      b.sy = this.pt.y
      b.k = this.pt.k
      b.R = this.bubbleR * this.pt.k
      if (b.state === 'float' || b.state === 'drop' || b.state === 'rise' || b.state === 'converge' || b.state === 'wobble')
        for (const f of b.panel) f.focus = { x: b.sx, y: b.sy }
    }
  }

  private coinPath(b: Bubble, target: { x: number; y: number }, u: number): { x: number; y: number } {
    const a = b.from ?? { x: b.sx, y: b.sy }
    const c = { x: lerp(a.x, target.x, 0.35), y: Math.min(a.y, target.y) - 140 }
    const q = 1 - u
    return { x: q * q * a.x + 2 * q * u * c.x + u * u * target.x, y: q * q * a.y + 2 * q * u * c.y + u * u * target.y }
  }

  /* ───────────────────────────── render ───────────────────────────── */

  private render(): void {
    const L = this.L!
    const sim = this.sim!
    const m = this.moonScreen()
    const mo = moonAt(L, m.x, m.y, m.r)
    const off = this.introOffset()
    const introMoon = this.introOn ? 0.3 + 0.7 * smoothstep(0.12, 0.9, this.introP) : 1
    // the intro's view glides down from the stars: everything sits `off` px lower until it arrives
    const Lv: Layout = off ? { ...L, horizon: L.horizon + off } : L
    const w0 = performance.now()
    if (this.water) {
      if (sim.stepped || !this.renderedOnce) {
        if (!this.renderedOnce) sim.computeGradients()
        this.water.uploadSim(sim)
        sim.stepped = false
      }
      this.water.render(Lv, sim, {
        time: this.reduced ? 12 : this.t,
        phase: this.phase,
        moonBright: (0.42 + 0.58 * m.e) * introMoon,
        moonWarm: Math.pow(1 - m.e, 0.8),
        moonDir: mo.dir,
        moonAng: mo.ang,
        gladeSigma: this.gladeSigma * (L.portrait ? 0.62 : 1),
        gladeGain: this.gladeGain * (0.4 + 0.6 * ((1 + Math.cos(this.phase)) / 2)) * (L.portrait ? 0.75 : 1),
        lit: (1 + Math.cos(this.phase)) / 2,
        rippleGain: 1,
        wind: this.reduced ? 0.35 : 1,
        moonPx: [m.x, m.y + off, m.r],
      })
      this.renderedOnce = true
    } else if (this.water2d) {
      this.water2d.render(Lv, {
        time: this.t,
        litFraction: (1 + Math.cos(this.phase)) / 2,
        moonX: m.x,
        moonY: m.y + off,
        moonR: m.r,
        moonBright: (0.42 + 0.58 * m.e) * introMoon,
        moonWarm: 1 - m.e,
        glade: clamp((this.gladeGain - 0.4) / 1.4, 0, 1),
        ripples: this.ripples2d,
      })
    }

    const w1 = performance.now()
    this.perf.waterMs += (w1 - w0 - this.perf.waterMs) * 0.1
    const ctx = this.ctx
    const dpr = this.canvas.width / L.width
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, L.width, L.height)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    if (off) ctx.translate(0, off)

    // the moon, crisp at device resolution, behind the tree line when it sits low
    this.drawMoon(ctx, m, dpr, (0.42 + 0.58 * m.e) * introMoon)

    // reflections on the water
    ctx.globalCompositeOperation = 'lighter'
    this.flies!.drawReflections(ctx, this.t)
    for (const b of this.bubbles.values()) {
      if (b.state === 'fly' || b.state === 'fade') continue
      project(L, b.x, -(b.y + this.bubbleR), b.z, this.pt)
      if (this.pt.y <= L.horizon) continue
      const col = questionColor(b.g, b.c)
      const r = b.R * 1.5
      ctx.globalAlpha = 0.28 * b.alpha
      ctx.drawImage(glowSprite(`#${col.map((v) => v.toString(16).padStart(2, '0')).join('')}`, 0.15), this.pt.x - r, this.pt.y - r * 1.4, r * 2, r * 2.8)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    // the crowd, with buds and bubbles slotted in by depth
    type Ins = { z: number; draw: () => void }
    const inserts: Ins[] = []
    for (const bud of this.buds.values()) {
      inserts.push({
        z: bud.z,
        draw: () =>
          drawBud(ctx, L, bud.sx, bud.sy, bud.z, bud.k * this.budScale, bud.raised, bud.open, bud.pulse, bud.hover,
            easeOutBack(bud.appear) > 0 ? Math.min(1, bud.appear * 1.4) : 0, this.t),
      })
    }
    for (const b of this.bubbles.values()) {
      if (b.state === 'coin' || b.state === 'fly' || b.state === 'fade') continue
      inserts.push({
        z: b.z - 0.001,
        draw: () => {
          const grow = b.state === 'converge' ? 1 - 0.45 * b.g : 1
          drawBubble(ctx, b.sx, b.sy, b.R * grow * (1 + 0.12 * b.hover), b.g, b.c, this.t, b.alpha, b.squish)
        },
      })
    }
    for (const s of this.seeds) {
      inserts.push({
        z: s.z,
        draw: () => {
          project(L, s.x, s.y + 0.035, s.z, this.pt)
          const a = s.landed ? Math.max(0, 1 - s.t / 1.2) : 1
          drawBubble(ctx, this.pt.x, this.pt.y, 0.035 * this.pt.k, 0, 0, this.t, a)
        },
      })
    }
    inserts.sort((a, b) => b.z - a.z)
    let ii = 0
    this.crowd!.draw(ctx, dpr, this.t, sim, (z) => {
      while (ii < inserts.length && (z < 0 || inserts[ii].z > z)) {
        inserts[ii].draw()
        ii++
      }
    })

    // fish
    for (const f of this.fish) this.drawFish(ctx, f)

    // frog glows (panels, working seats, afterglow)
    ctx.globalCompositeOperation = 'lighter'
    for (const f of this.crowd!.frogs) {
      if (!f.active || !f.pad.onScreen) continue
      const work = f.working ? 0.35 : 0
      const g = Math.max(f.glow, work)
      if (g < 0.02) continue
      const col = f.glow >= work ? (f.glowColor === 'gold' ? palette.gold : f.glowColor === 'coral' ? palette.coral : palette.lilac) : palette.lilac
      const r = Math.max(10, f.fh * 1.25)
      ctx.globalAlpha = g * (0.55 + 0.12 * Math.sin(this.t * 3 + f.index))
      ctx.drawImage(glowSprite(col, 0.12), f.sx - r, f.sy - f.fh * 0.5 - r, r * 2, r * 2)
      if (f.glow < 0.02 && f.glowTarget === 0 && f.glowColor !== 'lilac') f.glowColor = 'lilac'
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    // thought lines
    for (const b of this.bubbles.values()) {
      if (!b.panel.length) continue
      if (b.state !== 'float' && b.state !== 'converge' && b.state !== 'wobble' && b.state !== 'drop' && b.state !== 'rise') continue
      const heads = b.panel.map((f) => Crowd.head(f))
      const alpha = b.state === 'drop' ? clamp(1 - (b.y - FLOAT_Y) / 1.2, 0, 1) : b.state === 'wobble' ? 1 - b.c * 0.6 : b.alpha
      drawThoughtLines(ctx, heads, { x: b.sx, y: b.sy }, this.t, questionColor(b.g, b.c), alpha, b.state === 'converge' ? b.g : 0,
        b.state === 'converge' ? 1.6 : 0.45)
    }

    this.particles.draw(ctx, L)
    this.drawCroaks(ctx)

    ctx.globalCompositeOperation = 'lighter'
    this.flies!.draw(ctx, this.t)
    ctx.globalCompositeOperation = 'source-over'

    // coins
    for (const b of this.bubbles.values()) {
      if (b.state === 'coin' || b.state === 'fade') {
        project(L, b.x, b.y, b.z, this.pt)
        const R = Math.max(7, 0.075 * this.pt.k) * (b.state === 'fade' ? 1 - 0.6 * (1 - b.alpha) : 1)
        drawCoin(ctx, this.pt.x, this.pt.y, R, b.spin, b.alpha)
      } else if (b.state === 'fly') {
        const u = easeInOutCubic(clamp(b.t / 1.05, 0, 1))
        const target = (this.coinTarget && this.coinTarget()) || { x: L.width - 40, y: 24 }
        const p = this.coinPath(b, target, u)
        const R0 = Math.max(8, 0.075 * b.k)
        drawCoin(ctx, p.x, p.y, R0 * (1 - 0.4 * u), b.spin, 1)
      }
    }

    this.reeds.draw(ctx, this.t, this.reduced)

    // the moon's round ring
    drawRing(ctx, m.x, m.y, m.r, this.progress, this.ringAlpha, this.flash)
    for (const me of this.meteors) drawMeteor(ctx, me)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    this.perf.drawMs += (performance.now() - w1 - this.perf.drawMs) * 0.1
  }

  private renderedOnce = false
  private treeCache: { key: string; path: Path2D | null; top: number } = { key: '', path: null, top: 0 }

  /** Sky above the tree line between x0 and x1 (a clip path), and the highest tree top there. */
  private skyAboveTrees(x0: number, x1: number): { path: Path2D; top: number } {
    const L = this.L!
    const key = `${Math.round(x0)}|${Math.round(x1)}|${L.width}|${L.height}`
    if (this.treeCache.key !== key || !this.treeCache.path) {
      const k = L.f / L.zShore
      const path = new Path2D()
      path.moveTo(x0, -1e5)
      let top = Infinity
      for (let x = x0; x <= x1 + 1.5; x += 1.5) {
        const y = L.horizon - (treeHeight((x - L.cx) / L.f) - L.camH) * k
        top = Math.min(top, y)
        path.lineTo(x, y)
      }
      path.lineTo(x1 + 1.5, -1e5)
      path.closePath()
      this.treeCache = { key, path, top }
    }
    return { path: this.treeCache.path!, top: this.treeCache.top }
  }

  private drawMoon(ctx: CanvasRenderingContext2D, m: { x: number; y: number; r: number; e: number }, dpr: number, bright: number): void {
    const L = this.L!
    const R = m.r
    const lit = (1 + Math.cos(this.phase)) / 2
    const warm = Math.pow(1 - m.e, 0.8)
    const Rd = Math.max(4, Math.round(L.moon.r * 1.14 * dpr))
    const spr = this.moonPainter.paint(Rd, this.phase)
    const scale = R / Rd
    const half = (spr.width / 2) * scale
    const G = R * 3.6
    ctx.save()
    const sky = this.skyAboveTrees(m.x - G, m.x + G)
    if (m.y + G > sky.top) ctx.clip(sky.path)
    ctx.save()
    ctx.drawImage(spr, m.x - half, m.y - half, half * 2, half * 2)
    if (warm > 0.01 || bright < 0.995) {
      ctx.beginPath()
      ctx.arc(m.x, m.y, R + 1, 0, Math.PI * 2)
      ctx.clip()
      ctx.globalCompositeOperation = 'source-atop'
      if (warm > 0.01) {
        ctx.fillStyle = `rgba(250,176,108,${0.5 * warm})`
        ctx.fillRect(m.x - R - 1, m.y - R - 1, R * 2 + 2, R * 2 + 2)
      }
      if (bright < 0.995) {
        ctx.fillStyle = `rgba(10,14,18,${(1 - bright) * 0.9})`
        ctx.fillRect(m.x - R - 1, m.y - R - 1, R * 2 + 2, R * 2 + 2)
      }
    }
    ctx.restore()
    // a soft, wide glow at full resolution
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.17 * bright * (0.35 + 0.65 * lit)
    ctx.drawImage(glowSprite(warm > 0.5 ? '#f6c48a' : palette.moon, 0.05), m.x - G, m.y - G, G * 2, G * 2)
    ctx.restore()
  }

  private drawFish(ctx: CanvasRenderingContext2D, f: Fish): void {
    const u = clamp(f.t / f.dur, 0, 1)
    const x = f.x + f.dir * f.len * (u - 0.5)
    const y = 4 * 0.2 * u * (1 - u)
    project(this.L!, x, y, f.z, this.pt)
    const k = this.pt.k
    const ang = Math.atan2(-(0.8 * (1 - 2 * u)), f.dir * f.len) * 0.9
    ctx.save()
    ctx.translate(this.pt.x, this.pt.y)
    ctx.rotate(f.dir > 0 ? -ang : ang)
    ctx.scale(f.dir, 1)
    const L = 0.1 * k
    ctx.fillStyle = '#0a1414'
    ctx.beginPath()
    ctx.ellipse(0, 0, L * 0.5, L * 0.16, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-L * 0.42, 0)
    ctx.lineTo(-L * 0.72, -L * 0.16)
    ctx.lineTo(-L * 0.72, L * 0.16)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(243,234,211,0.35)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.ellipse(0, -L * 0.03, L * 0.46, L * 0.12, 0, Math.PI * 1.1, Math.PI * 1.9)
    ctx.stroke()
    ctx.restore()
  }

  private drawCroaks(ctx: CanvasRenderingContext2D): void {
    for (const c of this.croaks) {
      const f = c.frog
      if (!f.active || !f.pad.onScreen) continue
      const spr = bubbleSprite(c.kind)
      const hb = clamp(f.fh * 0.9, 24, 54)
      const s = easeOutBack(clamp(c.t / 0.28, 0, 1))
      const fade = clamp((c.dur - c.t) / 0.45, 0, 1)
      const w = (spr.width / BUBBLE_H) * hb * s
      const h = hb * s
      const x = f.sx + f.fh * 0.22
      const y = f.sy - f.fh * 1.02 - h - c.t * 5
      ctx.globalAlpha = fade * 0.95
      ctx.drawImage(spr, x, y, w, h)
    }
    ctx.globalAlpha = 1
  }

  /* ───────────────────────────── input ───────────────────────────── */

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.wrap.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private onPointerMove = (e: PointerEvent) => {
    const p = this.local(e)
    this.pointer = p
    if (this.introOn) return
    // a faint trail of ripples follows the cursor across the water (mouse and pen only, never touch scrolling)
    if (!this.down && e.pointerType !== 'touch' && !this.reduced && this.L) {
      const now = this.clock()
      const lt = this.lastTrail
      if (!lt || (now - lt.t > 45 && Math.hypot(p.x - lt.x, p.y - lt.y) > 10)) {
        const w = toWater(this.L, p.x, p.y)
        if (w) this.sim?.splash(w.x, w.z, Math.max(0.026, 0.007 * w.z), 0.0055)
        this.lastTrail = { x: p.x, y: p.y, t: now }
      }
    }
    if (this.down) {
      const moved = Math.hypot(p.x - this.down.x, p.y - this.down.y)
      if (moved > 7) this.dragging = true
      if (this.dragging && !this.reduced && this.L) {
        const last = this.lastWake ?? this.down
        if (Math.hypot(p.x - last.x, p.y - last.y) > 14) {
          const w = toWater(this.L, p.x, p.y)
          if (w) this.sim?.splash(w.x, w.z, 0.03, 0.006)
          this.lastWake = p
        }
      }
    }
    this.updateHover(p)
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== undefined && e.button > 0) return
    if (this.introOn) {
      this.skipIntro()
      this.down = null
      return
    }
    const p = this.local(e)
    this.down = { x: p.x, y: p.y, t: performance.now() }
    this.dragging = false
    this.lastWake = null
  }

  private onPointerUp = (e: PointerEvent) => {
    const p = this.local(e)
    const d = this.down
    this.down = null
    if (!d) return
    if (Math.hypot(p.x - d.x, p.y - d.y) < 9 && performance.now() - d.t < 800) this.click(p.x, p.y)
    this.dragging = false
  }

  private onPointerLeave = () => {
    if (this.hoverFrog && !this.hoverFrog.panel) this.hoverFrog.glowTarget = 0
    this.hoverFrog = null
    this.pointer = null
    this.down = null
    this.dragging = false
    this.setHover(null, '')
  }

  private updateHover(p: { x: number; y: number }): void {
    const pick = this.pickAt(p.x, p.y)
    let key = ''
    if (pick) {
      key = pick.kind
      if (pick.kind === 'frog') key += pick.index
      else if (pick.kind === 'firefly' || pick.kind === 'bud' || pick.kind === 'bubble') key += pick.id
    }
    // hover visuals
    for (const f of this.flies?.map.values() ?? []) f.hoverTarget = pick?.kind === 'firefly' && pick.id === f.id ? 1 : 0
    for (const b of this.buds.values()) b.hoverTarget = pick?.kind === 'bud' && pick.id === b.id ? 1 : 0
    for (const b of this.bubbles.values()) b.hoverTarget = pick?.kind === 'bubble' && pick.id === b.id ? 1 : 0
    const hf = pick?.kind === 'frog' ? (this.crowd?.frogs[pick.index] ?? null) : null
    if (hf !== this.hoverFrog) {
      if (this.hoverFrog && !this.hoverFrog.panel) this.hoverFrog.glowTarget = 0
      if (hf && !hf.panel) {
        hf.glowColor = 'lilac'
        hf.glowTarget = 0.5
      }
      this.hoverFrog = hf
    }
    const thing = pick && pick.kind !== 'water'
    this.wrap.style.cursor = thing ? 'pointer' : ''
    this.setHover(pick && pick.kind !== 'water' ? pick : null, thing ? key : '')
    if (this.reduced) this.invalidate()
  }

  private setHover(pick: PondPick | null, key: string): void {
    if (key === this.hoverKey) return
    this.hoverKey = key
    this.cb.onHover?.(pick)
  }

  private pickAt(x: number, y: number): PondPick | null {
    const L = this.L
    if (!L || !this.crowd || !this.flies) return null
    const fly = this.flies.pick(x, y)
    if (fly) return { kind: 'firefly', id: fly.id, x: fly.sx, y: fly.sy }
    for (const b of this.bubbles.values()) {
      if (b.state === 'fly' || b.state === 'fade' || b.state === 'coin') continue
      if (Math.hypot(x - b.sx, y - b.sy) < Math.max(14, b.R * 1.35)) return { kind: 'bubble', id: b.id, x: b.sx, y: b.sy }
    }
    for (const bud of this.buds.values()) {
      if (bud.state === 'sink' || bud.state === 'bloom') continue
      const h = 0.24 * bud.k * this.budScale
      const cy = bud.sy - h * 0.45
      if (Math.hypot(x - bud.sx, y - cy) < Math.max(14, h * 0.75)) return { kind: 'bud', id: bud.id, x: bud.sx, y: cy }
    }
    const frog = this.crowd.pick(x, y)
    if (frog) {
      const h = Crowd.head(frog)
      return { kind: 'frog', index: frog.index, seat: frog.seat, x: h.x, y: h.y }
    }
    const m = this.moonScreen()
    if (Math.hypot(x - m.x, y - m.y) < m.r * 1.6) return { kind: 'moon', x: m.x, y: m.y }
    if (y > L.horizon + 2 && toWater(L, x, y)) return { kind: 'water', x, y }
    return null
  }

  private click(x: number, y: number): void {
    const pick = this.pickAt(x, y)
    const L = this.L
    if (!L) return
    if (!pick) {
      // the sky: a wish
      if (y < L.horizon) this.spawnMeteor(x - 40, y - 30)
      this.invalidate()
      return
    }
    const calm = this.reduced
    switch (pick.kind) {
      case 'firefly':
        if (!calm) this.particles.sparks(pick.x, pick.y, 10, palette.gold, 60, this.rnd)
        break
      case 'bubble': {
        const b = this.bubbles.get(pick.id)
        if (b && !calm) {
          b.vy += 0.5
          this.particles.sparks(pick.x, pick.y, 8, palette.lilac, 50, this.rnd)
        }
        break
      }
      case 'bud': {
        const bud = this.buds.get(pick.id)
        if (bud && !calm) bud.pulse = Math.max(bud.pulse, 0.6)
        break
      }
      case 'frog': {
        const f = this.crowd!.frogs[pick.index]
        if (f && !calm) {
          this.crowd!.hop(f)
          this.hopping.add(f)
          this.say(f, 'hmm')
        }
        this.sound('croak', 0.85, pick.x)
        break
      }
      case 'moon': {
        if (!calm) {
          this.flash = 1
          this.particles.sparks(pick.x, pick.y, 14, palette.moon, 70, this.rnd)
        }
        break
      }
      case 'water': {
        const w = toWater(L, x, y)
        this.sound('plip', 0.55, x)
        if (w && !calm) {
          this.splashAt(w.x, w.z, 1, x, y)
          const frogs = this.crowd!.nearest(w.x, w.z, 5, (f) => f.panel !== null)
          this.seeds.push({ x: w.x, z: w.z, y: 0.55, vy: 0, t: 0, landed: false, frogs })
        }
        break
      }
    }
    this.cb.onPick?.(pick)
    this.invalidate()
  }

  private splashAt(x: number, z: number, strength: number, sx: number, sy: number): void {
    if (this.reduced) return
    const s = clamp(strength, 0.1, 3)
    const r = Math.max(0.05, 0.012 * z) * (0.7 + 0.3 * s)
    this.sim?.splash(x, z, r, 0.055 * s)
    this.particles.droplets(x, z, Math.round(10 * s), 0.8 + 0.2 * s, this.rnd)
    if (this.water2d) this.ripples2d.push({ x: sx, y: sy, age: 0, strength: s })
  }
}
