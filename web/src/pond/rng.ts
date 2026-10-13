/** Small deterministic helpers for the pond: a seeded RNG and integer hashes. */

/** mulberry32: a fast seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash of an integer to [0, 1). */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** Hash of a string to a 32-bit unsigned integer (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Smooth 1D value noise in [0, 1]; same formula as the shader's tree line so both agree. */
export function noise1(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const a = hash01(i)
  const b = hash01(i + 1)
  const u = f * f * (3 - 2 * f)
  return a + (b - a) * u
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
/** Frame-rate independent exponential approach: move `cur` toward `target` with time constant `tau` seconds. */
export const approach = (cur: number, target: number, dt: number, tau: number) =>
  target + (cur - target) * Math.exp(-dt / Math.max(1e-4, tau))
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
export const easeInOutCubic = (t: number) => {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
export const easeOutBack = (t: number, s = 1.70158) => {
  const x = clamp(t, 0, 1) - 1
  return x * x * ((s + 1) * x + s) + 1
}

/* ── the far tree line, shared by the shader (water-gl.ts), the 2D fallback and the moon's clip ── */

/** Bit-exact port of the shader's `hash11` (a PCG-style integer hash), for integer-valued x. */
export function glHash11(x: number): number {
  let n = (Math.trunc(x) + 2147483) >>> 0
  n = (Math.imul(n, 747796405) + 2891336453) >>> 0
  n = Math.imul(((n >>> (((n >>> 28) + 4) >>> 0)) ^ n) >>> 0, 277803737) >>> 0
  n = ((n >>> 22) ^ n) >>> 0
  return n / 4294967295
}

function glNoise(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const a = glHash11(i)
  return a + (glHash11(i + 1) - a) * u
}

function glCrowns(u: number, k: number, seed: number): number {
  const x = u * k + seed
  const i = Math.floor(x)
  const f = x - i
  const r = glHash11(i * 3 + 11)
  const h = 0.35 + 0.65 * glHash11(i * 7 + 5)
  const c = 2 * f - 1
  const round = Math.sqrt(Math.max(0, 1 - c * c))
  const pine = Math.pow(Math.max(0, 1 - Math.abs(c) * 1.08), 0.85)
  return h * (r < 0.6 ? round : pine)
}

/** Tree height (world units) along the far shore at u = x / shoreZ; the same function as the shader's `treeH`. */
export function treeHeight(u: number): number {
  const ridge = 1.1 + 0.5 * glNoise(u * 3.1 + 7.3) + 0.25 * glNoise(u * 9 + 1.1)
  const a = ridge + 1.05 * glCrowns(u, 27, 0) * (0.45 + 0.55 * glNoise(u * 4.3 + 2))
  const b = ridge + 0.9 * glCrowns(u, 43, 0.37) * glNoise(u * 6.1 + 9)
  return Math.max(a, b)
}
