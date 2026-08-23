// local-byelection-model.mjs
//
// The projection method for LOCAL COUNCIL by-elections, kept pure so it can be
// tested and back-tested without touching the network or the filesystem.
//
// Method: ward_prior_plus_byelection_swing
// -----------------------------------------------------------------------------
// One method, never blended. The Makerfield post-mortem (June 2026) is the
// reason: averaging two coherent stories produced a central call that neither
// story supported and the winner was wrong. If the inputs disagree here, the
// contest gets no forecast at all.
//
//   base    The ward's own most recent ORDINARY result, as party shares.
//   swing   Measured from UK Elections' own by-election corpus, not from
//           national voting intention. For every recent council by-election we
//           also hold that ward's prior ordinary result, so the share change is
//           observed rather than modelled. Per party we take the MEDIAN shift
//           in LOG-ODDS between the two, which is robust to the handful of
//           contests where a local factor swamps everything, and which cannot
//           push a party past the ends of the scale the way a share ratio can.
//   field   Who is actually standing, from the nomination papers. This is the
//           part a national model cannot see and the single biggest driver of a
//           local by-election: a party that does not stand scores nothing, and
//           a party standing in a ward it has never fought before starts from
//           an entry share, not from zero and not from its national number.
//
// Entry shares are also measured, not assumed. The mayoral engine uses 60% of
// national polling as an entry lane because it has nothing better; here the
// corpus tells us directly what a party actually scores the first time it
// contests a ward.
//
// Stratification, on two axes, because pooling across either one produces
// visibly wrong answers:
//
//   Baseline era. A ward whose last ordinary contest was in 2022 is being
//   swung across the entire Reform realignment; one last fought in May 2025 is
//   not. Pooling the two gave St Helens Haydock a projected Green lead of 45%
//   off a 2022 all-out sweep, in a ward that then voted Reform 33 and Green 7.
//   Shifts are therefore measured within the era the baseline belongs to.
//
//   Reform entry. A party entering a ward for the first time mechanically
//   depresses every other party's share, so the shift for Labour where Reform
//   newly entered is not comparable to one where Reform already stood.
//
// The estimator tries era plus entry, falls back to era alone, then to the
// pooled sample, and records which one it used so the page can say so.
//
// Everything the method cannot see is stated on the page rather than modelled:
// candidate quality, local incumbency, a ward-level campaign, and the turnout
// collapse that makes local by-elections noisy in the first place.

// -----------------------------------------------------------------------------
// Party canonicalisation
// -----------------------------------------------------------------------------
// Unlike the mayoral engine (England only) this keeps SNP and Plaid Cymru as
// real lanes: Scottish and Welsh council by-elections are in scope.

export const PARTIES = [
  "Reform UK",
  "Labour",
  "Conservative",
  "Liberal Democrats",
  "Green Party",
  "SNP",
  "Plaid Cymru",
  "Restore Britain",
  "Independent",
  "Other",
];

export function canonParty(name) {
  if (!name) return "Other";
  const s = String(name).trim();
  if (/labour and co-?operative/i.test(s)) return "Labour";
  if (/^labour( party)?$/i.test(s)) return "Labour";
  if (/^conservative( and unionist( party)?)?$/i.test(s)) return "Conservative";
  if (/^(scottish )?liberal democrats?$/i.test(s)) return "Liberal Democrats";
  if (/^reform uk/i.test(s)) return "Reform UK";
  if (/^restore britain/i.test(s)) return "Restore Britain";
  if (/^(scottish )?green party/i.test(s)) return "Green Party";
  if (/^green party/i.test(s)) return "Green Party";
  if (/scottish national party|^snp$/i.test(s)) return "SNP";
  if (/plaid cymru/i.test(s)) return "Plaid Cymru";
  if (/independent/i.test(s)) return "Independent";
  return "Other";
}

// -----------------------------------------------------------------------------
// Share arithmetic
// -----------------------------------------------------------------------------

export function normalise(shares) {
  const sum = PARTIES.reduce((a, k) => a + Math.max(0, shares[k] || 0), 0);
  const out = {};
  for (const k of PARTIES) out[k] = sum > 0 ? Math.max(0, shares[k] || 0) / sum : 0;
  return out;
}

