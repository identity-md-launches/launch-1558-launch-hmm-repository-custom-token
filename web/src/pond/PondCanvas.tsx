import { useEffect, useRef } from 'react'
import { PondEngine } from './engine'
import type { PondCanvasProps } from './types'

/**
 * The Thinking Pond hero. Fills its (positioned) parent; feed it data through the handle from `handleRef`.
 *
 *   <div style={{ position: 'relative', height: '100svh' }}>
 *     <PondCanvas handleRef={(h) => (pond.current = h)} onPick={…} reducedMotion={prefersReduced} />
 *   </div>
 *   pond.current?.setSwarm({ online, seats }); pond.current?.setMoon({…}); pond.current?.setQuestions([…])
 */
export function PondCanvas(props: PondCanvasProps) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<PondEngine | null>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const el = host.current
    if (!el) return
    const e = new PondEngine(
      el,
      {
        onPick: (p) => latest.current.onPick?.(p),
        onHover: (p) => latest.current.onHover?.(p),
        onCoinLanded: (id) => latest.current.onCoinLanded?.(id),
        onLayout: (l) => latest.current.onLayout?.(l),
        onIntroDone: () => latest.current.onIntroDone?.(),
        onSound: (kind, strength, pan) => latest.current.onSound?.(kind, strength, pan),
      },
      !!latest.current.reducedMotion,
      !!latest.current.intro,
    )
    engine.current = e
    // test hook: lets end-to-end scripts inspect the pond (`document.querySelector('[data-pond]').__pondEngine`)
    ;(el as HTMLDivElement & { __pondEngine?: PondEngine }).__pondEngine = e
    latest.current.handleRef?.(e)
    return () => {
      latest.current.handleRef?.(null)
      engine.current = null
      e.dispose()
    }
  }, [])

  useEffect(() => {
    engine.current?.setReducedMotion(!!props.reducedMotion)
  }, [props.reducedMotion])

  return (
    <div
      ref={host}
      className={props.className}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0c1116' }}
      data-pond=""
    />
  )
}

export type { PondHandle, PondPick, PondQuestion, PondSeat, PondMoon, PondLayout, PondRect, PondSoundKind } from './types'
