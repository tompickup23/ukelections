/**
 * localPartyStrength.js — multi-cycle local-party-strength + candidate-continuity
 * + time-decay baseline blending.
 *
 * Why: model currently uses ONLY the most-recent borough contest as baseline.
 * Coalclough LD won 8 consecutive contests at 36-65% (Birtwistle, Lishman) but
 * the model predicts LD only 19%. Same for Briercliffe.
 *
 * This module computes per-party local strength scores from multi-cycle history
 * and applies a "stronghold survival" anchor: if a party is a multi-cycle
 * stronghold AND is standing again in 2026, anchor predicted share to a blend
 * of historical mean and model output. Same idea for candidate continuity:
 * named-individual continuity adds personal-vote weight.
 *
 * Pure functions.
 */

const STRONGHOLD_THRESHOLD = 0.30; // mean share ≥ 30% across last 3+ contests
const STRONGHOLD_MIN_CONTESTS = 3;
const STRONGHOLD_STD_MAX = 0.15;   // std ≤ 15pp = stable
const ANCHOR_WEIGHT = 0.65;         // 65% historical mean + 35% model
const CONTINUITY_BONUS = 0.05;      // same-name candidate same-party = +5pp
const INCUMBENT_BONUS = 0.05;       // same-name AND was elected in last contest = +5pp (additive to continuity)

function dcPartyToCanonical(name) {
  if (!name) return "Unknown";
  const p = String(name).trim();
  if (/^Labour Party$/i.test(p)) return "Labour";
  if (/^Labour and Co-operative Party$/i.test(p)) return "Labour";
  if (/^Conservative and Unionist Party$/i.test(p)) return "Conservative";
  if (/^Liberal Democrats?$/i.test(p)) return "Liberal Democrats";
  if (/^Reform UK$/i.test(p)) return "Reform UK";
  if (/^Green Party$/i.test(p)) return "Green Party";
  if (/^Scottish Green Party$/i.test(p)) return "Green Party";
  if (/^Plaid Cymru/i.test(p)) return "Plaid Cymru";
  if (/^Scottish National Party \(SNP\)$/i.test(p)) return "SNP";
  if (/independent/i.test(p)) return "Independent";
  if (/^UK Independence Party/i.test(p) || /^UKIP$/i.test(p)) return "Reform UK"; // UKIP→Reform continuity
  return p;
}

function normaliseName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastNames(name) {
  // Capture surname token(s) for matching across DC and AI DOGE name conventions.
  const norm = normaliseName(name);
  const tokens = norm.split(" ").filter((t) => t.length > 2);
  if (tokens.length === 0) return [];
  // Last token is the surname; also include second-to-last in case of compound
  return tokens.slice(-2);
}

function nameMatch(a, b) {
  const la = lastNames(a);
  const lb = lastNames(b);
  if (la.length === 0 || lb.length === 0) return false;
  // Surname (last token) must match
  return la[la.length - 1] === lb[lb.length - 1];
}

/**
 * Compute per-party local strength for one ward.
 * historyRows: array of contests (most recent first or unsorted)
 * Each row: { date, year, type, candidates: [{ name, party, votes, pct, elected }] }
 */
export function computeLocalStrength(historyRows) {
  const cycle = (historyRows || [])
    .filter((r) => r.type !== "by-election")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (cycle.length === 0) return { byParty: {} };

  const recent = cycle.slice(0, 5); // last up-to-5 cycle contests
  const byParty = {};
  for (const row of recent) {
    const total = row.candidates.reduce((s, c) => s + (c.votes || 0), 0);
    if (total <= 0) continue;
    // Per-party best vote in this contest
    const partyShares = {};
    for (const c of row.candidates) {
      const canon = dcPartyToCanonical(c.party);
      const share = (c.votes || 0) / total;
      partyShares[canon] = Math.max(partyShares[canon] || 0, share);
    }
    for (const [party, share] of Object.entries(partyShares)) {
      if (!byParty[party]) byParty[party] = { shares: [], elected_count: 0, last_share: null, last_contest_year: null };
      byParty[party].shares.push(share);
      // Last share (most recent contest)
      if (byParty[party].last_share == null) {
        byParty[party].last_share = share;
        byParty[party].last_contest_year = row.year || (row.date || "").slice(0, 4);
      }
    }
    for (const c of row.candidates) {
      if (c.elected) {
        const canon = dcPartyToCanonical(c.party);
        if (byParty[canon]) byParty[canon].elected_count += 1;
      }
    }
  }

  // Compute summary stats
  const out = {};
  for (const [party, data] of Object.entries(byParty)) {
    const shares = data.shares;
    const mean = shares.reduce((s, v) => s + v, 0) / shares.length;
    const variance = shares.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, shares.length - 1);
    const std = Math.sqrt(variance);
    out[party] = {
      mean,
      std,
      contest_count: shares.length,
      contests_present: shares.length,
      elected_count: data.elected_count,
      last_share: data.last_share,
      last_contest_year: data.last_contest_year,
      is_stronghold: shares.length >= STRONGHOLD_MIN_CONTESTS && mean >= STRONGHOLD_THRESHOLD && std <= STRONGHOLD_STD_MAX,
      has_won_recently: data.elected_count > 0,
    };
  }
  return { byParty: out, contest_count: recent.length };
}