/**
 * Party shares from a candidate list.
 *
 * Multi-member wards elect two or three councillors on one ballot and a party
 * often runs a full slate, so summing a party's candidates would count the same
 * voter several times. Taking each party's BEST candidate and normalising over
 * those maxima gives the notional single-seat contest, which is what a
 * by-election for one vacancy actually is. Labelled as notional wherever it is
 * used on a multi-member prior.
 */
export function sharesFromCandidates(candidates) {
  const best = {};
  for (const c of candidates || []) {
    const votes = Number(c.votes);
    if (!Number.isFinite(votes) || votes < 0) continue;
    const p = canonParty(c.party_name ?? c.party);
    // Independents are separate people, not one party: sum them, because two
    // independents splitting a ward is a real division of the same lane and
    // taking the best one would understate how much of the ward is non-party.
    if (p === "Independent" || p === "Other") best[p] = (best[p] || 0) + votes;
    else best[p] = Math.max(best[p] || 0, votes);
  }
  return normalise(best);
}

/** The set of canonical parties on a ballot, whether or not votes are known. */
export function fieldFromCandidates(candidates) {
  const out = new Set();
  for (const c of candidates || []) out.add(canonParty(c.party_name ?? c.party));
  return out;
}

// -----------------------------------------------------------------------------
// Swing corpus
// -----------------------------------------------------------------------------

const PRESENT = 0.02; // below this a party is treated as not having contested

/**
 * Which party system the baseline belongs to.
 *
 * The boundaries are the two moments that reordered local voting: the July
 * 2024 general election, and the May 2025 locals at which Reform first won
 * councils outright. A baseline either predates the realignment, sits inside
 * it, or already reflects it, and those three need different swings.
 */
export function baselineEra(priorDate) {
  if (!priorDate) return null;
  if (priorDate < "2024-05-01") return "pre_realignment";
  if (priorDate < "2025-04-01") return "ge2024_era";
  return "post_may_2025";
}

/**
 * Build the observation set: one row per by-election for which we also hold the
 * same ward's prior ordinary result.
 *
 * @param {Array} byelections rows in dc-historic-results shape, is_by_election
 * @param {(row) => object|null} findPrior returns the prior ordinary contest
 */
