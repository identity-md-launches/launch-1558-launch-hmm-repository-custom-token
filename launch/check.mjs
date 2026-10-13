// Free dry run: asks the IMD planner what it would do with the launch request, without paying or holding anything.
// Usage: node launch/check.mjs [launch/body.json] [action=launch.open]
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? new URL("body.json", import.meta.url);
const input = JSON.parse(readFileSync(file));
const action = process.argv[3] ?? "launch.open";
const res = await fetch("https://api.imd.fun/requests/check", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action, input }),
});
const out = await res.json();
console.log(JSON.stringify(out, null, 2));
if (out.error) {
  console.error(`\nrefused: ${out.error} ${out.detail ?? ""}`);
  process.exit(1);
}
const blockers = out.blockers ?? [];
console.error(blockers.length ? `\n${blockers.length} blocker(s): ${blockers.map((b) => b.code).join(", ")}` : "\nno blockers");
process.exit(blockers.length ? 1 : 0);
