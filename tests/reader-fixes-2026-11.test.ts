/**
 * Four reader-facing defects seen on the live site on 20 November 2026.
 * Each is locked at its source: the candidates line, the ward/division word,
 * the by-election title, and (no change needed) the stub council outline.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { candidateFieldNote, isDeclared, loadLocalContests, localMetadata } from "../src/lib/byElections";
import { councilAreaNoun } from "../src/lib/councilAreaNoun";
import { councilDescription } from "../src/lib/councilPage";
import { byElectionResultSummary } from "../src/lib/pageSummaries";
import { placeResultTitle, TITLE_LIMIT } from "../src/lib/seo";
import { matchCouncilBoundaries } from "../src/lib/wardBoundaryJoin";

const load = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const huncoat = load("data/contests/local-byelections/hyndburn-huncoat-2026-11-12.json");
const shardEnd = load("data/contests/local-byelections/birmingham-shard-end-2026-11-26.json");
const TODAY = "2026-11-20";
const DASHES = /[–—]| - /;

describe("candidates line", () => {
  it("never tells a declared contest its field can still change, even when the feed has not locked it", () => {
    // Production regenerates the contest file nightly and the field there was
    // not locked, which is how "can still change, up to 16 October" reached a
    // declared result. Both states must read as closed.
    for (const locked of [true, false]) {
      const d = { ...huncoat, field: { ...huncoat.field, locked } };
      const note = candidateFieldNote(d, TODAY);
      expect(note).toBe("Nominations closed on 16 October 2026. 4 candidates stood.");
      expect(note).not.toMatch(/can still change|known so far|up to/);
    }
  });

  it("treats polls_closed, concluded and a past polling day as closed", () => {
    const open = { ...huncoat, result: null, declaration: null, field: { ...huncoat.field, locked: false } };
    for (const status of ["polls_closed", "concluded", "upcoming"]) {
      const note = candidateFieldNote({ ...open, status }, TODAY);
      expect(note).toContain("Nominations closed on 16 October 2026");
      expect(note).toContain("stood");
    }
  });

  it("closes the field once the nomination deadline has passed, before polling day", () => {
    const d = { ...shardEnd, field: { ...shardEnd.field, locked: false } };
    const note = candidateFieldNote(d, TODAY);
    expect(note).toMatch(/^Nominations closed on 30 October 2026\. 7 candidates are listed here so far/);
    expect(note).not.toMatch(/can still change/);
    expect(candidateFieldNote(shardEnd, TODAY)).toBe("Nominations closed on 30 October 2026. 7 candidates standing.");
  });

  it("still says the field is open, with a future deadline, before nominations close", () => {
    const d = { ...shardEnd, field: { ...shardEnd.field, locked: false } };
    expect(candidateFieldNote(d, "2026-10-20")).toBe(
      "7 candidates are known so far and the field can still change, up to 30 October 2026.",
    );
    expect(candidateFieldNote({ ...d, field: { ...d.field, candidate_count: 0 } }, "2026-10-20")).toBe(
      "No candidates have been published yet; nominations close on 30 October 2026. This page fills in as they are.",
    );
  });

  it("gives no contest in the corpus a past date as a limit still to come", () => {
    for (const d of loadLocalContests()) {
      const note = candidateFieldNote({ ...d, field: { ...d.field, locked: false } }, TODAY);
      const close = d.contest.nominations_close;
      if (close && close < TODAY) expect(note, d.slug).not.toMatch(/can still change|nominations close on/);
    }
  });
});

describe("ward or division", () => {
  const identity = load("data/identity/wards-may-2026.json");
  const councils = new Map<string, string>();
  for (const w of identity.wards) if (w.tier === "local") councils.set(w.council_slug, w.council_name);

  it("calls every county council's areas divisions, and every other council's wards", () => {
    const divisionCouncils = [...councils.values()].filter((n) => councilAreaNoun(n).kind === "division").sort();
    expect(divisionCouncils).toEqual([
      "East Sussex", "Essex", "Gloucestershire", "Hampshire", "Hertfordshire", "Norfolk", "Suffolk", "Surrey", "West Sussex",
    ]);
    for (const name of ["East Surrey", "West Surrey", "East Hertfordshire", "Burnley", "Camden"]) {
      expect(councilAreaNoun(name).one, name).toBe("ward");
    }
  });

  it("agrees with the results map wherever the map draws divisions", () => {
    const wards = load("data/geography/wd26-bgc.geojson").features;
    const divisions = load("data/geography/ced26-bgc.geojson").features;
    for (const [slug, name] of councils) {
      const rows = identity.wards.filter((w: any) => w.tier === "local" && w.council_slug === slug);
      const found = matchCouncilBoundaries(rows, name, wards, divisions);
      if (found) expect(councilAreaNoun(name).kind, slug).toBe(found.kind);
    }
  });

  it("carries the word into the council description and the by-election summary", () => {
    const essex = councilDescription({ councilName: "Essex", controlHeadline: "Reform UK majority", seatsUp: 78, nextLabel: null, areaNoun: councilAreaNoun("Essex").one });
    expect(essex).toContain("with each division's result");
    expect(councilDescription({ councilName: "Burnley", controlHeadline: "No overall control", seatsUp: 15, nextLabel: null })).toContain("each ward's result");
    const prior = { usable_as_baseline: true, election_date: "2025-05-01", shares: { Labour: 0.4, "Reform UK": 0.3 } };
    const d = { contest: { ward_name: "Bosmere", council_name: "Suffolk", polling_day: "2026-11-12" }, prior_result: prior,
      result: { declared: true, winner_party: "Labour", runner_up_party: "Reform UK", majority_votes: 10, total_votes: 1000, shares: { Labour: 0.5, "Reform UK": 0.4 } } };
    expect(byElectionResultSummary(d, "division").join(" ")).toContain("Against the division's May 2025 result");
  });
});

describe("by-election titles", () => {
  it("uses the ward page form, in British date order, for each status", () => {
    expect(localMetadata(huncoat, TODAY).title).toBe("Huncoat, Hyndburn. By-election result, 12 November 2026");
    const awaited = { ...huncoat, status: "polls_closed", result: null, declaration: null };
    expect(localMetadata(awaited, TODAY).title).toBe("Huncoat, Hyndburn. By-election result awaited, 12 Nov 2026");
    expect(localMetadata(shardEnd, TODAY).title).toBe("Shard End, Birmingham. By-election candidates, 26 Nov 2026");
    // Ward pages build their title from the same helper and are unchanged.
    expect(placeResultTitle({ place: "Belsize", council: "Camden", label: "Election result", date: "2026-05-07" }))
      .toBe("Belsize, Camden. Election result, 7 May 2026");
  });

  it("keeps descriptions naming the ward, council and date beside the title", () => {
    const m = localMetadata(huncoat, TODAY);
    expect(m.description).toMatch(/^Huncoat, Hyndburn, 12 November 2026: Jackie Rawstron \(/);
    expect(localMetadata(shardEnd, TODAY).description).toMatch(/^Shard End, Birmingham: by-election on 26 November 2026\./);
  });

  it("fits every title to 60 characters unless the ward name alone is too long, and keeps them unique", () => {
    const contests = loadLocalContests();
    const titles = contests.map((d) => localMetadata(d, TODAY).title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const [i, d] of contests.entries()) {
      const t = titles[i];
      expect(t, d.slug).not.toMatch(DASHES);
      expect(t, d.slug).not.toContain(" | ");
      if (isDeclared(d)) expect(t, d.slug).toMatch(/By-election result,/);
      const m = localMetadata(d, TODAY);
      expect(m.description, d.slug).toContain(d.contest.council_name);
      expect(m.description.length, d.slug).toBeLessThanOrEqual(160);
      if (t.length > TITLE_LIMIT) {
        // Only the council-free short form is allowed to run over.
        expect(t.startsWith(`${d.contest.ward_name}. `), d.slug).toBe(true);
      }
    }
  });
});
