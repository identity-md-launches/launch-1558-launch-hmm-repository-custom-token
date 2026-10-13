/**
 * WebGL2 sky and water. One full-screen triangle; the fragment shader traces a camera ray per pixel:
 * above the horizon it shades the night sky (gradient, stars, a faint milky band, the moon as a lit sphere whose phase
 * follows the halving era, its halo) behind a distant tree line; below, it finds the water point, perturbs the normal
 * with the CPU wave simulation (an RG32F gradient texture) plus small procedural wind waves, and reflects the same
 * sky (Fresnel-weighted over the deep pond colour), with a glint lobe toward the moon that draws the moon's glade.
 */
import type { Layout } from './camera'
import type { WaveSim } from './sim'

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec2 uRes;
uniform float uPx;
uniform float uHorizon;
uniform float uF;
uniform float uCx;
uniform float uCamH;
uniform float uTime;
uniform vec3 uMoonDir;
uniform float uMoonAng;
uniform float uPhase;
uniform float uMoonBright;
uniform float uMoonWarm;
uniform float uGladeSigma;
uniform float uGladeGain;
uniform float uShoreZ;
uniform sampler2D uSim;
uniform vec4 uSimInfo;   // sMin, ds, zNear, dlz
uniform vec2 uSimSize;   // nx, nz
uniform float uRippleGain;
uniform int uLinear;
uniform float uWind;     // 0 = glassy (reduced motion), 1 = normal
uniform vec3 uMoonPx;    // moon centre (x, y) and radius on screen, CSS px
uniform float uLit;      // lit fraction of the moon's disc

out vec4 outColor;

const vec3 ZENITH = vec3(0.039, 0.055, 0.071);
const vec3 SKY_MID = vec3(0.063, 0.098, 0.118);
const vec3 SKY_LOW = vec3(0.102, 0.165, 0.180);
const vec3 HAZE = vec3(0.078, 0.137, 0.141);
const vec3 POND = vec3(0.050, 0.104, 0.102);
const vec3 POND_NEAR = vec3(0.071, 0.141, 0.133);
const vec3 TREE = vec3(0.020, 0.040, 0.039);
const vec3 TREE_RIM = vec3(0.130, 0.215, 0.180);
const vec3 MOON = vec3(0.953, 0.918, 0.827);
const vec3 MOON_WARM = vec3(0.985, 0.760, 0.520);
const vec3 EARTHSHINE = vec3(0.090, 0.110, 0.125);
const vec3 HALO = vec3(0.560, 0.560, 0.500);

float hash12(vec2 p) {
  uvec2 q = uvec2(ivec2(p) + ivec2(65536)) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}
float hash11(float x) {
  uint n = uint(int(x) + 2147483) * 747796405u + 2891336453u;
  n = ((n >> ((n >> 28u) + 4u)) ^ n) * 277803737u;
  n = (n >> 22u) ^ n;
  return float(n) * (1.0 / 4294967295.0);
}
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), u);
}
float crowns(float u, float k, float seed) {
  float x = u * k + seed;
  float i = floor(x);
  float f = fract(x);
  float r = hash11(i * 3.0 + 11.0);
  float h = mix(0.35, 1.0, hash11(i * 7.0 + 5.0));
  float c = 2.0 * f - 1.0;
  float roundCrown = sqrt(max(0.0, 1.0 - c * c));
  float pine = pow(max(0.0, 1.0 - abs(c) * 1.08), 0.85);
  return h * mix(roundCrown, pine, step(0.6, r));
}
// Tree height (world units) along the far shore; u = x / shoreZ.
float treeH(float u) {
  float ridge = 1.1 + 0.5 * vnoise(u * 3.1 + 7.3) + 0.25 * vnoise(u * 9.0 + 1.1);
  float a = ridge + 1.05 * crowns(u, 27.0, 0.0) * (0.45 + 0.55 * vnoise(u * 4.3 + 2.0));
  float b = ridge + 0.9 * crowns(u, 43.0, 0.37) * vnoise(u * 6.1 + 9.0);
  return max(a, b);
}

