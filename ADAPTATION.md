# HMM launch adaptation

## Launch contract and configuration checks

The incoming project already had the required nonpayable constructors. No constructor, contract name, token
behavior, launch address, authority, fee, round length or halving parameter needed changing. Production changes
are confined to `src/HmmMine.sol` and address reproduced imported audit findings.

- `HmmToken()` still returns name `hmm`, symbol `HMM`, 18 decimals, and mints exactly
  `1000000000000000000000000000` units once to its deployer, the factory. It has no owner, subsequent mint or burn,
  transfer fee, pause or holder restrictions. `src/HmmToken.sol` is unchanged.
- `SwarmOracleAdapter(address,address,uint256,uint256)` keeps the supplied Intake, signer, 5-member minimum and
  4-vote quorum arguments. `src/SwarmOracleAdapter.sol` is unchanged.
- `HmmMine(address,address,address,bytes32,address,address,address,uint256,uint256,uint256,uint256)` keeps all
  eleven arguments in the supplied order, including the literal `bytes32("oracle.request@oracle-1")`, the fixed
  forwarder, the specified dev address, `500`, `600`, `15552000`, and `0` genesis delay. There is no steward argument;
  the production steward remains zero and no caller can obtain that role. The final numeric zero is not an address.
- The adapter and mine must deploy in that order in one factory transaction. The mine's constructor binds only the
  newly deployed adapter and moves no tokens. It does not query the external Intake, IMD or forwarder during
  construction. `test/FactoryLaunch.t.sol` deploys this exact graph through CREATE2 with the supplied mainnet
  addresses carrying no code, and verifies the entire supply remains at the factory.
- `src/GenesisForwarder.sol` is unchanged because the launch uses the already-deployed contract at
  `0x876c2fb3eaa91d32ef03186853bb82433b949a71`. The fork test compares its runtime with the compiled source, including
  registry `0x7c9d5ee697bff5ac4f10e2e54d3f40c44e48fe23` and `bytes32("HmmMine")` immutables.
- Existing build configuration and dependencies are unchanged. They already pin Solidity 0.8.26, Cancun,
  optimization and `bytecode_hash = "none"`. No dependency was installed or introduced.

The next manifest step retains Ethereum mainnet (1), IMD pairing at
`0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`, fee `12500`, tick spacing `60`, the specified provenance price, and
exactly these economics:

```json
{"poolBps":2500,"initialMarketCapWei":"10000000000000000000000","remainderTo":"0x876c2fb3eaa91d32ef03186853bb82433b949a71"}
```

No `launch.json` was written. There were no broadcasts, live state changes or deployments on a public chain.

## Imported findings: reproduction and disposition

### 5ff239b68c55 — stale Intake quote overpays after a price fall — fixed

The supplied proof failed against the original source: after a 0.5 → 0.25 IMD price change, Alice's 0.3 and Bob's
0.2 IMD backing paid 0.5 IMD to the treasury and left nothing in the mine. It passes with the change.

`_ask` now approves and pays only the live price. Once asked, `Question.target` records the actual payment and
`Question.raised` preserves the original total backing. `refundableSurplus` accounts for the unspent difference;
`refund(id)` pays it pro-rata without consuming HMM rights. `claim(ids)` automatically refunds any outstanding
surplus before clearing backing. A final surplus refund includes division dust, and every refund is consumed once,
including a refund that rounds to zero. Surplus remains refundable on Asked, Answered, Failed and timed-out
questions. The spent oracle price is never refunded.

Round shares now use actual IMD paid. Within a question the reward ratio remains the original backing ratio, using
full-precision multiplication/division. This avoids double rounding when the question's price falls. A price rise
or delisting retains the existing revert and expired-Open-refund behavior.

`PriceAdjusted(id, quoted, paid)` makes a price fall observable before `Asked`. `SurplusRefunded` is separate from
the existing `Refunded` event so it does not imply that reward backing was withdrawn. New views expose the
refundable amount and refund progress. `test/audit/PriceDrop.t.sol` covers the proof, claims before/after refunds,
failures, expiry, duplicates, zero rounding and 2,000 randomized splits/refund orders. The adversarial invariant
handler now models live payments and checks `balance(IMD, mine) == openRaised + refundableSurplus`, backed by
per-question liabilities.

