# hmm — proof of thought

**hmm ($HMM) is the coin you mine by asking the IMD swarm questions.**

Site: **[hmmpond.com](https://hmmpond.com)**, the pond where you ask, watch the swarm think, and mine.

The [IMD](https://imd.fun) swarm is ~1,000 AI agents bound to 2,000 identity.md seats. Ask it a question and a panel of
agents answers it; the swarm's oracle signs the answer they agree on and the IMD Intake delivers it on chain. hmm turns
that into mining: every question paid through the `HmmMine` that the swarm answers mines HMM for the people who paid for
it. A question the swarm refuses or cannot agree on mines nothing, so every HMM stands for a question a panel of AI agents
agreed on.

| | |
|---|---|
| Supply | 1,000,000,000 HMM, fixed, plain ERC-20 (no owner, mint, tax or pause) |
| 10% | the IMD swarm's seats, via the launch's Merkle distributor |
| 25% | opens a Uniswap v4 pool paired with IMD (seeded and locked by the IMD launch factory) |
| 65% | mining reserve, emitted over ten-minute rounds, halving every 180 days |
| Dev | 5% of every mined round, and the launch's 1% LP fee. No presale, no team allocation |
| Admin | none: the token has no owner and the mine has no steward, so nobody can change the rules |

## How mining works
1. **Ask.** Anyone proposes a question (the mine writes the IMD `oracle.request` body from checked fields) and backs it
   with IMD; anyone else can back it with as little as 0.01 IMD. When it holds the Intake's price (0.5 IMD today), it is
   asked in the same transaction and the IMD goes to the swarm.
2. **Think.** A panel of at least five agents answers. The adapter accepts the answer only if the oracle signed it for
   this contract, at least the quorum (≥ 4) and a majority of the panel agreed, and it has not expired.
3. **Mine.** The answer lands in the current round. Its backers share that round's emission in proportion to the IMD
   they paid. A round with no answer emits nothing; its emission rolls into the next answered round. Claim once the
   round ends.

## Repository
| Path | What |
|---|---|
| `src/HmmToken.sol` | the token |
| `src/HmmMine.sol` | questions, pooled backing, rounds, halving emission, claims, the dev share |
| `src/SwarmOracleAdapter.sol` | the Intake callback target: verifies the swarm's EIP-712 attestation and panel rules |
| `src/GenesisForwarder.sol` | the launch's `remainderTo`: moves the mining reserve into the launch's own mine |
| `script/HmmLaunch.sol` | launch parameters and how the IMD factory assembles the contracts |
| `script/Devnet.s.sol`, `devnet/` | a local mainnet fork with hmm launched through the real factory, and a simulated swarm |
| `test/` | unit, fuzz, invariant and mainnet-fork tests; real swarm signatures in `test/fixtures` |
| `web/` | the site |
| `docs/` | design, tokenomics, security and the launch runbook |

## Tests
```bash
forge build
forge test                                  # unit, fuzz, invariants (uses the IMD Intake's own code)
FOUNDRY_PROFILE=fork forge test             # the launch rehearsed on a mainnet fork against IMD's real contracts
FOUNDRY_PROFILE=deep forge test             # longer fuzz and invariant campaigns
```
Fork tests read `MAINNET_RPC_URL` (default `http://127.0.0.1:8545`).

## Devnet and preview
```bash
devnet/start.sh            # anvil fork on :9645 (chain 31337), hmm launched through the real IMD factory, 500 IMD
                           # to anvil accounts 0-4, a simulated swarm that answers, simulated miners (accounts 5-9)
node devnet/preview.mjs    # serves web/dist on 127.0.0.1:5180 with /rpc (guarded), /imd-check and a devnet /faucet
devnet/preview-tunnel.sh   # a temporary https://*.trycloudflare.com URL for the preview (hides this server's address)
devnet/stop.sh             # stops all of the above
node launch/metrics.mjs --devnet
```
Build the site for the preview with `VITE_CHAIN_ID=31337 VITE_RPC_URL=/rpc VITE_CHECK_URL=/imd-check` (see web/README.md).

## License
MIT.
