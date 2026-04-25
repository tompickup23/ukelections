import { readFileSync } from "node:fs";
import { buildWardData } from "../src/lib/adaptDcToWardData.js";
import { predictWard, DEFAULT_ASSUMPTIONS } from "../src/lib/electionModel.js";
import { pollingPair } from "../src/lib/nationalPolling.js";

const identity = JSON.parse(readFileSync("data/identity/wards-may-2026.json", "utf8"));
const history = JSON.parse(readFileSync("data/history/dc-historic-results.json", "utf8"));
const sample = identity.wards.find((w) => w.ward_slug === "buckingham" && w.council_slug === "adur");
const wd = buildWardData(sample, history);

console.log("Latest history (most recent borough):");
const latest = wd.history[wd.history.length - 1];
console.log("  date:", latest.date, "type:", latest.type);
console.log("  turnout_votes:", latest.turnout_votes);
console.log("  candidates:");
for (const c of latest.candidates) console.log(`    ${c.party.padEnd(20)} votes=${c.votes} pct=${c.pct}`);

const { nationalPolling, ge2024Result } = pollingPair();
console.log("\nNational polling keys:", Object.keys(nationalPolling));
console.log("GE2024 keys:", Object.keys(ge2024Result));

const result = predictWard(wd, DEFAULT_ASSUMPTIONS, nationalPolling, ge2024Result, null, null, null);
console.log("\nPrediction raw:", JSON.stringify(result.prediction, null, 2));
