# Design

## The idea
Bitcoin is mined with hashes nobody needs. HMM is mined with answers: to mine it, you pay the IMD swarm to answer a
question, and you are rewarded only if a panel of its agents agrees and the swarm's oracle signs the answer. Every HMM
in circulation outside the pool and the swarm's share stands for a question the swarm answered.

## Contracts
```
            IMD                                          the IMD swarm
             │ back / propose                                  ▲  panel of agents answers,
             ▼                                                 │  oracle signs (EIP-712)
        ┌─────────┐  requestWithFailure(0.5 IMD) ┌────────┐    │
 user ─►│ HmmMine │ ───────────────────────────► │ Intake │ ───┘ (IMD to the swarm's treasury)
        └─────────┘                              └────────┘
             ▲  credit / fail                         │ complete(): callback, 200k gas
             │                                        ▼
        ┌────────────────────┐   verifies signature, panel ≥ 5,
        │ SwarmOracleAdapter │   quorum ≥ 4, agreed ≥ quorum and > half,
        └────────────────────┘   unexpired, not reused
```
- **HmmToken**: plain ERC-20, 1e27 minted once to the IMD factory.
- **HmmMine**: questions (propose, back, refund), the one-request-per-transaction guard, rounds, the halving
  schedule, claims, the dev share, and the steward's timelocked adapter rotation.
- **SwarmOracleAdapter**: the Intake callback target. It checks that the Intake is calling and that the request named
  it and is completed, then verifies the attestation. A good answer credits the question. Anything else marks the
  question failed with a reason code.
- **GenesisForwarder**: the launch's `remainderTo`. `forward(launchNumber)` reads the launch from the factory's
  registry, finds its token and its `HmmMine`, checks they belong together and point back at the forwarder, then moves
  the reserve and starts the mine. It is stateless, so a copycat launch can only ever move its own token into its own
  mine.

## A question's life
1. `propose(spec, amount)`: the mine writes the IMD oracle JSON from the `Spec` (question text, answer type, evidence,
   chain, window, panel and quorum) and checks every field, so nobody can add fields that would make the answer not
   count. `bodyOf(spec)` shows the exact bytes. The target is the Intake price at that moment. The proposer backs it
   with `amount` (≥ 0.01 IMD, or the whole price if it is lower). Optional meanings can be supplied through
   `proposeWithDefinitions(spec, definitions, amount)`; `bodyWithDefinitions(spec, definitions)` shows its exact
   bytes. Each definition is a `(key, value)` pair: at most 16 unique nonempty keys of at most 64 bytes and nonempty
   values of at most 512 bytes, using the question's printable-ASCII rules. The wording screen stays enabled.
2. `back(id, amount, body)`: anyone adds IMD within 3 days. The backer who completes the price passes the body (from
   the `Proposed` event) and the question is asked in that transaction; when other backers' IMD is in it, that backer
   must be an account calling directly with no delegated code, so no other Intake request can come first in the
   transaction. If the price rose meanwhile, completion reverts, and backers take their IMD back after the window
   with `refund(id)`. If it fell, only the live price is spent, and `refund(id)` immediately returns each backer's
   pro-rata unspent surplus. After asking, `question.target` is the actual payment and `question.raised` is the
   frozen original backing; the latter remains the denominator of the backers' split.
3. The swarm answers: status 0 credits the current round (backers' shares = IMD paid). Status 1 (refused) or 2 (no
   agreement) marks it failed; that IMD is spent, as it would be by any oracle user. If no callback arrives, anyone
   can call `expire(id)` strictly after `answerDeadline(id)`, seven days after the ask. Until that call a late answer
   may still count; afterwards the question is terminal. Expiry moves no funds.
4. `claim(ids)` after the round ends. Claims automatically return any unclaimed price-drop surplus before consuming
   the backing. A separate surplus refund does not consume HMM reward rights.

## Rounds and emission
`credit` puts the question into round `(now − genesis) / 600`. The first credit of a round fixes its emission:
`emittedAt(roundEnd) − assigned`, i.e. everything emitted since the last answered round ended. Later credits in the
same round only add shares. `assigned` only grows and is bounded by the schedule, which is bounded by the reserve.

Before rounding, a backer's reward is `round.reward * question.target * backing / (round.shares * question.raised)`.
The final claimant in a round receives the residual integer-division dust. Zero-rounded claims are recorded too,
so they cannot prevent that final claim. The corresponding last-surplus-refund rule returns every unspent IMD wei.
The dev share calculation is unchanged.

For event consumers, `PriceAdjusted(id, quoted, paid)` precedes `Asked` when the price falls. `Refunded` still means
an expired Open backing was withdrawn; `SurplusRefunded` means an unspent price difference was returned without
reducing reward backing. Read `refundable(id, backer)` and `claimable(id, backer)` for current entitlement, including
any final-claim dust. `claimedBacking`, `roundClaims` and `surplusRefunds` expose the settlement progress.

## Trust and failure modes
- **IMD:** the Intake (immutable address), its writer (completes requests) and the oracle signer. A malicious writer
  could withhold answers or pair a valid answer for one of our questions with another of our questions; it cannot
  forge an answer, credit a question nobody paid for, or touch funds.
- **No admin:** the launch sets no steward, so the adapter and action id are fixed forever. (The code supports a
  timelocked steward for a future IMD format change, but an adapter decides which questions mine, so a steward could
  redirect emission; hmm launches without one.)
- **Gas:** the Intake gives callbacks a fixed 200,000 gas. The costliest path tested (the first answer of the mine, a
  32-address answer, 40 eras in) needs 118,437, measured by bisecting the real Intake's stipend; long answers are
  logged as a hash, so a 3,000-entry list still fits.
- **One request per transaction:** the IMD plane serves only the first Intake request of a transaction, so the mine
  refuses a second ask in the same transaction (transient storage).
- **Public bodies:** a question's body is on chain forever; the site warns before asking.

## Verified against reality
- The adapter's EIP-712 encoding recovers the real oracle signer from five real attestations the swarm signed
  (`test/fixtures/RealAttestations.sol`).
- The unit tests run against the IMD Intake's own source (`test/external/Intake.sol`, verified on mainnet).
- `test/fork/Launch.fork.t.sol` launches hmm through IMD's real ProjectFactory on a mainnet fork. It forwards the
  reserve, pays a question through the real Intake with real IMD, delivers the answer within the real stipend, and
  claims.
