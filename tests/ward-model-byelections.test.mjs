import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  OUTPUT_FILE,
  SOURCE_FILE,
  buildExport,
  recordProblems,
  serialise,
} from "../scripts/lib/ward-model-export.mjs";
import {
  LEAD_BYELECTION_FORECAST,
  captureLabel,
  forecastsDisagreeSentence,
  laneMaePp,
  resultComparison,
  wardModelFor,
} from "../src/lib/wardModelForecasts.ts";

const ROOT = process.cwd();
const live = JSON.parse(readFileSync(path.join(ROOT, SOURCE_FILE), "utf8"));
const exported = JSON.parse(readFileSync(path.join(ROOT, OUTPUT_FILE), "utf8"));
const contestDir = path.join(ROOT, "data/contests/local-byelections");
const contests = readdirSync(contestDir)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => JSON.parse(readFileSync(path.join(contestDir, f), "utf8")));
const DASHES = /—|–| - /;

const firstForecast = () => {
  const [id, r] = Object.entries(live.records).find(([, r]) => r.status === "forecast");
  return { id, r: structuredClone(r) };
};

describe("ward model export", () => {
  it("is up to date with the runner's file, and a rerun changes no byte", () => {
    const text = serialise(buildExport(live));
    expect(text).toBe(readFileSync(path.join(ROOT, OUTPUT_FILE), "utf8"));
    expect(serialise(buildExport(live))).toBe(text);
  });

  it("carries no build-clock time", () => {
    const text = readFileSync(path.join(ROOT, OUTPUT_FILE), "utf8");
    expect(text).not.toMatch(/"(generated_at|exported_at|built_at)"/);
  });

  it("refuses a record captured after polls opened, and writes nothing", () => {
    const { id, r } = firstForecast();
    r.captured_at = `${r.polling_day}T07:00:00Z`;
    expect(recordProblems(id, r).join(" ")).toMatch(/after polls opened/);
    const bad = structuredClone(live);
    bad.records[id] = r;
    expect(() => buildExport(bad)).toThrow(/Refusing.*after polls opened/s);
  });

  it("refuses a capture after 07:00 UK time in summer, when that is 06:00 UTC", () => {
    const { id, r } = firstForecast();
    r.polling_day = "2027-06-10";
    r.polls_open_at = "2027-06-10T06:00:00Z";
    r.captured_at = "2027-06-10T06:30:00Z";
    expect(recordProblems(id, r).join(" ")).toMatch(/after polls opened/);
    r.captured_at = "2027-06-10T05:59:00Z";
    expect(recordProblems(id, r)).toEqual([]);
  });

  it("refuses a capture with no zone, or from uncommitted code", () => {
    const { id, r } = firstForecast();
    expect(recordProblems(id, { ...r, captured_at: "2026-11-27 23:52" }).join(" ")).toMatch(/zone/);
    expect(recordProblems(id, { ...r, code_dirty: true }).join(" ")).toMatch(/code_dirty/);
  });

  it("the script exits non-zero on a late capture and leaves the output alone", () => {
    const { id, r } = firstForecast();
    r.captured_at = `${r.polling_day}T09:00:00Z`;
    const bad = structuredClone(live);
    bad.records[id] = r;
    const dir = path.join(ROOT, "node_modules/.cache");
    const from = path.join(dir, `ward-model-late-${process.pid}.json`);
    const out = path.join(dir, `ward-model-out-${process.pid}.json`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(from, JSON.stringify(bad));
    let code = 0;
    try {
      execFileSync("node", ["scripts/export-ward-model-byelections.mjs", `--from=${from}`, `--out=${out}`], { stdio: "pipe" });
    } catch (err) {
      code = err.status;
    }
    expect(code).toBe(1);
    expect(() => readFileSync(out)).toThrow();
  });

  it("keeps only forecast records, keyed by contest slug, each with its version, commit, capture and inputs", () => {
    const n = Object.values(live.records).filter((r) => r.status === "forecast").length;
    expect(Object.keys(exported.forecasts)).toHaveLength(n);
    for (const [slug, f] of Object.entries(exported.forecasts)) {
      expect(f.contest).toBe(slug);
      expect(f.model_version).toBe("ward-model-2026-11/C2");
      expect(f.code_commit).toMatch(/^[0-9a-f]{40}$/);
      expect(f.captured_at).toMatch(/Z$/);
      expect(f.inputs.polls_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(f.shares)).toHaveLength(6);
    }
    expect(DASHES.test(JSON.stringify(exported))).toBe(false);
  });
});

describe("ward model on the contest pages", () => {
  it("leads with this site's forecast until the switch is flipped", () => {
    expect(LEAD_BYELECTION_FORECAST).toBe("site");
  });

  it("finds a record only for the contests the runner forecast", () => {
    const withRecord = contests.filter((d) => wardModelFor(d.slug));
    expect(withRecord.length).toBe(Object.keys(exported.forecasts).filter((s) => contests.some((d) => d.slug === s)).length);
    const without = contests.find((d) => !wardModelFor(d.slug));
    expect(without).toBeTruthy();
    expect(forecastsDisagreeSentence(without.forecast, null)).toBeNull();
    expect(resultComparison(without, null)).toBeNull();
  });

  it("says nothing when both forecasts name the same lane, and one neutral sentence when they differ", () => {
    const ward = { called_leader: "Liberal Democrats" };
    expect(forecastsDisagreeSentence({ winner: "Liberal Democrats" }, ward)).toBeNull();
    // A site call for a smaller party compares with the ward model's Others lane.
    expect(forecastsDisagreeSentence({ winner: "Restore Britain" }, { called_leader: "Others" })).toBeNull();
    const s = forecastsDisagreeSentence({ winner: "Reform UK" }, ward);
    expect(s).toBe(
      "The two forecasts name different leaders: this site's projection has Reform UK ahead, and the research ward model has the Liberal Democrats ahead on vote share.",
    );
    const close = forecastsDisagreeSentence({ winner: "Labour", too_close_to_call: true }, ward);
    expect(close).toMatch(/too close, with Labour strongest/);
    for (const t of [s, close]) {
      expect(DASHES.test(t)).toBe(false);
      expect(t).not.toMatch(/\b(likely to win|will win|should|surge|collapse)\b/i);
    }
  });

  it("scores both forecasts against a result in the scoreboard's six lanes", () => {
    const d = {
      result: { declared: true, shares: { "Reform UK": 0.4, Labour: 0.3, "Restore Britain": 0.1, Conservative: 0.2 } },
      forecast: { winner: "Labour", central: { "Reform UK": 0.3, Labour: 0.4, Conservative: 0.2, "Restore Britain": 0.1 } },
    };
    const ward = { called_leader: "Reform UK", shares: { "Reform UK": 0.45, Labour: 0.25, Conservative: 0.2, "Liberal Democrats": 0, "Green Party": 0, Others: 0.1 } };
    const cmp = resultComparison(d, ward);
    expect(cmp.leader).toBe("Reform UK");
    expect(cmp.rows.map((r) => r.lane)).toEqual(["Reform UK", "Labour", "Conservative", "Others"]);
    expect(cmp.ward.right).toBe(true);
    expect(cmp.site.right).toBe(false);
    expect(cmp.ward.mae_pp).toBeCloseTo(2.5, 6);
    expect(cmp.site.mae_pp).toBeCloseTo(5, 6);
    expect(laneMaePp({ Labour: 0.5 }, { Labour: 0.4, Others: 0.1 })).toBeCloseTo(10, 6);
  });

  it("labels the capture by the runner's own clock, in UTC", () => {
    expect(captureLabel("2026-11-27T23:52:05Z")).toBe("27 November 2026, 23:52 UTC");
  });
});
