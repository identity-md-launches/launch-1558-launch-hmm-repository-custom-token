import { useId } from 'react'

/** The lit part of a disc: right half plus/minus a terminator ellipse, so the lit area fraction is `lit`. */
export function phasePath(cx: number, cy: number, r: number, lit: number): string {
  const f = Math.max(0, Math.min(1, lit))
  if (f >= 0.999) return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`
  if (f <= 0.001) return ''
  const k = Math.abs(2 * f - 1) * r
  const sweep = f >= 0.5 ? 1 : 0
  return `M${cx},${cy - r}A${r},${r} 0 0,1 ${cx},${cy + r}A${k},${r} 0 0,${sweep} ${cx},${cy - r}Z`
}

/**
 * The emission moon: lit 1/2^era (full in era 0, half in era 1, …), a ring of 10 minute ticks around it, and a gold
 * arc for the progress through the current round. `risen=false` draws it low and dim (before mining opens).
 */
export function MoonGlyph({
  size = 260,
  era,
  roundProgress,
  risen = true,
}: {
  size?: number
  era: number
  roundProgress: number | null
  risen?: boolean
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const c = 100
  const r = 52
  const ring = 78
  const lit = 1 / 2 ** Math.max(0, era)
  const p = roundProgress === null ? 0 : Math.max(0, Math.min(1, roundProgress))
  const arc = (frac: number) => {
    const a = -Math.PI / 2 + frac * Math.PI * 2
    return `${c + ring * Math.cos(a)},${c + ring * Math.sin(a)}`
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={['moon-glyph', risen ? 'risen' : 'unrisen'].join(' ')}
      role="img"
      aria-label={risen ? `Moon ${Math.round(lit * 100)}% lit: era ${era}` : 'The moon has not risen: mining has not started'}
    >
      <defs>
        <radialGradient id={`halo${uid}`}>
          <stop offset="0.45" stopColor="#f3ead3" stopOpacity="0.28" />
          <stop offset="1" stopColor="#f3ead3" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`face${uid}`} cx="40%" cy="35%" r="75%">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="0.7" stopColor="#f3ead3" />
          <stop offset="1" stopColor="#d9cdb0" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r="98" fill={`url(#halo${uid})`} className="moon-halo" />
      <circle cx={c} cy={c} r={r} fill="#1b2a2c" />
      <path d={phasePath(c, c, r, lit)} fill={`url(#face${uid})`} />
      <g fill="#c9bf9f" opacity={0.35}>
        <circle cx={c - 14} cy={c - 12} r="8" />
        <circle cx={c + 16} cy={c + 10} r="11" />
        <circle cx={c - 6} cy={c + 22} r="5" />
      </g>
      {risen && (
        <g className="moon-ring">
          <circle cx={c} cy={c} r={ring} fill="none" stroke="rgba(243,234,211,0.12)" strokeWidth="1.2" />
          {Array.from({ length: 10 }, (_, i) => {
            const a = -Math.PI / 2 + (i / 10) * Math.PI * 2
            const inner = ring - 4
            const outer = ring + 4
            const done = i / 10 <= p
            return (
              <line
                key={i}
                x1={c + inner * Math.cos(a)}
                y1={c + inner * Math.sin(a)}
                x2={c + outer * Math.cos(a)}
                y2={c + outer * Math.sin(a)}
                stroke={done ? '#ffcf4a' : 'rgba(243,234,211,0.3)'}
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            )
          })}
          {p > 0 && (
            <path
              d={`M${arc(0)}A${ring},${ring} 0 ${p > 0.5 ? 1 : 0},1 ${arc(Math.min(p, 0.9999))}`}
              fill="none"
              stroke="#ffcf4a"
              strokeWidth="2.4"
              strokeLinecap="round"
              style={{ filter: 'drop-shadow(0 0 4px rgba(255,207,74,0.7))' }}
            />
          )}
        </g>
      )}
    </svg>
  )
}
