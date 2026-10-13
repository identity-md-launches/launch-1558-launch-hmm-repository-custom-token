import { parseEventLogs, type TransactionReceipt } from 'viem'
import { hmmMineAbi } from '../abi'
import { formatHmm } from '../lib/format'

/** Options for `claim(ids)`: it skips anything not claimable yet instead of reverting, so check first. */
export const claimOptions = {
  simulateAt: 'pending' as const,
  check: (result: unknown) =>
    typeof result === 'bigint' && result === 0n
      ? 'Nothing is claimable on chain yet: the round has only just ended there. Try again in a few seconds.'
      : null,
  successFrom: (receipt: TransactionReceipt) => {
    const total = parseEventLogs({ abi: hmmMineAbi, logs: receipt.logs, eventName: 'Claimed' }).reduce(
      (s, l) => s + l.args.amount,
      0n,
    )
    return total > 0n ? `${formatHmm(total)} HMM is in your wallet.` : 'Nothing was claimable yet.'
  },
}
