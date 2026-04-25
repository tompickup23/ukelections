#!/usr/bin/env node
// Nationwide audit of the May 2026 prediction bundle.
// Checks data quality, prediction integrity, and coverage gaps.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
function readJson(p) { return JSON.parse(readFileSync(path.join(ROOT, p), "utf8")); }

function dcPartyToCanonical(dcName) {
  if (!dcName) return "Unknown";
  const p = String(dcName).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Scottish National Party \(SNP\)$/i.test(p)) return "SNP";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/^Scottish Green Party$/i.test(p)) return "Green Party";
  if (/independent/i.test(p)) return "Independent";
  return p;
}

const identity = readJson("data/identity/wards-may-2026.json");
const predictions = readJson("data/predictions/may-2026/local-and-mayor.json").predictions;
const history = readJson("data/history/dc-historic-results.json");

const issues = {
  missing_prediction_with_no_history: [],
  missing_prediction_for_uncancelled: [],
  predicted_party_not_on_ballot: [],
  ballot_party_with_zero_prediction: [],
  prediction_pct_not_summing_to_1: [],
  prediction_with_zero_votes_total: [],
  cancelled_ballots: [],
  no_gss_code: [],
  history_gaps: [],
};
const stats = {
  total_local_and_mayor: 0,
  predicted: 0,
  predicted_with_top_party: {},
  parties_on_ballot_canonical_distinct: new Set(),
  total_candidates: 0,
};

for (const ward of identity.wards) {
  if (ward.tier !== "local" && ward.tier !== "mayor") continue;
  stats.total_local_and_mayor += 1;
  stats.total_candidates += ward.candidate_count;
  for (const p of (ward.parties_standing || [])) {
    stats.parties_on_ballot_canonical_distinct.add(dcPartyToCanonical(p));
  }
  if (!ward.gss_code) issues.no_gss_code.push(ward.ballot_paper_id);
  const pred = predictions[ward.ballot_paper_id];
  if (!pred) {
    issues.missing_prediction_for_uncancelled.push(ward.ballot_paper_id);
    continue;
  }
  if (ward.cancelled) issues.cancelled_ballots.push(ward.ballot_paper_id);
  if (!pred.prediction) {
    if (!ward.cancelled) issues.missing_prediction_with_no_history.push(ward.ballot_paper_id);
    continue;
  }
  stats.predicted += 1;

  // Validate every predicted party is on the ballot — use canonical names on
  // BOTH sides to avoid false positives where DC raw "Workers Party of Britain"
  // matches canonical "Workers Party" via dcPartyToCanonical.
  const partiesOnBallot = new Set((ward.parties_standing || []).map(dcPartyToCanonical));
  const predictedParties = new Set(Object.keys(pred.prediction).map(dcPartyToCanonical));
  for (const pParty of Object.keys(pred.prediction)) {
    if (!partiesOnBallot.has(dcPartyToCanonical(pParty))) {
      issues.predicted_party_not_on_ballot.push({ ballot: ward.ballot_paper_id, party: pParty, share: pred.prediction[pParty].pct });
    }
  }
  for (const onP of partiesOnBallot) {
    if (!predictedParties.has(onP)) {
      issues.ballot_party_with_zero_prediction.push({ ballot: ward.ballot_paper_id, party: onP });
    }
  }
  // Sum check
  const sum = Object.values(pred.prediction).reduce((s, v) => s + (v.pct || 0), 0);
  if (Math.abs(sum - 1.0) > 0.005) {
    issues.prediction_pct_not_summing_to_1.push({ ballot: ward.ballot_paper_id, sum });
  }
  // Vote count check
  const totalVotes = Object.values(pred.prediction).reduce((s, v) => s + (v.votes || 0), 0);
  if (totalVotes === 0) issues.prediction_with_zero_votes_total.push(ward.ballot_paper_id);

  // Top party stats
  const top = Object.entries(pred.prediction).sort((a, b) => b[1].pct - a[1].pct)[0];
  if (top) stats.predicted_with_top_party[top[0]] = (stats.predicted_with_top_party[top[0]] || 0) + 1;

  // History gap audit: is there a 2024 OR 2025 contest in our history for this ward?
  const wardKey = `${ward.tier}::${ward.council_slug}::${ward.ward_slug}`;
  const ballotIds = (history.by_ward_slug || {})[wardKey] || [];
  const dates = ballotIds.map((id) => history.by_ballot[id]?.election_date).filter(Boolean);
  const hasRecent = dates.some((d) => d >= "2022-01-01");
  if (!hasRecent && ballotIds.length > 0) {
    issues.history_gaps.push({ ballot: ward.ballot_paper_id, latest: dates.sort()[dates.length - 1] });
  }
}

const summary = {
  scope: {
    total_local_and_mayor: stats.total_local_and_mayor,
    cancelled: issues.cancelled_ballots.length,
    predicted: stats.predicted,
    candidates_total: stats.total_candidates,
    distinct_parties_on_ballot: stats.parties_on_ballot_canonical_distinct.size,
  },
  data_integrity: {
    no_gss_code: issues.no_gss_code.length,
    missing_prediction_for_uncancelled: issues.missing_prediction_for_uncancelled.length,
    missing_prediction_with_no_history: issues.missing_prediction_with_no_history.length,
    predicted_party_not_on_ballot: issues.predicted_party_not_on_ballot.length,
    ballot_party_with_zero_prediction: issues.ballot_party_with_zero_prediction.length,
    prediction_pct_not_summing_to_1: issues.prediction_pct_not_summing_to_1.length,
    prediction_with_zero_votes_total: issues.prediction_with_zero_votes_total.length,
    history_gaps_no_recent_contest: issues.history_gaps.length,
  },
  top_party_distribution: stats.predicted_with_top_party,
};

writeFileSync(path.join(ROOT, "data/audit/nationwide-audit.json"), JSON.stringify({ summary, issues }, null, 2));

// Pretty print
console.log("=" .repeat(80));
console.log("NATIONWIDE AUDIT — May 7 2026 forecast bundle");
console.log("=".repeat(80));
console.log("\n--- SCOPE ---");
for (const [k, v] of Object.entries(summary.scope)) console.log(`  ${k}: ${v}`);
console.log("\n--- DATA INTEGRITY (zero is good) ---");
for (const [k, v] of Object.entries(summary.data_integrity)) {
  const flag = v === 0 ? "✓" : v < 10 ? "⚠" : "✗";
  console.log(`  ${flag} ${k}: ${v}`);
}
console.log("\n--- TOP PARTY DISTRIBUTION (across predicted wards) ---");
for (const [p, n] of Object.entries(stats.predicted_with_top_party).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${p.padEnd(25)} ${n.toString().padStart(4)} wards (${(100 * n / stats.predicted).toFixed(1)}%)`);
}
console.log("\n--- ISSUE SAMPLES (first 5 each) ---");
for (const [k, list] of Object.entries(issues)) {
  if (list.length === 0) continue;
  console.log(`\n  ${k} (${list.length} total):`);
  for (const item of list.slice(0, 5)) {
    console.log(`    ${typeof item === "string" ? item : JSON.stringify(item)}`);
  }
}
console.log("\nFull audit written to data/audit/nationwide-audit.json");
