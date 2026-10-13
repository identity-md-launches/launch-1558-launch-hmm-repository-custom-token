/**
 * A damped wave equation on the pond's surface, solved on a perspective grid: columns are screen columns
 * (constant s = x / z) and rows are logarithmically spaced in depth, so every cell covers about the same number of
 * pixels. Waves still travel in world space: the z-direction neighbours are resampled at the same world x, so a
 * splash spreads as a circle on the water (an ellipse on screen) at the same speed everywhere.
 */
import type { Layout } from './camera'
import { clamp } from './rng'

export class WaveSim {
  readonly nx: number
  readonly nz: number
  /** Screen slope per column. */
  readonly ds: number
  /** ln(z) per row. */
  readonly dlz: number
  readonly ic: number
  readonly sMin: number
  readonly zNear: number
  readonly zFar: number
  /** Wave speed (world units / s) and the fixed step. */
  readonly c: number
  readonly dt: number
  readonly h: Float32Array
  readonly v: Float32Array
  /** World-space gradient (dh/dx, dh/dz) per cell, interleaved: what the water shader reads. */
  readonly grad: Float32Array

  private readonly rowZ: Float32Array
  private readonly rowLx: Float32Array
  private readonly kx: Float32Array
  private readonly kzu: Float32Array
  private readonly kzd: Float32Array
  private readonly gzu: Float32Array
  private readonly gzd: Float32Array
  private readonly up0: Int32Array
  private readonly upF: Float32Array
  private readonly dn0: Int32Array
  private readonly dnF: Float32Array
  private readonly dampRow: Float32Array
  private readonly dampCol: Float32Array
  private acc = 0
  /** Mean |h| over the last step, so callers can skip work when the pond is flat. */
  energy = 0
  /** A step ran since the last texture upload. */
  stepped = true

  constructor(L: Layout, budget: number) {
    const sRange = L.sHalf * 2 * 1.03
    const lnRange = Math.log(L.zSim / L.zNear)
    let d = Math.sqrt((sRange * lnRange) / budget)
    let nx = Math.round(sRange / d)
    nx = clamp(nx, 72, 260)
    const ds = sRange / nx
    let nz = Math.round(budget / nx)
    nz = clamp(nz, 96, 280)
    d = lnRange / nz
    this.nx = nx
    this.nz = nz
    this.ds = ds
    this.dlz = d
    this.ic = (nx - 1) / 2
    this.sMin = -this.ic * ds
    this.zNear = L.zNear
    this.zFar = L.zNear * Math.exp(d * (nz - 1))

    const n = nx * nz
    this.h = new Float32Array(n)
    this.v = new Float32Array(n)
    this.grad = new Float32Array(n * 2)
    this.rowZ = new Float32Array(nz)
    this.rowLx = new Float32Array(nz)
    this.kx = new Float32Array(nz)
    this.kzu = new Float32Array(nz)
    this.kzd = new Float32Array(nz)
    this.gzu = new Float32Array(nz)
    this.gzd = new Float32Array(nz)
    this.dampRow = new Float32Array(nz)
    this.dampCol = new Float32Array(nx)

    // Fixed step; the wave speed is the fastest the nearest row allows (CFL), capped at a calm pond's pace.
    this.dt = 1 / 60
    const lx0 = ds * L.zNear
    const lz0 = L.zNear * (Math.exp(d) - 1)
    const cMax = 0.8 / (this.dt * Math.sqrt(1 / (lx0 * lx0) + 1 / (lz0 * lz0)))
    this.c = Math.min(0.62, cMax)
    const c2dt2 = this.c * this.c * this.dt * this.dt

    const tau = 3.2 // seconds for a ripple to fade to 1/e
    const base = Math.exp(-this.dt / tau)
    for (let j = 0; j < nz; j++) {
      const z = L.zNear * Math.exp(d * j)
      this.rowZ[j] = z
      const lx = ds * z
      this.rowLx[j] = lx
      const a = z * (Math.exp(d) - 1) // to the row behind (farther)
      const b = z * (1 - Math.exp(-d)) // to the row in front (nearer)
      this.kx[j] = c2dt2 / (lx * lx)
      this.kzu[j] = (c2dt2 * 2) / (a * (a + b))
      this.kzd[j] = (c2dt2 * 2) / (b * (a + b))
      this.gzu[j] = 1 / (a + b)
      this.gzd[j] = 1 / (a + b)
      // sponge at the near edge and toward the far edge
      const near = clamp(j / 6, 0, 1)
      const far = clamp((nz - 1 - j) / 14, 0, 1)
      this.dampRow[j] = base * (0.86 + 0.14 * Math.min(near, far))
    }
    for (let i = 0; i < nx; i++) {
      const edge = clamp(Math.min(i, nx - 1 - i) / 8, 0, 1)
      this.dampCol[i] = 0.9 + 0.1 * edge
    }
    // Column remaps: the cell in the row behind / in front at the same world x.
    this.up0 = new Int32Array(nx)
    this.upF = new Float32Array(nx)
    this.dn0 = new Int32Array(nx)
    this.dnF = new Float32Array(nx)
    const eu = Math.exp(-d)
    const ed = Math.exp(d)
    for (let i = 0; i < nx; i++) {
      const iu = clamp(this.ic + (i - this.ic) * eu, 0, nx - 1.001)
      const id = clamp(this.ic + (i - this.ic) * ed, 0, nx - 1.001)
      this.up0[i] = Math.floor(iu)
      this.upF[i] = iu - Math.floor(iu)
      this.dn0[i] = Math.floor(id)
      this.dnF[i] = id - Math.floor(id)
    }
  }

