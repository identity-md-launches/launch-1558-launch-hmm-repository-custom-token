import { useSyncExternalStore } from 'react'

/**
 * A shared one-second clock in chain time: wall clock plus an offset measured from the chain. The best reference is
 * the pending block's timestamp (what the next transaction will see as `block.timestamp`); a devnet forked from a
 * lagging node runs seconds behind the wall clock, and mainnet's next block is a few seconds ahead of it.
 */

let offset = 0
let now = Math.floor(Date.now() / 1000)
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function tick() {
  const next = Math.floor(Date.now() / 1000 + offset)
  if (next !== now) {
    now = next
    for (const fn of listeners) fn()
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  if (!timer) timer = setInterval(tick, 250)
  return () => {
    listeners.delete(fn)
    if (!listeners.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** Feed the latest block's timestamp (seconds). Only trusted when it is ahead (an idle chain's latest block is old). */
export function observeBlockTime(blockTimestamp: number) {
  const ahead = blockTimestamp - Date.now() / 1000
  if (ahead > offset) offset = ahead
  tick()
}

/** Feed the pending block's timestamp (seconds): the chain's own "now". */
export function observeChainNow(pendingTimestamp: number) {
  const d = pendingTimestamp - Date.now() / 1000
  offset = Math.abs(d) < 1.5 ? 0 : d
  tick()
}

/** Current chain-aligned unix time in seconds (non-reactive). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000 + offset)
}

/** Current chain-aligned unix time in seconds, re-rendering every second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now)
}
