/**
 * The swarm on the water: lily pads laid out in colonies (deterministic per viewport), and a frog on most of them.
 * Frogs bob on the simulated water, breathe, blink, look around (or at the pointer), hop when poked and light up
 * when they sit on a question's panel.
 */
import type { Layout } from './camera'
import { discSquash } from './camera'
import type { PondRect, PondSeat } from './types'
import { clamp, mulberry32, smoothstep } from './rng'
import type { WaveSim } from './sim'
import { FROG_ANCHOR, FROG_BOX, FROG_EYES, FROG_VARIANTS, frogSprites, padSprites, pickLevel } from './sprites'
import { palette } from '../theme'

export type GlowColor = 'lilac' | 'gold' | 'coral'

export interface Pad {
  x: number
  z: number
  r: number
  rot: number
  color: number
  phase: number
  flower: boolean
  /** A frog sits here (index into Crowd.frogs) or -1. */
  frog: number
  /** Taken by a lotus bud. */
  bud: boolean
  /** Quiet-zone factor (1 = fully shown). */
  qf: number
  /** Screen position this frame. */
  sx: number
  sy: number
  k: number
  onScreen: boolean
}

export interface Frog {
  index: number
  pad: Pad
  h: number
  variant: number
  pose: number
  breathe: number
  breatheRate: number
  blinkNext: number
  blinkT: number
  lookX: number
  lookY: number
  tLookX: number
  tLookY: number
  lookNext: number
  /** Something to look at (screen px), overrides wandering. */
  focus: { x: number; y: number } | null
  hopT: number
  glow: number
  glowTarget: number
  glowColor: GlowColor
  panel: string | null
  seat: PondSeat | null
  working: boolean
  /** 0..1 awake (the intro wakes the frogs in a wave); asleep frogs keep their eyes shut. */
  wake: number
  /** Intro progress at which this frog wakes. */
  wakeAt: number
  /** 0..1, fades in when the crowd grows. */
  appear: number
  /** performance.now() when the fade-in started (wall clock, so slow frames cannot stall it). */
  appearAt: number
  active: boolean
  // frame cache
  sx: number
  sy: number
  fh: number
  lift: number
}

export interface Slot {
  x: number
  z: number
  used: string | null
}

const BOB_GAIN = 2.4

/** How much of a thing at screen (x, y) shows near a quiet zone: 1 away from it, `floor` inside, a soft edge. */
export function quietFactor(q: PondRect | null, x: number, y: number, floor = 0.1, soft = 70): number {
  if (!q) return 1
  const dx = Math.max(q.x - x, 0, x - (q.x + q.w))
  const dy = Math.max(q.y - y, 0, y - (q.y + q.h))
  return floor + (1 - floor) * smoothstep(0, soft, Math.hypot(dx, dy))
}

export class Crowd {
  pads: Pad[] = []
  frogs: Frog[] = []
  /** Frogs sorted far → near for drawing; pads likewise. */
  private padOrder: Pad[] = []
  slots: Slot[] = []
  count = 0
  /** Wall clock for fades (the engine shares its own, which the lab can fast-forward). */
  clock: () => number = () => performance.now()
  private bySeat = new Map<number, Frog>()

  constructor(
    private L: Layout,
    cap: number,
    seed = 0x4d4d,
    private quiet: PondRect | null = null,
  ) {
    this.build(cap, seed)
  }

  /** The quiet factor of a pad, judged where its frog's body would be. */
  private padQuiet(x: number, z: number, r: number): number {
    const L = this.L
    const k = L.f / z
    const sx = L.cx + x * k
    const sy = L.horizon + L.camH * k - r * k * 0.9
    return quietFactor(this.quiet, sx, sy)
  }

  /** Moves the quiet zone without relaying the pond out (fade only). */
  setQuiet(q: PondRect | null): void {
    this.quiet = q
    for (const p of this.pads) p.qf = this.padQuiet(p.x, p.z, p.r)
  }

