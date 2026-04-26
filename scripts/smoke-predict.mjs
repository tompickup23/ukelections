import { readFileSync } from "node:fs";
import { buildWardData } from "../src/lib/adaptDcToWardData.js";
import { predictWard, DEFAULT_ASSUMPTIONS } from "../src/lib/electionModel.js";
import { pollingPair } from "../src/lib/nationalPolling.js";

const identity = JSON.parse(readFileSync("data/identity/wards-may-2026.json", "utf8"));
const history = JSON.parse(readFileSync("data/history/dc-historic-results.json", "utf8"));
let leapHistory = null;
try { leapHistory = JSON.parse(readFileSync("data/history/leap-history.json", "utf8")); } catch {}
const { nationalPolling, ge2024Result } = pollingPair();

const sample = identity.wards.find((w) => w.ward_slug === "buckingham" && w.council_slug === "adur");
const wd = buildWardData(sample, history, leapHistory);
console.log(`Ward: ${wd.council_name} / ${wd.ward_name} (${wd.gss_code})`);
console.log(`  History: ${wd.history.length} contests, latest ${wd.history[wd.history.length - 1]?.date}`);
console.log(`  2026 candidates standing for parties:`, wd.candidates_2026.map((c) => c.party).join(", "));

const result = predictWard(wd, DEFAULT_ASSUMPTIONS, nationalPolling, ge2024Result, null, null, null);
if (!result.prediction) {
  console.log("\nPrediction: NONE —", result.methodology[0]?.description);
} else {
  console.log(`\nPrediction (model_version: ${result.modelVersion || "0.1.0"}):`);
  const rows = Object.entries(result.prediction).sort((a, b) => b[1].pct - a[1].pct);
  for (const [party, p] of rows) {
    console.log(`  ${party.padEnd(35)} ${(p.pct * 100).toFixed(1).padStart(5)}%  votes≈${p.votes}`);
  }
  console.log(`\nMethodology steps: ${result.methodology.length}`);
  for (const step of result.methodology) {
    console.log(`  ${step.step}. ${step.name}: ${step.description?.slice(0, 100) || ""}`);
  }
}
