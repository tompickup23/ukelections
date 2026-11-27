import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LANES,
  buildScoreboard,
  capturedInstant,
  contestCalls,
  entryStatus,
  pollsOpenAt,
  poolParty,
  poolShares,
  scoreCalls,
  shareError,
  topLane,
  validateLedger,
} from "../scripts/lib/byelection-scoreboard.mjs";
import {
  RESEARCH,
  SITE,
  addOutsideEntry,
  importResearch,
  loadContests,
  loadLedger,
  logSiteForecasts,
} from "../scripts/scoreboard-log.mjs";
import { scoreboardSummary } from "../src/lib/pageSummaries.ts";

const ROOT = process.cwd();
const EXPORT_FILE = "data/scoreboard/research-ward-model-export-2026-11.json";
const ledger = loadLedger();
const contests = loadContests();
const exportDoc = JSON.parse(readFileSync(path.join(ROOT, EXPORT_FILE), "utf8"));

function toyContest({ slug = "toy-ward-2026-12-10", day = "2026-12-10", forecast = null, result = null, holder = null, prior = null } = {}) {
  return {
    slug,
    generated_at: "2026-12-11T03:50:00.000Z",
    status: result ? "concluded" : "upcoming",
    contest: { ballot_paper_id: `local.toy.${slug}`, polling_day: day, council_name: "Toy", ward_name: "Toy Ward", territory: "ENG" },
    forecast,
    result,
    previous_holder: holder ? { party: holder, established: true } : null,
    prior_result: prior ? { shares: prior } : null,
  };
}

describe("the live rule", () => {
  it("opens polls at 07:00 UK time, in winter and in summer", () => {
    expect(pollsOpenAt("2026-12-10").toISOString()).toBe("2026-12-10T07:00:00.000Z");
    expect(pollsOpenAt("2026-07-02").toISOString()).toBe("2026-07-02T06:00:00.000Z");
  });

  it("is live only before polls open", () => {
    expect(entryStatus("2026-12-10T06:59:59Z", "2026-12-10")).toBe("live");
    expect(entryStatus("2026-12-10T07:00:00Z", "2026-12-10")).toBe("retrospective");
    // BST: 06:30 UTC is 07:30 in the UK, after polls opened.
    expect(entryStatus("2026-07-02T06:30:00Z", "2026-07-02")).toBe("retrospective");
    expect(entryStatus("2026-07-02T05:59:00Z", "2026-07-02")).toBe("live");
    expect(entryStatus("2026-07-02T06:30:00+01:00", "2026-07-02")).toBe("live");
  });

  it("reads a bare date as the end of that day", () => {
    expect(entryStatus("2026-12-09", "2026-12-10")).toBe("live");
    expect(entryStatus("2026-12-10", "2026-12-10")).toBe("retrospective");
    expect(entryStatus("2026-08-28", "2026-08-27")).toBe("retrospective");
  });

  it("refuses a timestamp without a zone", () => {
    expect(capturedInstant("2026-12-09T10:00:00")).toBeNull();
    expect(entryStatus("2026-12-09T10:00:00", "2026-12-10")).toBe("retrospective");
  });
});

