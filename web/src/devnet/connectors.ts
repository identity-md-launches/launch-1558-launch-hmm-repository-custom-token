import type { CreateConnectorFn } from 'wagmi'
import type { Chain } from 'viem'
import { DEVNET_TEST_KEYS } from './keys'
import { burnerKey, localKeyConnector } from './localKey'

/** DEVNET ONLY (compiled out of other builds): a per-browser burner and anvil's public test accounts. */
export function devnetConnectors(chain: Chain, rpcUrl: string): CreateConnectorFn[] {
  return [
    localKeyConnector({ id: 'devnet-burner', name: 'Devnet burner', chain, rpcUrl, key: burnerKey }),
    ...DEVNET_TEST_KEYS.map(({ key }, i) =>
      localKeyConnector({ id: `devnet-anvil-${i}`, name: `Test account #${i}`, chain, rpcUrl, key: () => key }),
    ),
  ]
}
