// Keeps the devnet lively for demos: a handful of simulated miners (anvil accounts 5-9) ask template questions,
// pool IMD into each other's questions, and claim what they mined. Answers come from devnet/swarm.mjs.
// Usage: node devnet/activity.mjs     (ACTIVITY_MIN / ACTIVITY_MAX seconds between actions; default 40-120)
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, maxUint256, parseEther, formatEther } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const cfg = JSON.parse(readFileSync(new URL("../deployments/devnet.json", import.meta.url)));
const chain = { id: Number(cfg.chainId), name: "hmm devnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } };
const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
const MNEMONIC = "test test test test test test test test test test test junk";
const miners = [5, 6, 7, 8, 9].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
const wallets = miners.map((account) => createWalletClient({ chain, transport: http(cfg.rpcUrl), account }));
const HOLDER = "0xE54d6571aCa515614927F3A70B8957c2B511603C"; // an IMD holder, impersonated on the fork
const MIN = Number(process.env.ACTIVITY_MIN ?? 40);
const MAX = Number(process.env.ACTIVITY_MAX ?? 120);

const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const mineAbi = parseAbi([
  "function propose((string question, uint8 answerType, uint8 evidence, uint32 chainId, uint16 windowHours, uint16 panelSize, uint16 quorum, uint16 toleranceBps) spec, uint256 amount) returns (uint256)",
  "function back(uint256 id, uint256 amount, bytes body)",
  "function claim(uint256[] ids) returns (uint256)",
  "function payDev() returns (uint256)",
  "function claimable(uint256 id, address backer) view returns (uint256)",
  "function backing(uint256 id, address backer) view returns (uint256)",
  "function questionCount() view returns (uint256)",
  "function question(uint256 id) view returns ((bytes32 bodyHash, address proposer, uint64 deadline, uint32 version, uint128 target, uint128 raised, bytes32 requestId, address adapter, uint32 round, uint8 status))",
]);
const proposed = parseAbiItem("event Proposed(uint256 indexed id, address indexed proposer, uint256 target, uint256 deadline, bytes body)");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const TOKENS = [
  ["0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", "IMD"],
  ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "USDC"],
  ["0xdac17f958d2ee523a2206206994597c13d831ec7", "USDT"],
];
const HOLDERS = ["0x9efa934d9fad4ae28c998a40195646b965a97247", "0x000000000004444c5dc75cb358380d2e3de08a90", "0x894d4e6d3d2abc64fc0de0e4e2ea63a93bc9c520"];
function question() {
  const [token] = pick(TOKENS);
  const kinds = [
    () => [`How many Transfer(address,address,uint256) logs did the contract ${token} emit on Ethereum mainnet from the window's first block through its last block, inclusive?`, "uint256"],
    () => [`From the window's first block through its last block on Ethereum mainnet, did the contract ${token} emit more than ${pick([50, 500, 5000])} Transfer(address,address,uint256) logs?`, "bool"],
    () => [`At the window's closing block, was balanceOf(${pick(HOLDERS)}) on the ERC-20 contract ${token} on Ethereum mainnet greater than ${pick(["1000000000000000000000", "1000000000000000000000000", "1000000000"])} (raw units)?`, "bool"],
    () => [`At the window's closing block, was totalSupply() of the ERC-20 contract ${token} on Ethereum mainnet greater than ${pick(["4000000000000000000000000", "1000000000000000"])} (raw units, 18 decimals)?`, "bool"],
    () => [`At the window's closing block, was the native ETH balance of address ${pick(HOLDERS)} on Ethereum mainnet greater than ${pick(["1000000000000000000", "1000000000000000000000"])} wei?`, "bool"],
    () => [`What was sqrtPriceX96 of Uniswap v4 pool 0x415829f72e9f54531c26eae76f107618540e898a45d6ae35959e143f5faca704 in the Ethereum mainnet PoolManager 0x000000000004444c5dc75cb358380d2e3de08a90 at the window's closing block?`, "uint256"],
  ];
  const [q, answerType] = pick(kinds)();
  return { question: q, answerType: answerType === "uint256" ? 3 : 0, evidence: 0, chainId: 1, windowHours: 24, panelSize: 5, quorum: 4, toleranceBps: 0 };
}

