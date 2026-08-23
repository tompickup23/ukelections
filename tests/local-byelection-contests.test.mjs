import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PARTIES } from "../scripts/lib/local-byelection-model.mjs";

// Guards the generated contest files that drive /by-elections/local/.
//
// The directory is rebuilt by scripts/build-local-byelections.mjs and is not
// present on a fresh clone before the first data build, so the suite skips
// rather than failing CI on a missing corpus. When the files ARE there every
// assertion below is hard: a published projection that contradicts its own
// field, or a hit rate above 100%, is the kind of thing that only ever gets
// caught by asserting the bound.

const DIR = path.join(process.cwd(), "data/contests/local-byelections");
const present = existsSync(DIR);
const files = present ? readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_")) : [];
const contests = files.map((f) => ({ file: f, doc: JSON.parse(readFileSync(path.join(DIR, f), "utf8")) }));
const metaPath = path.join(DIR, "_meta.json");
const meta = present && existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : null;

describe.skipIf(!present)("local by-election contest files", () => {
  it("has at least one contest and a meta file", () => {
    expect(contests.length).toBeGreaterThan(0);
    expect(meta).not.toBeNull();
  });

  it("names each file after the slug inside it", () => {
    for (const { file, doc } of contests) {
      expect(`${doc.slug}.json`).toBe(file);
      expect(doc.contest.ballot_paper_id).toMatch(/^local\..+\.by\.\d{4}-\d{2}-\d{2}$/);
      expect(doc.contest.polling_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.contest.ballot_paper_id.endsWith(doc.contest.polling_day)).toBe(true);
    }
  });

  it("either carries a projection or says why not, never neither and never both", () => {
    for (const { file, doc } of contests) {
      const hasForecast = Boolean(doc.forecast);
      const hasReason = Array.isArray(doc.no_forecast_reason) && doc.no_forecast_reason.length > 0;
      expect(hasForecast, `${file}: forecast and reason must be mutually exclusive`).toBe(!hasReason);
    }
  });

  it("never projects a share for a party that is not on the ballot", () => {
    // The single assertion most likely to catch a real regression: the whole
    // point of using nomination papers is that a party not standing scores
    // nothing, and a field/central mismatch would silently break that.
    for (const { file, doc } of contests) {
      if (!doc.forecast) continue;
      const field = new Set(doc.field.parties);
      for (const party of PARTIES) {
        if (field.has(party)) continue;
        expect(doc.forecast.central[party] ?? 0, `${file}: ${party} is not standing`).toBe(0);
      }
    }
  });

  it("keeps every projection a valid distribution", () => {
    for (const { file, doc } of contests) {
      if (!doc.forecast) continue;
      const total = PARTIES.reduce((a, p) => a + (doc.forecast.central[p] || 0), 0);
      expect(total, `${file}: central shares must sum to 1`).toBeCloseTo(1, 6);
      const probs = Object.values(doc.forecast.win_probability || {});
      expect(probs.reduce((a, b) => a + b, 0), `${file}: win probabilities must sum to 1`).toBeCloseTo(1, 6);
      for (const p of probs) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      expect(doc.forecast.leader_probability).toBeLessThanOrEqual(1);
      expect(doc.forecast.too_close_to_call).toBe(doc.forecast.leader_probability < 0.55);
    }
  });

  it("only grades a contest that had both a projection and a result", () => {
    for (const { file, doc } of contests) {
      if (!doc.result?.grading) continue;
      expect(doc.forecast, `${file}: graded without a forecast`).toBeTruthy();
      expect(doc.result.declared).toBe(true);
      expect(doc.result.grading.call_correct).toBe(doc.result.grading.projected_winner === doc.result.winner_party);
      expect(doc.result.grading.mae_pp).toBeGreaterThanOrEqual(0);
      expect(doc.result.grading.mae_pp).toBeLessThanOrEqual(100);
    }
  });

  it("never claims a declared result without a full set of vote counts", () => {
    for (const { file, doc } of contests) {
      if (!doc.result?.declared) continue;
      for (const c of doc.field.candidates) {
        expect(typeof c.votes, `${file}: ${c.name} has no vote count`).toBe("number");
      }
      expect(doc.result.total_votes).toBeGreaterThan(0);
    }
  });

  it("never uses a baseline the boundary review invalidated", () => {
    for (const { file, doc } of contests) {
      if (!doc.forecast) continue;
      expect(doc.contest.boundary_changed_since_prior, `${file}: projected across a boundary change`).toBe(false);
      expect(doc.prior_result?.usable_as_baseline).toBe(true);
      expect(doc.forecast.baseline.election_date).toBe(doc.prior_result.election_date);
    }
  });

  it("never projects a Scottish STV contest", () => {
    for (const { file, doc } of contests) {
      if (doc.contest.voting_system !== "STV") continue;
      expect(doc.forecast, `${file}: STV contests have no full per-candidate feed`).toBeNull();
    }
  });
});

