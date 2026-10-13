// Pays for the hmm launch (`launch.open`) from the hmm-launcher wallet, exactly as https://imd.fun/docs/#paid describes:
// quote -> 402 challenge -> Permit2 payment + EIP-712 quote approval -> submit -> poll until admitted.
//
// The wallet that pays becomes the launch's requester: it receives 1% of every trade in the HMM pool.
//
// Usage:
//   node launch/pay.mjs              quote only: prints the price and terms, pays nothing
//   node launch/pay.mjs --approve    also sends the one-time IMD approval to Permit2 if it is missing (needs ETH)
//   node launch/pay.mjs --pay        quote and pay (asks you to type "launch hmm" first)
//   --body <file> --action <action>  pay for another request, e.g. --body launch/site-body.json --action job.open
//
// The key never leaves this process: it is decrypted from ~/.foundry/keystores/hmm-launcher with
// ~/.hmm/hmm-launcher.password (override with HMM_KEYSTORE / HMM_PASSWORD_FILE), or taken from HMM_LAUNCHER_KEY.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, http, parseAbi, sha256, stringToBytes, formatUnits, maxUint256 } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const API = process.env.IMD_API ?? "https://api.imd.fun";
const RPC = process.env.MAINNET_RPC_URL ?? "http://127.0.0.1:8545";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const args = new Set(process.argv.slice(2));
const opt = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ACTION = opt("--action", "launch.open");
const here = new URL(".", import.meta.url);

function loadKey() {
  if (process.env.HMM_LAUNCHER_KEY) return process.env.HMM_LAUNCHER_KEY;
  const name = process.env.HMM_KEYSTORE ?? "hmm-launcher";
  const pw = process.env.HMM_PASSWORD_FILE ?? `${homedir()}/.hmm/${name}.password`;
  const out = execFileSync("cast", ["wallet", "decrypt-keystore", name, "--unsafe-password", readFileSync(pw, "utf8").trim()], {
    env: { ...process.env, PATH: `${homedir()}/.foundry/bin:${process.env.PATH}` },
  }).toString();
  const key = out.trim().split(/\s+/).pop();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("could not decrypt the launcher keystore");
  return key;
}

// canonical JSON: sorted keys, no whitespace (https://imd.fun/docs/#quote-approval)
const canon = (v) =>
  v === null
    ? "null"
    : Array.isArray(v)
      ? `[${v.map(canon).join(",")}]`
      : typeof v === "object"
        ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
        : JSON.stringify(v);