describe("the ledger", () => {
  it("passes its own rules: every stored status is the one the capture time gives", () => {
    expect(validateLedger(ledger)).toEqual([]);
  });

  it("names every entry's contest file", () => {
    const slugs = new Set(contests.map((d) => d.slug));
    for (const e of ledger.entries) expect(slugs.has(e.contest), e.contest).toBe(true);
  });

  it("holds no outside forecaster yet", () => {
    expect(Object.keys(ledger.forecasters).sort()).toEqual([SITE, RESEARCH].sort());
    expect(ledger.entries.filter((e) => ["hand_recorded", "supplied_by_forecaster"].includes(e.capture_method))).toEqual([]);
  });

  it("never marks a research back-test or a rebuilt contest file live", () => {
    for (const e of ledger.entries) {
      if (e.capture_method === "research_export" || e.capture_method === "site_rebuild") expect(e.status).toBe("retrospective");
    }
  });

  it("copies the research export whole, meta block included", () => {
    expect(exportDoc.meta.contests).toBe(107);
    expect(Object.keys(exportDoc.by_ballot)).toHaveLength(107);
    const research = ledger.entries.filter((e) => e.forecaster === RESEARCH);
    expect(research).toHaveLength(107);
    for (const e of research) {
      expect(e.called_leader).toBe(topLane(poolShares(exportDoc.by_ballot[e.ballot_paper_id].model_shares)));
    }
  });

  it("matches the published snapshot wherever one was used", () => {
    const published = JSON.parse(readFileSync(path.join(ROOT, "data/cards/published-byelection-forecasts.json"), "utf8")).forecasts;
    for (const e of ledger.entries.filter((x) => x.source === "data/cards/published-byelection-forecasts.json")) {
      const snap = published[e.contest];
      expect(snap, e.contest).toBeTruthy();
      expect(e.captured_at).toBe(snap.captured_at);
      expect(e.called_party).toBe(snap.projected_winner);
    }
  });
});

describe("the record reproduces the known figures", () => {
  const board = buildScoreboard(ledger, contests);
  const records = new Map(contests.map((d) => [d.contest.ballot_paper_id, d]));
  const ids = Object.keys(exportDoc.by_ballot);

  it("research model: 70 of the 107 English contests", () => {
    const research = board.retrospective.find((b) => b.forecaster === RESEARCH);
    expect(research.score).toMatchObject({ contests: 107, called: 70 });
  });

  it("site forecast: 58 on the same 107, which is 58 of the 103 it forecast", () => {
    const site = ledger.entries.filter((e) => e.forecaster === SITE && ids.includes(e.ballot_paper_id));
    expect(site).toHaveLength(103);
    const recs = new Map(ids.map((id) => [id, { scorable: true, leader: topLane(poolShares(records.get(id).result.shares)) }]));
    expect(scoreCalls(site, recs)).toMatchObject({ contests: 103, called: 58 });
    const h2h = board.headToHead.find((h) => h.a.forecaster === SITE && h.b.forecaster === RESEARCH);
    expect(h2h.contests).toBe(103);
    expect(h2h.a.score.called).toBe(58);
    expect(h2h.b.score.called).toBe(67);
  });

  it("the export's actual shares agree with the contest files on every leader", () => {
    for (const id of ids) {
      expect(topLane(poolShares(records.get(id).result.shares))).toBe(topLane(exportDoc.by_ballot[id].actual_shares));
    }
  });

  it("agrees with the post-mortem on the published forecasts", () => {
    const pm = JSON.parse(readFileSync(path.join(ROOT, "data/transparency/byelection-post-mortem.json"), "utf8"));
    const snapshotSlugs = new Set(pm.contests.map((x) => x.slug));
    const fromSnapshot = ledger.entries.filter((e) => e.forecaster === SITE && snapshotSlugs.has(e.contest));
    const recs = new Map(contests.map((d) => [d.contest.ballot_paper_id, { scorable: Boolean(d.result?.declared), leader: d.result?.winner_party ? poolParty(d.result.winner_party) : null }]));
    expect(scoreCalls(fromSnapshot, recs)).toMatchObject({ contests: pm.overall.contests, called: pm.overall.winners_called });
  });

  it("keeps live and retrospective apart", () => {
    const sum = (rows) => rows.reduce((n, b) => n + b.entries, 0);
    expect(sum(board.live) + sum(board.retrospective)).toBe(ledger.entries.length);
    expect(board.counts.live_entries + board.counts.retrospective_entries).toBe(ledger.entries.length);
  });

  it("scores each benchmark on the forecaster's own contests", () => {
    for (const block of [...board.live, ...board.retrospective]) {
      for (const b of block.benchmarks) {
        expect(b.score.contests + b.left_out).toBe(block.score.contests);
        expect(b.forecaster_same_contests.contests).toBe(b.score.contests);
      }
    }
  });

  it("writes a summary from the board with a count beside every figure", () => {
    const text = scoreboardSummary(board).join(" ");
    const live = board.live.find((b) => b.forecaster === SITE);
    expect(text).toContain(`${live.score.called} of ${live.score.contests}`);
    expect(text).toContain("No outside forecaster");
    expect(text).not.toMatch(/\d+%/);
    expect(text).not.toMatch(/[–—]| - /);
  });
});

