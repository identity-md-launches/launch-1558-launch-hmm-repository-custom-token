import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useApp, useIndex } from '../data/app'
import { useNow } from '../data/clock'
import { questionsByStatus, netBacking } from '../data/indexer'
import { Addr, ButtonLink, Reveal } from '../components/ui'
import { BackControls, OpenProgress, QuestionStatusPill, QuestionText } from '../components/question'
import { EmptyPond, HistoryNotice, IndexLoading } from '../components/states'
import { formatImd } from '../lib/format'

export default function OpenPage() {
  const { contracts } = useApp()
  const index = useIndex()
  const now = BigInt(useNow())
  const { address } = useAccount()
  const [tab, setTab] = useState<'raising' | 'closed'>('raising')

  const open = index ? questionsByStatus(index, 'open') : []
  const raising = open.filter((q) => q.deadline >= now)
  const closed = open.filter((q) => q.deadline < now)
  const list = tab === 'raising' ? raising : closed

  return (
    <div className="page">
      <Reveal className="page-head">
        <span className="eyebrow">open questions</span>
        <h1>Chip in on a question.</h1>
        <p>
          Anyone can back a question with as little as 0.01 IMD. When it holds the full price it is asked right away,
          and if the swarm agrees, every backer mines in proportion to what they put in. Not full after 3 days? Every
          backer takes their IMD back.
        </p>
      </Reveal>
      <HistoryNotice />

      {!contracts ? (
        <EmptyPond title="Mining opens soon" body="Open questions appear here once the mine is live." />
      ) : !index || (index.status !== 'live' && index.questions.size === 0) ? (
        <IndexLoading />
      ) : (
        <>
          <div className="spread" style={{ marginBottom: 18 }}>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'raising'} className={['tab', tab === 'raising' && 'on'].filter(Boolean).join(' ')} onClick={() => setTab('raising')}>
                Raising<span className="count">{raising.length}</span>
              </button>
              <button role="tab" aria-selected={tab === 'closed'} className={['tab', tab === 'closed' && 'on'].filter(Boolean).join(' ')} onClick={() => setTab('closed')}>
                Funding closed<span className="count">{closed.length}</span>
              </button>
            </div>
            <ButtonLink to="/ask" variant="primary" size="sm">
              Propose a question
            </ButtonLink>
          </div>

          {list.length === 0 ? (
            <EmptyPond
              title={tab === 'raising' ? 'Nothing is raising right now' : 'No closed questions'}
              body={
                tab === 'raising'
                  ? 'Every question so far was asked solo or filled up. Start one and let others chip in.'
                  : 'Questions that miss their 3-day window land here so backers can refund.'
              }
              cta={tab === 'raising' ? { to: '/ask', label: 'Start a pooled question' } : undefined}
            />
          ) : (
            <div className="q-list">
              {list.map((q, i) => {
                const mine = address ? netBacking(q, address) : 0n
                return (
                  <Reveal key={q.id.toString()} index={Math.min(i, 6)} className="card q-card hoverable">
                    <div className="spread">
                      <span className="q-id">#{q.id.toString()}</span>
                      <div className="row" style={{ gap: 8 }}>
                        {q.answerType && <span className="tag">{q.answerType}</span>}
                        <QuestionStatusPill q={q} />
                      </div>
                    </div>
                    <QuestionText q={q} />
                    <div className="q-meta">
                      <span>
                        proposed by <Addr address={q.proposer} you={address?.toLowerCase() === q.proposer.toLowerCase()} />
                      </span>
                      {mine > 0n && <span className="gold">you put in {formatImd(mine)} IMD</span>}
                    </div>
                    <OpenProgress q={q} />
                    <BackControls q={q} />
                  </Reveal>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
