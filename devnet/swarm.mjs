// A stand-in for the IMD swarm on the devnet. It watches the real Intake (on the fork) for questions the hmm mine
// asked, "deliberates" for a while, then completes them as the Intake's writer: a signed answer most of the time
// (computed from fork state for the composer's templates), sometimes a disagreement, and a refusal for bodies the
// real plane would refuse. The oracle key is a local test key; the adapter on the devnet trusts it.
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseAbiItem,
  encodeAbiParameters,
  keccak256,
  hexToString,
  toHex,
  pad,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const cfg = JSON.parse(readFileSync(new URL("../deployments/devnet.json", import.meta.url)));
const ORACLE_KEY = process.env.DEVNET_ORACLE_KEY ?? keccak256(stringToHex("hmm devnet oracle"));
const oracle = privateKeyToAccount(ORACLE_KEY);
const MIN_DELAY = Number(process.env.SWARM_MIN_DELAY ?? 15);
const MAX_DELAY = Number(process.env.SWARM_MAX_DELAY ?? 60);
const DISAGREE_RATE = Number(process.env.SWARM_DISAGREE_RATE ?? 0.1);

const chain = { id: Number(cfg.chainId), name: "hmm devnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } };
const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
const writer = createWalletClient({ chain, transport: http(cfg.rpcUrl), account: cfg.intakeWriter });

const requested = parseAbiItem(
  "event Requested(bytes32 indexed requestId, address indexed payer, bytes32 indexed action, bytes body, address callbackTarget, bytes4 callbackSelector, address asset, uint256 amount)",
);
const intakeAbi = parseAbi([
  "function complete(bytes32 requestId, uint8 status, bytes32 resultHash, string uri, bytes args)",
  "function requests(bytes32) view returns (address payer, address callbackTarget, bytes4 callbackSelector, bool completed)",
]);
const erc20 = parseAbi(["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);
const stateView = parseAbi(["function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const STATE_VIEW = "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227";
const TRANSFER_TOPIC = keccak256(stringToHex("Transfer(address,address,uint256)"));

const ATTESTATION = [
  { name: "requestId", type: "bytes32" },
  { name: "chainId", type: "uint256" },
  { name: "questionHash", type: "bytes32" },
  { name: "answerType", type: "uint8" },
  { name: "answer", type: "bytes" },
  { name: "figure", type: "uint256" },
  { name: "fromBlock", type: "uint64" },
  { name: "toBlock", type: "uint64" },
  { name: "blockHash", type: "bytes32" },
  { name: "panelJobId", type: "bytes32" },
  { name: "panelSize", type: "uint16" },
  { name: "quorum", type: "uint16" },
  { name: "agreed", type: "uint16" },
  { name: "issuedAt", type: "uint64" },
  { name: "expiresAt", type: "uint64" },
];
const TYPES = ["bool", "address", "bytes32", "uint256", "address[]", "bytes32[]"];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const uuid16 = () => pad(toHex(crypto.getRandomValues(new Uint8Array(16))), { size: 32, dir: "right" });

/** The real answer for the composer's vetted templates, read from fork state; null when the question is free-form. */
async function evaluate(q, toBlock, fromBlock) {
  const addr = (s) => s.toLowerCase();
  let m;
  if ((m = q.match(/was totalSupply\(\) of the ERC-20 contract (0x[0-9a-fA-F]{40}) .* greater than (\d+)/))) {
    const s = await pub.readContract({ address: addr(m[1]), abi: erc20, functionName: "totalSupply", blockNumber: toBlock });
    return { type: 0, value: s > BigInt(m[2]) };
  }
  if ((m = q.match(/was balanceOf\((0x[0-9a-fA-F]{40})\) on the ERC-20 contract (0x[0-9a-fA-F]{40}) .* greater than (\d+)/))) {
    const b = await pub.readContract({ address: addr(m[2]), abi: erc20, functionName: "balanceOf", args: [addr(m[1])], blockNumber: toBlock });
    return { type: 0, value: b > BigInt(m[3]) };
  }
  if ((m = q.match(/native ETH balance of address (0x[0-9a-fA-F]{40}) .* greater than (\d+) wei/))) {
    const b = await pub.getBalance({ address: addr(m[1]), blockNumber: toBlock });
    return { type: 0, value: b > BigInt(m[2]) };
  }
  if ((m = q.match(/sqrtPriceX96 of Uniswap v4 pool (0x[0-9a-fA-F]{64})/))) {
    const [sqrt] = await pub.readContract({ address: STATE_VIEW, abi: stateView, functionName: "getSlot0", args: [m[1]], blockNumber: toBlock });
    return { type: 3, value: sqrt };
  }
  const counts = q.match(/Transfer\(address,address,uint256\) logs did the contract (0x[0-9a-fA-F]{40})/);
  const more = q.match(/did the contract (0x[0-9a-fA-F]{40}) emit more than (\d+) Transfer/);
  if (counts || more) {
    const address = addr((counts ?? more)[1]);
    let n = 0n;
    for (let from = fromBlock; from <= toBlock; from += 2000n) {
      const to = from + 1999n > toBlock ? toBlock : from + 1999n;
      const logs = await pub.getLogs({ address, fromBlock: from, toBlock: to, event: undefined, topics: [TRANSFER_TOPIC] });
      n += BigInt(logs.length);
    }
    return counts ? { type: 3, value: n } : { type: 0, value: n > BigInt(more[2]) };
  }
  return null;
}

function fallbackAnswer(type, rid) {
  const seed = BigInt(rid);
  switch (type) {
    case 0: return seed % 2n === 0n;
    case 1: return "0x" + rid.slice(26);
    case 2: return keccak256(rid);
    case 3: return seed % 1_000_000n;
    case 4: return ["0x" + rid.slice(26), "0x" + keccak256(rid).slice(26)];
    default: return [keccak256(rid), keccak256(keccak256(rid))];
  }
}

async function complete(rid, status, args) {
  const hash = await writer.writeContract({
    address: cfg.intake,
    abi: intakeAbi,
    functionName: "complete",
    args: [rid, status, args ? keccak256(args) : pad("0x0", { size: 32 }), status === 0 ? "/oracle/requests/devnet/attestation" : "/intake/devnet", args ?? "0x"],
    gas: 1_000_000n,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return receipt.status;
}

async function answer(ev) {
  const rid = ev.args.requestId;
  const [, target, , done] = await pub.readContract({ address: cfg.intake, abi: intakeAbi, functionName: "requests", args: [rid] });
  if (done) return;
  if (typeof ev.args.body !== "string") return log("cannot decode the request body of", rid.slice(0, 10), "- skipping (simulator bug, not a refusal)");
  let body;
  try {
    body = JSON.parse(hexToString(ev.args.body));
    if (typeof body.question !== "string" || !TYPES.includes(body.answerType)) throw new Error("incomplete body");
  } catch (e) {
    log("refuse", rid.slice(0, 10), e.message);
    const args = encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint8" }, { type: "bytes32" }, { type: "uint16" }, { type: "uint16" }, { type: "bytes" }],
      [rid, 1, pad(stringToHex("body_invalid"), { size: 32, dir: "right" }), 0, 0, "0x"],
    );
    return log("  refused ->", await complete(rid, 1, args));
  }
  const panelSize = Number(body.panelSize ?? 5);
  const quorum = Number(body.quorum ?? Math.ceil(panelSize * 0.7));
  if (Math.random() < DISAGREE_RATE) {
    const args = encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint8" }, { type: "bytes32" }, { type: "uint16" }, { type: "uint16" }, { type: "bytes" }],
      [rid, 2, pad(stringToHex("disagreed"), { size: 32, dir: "right" }), Math.max(1, quorum - 2), panelSize, "0x"],
    );
    return log("  panel split on", rid.slice(0, 10), "->", await complete(rid, 2, args));
  }
  const head = await pub.getBlock();
  const toBlock = head.number - 5n;
  const fromBlock = toBlock - 7200n;
  const type = TYPES.indexOf(body.answerType);
  let value;
  try {
    const real = await evaluate(body.question, toBlock, fromBlock);
    value = real && real.type === type ? real.value : fallbackAnswer(type, rid);
  } catch (e) {
    log("  evaluate failed:", e.shortMessage ?? e.message);
    value = fallbackAnswer(type, rid);
  }
  const a = {
    requestId: uuid16(),
    chainId: BigInt(body.chainId ?? 1),
    questionHash: keccak256(ev.args.body),
    answerType: type,
    answer: encodeAbiParameters([{ type: TYPES[type] }], [value]),
    figure: 0n,
    fromBlock,
    toBlock,
    blockHash: (await pub.getBlock({ blockNumber: toBlock })).hash,
    panelJobId: uuid16(),
    panelSize,
    quorum,
    agreed: panelSize - (Math.random() < 0.3 ? 1 : 0),
    issuedAt: BigInt(Math.floor(Date.now() / 1000)),
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + Number(body.validForSeconds ?? 86400)),
  };
  if (a.agreed < quorum) a.agreed = quorum;
  const signature = await oracle.signTypedData({
    domain: { name: "IdentityMD Oracle", version: "2", chainId: chain.id, verifyingContract: target },
    types: { OracleAttestation: ATTESTATION },
    primaryType: "OracleAttestation",
    message: a,
  });
  const args = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "tuple", components: ATTESTATION }, { type: "bytes" }],
    [rid, a, signature],
  );
  log("  answered", rid.slice(0, 10), body.answerType, "=", String(value), "agreed", a.agreed, "/", panelSize, "->", await complete(rid, 0, args));
}

async function main() {
  log(`hmm devnet swarm: oracle ${oracle.address}, writer ${cfg.intakeWriter}, mine ${cfg.mine}`);
  if (oracle.address.toLowerCase() !== cfg.oracleSigner.toLowerCase()) throw new Error("oracle key does not match the deployed adapter");
  let next = BigInt(cfg.deployBlock);
  const seen = new Set();
  for (;;) {
    try {
      const head = await pub.getBlockNumber();
      if (head >= next) {
        const logs = await pub.getLogs({ address: cfg.intake, event: requested, args: { payer: cfg.mine }, fromBlock: next, toBlock: head });
        next = head + 1n;
        for (const ev of logs) {
          if (seen.has(ev.args.requestId)) continue;
          seen.add(ev.args.requestId);
          const delay = rand(MIN_DELAY, MAX_DELAY);
          log("question", ev.args.requestId.slice(0, 10), `asked; the panel thinks for ${delay.toFixed(0)}s`);
          setTimeout(() => answer(ev).catch((e) => log("answer failed:", e.shortMessage ?? e.message)), delay * 1000);
        }
      }
    } catch (e) {
      log("poll failed:", e.shortMessage ?? e.message);
    }
    await sleep(3000);
  }
}

main();