describe("scoring", () => {
  const rec = (leader, actual) => new Map([["b", { scorable: true, leader, actual }]]);
  const actual = { ...Object.fromEntries(LANES.map((l) => [l, 0])), Labour: 0.5, "Reform UK": 0.3, Others: 0.2 };

  it("pools independents and smaller parties as Others", () => {
    expect(poolShares({ Independent: 0.2, "Restore Britain": 0.1, Labour: 0.7 }).Others).toBeCloseTo(0.3);
  });

  it("scores Brier on the named favourite", () => {
    expect(scoreCalls([{ ballot_paper_id: "b", called_leader: "Labour", win_chance: 0.6 }], rec("Labour", actual)).brier.mean).toBeCloseTo(0.16);
    expect(scoreCalls([{ ballot_paper_id: "b", called_leader: "Reform UK", win_chance: 0.6 }], rec("Labour", actual)).brier.mean).toBeCloseTo(0.36);
  });

  it("averages share error over the lanes either side used", () => {
    expect(shareError({ Labour: 0.4, "Reform UK": 0.4, Independent: 0.2 }, actual)).toBeCloseTo(((10 + 10 + 0) / 3), 6);
  });

  it("does not score a contest without a result", () => {
    const recs = new Map([["b", { scorable: false }]]);
    expect(scoreCalls([{ ballot_paper_id: "b", called_leader: "Labour" }], recs).contests).toBe(0);
  });
});

describe("logging", () => {
  const fc = { winner: "Labour", leader_probability: 0.55, central: { Labour: 0.45, "Reform UK": 0.35, Conservative: 0.2 }, too_close_to_call: false };
  const empty = { forecasters: ledger.forecasters, entries: [] };

  it("logs an upcoming contest live, refreshes it before polls open, then never again", () => {
    const d = toyContest({ forecast: fc });
    const first = logSiteForecasts(empty, [d], {}, new Date("2026-12-08T03:40:00Z"));
    expect(first.ledger.entries[0]).toMatchObject({ status: "live", called_leader: "Labour", captured_at: "2026-12-08T03:40:00.000Z" });
    const moved = toyContest({ forecast: { ...fc, winner: "Reform UK" } });
    const second = logSiteForecasts(first.ledger, [moved], {}, new Date("2026-12-10T03:40:00Z"));
    expect(second.ledger.entries).toHaveLength(1);
    expect(second.ledger.entries[0]).toMatchObject({ status: "live", called_leader: "Reform UK" });
    const after = toyContest({ forecast: { ...fc, winner: "Conservative" } });
    const third = logSiteForecasts(second.ledger, [after], {}, new Date("2026-12-10T08:00:00Z"));
    expect(third.ledger.entries[0]).toMatchObject({ called_leader: "Reform UK", captured_at: "2026-12-10T03:40:00.000Z" });
  });

  it("drops the entry when the page withdraws its forecast before polling day", () => {
    const first = logSiteForecasts(empty, [toyContest({ forecast: fc })], {}, new Date("2026-12-01T03:40:00Z"));
    const withdrawn = logSiteForecasts(first.ledger, [toyContest()], {}, new Date("2026-12-02T03:40:00Z"));
    expect(withdrawn.ledger.entries).toHaveLength(0);
    expect(withdrawn.changes.withdrawn).toEqual(["toy-ward-2026-12-10"]);
  });

  it("fills a past contest from its rebuild only as retrospective", () => {
    const d = toyContest({ forecast: fc, result: { declared: true, shares: { Labour: 0.5 } } });
    const res = logSiteForecasts(empty, [d], {}, new Date("2026-12-20T03:40:00Z"));
    expect(res.ledger.entries[0]).toMatchObject({ status: "retrospective", capture_method: "site_rebuild", basis: "rebuilt_after_poll" });
  });

  it("prefers the published snapshot for a past contest", () => {
    const d = toyContest({ forecast: fc });
    const snap = { captured_at: "2026-12-04", projected_winner: "Conservative", leader_probability_pct: 40, central_pct: { Conservative: 38, Labour: 37 } };
    const res = logSiteForecasts(empty, [d], { [d.slug]: snap }, new Date("2026-12-20T03:40:00Z"));
    expect(res.ledger.entries[0]).toMatchObject({ status: "live", capture_method: "site_snapshot", called_leader: "Conservative", win_chance: 0.4 });
  });

  it("imports a research export as back-test entries only", () => {
    const d = toyContest({ result: { declared: true, shares: { Labour: 0.5 } } });
    const doc = { by_ballot: { [d.contest.ballot_paper_id]: { model_shares: { Labour: 0.6, Others: 0.4 } } } };
    const res = importResearch(empty, doc, [d], { capturedAt: "2026-12-20", source: "x.json" });
    expect(res.ledger.entries[0]).toMatchObject({ status: "retrospective", capture_method: "research_export", called_leader: "Labour" });
  });
});