vec3 stars(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, d.z);
  vec3 acc = vec3(0.0);
  // two layers: many faint, a few bright
  for (int layer = 0; layer < 2; layer++) {
    float k = layer == 0 ? 150.0 : 55.0;
    float thr = layer == 0 ? 0.955 : 0.93;
    vec2 p = vec2(az, el) * k;
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float h = hash12(cell + float(layer) * 91.0);
    if (h > thr) {
      vec2 sp = vec2(hash12(cell + 13.0), hash12(cell + 29.0)) * 0.6 + 0.2;
      float dpx = length(f - sp) / k * uF;
      float mag = pow((h - thr) / (1.0 - thr), 2.2);
      float tw = 0.62 + 0.38 * sin(uTime * (0.7 + 2.6 * hash12(cell + 3.0)) + 6.2831 * hash12(cell + 7.0));
      float size = layer == 0 ? 1.9 : 0.9;
      float core = exp(-dpx * dpx * size) * (layer == 0 ? 0.28 + 0.9 * mag : 0.55 + 1.1 * mag);
      vec3 tint = mix(vec3(0.80, 0.86, 1.0), vec3(1.0, 0.90, 0.76), hash12(cell + 41.0));
      acc += tint * core * tw;
    }
  }
  return acc;
}

vec3 sky(vec3 d, bool withStars, bool withDisc) {
  float e = d.y;
  vec3 col = mix(SKY_LOW, SKY_MID, smoothstep(0.0, 0.16, e));
  col = mix(col, ZENITH, smoothstep(0.12, 0.62, e));
  // a faint milky band
  float az = atan(d.x, d.z);
  float band = e - (0.30 + 0.22 * az);
  float m = exp(-band * band * 34.0) * (0.55 + 0.45 * vnoise(az * 14.0 + e * 9.0)) * smoothstep(0.02, 0.2, e);
  col += vec3(0.035, 0.040, 0.050) * m;

  // the moon lives on the screen-space sky dome so it is a true circle wherever it sits
  float zz = max(d.z, 1e-3);
  vec2 sp = vec2(uCx + uF * d.x / zz, uHorizon - uF * d.y / zz);
  vec2 uv = vec2(sp.x - uMoonPx.x, uMoonPx.y - sp.y) / uMoonPx.z;
  float a = d.z > 0.02 ? length(uv) : 1e3;
  float glow = 0.34 * exp(-max(a - 1.0, 0.0) * 1.05) + 0.16 * exp(-max(a - 1.0, 0.0) * 0.13);
  vec3 moonCol = mix(MOON, MOON_WARM, uMoonWarm);
  col += mix(HALO, moonCol * 0.7, uMoonWarm) * glow * uMoonBright * (0.35 + 0.65 * uLit);
  if (withStars) col += stars(d) * smoothstep(1.6, 5.5, a) * smoothstep(0.0, 0.05, e) * (1.0 - 0.5 * uMoonBright * exp(-a * 0.08));

  if (withDisc && a < 1.08) {
    float r = a;
    float aa = 1.5 / uMoonPx.z;
    float mask = 1.0 - smoothstep(1.0 - aa, 1.0, r);
    vec3 n = vec3(uv, sqrt(max(0.0, 1.0 - r * r)));
    vec3 L = vec3(sin(uPhase), 0.0, cos(uPhase));
    float l = dot(n, L);
    vec2 q1 = uv - vec2(-0.30, 0.24);
    vec2 q2 = uv - vec2(0.16, 0.34);
    vec2 q3 = uv - vec2(0.02, -0.24);
    vec2 q4 = uv - vec2(0.40, -0.06);
    float maria = 1.0 - 0.20 * exp(-dot(q1, q1) * 8.0) - 0.16 * exp(-dot(q2, q2) * 15.0)
      - 0.15 * exp(-dot(q3, q3) * 7.0) - 0.10 * exp(-dot(q4, q4) * 22.0);
    float crater = hash12(floor(uv * 9.0 + 20.0));
    maria -= 0.05 * step(0.82, crater) * smoothstep(0.9, 0.2, r);
    float limb = 0.80 + 0.20 * n.z;
    vec3 lit = moonCol * maria * limb;
    vec3 disc = mix(EARTHSHINE * (0.6 + 0.4 * maria), lit, smoothstep(-0.05, 0.07, l));
    col = mix(col, disc * mix(0.35, 1.0, uMoonBright), mask);
  }
  return col;
}

