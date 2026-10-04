/**
 * The opening paragraph on constituency, ward and by-election pages.
 *
 * Written from the same record the page renders below it, so it changes with
 * the nightly build and can never disagree with the tables. Every figure here
 * is one the page already shows, or the difference between two it shows.
 * Nothing is typed in, and the wording stays neutral: "projects", "rose",
 * "fell", never a characterisation of a party.
 *
 * No named individual appears in these paragraphs: they sit beside the
 * headline numbers, and the page's own sections carry the names.
 *
 * Demographic model steps (English identity, age structure, the Reform
 * ceilings) are never paraphrased here. Where they move a seat, the summary
 * points to the step list under "How this forecast was built", which states
 * them exactly.
 */
import { shortPartyLabel } from "./siteData";
import { formatPct } from "./predictions";

const pct1 = (x: number) => (x * 100).toFixed(1);
const pts1 = (x: number) => Math.abs(x * 100).toFixed(1);
const upDown = (x: number) => `${x >= 0 ? "up" : "down"} ${pts1(x)} ${pointWord(x)}`;
const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const pointWord = (x: number) => (pts1(x) === "1.0" ? "point" : "points");
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const PROSE_NAMES: Record<string, string> = {
  "Liberal Democrats": "the Liberal Democrats",
  Conservative: "the Conservatives",
  "Green Party": "the Green Party",
  SNP: "the SNP",
  DUP: "the DUP",
  SDLP: "the SDLP",
  UUP: "the UUP",
  "Workers Party of Britain": "the Workers Party",
  "Speaker seeking re-election": "the Speaker",
  "Restore Britain": "Restore Britain",
  Other: "other candidates",
};

const ADJECTIVES: Record<string, string> = {
  "Liberal Democrats": "Liberal Democrat",
  "Green Party": "Green",
  Independent: "independent",
  "Workers Party of Britain": "Workers Party",
};
/** "the Liberal Democrat share", "the Green share". */
export function partyAdjective(party: string): string {
  return ADJECTIVES[party] ?? shortPartyLabel(party);
}

/**
 * A party as it reads in a sentence: "the Liberal Democrats won", not "Lib Dem
 * won". `one` is for a single winner, where "Independent" means one person.
 */
export function partyProse(party: string, one = false): string {
  if (party === "Independent") return one ? "an independent candidate" : "independent candidates";
  return PROSE_NAMES[party] ?? shortPartyLabel(party);
}

type Shares = Record<string, number>;

/* ------------------------------------------------------------------ */
/* Constituencies                                                      */
/* ------------------------------------------------------------------ */

/**
 * The 2024 result by the model's own party names.
 *
 * The rendered 2024 table lists candidates under their ballot descriptions
 * ("Labour and Co-operative Party", "Conservative and Unionist Party"), which
 * never match the model's "Labour" and "Conservative". The swing column used
 * to look them up by name, found nothing, and showed Burnley's Labour vote as
 * +27.2pp when it fell from 31.7% to 27.2%. The model's own GE2024 baseline
 * step carries the same result under the model's names.
 */
export function ge2024Baseline(record: any): Shares {
  const step = (record?.methodology || []).find((m: any) => m?.name === "GE2024 Baseline");
  if (step?.data) {
    return Object.fromEntries(Object.entries(step.data).filter(([, v]) => typeof v === "number")) as Shares;
  }
  const out: Shares = {};
  for (const c of record?.ge2024?.candidates || []) {
    const party = c.party_name || c.party;
    if (party) out[party] = (out[party] || 0) + (c.pct || 0);
  }
  return out;
}

/** Projected share minus the 2024 share, per party, as the swing bars show it. */
export function seatSwings(record: any): Shares {
  const base = ge2024Baseline(record);
  return Object.fromEntries(
    Object.entries(record?.prediction || {}).map(([party, p]: [string, any]) => [party, (p?.pct || 0) - (base[party] || 0)]),
  );
}

function ranked(shares: Shares): Array<[string, number]> {
  return Object.entries(shares).sort((a, b) => b[1] - a[1]);
}

/**
 * How much of a party's change comes from the national polling swing alone,
 * where the model records it.
 */
function nationalChange(record: any, party: string): number | null {
  const step = (record?.methodology || []).find((m: any) => String(m?.name || "").startsWith("National Swing"));
  const v = step?.details?.[party]?.localChange;
  return typeof v === "number" ? v : null;
}

export interface SeatBacktestSummary {
  predictedWinner: string | null;
  actualWinner: string | null;
  winnerCorrect: boolean;
  /** Major-party mean absolute error, as a share (0.0234 = 2.34 points). */
  mae: number;
}

