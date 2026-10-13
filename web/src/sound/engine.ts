/**
 * The pond's sounds, synthesized with WebAudio (no audio files): a soft night ambience (water and a few crickets),
 * a small croak when a frog is poked, a plip on taps, a splash when a question lands, a warm chime when a coin
 * rises, and a soft pop for mist. Off by default; the choice is remembered. Everything is quiet on purpose.
 */

export type SoundKind = 'croak' | 'plip' | 'splash' | 'chime' | 'pop'

const KEY = 'hmm.sound'
const MIN_GAP: Record<SoundKind, number> = { croak: 0.12, plip: 0.05, splash: 0.2, chime: 0.15, pop: 0.1 }

type Ctx = AudioContext

class PondSound {
  enabled = false
  private ctx: Ctx | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private ambience: (() => void) | null = null
  private last: Partial<Record<SoundKind, number>> = {}
  private listeners = new Set<() => void>()
  private armed = false

  constructor() {
    if (typeof window === 'undefined') return
    try {
      this.enabled = localStorage.getItem(KEY) === 'on'
    } catch {
      this.enabled = false
    }
    // Browsers only start audio from a user gesture: if it was left on, start at the first one.
    if (this.enabled) this.armGesture()
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) void this.ctx.suspend()
      else if (this.enabled) void this.ctx.resume()
    })
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getEnabled = () => this.enabled

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private armGesture() {
    if (this.armed) return
    this.armed = true
    const start = () => {
      window.removeEventListener('pointerdown', start, true)
      window.removeEventListener('keydown', start, true)
      this.armed = false
      if (this.enabled) this.start()
    }
    window.addEventListener('pointerdown', start, true)
    window.addEventListener('keydown', start, true)
  }

  /** Call from a click handler (a user gesture). */
  setEnabled(on: boolean) {
    this.enabled = on
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off')
    } catch {
      /* private mode */
    }
    if (on) this.start()
    else this.stop()
    this.emit()
  }

  private start() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!this.ctx) {
      this.ctx = new AC()
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.ratio.value = 4
      this.master = this.ctx.createGain()
      this.master.gain.value = 0
      this.master.connect(comp).connect(this.ctx.destination)
      this.noise = this.makeNoise(2)
    }
    void this.ctx.resume()
    const now = this.ctx.currentTime
    this.master!.gain.cancelScheduledValues(now)
    this.master!.gain.setTargetAtTime(0.75, now, 0.4)
    if (!this.ambience) this.ambience = this.startAmbience()
  }

  private stop() {
    if (!this.ctx || !this.master) return
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(0, now, 0.15)
    const ctx = this.ctx
    setTimeout(() => {
      if (!this.enabled) {
        this.ambience?.()
        this.ambience = null
        void ctx.suspend()
      }
    }, 600)
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
    const d = buf.getChannelData(0)
    // Brown-ish noise: softer than white, closer to water.
    let last = 0
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    }
    return buf
  }

  /** Water lapping and a few crickets, until stopped. */
  private startAmbience(): () => void {
    const ctx = this.ctx!
    const out = ctx.createGain()
    out.gain.value = 1
    out.connect(this.master!)

    // water: looped soft noise, low-passed, with a slow swell
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 380
    const water = ctx.createGain()
    water.gain.value = 0.05
    const swell = ctx.createOscillator()
    swell.frequency.value = 0.06
    const swellDepth = ctx.createGain()
    swellDepth.gain.value = 0.02
    swell.connect(swellDepth).connect(water.gain)
    src.connect(lp).connect(water).connect(out)
    src.start()
    swell.start()

    // crickets: a few voices chirping in irregular groups
    const voices = [0, 1, 2].map((i) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = 4300 + i * 260 + Math.random() * 120
      const g = ctx.createGain()
      g.gain.value = 0
      const pan = ctx.createStereoPanner()
      pan.pan.value = -0.7 + i * 0.7 + (Math.random() - 0.5) * 0.3
      osc.connect(g).connect(pan).connect(out)
      osc.start()
      return { osc, g, next: ctx.currentTime + 0.5 + Math.random() * 2 }
    })
    const timer = setInterval(() => {
      const t0 = ctx.currentTime
      for (const v of voices) {
        while (v.next < t0 + 1.2) {
          const pulses = 3 + Math.floor(Math.random() * 2)
          const vol = 0.006 + Math.random() * 0.006
          for (let p = 0; p < pulses; p++) {
            const s = v.next + p * 0.048
            v.g.gain.setValueAtTime(0, s)
            v.g.gain.linearRampToValueAtTime(vol, s + 0.006)
            v.g.gain.linearRampToValueAtTime(0, s + 0.03)
          }
          // sometimes a cricket goes quiet for a while
          v.next += pulses * 0.048 + (Math.random() < 0.15 ? 4 + Math.random() * 5 : 0.7 + Math.random() * 1.6)
        }
      }
    }, 400)

    return () => {
      clearInterval(timer)
      const now = ctx.currentTime
      out.gain.setTargetAtTime(0, now, 0.1)
      setTimeout(() => {
        src.stop()
        swell.stop()
        voices.forEach((v) => v.osc.stop())
        out.disconnect()
      }, 500)
    }
  }

  play(kind: SoundKind, strength = 0.5, pan = 0) {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    if ((this.last[kind] ?? -1) + MIN_GAP[kind] > t) return
    this.last[kind] = t
    const s = Math.max(0.05, Math.min(1, strength))
    const p = Math.max(-1, Math.min(1, pan))
    switch (kind) {
      case 'croak':
        return this.croak(t, s, p)
      case 'plip':
        return this.plip(t, s, p)
      case 'splash':
        return this.splash(t, s, p)
      case 'chime':
        return this.chime(t, s, p)
      case 'pop':
        return this.pop(t, s, p)
    }
  }

  private panned(pan: number): StereoPannerNode {
    const node = this.ctx!.createStereoPanner()
    node.pan.value = pan * 0.8
    node.connect(this.master!)
    return node
  }

  /** "rib-bit": two short buzzy pulses through a throat-like band-pass. */
  private croak(t: number, s: number, pan: number) {
    const ctx = this.ctx!
    const out = this.panned(pan)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 520 + Math.random() * 120
    bp.Q.value = 2.5
    bp.connect(out)
    const f0 = 150 + Math.random() * 50
    for (const [delay, dur, k] of [
      [0, 0.075, 1],
      [0.11, 0.09, 0.85],
    ] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(f0 * k * 1.1, t + delay)
      osc.frequency.exponentialRampToValueAtTime(f0 * k * 0.85, t + delay + dur)
      const trem = ctx.createOscillator()
      trem.frequency.value = 38
      const tremDepth = ctx.createGain()
      tremDepth.gain.value = 0.5
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t + delay)
      g.gain.linearRampToValueAtTime(0.11 * s, t + delay + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur)
      trem.connect(tremDepth).connect(g.gain)
      osc.connect(g).connect(bp)
      osc.start(t + delay)
      trem.start(t + delay)
      osc.stop(t + delay + dur + 0.02)
      trem.stop(t + delay + dur + 0.02)
    }
  }

  /** A water drop: a quick falling sine. */
  private plip(t: number, s: number, pan: number) {
    const ctx = this.ctx!
    const out = this.panned(pan)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    const f = 1500 + Math.random() * 500
    osc.frequency.setValueAtTime(f, t)
    osc.frequency.exponentialRampToValueAtTime(f * 0.35, t + 0.07)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.07 * s, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + 0.15)
  }

  /** A question landing: a soft noise wash and a low thump. */
  private splash(t: number, s: number, pan: number) {
    const ctx = this.ctx!
    const out = this.panned(pan)
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(1400, t)
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.35)
    bp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.16 * s, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    src.connect(bp).connect(g).connect(out)
    src.start(t, Math.random())
    src.stop(t + 0.5)
    const thump = ctx.createOscillator()
    thump.frequency.setValueAtTime(110, t)
    thump.frequency.exponentialRampToValueAtTime(48, t + 0.18)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(0.1 * s, t)
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    thump.connect(tg).connect(out)
    thump.start(t)
    thump.stop(t + 0.25)
    this.plip(t + 0.08, s * 0.5, pan)
  }

  /** A coin rising: two warm bell notes. */
  private chime(t: number, s: number, pan: number) {
    const ctx = this.ctx!
    const out = this.panned(pan)
    const bell = (start: number, base: number, vol: number) => {
      const partials: [number, number, number][] = [
        [1, 1, 2.4],
        [2.0, 0.35, 1.5],
        [2.76, 0.22, 1.1],
        [5.4, 0.06, 0.5],
      ]
      for (const [ratio, amp, decay] of partials) {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.002)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, start)
        g.gain.linearRampToValueAtTime(vol * amp, start + 0.006)
        g.gain.exponentialRampToValueAtTime(0.0001, start + decay)
        osc.connect(g).connect(out)
        osc.start(start)
        osc.stop(start + decay + 0.05)
      }
    }
    bell(t, 1046.5, 0.05 * s)
    bell(t + 0.11, 1568, 0.035 * s)
  }

  /** Mist: a soft short pop. */
  private pop(t: number, s: number, pan: number) {
    const ctx = this.ctx!
    const out = this.panned(pan)
    const osc = ctx.createOscillator()
    osc.frequency.setValueAtTime(520, t)
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.08)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.06 * s, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    osc.connect(g).connect(out)
    osc.start(t)
    osc.stop(t + 0.14)
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1800
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.05 * s, t)
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    src.connect(hp).connect(ng).connect(out)
    src.start(t, Math.random())
    src.stop(t + 0.08)
  }
}

export const sound = new PondSound()
