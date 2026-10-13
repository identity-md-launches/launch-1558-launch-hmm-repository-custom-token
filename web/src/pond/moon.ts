/**
 * The moon, painted per pixel at full device resolution so it stays crisp at any DPR (the water's GL target may be
 * rendered smaller). Surface detail (seas, craters, grain) is computed once per size; the light (the era's phase) is
 * re-applied only when the phase changes. The sprite is a disc with an anti-aliased edge and a transparent outside.
 */


/* small, fast 3D value noise for the surface */
function h3(x: number, y: number, z: number): number {
  let n = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x61c88647)
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d)
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39)
  n ^= n >>> 15
  return (n >>> 0) / 4294967296
}

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const w = zf * zf * (3 - 2 * zf)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  const x00 = l(h3(xi, yi, zi), h3(xi + 1, yi, zi), u)
  const x10 = l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u)
  const x01 = l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u)
  const x11 = l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u)
  return l(l(x00, x10, v), l(x01, x11, v), w)
}

function fbm(x: number, y: number, z: number, oct: number): number {
  let s = 0
  let a = 0.5
  let f = 1
  let norm = 0
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f)
    norm += a
    a *= 0.5
    f *= 2.03
  }
  return s / norm
}

const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

interface Crater {
  x: number
  y: number
  z: number
  r: number
  bright: number
}

/** A fixed, original arrangement of craters on the near side (unit vectors, angular radii). */
function craters(): Crater[] {
  const list: Crater[] = []
  let seed = 7
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < 22; i++) {
    const u = rnd() * 1.7 - 0.85
    const v = rnd() * 1.7 - 0.85
    if (u * u + v * v > 0.8) continue
    const z = Math.sqrt(1 - u * u - v * v)
    list.push({ x: u, y: v, z, r: 0.025 + Math.pow(rnd(), 2.2) * 0.1, bright: i % 9 === 0 ? 1 : 0 })
  }
  // two young, bright rayed craters
  list.push({ x: -0.18, y: -0.56, z: Math.sqrt(1 - 0.18 * 0.18 - 0.56 * 0.56), r: 0.05, bright: 1 })
  list.push({ x: 0.46, y: 0.22, z: Math.sqrt(1 - 0.46 * 0.46 - 0.22 * 0.22), r: 0.035, bright: 1 })
  return list
}

const SEAS: { x: number; y: number; r: number; d: number }[] = [
  { x: -0.32, y: 0.3, r: 0.36, d: 0.85 },
  { x: 0.08, y: 0.42, r: 0.24, d: 0.7 },
  { x: -0.5, y: -0.06, r: 0.26, d: 0.6 },
  { x: 0.3, y: 0.05, r: 0.2, d: 0.55 },
  { x: 0.02, y: -0.2, r: 0.18, d: 0.45 },
]

interface Surface {
  size: number
  albedo: Float32Array
  mare: Float32Array
  nx: Float32Array
  ny: Float32Array
  nz: Float32Array
  alpha: Float32Array
}

