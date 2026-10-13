/** The hmm palette, for canvas/WebGL code. CSS uses the same values as custom properties (styles/global.css). */
export const palette = {
  ink: '#0c1116', // night ink: page background, sky top
  pond: '#10201f', // deep pond water
  lily: '#3f7d5c', // lily pads, outlines
  frog: '#8fd18a', // frog skin, primary accent
  frogDeep: '#5fa46a', // frog shading
  belly: '#d6f0c4', // frog belly / light accent
  moon: '#f3ead3', // moon cream: main text color
  gold: '#ffcf4a', // firefly gold: HMM, coins, rewards
  lilac: '#c9b8ff', // thought lilac: thinking, deliberation
  coral: '#ff7a6b', // errors, failed questions
} as const

export type PaletteKey = keyof typeof palette

/** `#rrggbb` → `rgba(r,g,b,a)`. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** `#rrggbb` → [r,g,b] in 0..1, for shaders. */
export function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
