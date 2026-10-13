// Buys an exact amount of IMD with ETH for the hmm-launcher wallet through Uniswap v3 (WETH -> USDC 0.05% -> IMD 0.3%),
// so the wallet can be funded with nothing but ETH (e.g. straight from an exchange withdrawal).
//
// Usage: node launch/buy-imd.mjs 1.5            quote only
//        node launch/buy-imd.mjs 1.5 --buy      quote, then swap (max 3% above the quote, unused ETH refunded)
// Env: MAINNET_RPC_URL (default http://127.0.0.1:8545); key as in pay.mjs (keystore hmm-launcher or HMM_LAUNCHER_KEY).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, http, parseAbi, encodePacked, encodeFunctionData, parseUnits, formatEther, formatUnits, defineChain } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.MAINNET_RPC_URL ?? "http://127.0.0.1:8545";
const IMD = "0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"; // SwapRouter02
const QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e"; // QuoterV2

function loadKey() {
  if (process.env.HMM_LAUNCHER_KEY) return process.env.HMM_LAUNCHER_KEY;
  const name = process.env.HMM_KEYSTORE ?? "hmm-launcher";
  const pw = process.env.HMM_PASSWORD_FILE ?? `${homedir()}/.hmm/${name}.password`;
  const out = execFileSync("cast", ["wallet", "decrypt-keystore", name, "--unsafe-password", readFileSync(pw, "utf8").trim()], {
    env: { ...process.env, PATH: `${homedir()}/.foundry/bin:${process.env.PATH}` },
  }).toString();
  return out.trim().split(/\s+/).pop();
}

const want = parseUnits(process.argv[2] ?? "1", 18);
const buy = process.argv.includes("--buy");
const account = privateKeyToAccount(loadKey());
const pub0 = createPublicClient({ transport: http(RPC) });
const chainId = await pub0.getChainId();
const chain = chainId === 1 ? mainnet : defineChain({ id: chainId, name: "fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ chain, transport: http(RPC), account });

// exact output: the path runs from the token out to the token in
const path = encodePacked(["address", "uint24", "address", "uint24", "address"], [IMD, 3000, USDC, 500, WETH]);
const quoter = parseAbi(["function quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"]);
const { result } = await pub.simulateContract({ address: QUOTER, abi: quoter, functionName: "quoteExactOutput", args: [path, want] });
const quoted = result[0];
const max = (quoted * 103n) / 100n;
const eth = await pub.getBalance({ address: account.address });
console.log(`${account.address}: ${formatEther(eth)} ETH; ${formatUnits(want, 18)} IMD costs ~${formatEther(quoted)} ETH (max ${formatEther(max)})`);
if (!buy) process.exit(0);
if (eth < max) throw new Error("not enough ETH");

const router = parseAbi([
  "function exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)",
  "function refundETH() payable",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
]);
const calls = [
  encodeFunctionData({ abi: router, functionName: "exactOutput", args: [{ path, recipient: account.address, amountOut: want, amountInMaximum: max }] }),
  encodeFunctionData({ abi: router, functionName: "refundETH" }),
];
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
const hash = await wallet.writeContract({ address: ROUTER, abi: router, functionName: "multicall", args: [deadline, calls], value: max });
const receipt = await pub.waitForTransactionReceipt({ hash });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const imd = await pub.readContract({ address: IMD, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`swap ${receipt.status} ${hash}; IMD balance ${formatUnits(imd, 18)}`);