// Colour seen along a ray from O in direction d: the tree line on the far shore, or the sky.
vec3 shade(vec3 O, vec3 d, float pxWorld, bool withStars, bool withDisc) {
  if (d.z > 1e-4) {
    float t = (uShoreZ - O.z) / d.z;
    float hgt = O.y + t * d.y;
    if (t > 0.0 && hgt < 4.2) {
      float xs = O.x + t * d.x;
      float T = treeH(xs / uShoreZ);
      float w = max(pxWorld * t, 1e-3) * 1.5;
      float m = 1.0 - smoothstep(T - w, T + w * 0.5, hgt);
      if (m > 0.0) {
        float rim = smoothstep(T - w * 3.5, T, hgt) * (0.35 + 0.65 * uMoonBright);
        float side = 0.5 + 0.5 * clamp(xs / uShoreZ * 1.4 - 0.2, -1.0, 1.0);
        vec3 tc = mix(TREE, TREE_RIM, rim * side * 0.8);
        vec3 s = m < 1.0 ? sky(d, withStars, withDisc) : vec3(0.0);
        return mix(s, tc, m);
      }
    }
  }
  return sky(d, withStars, withDisc);
}

vec2 simGrad(float s, float z) {
  if (z <= uSimInfo.z) return vec2(0.0);
  float fi = (s - uSimInfo.x) / uSimInfo.y;
  float fj = log(z / uSimInfo.z) / uSimInfo.w;
  vec2 uv = (vec2(fi, fj) + 0.5) / uSimSize;
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return vec2(0.0);
  vec2 g;
  if (uLinear == 1) {
    g = texture(uSim, uv).rg;
  } else {
    vec2 p = vec2(fi, fj);
    ivec2 i0 = ivec2(floor(p));
    vec2 t = p - vec2(i0);
    ivec2 mx = ivec2(uSimSize) - 1;
    vec2 a = texelFetch(uSim, clamp(i0, ivec2(0), mx), 0).rg;
    vec2 b = texelFetch(uSim, clamp(i0 + ivec2(1, 0), ivec2(0), mx), 0).rg;
    vec2 c = texelFetch(uSim, clamp(i0 + ivec2(0, 1), ivec2(0), mx), 0).rg;
    vec2 e = texelFetch(uSim, clamp(i0 + ivec2(1, 1), ivec2(0), mx), 0).rg;
    g = mix(mix(a, b, t.x), mix(c, e, t.x), t.y);
  }
  float fade = smoothstep(0.0, 0.025, uv.x) * smoothstep(1.0, 0.975, uv.x) * smoothstep(1.0, 0.9, uv.y);
  return g * fade;
}

// Small wind waves; returns the slope and adds the variance of waves too fine to resolve to 'unresolved'.
vec2 wind(float x, float z, float fpx, float fpz, out float unresolved) {
  vec2 g = vec2(0.0);
  unresolved = 0.0;
  const int N = 6;
  float ang[6] = float[6](0.25, 1.90, -0.70, 2.80, 0.90, -2.20);
  float lam[6] = float[6](0.66, 0.40, 0.24, 0.15, 0.095, 0.058);
  float amp[6] = float[6](0.040, 0.036, 0.032, 0.028, 0.024, 0.020);
  float spd[6] = float[6](1.1, 1.5, 2.0, 2.6, 3.4, 4.4);
  for (int i = 0; i < N; i++) {
    vec2 dir = vec2(cos(ang[i]), sin(ang[i]));
    float k = 6.2831853 / lam[i];
    float ph = k * dot(dir, vec2(x, z)) - spd[i] * uTime + float(i) * 1.7;
    float fp = abs(dir.x) * fpx + abs(dir.y) * fpz;
    float vis = 1.0 - smoothstep(lam[i] * 0.10, lam[i] * 0.32, fp);
    float A = amp[i] * uWind;
    g += dir * (A * cos(ph)) * vis;
    unresolved += 0.5 * A * A * (1.0 - vis);
  }
  return g;
}

