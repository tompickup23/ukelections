import { createHash } from "node:crypto";

function daysBetween(left, right) {
  return Math.max(0, (Date.parse(right) - Date.parse(left)) / 86400000);
}

function normaliseShares(shares) {
  const total = Object.values(shares).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  if (total <= 0) return shares;
  return Object.fromEntries(Object.entries(shares).map(([party, value]) => [party, Math.max(0, Number(value || 0)) / total]));
}

export function pollWeight(poll, generatedAt, halfLifeDays = 21) {
  const ageDays = daysBetween(poll.fieldwork_end, generatedAt);
  const recency = Math.pow(0.5, ageDays / halfLifeDays);
  const sample = Math.sqrt(Math.max(1, poll.sample_size || 1));
  const quality = poll.quality_weight ?? 1;
  return recency * sample * quality;
}

export function aggregatePolls(polls, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const geography = options.geography || "GB";
  const population = options.population || "adults";
  const halfLifeDays = options.halfLifeDays ?? 21;
  const weighted = [];
  const totals = {};
  let totalWeight = 0;

  for (const poll of polls) {
    const weight = pollWeight(poll, generatedAt, halfLifeDays);
    weighted.push({ ...poll, weight });
    totalWeight += weight;
    for (const [party, share] of Object.entries(poll.party_shares || {})) {
      totals[party] = (totals[party] || 0) + share * weight;
    }
  }

  const aggregate = {};
  for (const [party, total] of Object.entries(totals)) {
    aggregate[party] = totalWeight > 0 ? total / totalWeight : 0;
  }

  const aggregate_party_shares = normaliseShares(aggregate);
  const idSeed = JSON.stringify({ generatedAt, geography, population, halfLifeDays, polls: weighted.map((p) => p.poll_id) });

  return {
    poll_aggregate_id: `polls-${createHash("sha1").update(idSeed).digest("hex").slice(0, 12)}`,
    generated_at: generatedAt,
    geography,
    population,
    method: "weighted_poll_average",
    half_life_days: halfLifeDays,
    poll_count: polls.length,
    aggregate_party_shares,
    polls: weighted,
    review_status: options.reviewStatus || "unreviewed"
  };
}
