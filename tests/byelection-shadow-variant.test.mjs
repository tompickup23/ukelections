import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  SHADOW_CUT,
  SHADOW_FILE,
  addShadowForecast,
  backtestLoo,
  emptyShadowFile,
  scoreContest,
  shadowForecastForContest,
} from "../scripts/lib/byelection-shadow-variant.mjs";
import { writeNewForecasts } from "../scripts/shadow-byelection-variant.mjs";
import { PUBLISHED_DATA } from "../src/lib/publishedData.ts";

const ROOT = process.cwd();
const HISTORY = path.join(ROOT, "data/history/dc-historic-results.json");

async function loadCorpus() {
  const { loadHistory, buildPriorIndex, loadPagePriors, corpusPriorFinder } = await import("../scripts/build-local-byelections.mjs");
  const { buildSwingCorpus } = await import("../scripts/lib/local-byelection-model.mjs");
  const priors = buildPriorIndex(loadHistory());
  return buildSwingCorpus(priors.byelectionRows, corpusPriorFinder(priors, loadPagePriors()));
}

// A small hand-built corpus: enough for the no-overwrite and leakage tests to
// run anywhere, including where the gitignored history file is absent.
function toyContest({ id, date, fromReform, toReform, restore = 0 }) {
  const rest = 1 - toReform - restore;
  return {
    ballot_paper_id: id,
    date,
    era: "post_may_2025",
    reform_entered: fromReform < 0.02,
    from: { "Reform UK": fromReform, Labour: 0.5 - fromReform / 2, Conservative: 0.5 - fromReform / 2 },
    to: { "Reform UK": toReform, Labour: rest / 2, Conservative: rest / 2, "Restore Britain": restore },
  };
}
const toyCorpus = Array.from({ length: 30 }, (_, i) =>
  toyContest({
    id: `toy.${i}`,
    date: `2026-${String(9 + Math.floor(i / 10)).padStart(2, "0")}-${String(1 + (i % 10) * 2).padStart(2, "0")}`,
    fromReform: 0.3,
    toReform: 0.25 - (i % 3) * 0.02,
    restore: i % 2 ? 0.06 : 0,
  }),
);
function toyContestFile(slug, pollingDay) {
  return {
    slug,
    generated_at: "2026-11-20T00:00:00Z",
    contest: { ballot_paper_id: `local.toy.${slug}`, polling_day: pollingDay, voting_system: "FPTP" },
    field: { parties: ["Conservative", "Labour", "Reform UK", "Restore Britain"] },
    forecast: {
      baseline: {
        election_date: "2025-05-01",
        shares: { "Reform UK": 0.3, Labour: 0.35, Conservative: 0.35 },
      },
    },
    result: null,
    declaration: null,
  };
}

describe("shadow by-election variant: reproduction of the tested figures", () => {
  // The 26 November 2026 note (Reports repo, PR 901) reports a leave one out
  // backtest over October to November 2026: MAE 7.12 current and 6.44 variant,
  // 21 and 23 winners of 37. The upper bound is fixed at 25 November so that
  // results arriving later cannot move the reproduction.
  it.skipIf(!existsSync(HISTORY))("matches the note within rounding", async () => {
    const corpus = await loadCorpus();
    const current = backtestLoo(corpus, { from: "2026-10-01", to: "2026-11-25", variant: false });
    const variant = backtestLoo(corpus, { from: "2026-10-01", to: "2026-11-25", variant: true });
    expect(current.n).toBe(37);
    expect(variant.n).toBe(37);
    expect(current.mae.toFixed(2)).toBe("7.12");
    expect(variant.mae.toFixed(2)).toBe("6.44");
    expect(current.called).toBe(21);
    expect(variant.called).toBe(23);
    expect(current.reformBias.toFixed(1)).toBe("4.4");
    expect(variant.reformBias.toFixed(1)).toBe("3.2");
  });
});