async function api(path, { token, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

const input = JSON.parse(readFileSync(opt("--body", new URL("body.json", here))));
if (!/^[0-9a-f]{40}$/.test(input.baseCommit ?? "") || input.repoUrl.includes("REPLACE")) {
  throw new Error("launch/body.json still has placeholder repoUrl/baseCommit: set them in launch/config.json and run launch/build.mjs");
}

const account = privateKeyToAccount(loadKey());
const pub = createPublicClient({ chain: mainnet, transport: http(RPC) });

// preflight for the launch: the remainder goes to the forwarder, which must already be deployed and wired right
if (ACTION === "launch.open") {
  const fwd = input.economics?.remainderTo;
  const fwdAbi = parseAbi(["function registry() view returns (address)", "function mineName() view returns (bytes32)"]);
  const code = fwd ? await pub.getCode({ address: fwd }) : undefined;
  if (!code || code === "0x") throw new Error(`no contract at remainderTo ${fwd}: deploy the GenesisForwarder first (docs/LAUNCH.md step 3)`);
  const reg = await pub.readContract({ address: fwd, abi: fwdAbi, functionName: "registry" });
  const name = await pub.readContract({ address: fwd, abi: fwdAbi, functionName: "mineName" });
  if (reg.toLowerCase() !== "0x7c9d5ee697bff5ac4f10e2e54d3f40c44e48fe23" || name !== "0x486d6d4d696e6500000000000000000000000000000000000000000000000000") {
    throw new Error(`the contract at ${fwd} is not hmm's GenesisForwarder`);
  }
  console.log(`preflight ok: GenesisForwarder at ${fwd}`);
}
const wallet = createWalletClient({ chain: mainnet, transport: http(RPC), account });
console.log(`launcher ${account.address}`);

// 1. quote
const token = randomBytes(32).toString("hex");
const requestKey = randomUUID();
const q = await api("/requests/quote", { token, method: "POST", body: { requestKey, action: ACTION, input } });
if (q.status >= 300) {
  console.error(JSON.stringify(q.json, null, 2));
  throw new Error(`quote refused (${q.status})`);
}
const order = q.json.order;
const quote = order.quote;
const asset = quote.payment.asset;
const amount = BigInt(quote.payment.amount);
mkdirSync(new URL("orders/", here), { recursive: true });
writeFileSync(new URL(`orders/${order.id}.json`, here), JSON.stringify({ id: order.id, token, requestKey, quote }, null, 2));
console.log(`order ${order.id}: ${formatUnits(amount, quote.payment.decimals)} of ${asset} to ${quote.payment.payTo}, expires ${new Date(quote.expiresAt * 1000).toISOString()}`);

// funds and the Permit2 allowance
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const balance = await pub.readContract({ address: asset, abi: erc20, functionName: "balanceOf", args: [account.address] });
const allowance = await pub.readContract({ address: asset, abi: erc20, functionName: "allowance", args: [account.address, PERMIT2] });
console.log(`balance ${formatUnits(balance, 18)} IMD, Permit2 allowance ${allowance >= amount ? "ok" : "missing"}`);
if (balance < amount) throw new Error("not enough IMD in the launcher wallet");
if (allowance < amount) {
  if (!args.has("--approve")) throw new Error("approve IMD to Permit2 first: node launch/pay.mjs --approve");
  const hash = await wallet.writeContract({ address: asset, abi: erc20, functionName: "approve", args: [PERMIT2, maxUint256] });
  console.log(`approve tx ${hash}`);
  await pub.waitForTransactionReceipt({ hash });
}
if (!args.has("--pay")) {
  console.log("quote only. Re-run with --pay to pay for the launch.");
  process.exit(0);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = await rl.question(`Pay ${formatUnits(amount, 18)} IMD for ${ACTION}? Type "launch hmm": `);
rl.close();
if (typed.trim() !== "launch hmm") throw new Error("not confirmed; nothing paid");

// 2. the challenge
const url = `/requests/${order.id}/submit`;
const ch = await api(url, { token, method: "POST" });
if (ch.status !== 402) {
  console.error(JSON.stringify(ch.json, null, 2));
  throw new Error(`expected a 402 challenge, got ${ch.status}`);
}
const challenge = ch.json;
const req = challenge.accepts[0];

// 3. the Permit2 payment, without extensions (the plane parses the payload strictly)
// IMD is not one of x402's default assets: allow it, capped at exactly the quoted amount.
const client = x402Client.fromConfig({
  schemes: [{ network: req.network, client: new ExactEvmScheme(account) }],
  spendControls: { allowedAssets: [{ network: req.network, asset: req.asset, maxAmountPerPayment: String(amount) }] },
});
const { extensions, ...generated } = await client.createPaymentPayload({ x402Version: 2, resource: challenge.resource, accepts: [req] });
const payment = JSON.parse(JSON.stringify({ ...generated, accepted: req }));

// 4. the quote approval of that exact payment
const cq = challenge.quote;
const quoteSignature = await account.signTypedData({
  domain: { name: "IdentityMD Paid Action", version: "1", chainId: Number(cq.payment.network.slice(7)) },
  primaryType: "QuoteApproval",
  types: {
    QuoteApproval: [
      { name: "resource", type: "string" },
      { name: "requesterScopeHash", type: "bytes32" },
      { name: "quoteId", type: "string" },
      { name: "quoteHash", type: "bytes32" },
      { name: "paymentHash", type: "bytes32" },
      { name: "action", type: "string" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "payTo", type: "address" },
      { name: "expiresAt", type: "uint256" },
    ],
  },
  message: {
    resource: challenge.resourceUrl,
    requesterScopeHash: `0x${challenge.requesterScopeHash}`,
    quoteId: cq.id,
    quoteHash: `0x${cq.quoteHash}`,
    paymentHash: sha256(stringToBytes(canon(payment))),
    action: cq.action,
    asset: cq.payment.asset,
    amount: BigInt(cq.payment.amount),
    payTo: cq.payment.payTo,
    expiresAt: BigInt(cq.expiresAt),
  },
});

// 5. submit; a lost response is retried with the same bytes
let sub;
for (let attempt = 0; attempt < 3; attempt++) {
  sub = await api(url, { token, method: "POST", body: { quoteSignature }, headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) } });
  if (sub.status !== 503) break;
}
console.log(`submit -> ${sub.status}`, JSON.stringify(sub.json).slice(0, 400));
if (sub.status >= 300) throw new Error("submit failed");

// 6. follow it
for (;;) {
  const st = await api(`/requests/${order.id}`, { token });
  console.log(new Date().toISOString().slice(11, 19), st.json.status, st.json.payment?.status ?? "");
  if (["admitted", "payment_failed", "expired"].includes(st.json.status)) {
    console.log(JSON.stringify(st.json.admission ?? st.json, null, 2));
    break;
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
