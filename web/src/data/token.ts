import { useQuery } from '@tanstack/react-query'
import { erc20Abi, type Address } from 'viem'
import { useApp } from './app'

export interface TokenInfo {
  kind: 'token' | 'contract' | 'account'
  symbol: string | null
  name: string | null
  decimals: number | null
}

/** What lives at an address on the app's chain: an ERC-20 (with symbol/decimals), another contract, or an account.
 * Helps people confirm they pasted the right thing; it never blocks a question (the question is about mainnet). */
export function useTokenInfo(address: Address | undefined) {
  const { client } = useApp()
  return useQuery({
    queryKey: ['token-info', address],
    enabled: Boolean(address),
    staleTime: Infinity,
    retry: 0,
    queryFn: async (): Promise<TokenInfo> => {
      const code = await client.getCode({ address: address! })
      if (!code || code === '0x') return { kind: 'account', symbol: null, name: null, decimals: null }
      const [symbol, name, decimals] = await Promise.all([
        client.readContract({ address: address!, abi: erc20Abi, functionName: 'symbol' }).catch(() => null),
        client.readContract({ address: address!, abi: erc20Abi, functionName: 'name' }).catch(() => null),
        client.readContract({ address: address!, abi: erc20Abi, functionName: 'decimals' }).catch(() => null),
      ])
      if (symbol === null && decimals === null) return { kind: 'contract', symbol: null, name: null, decimals: null }
      return { kind: 'token', symbol, name, decimals: decimals === null ? null : Number(decimals) }
    },
  })
}