export function buildSwingCorpus(byelections, findPrior) {
  const corpus = [];
  for (const row of byelections) {
    if (!row?.candidates?.length) continue;
    // Scottish STV by-elections are excluded throughout. Democracy Club does
    // not publish a full per-candidate result for them, so what reaches us is
    // a partial first-preference picture that would bias every ratio.
    if (row.voting_system === "STV") continue;
    const prior = findPrior(row);
    if (!prior?.candidates?.length) continue;
    const from = sharesFromCandidates(prior.candidates);
    const to = sharesFromCandidates(row.candidates);
    if (!PARTIES.some((p) => to[p] > 0)) continue;
    corpus.push({
      ballot_paper_id: row.ballot_paper_id,
      date: row.election_date,
      council_slug: row.council_slug,
      ward_slug: row.ward_slug,
      prior_date: prior.election_date,
      prior_seats: prior.seats_contested ?? null,
      era: baselineEra(prior.election_date),
      from,
      to,
      reform_entered: (from["Reform UK"] || 0) < PRESENT && (to["Reform UK"] || 0) >= PRESENT,
    });
  }
  return corpus.sort((a, b) => a.date.localeCompare(b.date));
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation, rescaled to a normal-equivalent sigma. */
function madSigma(xs) {
  const m = median(xs);
  if (m === null) return null;
  const mad = median(xs.map((x) => Math.abs(x - m)));
  return mad === null ? null : mad * 1.4826;
}

// Swing is measured on the LOG-ODDS scale, not as a share ratio.
//
// A ratio is unbounded above, so a party that already holds a large share of
// the ward gets pushed somewhere impossible: the Greens won Manchester Burnage
// on 45.8% in May 2026, and the median Green ratio of 1.76 projected them to
// 65.6%, which is not a swing, it is arithmetic running off the end of the
// scale. Log-odds compresses at both ends by construction, so the same
// underlying movement triples a party on 5% and barely moves one on 46%.
export function logit(p) {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(q / (1 - q));
}
export function invLogit(x) {
  return 1 / (1 + Math.exp(-x));
}

export const DEFAULT_WINDOW_DAYS = 365;
export const MIN_STRATUM_N = 8; // below this, fall back to the pooled estimate
export const MIN_PARTY_N = 5; // below this, a party gets no ratio of its own

function daysBetween(a, b) {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
}

/**
 * Estimate the swing to apply to a contest polling on `asOf`.
 *
 * Only contests STRICTLY BEFORE asOf are used, so a back-test never sees its
 * own answer or anything that happened after it.
 */
export function estimateSwing(
  corpus,
  { asOf, windowDays = DEFAULT_WINDOW_DAYS, era = null, reformEntering = null, excludeId = null } = {},
) {
  const inWindow = corpus.filter(
    (c) =>
      c.date < asOf &&
      daysBetween(c.date, asOf) <= windowDays &&
      c.ballot_paper_id !== excludeId,
  );

  // Try the most specific stratum first and widen only when it is too thin.
  const byEra = era ? inWindow.filter((c) => c.era === era) : null;
  const byBoth =
    byEra && reformEntering !== null ? byEra.filter((c) => c.reform_entered === reformEntering) : null;

  let sample = inWindow;
  let stratum = "pooled";
  if (byBoth && byBoth.length >= MIN_STRATUM_N) {
    sample = byBoth;
    stratum = `${era}|${reformEntering ? "reform_entering" : "reform_already_stood"}`;
  } else if (byEra && byEra.length >= MIN_STRATUM_N) {
    sample = byEra;
    stratum = era;
  }
  const usedStratum = stratum !== "pooled";

  const shifts = {};
  const ratios = {};
  const sigmas = {};
  const counts = {};
  const entry = {};
  const entryCounts = {};

  for (const p of PARTIES) {
    const deltas = [];
    const entries = [];
    for (const c of sample) {
      const f = c.from[p] || 0;
      const t = c.to[p] || 0;
      if (f >= PRESENT && t >= PRESENT) deltas.push(logit(t) - logit(f));
      else if (f < PRESENT && t >= PRESENT) entries.push(t);
    }
    counts[p] = deltas.length;
    entryCounts[p] = entries.length;
    if (deltas.length >= MIN_PARTY_N) {
      const shift = median(deltas);
      shifts[p] = shift;
      // A readable equivalent for anyone reading the JSON or the page: what the
      // same shift does to a party sitting on 25%, expressed as a share ratio.
      ratios[p] = invLogit(logit(0.25) + shift) / 0.25;
      sigmas[p] = madSigma(deltas) ?? 0.5;
    }
    if (entries.length >= MIN_PARTY_N) entry[p] = median(entries);
  }

  return {
    as_of: asOf,
    window_days: windowDays,
    contests_in_window: inWindow.length,
    stratum,
    stratum_used: usedStratum,
    n: sample.length,
    shifts,
    ratios,
    sigmas,
    counts,
    entry,
    entry_counts: entryCounts,
  };
}

// -----------------------------------------------------------------------------
// Projection
// -----------------------------------------------------------------------------

// Bounds on the log-odds shift. Roughly a factor of three either way at a 25%
// base share, tightening automatically as the base share approaches 0 or 1,
// which is the whole reason for working on this scale.
const SHIFT_CLAMP = [-1.4, 1.4];
const DEFAULT_SIGMA = 0.7; // log-odds scale, used only where the corpus is too thin

/**
 * Project a contest.
 *
 * @param {object} base    prior ordinary shares for the ward
 * @param {Set}    field   canonical parties on the by-election ballot
 * @param {object} swing   from estimateSwing
 */
export function projectContest(base, field, swing) {
  const central = {};
  const notes = [];
  for (const p of PARTIES) {
    if (!field.has(p)) continue; // not standing scores nothing, full stop
    const b = base[p] || 0;
    if (b >= PRESENT) {
      const shift = swing.shifts[p];
      if (shift === undefined) {
        central[p] = b;
        notes.push(`${p} carried unswung: fewer than ${MIN_PARTY_N} comparable contests in the window.`);
      } else {
        central[p] = invLogit(logit(b) + Math.min(SHIFT_CLAMP[1], Math.max(SHIFT_CLAMP[0], shift)));
      }
    } else {
      const e = swing.entry[p];
      if (e === undefined) {
        // Standing somewhere it has no record and the corpus cannot price the
        // entry. Better to say so than to invent a number.
        central[p] = null;
        notes.push(`${p} is standing where it has no prior ward result and the corpus holds too few comparable entries to price one.`);
      } else {
        central[p] = e;
      }
    }
  }
  const unpriced = Object.entries(central).filter(([, v]) => v === null).map(([k]) => k);
  for (const k of unpriced) delete central[k];
  return { central: normalise(central), notes, unpriced };
}

// -----------------------------------------------------------------------------
// Uncertainty
// -----------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gaussFactory(rand) {
  return function () {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export const DRAWS = 4000;

// Calibration factor on the modelled spread.
//
// The raw corpus dispersion is the spread of the SWING, and it silently assumes
// the ward's own baseline and the field are the whole story. They are not: a
// candidate, a local campaign and a 20% turnout move a council by-election in
// ways nothing in this model can see. Uncalibrated, the projections were badly
// overconfident: contests it put above 90% were won 73% of the time.
//
// Fitted on the 223 by-elections since 1 May 2025 by widening the spread until
// stated probabilities matched observed frequencies. On the log-odds scale 1.75
// minimises BOTH the Brier score (0.564) and reliability error (0.072); 1.0
// leaves the model overconfident and 2.5 throws away contests it could call.
// Re-fit this when the corpus has meaningfully grown, and publish the table.
export const SIGMA_INFLATION = 1.75;

// Below this the page says the contest is too close to call rather than naming
// a leader. Under calibration the sub-55% band is barely better than a coin.
export const TOO_CLOSE_TO_CALL = 0.55;

/**
 * Monte Carlo around the central projection. Each party's share is multiplied
 * by a lognormal shock whose width is the observed dispersion of that party's
 * ratio in the corpus, widened by SIGMA_INFLATION so that the stated
 * probability means what it says.
 */
export function runDraws(central, swing, seedKey, draws = DRAWS, inflation = SIGMA_INFLATION) {
  const rand = mulberry32(hashSeed(seedKey));
  const gauss = gaussFactory(rand);
  const live = PARTIES.filter((p) => (central[p] || 0) > 0);
  const samples = Object.fromEntries(live.map((p) => [p, []]));
  const wins = Object.fromEntries(live.map((p) => [p, 0]));

  for (let d = 0; d < draws; d++) {
    const draw = {};
    for (const p of live) {
      const sigma = (swing.sigmas[p] ?? DEFAULT_SIGMA) * inflation;
      draw[p] = invLogit(logit(central[p]) + gauss() * sigma);
    }
    const n = normalise(draw);
    let top = live[0];
    for (const p of live) if (n[p] > n[top]) top = p;
    wins[top] += 1;
    for (const p of live) samples[p].push(n[p]);
  }

  const bands = {};
  for (const p of live) {
    const s = samples[p].sort((a, b) => a - b);
    bands[p] = { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
  }
  const winProb = Object.fromEntries(live.map((p) => [p, wins[p] / draws]));
  // The strongest lane is the party that wins the most simulations, not the
  // one with the highest central share. The two usually coincide, but in
  // tight races a fatter-variance lane can win more draws on a lower central
  // (Dover and Llantwit Fardre, 23 Aug 2026), and ordering by central share
  // made the page headline name one party while its own probability table led
  // with another. Ties break on central share.
  const ordered = live
    .slice()
    .sort((a, b) => winProb[b] - winProb[a] || (central[b] || 0) - (central[a] || 0));
  const leader = ordered[0] ?? null;
  // margin_pp stays the gap between the top two CENTRAL shares: it describes
  // the projection, not the simulation, and can differ in sign from the
  // probability ordering.
  const byCentral = live.slice().sort((a, b) => (central[b] || 0) - (central[a] || 0));
  return {
    draws,
    sigma_inflation: inflation,
    win_probability: winProb,
    bands,
    winner: leader,
    runner_up: ordered[1] ?? null,
    margin_pp: byCentral.length > 1 ? (central[byCentral[0]] - central[byCentral[1]]) * 100 : null,
    leader_probability: leader ? winProb[leader] : null,
    too_close_to_call: leader ? winProb[leader] < TOO_CLOSE_TO_CALL : true,
  };
}

/**
 * Reliability table: what the model said, against what actually happened.
 * This is the number that belongs on the page. A projection whose stated
 * confidence is not measured against outcomes is decoration.
 */
// Three wide bands, not six narrow ones.
//
// Ten-point bands leave 9 to 23 contests each, where one result moves the
// figure by 5pp: the published table read "said 70-80%, right 90%" next to
// "said 80-90%, right 61%", an inversion that is pure sampling noise and looks
// like the model contradicting itself. Pooled, every band lands within one
// standard error of what we claimed. Narrow the bands again when the corpus can
// carry them.
export const PUBLISHED_BANDS = [[0.3, 0.55], [0.55, 0.7], [0.7, 1.01]];

export function calibration(rows, buckets = PUBLISHED_BANDS) {
  const out = [];
  for (const [lo, hi] of buckets) {
    const b = rows.filter((r) => r.leader_probability >= lo && r.leader_probability < hi);
    if (!b.length) continue;
    out.push({
      from: lo,
      to: Math.min(hi, 1),
      n: b.length,
      mean_stated: b.reduce((a, r) => a + r.leader_probability, 0) / b.length,
      observed: b.filter((r) => r.projected_winner === r.actual_winner).length / b.length,
      standard_error: Math.sqrt(
        (b.filter((r) => r.projected_winner === r.actual_winner).length / b.length) *
          (1 - b.filter((r) => r.projected_winner === r.actual_winner).length / b.length) /
          b.length,
      ),
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Back-test
// -----------------------------------------------------------------------------

/**
 * Leave-one-out over the corpus. Each contest is projected from the swing
 * measured on the OTHER contests that had already polled by then, using the
 * field that actually stood. That is the same information the live method has
 * on the eve of a poll, so the error it reports is the error to publish.
 */
export function backtest(corpus, { windowDays = DEFAULT_WINDOW_DAYS, minWindow = MIN_STRATUM_N, stratify = true } = {}) {
  const rows = [];
  for (const c of corpus) {
    const field = new Set(PARTIES.filter((p) => (c.to[p] || 0) > 0));
    if (field.size < 2) continue;
    const swing = estimateSwing(corpus, {
      asOf: c.date,
      windowDays,
      era: stratify ? c.era : null,
      reformEntering: stratify ? c.reform_entered : null,
      excludeId: c.ballot_paper_id,
    });
    if (swing.n < minWindow) continue;
    const { central } = projectContest(c.from, field, swing);
    if (!PARTIES.some((p) => central[p] > 0)) continue;
    const draws = runDraws(central, swing, c.ballot_paper_id);

    const errs = [];
    const partyErrors = {};
    for (const p of PARTIES) {
      if (!field.has(p)) continue;
      const signed = ((central[p] || 0) - (c.to[p] || 0)) * 100;
      partyErrors[p] = signed;
      errs.push(Math.abs(signed));
    }
    const pick = (o) => PARTIES.filter((p) => (o[p] || 0) > 0).sort((a, b) => o[b] - o[a])[0] ?? null;
    rows.push({
      ballot_paper_id: c.ballot_paper_id,
      date: c.date,
      era: c.era,
      mae_pp: errs.reduce((a, b) => a + b, 0) / errs.length,
      party_errors: partyErrors,
      projected_winner: pick(central),
      actual_winner: pick(c.to),
      leader_probability: draws.leader_probability,
      too_close_to_call: draws.too_close_to_call,
      reform_projected_pp: (central["Reform UK"] || 0) * 100,
      reform_actual_pp: (c.to["Reform UK"] || 0) * 100,
    });
  }

  const n = rows.length;
  const mae = n ? rows.reduce((a, r) => a + r.mae_pp, 0) / n : null;
  const called = rows.filter((r) => r.projected_winner === r.actual_winner).length;
  const refRows = rows.filter((r) => r.reform_actual_pp > 0);
  const refBias = refRows.length
    ? refRows.reduce((a, r) => a + (r.reform_projected_pp - r.reform_actual_pp), 0) / refRows.length
    : null;
  // The headline the pages quote is measured on the CURRENT regime. Averaging
  // in 2019-2023 contests flatters the method: it called 70% of winners across
  // the whole archive and 59% since the realignment, and the second number is
  // the one that describes what it will do this Thursday.
  const recent = rows.filter((r) => r.date >= RECENT_SINCE);
  const recentCalled = recent.filter((r) => r.projected_winner === r.actual_winner).length;
  const confident = recent.filter((r) => !r.too_close_to_call);
  const confidentCalled = confident.filter((r) => r.projected_winner === r.actual_winner).length;

  return {
    n,
    mae_pp: mae,
    winner_called: called,
    winner_called_pct: n ? called / n : null,
    reform_bias_pp: refBias,
    reform_n: refRows.length,
    recent_since: RECENT_SINCE,
    recent: {
      n: recent.length,
      mae_pp: recent.length ? recent.reduce((a, r) => a + r.mae_pp, 0) / recent.length : null,
      winner_called: recentCalled,
      winner_called_pct: recent.length ? recentCalled / recent.length : null,
      confident_n: confident.length,
      confident_called: confidentCalled,
      confident_called_pct: confident.length ? confidentCalled / confident.length : null,
    },
    calibration: calibration(recent),
    party_accuracy: partyAccuracy(recent),
    rows,
  };
}

// The realignment cut. May 2025 is the first set of locals at which Reform won
// councils outright, and performance either side of it is not comparable.
export const RECENT_SINCE = "2025-05-01";

/**
 * How the method does PER PARTY, which is not the same question as how it does
 * overall and is the one that matters if a reader only cares about one of them.
 *
 * Measured, not corrected. The mean errors are real (Conservative runs about
 * 2.5pp hot, Green about 3pp cold) but a walk-forward correction subtracting
 * them was tested and moved the recent sample by 0.1pp of error and one contest
 * in 223, which is inside the noise. It is not worth the extra moving part, and
 * publishing the bias is more useful to a reader than quietly absorbing it.
 * Revisit if the corpus grows enough for the effect to separate from noise.
 */
export function partyAccuracy(rows, minN = 10) {
  const acc = {};
  for (const r of rows) {
    for (const [party, e] of Object.entries(r.party_errors || {})) (acc[party] ||= []).push(e);
  }
  return PARTIES.filter((p) => (acc[p] || []).length >= minN).map((p) => {
    const xs = acc[p];
    return {
      party: p,
      n: xs.length,
      bias_pp: xs.reduce((a, b) => a + b, 0) / xs.length,
      mae_pp: xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length,
    };
  });
}

// -----------------------------------------------------------------------------
// Baseline solidity
// -----------------------------------------------------------------------------

export const OLDEST_USABLE_PRIOR = "2018-01-01";

/**
 * Decide whether a contest gets a projection at all. The answer is no more
 * often than yes, and each no carries the reason that goes on the page.
 */
export function assessBaseline({ prior, field, swing, votingSystem, boundaryChanged, fieldLocked = true }) {
  const blockers = [];
  if (votingSystem === "STV") {
    blockers.push("Scottish STV. Democracy Club does not publish a full per-candidate result for these, so neither the baseline nor the corpus can be built honestly.");
  }
  if (boundaryChanged) {
    blockers.push("The ward boundary changed since its last ordinary election, so there is no like-for-like baseline to swing from.");
  }
  if (!prior) {
    blockers.push("No prior ordinary result for this ward in either archive.");
  } else {
    if (prior.election_date < OLDEST_USABLE_PRIOR) {
      blockers.push(`The last ordinary contest here was ${prior.election_date}, too far back to swing from.`);
    }
    const withVotes = (prior.candidates || []).filter((c) => Number.isFinite(Number(c.votes)));
    if (withVotes.length < 2) {
      blockers.push("The prior result has no usable per-candidate vote counts.");
    }
  }
  // No projection until the ballot paper is final.
  //
  // Before nominations close, a party missing from Democracy Club's list has
  // not filed YET, which is not the same as not standing, and the projection
  // gives anything outside the field exactly zero. Brighton Queen's Park and
  // Milton Keynes New Bradwell were both being projected in September off
  // four- and three-candidate lists that were still open, so a single late
  // Reform nomination would have made the published number wrong structurally
  // rather than noisily. This is the gate that stops an automated post going
  // out on a ballot that does not exist yet.
  if (!fieldLocked) {
    blockers.push(
      "Nominations have not closed, so the ballot paper is not final. A projection would have to assume nobody else stands, and we publish one once the statement of persons nominated is out.",
    );
  }
  if (field && field.size < 2 && fieldLocked) {
    // Most contests reach this state simply because nominations have not opened
    // yet, three or four weeks out. Saying "fewer than two parties on the
    // ballot" there reads as though the seat were uncontested.
    blockers.push("Fewer than two parties on the ballot.");
  }
  if (swing && swing.n < MIN_STRATUM_N) {
    blockers.push(`Only ${swing.n} comparable by-elections in the window, below the minimum of ${MIN_STRATUM_N}.`);
  }
  return { forecastable: blockers.length === 0, blockers };
}