describe.skipIf(!present)("freshness", () => {
  // These pages are the input to scheduled social posts, so the failure that
  // matters is not a wrong number, it is a stale one: a contest that polled on
  // Thursday still reading "Upcoming" on Friday because nothing regenerated.
  // scripts/build-local-byelections.mjs now runs as phase 7f of the nightly
  // pipeline; this is the alarm for when that stops happening.
  const today = new Date().toISOString().slice(0, 10);
  const daysOld = (iso) => Math.round((Date.parse(today) - Date.parse(iso.slice(0, 10))) / 86400000);

  it("was regenerated recently enough to be trusted", () => {
    const age = daysOld(meta.generated_at);
    expect(age, `contest data is ${age} days old. Run npm run build:local-byelections`).toBeLessThan(14);
  });

  it("does not still call a contest upcoming after it has polled", () => {
    const stale = contests.filter(
      ({ doc }) => doc.status === "upcoming" && daysOld(doc.contest.polling_day) > 3,
    );
    expect(
      stale.map((s) => s.file),
      "these polled more than three days ago and the data still says upcoming",
    ).toEqual([]);
  });

  it("keeps each contest's status consistent with its own contents", () => {
    for (const { file, doc } of contests) {
      if (doc.result?.declared) {
        expect(doc.status, `${file}`).toBe("concluded");
      } else if (doc.contest.polling_day > meta.generated_at.slice(0, 10)) {
        expect(doc.status, `${file}`).toBe("upcoming");
      }
    }
  });

  it("carries a swing corpus that reaches the most recent polling round", () => {
    // The corpus used to lag the results the pages were already displaying,
    // because it came from an archive rebuilt on a different schedule.
    const newestResult = contests
      .filter(({ doc }) => doc.result?.declared)
      .map(({ doc }) => doc.contest.polling_day)
      .sort()
      .at(-1);
    if (!newestResult) return;
    expect(meta.corpus_newest >= newestResult, `corpus stops at ${meta.corpus_newest}, results reach ${newestResult}`).toBe(true);
  });
});

describe.skipIf(!present || !meta)("the published back-test", () => {
  it("reports rates that are possible", () => {
    // A rate above 100% has caught a denominator bug on this estate before.
    for (const key of ["winner_called_pct"]) {
      expect(meta.backtest[key]).toBeGreaterThanOrEqual(0);
      expect(meta.backtest[key]).toBeLessThanOrEqual(1);
    }
    expect(meta.backtest.winner_called).toBeLessThanOrEqual(meta.backtest.n);
    expect(meta.backtest.recent.winner_called).toBeLessThanOrEqual(meta.backtest.recent.n);
    expect(meta.backtest.recent.confident_called).toBeLessThanOrEqual(meta.backtest.recent.confident_n);
    expect(meta.backtest.recent.confident_n).toBeLessThanOrEqual(meta.backtest.recent.n);
    expect(meta.backtest.recent.n).toBeLessThanOrEqual(meta.backtest.n);
  });

  it("measures the recent regime on a real sample, which is the number the pages quote", () => {
    expect(meta.backtest.recent_since).toBe("2025-05-01");
    expect(meta.backtest.recent.n).toBeGreaterThan(50);
    expect(meta.backtest.recent.mae_pp).toBeGreaterThan(0);
    expect(meta.backtest.recent.mae_pp).toBeLessThan(50);
  });

  it("publishes a calibration table whose observed rates are rates", () => {
    expect(Array.isArray(meta.calibration_table)).toBe(true);
    for (const b of meta.calibration_table) {
      expect(b.observed).toBeGreaterThanOrEqual(0);
      expect(b.observed).toBeLessThanOrEqual(1);
      expect(b.mean_stated).toBeGreaterThanOrEqual(b.from);
      expect(b.mean_stated).toBeLessThanOrEqual(b.to);
      expect(b.n).toBeGreaterThan(0);
    }
  });

  it("counts the same contests the directory holds", () => {
    expect(meta.contests).toBe(contests.length);
    expect(meta.forecast_count).toBe(contests.filter((c) => c.doc.forecast).length);
  });
});