function buildSurface(R: number): Surface {
  const size = Math.ceil(R) * 2 + 2
  const n = size * size
  const albedo = new Float32Array(n)
  const mare = new Float32Array(n)
  const nx = new Float32Array(n)
  const ny = new Float32Array(n)
  const nz = new Float32Array(n)
  const alpha = new Float32Array(n)
  const c = size / 2
  const cr = craters()
  const crCos = cr.map((k) => Math.cos(Math.min(Math.PI, k.r * 3)))
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = py * size + px
      const dx = (px + 0.5 - c) / R
      const dy = -(py + 0.5 - c) / R
      const d2 = dx * dx + dy * dy
      const dist = Math.sqrt(d2) * R
      const a = Math.min(1, Math.max(0, R - dist + 0.5))
      alpha[i] = a
      if (a <= 0) continue
      const x = dx
      const y = dy
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, d2)))
      nx[i] = x
      ny[i] = y
      nz[i] = z
      // seas: broad soft basins shaped by noise
      let sea = 0
      const wob = (noise3(x * 5 + 3, y * 5, z * 5) - 0.5) * 0.5
      for (const s of SEAS) {
        const ddx = x - s.x
        const ddy = y - s.y
        const q = Math.sqrt(ddx * ddx + ddy * ddy) / s.r
        sea = Math.max(sea, s.d * (1 - sstep(0.55, 1.15, q + wob)))
      }
      const blot = sstep(0.5, 0.72, fbm(x * 1.8 + 11, y * 1.8 + 3, z * 1.8, 4))
      const m = Math.min(1, sea + blot * 0.45)
      // craters: dark floor, bright rim, faint ejecta for the young ones
      let cf = 0
      for (let ci = 0; ci < cr.length; ci++) {
        const k = cr[ci]
        const dot = x * k.x + y * k.y + z * k.z
        if (dot < crCos[ci]) continue
        const ang = Math.acos(Math.min(1, dot))
        const q = ang / k.r
        if (q > 3) continue
        cf += -0.055 * (1 - sstep(0.5, 0.95, q)) + 0.05 * Math.exp(-((q - 1) * (q - 1)) * 14)
        if (k.bright) cf += 0.09 * Math.exp(-q * 1.2) * (0.6 + 0.4 * noise3(x * 40, y * 40, z * 40))
      }
      const grain = (fbm(x * 9 + 1, y * 9 + 5, z * 9 + 7, 2) - 0.5) * 0.12 + (noise3(x * 38, y * 38, z * 38) - 0.5) * 0.05
      mare[i] = m
      albedo[i] = Math.max(0.45, 1 - 0.27 * m + grain + cf)
    }
  }
  return { size, albedo, mare, nx, ny, nz, alpha }
}

export class MoonPainter {
  private surface: Surface | null = null
  private canvas: HTMLCanvasElement = document.createElement('canvas')
  private key = ''

  /**
   * The disc for device-pixel radius R lit at `phase` (0 = full; the lit fraction is (1 + cos phase) / 2), light
   * coming from the right and a little above. Returns a canvas (2⌈R⌉+2 px square) centred on the disc.
   */
  paint(R: number, phase: number): HTMLCanvasElement {
    const r = Math.max(4, Math.round(R))
    const key = `${r}|${phase.toFixed(3)}`
    if (key === this.key) return this.canvas
    if (!this.surface || this.surface.size !== Math.ceil(r) * 2 + 2) this.surface = buildSurface(r)
    const s = this.surface
    const cv = this.canvas
    if (cv.width !== s.size) {
      cv.width = s.size
      cv.height = s.size
    }
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(s.size, s.size)
    const out = img.data
    const tilt = 0.28
    const lx = Math.sin(phase) * Math.cos(tilt)
    const ly = Math.sin(phase) * Math.sin(tilt)
    const lz = Math.cos(phase)
    for (let i = 0; i < s.size * s.size; i++) {
      const a = s.alpha[i]
      if (a <= 0) continue
      const x = s.nx[i]
      const y = s.ny[i]
      const z = s.nz[i]
      const ndl = x * lx + y * ly + z * lz
      const lit = sstep(-0.035, 0.16, ndl)
      const alb = s.albedo[i]
      const m = s.mare[i]
      // highlands cream, seas a cooler grey; a hint of warmth toward the terminator; gentle limb darkening
      const limb = 0.8 + 0.2 * Math.sqrt(z)
      const shade = (0.8 + 0.2 * Math.sqrt(Math.max(0, ndl))) * limb * alb
      const warm = (1 - sstep(0.0, 0.42, ndl)) * 0.55
      let r0 = 246 - 38 * m
      let g0 = 238 - 30 * m
      let b0 = 216 - 6 * m
      r0 += (244 - r0) * warm * 0.4
      g0 += (214 - g0) * warm * 0.4
      b0 += (168 - b0) * warm * 0.4
      // earthshine: the dark side barely there, its seas just readable
      const er = 17 + 9 * alb
      const eg = 21 + 10 * alb
      const eb = 27 + 11 * alb
      const k = i * 4
      out[k] = er + (r0 * shade - er) * lit
      out[k + 1] = eg + (g0 * shade - eg) * lit
      out[k + 2] = eb + (b0 * shade - eb) * lit
      out[k + 3] = a * 255
    }
    ctx.putImageData(img, 0, 0)
    this.key = key
    return cv
  }
}

