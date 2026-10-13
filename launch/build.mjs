// Builds the swarm launch request (`launch.open`, kind custom_token) from launch/config.json and the constants in
// script/HmmLaunch.sol, so the request can never disagree with what the tests rehearse.
// Usage: node launch/build.mjs            -> writes launch/body.json and prints it
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const cfg = JSON.parse(readFileSync(new URL("launch/config.json", root)));
const sol = readFileSync(new URL("script/HmmLaunch.sol", root), "utf8");

const constant = (name) => {
  const m = sol.match(new RegExp(`constant ${name} = ([^;]+);`));
  if (!m) throw new Error(`HmmLaunch.${name} not found`);
  return m[1].trim();
};
const num = (name) => {
  const v = constant(name).replace(/_/g, "");
  if (/^\d+ minutes$/.test(v)) return String(Number(v.split(" ")[0]) * 60);
  if (/^\d+ days$/.test(v)) return String(Number(v.split(" ")[0]) * 86400);
  if (/^\d+$/.test(v)) return v;
  throw new Error(`cannot read ${name}: ${v}`);
};
const addr = (name) => constant(name).toLowerCase();
const lower = (a) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`not an address: ${a}`);
  return a.toLowerCase();
};
const hex32 = (s) => "0x" + Buffer.from(s).toString("hex").padEnd(64, "0");

const IMD = addr("IMD");
const INTAKE = addr("INTAKE");
const REGISTRY = addr("LAUNCH_REGISTRY");
const SIGNER = addr("ORACLE_SIGNER");
const ACTION = hex32("oracle.request@oracle-1");
const forwarder = lower(cfg.forwarder);
const steward = lower(cfg.steward);
const NO_STEWARD = steward === "0x0000000000000000000000000000000000000000";
if (!NO_STEWARD) throw new Error("HmmMine takes no steward argument: config.steward must be the zero address");
const dev = lower(cfg.dev);
const poolBps = Number(cfg.poolBps);
if (poolBps !== Number(num("POOL_BPS"))) throw new Error("poolBps differs from HmmLaunch.POOL_BPS");
const cap = BigInt(cfg.initialMarketCapWei);
if (cap < 250n * 10n ** 18n || cap > 250_000n * 10n ** 18n) throw new Error("IMD opening cap must be 250-250,000 IMD");

const adapterArgs = [INTAKE, SIGNER, num("MIN_PANEL"), num("MIN_QUORUM")];
const mineArgs = [
  "$token",
  IMD,
  INTAKE,
  ACTION,
  forwarder,
  "$contract:SwarmOracleAdapter",
  dev,
  num("DEV_BPS"),
  num("ROUND_LENGTH"),
  num("ERA_LENGTH"),
  num("GENESIS_DELAY"),
];
// IMD's launch checker refuses any zero-address constructor argument (and stand-ins such as 0x...dead).
for (const a of [...adapterArgs, ...mineArgs]) {
  if (/^0x0{40}$/i.test(a) || /^0x0{36}dead$/i.test(a)) throw new Error(`zero or stand-in address in constructorArgs: ${a}`);
}
const q = (a) => "[" + a.map((x) => JSON.stringify(x)).join(", ") + "]";
const capImd = (cap / 10n ** 18n).toLocaleString("en-US");

const objective = `Launch hmm from this repository as it is: a custom_token launch on Ethereum mainnet, paired with IMD.

Token: contract HmmToken (src/HmmToken.sol), name "hmm", symbol HMM, 18 decimals, constructorArgs [], totalSupply 1000000000000000000000000000 (1,000,000,000 HMM minted once to msg.sender, the factory). No owner, no mint or burn after construction, no fee or rule on transfer.

Application contracts, in this order:
1. SwarmOracleAdapter (src/SwarmOracleAdapter.sol), constructorArgs ${q(adapterArgs)}
2. HmmMine (src/HmmMine.sol), constructorArgs ${q(mineArgs)}

SwarmOracleAdapter takes no mine argument: HmmMine's constructor calls bind() on the SwarmOracleAdapter deployed just before it (an earlier contract of this launch, in the same transaction), which claims it; it moves no tokens. No constructor argument is the zero address. The fourth HmmMine argument is bytes32("oracle.request@oracle-1").

Economics, copied into launch.json exactly: poolBps ${poolBps}, initialMarketCapWei ${cap} (${capImd} IMD), remainderTo ${forwarder}.

The remainder goes to the GenesisForwarder at ${forwarder}, deployed earlier from src/GenesisForwarder.sol with registry ${REGISTRY} and mineName bytes32("HmmMine"). After launch, anyone calls forward(launchNumber): it reads this launch from the registry, checks the HmmMine artifact mines this token and names this forwarder, moves the whole remainder into it and starts mining.

What it does: HMM is mined by asking the IMD swarm. Anyone proposes a question in HmmMine (the mine writes the oracle.request JSON itself from validated fields) and backs it with IMD; once it holds the Intake price it is asked through the IMD Intake (requestWithFailure) with SwarmOracleAdapter as the callback target. Answers signed by the IMD oracle signer for the adapter (panel >= 5, quorum >= 4, agreed >= quorum and a majority) credit the current 10-minute round; backers share the round's emission pro-rata to IMD paid. Emission halves every 180 days and never exceeds the reserve; 5% of each round goes to the dev address. ${NO_STEWARD ? "HmmMine has no steward: it takes no steward argument and its steward stays zero forever, so nobody can change the adapter, the action id or any rule after launch; there are no owner powers at all." : "A steward can queue a new adapter or action id behind a 3-day timelock, for new questions."}

Keep contract logic, names, constructor arguments, fee rules and permissions exactly as they are; adapt the Foundry project only as much as the launch factory requires. The test suite (forge test) must stay green.`;

if (objective.length > 8000) throw new Error(`objective too long: ${objective.length}`);

const body = {
  objective,
  repoUrl: cfg.repoUrl,
  baseCommit: cfg.baseCommit,
  // The swarm's own-repository launch pipeline (as INFER's launch ran): audit the imported code, adapt it for the
  // factory, add tests, then the adversarial review, which a launch turns into the four-specialist audit panel.
  shape: "chain",
  references: ["custom-token-launch", "solidity-security-review"],
  steps: [
    { skill: "audit-imported-code" },
    { skill: "adapt-contract-project" },
    { skill: "write-foundry-tests", paths: ["test"] },
    { skill: "adversarial-review" },
  ],
  onchain: "custom_token",
  chainId: Number(cfg.chainId),
  pairWith: "imd",
  economics: { poolBps, initialMarketCapWei: String(cap), remainderTo: forwarder },
  github: true,
};
writeFileSync(new URL("launch/body.json", root), JSON.stringify(body, null, 2) + "\n");
console.log(JSON.stringify(body, null, 2));
console.error(`\nobjective ${objective.length}/8000 chars; launch/body.json written`);