  private build(cap: number, seed: number): void {
    const L = this.L
    const rnd = mulberry32(seed)
    const zMin = L.zNear * 1.16
    const zMax = L.zFrogs
    const moonGladeX = L.moon.x
    const mirrorY = L.horizon + (L.horizon - L.moon.y)
    const inGlade = (x: number, z: number) => {
      const k = L.f / z
      const sx = L.cx + x * k
      const sy = L.horizon + L.camH * k
      const half = L.moon.r * 0.9 + 14 + Math.max(0, sy - L.horizon) * 0.05
      return Math.abs(sx - moonGladeX) < half && sy < mirrorY + L.moon.r * 5
    }
    // stage slots where question bubbles land: open water at mid depth
    const slots: Slot[] = []
    const zA = 2.0
    const zB = L.portrait ? 3.6 : 4.4
    for (let tries = 0; slots.length < 8 && tries < 400; tries++) {
      const z = zA * Math.pow(zB / zA, rnd())
      const x = (rnd() * 2 - 1) * (L.portrait ? 0.55 : 0.74) * L.sHalf * z
      if (inGlade(x, z)) continue
      if (slots.some((s) => Math.hypot(s.x - x, s.z - z) < 0.95)) continue
      if (this.quiet) {
        const k = L.f / z
        if (quietFactor(this.quiet, L.cx + x * k, L.horizon + (L.camH - 0.2) * k, 0, 0.42 * k + 40) < 0.999) continue
      }
      slots.push({ x, z, used: null })
    }
    this.slots = slots

    // colonies
    const clusters: { x: number; z: number; r: number }[] = []
    for (let k = 0; k < 26; k++) {
      const z = zMin * Math.pow(zMax / zMin, Math.pow(rnd(), 0.8))
      const x = (rnd() * 2 - 1) * L.sHalf * z
      clusters.push({ x, z, r: (0.45 + 1.1 * rnd()) * Math.sqrt(z / 2.2) })
    }
    const field = (x: number, z: number) => {
      let d = 0
      for (const c of clusters) {
        const dx = x - c.x
        const dz = (z - c.z) * 0.75
        d += Math.exp(-(dx * dx + dz * dz) / (c.r * c.r))
      }
      return Math.min(1, d)
    }

    const target = Math.round(cap * 1.22 + 14)
    const cell = 0.45
    const grid = new Map<number, Pad[]>()
    const key = (gx: number, gz: number) => gx * 73856093 + gz * 19349663
    const pads: Pad[] = []
    for (let attempts = 0; pads.length < target && attempts < target * 60; attempts++) {
      const z = zMin * Math.pow(zMax / zMin, rnd())
      const x = (rnd() * 2 - 1) * 0.985 * L.sHalf * z
      const depth = 0.05 + 0.95 * smoothstep(1.9, 7.5, z)
      const quiet = this.quiet ? 0.18 + 0.82 * this.padQuiet(x, z, 0.1) : 1
      const accept = depth * quiet * (0.04 + 0.96 * Math.pow(field(x, z), 1.4))
      if (rnd() > accept) continue
      if (inGlade(x, z) && rnd() > 0.1) continue
      const r = (0.078 + 0.05 * rnd()) * (1 + 0.25 * smoothstep(7, 16, z))
      if (Math.abs(x) + r > L.sHalf * z * 0.995) continue
      if (slots.some((s) => Math.hypot(s.x - x, s.z - z) < 0.46 + r)) continue
      const gx = Math.floor(x / cell)
      const gz = Math.floor(z / cell)
      let ok = true
      for (let ix = -1; ix <= 1 && ok; ix++) {
        for (let iz = -1; iz <= 1 && ok; iz++) {
          const list = grid.get(key(gx + ix, gz + iz))
          if (!list) continue
          for (const p of list) {
            if (Math.hypot(p.x - x, p.z - z) < (p.r + r) * 1.04) {
              ok = false
              break
            }
          }
        }
      }
      if (!ok) continue
      const pad: Pad = {
        x,
        z,
        r,
        rot: Math.floor(rnd() * 8),
        color: rnd() < 0.7 ? 0 : 1,
        phase: rnd() * Math.PI * 2,
        flower: false,
        frog: -1,
        bud: false,
        qf: this.padQuiet(x, z, r),
        sx: 0,
        sy: 0,
        k: 1,
        onScreen: true,
      }
      pads.push(pad)
      const kk = key(gx, gz)
      const list = grid.get(kk)
      if (list) list.push(pad)
      else grid.set(kk, [pad])
    }
    // Frogs take pads in a random priority order (stable as the count changes).
    const order = pads.map((p, i) => ({ p, i, pri: rnd() }))
    order.sort((a, b) => a.pri - b.pri)
    const frogs: Frog[] = []
    const nFrogs = Math.min(cap, order.length)
    for (let n = 0; n < nFrogs; n++) {
      const pad = order[n].p
      pad.frog = n
      const h = (0.125 + 0.05 * rnd()) * (pad.r / 0.1) ** 0.35
      frogs.push({
        index: n,
        pad,
        h,
        variant: rnd() < 0.62 ? 0 : rnd() < 0.5 ? 1 : 2,
        pose: rnd() < 0.55 ? 0 : 1,
        breathe: rnd() * Math.PI * 2,
        breatheRate: 1.6 + rnd() * 1.2,
        blinkNext: rnd() * 6,
        blinkT: -1,
        lookX: 0.3,
        lookY: -0.4,
        tLookX: 0.3,
        tLookY: -0.4,
        lookNext: rnd() * 4,
        focus: null,
        hopT: -1,
        glow: 0,
        glowTarget: 0,
        glowColor: 'lilac',
        panel: null,
        seat: null,
        working: false,
        wake: 1,
        wakeAt: 0.42 + 0.48 * smoothstep(L.zNear, L.zFrogs * 0.8, pad.z) + rnd() * 0.08,
        appear: 1,
        appearAt: 0,
        active: false,
        sx: 0,
        sy: 0,
        fh: 0,
        lift: 0,
      })
    }
    for (let n = nFrogs; n < order.length; n++) {
      if (rnd() < 0.14) order[n].p.flower = true
    }
    this.pads = pads
    this.frogs = frogs
    this.padOrder = [...pads].sort((a, b) => b.z - a.z)
  }