describe("adding an outside forecaster's call", () => {
  const withOutside = {
    forecasters: { ...ledger.forecasters, "example-forecaster": { name: "Example Forecasts", kind: "forecaster", url: "https://example.org/" } },
    entries: [],
  };
  const d = toyContest();

  it("records a call published before polls opened as live", () => {
    const { entry } = addOutsideEntry(withOutside, { forecaster: "example-forecaster", contest: d.slug, party: "Independent", chance: 0.4, captured_at: "2026-12-09T18:00:00Z", source: "https://example.org/forecast" }, [d]);
    expect(entry).toMatchObject({ status: "live", called_leader: "Others", capture_method: "hand_recorded" });
  });

  it("records a call captured on polling day morning as retrospective", () => {
    const { entry } = addOutsideEntry(withOutside, { forecaster: "example-forecaster", contest: d.slug, party: "Labour", captured_at: "2026-12-10T09:00:00Z", source: "https://example.org/forecast" }, [d]);
    expect(entry.status).toBe("retrospective");
  });

  it("refuses an unregistered forecaster, a missing source or a duplicate", () => {
    expect(() => addOutsideEntry(withOutside, { forecaster: "nobody", contest: d.slug, party: "Labour", captured_at: "2026-12-09", source: "x" }, [d])).toThrow();
    expect(() => addOutsideEntry(withOutside, { forecaster: "example-forecaster", contest: d.slug, party: "Labour", captured_at: "2026-12-09" }, [d])).toThrow();
    const once = addOutsideEntry(withOutside, { forecaster: "example-forecaster", contest: d.slug, party: "Labour", captured_at: "2026-12-09", source: "x" }, [d]);
    expect(() => addOutsideEntry(once.ledger, { forecaster: "example-forecaster", contest: d.slug, party: "Labour", captured_at: "2026-12-09", source: "x" }, [d])).toThrow();
  });
});

describe("one contest's calls", () => {
  it("says who called a finished contest, benchmarks included", () => {
    const d = toyContest({ result: { declared: true, shares: { Labour: 0.5, "Reform UK": 0.3 }, winner_party: "Labour" }, holder: "Conservative", prior: { Labour: 0.4, Conservative: 0.3 } });
    const l = { forecasters: ledger.forecasters, entries: [{ contest: d.slug, ballot_paper_id: d.contest.ballot_paper_id, polling_day: d.contest.polling_day, forecaster: SITE, called_party: "Labour", called_leader: "Labour", captured_at: "2026-12-09", status: "live" }] };
    const out = contestCalls(l, d);
    expect(out.calls[0]).toMatchObject({ right: true, status: "live" });
    expect(out.benchmarks.find((b) => b.id === "holder")).toMatchObject({ called_leader: "Conservative", right: false });
    expect(out.benchmarks.find((b) => b.id === "last_leader")).toMatchObject({ called_leader: "Labour", right: true });
  });
});