export function constituencySummary(record: any, backtest: SeatBacktestSummary | null): string[] {
  const name = record.name;
  const sentences: string[] = [];

  const base = ranked(ge2024Baseline(record));
  const [first, second] = base;
  if (first && second) {
    sentences.push(
      `At the 2024 general election ${partyProse(first[0], true)} won ${name} with ${pct1(first[1])}% of the vote, ` +
        `${pts1(first[1] - second[1])} ${pointWord(first[1] - second[1])} ahead of ${partyProse(second[0])}.`,
    );
  }

  const winner = record.winner;
  const runnerUp = record.runner_up;
  const winnerShare = record.prediction?.[winner]?.pct;
  if (winner && runnerUp && typeof winnerShare === "number") {
    const holds = first && first[0] === winner;
    sentences.push(
      `The model now projects ${partyProse(winner, true)} ${holds ? "to hold the seat" : "to win it"} on ${pct1(winnerShare)}%, ` +
        `${pts1(record.majority_pct || 0)} ${pointWord(record.majority_pct || 0)} clear of ${partyProse(runnerUp)}.`,
    );
  }

  const swings = Object.entries(seatSwings(record))
    .filter(([, v]) => Math.abs(v) >= 0.0005)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2);
  if (swings.length === 2) {
    const [[pa, sa], [pb, sb]] = swings;
    // "Mainly national polling" only where the national swing step alone lands
    // within a point of the final change for both parties.
    const mostlyNational = swings.every(([party, swing]) => {
      const nat = nationalChange(record, party);
      return nat !== null && Math.abs(nat - swing) <= 0.01;
    });
    sentences.push(
      `The largest changes since 2024 are ${partyProse(pa)} ${upDown(sa)} and ${partyProse(pb)} ${upDown(sb)}` +
        (mostlyNational
          ? `, both mainly from the change in national polling.`
          : `, from the change in national polling and the seat-level adjustments listed under ‘How this forecast was built’.`),
    );
  }

  if (backtest?.predictedWinner && backtest.actualWinner) {
    sentences.push(
      backtest.winnerCorrect
        ? `Rerun on the data available in May 2024, the model called this seat correctly for ${partyProse(backtest.actualWinner)} at the 2024 election, with a mean error of ${(backtest.mae * 100).toFixed(2)} points across the major parties.`
        : `Rerun on the data available in May 2024, the model named ${partyProse(backtest.predictedWinner, true)} here, but ${partyProse(backtest.actualWinner, true)} won in 2024; its mean error across the major parties was ${(backtest.mae * 100).toFixed(2)} points.`,
    );
  }
  return sentences;
}

/* ------------------------------------------------------------------ */
/* Wards (7 May 2026)                                                  */
/* ------------------------------------------------------------------ */

export interface WardSummaryInput {
  wardName: string;
  councilName: string;
  /** e.g. "Reform UK (2), Labour (1)" or "Reform UK", as the page renders it. */
  seatsWon: string;
  seats: number;
  turnoutPct: number | null;
  majority: number | null;
  majorityOverParty: string | null;
  incomplete: boolean;
  backtest: { predicted_winner: string; actual_winner: string; winner_match: boolean; major_party_mae: number } | null;
}