  /** How many frogs are out (the rest of the pads stay empty). */
  setCount(n: number, instant: boolean): void {
    const c = clamp(Math.round(n), 0, this.frogs.length)
    for (let i = 0; i < this.frogs.length; i++) {
      const f = this.frogs[i]
      const on = i < c
      if (on && !f.active) {
        f.appear = instant ? 1 : 0
        f.appearAt = this.clock()
      }
      f.active = on
    }
    this.count = c
  }

  setSeats(seats: PondSeat[]): void {
    this.bySeat.clear()
    for (let i = 0; i < this.frogs.length; i++) {
      const s = seats[i] ?? null
      const f = this.frogs[i]
      f.seat = s
      f.working = !!s?.working
      if (s) this.bySeat.set(s.tokenId, f)
    }
  }

  frogOfSeat(tokenId: number): Frog | null {
    const f = this.bySeat.get(tokenId)
    return f && f.active ? f : null
  }

  /** The `n` active frogs nearest to world (x, z) that are not on another panel. */
  nearest(x: number, z: number, n: number, exclude?: (f: Frog) => boolean): Frog[] {
    const scored: { f: Frog; d: number }[] = []
    for (const f of this.frogs) {
      if (!f.active || f.appear < 0.5 || f.pad.qf < 0.75) continue
      if (exclude && exclude(f)) continue
      const dx = f.pad.x - x
      const dz = (f.pad.z - z) * 0.8
      scored.push({ f, d: dx * dx + dz * dz })
    }
    scored.sort((a, b) => a.d - b.d)
    return scored.slice(0, n).map((s) => s.f)
  }

  /** A random active frog, preferring the near/mid pond where it can be seen. */
  randomFrog(rnd: () => number, maxZ = 9): Frog | null {
    for (let tries = 0; tries < 12; tries++) {
      const f = this.frogs[Math.floor(rnd() * this.count)]
      if (f && f.active && f.pad.z < maxZ && f.pad.onScreen && f.pad.qf > 0.9) return f
    }
    return null
  }

  /** A free pad (no frog, no bud) near mid depth, for a lotus bud. */
  freePad(rnd: () => number): Pad | null {
    const free = this.pads.filter((p) => p.frog < 0 || !this.frogs[p.frog]?.active)
    const taken = this.pads.filter((p) => p.bud)
    const apart = (p: Pad) => taken.every((b) => Math.hypot(b.x - p.x, b.z - p.z) > 0.55)
    const good = free.filter(
      (p) => !p.bud && p.z > 1.8 && p.z < (this.L.portrait ? 3.8 : 4.4) && p.onScreen && p.qf > 0.95 && apart(p),
    )
    const list = good.length ? good : free.filter((p) => !p.bud && p.qf > 0.95)
    if (!list.length) return null
    return list[Math.floor(rnd() * list.length)]
  }

