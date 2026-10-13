import { useEffect, useMemo, useRef, useState } from 'react'
import { emittedAt, rateAt, type Schedule } from '../lib/emission'
import { compactNumber, formatDate, formatHmm, formatPercent, toNumber } from '../lib/format'

/**
 * Cumulative HMM emitted by the schedule over time (one series, one axis), with a crosshair tooltip and the halvings
 * marked. Computed client-side with the same integer math as `emittedAt`.
 */

const H = 300
const PAD = { top: 18, right: 18, bottom: 34, left: 56 }

export function EmissionChart({
  schedule,
  eras = 8,
  now,
  dated,
}: {
  schedule: Schedule
  eras?: number
  /** Unix seconds for the "now" marker; null before launch. */
  now: number | null
  /** Show calendar dates (after launch) or days since genesis (planned schedule). */
  dated: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(300, Math.floor(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const span = schedule.eraLength * BigInt(eras)
  const points = useMemo(() => {
    const n = 160
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = schedule.genesis + (span * BigInt(i)) / BigInt(n)
      return { t, emitted: toNumber(emittedAt(schedule, t)) }
    })
  }, [schedule, span])
  const reserve = toNumber(schedule.reserve)
  const w = width
  const iw = w - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  const g = Number(schedule.genesis)
  const total = Number(span)
  const x = (t: number) => PAD.left + ((t - g) / total) * iw
  const y = (v: number) => PAD.top + ih - (v / reserve) * ih
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(Number(p.t)).toFixed(1)},${y(p.emitted).toFixed(1)}`).join('')
  const area = `${line}L${x(g + total).toFixed(1)},${y(0)}L${x(g)},${y(0)}Z`
  const yTicks = niceTicks(reserve, 4)
  const eraLen = Number(schedule.eraLength)
  const nowIn = now !== null && now >= g && now <= g + total
  const nowEmitted = nowIn ? toNumber(emittedAt(schedule, BigInt(now!))) : 0

  const label = (t: number) => (dated ? formatDate(t).split(',').slice(0, 2).join(',') : `day ${Math.round((t - g) / 86400)}`)
  const hoverT = hover === null ? null : g + ((hover - PAD.left) / iw) * total
  const hoverV = hoverT === null ? 0 : toNumber(emittedAt(schedule, BigInt(Math.floor(hoverT))))
  const hoverEra = hoverT === null ? 0 : Math.floor((hoverT - g) / eraLen)

  return (
    <div ref={wrap} className="chart" style={{ position: 'relative' }}>
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        role="img"
        aria-label="Cumulative HMM emitted by the mining schedule over time, halving every era"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = e.clientX - r.left
          setHover(px >= PAD.left && px <= w - PAD.right ? px : null)
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(v)} y2={y(v)} stroke="rgba(243,234,211,0.08)" strokeWidth="1" />
            <text x={PAD.left - 10} y={y(v) + 4} textAnchor="end" className="chart-tick">
              {compactNumber(v)}
            </text>
          </g>
        ))}
        {/* the reserve: the ceiling the schedule never reaches */}
        <line x1={PAD.left} x2={w - PAD.right} y1={y(reserve)} y2={y(reserve)} stroke="rgba(243,234,211,0.28)" strokeWidth="1" />
        <text x={PAD.left + 6} y={y(reserve) - 6} className="chart-tick">
          reserve {compactNumber(reserve)}
        </text>
        {/* halvings */}
        {Array.from({ length: eras + 1 }, (_, i) => {
          const t = g + i * eraLen
          return (
            <g key={i}>
              <line x1={x(t)} x2={x(t)} y1={PAD.top} y2={y(0)} stroke="rgba(201,184,255,0.12)" strokeWidth="1" />
              {i < eras && (iw / eras > 60 || i % 2 === 0) && (
                <text x={x(t + eraLen / 2)} y={H - 12} textAnchor="middle" className="chart-tick">
                  era {i}
                </text>
              )}
            </g>
          )
        })}
        <path d={area} fill="rgba(255,207,74,0.10)" />
        <path d={line} fill="none" stroke="#ffcf4a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {nowIn && (
          <g>
            <line x1={x(now!)} x2={x(now!)} y1={PAD.top} y2={y(0)} stroke="rgba(243,234,211,0.35)" strokeWidth="1" />
            <circle cx={x(now!)} cy={y(nowEmitted)} r="6" fill="#ffcf4a" stroke="#101c1e" strokeWidth="2" />
            <text x={Math.min(x(now!) + 10, w - PAD.right - 60)} y={Math.max(y(nowEmitted) - 10, PAD.top + 12)} className="chart-label">
              now · {compactNumber(nowEmitted)}
            </text>
          </g>
        )}
        <text x={w - PAD.right} y={y(points[points.length - 1]!.emitted) - 8} textAnchor="end" className="chart-label">
          {formatPercent(points[points.length - 1]!.emitted / reserve, 1)} of the reserve after {eras} eras
        </text>
        {hover !== null && hoverT !== null && (
          <g pointerEvents="none">
            <line x1={hover} x2={hover} y1={PAD.top} y2={y(0)} stroke="rgba(243,234,211,0.5)" strokeWidth="1" />
            <circle cx={hover} cy={y(hoverV)} r="5" fill="#ffcf4a" stroke="#101c1e" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover !== null && hoverT !== null && (
        <div className="chart-tip" style={{ left: Math.min(hover + 14, w - 200), top: 12 }}>
          <strong className="num">{formatHmm(BigInt(Math.floor(hoverV)) * 10n ** 18n)} HMM</strong>
          <span>emitted by {label(hoverT)}</span>
          <span className="faint">
            era {hoverEra} · {formatHmm(rateAt(schedule, BigInt(Math.floor(hoverT))) * schedule.roundLength)} HMM per round
          </span>
        </div>
      )}
    </div>
  )
}

/** Round tick values below `max`: 0 and multiples of a 1/2/5 × 10^k step, about `count` of them. */
function niceTicks(max: number, count: number): number[] {
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = 0; v <= max * 0.97; v += step) out.push(v)
  return out
}

/** HMM per round in each era: one column per era, the current era emphasized. */
export function EraColumns({ schedule, eras = 8, current }: { schedule: Schedule; eras?: number; current: number | null }) {
  const rows = Array.from({ length: eras }, (_, i) => {
    const t = schedule.genesis + BigInt(i) * schedule.eraLength
    return { era: i, perRound: toNumber(rateAt(schedule, t) * schedule.roundLength) }
  })
  const max = rows[0]?.perRound || 1
  return (
    <div className="era-cols" role="list" aria-label="HMM emitted per round in each era">
      {rows.map((r) => (
        <div key={r.era} className={['era-col', current === r.era && 'on'].filter(Boolean).join(' ')} role="listitem" tabIndex={0} title={`era ${r.era}: ${compactNumber(r.perRound)} HMM per round`}>
          <span className="era-val num">{r.era === 0 || current === r.era ? compactNumber(r.perRound) : ''}</span>
          <div className="era-bar-wrap">
            <div className="era-bar" style={{ height: `${Math.max(2, (r.perRound / max) * 100)}%` }} />
          </div>
          <span className="era-name">era {r.era}</span>
        </div>
      ))}
    </div>
  )
}
