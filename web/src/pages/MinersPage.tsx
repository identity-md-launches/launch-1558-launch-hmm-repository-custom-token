import { useMemo } from 'react'
import { useAccount } from 'wagmi'
import { useApp, useIndex } from '../data/app'
import { useMineConsts, useStats } from '../data/hooks'
import { useNow } from '../data/clock'
import { leaderboard } from '../data/mining'
import { Addr, AnimatedNumber, Reveal } from '../components/ui'
import { EmptyPond, HistoryNotice, IndexLoading } from '../components/states'
import { formatHmm, formatHmmFloat, formatImd, formatInt, toNumber } from '../lib/format'

export default function MinersPage() {
  const { contracts } = useApp()
  const index = useIndex()
  const stats = useStats().data
  const consts = useMineConsts().data
  const now = BigInt(useNow())
  const { address } = useAccount()
  const timing = stats && consts && stats.genesis !== 0n ? { genesis: stats.genesis, roundLength: consts.roundLength } : null
  // Recompute when the index changes or a round ends (estimates turn final); not every second.
  const minute = now / 30n
  const rows = useMemo(
    () => (index ? leaderboard(index, now, timing) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index?.version, minute, timing?.genesis, timing?.roundLength],
  )
  const myRank = address ? rows.findIndex((r) => r.address.toLowerCase() === address.toLowerCase()) : -1

  return (
    <div className="page">
      <Reveal className="page-head">
        <span className="eyebrow">miners</span>
        <h1>Who's been thinking.</h1>
        <p>
          Everyone who backed a question, ranked by the HMM their answered questions mined (claimed, claimable, and this
          round's estimate). Straight from the mine's events; no sign-ups, no off-chain points.
        </p>
      </Reveal>
      <HistoryNotice />

      {!contracts ? (
        <EmptyPond title="No miners yet" body="The board fills up once mining opens." />
      ) : !index || (index.status !== 'live' && index.questions.size === 0) ? (
        <IndexLoading />
      ) : rows.length === 0 ? (
        <EmptyPond title="No miners yet" body="Be the first: ask the swarm a question." cta={{ to: '/ask', label: 'Ask the swarm' }} />
      ) : (
        <>
          <Reveal className="grid grid-3 podium" index={1}>
            {rows.slice(0, 3).map((r, i) => (
              <div key={r.address} className={`card podium-${i + 1} hoverable`}>
                <span className="podium-rank">{['1st', '2nd', '3rd'][i]}</span>
                <Addr address={r.address} you={address?.toLowerCase() === r.address.toLowerCase()} />
                <span className="stat-value gold">
                  <AnimatedNumber value={toNumber(r.hmm)} format={formatHmmFloat} exact={formatHmm(r.hmm)} /> <small>HMM</small>
                </span>
                <span className="stat-sub">
                  {r.answered} answered of {r.backed} backed · {formatImd(r.imdPaid)} IMD to the swarm
                </span>
              </div>
            ))}
          </Reveal>
          {myRank >= 0 && (
            <p className="dim" style={{ margin: '18px 0 0' }}>
              You're <strong className="frog">#{myRank + 1}</strong> of {formatInt(rows.length)}.
            </p>
          )}
          <Reveal className="card section" index={2} style={{ marginTop: 22 }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Miner</th>
                    <th className="r">HMM mined</th>
                    <th className="r">Claimed</th>
                    <th className="r">Answered / backed</th>
                    <th className="r">IMD to the swarm</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => {
                    const you = address?.toLowerCase() === r.address.toLowerCase()
                    return (
                      <tr key={r.address} className={you ? 'you-row' : ''}>
                        <td className="num faint">{i + 1}</td>
                        <td>
                          <Addr address={r.address} you={you} />
                        </td>
                        <td className="r num gold">
                          {formatHmm(r.hmm)}
                          {r.pending > 0n && <span className="faint" title="includes this round's estimate"> *</span>}
                        </td>
                        <td className="r num">{formatHmm(r.claimed)}</td>
                        <td className="r num">
                          {r.answered} / {r.backed}
                        </td>
                        <td className="r num">{formatImd(r.imdPaid)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: '0.78rem', marginTop: 12 }}>
              * includes HMM from the round in progress, which can still shrink if more answers land in it.
            </p>
          </Reveal>
        </>
      )}
    </div>
  )
}