  hop(f: Frog): void {
    if (f.hopT < 0) f.hopT = 0
  }

  /** Puts every frog to sleep (the intro wakes them in a wave as `wakeUp` progress passes their `wakeAt`). */
  sleep(): void {
    for (const f of this.frogs) f.wake = 0
  }

  update(
    dt: number,
    t: number,
    rnd: () => number,
    pointer: { x: number; y: number } | null,
    calm: boolean,
    nowMs: number,
    wakeUp = 1,
  ): void {
    for (const f of this.frogs) {
      if (!f.active) continue
      if (f.appear < 1) f.appear = calm ? 1 : Math.min(1, (nowMs - f.appearAt) / 700)
      if (f.wake < 1 && wakeUp >= f.wakeAt) f.wake = calm ? 1 : Math.min(1, f.wake + dt / 0.35)
      f.glow += (f.glowTarget - f.glow) * Math.min(1, dt * 4)
      if (calm) continue
      // blink
      if (f.blinkT >= 0) {
        f.blinkT += dt
        if (f.blinkT > 0.16) {
          f.blinkT = -1
          f.blinkNext = t + 2.2 + rnd() * 5.5
        }
      } else if (t > f.blinkNext) f.blinkT = 0
      // look
      if (f.focus) {
        const ex = f.sx
        const ey = f.sy - f.fh * 0.74
        const dx = f.focus.x - ex
        const dy = f.focus.y - ey
        const d = Math.hypot(dx, dy) || 1
        const m = Math.min(1, d / 40)
        f.tLookX = (dx / d) * m
        f.tLookY = (dy / d) * m
      } else if (pointer && f.fh > 14) {
        const ex = f.sx
        const ey = f.sy - f.fh * 0.74
        const dx = pointer.x - ex
        const dy = pointer.y - ey
        const d = Math.hypot(dx, dy)
        if (d < 240) {
          const m = Math.min(1, d / 50)
          f.tLookX = (dx / (d || 1)) * m
          f.tLookY = (dy / (d || 1)) * m
          f.lookNext = t + 0.8
        } else if (t > f.lookNext) this.wander(f, t, rnd)
      } else if (t > f.lookNext) this.wander(f, t, rnd)
      const ls = Math.min(1, dt * 9)
      f.lookX += (f.tLookX - f.lookX) * ls
      f.lookY += (f.tLookY - f.lookY) * ls
      // hop
      if (f.hopT >= 0) {
        f.hopT += dt
        if (f.hopT > 0.78) f.hopT = -1
      }
    }
  }

  private wander(f: Frog, t: number, rnd: () => number): void {
    const a = rnd() * Math.PI * 2
    const m = 0.2 + rnd() * 0.8
    f.tLookX = Math.cos(a) * m
    f.tLookY = Math.sin(a) * m * 0.7 - 0.15
    f.lookNext = t + 1.5 + rnd() * 4.5
  }

  /** Hop phases: returns [lift (world units), scaleX, scaleY]. */
  static hopShape(t: number): [number, number, number] {
    if (t < 0) return [0, 1, 1]
    if (t < 0.1) {
      const u = t / 0.1
      return [0, 1 + 0.16 * u, 1 - 0.2 * u]
    }
    if (t < 0.56) {
      const u = (t - 0.1) / 0.46
      const lift = 4 * u * (1 - u)
      const s = 1 - Math.abs(0.5 - u) * 2
      return [lift, 0.9 + 0.1 * (1 - s), 1.14 - 0.1 * (1 - s)]
    }
    const u = (t - 0.56) / 0.22
    const wob = Math.sin(u * Math.PI * 2) * (1 - u)
    return [0, 1 + 0.16 * wob, 1 - 0.18 * wob]
  }

