/**
 * Page-side access to the council by-election forecaster scoreboard.
 *
 * The rules and the scoring live in scripts/lib/byelection-scoreboard.mjs so
 * the logging script, the tests and every page share one implementation. This
 * file only reads the tracked ledger and contest files once per build.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadLocalContests } from "./byElections";
import {
  LEDGER_FILE,
  SEATS_FILE,
  buildScoreboard,
  contestCalls,
  runningRecord,
} from "../../scripts/lib/byelection-scoreboard.mjs";

export const SCOREBOARD_PATH = "/by-elections/scoreboard/";

let cache: { ledger: any; contests: any[]; seats: any; board: any } | null = null;

function load() {
  if (!cache) {
    const ledger = JSON.parse(readFileSync(path.join(process.cwd(), LEDGER_FILE), "utf8"));
    const seats = JSON.parse(readFileSync(path.join(process.cwd(), SEATS_FILE), "utf8")).by_elections || {};
    const contests = loadLocalContests();
    cache = { ledger, contests, seats, board: buildScoreboard(ledger, contests, seats) };
  }
  return cache;
}

export const loadScoreboard = () => load().board;
export const loadScoreboardLedger = () => load().ledger;
export const scoreboardRunningRecord = () => runningRecord(load().board);
export const scoreboardContestCalls = (d: any) => contestCalls(load().ledger, d, load().seats);

/** "24 of 52 (46%)": the count always comes first, the rate never stands alone. */
export function countOf(called: number, contests: number): string {
  if (!contests) return "none yet";
  return `${called} of ${contests} (${Math.round((100 * called) / contests)}%)`;
}

export const STATUS_LABEL: Record<string, string> = {
  live: "Live",
  retrospective: "Retrospective",
};

export function monthLabel(month: string): string {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
export const loadLocalContestsForScoreboard = () => load().contests;