/**
 * Detect candidate continuity: for each 2026 candidate, has the same named
 * individual stood for the same party in the last 3 cycle contests?
 *
 * Returns: { byParty: { [canonicalParty]: { isIncumbent, isContinuous, name } } }
 */
export function detectCandidateContinuity(historyRows, candidates2026) {
  const cycle = (historyRows || [])
    .filter((r) => r.type !== "by-election")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const recent = cycle.slice(0, 3);

  const byParty = {};
  for (const c2026 of candidates2026 || []) {
    const canon = dcPartyToCanonical(c2026.party_name || c2026.party);
    const name = c2026.name;
    if (!name || !canon) continue;
    let isContinuous = false;
    let isIncumbent = false;
    let lastSharePersonal = null;
    for (const row of recent) {
      for (const c of row.candidates || []) {
        if (dcPartyToCanonical(c.party) !== canon) continue;
        if (nameMatch(c.name, name)) {
          isContinuous = true;
          // Was this person elected in their last appearance?
          if (c.elected) isIncumbent = true;
          if (lastSharePersonal == null) {
            const total = row.candidates.reduce((s, x) => s + (x.votes || 0), 0);
            if (total > 0) lastSharePersonal = (c.votes || 0) / total;
          }
        }
      }
      if (isContinuous) break; // first match counts
    }
    byParty[canon] = { name, isContinuous, isIncumbent, lastSharePersonal };
  }
  return { byParty };
}

/**
 * Apply stronghold anchor + candidate continuity bonuses to a prediction.
 *
 * Returns { prediction, applied: [factors...] }.
 */
export function applyLocalStrength({ prediction, historyRows, candidates2026 }) {
  if (!prediction) return { prediction: null, applied: [] };
  const strength = computeLocalStrength(historyRows);
  const continuity = detectCandidateContinuity(historyRows, candidates2026);

  const out = { ...prediction };
  const applied = [];

  // Step 1: stronghold survival anchor
  for (const [party, payload] of Object.entries(out)) {
    const s = strength.byParty[party];
    if (!s?.is_stronghold) continue;
    const original = payload.pct || 0;
    const anchored = ANCHOR_WEIGHT * s.mean + (1 - ANCHOR_WEIGHT) * original;
    out[party] = { ...payload, pct: anchored };
    applied.push(`${party} stronghold (mean ${(s.mean * 100).toFixed(1)}%, ${s.contest_count} contests, std ${(s.std * 100).toFixed(1)}pp): anchored ${(original * 100).toFixed(1)}% → ${(anchored * 100).toFixed(1)}%`);
  }

  // Step 2: candidate continuity bonuses
  for (const [party, info] of Object.entries(continuity.byParty)) {
    if (!info.isContinuous) continue;
    if (!out[party]) continue;
    const bonus = info.isIncumbent ? CONTINUITY_BONUS + INCUMBENT_BONUS : CONTINUITY_BONUS;
    const original = out[party].pct || 0;
    out[party] = { ...out[party], pct: original + bonus };
    applied.push(`${party} candidate ${info.name}: ${info.isIncumbent ? "incumbent + continuity" : "continuity"} +${(bonus * 100).toFixed(1)}pp`);
  }

  // Re-normalise
  const sum = Object.values(out).reduce((s, v) => s + (v.pct || 0), 0);
  if (sum > 0) for (const p of Object.keys(out)) out[p].pct = out[p].pct / sum;

  return { prediction: out, applied, strength: strength.byParty, continuity: continuity.byParty };
}

/**
 * Time-decay baseline blend: weight last 3 cycle contests by recency
 * (0.55 / 0.30 / 0.15). Returns a synthetic baseline-share dict that
 * downstream callers can use as an alternative to "most recent only".
 */
export function timeDecayBaseline(historyRows) {
  const cycle = (historyRows || [])
    .filter((r) => r.type !== "by-election")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const recent = cycle.slice(0, 3);
  if (recent.length === 0) return null;
  const weights = [0.55, 0.30, 0.15].slice(0, recent.length);
  const sumW = weights.reduce((s, v) => s + v, 0);
  const normW = weights.map((w) => w / sumW);
  const acc = {};
  recent.forEach((row, idx) => {
    const total = row.candidates.reduce((s, c) => s + (c.votes || 0), 0);
    if (total <= 0) return;
    for (const c of row.candidates) {
      const p = dcPartyToCanonical(c.party);
      const share = (c.votes || 0) / total;
      acc[p] = (acc[p] || 0) + share * normW[idx];
    }
  });
  return acc;
}
