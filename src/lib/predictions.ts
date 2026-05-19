// Build-time loader for the 2026 prediction bundle.
// Pure functions — usable from getStaticPaths and from page components.

import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

export interface WardPrediction {
  prediction: Record<string, { pct: number; votes: number }> | null;
  confidence: "high" | "medium" | "low" | "none";
  cancelled?: boolean;
  baseline_date?: string | null;
  lad24cd?: string | null;
  lad_name?: string | null;
  la_features_used?: { demographics: boolean; deprivation: boolean; ethnicProjections: boolean };
  model_version: string;
  methodology: Array<{ step: number | string; name: string; description?: string; data?: unknown }>;
}

export interface IdentityWard {
  ballot_paper_id: string;
  gss_code: string | null;
  ward_name: string | null;
  ward_slug: string | null;
  council_slug: string;
  council_name: string;
  election_group_id: string;
  tier: string;
  model_family_hint: string;
  winner_count: number;
  cancelled: boolean;
  candidates_locked: boolean;
  sopn_url: string | null;
  sopn_source_url: string | null;
  candidate_count: number;
  parties_standing: string[];
}

let _cached: {
  identity: { wards: IdentityWard[]; election_date: string };
  predictions: { snapshot: Record<string, unknown>; tally: Record<string, unknown>; predictions: Record<string, WardPrediction> };
  summary: { snapshot: Record<string, unknown>; council_count: number; councils: Array<{ council_slug: string; council_name: string; tier: string; ward_count: number; seats_up: number; predicted_seat_winners: Record<string, number> }> };
  backtest: any;
  senedd: any;
  holyrood: any;
  history: { results: Array<any>; by_ballot: Record<string, any>; by_ward_slug: Record<string, string[]> };
  laProj: any;
  laImd: any;
} | null = null;

function load() {
  if (_cached) return _cached;
  const identity = JSON.parse(readFileSync(path.join(ROOT, "data/identity/wards-may-2026.json"), "utf8"));
  const predictions = JSON.parse(readFileSync(path.join(ROOT, "data/predictions/may-2026/local-and-mayor.json"), "utf8"));
  const summary = JSON.parse(readFileSync(path.join(ROOT, "data/predictions/may-2026/summary.json"), "utf8"));
  const backtest = JSON.parse(readFileSync(path.join(ROOT, "data/backtests/may-2024-summary.json"), "utf8"));
  const senedd = JSON.parse(readFileSync(path.join(ROOT, "data/predictions/may-2026/senedd.json"), "utf8"));
  const holyrood = JSON.parse(readFileSync(path.join(ROOT, "data/predictions/may-2026/holyrood.json"), "utf8"));
  const history = JSON.parse(readFileSync(path.join(ROOT, "data/history/dc-historic-results.json"), "utf8"));
  const laProj = JSON.parse(readFileSync(path.join(ROOT, "data/features/la-ethnic-projections.json"), "utf8"));
  const laImd = JSON.parse(readFileSync(path.join(ROOT, "data/features/la-imd.json"), "utf8"));
  _cached = { identity, predictions, summary, backtest, senedd, holyrood, history, laProj, laImd };
  return _cached;
}

export function loadIdentity() { return load().identity; }
export function loadPredictions() { return load().predictions; }
export function loadSummary() { return load().summary; }
export function loadBacktest() { return load().backtest; }
export function loadSenedd() { return load().senedd; }
export function loadHolyrood() { return load().holyrood; }
export function loadHistory() { return load().history; }
export function loadLaProj() { return load().laProj; }
export function loadLaImd() { return load().laImd; }

export interface CouncilCycle {
  council_slug: string;
  council_name: string;
  type: string;
  status: "scheduled" | "lgr_pending" | "tbc";
  next_election: string | null;
  next_election_label: string;
  cycle: string;
  last_election: string;
  note?: string;
}

export interface CouncilCyclesFile {
  metadata: Record<string, unknown>;
  councils: Record<string, CouncilCycle>;
}

let _cycles: CouncilCyclesFile | null = null;
export function loadCouncilCycles(): CouncilCyclesFile {
  if (_cycles) return _cycles;
  _cycles = JSON.parse(
    readFileSync(path.join(ROOT, "data/identity/council-cycles.json"), "utf8")
  );
  return _cycles!;
}

let _controlMay7: any = null;
export function loadMay7Control() {
  if (_controlMay7) return _controlMay7;
  _controlMay7 = JSON.parse(
    readFileSync(path.join(ROOT, "data/results/may-2026/council-control.json"), "utf8")
  );
  return _controlMay7;
}

let _postaudit: any = null;
export function loadMay7Postaudit() {
  if (_postaudit) return _postaudit;
  _postaudit = JSON.parse(
    readFileSync(
      path.join(ROOT, "data/transparency/may-2026-postaudit-2026-05-10.json"),
      "utf8"
    )
  );
  return _postaudit;
}

let _results: any = null;
export function loadMay7Results() {
  if (_results) return _results;
  _results = JSON.parse(
    readFileSync(
      path.join(ROOT, "data/results/may-2026/local-and-mayor.merged.json"),
      "utf8"
    )
  );
  return _results;
}

