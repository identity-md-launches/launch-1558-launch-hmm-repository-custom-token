import { useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useApp } from '../data/app'
import { backedBy } from '../data/pondFeed'
import { answerLabel } from '../lib/answer'
import { humanizeReason } from '../lib/reasons'
import { formatImd } from '../lib/format'
import { toast } from './toast'

/** Tells the connected wallet, on any page, when a question it backed is answered, fails, or gets asked. */
export function LiveNotifier() {
  const { indexer } = useApp()
  const { address } = useAccount()
  useEffect(() => {
    if (!indexer || !address) return
    return indexer.onLive((items) => {
      for (const it of items) {
        if (it.id === undefined) continue
        const q = indexer.state.questions.get(it.id.toString())
        if (!q || !backedBy(q, address)) continue
        if (it.kind === 'answered' && q.answer) {
          toast.show({
            kind: 'mined',
            title: `#${q.id} answered: ${answerLabel(q.answer.decoded)}`,
            body: `${q.answer.agreed} of ${q.answer.panelSize} agreed. You mine in round ${q.round?.toString()}; claim when it ends.`,
            ttl: 12_000,
          })
        } else if (it.kind === 'answered') {
          toast.show({ kind: 'mined', title: `#${q.id} answered`, body: `It mines in round ${q.round?.toString()}.`, ttl: 10_000 })
        } else if (it.kind === 'failed') {
          const h = humanizeReason(q.failure?.reason ?? '')
          toast.show({ kind: 'error', title: `#${q.id} turned to mist`, body: `${h.title}. Nothing was mined.`, ttl: 12_000 })
        } else if (it.kind === 'asked' && q.proposer.toLowerCase() !== address.toLowerCase()) {
          toast.show({ kind: 'info', title: `#${q.id} is fully backed`, body: `Asked for ${formatImd(q.target)} IMD. The panel is thinking.`, ttl: 8_000 })
        }
      }
    })
  }, [indexer, address])
  return null
}