describe("shadow by-election variant: inputs", () => {
  it("uses only contests polled strictly before polling day", () => {
    const later = toyContest({ id: "toy.later", date: "2026-12-01", fromReform: 0.3, toReform: 0.01, restore: 0.06 });
    const a = shadowForecastForContest(toyContestFile("x", "2026-11-26"), toyCorpus, { generatedAt: "t" });
    const b = shadowForecastForContest(toyContestFile("x", "2026-11-26"), [...toyCorpus, later], { generatedAt: "t" });
    expect(b).toEqual(a);
    expect(a.inputs.latest_corpus_contest_date < "2026-11-26").toBe(true);
  });

  it("never forecasts a contest whose result or declaration is already in", () => {
    const withResult = { ...toyContestFile("x", "2026-11-26"), result: { shares: {} } };
    const withDecl = { ...toyContestFile("x", "2026-11-26"), declaration: { declared: true } };
    expect(shadowForecastForContest(withResult, toyCorpus, { generatedAt: "t" })).toBeNull();
    expect(shadowForecastForContest(withDecl, toyCorpus, { generatedAt: "t" })).toBeNull();
    expect(shadowForecastForContest(toyContestFile("x", "2026-11-19"), toyCorpus, { generatedAt: "t" })).toBeNull();
  });
});

describe("shadow by-election variant: a written forecast is never overwritten", () => {
  it("addShadowForecast refuses an existing slug", () => {
    const entry = shadowForecastForContest(toyContestFile("x", "2026-11-26"), toyCorpus, { generatedAt: "first" });
    const file = addShadowForecast(emptyShadowFile(), entry);
    expect(() => addShadowForecast(file, { ...entry, generated_at: "second" })).toThrow(/Refusing to overwrite/);
    expect(file.forecasts.x.generated_at).toBe("first");
  });

  it("a second write run leaves earlier forecasts byte for byte, even on a changed corpus", () => {
    const contests = [toyContestFile("x", "2026-11-26")];
    const first = writeNewForecasts(emptyShadowFile(), contests, toyCorpus, "first").file;
    const before = JSON.stringify(first);
    const shifted = toyCorpus.map((c) => ({ ...c, to: { ...c.to, "Reform UK": 0.05 } }));
    const second = writeNewForecasts(first, [...contests, toyContestFile("y", "2026-12-03")], shifted, "second");
    expect(second.kept).toEqual(["x"]);
    expect(second.added).toEqual(["y"]);
    expect(JSON.stringify(second.file.forecasts.x)).toBe(JSON.stringify(first.forecasts.x));
    expect(JSON.stringify(first)).toBe(before);
  });
});

describe("shadow by-election variant: scoring", () => {
  it("scores MAE over parties in the result, winner and Reform UK signed error", () => {
    const s = scoreContest({
      shadowPct: { "Reform UK": 20, Labour: 50, Conservative: 30 },
      publishedPct: { "Reform UK": 40, Labour: 35, Conservative: 25 },
      resultShares: { "Reform UK": 0.2, Labour: 0.5, Conservative: 0.3, SNP: 0 },
    });
    expect(s.parties).toBe(3);
    expect(s.shadow.mae).toBe(0);
    expect(s.shadow.called).toBe(true);
    expect(s.published.called).toBe(false);
    expect(s.published.reform_error).toBeCloseTo(20);
    expect(s.published.mae).toBeCloseTo((20 + 15 + 5) / 3);
  });
});

describe("shadow by-election variant: the committed file", () => {
  const file = path.join(ROOT, SHADOW_FILE);
  it.skipIf(!existsSync(file))("only holds contests from the cut, each written before its result", () => {
    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const [slug, entry] of Object.entries(data.forecasts)) {
      expect(entry.slug).toBe(slug);
      expect(entry.polling_day >= SHADOW_CUT).toBe(true);
      expect(entry.result_in_repo_at_generation).toBe(false);
      expect(entry.inputs.latest_corpus_contest_date < entry.polling_day).toBe(true);
    }
  });
});

describe("shadow by-election variant: kept out of the site", () => {
  it("is not in the published data allowlist", () => {
    const paths = PUBLISHED_DATA.map((f) => f.path);
    expect(paths.some((p) => p.includes("byelection-shadow-variant"))).toBe(false);
  });

  it("is not read by any page, component or site library", () => {
    const walk = (dir) =>
      readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const offenders = walk(path.join(ROOT, "src")).filter((p) =>
      /byelection-shadow-variant/.test(readFileSync(p, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