async function send(w, args) {
  const hash = await w.writeContract(args);
  return pub.waitForTransactionReceipt({ hash });
}

async function setup() {
  const holder = createWalletClient({ chain, transport: http(cfg.rpcUrl), account: HOLDER });
  for (let i = 0; i < miners.length; i++) {
    const a = miners[i].address;
    if ((await pub.readContract({ address: cfg.imd, abi: erc20, functionName: "balanceOf", args: [a] })) < parseEther("5")) {
      await send(holder, { address: cfg.imd, abi: erc20, functionName: "transfer", args: [a, parseEther("200")] });
    }
    if ((await pub.readContract({ address: cfg.imd, abi: erc20, functionName: "allowance", args: [a, cfg.mine] })) < parseEther("100")) {
      await send(wallets[i], { address: cfg.imd, abi: erc20, functionName: "approve", args: [cfg.mine, maxUint256] });
    }
  }
  log("miners funded:", miners.map((m) => m.address.slice(0, 8)).join(" "));
}

async function openQuestions() {
  const n = Number(await pub.readContract({ address: cfg.mine, abi: mineAbi, functionName: "questionCount" }));
  const open = [];
  for (let id = Math.max(1, n - 30); id <= n; id++) {
    const q = await pub.readContract({ address: cfg.mine, abi: mineAbi, functionName: "question", args: [BigInt(id)] });
    if (q.status === 1 && Number(q.deadline) * 1000 > Date.now()) open.push({ id: BigInt(id), q });
  }
  return open;
}

async function bodyOf(id) {
  const logs = await pub.getLogs({ address: cfg.mine, event: proposed, args: { id }, fromBlock: BigInt(cfg.deployBlock) });
  return logs[0]?.args.body;
}

async function act() {
  const i = Math.floor(Math.random() * miners.length);
  const w = wallets[i];
  const me = miners[i].address;
  const roll = Math.random();
  const open = await openQuestions();
  if (open.length && roll < 0.35) {
    const { id, q } = pick(open);
    const left = q.target - q.raised;
    const amount = Math.random() < 0.5 ? left : left / 2n > parseEther("0.01") ? left / 2n : left;
    await send(w, { address: cfg.mine, abi: mineAbi, functionName: "back", args: [id, amount, amount === left ? await bodyOf(id) : "0x"] });
    return log(`${me.slice(0, 8)} backed #${id} with ${formatEther(amount)} IMD${amount === left ? " and asked it" : ""}`);
  }
  if (roll < 0.8) {
    const solo = Math.random() < 0.55;
    const amount = solo ? parseEther("0.5") : pick([parseEther("0.05"), parseEther("0.1"), parseEther("0.2"), parseEther("0.25")]);
    await send(w, { address: cfg.mine, abi: mineAbi, functionName: "propose", args: [question(), amount] });
    return log(`${me.slice(0, 8)} ${solo ? "asked" : "proposed"} a question with ${formatEther(amount)} IMD`);
  }
  // claim everything claimable
  const n = Number(await pub.readContract({ address: cfg.mine, abi: mineAbi, functionName: "questionCount" }));
  const ids = [];
  for (let id = 1; id <= n; id++) {
    if ((await pub.readContract({ address: cfg.mine, abi: mineAbi, functionName: "claimable", args: [BigInt(id), me] })) > 0n) ids.push(BigInt(id));
  }
  if (ids.length) {
    await send(w, { address: cfg.mine, abi: mineAbi, functionName: "claim", args: [ids] });
    log(`${me.slice(0, 8)} claimed from ${ids.length} question(s)`);
  }
  if (Math.random() < 0.2) await send(w, { address: cfg.mine, abi: mineAbi, functionName: "payDev" });
}

await setup();
for (;;) {
  try {
    await act();
  } catch (e) {
    log("action failed:", e.shortMessage ?? e.message);
  }
  await sleep(MIN + Math.random() * (MAX - MIN));
}