  /** Projects pads and frogs for this frame (bobbing on the simulated water). */
  place(sim: WaveSim | null, t: number, calm: boolean): void {
    const L = this.L
    for (const p of this.pads) {
      const k = L.f / p.z
      const bob = (sim ? sim.heightAt(p.x, p.z) * BOB_GAIN : 0) + (calm ? 0 : 0.0045 * Math.sin(t * 1.25 + p.phase))
      p.k = k
      p.sx = L.cx + p.x * k
      p.sy = L.horizon + (L.camH - bob) * k
      const half = p.r * k
      p.onScreen = p.sx + half > -4 && p.sx - half < L.width + 4
    }
    for (const f of this.frogs) {
      if (!f.active) continue
      const p = f.pad
      const [lift] = Crowd.hopShape(f.hopT)
      f.lift = lift * 0.24
      f.fh = f.h * p.k
      f.sx = p.sx
      f.sy = p.sy - f.lift * p.k
    }
  }

  /**
   * Draws pads and frogs far → near. `insert(zFar, zNear)` lets the engine draw its own depth-sorted things (buds,
   * bubbles) between them: it is called with the depth band just drawn.
   */
  draw(ctx: CanvasRenderingContext2D, dpr: number, t: number, sim: WaveSim | null, insert: (z: number) => void): void {
    const pads = padSprites()
    const fs = frogSprites()
    const L = this.L
    for (const p of this.padOrder) {
      insert(p.z)
      if (!p.onScreen) continue
      const k = p.k
      const w = 2 * p.r * k
      const h = w * discSquash(L, p.z)
      if (w < 0.8) continue
      const lv = pickLevel(pads.levels, w * dpr)
      const spr = pads.pads[p.color][p.rot][lv]
      const frog = p.frog >= 0 ? this.frogs[p.frog] : null
      const hasFrog = !!frog && frog.active
      const fade = (1 - 0.6 * smoothstep(7, L.zFrogs, p.z)) * p.qf
      ctx.globalAlpha = fade
      ctx.drawImage(spr, p.sx - w / 2, p.sy - h / 2, w, h)
      if (!hasFrog && p.flower && !p.bud) {
        const fw = w * 0.62
        const fl = pickLevel(pads.flowerLevels, fw * dpr)
        ctx.drawImage(pads.flower[fl], p.sx - fw / 2, p.sy - fw * 0.66, fw, fw)
      }
      if (hasFrog && frog) this.drawFrog(ctx, frog, dpr, t, sim, fs, fade)
    }
    insert(-1)
    ctx.globalAlpha = 1
  }

  private drawFrog(
    ctx: CanvasRenderingContext2D,
    f: Frog,
    dpr: number,
    t: number,
    sim: WaveSim | null,
    fs: ReturnType<typeof frogSprites>,
    fade: number,
  ): void {
    const fh0 = f.fh
    if (fh0 < 1.2) return
    const [, hx, hy] = Crowd.hopShape(f.hopT)
    const br = Math.sin(t * f.breatheRate + f.breathe)
    // asleep: a little lower and rounder; waking: a small stretch
    const wk = f.wake
    const nap = 1 - wk
    const pop = wk > 0 && wk < 1 ? Math.sin(wk * Math.PI) * 0.12 : 0
    const sx = hx * (1 - 0.012 * br) * (1 + 0.05 * nap)
    const sy = hy * (1 + 0.024 * br) * (1 - 0.07 * nap + pop)
    const fh = fh0 * sy * (0.6 + 0.4 * f.appear)
    const fw = fh0 * (FROG_BOX.w / FROG_BOX.h) * sx * (0.6 + 0.4 * f.appear)
    const ax = f.sx
    const ay = f.sy + fh0 * 0.06
    const near = fh0 * dpr >= 30
    ctx.globalAlpha = f.appear * fade
    let tilt = 0
    if (near && sim && f.hopT < 0) tilt = clamp(-sim.slopeXAt(f.pad.x, f.pad.z) * BOB_GAIN * 0.5, -0.25, 0.25)
    if (tilt !== 0 && Math.abs(tilt) > 0.01) {
      ctx.save()
      ctx.translate(ax, ay)
      ctx.rotate(tilt)
      ctx.translate(-ax, -ay)
    }
    if (near) {
      const lv = pickLevel(fs.nearLevels, fh * dpr)
      ctx.drawImage(fs.near[f.variant][f.pose][lv], ax - fw * FROG_ANCHOR.x, ay - fh * FROG_ANCHOR.y, fw, fh)
      this.drawEyes(ctx, f, ax, ay, fh / FROG_BOX.h, sx, sy)
    } else {
      const lv = pickLevel(fs.farLevels, fh * dpr)
      ctx.drawImage(fs.far[f.variant][f.pose][lv], ax - fw * FROG_ANCHOR.x, ay - fh * FROG_ANCHOR.y, fw, fh)
    }
    if (tilt !== 0 && Math.abs(tilt) > 0.01) ctx.restore()
    ctx.globalAlpha = 1
  }