let _ge: { predictions: any; summary: any; assumptions: any; backtest: any; identity: any } | null = null;
function loadGe() {
  if (_ge) return _ge;
  _ge = {
    predictions: JSON.parse(readFileSync(path.join(ROOT, "data/predictions/ge-next/constituencies.json"), "utf8")),
    summary: JSON.parse(readFileSync(path.join(ROOT, "data/predictions/ge-next/summary.json"), "utf8")),
    assumptions: JSON.parse(readFileSync(path.join(ROOT, "data/predictions/ge-next/assumptions.json"), "utf8")),
    backtest: JSON.parse(readFileSync(path.join(ROOT, "data/backtests/ge-2024.json"), "utf8")),
    identity: JSON.parse(readFileSync(path.join(ROOT, "data/identity/pcons-ge-next.json"), "utf8")),
  };
  return _ge;
}
export function loadGePredictions() { return loadGe().predictions; }
export function loadGeSummary() { return loadGe().summary; }
export function loadGeAssumptions() { return loadGe().assumptions; }
export function loadGeBacktest() { return loadGe().backtest; }
export function loadGeIdentity() { return loadGe().identity; }

let _geBacktestBySlug: Record<string, any> | null = null;
/**
 * Returns the GE2024 backtest row for a given parliamentary constituency
 * slug (Democracy Club PCON slug). Returns null if no row was scored —
 * e.g. boundary changes that produced a new constituency in 2024.
 *
 * Row shape: { slug, name, country, region, predicted: {party: share},
 * actual: {party: share} }.
 */
export function loadGeBacktestForSeat(slug: string): any | null {
  if (!_geBacktestBySlug) {
    const bt = loadGeBacktest();
    _geBacktestBySlug = {};
    for (const row of (bt.rows || []) as any[]) {
      if (row?.slug) _geBacktestBySlug[row.slug] = row;
    }
  }
  return _geBacktestBySlug[slug] || null;
}

let _may7BacktestByCouncil: Record<string, any> | null = null;
/**
 * Aggregates the May 2026 ward-level postaudit rows up to council level,
 * returning summary stats for a single council slug. Used to draw the
 * "How we did on 7 May" callout on each council page.
 */
export function loadMay7BacktestForCouncil(slug: string): {
  ballots_evaluated: number;
  winners_correct: number;
  winner_accuracy: number;
  major_party_mae_avg: number;
  reform_signed_bias_pp: number;
  lab_signed_bias_pp: number;
  con_signed_bias_pp: number;
} | null {
  if (!_may7BacktestByCouncil) {
    _may7BacktestByCouncil = {};
    const pa = loadMay7Postaudit();
    const rows = (pa.live?.rows || []) as any[];
    const grouped: Record<string, any[]> = {};
    for (const r of rows) {
      const cs = r.council_slug;
      if (!cs) continue;
      (grouped[cs] = grouped[cs] || []).push(r);
    }
    for (const [cs, rs] of Object.entries(grouped)) {
      const n = rs.length;
      const correct = rs.filter((r) => r.winner_match).length;
      const maeSum = rs.reduce((s, r) => s + (r.major_party_mae || 0), 0);
      const refBias = rs.reduce((s, r) => s + (r.reform_delta || 0), 0);
      const labBias = rs.reduce((s, r) => s + (r.lab_delta || 0), 0);
      const conBias = rs.reduce((s, r) => s + (r.con_delta || 0), 0);
      _may7BacktestByCouncil[cs] = {
        ballots_evaluated: n,
        winners_correct: correct,
        winner_accuracy: n > 0 ? correct / n : 0,
        major_party_mae_avg: n > 0 ? maeSum / n : 0,
        reform_signed_bias_pp: n > 0 ? (refBias / n) * 100 : 0,
        lab_signed_bias_pp: n > 0 ? (labBias / n) * 100 : 0,
        con_signed_bias_pp: n > 0 ? (conBias / n) * 100 : 0,
      };
    }
  }
  return _may7BacktestByCouncil[slug] || null;
}

let _wardDemo: any = null;
export function loadWardDemographics() {
  if (_wardDemo) return _wardDemo;
  try {
    _wardDemo = JSON.parse(readFileSync(path.join(ROOT, "data/features/ward-demographics-2021.json"), "utf8")).wards || {};
  } catch { _wardDemo = {}; }
  return _wardDemo;
}

export function partyColour(party: string): string {
  const map: Record<string, string> = {
    "Labour": "#c1121f",
    "Conservative": "#1d4e89",
    "Reform UK": "#12b5cb",
    "Liberal Democrats": "#f59e0b",
    "Green Party": "#138a52",
    "SNP": "#fdf24e",
    "Plaid Cymru": "#3f9c35",
    "Independent": "#888888",
    "Workers Party": "#a78bfa",
    "SDP": "#8c1f3a",
    "Restore Britain": "#0f2545",
  };
  return map[party] || "#475467";
}

export function formatPct(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "—";
  return `${(p * 100).toFixed(1)}%`;
}

export function rankedShares(prediction: Record<string, { pct: number; votes: number }> | null): Array<[string, { pct: number; votes: number }]> {
  if (!prediction) return [];
  return Object.entries(prediction).sort((a, b) => (b[1].pct || 0) - (a[1].pct || 0));
}
