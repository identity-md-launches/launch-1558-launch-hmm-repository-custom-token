import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConfig as useWagmiConfig } from 'wagmi'
import { getAccount, simulateContract, switchChain, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import type { Abi, ContractFunctionArgs, ContractFunctionName, TransactionReceipt } from 'viem'
import { toast } from '../components/toast'
import { humanizeError, isUserRejection } from '../lib/errors'
import { useApp } from './app'

export interface TxRequest<abi extends Abi, fn extends ContractFunctionName<abi, 'nonpayable' | 'payable'>> {
  address: `0x${string}`
  abi: abi
  functionName: fn
  args: ContractFunctionArgs<abi, 'nonpayable' | 'payable', fn>
}

/**
 * Sends one contract call with honest feedback: makes sure the wallet is on the app's chain, simulates (so a revert
 * is explained before anything is signed), sends, waits for the receipt, then refreshes chain data.
 */
export function useTx() {
  const wagmi = useWagmiConfig()
  const { cfg, indexer } = useApp()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(
    async <abi extends Abi, fn extends ContractFunctionName<abi, 'nonpayable' | 'payable'>>(
      label: string,
      request: TxRequest<abi, fn>,
      opts: {
        success?: string
        pending?: string
        /** Simulate against the pending block (what the transaction will actually see). */
        simulateAt?: 'pending'
        /** Inspect the simulated return value; a message aborts before anything is signed. */
        check?: (result: unknown) => string | null
        /** Success text from the receipt (e.g. the amount actually claimed). */
        successFrom?: (receipt: TransactionReceipt) => string
      } = {},
    ): Promise<TransactionReceipt | null> => {
      setBusy(label)
      const id = toast.show({ kind: 'pending', title: label, body: 'Confirm in your wallet…' })
      try {
        const account = getAccount(wagmi)
        if (!account.address) throw new Error('Connect a wallet first.')
        if (account.chainId !== cfg.chainId) {
          toast.update(id, { body: `Switching your wallet to ${cfg.chainName}…` })
          await switchChain(wagmi, { chainId: cfg.chainId })
          toast.update(id, { body: 'Confirm in your wallet…' })
        }
        const simulate = (blockTag?: 'pending') =>
          simulateContract(wagmi, {
            ...(request as object),
            account: account.address,
            chainId: cfg.chainId,
            ...(blockTag ? { blockTag } : {}),
          } as Parameters<typeof simulateContract>[1])
        let sim: Awaited<ReturnType<typeof simulate>>
        try {
          sim = await simulate(opts.simulateAt)
        } catch (e) {
          // Some endpoints refuse calls at the pending block; the latest block is the next best thing.
          if (!opts.simulateAt || isUserRejection(e) || /revert/i.test(String((e as Error)?.message))) throw e
          sim = await simulate()
        }
        const problem = opts.check?.(sim.result)
        if (problem) {
          toast.update(id, { kind: 'info', body: problem, ttl: 9000 })
          return null
        }
        const prepared = sim.request
        const hash = await writeContract(wagmi, prepared as Parameters<typeof writeContract>[1])
        toast.update(id, { body: opts.pending ?? 'Waiting for the block…', hash })
        const receipt = await waitForTransactionReceipt(wagmi, { hash, chainId: cfg.chainId })
        if (receipt.status !== 'success') throw new Error('The transaction reverted on chain.')
        toast.update(id, { kind: 'success', body: opts.successFrom?.(receipt) ?? opts.success ?? 'Done.', ttl: 7000 })
        indexer?.refresh()
        void qc.invalidateQueries()
        return receipt
      } catch (e) {
        if (isUserRejection(e)) toast.update(id, { kind: 'info', body: 'Cancelled in your wallet.', ttl: 4000 })
        else toast.update(id, { kind: 'error', body: humanizeError(e), ttl: 14000 })
        return null
      } finally {
        setBusy(null)
      }
    },
    [wagmi, cfg.chainId, cfg.chainName, indexer, qc],
  )

  return { run, busy }
}
