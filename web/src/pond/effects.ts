/** Particles, fireflies and the hand-drawn bits of the pond's 2D layer. */
import type { Layout, ScreenPoint } from './camera'
import { discSquash, project } from './camera'
import { clamp } from './rng'
import type { WaveSim } from './sim'
import { glowSprite, FONT_STACK } from './sprites'
import { palette, rgba } from '../theme'

const TAU = Math.PI * 2

/* ───────────────────────────── particles ───────────────────────────── */

export const enum PK {
  /** World-space water droplet: falls back and makes a ripple. */
  Drop = 0,
  /** Screen-space soft mist puff. */
  Mist = 1,
  /** Screen-space sparkle. */
  Spark = 2,
  /** Screen-space expanding ring. */
  Ring = 3,
}

interface Particle {
  k: PK
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  size: number
  color: string
}

export class Particles {
  private list: Particle[] = []
  private pt: ScreenPoint = { x: 0, y: 0, k: 1 }
  max = 700
  /** Called when a droplet lands back on the water (world x, z). */
  onLand: ((x: number, z: number) => void) | null = null

  get count(): number {
    return this.list.length
  }

  clear(): void {
    this.list.length = 0
  }

  private push(p: Particle): void {
    if (this.list.length >= this.max) this.list.shift()
    this.list.push(p)
  }

