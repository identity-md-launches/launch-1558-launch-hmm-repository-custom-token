// Builds the request that asks the IMD swarm to host hmm's site on IPFS under <label>.sites.imd.fun (job.open).
// The site repo holds a prebuilt dist/, so the only step is the swarm's own site-content-check; ipfs names it.
// Usage: node launch/build-site-body.mjs <repoUrl> <commit> [label=hmm]   -> launch/site-body.json
// Then:  node launch/check.mjs launch/site-body.json job.open ; pay it like the launch (see docs/LAUNCH.md)
import { writeFileSync } from "node:fs";

const [repoUrl, baseCommit, label = "hmm"] = process.argv.slice(2);
if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repoUrl ?? "") || !/^[0-9a-f]{40}$/.test(baseCommit ?? "")) {
  throw new Error("usage: node launch/build-site-body.mjs https://github.com/<account>/hmm-site <40-hex commit> [label]");
}
const body = {
  objective:
    "Host the static site in this repository's dist/ directory (already built; no build step) on IPFS. It is the site of hmm, a token mined by asking the IMD swarm questions: it reads public chain data and the public IMD API, and connects a browser wallet for user-initiated transactions only. Do not change its contents.",
  repoUrl,
  baseCommit,
  steps: [{ skill: "site-content-check" }],
  shape: "chain",
  ipfs: label,
  github: false,
};
writeFileSync(new URL("site-body.json", import.meta.url), JSON.stringify(body, null, 2) + "\n");
console.log(JSON.stringify(body, null, 2));
