/**
 * Pre-rendered sprites for the pond's 2D layer: frogs (drawn from the same shapes as the SVG mascot), lily pads,
 * glows and little thought bubbles. Each comes in a mip chain so tiny far frogs stay crisp and cheap.
 */
import { palette } from '../theme'

export type Sprite = HTMLCanvasElement

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  const ctx = c.getContext('2d')!
  return [c, ctx]
}

/* ───────────────────────────── frogs ───────────────────────────── */

/** The mascot's shapes (240×240 viewBox). */
const BODY = 'M30 168C30 112 72 88 120 88C168 88 210 112 210 168C210 200 172 214 120 214C68 214 30 200 30 168Z'
const THINK_ARM = 'M199 158C194 182 178 196 163 193C151 190 144 172 142 155'
const REST_ARM = 'M50 180C66 198 116 206 166 194'
const LEG_L = 'M60 172C52 190 56 204 74 209'
const LEG_R = 'M180 172C188 190 184 204 166 209'
const MOUTH = 'M102 133C108 128.5 114 137 120 133S132 128.5 138 133'

/** Sprite box in mascot units. */
export const FROG_BOX = { x: 20, y: 46, w: 200, h: 188 }
/** Where the frog sits (feet contact), as fractions of the sprite box. */
export const FROG_ANCHOR = { x: (120 - 20) / 200, y: (224 - 46) / 188 }
/** Eye centres relative to the anchor, in mascot units; sclera and pupil radii. */
export const FROG_EYES = { lx: -38, rx: 38, y: -140, sclera: 22, pupil: 10.5, look: 8.5 }

export interface FrogColors {
  skinA: string
  skinB: string
  skinC: string
  outline: string
  belly: string
  limb: string
  foot: string
}

export const FROG_VARIANTS: FrogColors[] = [
  { skinA: '#9fd598', skinB: '#86c682', skinC: '#558f5e', outline: '#24503a', belly: '#c6e0b5', limb: '#7bbb78', foot: '#6aa96b' },
  { skinA: '#b4d590', skinB: '#97c178', skinC: '#668f52', outline: '#33502b', belly: '#d6e2b4', limb: '#8db872', foot: '#7ea763' },
  { skinA: '#97d5b3', skinB: '#78be99', skinC: '#4d8a71', outline: '#204d3e', belly: '#c3e1d1', limb: '#70b592', foot: '#61a283' },
]

let paths: Record<string, Path2D> | null = null
function frogPaths(): Record<string, Path2D> {
  if (!paths) {
    paths = {
      body: new Path2D(BODY),
      think: new Path2D(THINK_ARM),
      rest: new Path2D(REST_ARM),
      legL: new Path2D(LEG_L),
      legR: new Path2D(LEG_R),
      mouth: new Path2D(MOUTH),
    }
  }
  return paths
}

