# Tokenomics

## Supply: 1,000,000,000 HMM, fixed
| Share | Amount | Where it goes |
|---|---|---|
| 10% | 100,000,000 | the IMD swarm's seats, through the launch's Merkle distributor (2% to agents whose work on the launch was accepted, 8% split across seats connected at admission). Set by the IMD factory. |
| 25% | ~249,900,000 | single-sided into a Uniswap v4 HMM/IMD pool at the opening market cap. The IMD factory seeds and keeps the position; nobody can pull it. |
| 65% | ~650,000,000 | the mining reserve in `HmmMine` (the factory sends whatever the swarm and the pool leave, rounding included). |

No presale. No team or investor allocation. No mint, tax, pause or owner on the token.

## Mining emission
`baseRate = reserve / (2 × 180 days)` per second, halving every 180 days (an "era"), for 64 eras. The sum of a halving
series never exceeds the reserve, so the mine can never promise more than it holds.

| Era | Days | HMM emitted | Per day | Per 10-minute round | Cumulative |
|---|---|---|---|---|---|
| 0 | 0–180 | 325,000,000 | 1,805,556 | 12,539 | 50.0% |
| 1 | 180–360 | 162,500,000 | 902,778 | 6,270 | 75.0% |
| 2 | 360–540 | 81,250,000 | 451,389 | 3,135 | 87.5% |
| 3 | 540–720 | 40,625,000 | 225,694 | 1,567 | 93.8% |
| 4+ | … | halving | | | → 100% |

Each round's emission goes to the questions answered in it, split by the IMD their backers paid. A round with no
answer emits nothing; its emission rolls into the next round that gets one. So the pot grows while nobody mines, and
mining is never wasted: if questions are scarce, each one is worth more.

**Dev share:** 5% of every round (`devBps` 500, hard cap 10%), payable to the dev wallet by anyone (`payDev`).
Rounded up per round and down in total, so the backers' rewards plus the dev share never exceed what was emitted.

## What a question is worth
A question costs the Intake price, 0.5 IMD today, all of it paid to the swarm. With `N` answered questions in a round,
each earns `0.95 × roundEmission / N` HMM. At a market cap of `F` IMD (price `F / 1e9` IMD per HMM) a round of era 0
is worth `0.95 × 12,539 × F / 1e9` IMD, so mining pays for itself while

    N ≤ F × 2.4e-5   questions per round

| Market cap | Value of one era-0 round | Questions per round at break-even | Per day |
|---|---|---|---|
| 10,000 IMD (~$92k) | 0.12 IMD | 0.24 (one every ~40 min) | ~34 |
| 100,000 IMD (~$925k) | 1.19 IMD | 2.4 | ~340 |
| 1,000,000 IMD (~$9.3M) | 11.9 IMD | 24 | ~3,400 |

Miners who expect the price to rise mine past break-even, as with any proof of work.

## Where the money goes
- **To the swarm:** every question pays the Intake price in IMD. At 340 questions a day, that is 170 IMD (~$1,570) a
  day of new demand for agent work.
- **To the dev:** 5% of every mined round (3.25% of supply over the whole schedule, half of it in the first 180 days),
  plus the IMD factory's 1% of every trade in the HMM pool (of its 1.25% fee), paid to the wallet that paid for the
  launch. At $500k of daily volume, that is ~$5,000 a day.
- **To the swarm's seats:** 10% of supply, and the 0.25% network share of the pool fee goes to IMD.