  /** Advances the simulation by `elapsed` seconds in fixed steps (at most 3 per call). */
  update(elapsed: number): number {
    this.acc = Math.min(this.acc + elapsed, this.dt * 3)
    let steps = 0
    while (this.acc >= this.dt) {
      this.step()
      this.acc -= this.dt
      steps++
    }
    return steps
  }

  private step(): void {
    const { nx, nz, h, v, kx, kzu, kzd, up0, upF, dn0, dnF, dampRow, dampCol, grad, rowLx, gzu } = this
    let e = 0
    for (let j = 1; j < nz - 1; j++) {
      const row = j * nx
      const rowU = row + nx
      const rowD = row - nx
      const kxj = kx[j]
      const ku = kzu[j]
      const kd = kzd[j]
      const dj = dampRow[j]
      const inv2lx = 0.5 / rowLx[j]
      const gz = gzu[j]
      for (let i = 1; i < nx - 1; i++) {
        const idx = row + i
        const hc = h[idx]
        const hl = h[idx - 1]
        const hr = h[idx + 1]
        const iu = rowU + up0[i]
        const hu = h[iu] + (h[iu + 1] - h[iu]) * upF[i]
        const id = rowD + dn0[i]
        const hd = h[id] + (h[id + 1] - h[id]) * dnF[i]
        const a = kxj * (hl + hr - 2 * hc) + ku * (hu - hc) + kd * (hd - hc)
        v[idx] = (v[idx] + a) * dj * dampCol[i]
        // the slope of the surface as it was at the start of this step (one step behind: invisible)
        grad[idx * 2] = (hr - hl) * inv2lx
        grad[idx * 2 + 1] = (hu - hd) * gz
      }
    }
    this.stepped = true
    const n = nx * nz
    for (let k = 0; k < n; k++) {
      const hv = h[k] + v[k]
      h[k] = hv
      e += hv < 0 ? -hv : hv
    }
    this.energy = e / n
  }

  /** Pushes the water down (amp > 0) around world (x, z) with a smooth bump of radius r. */
  splash(x: number, z: number, r: number, amp: number): void {
    const { nx, nz, h, dlz, ds, ic } = this
    const R = r * 2.2
    const j0 = Math.max(1, Math.floor(Math.log(Math.max(1e-3, z - R) / this.zNear) / dlz))
    const j1 = Math.min(nz - 2, Math.ceil(Math.log((z + R) / this.zNear) / dlz))
    if (j1 < 1 || j0 > nz - 2) return
    for (let j = j0; j <= j1; j++) {
      const zj = this.rowZ[j]
      const dz = zj - z
      if (dz * dz > R * R) continue
      const lx = this.rowLx[j]
      const i0 = Math.max(1, Math.floor((x - R) / zj / ds + ic))
      const i1 = Math.min(nx - 2, Math.ceil((x + R) / zj / ds + ic))
      const row = j * nx
      for (let i = i0; i <= i1; i++) {
        const xi = (i - ic) * lx
        const dx = xi - x
        const q = (dx * dx + dz * dz) / (R * R)
        if (q >= 1) continue
        const w = (1 - q) * (1 - q)
        h[row + i] -= amp * w
      }
    }
  }

  /** Fractional grid coordinates of world (x, z), or null off the grid. */
  private cell(x: number, z: number): [number, number] | null {
    if (z <= this.zNear || z >= this.zFar) return null
    const fj = Math.log(z / this.zNear) / this.dlz
    const fi = x / z / this.ds + this.ic
    if (fi < 0 || fi > this.nx - 1.001 || fj < 0 || fj > this.nz - 1.001) return null
    return [fi, fj]
  }

  /** Water height at world (x, z) (0 off the grid). */
  heightAt(x: number, z: number): number {
    const c = this.cell(x, z)
    if (!c) return 0
    const [fi, fj] = c
    const i = Math.floor(fi)
    const j = Math.floor(fj)
    const tx = fi - i
    const tz = fj - j
    const k = j * this.nx + i
    const h = this.h
    const a = h[k] + (h[k + 1] - h[k]) * tx
    const b = h[k + this.nx] + (h[k + this.nx + 1] - h[k + this.nx]) * tx
    return a + (b - a) * tz
  }

  /** Slope along x at world (x, z), for tilting things that float. */
  slopeXAt(x: number, z: number): number {
    const c = this.cell(x, z)
    if (!c) return 0
    const i = Math.round(c[0])
    const j = Math.round(c[1])
    const k = (j * this.nx + i) * 2
    return this.grad[k] || 0
  }

  /** Refreshes `grad` from `h` (call once per rendered frame, after `update`). */
  computeGradients(): Float32Array {
    const { nx, nz, h, grad, rowLx, gzu, up0, upF, dn0, dnF } = this
    for (let j = 0; j < nz; j++) {
      const row = j * nx
      const inv2lx = 0.5 / rowLx[j]
      const hasU = j < nz - 1
      const hasD = j > 0
      const gz = gzu[j]
      for (let i = 0; i < nx; i++) {
        const idx = row + i
        const hl = i > 0 ? h[idx - 1] : h[idx]
        const hr = i < nx - 1 ? h[idx + 1] : h[idx]
        let hu = h[idx]
        let hd = h[idx]
        if (hasU) {
          const iu = row + nx + up0[i]
          hu = h[iu] + (h[iu + 1] - h[iu]) * upF[i]
        }
        if (hasD) {
          const id = row - nx + dn0[i]
          hd = h[id] + (h[id + 1] - h[id]) * dnF[i]
        }
        grad[idx * 2] = (hr - hl) * inv2lx
        grad[idx * 2 + 1] = (hu - hd) * gz
      }
    }
    return grad
  }

  /** Clears all motion (used when reduced motion is switched on). */
  calm(): void {
    this.h.fill(0)
    this.v.fill(0)
    this.grad.fill(0)
    this.energy = 0
  }
}
