# Launch runbook

Everything below is prepared and tested; the steps that need a person are marked **you**. Budget about two hours from
the first step to mining being open: most of it is the swarm reviewing and deploying the launch.

**Suggested go-live: Tuesday 13 October 2026, about 15:00 UTC.** That is the overlap of European afternoon and US
morning, and one of IMD's busiest trading hours over the past week (on-chain swaps peak around 11:00, 15:00 and
20:00–23:00 UTC; Monday and Tuesday were the busiest days). Start step 1 around 13:00 UTC.

## Wallets (created on the server, separate from anything else)
| Wallet | Address | Needs | Role |
|---|---|---|---|
| `hmm-launcher` | `0x39C593c1bC4d91E42d797456077586f6058eBf67` | ~0.02 ETH | pays the launch (so it receives the pool's 1% LP fee) and receives the 5% dev share. There is no steward: nobody can change the rules |
| `hmm-deployer` | `0xF2FE54d361E07B8508829dcADAde8C438c4cdDd7` | ~0.002 ETH | deploys the GenesisForwarder as its first transaction |

Keys: `~/.foundry/keystores/<name>`, passwords `~/.hmm/<name>.password`. Export the launcher's key into a wallet app
you control with `cast wallet decrypt-keystore hmm-launcher --unsafe-password "$(cat ~/.hmm/hmm-launcher.password)"`
(never paste it anywhere else) and sweep revenue to cold storage regularly.

To send the dev share to a wallet of your own instead, edit `dev` in `launch/config.json` before step 4. `steward`
stays `0x0000000000000000000000000000000000000000` (see docs/SECURITY.md, finding 1).

## 1. Fund the wallets anonymously — **you**
Withdraw ETH from an exchange straight to the two addresses above (no transfer from any wallet that is known to be
yours). Then buy the IMD the launch costs:
```bash
node launch/buy-imd.mjs 1.5          # quote
node launch/buy-imd.mjs 1.5 --buy    # ETH -> USDC -> IMD on Uniswap v3, max 3% over the quote
```

## 2. Publish the code under a pseudonymous account — **you**, then the script
1. Create a GitHub account that is not linked to you (new e-mail), and an empty public repo `hmm`.
2. Add this SSH key to that account: `cat ~/.ssh/hmm_ed25519.pub`
3. Export and push:
```bash
launch/export-public.sh <account>                # prints the commit
cd ../hmm-public && git push -u origin main && cd -
```
4. Put the repo URL and the printed commit into `launch/config.json` (`repoUrl`, `baseCommit`).

## 3. Deploy the forwarder
It must be the deployer's first transaction (its address is already written into the launch request); the script
refuses to run otherwise:
```bash
forge script script/DeployForwarder.s.sol --rpc-url $MAINNET_RPC_URL \
  --account hmm-deployer --password-file ~/.hmm/hmm-deployer.password --broadcast
# expect: GenesisForwarder 0x876C2FB3eAa91D32Ef03186853bB82433b949a71
```

## 4. Build and check the launch request (free)
```bash
node launch/build.mjs        # writes launch/body.json from launch/config.json + script/HmmLaunch.sol
node launch/check.mjs        # the swarm's planner: must print "no blockers"
```
Decided in `launch/config.json`: pool 25% of supply, opening market cap **10,000 IMD** (~$92k FDV at today's price).
Lower (2,500 IMD, like ZTO) gives early buyers more room; higher makes mining worth more from the first block.

## 5. Pay for the launch (0.5 IMD)
```bash
node launch/pay.mjs --approve   # one-time IMD approval to Permit2, then a quote (pays nothing)
node launch/pay.mjs --pay       # checks the forwarder on chain, asks you to type "launch hmm", pays, follows the order
```
The script prints the job id. Follow it with `node launch/watch.mjs <jobId>` (or at
`https://explorer.imd.fun/jobs/<jobId>`): the swarm audits the imported code, adapts it for the factory, writes more
tests, runs a four-specialist audit panel with a judge, writes the manifest and deploys. The watcher prints the launch
number and the contracts, checks the mine is wired to our forwarder, and prints the `forward` command for step 6.

## 6. Open the mine
```bash
cast send 0x876C2FB3eAa91D32Ef03186853bB82433b949a71 "forward(uint64)" <launchNumber> \
  --account hmm-launcher --password-file ~/.hmm/hmm-launcher.password --rpc-url $MAINNET_RPC_URL
```
Mining starts in that block. Check: `cast call <mine> "stats()" ...`, or the site.

## 7. Publish the site (it can go up before the launch)
The production build needs no contract addresses: it finds the token and the mine at runtime from the forwarder's
`Forwarded` event, and shows a pre-launch state until then.
```bash
launch/export-site.sh <account>                                   # builds web/ for mainnet, exports ../hmm-site
cd ../hmm-site && git push -u origin main && cd -                 # after creating <account>/hmm-site (public)
node launch/build-site-body.mjs https://github.com/<account>/hmm-site <commit> hmm
node launch/check.mjs launch/site-body.json job.open              # planner: kind website, one content check
node launch/pay.mjs --body launch/site-body.json --action job.open --pay
```
The swarm checks the content, pins it to IPFS and serves it at `https://hmm.sites.imd.fun` (the label was free on
2026-10-12). The question checker needs a proxy for browsers; deploy `web/proxy/check-worker.js` as a Cloudflare Worker
(any pseudonymous account) and set `CHECK_URL` before exporting, or the composer falls back to the vetted templates.

## 8. After launch
- Fees: the pool's 1% LP share accrues to the launcher in the ProjectFactory. Collect with
  `cast send 0xfF03410d0Fe5fa8f7F59F743de35E333D9857120 "claimFees(uint64)" <n>` then
  `withdraw(address account, address currency)` for IMD and HMM.
- Dev share: anyone can call `payDev()` on the mine; it pays the dev wallet.
- The swarm's 10% is claimed by the seats themselves from the launch's distributor.