/** Draws a frog in mascot units (call after scaling the context). pose 0 = thinking, 1 = sitting. */
export function drawFrog(ctx: CanvasRenderingContext2D, col: FrogColors, pose: number, pupils: boolean): void {
  const p = frogPaths()
  const circle = (x: number, y: number, r: number) => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
  }
  const ellipse = (x: number, y: number, rx: number, ry: number) => {
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // outline pass
  ctx.fillStyle = col.outline
  ctx.strokeStyle = col.outline
  ctx.lineWidth = 11
  for (const [x, y] of [
    [70, 214],
    [170, 214],
  ]) {
    ellipse(x, y, 27, 10)
    ctx.fill()
    ctx.stroke()
  }
  ctx.fill(p.body)
  ctx.stroke(p.body)
  for (const x of [82, 158]) {
    circle(x, 86, 32)
    ctx.fill()
    ctx.stroke()
  }
  // fill pass
  const g = ctx.createRadialGradient(100, 96, 8, 120, 140, 130)
  g.addColorStop(0, col.skinA)
  g.addColorStop(0.55, col.skinB)
  g.addColorStop(1, col.skinC)
  ctx.fillStyle = col.foot
  ellipse(70, 214, 27, 10)
  ctx.fill()
  ellipse(170, 214, 27, 10)
  ctx.fill()
  ctx.fillStyle = g
  ctx.fill(p.body)
  circle(82, 86, 32)
  ctx.fill()
  circle(158, 86, 32)
  ctx.fill()
  // a little moonlight from the upper right
  const rim = ctx.createRadialGradient(176, 92, 4, 176, 92, 70)
  rim.addColorStop(0, 'rgba(243,234,211,0.22)')
  rim.addColorStop(1, 'rgba(243,234,211,0)')
  ctx.fillStyle = rim
  ctx.fill(p.body)
  // shade at the bottom
  const sh = ctx.createLinearGradient(0, 150, 0, 216)
  sh.addColorStop(0, 'rgba(12,17,22,0)')
  sh.addColorStop(1, 'rgba(12,17,22,0.22)')
  ctx.fillStyle = sh
  ctx.fill(p.body)
  // toes
  ctx.fillStyle = col.skinB
  ctx.strokeStyle = col.outline
  ctx.lineWidth = 3
  for (const [x, y] of [
    [50, 217],
    [64, 221],
    [190, 217],
    [176, 221],
  ]) {
    circle(x, y, 6)
    ctx.fill()
    ctx.stroke()
  }
  // belly and freckles
  ctx.globalAlpha = 0.92
  ctx.fillStyle = col.belly
  ellipse(118, 180, 58, 31)
  ctx.fill()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = col.skinC
  for (const [x, y, r] of [
    [110, 104, 4.2],
    [124, 98, 3],
    [134, 107, 3.4],
  ]) {
    circle(x, y, r)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  // eyes
  ctx.fillStyle = '#f6f0df'
  circle(82, 84, 22)
  ctx.fill()
  circle(158, 84, 22)
  ctx.fill()
  if (pupils) {
    ctx.fillStyle = palette.ink
    circle(86, 79, 10.5)
    ctx.fill()
    circle(162, 79, 10.5)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    circle(90, 74.5, 3.6)
    ctx.fill()
    circle(166, 74.5, 3.6)
    ctx.fill()
  }
  // cheeks and mouth
  ctx.globalAlpha = 0.5
  ctx.fillStyle = '#ffb3a6'
  ellipse(66, 130, 12, 7)
  ctx.fill()
  ellipse(174, 128, 12, 7)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = palette.ink
  ctx.lineWidth = 4.5
  ctx.stroke(p.mouth)
  // limbs
  const limb = (path: Path2D, w: number) => {
    ctx.strokeStyle = col.outline
    ctx.lineWidth = w + 10
    ctx.stroke(path)
    ctx.strokeStyle = col.limb
    ctx.lineWidth = w
    ctx.stroke(path)
  }
  if (pose === 0) {
    limb(p.rest, 14)
    limb(p.think, 15)
    ctx.fillStyle = col.skinB
    ctx.strokeStyle = col.outline
    ctx.lineWidth = 3.5
    for (const [x, y, r] of [
      [141, 150, 8],
      [134, 143, 6.5],
      [147, 142, 6.5],
    ]) {
      circle(x, y, r)
      ctx.fill()
      ctx.stroke()
    }
  } else {
    limb(p.legL, 13)
    limb(p.legR, 13)
  }
}

export interface FrogSpriteSet {
  /** [variant][pose] → mip chain, largest first. `near` sprites have no pupils (drawn live). */
  near: Sprite[][][]
  far: Sprite[][][]
  nearLevels: number[]
  farLevels: number[]
}

let frogSet: FrogSpriteSet | null = null

export function frogSprites(): FrogSpriteSet {
  if (frogSet) return frogSet
  const nearLevels = [192, 96, 48]
  const farLevels = [48, 24, 12]
  const make = (level: number, variant: number, pose: number, pupils: boolean) => {
    const s = level / FROG_BOX.h
    const [c, ctx] = canvas(FROG_BOX.w * s + 2, level + 2)
    ctx.translate(1, 1)
    ctx.scale(s, s)
    ctx.translate(-FROG_BOX.x, -FROG_BOX.y)
    drawFrog(ctx, FROG_VARIANTS[variant], pose, pupils)
    return c
  }
  const near: Sprite[][][] = []
  const far: Sprite[][][] = []
  for (let v = 0; v < FROG_VARIANTS.length; v++) {
    near.push([0, 1].map((pose) => nearLevels.map((lv) => make(lv, v, pose, false))))
    far.push([0, 1].map((pose) => farLevels.map((lv) => make(lv, v, pose, true))))
  }
  frogSet = { near, far, nearLevels, farLevels }
  return frogSet
}

/** Picks the mip whose height is the smallest one ≥ the wanted device-pixel height. */
export function pickLevel(levels: number[], want: number): number {
  for (let i = levels.length - 1; i >= 0; i--) if (levels[i] >= want) return i
  return 0
}

/* ───────────────────────────── lily pads ───────────────────────────── */

export interface PadSpriteSet {
  /** [colour][rotation] → mip chain, largest first (square, seen from above). */
  pads: Sprite[][][]
  levels: number[]
  rotations: number
  flower: Sprite[]
  flowerLevels: number[]
}

let padSet: PadSpriteSet | null = null

const PAD_COLORS = [
  { a: '#4b8c64', b: palette.lily, c: '#2c5c45', rim: '#20453a', vein: '#64a37a' },
  { a: '#55905c', b: '#467a4f', c: '#2f5638', rim: '#233f2e', vein: '#6ea06f' },
]

function drawPad(ctx: CanvasRenderingContext2D, d: number, notch: number, ci: number): void {
  const col = PAD_COLORS[ci]
  const r = (d / 2) * 0.92
  ctx.save()
  ctx.translate(d / 2, d / 2)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.arc(0, 0, r, notch + 0.26, notch - 0.26 + Math.PI * 2)
  ctx.closePath()
  const g = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.05, 0, 0, r)
  g.addColorStop(0, col.a)
  g.addColorStop(0.6, col.b)
  g.addColorStop(1, col.c)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = Math.max(0.6, d * 0.028)
  ctx.strokeStyle = col.rim
  ctx.stroke()
  if (d >= 24) {
    ctx.globalAlpha = 0.42
    ctx.strokeStyle = col.vein
    ctx.lineWidth = Math.max(0.5, d * 0.011)
    const n = 11
    for (let k = 0; k < n; k++) {
      const a = notch + 0.5 + (k / (n - 1)) * (Math.PI * 2 - 1.0)
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * r * 0.08, Math.sin(a) * r * 0.08)
      ctx.quadraticCurveTo(
        Math.cos(a + 0.08) * r * 0.5,
        Math.sin(a + 0.08) * r * 0.5,
        Math.cos(a) * r * 0.9,
        Math.sin(a) * r * 0.9,
      )
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

function drawFlower(ctx: CanvasRenderingContext2D, d: number): void {
  ctx.save()
  ctx.translate(d / 2, d * 0.62)
  const s = d / 100
  ctx.scale(s, s)
  const petal = (angle: number, len: number, w: number, color: string) => {
    ctx.save()
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(-w, -len * 0.55, 0, -len)
    ctx.quadraticCurveTo(w, -len * 0.55, 0, 0)
    ctx.fillStyle = color
    ctx.fill()
    ctx.restore()
  }
  for (const a of [-1.25, 1.25, -0.8, 0.8]) petal(a, 40, 16, '#e9dcff')
  for (const a of [-0.42, 0.42]) petal(a, 46, 17, '#f3ead3')
  petal(0, 50, 18, '#fbf6ea')
  ctx.beginPath()
  ctx.arc(0, -6, 8, 0, Math.PI * 2)
  ctx.fillStyle = palette.gold
  ctx.fill()
  ctx.restore()
}

export function padSprites(): PadSpriteSet {
  if (padSet) return padSet
  const levels = [256, 128, 64, 32, 16]
  const rotations = 8
  const pads: Sprite[][][] = []
  for (let ci = 0; ci < PAD_COLORS.length; ci++) {
    const byRot: Sprite[][] = []
    for (let k = 0; k < rotations; k++) {
      const notch = (k / rotations) * Math.PI * 2 + 0.3
      byRot.push(
        levels.map((lv) => {
          const [c, ctx] = canvas(lv, lv)
          drawPad(ctx, lv, notch, ci)
          return c
        }),
      )
    }
    pads.push(byRot)
  }
  const flowerLevels = [96, 48, 24]
  const flower = flowerLevels.map((lv) => {
    const [c, ctx] = canvas(lv, lv)
    drawFlower(ctx, lv)
    return c
  })
  padSet = { pads, levels, rotations, flower, flowerLevels }
  return padSet
}

/* ───────────────────────────── glows ───────────────────────────── */

const glowCache = new Map<string, Sprite>()

/** A soft round glow (for additive blending): full colour at the centre, transparent at the edge. */
export function glowSprite(color: string, core = 0.18): Sprite {
  const key = `${color}|${core}`
  const hit = glowCache.get(key)
  if (hit) return hit
  const size = 128
  const [c, ctx] = canvas(size, size)
  const n = parseInt(color.slice(1), 16)
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, `rgba(${rgb},1)`)
  g.addColorStop(core, `rgba(${rgb},0.55)`)
  g.addColorStop(0.45, `rgba(${rgb},0.16)`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  glowCache.set(key, c)
  return c
}

/* ───────────────────────────── thought bubbles ───────────────────────────── */

export const FONT_STACK = '"Bricolage Grotesque Variable", "Bricolage Grotesque", ui-rounded, "Segoe UI", system-ui, sans-serif'

export type BubbleKind = 'hmm' | 'ask' | 'dots'

const bubbleCache = new Map<BubbleKind, Sprite>()

/** Sprite height in device px; drawn scaled down. The tail points to the bottom-left (toward the frog). */
export const BUBBLE_H = 96

export function bubbleSprite(kind: BubbleKind): Sprite {
  const hit = bubbleCache.get(kind)
  if (hit) return hit
  const text = kind === 'hmm' ? 'hmm…' : kind === 'ask' ? '?' : '…'
  const H = BUBBLE_H
  const bodyH = H * 0.62
  const font = `700 ${Math.round(bodyH * 0.5)}px ${FONT_STACK}`
  const [m, mctx] = canvas(4, 4)
  void m
  mctx.font = font
  const tw = mctx.measureText(text).width
  const bodyW = Math.max(bodyH * 1.05, tw + bodyH * 0.7)
  const W = bodyW + H * 0.22
  const [c, ctx] = canvas(W, H)
  const fill = kind === 'ask' ? '#e6ddff' : '#f6f0df'
  const ink = kind === 'ask' ? '#3b2f73' : palette.ink
  const x0 = H * 0.2
  ctx.fillStyle = fill
  // cloud: a rounded body with a few bumps
  const cx = x0 + bodyW / 2
  const cy = bodyH / 2 + 2
  ctx.beginPath()
  ctx.ellipse(cx, cy, bodyW / 2 - 2, bodyH / 2 - 2, 0, 0, Math.PI * 2)
  ctx.fill()
  const bumps = Math.max(2, Math.round(bodyW / (bodyH * 0.55)))
  for (let k = 0; k < bumps; k++) {
    const bx = x0 + bodyH * 0.35 + (k / Math.max(1, bumps - 1)) * (bodyW - bodyH * 0.7)
    ctx.beginPath()
    ctx.arc(bx, cy - bodyH * 0.22, bodyH * 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  // trail
  ctx.beginPath()
  ctx.arc(x0 + bodyH * 0.12, bodyH + H * 0.08, H * 0.075, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x0 - H * 0.08, bodyH + H * 0.26, H * 0.05, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = ink
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, cy + bodyH * 0.02)
  bubbleCache.set(kind, c)
  return c
}

/** Fonts arrived: rebuild text sprites so they use the real typeface. */
export function resetTextSprites(): void {
  bubbleCache.clear()
}
