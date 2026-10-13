# Security

Status: **unaudited by a third party.** Reviewed internally and by an independent adversarial review (findings and
fixes below). The IMD swarm runs its own audit panel on the code before it deploys the launch.

## Admin keys: none
The launch sets the steward to `address(0)`: nobody can change the adapter, the action id, the schedule, the dev share
or anything else after launch. The token has no owner.

## What is at stake
- The mining reserve (~650M HMM) in `HmmMine`.
- IMD that backers have put into questions still raising (`openRaised`), and unspent price-drop surplus
  (`refundableSurplus`), at most a few IMD per question.
- Backers' unclaimed rewards.

## Trust assumptions
| Who | Can | Cannot |
|---|---|---|
| IMD Intake owner | change the price, the writer, the callback gas; stop selling the action | touch the mine's funds; credit anything |
| IMD Intake writer | complete requests (or not); hand a valid answer for one of our questions to another of our questions | forge an answer; credit a question nobody paid for; move funds |
| IMD oracle signer | sign answers | without the writer, nothing reaches the mine |
| hmm steward | **none at launch** (`address(0)`). If one were set: queue a new adapter / action id, applied after 3 days, for questions proposed afterwards. An adapter decides which questions mine, so a malicious one could take the emission of every round it controls. | touch claimed rewards, past questions, or the IMD of questions proposed before the change (they refuse to be asked under it) |
| hmm dev | receive 5% of rounds | anything else |

## Properties the tests enforce
- HMM conservation, excluding unsolicited donations: `balance(mine) + claimed + devPaid == reserve`
  (invariant, ~20k random calls per run).
- Solvency: `claimed + devPaid + devOwed ≤ assigned ≤ schedule(now) ≤ reserve` (invariant + fuzz).
- IMD conservation: the mine holds `openRaised + refundableSurplus`; every ask pays the live Intake price exactly
  once. Surplus is refunded pro-rata, independently of HMM claims, with the final refund taking its rounding dust.
- A question is credited at most once; a round's shares equal its answered questions' payments.
- Only answers signed by the oracle for this adapter, with panel ≥ 5, quorum ≥ 4, agreed ≥ quorum and a majority,
  unexpired and never used before, can credit; everything else is recorded as failed with a reason.
- An outsider who pays the Intake directly and names the adapter cannot mine; a writer handing one request's callback
  another request's id is refused.
- The first answer ever, with a 32-address answer, 40 eras in, needs 118,437 of the Intake's 200,000 callback gas.
- The EIP-712 encoding matches five real attestations signed by the swarm's oracle.
- The launch, rehearsed on a mainnet fork through IMD's real factory, registry, pool, Intake and IMD.

## Independent review (2026-10-12): findings and fixes
| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium (key) | A steward-installed adapter can credit questions without oracle answers and fail others, taking future emission. | The mine has no steward: it takes no steward argument and its steward stays zero, so the steward code path is unreachable (`test/NoSteward.t.sol`; `test/audit/StewardAdapter.t.sol` exercises the path through the test-only `HmmMineStewarded`). |
| 2 | Medium | The proposer controlled the raw JSON body: a foreign `consumer`, a `deliver`, a tiny panel or a short validity made the answer not count, so the other backers paid for an answer signed for the proposer's contract. | The mine now writes the body itself from a validated `Spec` (printable ASCII question without `"` or `\`, panel ≥ 5, quorum ≥ 4 and a majority, fixed validity, scalar answer types). Injection is impossible by construction (`test_spec_rulesAndInjection`). |
| 3 | Low | A long list answer was logged in full and could run the callback out of its 200k gas; the answer would be lost. | `Thought` logs `answerHash` and the answer only up to 128 bytes; the answer is hashed once. A 3,000-entry answer is delivered (`test_longAnswer_isCountedAndHashed`). |
| 4 | Low | Completing a pooled question inside a transaction that already made another Intake request leaves the mine's request unserved. | Completing a question that holds other backers' IMD must come from an account calling directly (`tx.origin`); a contract can still back, or ask with only its own IMD. |
| 5 | Low | A question proposed just before a config change could be asked under the new adapter. | Questions record the config version; a stale one refuses to be asked and its backers refund. |
| 6 | Info | The forwarder's address is fixed in advance by the deployer's first nonce. | `DeployForwarder` refuses unless the deployer is at nonce 0 and matches `launch/config.json`; `pay.mjs` checks the forwarder on chain before paying. |

The reviewer's own adversarial invariant suite (price moves, rotations, rejected / reused / expired / oversized
answers) is kept in `test/audit/AdversarialInvariants.t.sol`.

## Known limitations
- With no steward, if IMD stops serving Intake v2 or changes the oracle's callback format, mining stops and the
  unemitted reserve stays in the mine forever. That is the price of having no admin key.
- A caller spending only its own backing can still place an external Intake request before its mine request and
  lose its own payment. Pooled completions require `msg.sender == tx.origin` **and** empty caller code, so EIP-7702
  batches cannot spend other backers' IMD this way. Delegated accounts can still contribute without completing.
- A question whose wording the swarm refuses or cannot agree on spends its IMD. The site runs the swarm's free check
  first and shows its verdict on every open question. The contract also offers `proposeWithDefinitions` and
  `bodyWithDefinitions` to pin meanings; definitions do not guarantee that a question passes the wording screen.
- An unanswered request can be closed by anyone using `expire(id)` strictly after `answerDeadline(id)` (seven days
  after the ask). This records `Failed` with reason `timeout`, moves no funds and prevents a later credit. The price
  already paid is not refundable; any unspent price-drop surplus remains refundable.
- The fixed, already-deployed forwarder can forward late HMM because repeated `start()` calls from it now do
  nothing. The reserve, genesis and emission schedule never change. Late HMM remains outside the mining reserve;
  transferring HMM to the mine or forwarder is not a way to replenish mining or recover an accidental donation.

## Launch-readiness change (2026-10-13)

IMD's launch checker refuses any zero-address constructor argument (and stand-ins such as `0x…dead`), and the first
launch attempt stopped on two that were zero by design. Both parameters were removed instead:

- `SwarmOracleAdapter` takes no `mine_` argument. The mine claims it by calling `bind()` from its constructor, in the
  same `launchCustom` transaction that deploys both, so nobody can claim it in between (if anyone did, `HmmMine`'s
  constructor would revert `AlreadyBound` and the whole launch with it). `applyConfig` already bound new adapters itself.
- `HmmMine` takes no `steward_` argument; `steward` starts and stays zero, and only the steward can name one.

Logic is otherwise unchanged. Regression tests: `test/NoSteward.t.sol` (no steward and nobody can name one; the adapter
cannot be claimed once the mine has it; the launch arguments carry no zero address). `launch/build.mjs` also refuses a
zero or `0x…dead` address in any constructor argument.

## Imported audit adaptation

The subsequent imported audit and each reproduced regression are recorded in [ADAPTATION.md](../ADAPTATION.md).
Round claims now consume even a zero-rounded share, and the final claimant receives the round's remaining integer
division dust. This changes neither the emission schedule nor the dev share. Default and adversarial invariants
cover backing, price changes, surplus refunds, timeouts and claims; protocol conformance is pinned independently
of signatures generated by the test suite.
