/**
 * The contract between the app and the Thinking Pond (the hero canvas). The app feeds it real data (swarm seats from
 * api.imd.fun, questions from chain events, the moon from `stats()`); the pond animates transitions and reports what
 * the user clicked. Coordinates are CSS pixels relative to the pond's container element.
 */

/** One IMD seat (an agent), from `GET https://api.imd.fun/swarm` → `seats`. */
export interface PondSeat {
  tokenId: number
  agentId?: string
  attempts?: number
  accepted?: number
  rejected?: number
  failed?: number
  /** ISO time of the seat's last activity. */
  last?: string
  /** The seat is working on a job right now. */
  working?: boolean
}

export type PondQuestionStatus = 'open' | 'asked' | 'answered' | 'failed'

/** A question asked through the mine, as the pond shows it. */
export interface PondQuestion {
  /** Question id (decimal string). */
  id: string
  /** The question text, for labels. */
  text: string
  status: PondQuestionStatus
  /** Open questions: raised ÷ target, 0..1 (a lotus bud filling with light). */
  raised?: number
  /** Answered/failed: panel size reported by the swarm (default 5). */
  panelSize?: number
  /** Answered: how many panel members agreed. */
  agreed?: number
  /** Answered: short human answer ("yes", "no", "1,234", "0xabc…"). */
  answer?: string
  /** Failed: short human reason ("the panel disagreed"). */
  reason?: string
  /** The connected wallet backed this question: its coin flies to the wallet button. */
  mine?: boolean
  /** Ordering key, larger = newer (e.g. block number * 1e4 + log index). */
  order: number
}

export interface PondMoon {
  /** Mining has started (genesis passed). Before that the moon is dim and the ring does not tick. */
  live: boolean
  /** Halving era: the moon's lit fraction is 1 / 2^era (full in era 0, half in era 1, …). */
  era: number
  /** Progress through the current 10-minute round, 0..1. */
  roundProgress: number
  /** The pot as a multiple of one round's emission (1 = just this round, 5 = four empty rounds rolled in). Drives
   * how long and bright the moon's reflection is. 0 when unknown. */
  roundsInPot: number
}

/** What the user picked (clicked/tapped or activated with the keyboard). */
export type PondPick =
  | { kind: 'frog'; index: number; seat: PondSeat | null; x: number; y: number }
  | { kind: 'firefly'; id: string; x: number; y: number }
  | { kind: 'bud'; id: string; x: number; y: number }
  | { kind: 'bubble'; id: string; x: number; y: number }
  | { kind: 'moon'; x: number; y: number }
  | { kind: 'water'; x: number; y: number }

/** A rectangle in the pond container, CSS px. */
export interface PondRect {
  x: number
  y: number
  w: number
  h: number
}

/** Sound cues the pond emits; the app synthesizes them. */
export type PondSoundKind = 'croak' | 'plip' | 'splash' | 'chime' | 'pop'

/** Where things are, so DOM overlays (countdowns, cards) can anchor to them. */
export interface PondLayout {
  width: number
  height: number
  /** y of the horizon line. */
  horizon: number
  moon: { x: number; y: number; r: number }
}

/** Imperative handle of a mounted pond. */
export interface PondHandle {
  /** Online agent count (null when the API is unreachable) and seats; the pond renders min(online, cap) frogs. */
  setSwarm(input: { online: number | null; seats: PondSeat[] }): void
  setMoon(moon: PondMoon): void
  /** The full current set of questions. The pond diffs against the previous call: on the first call everything
   * appears in its resting state; afterwards new/changed questions animate (drop, deliberate, coin, mist, bud).
   * A call that brings more than three new questions at once is treated as a backfill and also shown at rest, so
   * `setQuestions([])` while loading followed by the full list does not replay history. */
  setQuestions(questions: PondQuestion[]): void
  /** A frog says "hmm…" (a seat's frog if known, else a random one): ambient swarm activity. */
  croak(tokenId?: number): void
  /** A splash/ripple at a point (CSS px in the container). */
  ripple(x: number, y: number, strength?: number): void
  /** Where coins fly to (e.g. the wallet button), in container CSS px; null = float up and away. */
  setCoinTarget(fn: (() => { x: number; y: number } | null) | null): void
  /** A calm area (e.g. under the hero copy), container CSS px; null = none. Frogs and pads in and near it are faded
   * way down (with a soft edge), and no thought bubbles, croak bubbles, question bubbles or buds are shown inside
   * it; the rest of the pond fills in. Cheap to call on every layout change. */
  setQuietZone(rect: PondRect | null): void
  /** Ends the intro now, gliding to the resting scene in ~300 ms (no-op when there is no intro running). */
  skipIntro(): void
}

export interface PondCanvasProps {
  className?: string
  /** prefers-reduced-motion: render calm, mostly static frames; interactions still work. */
  reducedMotion?: boolean
  onPick?: (pick: PondPick) => void
  /** Hovered thing changed (null = nothing): lets the page show a tooltip. */
  onHover?: (pick: PondPick | null) => void
  /** A coin reached its target (the wallet button can bounce). */
  onCoinLanded?: (questionId: string) => void
  onLayout?: (layout: PondLayout) => void
  /** Receives the imperative handle once mounted (and null on unmount). */
  handleRef?: (handle: PondHandle | null) => void
  /** Play the first-visit intro (read at mount; ignored under reducedMotion): the view glides down from the stars to
   * the pond, the moon brightens, the frogs wake in a wave. ≤ 3 s. The first frame is already the intro's start. */
  intro?: boolean
  /** Fired once when the intro ends or is skipped; fired right after mount when there is no intro. */
  onIntroDone?: () => void
  /** Sound cues: `strength` 0..1, `pan` -1..1 (screen x). Ambient cues are rare and quiet (strength ≤ 0.3). */
  onSound?: (kind: PondSoundKind, strength: number, pan: number) => void
}