export function wardSummary(input: WardSummaryInput): string[] {
  const s: string[] = [];
  s.push(
    `${input.wardName} in ${input.councilName} elected ${input.seats === 1 ? "one councillor" : `${input.seats} councillors`} on 7 May 2026: ${input.seatsWon}.`,
  );
  if (input.turnoutPct != null) s.push(`Turnout was ${formatPct(input.turnoutPct)}.`);
  if (input.majority != null && !input.incomplete && input.majorityOverParty) {
    s.push(
      `${input.seats === 1 ? "The winner" : "The last seat"} was decided by ${input.majority.toLocaleString("en-GB")} ${input.majority === 1 ? "vote" : "votes"} over ${partyProse(input.majorityOverParty)}.`,
    );
  }
  const bt = input.backtest;
  if (bt?.predicted_winner && bt.actual_winner) {
    s.push(
      bt.winner_match
        ? `The forecast published before polling day had ${partyProse(bt.predicted_winner, true)} ahead here, which was right, with a mean error of ${((bt.major_party_mae || 0) * 100).toFixed(2)} points across the major parties.`
        : `The forecast published before polling day had ${partyProse(bt.predicted_winner, true)} ahead here, but ${partyProse(bt.actual_winner, true)} won; its mean error across the major parties was ${((bt.major_party_mae || 0) * 100).toFixed(2)} points.`,
    );
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Council by-elections                                                */
/* ------------------------------------------------------------------ */

function sourceLabel(result: any): string {
  if (result?.review_status === "hand_verified_declaration") return "the returning officer's declaration";
  if (result?.review_status === "hand_verified_two_sources") return "two independent published sources";
  const src = String(result?.source || "");
  if (/democracyclub\.org\.uk/.test(src)) return "Democracy Club's results record";
  try {
    return `the published result at ${new URL(src).hostname.replace(/^www\./, "")}`;
  } catch {
    return "the source linked below";
  }
}

/**
 * The first thing a reader searching "<ward> by-election result" needs, in two
 * or three sentences: who won, by how much, how the shares moved since the
 * ward was last fought, and where the result comes from.
 */
export function byElectionResultSummary(d: any): string[] {
  const c = d?.contest;
  const result = d?.result;
  const where = `the ${c.ward_name} by-election in ${c.council_name} on ${prettyDate(c.polling_day)}`;
  if (result?.declared && result.winner_party) {
    const s: string[] = [];
    const share = result.shares?.[result.winner_party];
    s.push(
      `${cap(partyProse(result.winner_party, true))} won ${where}` +
        (typeof share === "number" ? ` with ${pct1(share)}% of the vote` : "") +
        (result.majority_votes != null && result.runner_up_party
          ? `, ${result.majority_votes.toLocaleString("en-GB")} ${result.majority_votes === 1 ? "vote" : "votes"} ahead of ${partyProse(result.runner_up_party, true)}.`
          : "."),
    );
    const prior = d.prior_result;
    if (prior?.usable_as_baseline && prior.election_date && prior.shares && !c.boundary_changed_since_prior) {
      const moves = [result.winner_party, result.runner_up_party]
        .filter(Boolean)
        .map((party: string) => {
          const before = prior.shares[party] || 0;
          const now = result.shares?.[party] || 0;
          if (before === 0) return `${partyProse(party)} had no candidate then`;
          const delta = now - before;
          return `the ${partyAdjective(party)} share ${delta >= 0 ? "rose" : "fell"} ${pts1(delta)} ${pointWord(delta)}`;
        });
      if (moves.length) {
        s.push(
          `Against the ward's ${monthYear(prior.election_date)} result${prior.seats_contested && prior.seats_contested > 1 ? " (each party's best-placed candidate)" : ""}, ${moves.join(" and ")}.`,
        );
      }
    }
    s.push(
      `In all, ${result.total_votes.toLocaleString("en-GB")} votes were cast. The result is taken from ${sourceLabel(result)}${result.checked_at ? `, checked on ${prettyDate(result.checked_at)}` : ""}.`,
    );
    return s;
  }
  const dec = d?.declaration;
  if (dec?.declared && dec.winner_party) {
    return [
      `${cap(partyProse(dec.winner_party, true))} won ${where}.` +
        (dec.turnout_pct != null ? ` Turnout was ${dec.turnout_pct}%.` : ""),
      `The vote counts have not been published in a form we can check, so this page shows the declared winner only.`,
    ];
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Region hubs                                                         */
/* ------------------------------------------------------------------ */

/** The party that topped the 2024 poll in a seat, by the model's names. */
export function ge2024Winner(record: any): string | null {
  return ranked(ge2024Baseline(record))[0]?.[0] ?? null;
}

export function tally(parties: Array<string | null>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const p of parties) if (p) counts.set(p, (counts.get(p) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const countLabel = (party: string) =>
  party === "Independent" ? "independents" : partyProse(party);
function listCounts(counts: Array<[string, number]>, limit = 4): string {
  const shown = counts.slice(0, limit).map(([p, n]) => `${countLabel(p)} ${n}`);
  const rest = counts.slice(limit).reduce((s, [, n]) => s + n, 0);
  if (rest) shown.push(`others ${rest}`);
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0] ?? "";
}

/** `regionName` as it reads mid-sentence, e.g. "the North East". */
export function regionSummary(regionName: string, records: any[]): string[] {
  if (!records.length) return [];
  const won2024 = tally(records.map(ge2024Winner));
  const projected = tally(records.map((r) => r.winner || null));
  const changing = records.filter((r) => r.winner && ge2024Winner(r) && r.winner !== ge2024Winner(r)).length;
  return [
    `${cap(regionName)} has ${records.length} parliamentary constituencies.`,
    `At the 2024 general election the seats went ${listCounts(won2024)}.`,
    `On current polling the model projects ${listCounts(projected)}, with ${changing === 0 ? "no seats" : changing === 1 ? "one seat" : `${changing} seats`} changing hands against the 2024 result.`,
  ];
}
