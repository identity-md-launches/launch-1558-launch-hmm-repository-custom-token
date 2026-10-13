// Follows the swarm's launch job after pay.mjs: prints each step as it moves, then the launch number, the token, the
// adapter and the mine, and checks them on chain (the mine names our forwarder and is not started yet).
// Usage: node launch/watch.mjs <jobId>
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";

const API = process.env.IMD_API ?? "https://api.imd.fun";
const RPC = process.env.MAINNET_RPC_URL ?? "http://127.0.0.1:8545";
const jobId = process.argv[2];
if (!jobId) throw new Error("usage: node launch/watch.mjs <jobId>");
const cfg = JSON.parse(readFileSync(new URL("config.json", import.meta.url)));
const pub = createPublicClient({ transport: http(RPC) });
const get = async (p) => (await fetch(`${API}${p}`)).json();
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

let last = "";
for (;;) {
  const job = await get(`/jobs/${jobId}`);
  const nodes = (job.nodes ?? []).map((n) => `${n.key ?? n.skill}:${n.state ?? n.verdict ?? "?"}`).join(" ");
  const line = `${job.state} | ${nodes}${job.blockedReason ? ` | blocked: ${job.blockedReason}` : ""}`;
  if (line !== last) console.log(new Date().toISOString().slice(11, 19), line);
  last = line;
  if (job.launch?.id || job.launch?.launchNumber || ["completed", "blocked", "cancelled", "failed"].includes(job.state)) {
    if (job.state === "blocked" || job.state === "cancelled" || job.state === "failed") {
      console.log(JSON.stringify(job.blockedReason ?? job, null, 2).slice(0, 4000));
      process.exit(1);
    }
    if (job.launch) {
      const launchId = job.launch.id ?? job.launch.launchId;
      const l = launchId ? await get(`/launches/${launchId}`) : job.launch;
      if (l.status === "live" || l.artifacts?.length) {
        console.log(`launch #${l.launchNumber} ${l.status}`);
        const art = Object.fromEntries((l.artifacts ?? []).map((a) => [a.name, a.address]));
        console.log(JSON.stringify(art, null, 2));
        const mine = art.HmmMine;
        if (mine) {
          const abi = parseAbi([
            "function forwarder() view returns (address)",
            "function started() view returns (bool)",
            "function token() view returns (address)",
            "function steward() view returns (address)",
            "function dev() view returns (address)",
            "function devBps() view returns (uint256)",
          ]);
          const read = (f) => pub.readContract({ address: mine, abi, functionName: f });
          const [fwd, started, token, steward, dev, devBps] = await Promise.all(
            ["forwarder", "started", "token", "steward", "dev", "devBps"].map(read),
          );
          // The launch's LP fee stream (1% of pool volume) goes to the factory's recorded requester for this launch.
          const factoryAbi = parseAbi([
            "function positionOf(uint64) view returns ((address,address,uint24,int24,address),int24,int24,address)",
          ]);
          const FACTORY = "0xfF03410d0Fe5fa8f7F59F743de35E333D9857120";
          const [, , , requester] = await pub.readContract({
            address: FACTORY, abi: factoryAbi, functionName: "positionOf", args: [BigInt(l.launchNumber)],
          });
          const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
          const hmm = art.HmmToken;
          const [supply, fwdBal] = hmm
            ? await Promise.all([
                pub.readContract({ address: hmm, abi: erc20, functionName: "totalSupply" }),
                pub.readContract({ address: hmm, abi: erc20, functionName: "balanceOf", args: [cfg.forwarder] }),
              ])
            : [0n, 0n];
          const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
          const checks = {
            "mine names our forwarder": eq(fwd, cfg.forwarder),
            "mine mines the launch token": eq(token, hmm),
            "mine not started yet": started === false,
            "no steward": eq(steward, cfg.steward),
            "dev share goes to our dev wallet": eq(dev, cfg.dev),
            "dev share is 5% (500 bps)": devBps === 500n,
            "LP fee stream goes to our launcher": eq(requester, cfg.launcher),
            "supply is 1B HMM": supply === 10n ** 27n,
            "forwarder holds the ~65% reserve": fwdBal >= (10n ** 27n * 6500n) / 10000n && fwdBal < (10n ** 27n * 6510n) / 10000n,
          };
          for (const [k, v] of Object.entries(checks)) console.log(`${v ? "ok  " : "FAIL"} ${k}`);
          console.log({ forwarder: fwd, token, steward, dev, devBps: devBps.toString(), requester, forwarderHmm: fwdBal.toString() });
          const ok = Object.values(checks).every(Boolean);
          console.log(ok ? "\nall checks passed" : "\nSOME CHECKS FAILED: do not forward until this is understood");
          console.log(`\nnext: cast send ${cfg.forwarder} "forward(uint64)" ${l.launchNumber} --account hmm-launcher --password-file ~/.hmm/hmm-launcher.password --rpc-url $MAINNET_RPC_URL`);
        }
        process.exit(0);
      }
    }
  }
  await sleep(20);
}
