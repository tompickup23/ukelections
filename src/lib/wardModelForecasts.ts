/**
 * The research ward model's live forecasts on council by-election pages.
 *
 * Data: data/forecasts/ward-model-byelections.json, written by
 * scripts/export-ward-model-byelections.mjs from the runner's own file. A
 * contest with no record there renders exactly as it did before this file
 * existed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LANES, poolParty, poolShares, topLane } from "../../scripts/lib/byelection-scoreboard.mjs";
import { OUTPUT_FILE } from "../../scripts/lib/ward-model-export.mjs";
import { partyProse } from "./pageSummaries";

/**
 * Which forecast leads a council by-election page. The one switch.
 *
 * "site": this site's swing projection first, the ward model second (default).
 * "ward-model": the ward model's block first, the hero map coloured by its
 * leader, and its link first in the page's own contents. Nothing else moves:
 * both blocks, the result comparison and the scoreboard are the same either way.
 */
export type LeadForecast = "site" | "ward-model";
export const LEAD_BYELECTION_FORECAST: LeadForecast = "site";

export interface WardModelRecord {
  ballot_paper_id: string;
  contest: string;
  council: string;
  ward: string;
  polling_day: string;
  polls_open_at: string;
  captured_at: string;
  model_version: string;
  code_commit: string;
  shares: Record<string, number>;
  called_leader: string;
  win_chance: Record<string, number>;
  standing_lanes: string[];
  others_parties: string[];
  ward_has_earlier_contest: boolean | null;
  inputs: Record<string, string | number | null>;
}

let cache: any = null;
function load() {
  if (cache === null) {
    const file = path.join(process.cwd(), OUTPUT_FILE);
    cache = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { forecasts: {}, skipped: {} };
  }
  return cache;
}

export const loadWardModelExport = () => load();

/** The ward model's record for a contest slug, or null. */
export function wardModelFor(slug: string): WardModelRecord | null {
  return load().forecasts?.[slug] ?? null;
}

/** "the Liberal Democrats", "Others": a lane as it reads in a sentence. */
export function laneProse(lane: string): string {
  return lane === "Others" ? "independents and smaller parties, pooled as Others," : partyProse(lane);
}

/**
 * One neutral sentence where the two forecasts name different leading lanes,
 * otherwise null. The site's leader is pooled into the same six lanes first,
 * so a site call for a smaller party compares with the ward model's Others.
 */
export function forecastsDisagreeSentence(siteForecast: any, ward: WardModelRecord | null): string | null {
  if (!ward || !siteForecast?.winner) return null;
  const siteLane = poolParty(siteForecast.winner);
  if (siteLane === ward.called_leader) return null;
  const siteSide = siteForecast.too_close_to_call
    ? `this site's projection calls it too close, with ${laneProse(siteLane)} strongest`
    : `this site's projection has ${laneProse(siteLane)} ahead`;
  return `The two forecasts name different leaders: ${siteSide}, and the research ward model has ${laneProse(ward.called_leader)} ahead on vote share.`;
}

/** Mean absolute error in points over lanes with a forecast or an actual share. */
export function laneMaePp(forecast: Record<string, number>, actual: Record<string, number>): number {
  const lanes = LANES.filter((l) => (forecast[l] ?? 0) > 0 || (actual[l] ?? 0) > 0);
  if (!lanes.length) return 0;
  return (100 * lanes.reduce((s, l) => s + Math.abs((forecast[l] ?? 0) - (actual[l] ?? 0)), 0)) / lanes.length;
}

export interface ResultComparison {
  rows: Array<{ lane: string; actual: number; site: number | null; ward: number }>;
  leader: string;
  site: { leader: string; right: boolean; mae_pp: number } | null;
  ward: { leader: string; right: boolean; mae_pp: number };
}

/**
 * Both forecasts against a declared result, in the six lanes the scoreboard
 * uses. Null unless the contest has a ward model record and a result with
 * shares. Rows follow the page's order rule: by the result, largest first.
 */
export function resultComparison(d: any, ward: WardModelRecord | null): ResultComparison | null {
  if (!ward || !d?.result?.declared || !d.result.shares) return null;
  const actual = poolShares(d.result.shares);
  const leader = topLane(actual);
  if (!leader) return null;
  const site = d.forecast?.central ? poolShares(d.forecast.central) : null;
  const rows = LANES.filter((l) => actual[l] > 0.0005 || (ward.shares[l] ?? 0) > 0.0005 || (site?.[l] ?? 0) > 0.0005)
    .map((lane) => ({ lane, actual: actual[lane], site: site ? site[lane] : null, ward: ward.shares[lane] ?? 0 }))
    .sort((a, b) => b.actual - a.actual);
  const siteLeader = d.forecast?.winner ? poolParty(d.forecast.winner) : null;
  return {
    rows,
    leader,
    site: site && siteLeader ? { leader: siteLeader, right: siteLeader === leader, mae_pp: laneMaePp(site, actual) } : null,
    ward: { leader: ward.called_leader, right: ward.called_leader === leader, mae_pp: laneMaePp(ward.shares, actual) },
  };
}

/** "27 November 2026, 23:52 UTC": the runner's capture time, never the build's. */
export function captureLabel(iso: string): string {
  const t = new Date(iso);
  const date = t.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const time = t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}
