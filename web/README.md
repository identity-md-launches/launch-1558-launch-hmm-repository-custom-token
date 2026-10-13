# hmm · web

The site for **hmm**, the coin you mine by asking the IMD swarm ("proof of thought"). A static Vite + React app:
no backend, no trackers, no remote fonts, IPFS-friendly (relative asset paths, hash routing).

- **The pond** (`/`): the live hero. Frogs are online IMD agents (from `api.imd.fun/swarm`); questions asked
  through the mine drop in as bubbles, get a panel, and either rise as a gold coin (answered) or pop into mist.
  The moon is the emission: phase = halving era, ring = the 10-minute round, reflection = the pot.
- **Ask** (`/ask`): the composer. Vetted question templates, address/number validation, the swarm's free check,
  the exact bytes the mine composes (`bodyOf`), approve + ask (solo or pooled).
- **Open questions**, **My thoughts** (claim, refund, share card), **Ledger** (answered rounds as blocks),
  **Miners** (leaderboard), **The moon** (emission schedule), **How it works**, **Token & trust**, **FAQ**.

Every number comes from the chain (the mine's events and views) or the IMD API. When data is missing the UI says
so instead of guessing.

## Run it against the devnet

Requires Node 20.19+ (22 recommended).

```sh
cd web
npm install            # .npmrc sets legacy-peer-deps
npm run dev            # http://localhost:5173 (any free port: npm run dev -- --port 5178)
```

With no `VITE_MINE`/`VITE_FORWARDER` set, the app reads `../deployments/devnet.json` (or `HMM_DEPLOYMENT=path`).
In `vite dev` that file is re-read on every page load, so a restarted devnet only needs a reload. The dev server
also provides the same-origin helpers the preview server has:

| Path         | What                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ |
| `/imd-check` | proxy to `https://api.imd.fun/requests/check` without an `Origin` header (the question check) |
| `/rpc`       | proxy to the devnet RPC from the deployment file                                           |
| `/faucet`    | `POST {"address":"0x…"}` → 5 test IMD + 0.2 test ETH (devnet only, uses anvil impersonation) |

Wallets on the devnet (chain 31337):

- **Devnet burner**: a fresh key generated and kept in this browser; press "Get test IMD" in the wallet menu.
- **Shared test accounts #0–#4**: anvil's public test keys (they hold devnet IMD). Signed in the page and sent as
  raw transactions, so they also work through a read-only RPC proxy.
- **Your browser wallet**: use "Add hmm devnet to wallet" (adds chain 31337 with this site's RPC).

These devnet wallets (and anvil's public test keys) are compiled into devnet builds only: `__HMM_DEVNET__` is a
build-time constant (true when `VITE_CHAIN_ID` is 31337/1337, or when the baked deployment file is a devnet), and the
code sits behind dynamic imports that other builds drop. Check a mainnet build with
`grep -r "test test test\|ac0974bec39a17e36\|burner" dist` (no matches).

## Build

```sh
npm run typecheck
npm test               # unit tests (vitest)
npm run build          # → dist/
```

### Static export for IPFS

`vite.config.ts` uses `base: './'` and the app uses a hash router, so `dist/` works from any path or gateway:

```sh
VITE_FORWARDER=0x876C2FB3eAa91D32Ef03186853bB82433b949a71 \
VITE_CHECK_URL=https://<your-check-proxy> \
npm run build
ipfs add -r --cid-version 1 dist      # or any pinning service; open https://<cid>.ipfs.dweb.link/
```

Fonts are bundled from `@fontsource-variable/*`; nothing is loaded from third-party CDNs. The only network calls
are the RPC, `api.imd.fun` (swarm snapshot and oracle feed, read-only) and the check proxy.

### Preview build for the devnet preview server

`devnet/preview.mjs` serves `web/dist` with same-origin `/rpc`, `/imd-check` and `/faucet`:

```sh
VITE_RPC_URL=/rpc VITE_CHECK_URL=/imd-check npm run build   # deployment file baked in; URLs resolve at runtime
```

## Configuration

All optional. Relative URLs (`/rpc`) resolve against the page at runtime.

| Variable               | Default                                   | Meaning                                                                 |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `VITE_CHAIN_ID`        | `1` (env mode) / file's chainId           | Chain the app talks to                                                  |
| `VITE_RPC_URL`         | `https://ethereum-rpc.publicnode.com` on mainnet, the file's `rpcUrl` on the devnet | Read RPC (CORS-enabled); also used for indexing |
| `VITE_FORWARDER`       | –                                         | GenesisForwarder: discover the launch at runtime (see below)            |
| `VITE_FORWARDER_BLOCK` | last ~200k blocks                         | Where discovery starts scanning                                         |
| `VITE_LAUNCH_NUMBER`   | –                                         | Pin discovery to one launch number                                      |
| `VITE_HMM`, `VITE_MINE`, `VITE_ADAPTER` | –                         | Explicit contracts (override discovery)                                 |
| `VITE_DEPLOY_BLOCK`    | `0`                                       | First block the event indexer reads                                     |
| `VITE_IMD`, `VITE_INTAKE` | mainnet IMD / IMD Intake v2            |                                                                         |
| `VITE_EXPLORER`        | `https://etherscan.io` on mainnet         | Explorer for links (`''` = none)                                        |
| `VITE_CHECK_URL`       | `/imd-check` in dev, none in builds       | Question-check proxy. Without it, free-form questions need an explicit acknowledgement |
| `VITE_FAUCET_URL`      | `/faucet` on the devnet                   | Devnet faucet                                                           |
| `VITE_LOG_CHUNK`       | 20000 (50000 on the devnet)               | Max blocks per `eth_getLogs`; halved automatically on errors            |
| `HMM_DEPLOYMENT`       | `../deployments/devnet.json`              | Deployment file (build/dev time)                                        |

### The RPC must serve the mine's log history

The app reads everything about questions, rounds and backers from the mine's events (`eth_getLogs` from the deploy
block on). Free public endpoints only serve recent logs: `ethereum-rpc.publicnode.com` (the default) refuses ranges
older than ~10,000 blocks (~1.4 days) without a token, and others cap the range at 50–10,000 blocks. With such an
endpoint the site still works but degrades: it indexes only the recent window and says so ("activity before block N
isn't listed"); the pot, HMM mined and claiming stay complete because they come from contract views (My thoughts
finds a wallet's older questions with `backing`/`question`/`claimable` over all ids). **For production set
`VITE_RPC_URL` to an endpoint with full log history** (your own node behind a small proxy, or a provider key
restricted to the site's origin).

### Mainnet launch day: discovery

Build with `VITE_FORWARDER` only. At runtime the app reads the forwarder's
`Forwarded(launchNumber, token, mine, amount)` logs, verifies the mine (`token()`, `forwarder()`, symbol `HMM`),
reads `adapter()`, and indexes from the `Forwarded` block. The scan runs newest-first and stops quietly where the
RPC's history ends. The result is cached in localStorage. Before any launch
the site runs in **pre-launch** mode (the pond with the real swarm, the moon not yet risen, "mining opens soon",
the explainer and tokenomics) and re-checks every minute, so it goes live by itself. Explicit `VITE_HMM`/`VITE_MINE`
override discovery.

## The question-check proxy

`POST https://api.imd.fun/requests/check` refuses browser origins, so the site calls it through a proxy:

- `vite dev`: built in at `/imd-check`;
- the devnet preview server: `/imd-check`;
- production: `proxy/check-worker.js`, a Cloudflare Worker that forwards only `oracle.request` checks (POST,
  ≤ 20 KB) without `Origin`, and adds CORS headers:

  ```sh
  npx wrangler deploy proxy/check-worker.js --name hmm-check --compatibility-date 2026-10-01
  # optional: ALLOWED_ORIGINS="https://your.site,https://<cid>.ipfs.dweb.link"
  ```

## Contracts and ABIs

The ABIs in `src/abi/` are generated from the Foundry build:

```sh
(cd .. && forge build) && npm run abi
```

Questions are proposed as a `Spec` (question text, answer type, evidence, chain, window, panel, quorum,
tolerance); the mine composes the JSON body itself. `src/lib/spec.ts` mirrors its rules and composition byte for
byte (tested against `bodyOf` in the e2e test), and the composer shows the contract's own `bodyOf` output.

## Tests

- `npm test`: unit tests for the template/body builder (exact JSON, byte limits, the mine's question rules),
  emission math mirroring `emittedAt`/`rateAt`/rounds, answer decoding for every answer type, reason-code
  humanizing and number formatting.
- `npm run e2e` (needs the devnet): `emittedAt`/`rateAt` parity with the chain, `bodyOf` parity for every
  template, a solo ask answered by the swarm simulator, a pooled ask completed by a second account, and a claim
  after the round ends whose amount must equal what the app's indexer and accounting compute. `E2E_QUICK=1` skips
  the up-to-10-minute wait for the round to end.

## Layout

```
src/
  abi/            generated ABIs
  config.ts       env / deployment file / discovery config
  wagmi.ts        chains and connectors (injected; devnet-only local-key wallets)
  data/           event indexer, discovery, chain/API hooks, tx runner, mining accounting
  lib/            pure logic: templates, spec, emission, answers, reasons, formatting, errors (unit tested)
  pond/           the Thinking Pond: WebGL water + canvas swarm engine
  components/     UI pieces (wallet, header, cards, charts, share card, toasts)
  pages/          routes
  styles/         design system and page styles
lab/pond.html     dev-only harness for the pond animation (not part of the build)
proxy/            production check proxy (Cloudflare Worker)
e2e/              devnet end-to-end test
```

Motion and sound:

- First visit in a session plays a ≤ 3 s intro (the view glides down from the stars, the frogs wake); any click,
  key, wheel or scroll skips it.
- The home page tells the story in five scroll-scrubbed chapters (sticky stages driven by CSS variables).
- Pond sounds are synthesized with WebAudio (no audio files): night ambience, croaks, plips, splashes, chimes. Off
  by default; the speaker button in the header turns them on and the choice is remembered.

Accessibility: respects `prefers-reduced-motion` (no intro, calm pond, no ticker scroll, story chapters shown as
finished frames, no reveals), keyboard-reachable controls, visible focus, and text alternatives for the canvas.
Automated full-page captures get every section revealed.
