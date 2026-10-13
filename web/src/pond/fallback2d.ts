/**
 * Sky and water without WebGL2: gradients, a star field, the phased moon behind a tree line, a shimmering glade and
 * expanding ripple rings for splashes. Calmer than the shader, same composition.
 */
import type { Layout } from './camera'
import { mulberry32, treeHeight } from './rng'

export interface FallbackState {
  time: number
  litFraction: number
  moonX: number
  moonY: number
  moonR: number
  moonBright: number
  moonWarm: number
  glade: number
  ripples: { x: number; y: number; age: number; strength: number }[]
}

export class Water2D {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private stars: { x: number; y: number; r: number; a: number; p: number }[] = []
  private trees: Path2D | null = null
  private key = ''
  scale = 1

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  resize(cssW: number, cssH: number, scale: number): void {
    this.scale = scale
    const w = Math.max(1, Math.round(cssW * scale))
    const h = Math.max(1, Math.round(cssH * scale))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  private prepare(L: Layout): void {
    const key = `${L.width}x${L.height}`
    if (key === this.key) return
    this.key = key
    const rnd = mulberry32(7)
    this.stars = []
    const n = Math.round((L.width * L.horizon) / 900)
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: rnd() * L.width,
        y: rnd() * L.horizon * 0.96,
        r: 0.4 + Math.pow(rnd(), 4) * 1.3,
        a: 0.25 + rnd() * 0.75,
        p: rnd() * Math.PI * 2,
      })
    }
    const p = new Path2D()
    p.moveTo(0, L.horizon + 4)
    for (let x = 0; x <= L.width; x += 2) {
      const u = (x - L.cx) / L.f
      const t = treeHeight(u)
      p.lineTo(x, L.horizon - ((t - L.camH) / L.zShore) * L.f)
    }
    p.lineTo(L.width, L.horizon + (L.f * L.camH) / L.zShore)
    p.lineTo(0, L.horizon + (L.f * L.camH) / L.zShore)
    p.closePath()
    this.trees = p
  }

  render(L: Layout, s: FallbackState): void {
    this.prepare(L)
    const ctx = this.ctx
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)
    const W = L.width
    const H = L.height
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, L.horizon)
    sky.addColorStop(0, '#0a0e12')
    sky.addColorStop(0.6, '#101920')
    sky.addColorStop(1, '#1a2a2e')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, W, L.horizon + 1)
    for (const st of this.stars) {
      ctx.globalAlpha = st.a * (0.65 + 0.35 * Math.sin(s.time * 1.3 + st.p))
      ctx.fillStyle = '#e8ecf5'
      ctx.beginPath()
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // moon halo and disc with phase
    const { moonX: mx, moonY: my, moonR: r } = s
    const warm = s.moonWarm
    const moonCol = warm > 0.5 ? '#f6c48a' : '#f3ead3'
    const halo = ctx.createRadialGradient(mx, my, r * 0.9, mx, my, r * 5)
    halo.addColorStop(0, `rgba(243,234,211,${0.22 * s.moonBright})`)
    halo.addColorStop(1, 'rgba(243,234,211,0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(mx, my, r * 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.globalAlpha = 0.45 + 0.55 * s.moonBright
    ctx.fillStyle = '#1b232a'
    ctx.beginPath()
    ctx.arc(mx, my, r, 0, Math.PI * 2)
    ctx.fill()
    const f = Math.max(0, Math.min(1, s.litFraction))
    ctx.fillStyle = moonCol
    ctx.beginPath()
    ctx.arc(mx, my, r, -Math.PI / 2, Math.PI / 2)
    const k = Math.abs(2 * f - 1) * r
    if (f >= 0.5) ctx.ellipse(mx, my, k, r, 0, Math.PI / 2, -Math.PI / 2)
    else ctx.ellipse(mx, my, k, r, 0, Math.PI / 2, (3 * Math.PI) / 2, true)
    ctx.fill()
    ctx.restore()
    // water
    const wg = ctx.createLinearGradient(0, L.horizon, 0, H)
    wg.addColorStop(0, '#16292b')
    wg.addColorStop(0.25, '#0f1d1d')
    wg.addColorStop(1, '#0d1b1a')
    ctx.fillStyle = wg
    ctx.fillRect(0, L.horizon, W, H - L.horizon)
    // glade: shimmering streaks under the moon
    const top = L.horizon + 6
    const len = (H - L.horizon) * (0.18 + 0.5 * s.glade)
    for (let y = top; y < top + len; y += 3) {
      const u = (y - top) / len
      const wdt = r * (0.4 + 1.6 * u) * (0.6 + 0.4 * Math.sin(y * 0.37 + s.time * 2.1))
      ctx.globalAlpha = (1 - u) * 0.35 * s.moonBright * (0.5 + 0.5 * Math.sin(y * 1.7 + s.time * 3.3))
      ctx.fillStyle = moonCol
      ctx.fillRect(mx - wdt / 2 + Math.sin(y * 0.11 + s.time) * 4, y, wdt, 1.4)
    }
    ctx.globalAlpha = 1
    // trees and the far shore
    if (this.trees) {
      ctx.fillStyle = '#050b0b'
      ctx.fill(this.trees)
    }
    // ripples
    ctx.lineWidth = 1.2
    for (const rp of s.ripples) {
      const a = Math.max(0, 1 - rp.age / 2.4) * 0.45 * rp.strength
      if (a <= 0) continue
      const z = (L.f * L.camH) / Math.max(1, rp.y - L.horizon)
      const rr = rp.age * 0.55 * (L.f / z)
      ctx.strokeStyle = `rgba(243,234,211,${a})`
      ctx.beginPath()
      ctx.ellipse(rp.x, rp.y, rr + 1, (rr + 1) * Math.min(0.8, L.camH / z), 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  dispose(): void {
    this.stars = []
  }
}