### c002d6afba29 — delegated EOAs bypass the pooled-completer guard — fixed

Reproduced with an actual EIP-7702 delegation: the origin self-calls a delegated batch executor, makes its own Intake
request, then completes another user's pooled question. The original guard accepts it. Foundry 1.8.3 supports this
test using `vm.setEvmVersion("prague")` and `vm.signAndAttachDelegation`; no build setting was changed.

The existing direct-caller guard now also requires empty caller code when other backers' funds are involved. This
detects the 23-byte delegation indicator described by [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702#delegation-indicator).
`test/audit/RequestLifecycle.t.sol` verifies that the whole malicious batch reverts, all pooled backing remains,
and an ordinary EOA can subsequently complete it. Partial backing and sole-backer questions remain available to
delegated accounts and contracts. Someone spending only their own backing can still misuse an external batch;
the mine cannot observe all prior external Intake requests in a transaction.

### 25d530230732 — no definitions for ambiguous questions — fixed input limitation

Both exact example questions again produced the `ambiguous_question` blocker from the free
[`oracle.request` checker](https://api.imd.fun/requests/check) on 2026-10-13. The on-chain refusal path was also
reproduced: a status-1 `body_refused` callback closes the question without mining or returning the spent price.

`proposeWithDefinitions(spec, definitions, amount)` and `bodyWithDefinitions(spec, definitions)` now accept up to
16 unique definitions with nonempty keys of at most 64 bytes and values of at most 512 bytes. They use the existing
printable-ASCII restrictions, including rejection of quotes, backslashes and control bytes. The mine generates and
commits the complete JSON; a completing backer cannot omit or substitute definitions. The original Spec and both
original function signatures/bodies remain compatible. Even all maximum-size fields fit the 16 KiB paid-body cap.

`test/audit/Definitions.t.sol` checks the emitted-body commitment, parsed meanings, injection attempts, duplicate
keys, bounds, maximum body size, empty definitions, successful settlement and refusal. The wording screen remains
enabled: definitions help pin a reading but do not guarantee acceptance or make the Intake fee refundable.

### a41532a877c5 — late HMM is stuck in the fixed forwarder — forwarding repaired

Reproduced `AlreadyStarted()` when forwarding a late transfer. Editing the deployed forwarder's source would not
repair the fixed live address, so the compatible fix is in `HmmMine.start()`: after the first successful start,
another call from the same immutable forwarder returns without changing state. The forwarder's existing transfer
and unconditional `start()` then finish successfully. Other callers still revert `NotForwarder()`.

`test/GenesisForwarder.t.sol`, `test/HmmMine.t.sol` and the mainnet fork test check repeated forwarding, including
after answers and claims, and prove reserve, genesis, rate, assigned rewards and claimed totals do not reset.
This implements the audit's proposed onward-transfer behavior. **Late HMM still does not enter the fixed mining
reserve or become withdrawable**; there is no sweep, new emission authority or donation-recovery promise.

### a07ab78e0ae3 — first-caller binding — no change to the required atomic launch

The standalone-deployment scenario reproduces: a stranger can claim an unbound adapter and a later mine deployment
reverts. It does not reproduce as an interleaving attack on this launch, whose ordered deployments and constructor
`bind()` are one transaction. The brief explicitly requires that mechanism. Existing `NoSteward` tests plus
`test/FactoryLaunch.t.sol` verify binding during deployment and refusal of later claimants;
`test/audit/RequestLifecycle.t.sol` retains the separate-deployment counterexample. Never deploy this adapter in
a prior public transaction and expect it to remain unclaimed.

### ebc7af44b22b — an undelivered request stays Asked forever — fixed

The original source could not close an unanswered question even after eight days. `_ask` now records
`answerDeadline(id) = block.timestamp + ANSWER_WINDOW`, with an immutable seven-day window allowing substantially
more than the usual minutes-long delivery time. Anyone can call `expire(id)` strictly after that deadline; it
records Failed/status 2/reason `timeout` and moves no value. Until explicitly expired, a late valid answer may
still count, preserving successful late delivery. After expiry neither a result nor a failure callback can revive
or settle the question again.

`test/audit/RequestLifecycle.t.sol` tests the exact boundary, funding near its deadline, unknown/Open/settled ids,
malformed undelivered callbacks, late signatures and failures, no premature consumption of oracle ids, and unchanged
balances. The adversarial handler also exercises expiration. Any unspent surplus remains refundable separately.

### ea7d6f9ab061 — per-backer HMM rounding dust — fixed

Reproduced the reported 10-wei reward / 7-share case: the original 3-share and 4-share claims paid 4 and 5 wei,
leaving one permanently assigned wei. The mine now tracks claimed backing per question and completed shares/rewards
per round. Ordinary claims retain proportional floor rounding; the final claimant receives the remaining round
reward. Zero-rounded claims are consumed and recorded too, so they cannot make the final claimant unreachable.

`test/audit/Rounding.t.sol` covers the exact 4+6 regression, zero-rounded pooled claims and multiple questions in
one claim batch. `test/Emission.t.sol` now asserts that all backer claims exhaust the round reward exactly. The
adversarial invariants check completed-round settlement. The emission schedule, dev calculation, reserve bound,
and unrelated integer rounding in the halving schedule are unchanged.

### 2cfc2f7d7d57 — scope report — not a defect

This entry describes the earlier review's coverage rather than a failing input. No speculative source change was
made for it. This adaptation independently reran the original 80-test baseline, reproduced the findings above,
checked the supplied protected token floor, added the supplied protocol vector, and rehearsed the launch on a
mainnet fork. It is not a new full audit of the IMD token, factory, registry, oracle writer or web application.

## Other changed files and validation

- `test/OracleConsumerConformance.t.sol` copies the reference's exact chain, consumer address, struct values,
  digest and signature. Its setup uses the unchanged adapter and the vendored Intake v2. It verifies the canonical
  selector, signature delivery under 200,000 gas, and a fresh signed false answer. No oracle implementation was
  replaced, and the existing five real-attestation fixtures still pass.
- `test/FactoryLaunch.t.sol` checks the exact supplied constructor graph, no-code external dependencies, atomic
  binding, no constructor supply movements and runtime size limits.
- `test/HmmMine.t.sol` replaces only obsolete overpayment and repeated-start expectations with the audited fixes.
  `test/GenesisForwarder.t.sol` similarly checks harmless repeated forwarding; `test/Emission.t.sol` strengthens
  reward conservation. `test/audit/AdversarialInvariants.t.sol` adds live-price liabilities, surplus refunds, expiry
  and exact settlement checks. The new audit regression files are listed under their findings above.
- `test/fork/Launch.fork.t.sol` now uses the specified deployed forwarder, checks its byte-for-byte runtime,
  exercises late forwarding, and expects the last backer to receive rounding dust. The rehearsal remains a fork
  test; it never broadcasts.
- `docs/DESIGN.md`, `docs/SECURITY.md` and `docs/TOKENOMICS.md` explain the changed accounting, APIs, caller check,
  deadlines, rounding and remaining limitations. Front ends should read the new entitlement views and distinguish
  price adjustment/surplus events as described in DESIGN; the existing web application was not redesigned here.

Final checks with the project's own configuration:

- `forge build` — passed.
- `forge test` — **105 tests passed**, no failures or skips, with `test/scratch/` removed. Default fuzzing uses
  2,000 runs; both invariant handlers run 256 sequences of depth 80, with zero unexpected reverts.
- `FOUNDRY_PROFILE=fork MAINNET_RPC_URL=<Ethereum RPC> forge test --match-path 'test/fork/**'` — **5 tests passed**.
  The run used the task-supplied mainnet provider; its public source endpoint is
  [Ethereum PublicNode](https://ethereum-rpc.publicnode.com).
- Creation and runtime artifacts have no unresolved library links. Runtime lengths are HmmToken **1,753 bytes**,
  SwarmOracleAdapter **5,029 bytes**, HmmMine **18,670 bytes**, and GenesisForwarder **2,535 bytes**, all below
  EIP-170. An opcode scan skipping PUSH data found no DELEGATECALL, CALLCODE or SELFDESTRUCT in any of them.

The protected token harness was read but cannot run standalone in this repository: it imports the verifier's
factory/pool helper contracts. Local constructor, supply and real-factory fork checks supplement it; the network's
own protected checks and full audit remain the authority for admission. No Slither or Mythril run is claimed.
