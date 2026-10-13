// Live proof of use, straight from the chain: unique miners, questions asked/answered/failed, IMD paid to the swarm,
// HMM mined and claimed, the dev share, and the launch's LP fees owed to the launcher.
// Usage: node launch/metrics.mjs                       (mainnet: finds the mine through the forwarder's Forwarded event)
//        node launch/metrics.mjs --devnet              (reads deployments/devnet.json)
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, parseAbiItem, formatUnits } from "viem";

const devnet = process.argv.includes("--devnet");
const cfg = devnet ? JSON.parse(readFileSync(new URL("../deployments/devnet.json", import.meta.url))) : JSON.parse(readFileSync(new URL("config.json", import.meta.url)));
const RPC = devnet ? cfg.rpcUrl : process.env.MAINNET_RPC_URL ?? "http://127.0.0.1:8545";
const pub = createPublicClient({ transport: http(RPC) });
const FACTORY = "0xfF03410d0Fe5fa8f7F59F743de35E333D9857120";

const ev = {
  forwarded: parseAbiItem("event Forwarded(uint64 indexed launchNumber, address indexed token, address indexed mine, uint256 amount)"),
  backed: parseAbiItem("event Backed(uint256 indexed id, address indexed backer, uint256 amount, uint256 raised)"),
  asked: parseAbiItem("event Asked(uint256 indexed id, bytes32 indexed requestId, address adapter)"),
  answered: parseAbiItem("event Answered(uint256 indexed id, bytes32 indexed requestId, uint256 indexed round, uint256 shares)"),
  failed: parseAbiItem("event Failed(uint256 indexed id, bytes32 indexed requestId, uint8 status, bytes32 reason)"),
  claimed: parseAbiItem("event Claimed(uint256 indexed id, address indexed backer, uint256 amount)"),
  proposed: parseAbiItem("event Proposed(uint256 indexed id, address indexed proposer, uint256 target, uint256 deadline, bytes body)"),
};
const mineAbi = parseAbi(["function stats() view returns ((uint256 reserve,uint256 genesis,uint256 baseRate,uint256 assigned,uint256 claimed,uint256 devOwed,uint256 devPaid,uint256 questions,uint256 round,uint256 roundEndsAt,uint256 era,uint256 rate,uint256 pot,uint256 roundShares,uint256 price,uint256 nextHalvingAt))"]);
const factoryAbi = parseAbi(["function owed(address account, address currency) view returns (uint256)"]);

async function logs(address, event, fromBlock) {
  const head = await pub.getBlockNumber();
  const out = [];
  for (let from = fromBlock; from <= head; from += 50_000n) {
    const to = from + 49_999n > head ? head : from + 49_999n;
    out.push(...(await pub.getLogs({ address, event, fromBlock: from, toBlock: to })));
  }
  return out;
}

let mine = cfg.mine;
let token = cfg.hmm;
let from = BigInt(cfg.deployBlock ?? 0);
if (!devnet) {
  const f = await logs(cfg.forwarder, ev.forwarded, BigInt(process.env.FROM_BLOCK ?? 26_170_000));
  if (!f.length) {
    console.log("not launched yet: no Forwarded event from", cfg.forwarder);
    process.exit(0);
  }
  ({ mine, token } = f[0].args);
  from = f[0].blockNumber;
}

const [backed, asked, answered, failed, claimed, proposed] = await Promise.all(
  ["backed", "asked", "answered", "failed", "claimed", "proposed"].map((k) => logs(mine, ev[k], from)),
);
const s = await pub.readContract({ address: mine, abi: mineAbi, functionName: "stats" });
const miners = new Set(backed.map((l) => l.args.backer.toLowerCase()));
const proposers = new Set(proposed.map((l) => l.args.proposer.toLowerCase()));
const paid = asked.length; // each ask paid one question's price to the swarm
const imdToSwarm = answered.concat(failed).length ? asked.length * Number(formatUnits(s.price, 18)) : 0;
const fmt = (x) => Number(formatUnits(x, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });

console.log(`hmm metrics ${devnet ? "(devnet)" : "(mainnet)"} — mine ${mine}`);
console.log(`  unique wallets that backed questions: ${miners.size} (proposers: ${proposers.size})`);
console.log(`  questions: ${s.questions} proposed, ${paid} asked, ${answered.length} answered, ${failed.length} failed`);
console.log(`  IMD paid to the swarm: ~${imdToSwarm.toLocaleString("en-US")} IMD (at the current price)`);
console.log(`  HMM mined into rounds: ${fmt(s.assigned)} (claimed ${fmt(s.claimed)}, dev share paid ${fmt(s.devPaid)}, owed ${fmt(s.devOwed)})`);
console.log(`  era ${s.era}, current pot ${fmt(s.pot)} HMM, reserve ${fmt(s.reserve)}`);
console.log(`  claims: ${claimed.length}`);
if (!devnet && cfg.launcher) {
  const imd = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "owed", args: [cfg.launcher, "0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7"] }).catch(() => 0n);
  const hmm = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "owed", args: [cfg.launcher, token] }).catch(() => 0n);
  console.log(`  LP fees owed to the launcher (before claimFees): ${fmt(imd)} IMD + ${fmt(hmm)} HMM`);
}
