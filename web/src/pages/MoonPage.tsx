import { useMemo, useState } from 'react'
import { useApp } from '../data/app'
import { useLiveRound, useMineConsts, useSchedule, useStats } from '../data/hooks'
import { useNow } from '../data/clock'
import { baseRateFor, emittedAt, rateAt, type Schedule } from '../lib/emission'
import { compactNumber, formatClock, formatDate, formatDuration, formatHmm, formatHmmFloat, formatPercent, toNumber } from '../lib/format'
import { EmissionChart, EraColumns } from '../components/EmissionChart'
import { MoonGlyph } from '../components/MoonGlyph'
import { AnimatedNumber, Reveal } from '../components/ui'

const E18 = 10n ** 18n
/** The launch parameters (src/HmmMine.sol deployment): 65% of 1B HMM, 180-day eras, 10-minute rounds, 5% dev. */
const PLANNED_RESERVE = 650_000_000n * E18
const PLANNED_ERA = 180n * 86_400n
const PLANNED_ROUND = 600n

export default function MoonPage() {
  const { contracts } = useApp()
  const stats = useStats().data
  const consts = useMineConsts().data
  const live = useSchedule()
  const now = useNow()
  const lr = useLiveRound(now)
  const [table, setTable] = useState(false)

  const planned: Schedule = useMemo(
    () => ({
      reserve: PLANNED_RESERVE,
      genesis: 1n,
      baseRate: baseRateFor(PLANNED_RESERVE, PLANNED_ERA),
      roundLength: PLANNED_ROUND,
      eraLength: PLANNED_ERA,
      devBps: 500n,
    }),
    [],
  )
  const schedule = live ?? planned
  const started = Boolean(live)
  const t = BigInt(now)
  const opened = started && t >= schedule.genesis
  const era = opened ? Number((t - schedule.genesis) / schedule.eraLength) : 0
  const perRound = rateAt(schedule, opened ? t : schedule.genesis) * schedule.roundLength
  const emittedNow = opened ? emittedAt(schedule, t) : 0n
  const roundProgress =
    opened && lr ? 1 - Math.max(0, Number(lr.roundEndsAt) - now) / Number(schedule.roundLength) : null
  const potRounds = lr && lr.perRound > 0n ? toNumber(lr.pot) / toNumber(lr.perRound) : 0

  const eraRows = Array.from({ length: 10 }, (_, i) => {
    const start = schedule.genesis + BigInt(i) * schedule.eraLength
    const end = start + schedule.eraLength
    return {
      era: i,
      start,
      perRound: rateAt(schedule, start) * schedule.roundLength,
      emittedBy: emittedAt(schedule, end),
    }
  })

  return (
    <div className="page">
      <div className="moon-hero">
        <Reveal className="moon-hero-art">
          <MoonGlyph size={300} era={era} roundProgress={roundProgress} risen={opened} />
        </Reveal>
        <Reveal className="page-head" index={1}>
          <span className="eyebrow">the moon</span>
          <h1>
            {opened ? (
              <>
                Era {era}. <span className="grad-text">{formatPercent(1 / 2 ** era, 1)} lit.</span>
              </>
            ) : (
              <>The moon hasn't risen yet.</>
            )}
          </h1>
          <p>
            Mining follows a fixed schedule from genesis: a steady rate that halves every{' '}
            {Number(schedule.eraLength) / 86_400} days, so the {compactNumber(toNumber(schedule.reserve))} HMM reserve is
            never exceeded. The moon's phase is the era: full in era 0, half in era 1, a crescent after. Its ring ticks
            through each {Number(schedule.roundLength) / 60}-minute round.
          </p>
          {!opened && (
            <p className="lilac">
              {contracts && stats && stats.genesis > 0n
                ? `Mining opens in ${formatDuration(Number(stats.genesis) - now)} (${formatDate(Number(stats.genesis))}).`
                : 'Mining opens soon. Below is the schedule it will follow, counted in days from genesis.'}
            </p>
          )}
        </Reveal>
      </div>

      <Reveal className="grid grid-4" index={2}>
        <div className="card stat">
          <span className="stat-label">HMM per round now</span>
          <span className="stat-value">
            <AnimatedNumber value={toNumber(perRound)} format={formatHmmFloat} exact={formatHmm(perRound)} />
          </span>
          <span className="stat-sub">{formatHmm((perRound * (10_000n - schedule.devBps)) / 10_000n)} to backers after 5% dev</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Next halving</span>
          <span className="stat-value">
            {opened && lr ? formatDuration(Number(lr.nextHalvingAt) - now) : `day ${Number(schedule.eraLength) / 86_400}`}
          </span>
          <span className="stat-sub">{opened && lr ? formatDate(Number(lr.nextHalvingAt)) : 'after genesis'}</span>
        </div>
        <div className="card stat card-glow">
          <span className="stat-label">The pot</span>
          <span className="stat-value gold">
            <AnimatedNumber value={lr && opened ? toNumber(lr.pot) : opened ? null : 0} format={(n) => compactNumber(n)} />
            <small>HMM</small>
          </span>
          <span className="stat-sub">
            {opened && lr
              ? lr.roundShares > 0n
                ? 'already won by this round’s answers'
                : `${potRounds >= 1.05 ? `${potRounds.toFixed(1)} rounds rolled in · ` : ''}round ends in ${formatClock(Number(lr.roundEndsAt) - now)}`
              : 'waiting for genesis'}
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Reserve left</span>
          <span className="stat-value">
            <AnimatedNumber value={toNumber(schedule.reserve - emittedNow)} format={(n) => compactNumber(n)} />
          </span>
          <span className="stat-sub">
            {opened && stats ? `${compactNumber(toNumber(stats.assigned))} mined into answered rounds` : 'nothing emitted yet'}
          </span>
        </div>
      </Reveal>

      <Reveal className="card section" index={3}>
        <div className="section-head" style={{ marginBottom: 8 }}>
          <div>
            <h2 className="card-title">HMM emitted by the schedule</h2>
            <p style={{ fontSize: '0.9rem' }}>
              {started ? 'Since genesis' : 'Planned, from genesis'} · hover to read any point ·{' '}
              <button className="link-btn" onClick={() => setTable((v) => !v)}>
                {table ? 'show chart' : 'show as a table'}
              </button>
            </p>
          </div>
        </div>
        {table ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Era</th>
                  <th>{started ? 'Starts' : 'Starts (day)'}</th>
                  <th className="r">HMM per round</th>
                  <th className="r">Emitted by its end</th>
                  <th className="r">Of the reserve</th>
                </tr>
              </thead>
              <tbody>
                {eraRows.map((r) => (
                  <tr key={r.era} className={opened && r.era === era ? 'you-row' : ''}>
                    <td className="num">{r.era}</td>
                    <td>{started ? formatDate(Number(r.start)) : `day ${(r.era * Number(schedule.eraLength)) / 86_400}`}</td>
                    <td className="r num">{formatHmm(r.perRound, { compact: false })}</td>
                    <td className="r num">{formatHmm(r.emittedBy)}</td>
                    <td className="r num">{formatPercent(toNumber(r.emittedBy) / toNumber(schedule.reserve), 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmissionChart schedule={schedule} eras={8} now={opened ? now : null} dated={started} />
        )}
      </Reveal>

      <Reveal className="card section" index={4}>
        <h2 className="card-title">HMM per round, by era</h2>
        <p className="dim" style={{ fontSize: '0.9rem', marginBottom: 16 }}>
          Each era emits half the rate of the one before. {opened ? `You are in era ${era}.` : ''}
        </p>
        <EraColumns schedule={schedule} eras={8} current={opened ? era : null} />
      </Reveal>

      <div className="grid grid-3 section">
        <Reveal className="card" index={1}>
          <h3>Empty rounds roll over</h3>
          <p className="dim">
            A round without an answered question emits nothing. What it would have emitted waits in the pot and goes to
            the next round that gets an answer, so quiet nights make for big blocks.
          </p>
        </Reveal>
        <Reveal className="card" index={2}>
          <h3>Shared by the IMD paid</h3>
          <p className="dim">
            Everyone who backed a question answered in a round shares that round's HMM in proportion to the IMD they
            put in. 5% of every round goes to the dev.
          </p>
        </Reveal>
        <Reveal className="card" index={3}>
          <h3>Claim after the round</h3>
          <p className="dim">
            Rewards unlock the moment the round ends. Claim whenever you like: unclaimed HMM waits in the mine for you.
            {consts ? ` Rounds last ${Number(consts.roundLength) / 60} minutes.` : ''}
          </p>
        </Reveal>
      </div>
    </div>
  )
}
