/**
 * The pond's camera: a pinhole at height `camH` above a flat pond (y = 0), looking along +z, with the principal point
 * shifted so the horizon sits where we want it on screen (no pitch, so vertical things stay vertical).
 *
 *   screen x = cx + f * x / z
 *   screen y = horizon + f * (camH - y) / z
 *
 * Every length here is in CSS pixels on screen and in "world units" in the pond (camH = 1 unit ≈ a metre).
 */
import { clamp } from './rng'

export interface Layout {
  width: number
  height: number
  portrait: boolean
  horizon: number
  f: number
  cx: number
  camH: number
  /** Depth seen at the bottom edge of the screen. */
  zNear: number
  /** Farthest frogs. */
  zFrogs: number
  /** Far edge of the simulated water. */
  zSim: number
  /** The far shore, where the tree line stands. */
  zShore: number
  /** Half the screen width divided by f: |x / z| < sHalf is on screen. */
  sHalf: number
  moon: { x: number; y: number; r: number }
  /** Unit vector toward the moon's centre. */
  moonDir: [number, number, number]
  /** Moon angular radius (radians). */
  moonAng: number
}

export function computeLayout(width: number, height: number): Layout {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const portrait = h > w * 1.05
  const horizon = Math.round(h * (portrait ? 0.35 : 0.41))
  const camH = 1
  const zNear = 1.25
  const f = ((h - horizon) * zNear) / camH
  const cx = w / 2
  const r = clamp(Math.min(w, h) * (portrait ? 0.068 : 0.052), 20, 58)
  const mx = w * (portrait ? 0.7 : 0.765)
  const my = clamp(horizon * 0.44, r * 1.6 + 64, horizon - r * 2.4)
  const dx = (mx - cx) / f
  const dy = (horizon - my) / f
  const len = Math.hypot(dx, dy, 1)
  return {
    width: w,
    height: h,
    portrait,
    horizon,
    f,
    cx,
    camH,
    zNear,
    zFrogs: portrait ? 17 : 21,
    zSim: 22,
    zShore: 44,
    sHalf: w / 2 / f,
    moon: { x: mx, y: my, r },
    moonDir: [dx / len, dy / len, 1 / len],
    moonAng: Math.atan(r / f) * Math.pow(1 / len, 1.5),
  }
}

/** Reusable output for `project` to avoid allocations in hot loops. */
export interface ScreenPoint {
  x: number
  y: number
  /** CSS px per world unit at this depth. */
  k: number
}

export function project(L: Layout, x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
  const k = L.f / z
  out.x = L.cx + x * k
  out.y = L.horizon + (L.camH - y) * k
  out.k = k
  return out
}

/** Screen point → where the camera ray meets the water, or null above the horizon / beyond the shore. */
export function toWater(L: Layout, px: number, py: number): { x: number; z: number } | null {
  const dy = py - L.horizon
  if (dy <= 0.5) return null
  const z = (L.f * L.camH) / dy
  if (z > L.zShore) return null
  return { x: ((px - L.cx) * z) / L.f, z }
}

/** Apparent vertical squash of a small horizontal disc at depth z (1 = seen from straight above). */
export function discSquash(L: Layout, z: number): number {
  return Math.min(0.86, L.camH / z)
}

/** Direction and angular radius of a moon of radius r drawn at screen (mx, my). */
export function moonAt(L: Layout, mx: number, my: number, r: number): { dir: [number, number, number]; ang: number } {
  const dx = (mx - L.cx) / L.f
  const dy = (L.horizon - my) / L.f
  const len = Math.hypot(dx, dy, 1)
  return { dir: [dx / len, dy / len, 1 / len], ang: Math.atan(r / L.f) * Math.pow(1 / len, 1.5) }
}