  /** Droplets thrown up from world (x, z). */
  droplets(x: number, z: number, n: number, power: number, rnd: () => number): void {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU
      const sp = (0.25 + rnd() * 0.75) * 0.55 * power
      this.push({
        k: PK.Drop,
        x: x + Math.cos(a) * 0.02,
        y: 0.01,
        z: z + Math.sin(a) * 0.02,
        vx: Math.cos(a) * sp,
        vy: (0.9 + rnd() * 1.4) * power,
        vz: Math.sin(a) * sp,
        life: 0,
        max: 3,
        size: 0.006 + rnd() * 0.008,
        color: rnd() < 0.7 ? '#dfe9e4' : palette.moon,
      })
    }
  }

  /** An expanding ring (a pop's shock wave), drawn as a thin glowing circle. */
  ring(sx: number, sy: number, r: number, color: string): void {
    this.push({ k: PK.Ring, x: sx, y: sy, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 0.55, size: r, color })
  }

  mist(sx: number, sy: number, n: number, color: string, spread: number, rnd: () => number, size = 6): void {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU
      const sp = (0.3 + rnd()) * spread
      this.push({
        k: PK.Mist,
        x: sx,
        y: sy,
        z: 0,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6 - spread * 0.25,
        vz: 0,
        life: 0,
        max: 1.1 + rnd() * 0.9,
        size: size * (0.6 + rnd() * 0.8),
        color: rnd() < 0.65 ? color : palette.moon,
      })
    }
  }

  sparks(sx: number, sy: number, n: number, color: string, spread: number, rnd: () => number): void {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU
      const sp = (0.2 + rnd()) * spread
      this.push({
        k: PK.Spark,
        x: sx,
        y: sy,
        z: 0,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - spread * 0.2,
        vz: 0,
        life: 0,
        max: 0.5 + rnd() * 0.7,
        size: 1.5 + rnd() * 2.5,
        color,
      })
    }
  }

  update(dt: number, sim: WaveSim | null): void {
    const list = this.list
    let w = 0
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      p.life += dt
      let alive = p.life < p.max
      if (p.k === PK.Drop) {
        p.vy -= 9.0 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.z += p.vz * dt
        if (p.y <= 0 && p.vy < 0) {
          if (sim) sim.splash(p.x, p.z, 0.022, 0.0028)
          this.onLand?.(p.x, p.z)
          alive = false
        }
      } else if (p.k === PK.Mist) {
        const drag = Math.exp(-dt * 2.2)
        p.vx *= drag
        p.vy = p.vy * drag - 6 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
      } else if (p.k === PK.Ring) {
        // nothing to integrate
      } else {
        const drag = Math.exp(-dt * 3)
        p.vx *= drag
        p.vy = p.vy * drag + 10 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
      }
      if (alive) list[w++] = p
    }
    list.length = w
  }

  draw(ctx: CanvasRenderingContext2D, L: Layout): void {
    if (!this.list.length) return
    const pt = this.pt
    // droplets (normal blending)
    for (const p of this.list) {
      if (p.k !== PK.Drop) continue
      project(L, p.x, p.y, p.z, pt)
      const r = Math.max(0.7, p.size * pt.k)
      ctx.globalAlpha = 0.85
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, r, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    const prev = ctx.globalCompositeOperation
    ctx.globalCompositeOperation = 'lighter'
    for (const p of this.list) {
      if (p.k === PK.Drop) continue
      const u = p.life / p.max
      if (p.k === PK.Ring) {
        const r = p.size * (1 + u * 1.8)
        ctx.globalAlpha = (1 - u) * 0.8
        ctx.strokeStyle = p.color
        ctx.lineWidth = 2 * (1 - u) + 0.5
        ctx.beginPath()
        ctx.arc(p.x, p.y, r, 0, TAU)
        ctx.stroke()
      } else if (p.k === PK.Mist) {
        const s = p.size * (1 + u * 2.6)
        ctx.globalAlpha = 0.5 * (1 - u) * (1 - u)
        ctx.drawImage(glowSprite(p.color, 0.3), p.x - s, p.y - s, s * 2, s * 2)
      } else {
        const tw = 0.6 + 0.4 * Math.sin(p.life * 30 + p.size * 10)
        const s = p.size * (1 - u * 0.5)
        ctx.globalAlpha = (1 - u) * tw
        ctx.drawImage(glowSprite(p.color), p.x - s * 3, p.y - s * 3, s * 6, s * 6)
        ctx.strokeStyle = rgba(palette.moon, 0.8 * (1 - u))
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(p.x - s * 2.2, p.y)
        ctx.lineTo(p.x + s * 2.2, p.y)
        ctx.moveTo(p.x, p.y - s * 2.2)
        ctx.lineTo(p.x, p.y + s * 2.2)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = prev
  }
}

/* ───────────────────────────── fireflies ───────────────────────────── */

export interface Fly {
  id: string
  order: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  tx: number
  ty: number
  tz: number
  retarget: number
  phase: number
  hover: number
  hoverTarget: number
  birth: number
  leaving: boolean
  alpha: number
  sx: number
  sy: number
  k: number
  r: number
}

export class Fireflies {
  readonly map = new Map<string, Fly>()
  private pt: ScreenPoint = { x: 0, y: 0, k: 1 }
  /** Quiet-zone factor at a screen point (1 = free to be there); fireflies steer clear and dim inside. */
  quiet: (x: number, y: number) => number = () => 1

  constructor(private L: Layout) {}

  setLayout(L: Layout): void {
    this.L = L
    for (const f of this.map.values()) this.clampInto(f)
  }

  private bounds() {
    const L = this.L
    return { z0: L.portrait ? 2.2 : 1.9, z1: L.portrait ? 5.5 : 7, y0: 0.28, y1: 0.92 }
  }

  private clampInto(f: Fly): void {
    const b = this.bounds()
    f.z = clamp(f.z, b.z0, b.z1)
    const xm = 0.88 * this.L.sHalf * f.z
    f.x = clamp(f.x, -xm, xm)
  }

  add(id: string, order: number, rnd: () => number, from?: { x: number; y: number; z: number }): Fly {
    const b = this.bounds()
    const z = from ? from.z : b.z0 + Math.pow(rnd(), 0.8) * (b.z1 - b.z0)
    const xm = 0.85 * this.L.sHalf * z
    const f: Fly = {
      id,
      order,
      x: from ? from.x : (rnd() * 2 - 1) * xm,
      y: from ? from.y : b.y0 + rnd() * (b.y1 - b.y0),
      z,
      vx: 0,
      vy: from ? 0.5 : 0,
      vz: 0,
      tx: 0,
      ty: 0,
      tz: 0,
      retarget: 0,
      phase: rnd() * TAU,
      hover: 0,
      hoverTarget: 0,
      birth: from ? 0 : 1,
      leaving: false,
      alpha: 1,
      sx: 0,
      sy: 0,
      k: 1,
      r: 8,
    }
    if (!from) {
      for (let tries = 0; tries < 8; tries++) {
        project(this.L, f.x, f.y, f.z, this.pt)
        if (this.quiet(this.pt.x, this.pt.y) > 0.95) break
        f.z = b.z0 + Math.pow(rnd(), 0.8) * (b.z1 - b.z0)
        f.x = (rnd() * 2 - 1) * 0.85 * this.L.sHalf * f.z
      }
    }
    this.retarget(f, rnd)
    this.map.set(id, f)
    return f
  }

  leave(id: string): void {
    const f = this.map.get(id)
    if (f) f.leaving = true
  }

  private retarget(f: Fly, rnd: () => number): void {
    const b = this.bounds()
    for (let tries = 0; tries < 8; tries++) {
      f.tz = clamp(f.z + (rnd() * 2 - 1) * 1.4, b.z0, b.z1)
      const xm = 0.86 * this.L.sHalf * f.tz
      f.tx = clamp(f.x + (rnd() * 2 - 1) * (1.3 + tries * 0.3), -xm, xm)
      f.ty = b.y0 + rnd() * (b.y1 - b.y0)
      project(this.L, f.tx, f.ty, f.tz, this.pt)
      if (this.quiet(this.pt.x, this.pt.y) > 0.95) break
    }
    f.retarget = 3 + rnd() * 5
  }

  update(dt: number, t: number, rnd: () => number, pointer: { x: number; y: number } | null, calm: boolean): void {
    const L = this.L
    for (const f of this.map.values()) {
      f.hover += (f.hoverTarget - f.hover) * Math.min(1, dt * 10)
      if (f.birth < 1) f.birth = Math.min(1, f.birth + dt * 0.8)
      if (f.leaving) {
        f.alpha -= dt * 0.7
        f.vy += dt * 0.6
        if (f.alpha <= 0) {
          this.map.delete(f.id)
          continue
        }
      }
      if (!calm) {
        f.retarget -= dt
        const dx = f.tx - f.x
        const dy = f.ty - f.y
        const dz = f.tz - f.z
        const d = Math.hypot(dx, dy, dz) || 1
        if (f.retarget <= 0 || d < 0.06) this.retarget(f, rnd)
        const acc = 0.32
        f.vx += ((dx / d) * acc + Math.sin(t * 1.7 + f.phase) * 0.18) * dt
        f.vy += ((dy / d) * acc + Math.cos(t * 2.3 + f.phase * 1.3) * 0.22) * dt
        f.vz += ((dz / d) * acc + Math.sin(t * 1.1 + f.phase * 0.7) * 0.15) * dt
        if (pointer && f.sx) {
          const px = f.sx - pointer.x
          const py = f.sy - pointer.y
          const pd = Math.hypot(px, py)
          if (pd < 110 && f.hoverTarget === 0) {
            const push = (1 - pd / 110) * 2.2 * dt
            f.vx += ((px / (pd || 1)) * push) / Math.max(0.3, f.k / 120)
            f.vy -= ((py / (pd || 1)) * push) / Math.max(0.3, f.k / 120)
          }
        }
        const damp = Math.exp(-dt * 1.4)
        f.vx *= damp
        f.vy *= damp
        f.vz *= damp
        const sp = Math.hypot(f.vx, f.vy, f.vz)
        const max = f.leaving ? 1.2 : 0.42
        if (sp > max) {
          f.vx *= max / sp
          f.vy *= max / sp
          f.vz *= max / sp
        }
        if (f.hoverTarget > 0) {
          f.vx *= 0.9
          f.vy *= 0.9
          f.vz *= 0.9
        }
        f.x += f.vx * dt
        f.y += f.vy * dt
        f.z += f.vz * dt
        if (!f.leaving) {
          const b = this.bounds()
          f.y = clamp(f.y, 0.08, b.y1 + 0.3)
          this.clampInto(f)
        }
      }
      project(L, f.x, f.y, f.z, this.pt)
      f.sx = this.pt.x
      f.sy = this.pt.y
      f.k = this.pt.k
      f.r = clamp(0.1 * f.k, 8, 21)
    }
  }

  private pulse(f: Fly, t: number): number {
    const s = 0.5 + 0.5 * Math.sin(t * 1.6 + f.phase)
    return 0.5 + 0.5 * s * s
  }

  drawReflections(ctx: CanvasRenderingContext2D, t: number): void {
    const L = this.L
    const g = glowSprite(palette.gold, 0.12)
    for (const f of this.map.values()) {
      project(L, f.x, -f.y, f.z, this.pt)
      if (this.pt.y < L.horizon + 2) continue
      const r = f.r * 1.2 * (1 + f.hover * 0.6)
      ctx.globalAlpha = 0.22 * this.pulse(f, t) * f.alpha * f.birth * this.quiet(this.pt.x, this.pt.y)
      ctx.drawImage(g, this.pt.x - r, this.pt.y - r * 1.5, r * 2, r * 3)
    }
    ctx.globalAlpha = 1
  }

  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const glow = glowSprite(palette.gold, 0.12)
    const core = glowSprite('#fff4c8', 0.35)
    for (const f of this.map.values()) {
      const p = this.pulse(f, t) * f.alpha * (0.3 + 0.7 * f.birth) * this.quiet(f.sx, f.sy)
      const r = f.r * (1 + f.hover * 0.9) * (0.6 + 0.4 * f.birth)
      ctx.globalAlpha = 0.85 * p
      ctx.drawImage(glow, f.sx - r * 1.6, f.sy - r * 1.6, r * 3.2, r * 3.2)
      const c = Math.max(2.2, r * 0.42)
      ctx.globalAlpha = Math.min(1, 0.6 + p)
      ctx.drawImage(core, f.sx - c, f.sy - c, c * 2, c * 2)
      if (f.hover > 0.05) {
        ctx.globalAlpha = f.hover * 0.7
        ctx.strokeStyle = palette.gold
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(f.sx, f.sy, r * 1.25 + 3 * Math.sin(t * 5), 0, TAU)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  pick(x: number, y: number): Fly | null {
    let best: Fly | null = null
    let bd = Infinity
    for (const f of this.map.values()) {
      if (f.leaving) continue
      const d = Math.hypot(f.sx - x, f.sy - y)
      const r = Math.max(16, f.r * 1.4)
      if (d < r && d < bd) {
        best = f
        bd = d
      }
    }
    return best
  }
}

/* ───────────────────────────── drawing helpers ───────────────────────────── */

const LILAC = [201, 184, 255]
const GOLD = [255, 207, 74]
const CORAL = [255, 122, 107]

/** Mix lilac → gold (g) and → coral (c). */
export function questionColor(g: number, c: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const a = LILAC[i] + (GOLD[i] - LILAC[i]) * g
    out[i] = Math.round(a + (CORAL[i] - a) * c)
  }
  return out
}

const css = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const hex = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

let glyph: HTMLCanvasElement | null = null
function askGlyph(): HTMLCanvasElement {
  if (glyph) return glyph
  const c = document.createElement('canvas')
  c.width = 96
  c.height = 96
  const ctx = c.getContext('2d')!
  ctx.font = `800 70px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillText('?', 48, 52)
  glyph = c
  return c
}
export function resetGlyphs(): void {
  glyph = null
}

/** The question bubble: a glassy glowing sphere with a "?" inside. */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  g: number,
  c: number,
  t: number,
  alpha: number,
  squish = 0,
): void {
  if (R < 0.5 || alpha <= 0) return
  const col = questionColor(g, c)
  ctx.save()
  ctx.globalAlpha = alpha
  // glow
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha * (0.55 + 0.15 * Math.sin(t * 2.4))
  const G = R * 3.2
  ctx.drawImage(glowSprite(hex(col), 0.1), x - G, y - G, G * 2, G * 2)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = alpha
  // body
  const sx = 1 + squish
  const sy = 1 - squish
  ctx.translate(x, y)
  ctx.scale(sx, sy)
  const body = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R)
  body.addColorStop(0, css(col, 0.22))
  body.addColorStop(0.7, css(col, 0.38))
  body.addColorStop(1, css(col, 0.85))
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(0, 0, R, 0, TAU)
  ctx.fill()
  // swirl of thought inside
  ctx.lineWidth = Math.max(0.8, R * 0.07)
  ctx.strokeStyle = css(col, 0.55)
  ctx.beginPath()
  ctx.arc(0, 0, R * 0.68, t * 1.3, t * 1.3 + 1.6)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, R * 0.5, -t * 1.8 + 2, -t * 1.8 + 3.1)
  ctx.stroke()
  // glyph
  const gs = R * 1.25
  ctx.globalAlpha = alpha * (1 - g * 0.6)
  ctx.drawImage(askGlyph(), -gs / 2, -gs / 2, gs, gs)
  ctx.globalAlpha = alpha
  // rim and specular
  ctx.lineWidth = Math.max(0.8, R * 0.06)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  ctx.arc(0, 0, R - ctx.lineWidth / 2, 0, TAU)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.ellipse(-R * 0.38, -R * 0.45, R * 0.2, R * 0.12, -0.6, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** A spinning gold HMM coin (three thought dots embossed). */
export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, spin: number, alpha: number): void {
  if (R < 0.5 || alpha <= 0) return
  const c = Math.cos(spin)
  const w = Math.max(R * 0.08, R * Math.abs(c))
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha * 0.7
  const G = R * 3
  ctx.drawImage(glowSprite(palette.gold, 0.1), x - G, y - G, G * 2, G * 2)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = alpha
  // edge
  ctx.fillStyle = '#b8841c'
  ctx.beginPath()
  ctx.ellipse(x + (c >= 0 ? -1 : 1) * R * 0.1 * Math.abs(Math.sin(spin)), y, w, R, 0, 0, TAU)
  ctx.fill()
  // face
  const face = ctx.createLinearGradient(x - w, y - R, x + w, y + R)
  face.addColorStop(0, '#fff3c4')
  face.addColorStop(0.45, palette.gold)
  face.addColorStop(1, '#e09a22')
  ctx.fillStyle = face
  ctx.beginPath()
  ctx.ellipse(x, y, w * 0.92, R * 0.92, 0, 0, TAU)
  ctx.fill()
  if (Math.abs(c) > 0.35) {
    ctx.fillStyle = 'rgba(150,96,10,0.55)'
    const dots: [number, number, number][] = [
      [-0.32, 0.22, 0.13],
      [0.02, -0.02, 0.17],
      [0.36, -0.3, 0.21],
    ]
    for (const [dx, dy, r] of dots) {
      ctx.beginPath()
      ctx.ellipse(x + dx * R * c, y + dy * R, r * R * Math.abs(c), r * R, 0, 0, TAU)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** A lotus bud filling with light (`raised` 0..1); `open` 0..1 blooms it. */
export function drawBud(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  x: number,
  y: number,
  z: number,
  k: number,
  raised: number,
  open: number,
  pulse: number,
  hover: number,
  alpha: number,
  t: number,
): void {
  if (alpha <= 0) return
  const h = 0.24 * k * (1 + 0.22 * pulse + 0.12 * hover)
  if (h < 2) return
  ctx.save()
  ctx.globalAlpha = alpha
  // progress ring on the water
  const rr = h * 0.62
  const sq = discSquash(L, z)
  ctx.lineWidth = Math.max(1.6, h * 0.06)
  ctx.strokeStyle = 'rgba(243,234,211,0.22)'
  ctx.beginPath()
  ctx.ellipse(x, y, rr, rr * sq, 0, 0, TAU)
  ctx.stroke()
  if (raised > 0.001) {
    ctx.strokeStyle = palette.gold
    ctx.beginPath()
    ctx.ellipse(x, y, rr, rr * sq, 0, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(raised, 0, 1))
    ctx.stroke()
  }
  // inner light
  ctx.globalCompositeOperation = 'lighter'
  const glowR = h * (0.5 + 0.9 * raised) * (1 + 0.3 * pulse)
  ctx.globalAlpha = alpha * (0.25 + 0.6 * raised + 0.4 * pulse) * (0.85 + 0.15 * Math.sin(t * 2.2))
  ctx.drawImage(glowSprite(raised > 0.5 ? palette.gold : palette.lilac, 0.15), x - glowR, y - h * 0.45 - glowR, glowR * 2, glowR * 2)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = alpha
  // petals
  const petal = (angle: number, len: number, wid: number, c0: string, c1: string) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    const g = ctx.createLinearGradient(0, 0, 0, -len)
    g.addColorStop(0, c0)
    g.addColorStop(1, c1)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(-wid, -len * 0.3, -wid * 0.7, -len * 0.8, 0, -len)
    ctx.bezierCurveTo(wid * 0.7, -len * 0.8, wid, -len * 0.3, 0, 0)
    ctx.fill()
    ctx.restore()
  }
  const spread = 0.28 + open * 0.95
  const glowMix = clamp(raised, 0, 1)
  const tip = glowMix > 0.6 ? '#fff1c9' : '#efe6ff'
  petal(-spread * 1.25, h * 0.86, h * 0.3, '#7f6bb8', '#cdbcf7')
  petal(spread * 1.25, h * 0.86, h * 0.3, '#7f6bb8', '#cdbcf7')
  petal(-spread * 0.55, h * 0.95, h * 0.32, '#9a86d6', tip)
  petal(spread * 0.55, h * 0.95, h * 0.32, '#9a86d6', tip)
  petal(0, h * (1.02 - open * 0.25), h * 0.34, '#a895e3', tip)
  ctx.restore()
}

/** Curved thought lines from panel frogs to a bubble, with travelling dots. */
export function drawThoughtLines(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number }[],
  to: { x: number; y: number },
  t: number,
  col: [number, number, number],
  alpha: number,
  converge: number,
  speed: number,
): void {
  if (alpha <= 0 || !from.length) return
  const dot = glowSprite(hex(col), 0.25)
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < from.length; i++) {
    const a = from[i]
    const dx = to.x - a.x
    const dy = to.y - a.y
    const dist = Math.hypot(dx, dy)
    const lift = dist * 0.35 * (1 - converge)
    const sx = a.x + dx * converge * 0.85
    const sy = a.y + dy * converge * 0.85
    const cx = (sx + to.x) / 2
    const cy = (sy + to.y) / 2 - lift
    ctx.globalAlpha = alpha * (0.5 + 0.2 * Math.sin(t * 3 + i))
    ctx.strokeStyle = css(col, 1)
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.quadraticCurveTo(cx, cy, to.x, to.y)
    ctx.stroke()
    ctx.globalCompositeOperation = 'lighter'
    for (let j = 0; j < 2; j++) {
      const p = (t * speed + i * 0.31 + j * 0.5) % 1
      const q = 1 - p
      const px = q * q * sx + 2 * q * p * cx + p * p * to.x
      const py = q * q * sy + 2 * q * p * cy + p * p * to.y
      const r = 7
      ctx.globalAlpha = alpha * Math.sin(p * Math.PI)
      ctx.drawImage(dot, px - r, py - r, r * 2, r * 2)
    }
    ctx.globalCompositeOperation = 'source-over'
  }
  ctx.restore()
}

/** The round ring around the moon: ten minute ticks and a gold arc for the round's progress. */
export function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  progress: number,
  alpha: number,
  flash: number,
): void {
  if (alpha <= 0.01) return
  const rr = r * 1.5 + flash * 6
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineWidth = 1
  ctx.strokeStyle = rgba(palette.moon, 0.16 + flash * 0.4)
  ctx.beginPath()
  ctx.arc(x, y, rr, 0, TAU)
  ctx.stroke()
  const p = clamp(progress, 0, 1)
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k / 10) * TAU
    const passed = k / 10 <= p + 1e-6
    const len = k === 0 ? 6 : 4
    ctx.strokeStyle = passed ? rgba(palette.gold, 0.9) : rgba(palette.moon, 0.35)
    ctx.lineWidth = k === 0 ? 1.6 : 1.2
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * (rr - len / 2), y + Math.sin(a) * (rr - len / 2))
    ctx.lineTo(x + Math.cos(a) * (rr + len / 2), y + Math.sin(a) * (rr + len / 2))
    ctx.stroke()
  }
  if (p > 0.0005) {
    const a1 = -Math.PI / 2 + p * TAU
    ctx.lineCap = 'round'
    ctx.strokeStyle = rgba(palette.gold, 0.18)
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(x, y, rr, -Math.PI / 2, a1)
    ctx.stroke()
    ctx.strokeStyle = palette.gold
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, rr, -Math.PI / 2, a1)
    ctx.stroke()
    const hx = x + Math.cos(a1) * rr
    const hy = y + Math.sin(a1) * rr
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(glowSprite(palette.gold, 0.2), hx - 9, hy - 9, 18, 18)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#fff3c4'
    ctx.beginPath()
    ctx.arc(hx, hy, 2.4, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

/* ───────────────────────────── foreground reeds ───────────────────────────── */

interface Reed {
  x: number
  h: number
  bend: number
  phase: number
  w: number
  head: boolean
  leaf: boolean
}

export class Reeds {
  private reeds: Reed[] = []
  private H = 0

  build(L: Layout, rnd: () => number): void {
    this.H = L.height
    const reeds: Reed[] = []
    const n = L.portrait ? 6 : 9
    const scale = L.portrait ? 0.7 : 1
    for (let i = 0; i < n; i++) {
      const left = i < Math.ceil(n * 0.62)
      const x = left ? -10 + rnd() * L.width * 0.13 : L.width - rnd() * L.width * 0.1 + 6
      reeds.push({
        x,
        h: (0.18 + rnd() * 0.22) * L.height * scale,
        bend: (left ? 1 : -1) * (0.04 + rnd() * 0.12),
        phase: rnd() * TAU,
        w: (2.2 + rnd() * 2.2) * scale,
        head: rnd() < 0.55,
        leaf: rnd() < 0.6,
      })
    }
    this.reeds = reeds.sort((a, b) => a.h - b.h)
  }

  draw(ctx: CanvasRenderingContext2D, t: number, calm: boolean): void {
    const base = this.H + 6
    ctx.save()
    for (const r of this.reeds) {
      const sway = calm ? 0 : Math.sin(t * 0.7 + r.phase) * 0.018 + Math.sin(t * 1.9 + r.phase * 2) * 0.006
      const tipX = r.x + (r.bend + sway) * r.h
      const tipY = base - r.h
      const cx = r.x + (r.bend + sway) * r.h * 0.2
      const cy = base - r.h * 0.55
      ctx.strokeStyle = '#050a0b'
      ctx.lineCap = 'round'
      ctx.lineWidth = r.w
      ctx.beginPath()
      ctx.moveTo(r.x, base)
      ctx.quadraticCurveTo(cx, cy, tipX, tipY)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(70,120,96,0.28)'
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(r.x + r.w * 0.4, base)
      ctx.quadraticCurveTo(cx + r.w * 0.4, cy, tipX + r.w * 0.3, tipY)
      ctx.stroke()
      if (r.leaf) {
        const lx = r.x + (r.bend * 2.2 + sway * 1.5) * r.h * 0.8
        const ly = base - r.h * 0.62
        ctx.fillStyle = '#050a0b'
        ctx.beginPath()
        ctx.moveTo(r.x - r.w, base)
        ctx.quadraticCurveTo(r.x + (lx - r.x) * 0.2, base - r.h * 0.35, lx, ly)
        ctx.quadraticCurveTo(r.x + (lx - r.x) * 0.35, base - r.h * 0.3, r.x + r.w * 2, base)
        ctx.fill()
      }
      if (r.head) {
        const hl = r.h * 0.15
        const ang = Math.atan2(tipY - cy, tipX - cx)
        const hx = tipX - Math.cos(ang) * hl * 0.35
        const hy = tipY - Math.sin(ang) * hl * 0.35
        ctx.save()
        ctx.translate(hx, hy)
        ctx.rotate(ang + Math.PI / 2)
        ctx.fillStyle = '#1a120c'
        const hw = r.w * 2.1
        ctx.beginPath()
        ctx.roundRect(-hw / 2, 0, hw, hl, hw / 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(243,234,211,0.08)'
        ctx.fillRect(hw * 0.1, hl * 0.1, hw * 0.25, hl * 0.8)
        ctx.restore()
      }
    }
    ctx.restore()
  }
}

/* ───────────────────────────── shooting stars ───────────────────────────── */

export interface Meteor {
  x: number
  y: number
  dx: number
  dy: number
  len: number
  t: number
  max: number
}

export function drawMeteor(ctx: CanvasRenderingContext2D, m: Meteor): void {
  const u = m.t / m.max
  const a = Math.sin(Math.min(1, u) * Math.PI)
  const hx = m.x + m.dx * u
  const hy = m.y + m.dy * u
  const tx = hx - (m.dx / Math.hypot(m.dx, m.dy)) * m.len
  const ty = hy - (m.dy / Math.hypot(m.dx, m.dy)) * m.len
  const g = ctx.createLinearGradient(tx, ty, hx, hy)
  g.addColorStop(0, 'rgba(243,234,211,0)')
  g.addColorStop(1, rgba(palette.moon, 0.85 * a))
  ctx.save()
  ctx.strokeStyle = g
  ctx.lineWidth = 1.4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(hx, hy)
  ctx.stroke()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = a
  ctx.drawImage(glowSprite('#fff4dc', 0.25), hx - 6, hy - 6, 12, 12)
  ctx.restore()
}

