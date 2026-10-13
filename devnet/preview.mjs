// Serves the built site (web/dist) for previews, with two same-origin helpers the static build needs on a devnet:
//   POST /rpc        -> the devnet's anvil, read methods and signed transactions only (no impersonation, no admin)
//   POST /imd-check  -> https://api.imd.fun/requests/check, which refuses browser origins (the free question validator)
//   POST /faucet     -> {address}: 5 devnet IMD (from an impersonated holder) and 0.2 devnet ETH, once per address
// Binds to 127.0.0.1 only; expose it with a tunnel (devnet/preview-tunnel.sh) rather than an open port.
// Usage: node devnet/preview.mjs   (PREVIEW_PORT default 5180, DEVNET_RPC default from deployments/devnet.json)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = new URL("../web/dist/", import.meta.url).pathname;
const cfg = existsSync(new URL("../deployments/devnet.json", import.meta.url))
  ? JSON.parse(readFileSync(new URL("../deployments/devnet.json", import.meta.url)))
  : {};
const RPC = process.env.DEVNET_RPC ?? cfg.rpcUrl ?? "http://127.0.0.1:9645";
const PORT = Number(process.env.PREVIEW_PORT ?? 5180);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".txt": "text/plain", ".wasm": "application/wasm",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".glsl": "text/plain",
};
const ALLOWED = /^(eth_(?!sendTransaction$|sign$|signTransaction$|signTypedData|accounts$|coinbase$)[A-Za-z]+|net_[A-Za-z]+|web3_[A-Za-z]+)$/;

const body = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) reject(new Error("too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const IMD = cfg.imd ?? "0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7";
const IMD_HOLDER = "0xE54d6571aCa515614927F3A70B8957c2B511603C"; // impersonated on the fork only
const dripped = new Set();
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
async function faucet(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("bad address");
  const key = address.toLowerCase();
  if (dripped.has(key)) throw new Error("already sent to this address");
  if (Number(await rpc("eth_chainId", [])) !== 31337) throw new Error("faucet is devnet only");
  dripped.add(key);
  const imd = 5n * 10n ** 18n;
  const data = "0xa9059cbb" + key.slice(2).padStart(64, "0") + imd.toString(16).padStart(64, "0");
  const tx = await rpc("eth_sendTransaction", [{ from: IMD_HOLDER, to: IMD, data }]);
  const bal = BigInt(await rpc("eth_getBalance", [key, "latest"]));
  await rpc("anvil_setBalance", [key, "0x" + (bal + 2n * 10n ** 17n).toString(16)]);
  return { ok: true, imd: "5", eth: "0.2", tx };
}

const hits = new Map(); // crude per-IP rate limit for /imd-check and /faucet
function limited(ip) {
  const now = Date.now();
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  h.push(now);
  hits.set(ip, h);
  return h.length > 20;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/rpc") {
      const raw = await body(req);
      const msg = JSON.parse(raw);
      const calls = Array.isArray(msg) ? msg : [msg];
      if (!calls.every((c) => typeof c.method === "string" && ALLOWED.test(c.method))) {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: calls[0]?.id ?? null, error: { code: -32601, message: "method not allowed on the preview" } }));
      }
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
      res.writeHead(r.status, { "content-type": "application/json" });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (req.method === "POST" && url.pathname === "/imd-check") {
      if (limited(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress)) {
        res.writeHead(429);
        return res.end();
      }
      const r = await fetch("https://api.imd.fun/requests/check", { method: "POST", headers: { "content-type": "application/json" }, body: await body(req) });
      res.writeHead(r.status, { "content-type": "application/json" });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (req.method === "POST" && url.pathname === "/faucet") {
      if (limited(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress)) {
        res.writeHead(429);
        return res.end();
      }
      let out;
      try {
        out = await faucet(JSON.parse(await body(req)).address);
      } catch (e) {
        out = { error: e.message };
      }
      res.writeHead(out.error ? 400 : 200, { "content-type": "application/json" });
      return res.end(JSON.stringify(out));
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end();
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, path);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const cache = file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("error");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`preview on http://127.0.0.1:${PORT} (rpc -> ${RPC})`));