  private drawEyes(
    ctx: CanvasRenderingContext2D,
    f: Frog,
    ax: number,
    ay: number,
    u: number,
    sx: number,
    sy: number,
  ): void {
    const E = FROG_EYES
    const ey = ay + E.y * u * sy
    const lx = ax + E.lx * u * sx
    const rx = ax + E.rx * u * sx
    if (f.blinkT >= 0) {
      const col = FROG_VARIANTS[f.variant]
      ctx.fillStyle = col.skinB
      ctx.beginPath()
      ctx.arc(lx, ey, E.sclera * u + 0.5, 0, Math.PI * 2)
      ctx.arc(rx, ey, E.sclera * u + 0.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = palette.ink
      ctx.lineWidth = Math.max(0.8, 3.5 * u)
      ctx.beginPath()
      ctx.arc(lx, ey - E.sclera * u * 0.4, E.sclera * u * 0.7, 0.35 * Math.PI, 0.65 * Math.PI)
      ctx.moveTo(rx + E.sclera * u * 0.7 * Math.cos(0.35 * Math.PI), ey - E.sclera * u * 0.4 + E.sclera * u * 0.7 * Math.sin(0.35 * Math.PI))
      ctx.arc(rx, ey - E.sclera * u * 0.4, E.sclera * u * 0.7, 0.35 * Math.PI, 0.65 * Math.PI)
      ctx.stroke()
      return
    }
    if (f.wake < 0.5) {
      // eyes shut: lids over the sclera and a sleepy curve
      const col = FROG_VARIANTS[f.variant]
      ctx.fillStyle = col.skinB
      ctx.beginPath()
      ctx.arc(lx, ey, E.sclera * u + 0.5, 0, Math.PI * 2)
      ctx.arc(rx, ey, E.sclera * u + 0.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = palette.ink
      ctx.lineWidth = Math.max(0.8, 3.2 * u)
      ctx.beginPath()
      ctx.arc(lx, ey - E.sclera * u * 0.15, E.sclera * u * 0.62, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.moveTo(rx + E.sclera * u * 0.62 * Math.cos(0.15 * Math.PI), ey - E.sclera * u * 0.15 + E.sclera * u * 0.62 * Math.sin(0.15 * Math.PI))
      ctx.arc(rx, ey - E.sclera * u * 0.15, E.sclera * u * 0.62, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      return
    }
    const ox = f.lookX * E.look * u
    const oy = f.lookY * E.look * u
    const pr = E.pupil * u
    ctx.fillStyle = palette.ink
    ctx.beginPath()
    ctx.arc(lx + ox, ey + oy, pr, 0, Math.PI * 2)
    ctx.arc(rx + ox, ey + oy, pr, 0, Math.PI * 2)
    ctx.fill()
    if (pr > 2.2) {
      ctx.fillStyle = '#ffffff'
      const hr = pr * 0.34
      ctx.beginPath()
      ctx.arc(lx + ox + pr * 0.38, ey + oy - pr * 0.42, hr, 0, Math.PI * 2)
      ctx.arc(rx + ox + pr * 0.38, ey + oy - pr * 0.42, hr, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /** The frog under a screen point (nearest to the camera first), or null. */
  pick(x: number, y: number): Frog | null {
    let best: Frog | null = null
    let bestZ = Infinity
    for (const f of this.frogs) {
      if (!f.active || !f.pad.onScreen) continue
      const fh = f.fh
      const r = Math.max(9, fh * 0.6)
      const cx = f.sx
      const cy = f.sy - fh * 0.5
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy < r * r && f.pad.z < bestZ) {
        best = f
        bestZ = f.pad.z
      }
    }
    return best
  }

  /** Screen point of a frog's head. */
  static head(f: Frog): { x: number; y: number } {
    return { x: f.sx, y: f.sy - f.fh * 0.78 }
  }
}