void main() {
  float px = gl_FragCoord.x / uPx;
  float py = (uRes.y - gl_FragCoord.y) / uPx;
  vec3 col;
  float pxAng = 1.0 / uF;
  if (py <= uHorizon) {
    vec3 d = normalize(vec3((px - uCx) / uF, (uHorizon - py) / uF, 1.0));
    col = shade(vec3(0.0, uCamH, 0.0), d, pxAng, true, false);
  } else {
    float dyp = py - uHorizon;
    float z = uF * uCamH / dyp;
    vec3 d = normalize(vec3((px - uCx) / uF, -dyp / uF, 1.0));
    if (z > uShoreZ) {
      col = shade(vec3(0.0, uCamH, 0.0), d, pxAng, false, false);
    } else {
      float x = (px - uCx) * z / uF;
      float fpx = z / uF;
      float fpz = z * z / (uF * uCamH);
      float unresolved;
      vec2 gs = simGrad((px - uCx) / uF, z) * uRippleGain;
      vec2 g = gs + wind(x, z, fpx, fpz, unresolved);
      vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 r = reflect(d, n);
      r.y = max(r.y, 0.002);
      r = normalize(r);
      float cosi = clamp(dot(-d, n), 0.0, 1.0);
      float fres = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
      vec3 refl = shade(vec3(x, 0.0, z), r, pxAng * 1.5, fres > 0.12, true);
      vec3 body = mix(POND, POND_NEAR, smoothstep(5.0, 1.3, z));
      col = mix(body, refl, fres);
      // the moon's glade: facets tilted to send moonlight to the eye
      vec3 hv = normalize(-d + uMoonDir);
      float ch = clamp(dot(hv, n), 0.0, 1.0);
      float sig2 = uGladeSigma * uGladeSigma + unresolved;
      float glint = exp(-(1.0 - ch) / sig2) * min(1.0, uGladeSigma * uGladeSigma / sig2 * 1.6);
      float gf = 0.02 + 0.98 * pow(1.0 - clamp(dot(-d, hv), 0.0, 1.0), 5.0);
      vec3 moonCol = mix(MOON, MOON_WARM, uMoonWarm);
      col += moonCol * glint * uGladeGain * uMoonBright * (0.25 + 2.2 * gf);
      // soft moonlight on facets turned toward the moon: ripples catch light all over the pond
      float sheen = exp(-(1.0 - ch) / (0.045 + unresolved)) * (0.05 + 0.5 * gf);
      col += moonCol * sheen * uMoonBright * 0.55;
      // ripples: facets turned toward the moon catch its light, facets turned away fall into shade
      vec2 mxz = normalize(uMoonDir.xz + vec2(1e-5));
      float face = -dot(gs, mxz);
      float lightness = uMoonBright * (0.4 + 0.6 * uLit);
      col += moonCol * clamp(face * 1.5, 0.0, 0.8) * 0.5 * lightness;
      col *= 1.0 - clamp(-face * 1.6, 0.0, 0.6) * 0.55;
      // crests catch the sky's glow whichever way they lean
      col += vec3(0.16, 0.24, 0.25) * smoothstep(0.03, 0.32, length(gs)) * (0.35 + 0.65 * lightness);
      col = mix(col, HAZE, smoothstep(uShoreZ * 0.2, uShoreZ, z) * 0.5);
    }
  }
  // gentle vignette and dither
  vec2 q = vec2(px, py) / (uRes / uPx) - 0.5;
  col *= 1.0 - 0.32 * pow(dot(q * vec2(1.0, 1.25), q * vec2(1.0, 1.25)), 1.3);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 517.0) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`

export interface WaterUniforms {
  time: number
  phase: number
  moonBright: number
  moonWarm: number
  moonDir: [number, number, number]
  moonAng: number
  gladeSigma: number
  gladeGain: number
  rippleGain: number
  wind: number
  /** Moon centre and radius on screen (CSS px). */
  moonPx: [number, number, number]
  /** Lit fraction of the moon's disc (0..1). */
  lit: number
}

export class WaterGL {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private tex: WebGLTexture | null = null
  private loc: Record<string, WebGLUniformLocation | null> = {}
  private linear = false
  private texW = 0
  private texH = 0
  lost = false
  scale = 1

  static create(canvas: HTMLCanvasElement): WaterGL | null {
    let gl: WebGL2RenderingContext | null = null
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      })
    } catch {
      gl = null
    }
    if (!gl) return null
    const w = new WaterGL(canvas, gl)
    return w.init() ? w : null
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas
    this.gl = gl
    canvas.addEventListener('webglcontextlost', this.onLost, false)
    canvas.addEventListener('webglcontextrestored', this.onRestored, false)
  }

  private onLost = (e: Event) => {
    e.preventDefault()
    this.lost = true
  }

  private onRestored = () => {
    this.prog = null
    this.tex = null
    this.vao = null
    this.texW = 0
    this.texH = 0
    this.lost = !this.init()
  }

  private init(): boolean {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)
      if (!s) return null
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[pond] shader:', gl.getShaderInfoLog(s))
        gl.deleteShader(s)
        return null
      }
      return s
    }
    const vs = compile(gl.VERTEX_SHADER, VERT)
    const fs = compile(gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) return false
    const prog = gl.createProgram()
    if (!prog) return false
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[pond] link:', gl.getProgramInfoLog(prog))
      return false
    }
    this.prog = prog
    this.vao = gl.createVertexArray()
    this.linear = !!gl.getExtension('OES_texture_float_linear')
    const names = [
      'uRes', 'uPx', 'uHorizon', 'uF', 'uCx', 'uCamH', 'uTime', 'uMoonDir', 'uMoonAng', 'uPhase', 'uMoonBright',
      'uMoonWarm', 'uGladeSigma', 'uGladeGain', 'uShoreZ', 'uSim', 'uSimInfo', 'uSimSize', 'uRippleGain', 'uLinear',
      'uWind', 'uMoonPx', 'uLit',
    ]
    for (const n of names) this.loc[n] = gl.getUniformLocation(prog, n)
    this.tex = gl.createTexture()
    return true
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

  uploadSim(sim: WaveSim): void {
    if (this.lost || !this.tex) return
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    if (this.texW !== sim.nx || this.texH !== sim.nz) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sim.nx, sim.nz, 0, gl.RG, gl.FLOAT, sim.grad)
      const filter = this.linear ? gl.LINEAR : gl.NEAREST
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.texW = sim.nx
      this.texH = sim.nz
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.nx, sim.nz, gl.RG, gl.FLOAT, sim.grad)
    }
  }

  render(L: Layout, sim: WaveSim, u: WaterUniforms): void {
    if (this.lost || !this.prog) return
    const gl = this.gl
    const l = this.loc
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(l.uRes, this.canvas.width, this.canvas.height)
    gl.uniform1f(l.uPx, this.canvas.width / L.width)
    gl.uniform1f(l.uHorizon, L.horizon)
    gl.uniform1f(l.uF, L.f)
    gl.uniform1f(l.uCx, L.cx)
    gl.uniform1f(l.uCamH, L.camH)
    gl.uniform1f(l.uTime, u.time)
    gl.uniform3f(l.uMoonDir, u.moonDir[0], u.moonDir[1], u.moonDir[2])
    gl.uniform1f(l.uMoonAng, u.moonAng)
    gl.uniform1f(l.uPhase, u.phase)
    gl.uniform1f(l.uMoonBright, u.moonBright)
    gl.uniform1f(l.uMoonWarm, u.moonWarm)
    gl.uniform1f(l.uGladeSigma, u.gladeSigma)
    gl.uniform1f(l.uGladeGain, u.gladeGain)
    gl.uniform1f(l.uShoreZ, L.zShore)
    gl.uniform4f(l.uSimInfo, sim.sMin, sim.ds, sim.zNear, sim.dlz)
    gl.uniform2f(l.uSimSize, sim.nx, sim.nz)
    gl.uniform1f(l.uRippleGain, u.rippleGain)
    gl.uniform1i(l.uLinear, this.linear ? 1 : 0)
    gl.uniform1f(l.uWind, u.wind)
    gl.uniform3f(l.uMoonPx, u.moonPx[0], u.moonPx[1], u.moonPx[2])
    gl.uniform1f(l.uLit, u.lit)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.uniform1i(l.uSim, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose(): void {
    const gl = this.gl
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    if (!this.lost) {
      if (this.tex) gl.deleteTexture(this.tex)
      if (this.prog) gl.deleteProgram(this.prog)
      if (this.vao) gl.deleteVertexArray(this.vao)
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
