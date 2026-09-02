import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data/predictions/by-elections");
const FILE = path.join(DIR, "holborn-and-st-pancras.json");
const contest = JSON.parse(readFileSync(FILE, "utf8"));
const signal = contest.inputs.camden_signal_2026_05_07;

describe("Holborn and St Pancras contest file", () => {
  it("targets the correct contest", () => {
    expect(contest.contest.constituency_slug).toBe("holborn-and-st-pancras");
    expect(contest.contest.pcon24cd).toBe("E14001290");
    expect(contest.contest.trigger.departing_mp).toBe("Keir Starmer");
    expect(contest.contest.trigger.announced_at).toBe("2026-09-01");
  });

  // The date-less filename is the mechanism that keeps a contest with no
  // polling day off the homepage countdown, so the two must agree. If someone
  // sets a polling day they must also rename the file, and vice versa.
  it("carries no ISO date in its filename while it has no polling day", () => {
    expect(contest.contest.polling_day).toBeNull();
    expect(path.basename(FILE)).toBe("holborn-and-st-pancras.json");
    expect(path.basename(FILE)).not.toMatch(/-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("keeps every dated sibling parseable by the same slug rule", () => {
    const slugOf = (f) => f.replace(/(?:-\d{4}-\d{2}-\d{2})?\.json$/, "");
    for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".analysis.json"))) {
      expect(slugOf(f)).not.toMatch(/\.json$/);
      expect(slugOf(f)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  // The whole point of this page. A signal is not a forecast, and the moment a
  // winner appears in `forecast.winner` the by-elections index starts printing
  // it as a pre-election call and grading it.
  it("publishes a signal, never a central forecast", () => {
    expect(contest.status).toBe("upcoming");
    expect(contest.forecast.classification).toBe("signal-only");
    expect(contest.forecast.winner).toBeNull();
    expect(contest.forecast.runner_up).toBeNull();
    expect(contest.forecast.central_shares).toBeNull();
  });

  it("aggregates exactly the ten whole wards inside the seat", () => {
    expect(signal.wards_in_seat).toBe(10);
    expect(signal.wards).toHaveLength(10);
    expect(signal.wards.map((w) => w.ward)).not.toContain("Primrose Hill");
    const sum = Object.values(signal.shares).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.999);
    expect(sum).toBeLessThan(1.001);
  });

  // The canary. The published borough result is an external fact this file does
  // not control; reproducing it is the evidence that the ward feed underneath
  // the seat-level number is sound. If this fails, the ward data has drifted and
  // nothing else on the page can be trusted either.
  it("reproduces the published borough-wide result from the same ward feed", () => {
    for (const [party, published] of Object.entries(signal.validation.published)) {
      expect(signal.validation.computed[party]).toBeCloseTo(published, 3);
    }
  });

  // Third place flips between Reform and the Conservatives depending on the
  // part-ward, so the caveat has to travel with the number.
  it("carries the part-ward bound and the method bound", () => {
    expect(signal.boundary_note).toMatch(/Primrose Hill/);
    const ids = signal.sensitivities.map((s) => s.id);
    expect(ids).toContain("with_whole_primrose_hill");
    expect(ids).toContain("all_candidates_summed");

    const tenWard = signal.shares;
    const withPart = signal.sensitivities.find((s) => s.id === "with_whole_primrose_hill").shares;
    // Labour leads the Greens on every basis: that is the finding the page rests on.
    expect(tenWard["Labour"]).toBeGreaterThan(tenWard["Green Party"]);
    expect(withPart["Labour"]).toBeGreaterThan(withPart["Green Party"]);
    // Third place is genuinely not settled, which is why the page never asserts it.
    expect(tenWard["Reform UK"]).toBeGreaterThan(tenWard["Conservative"]);
    expect(withPart["Conservative"]).toBeGreaterThan(withPart["Reform UK"]);
  });

  it("says nobody has been selected, because nobody has", () => {
    expect(contest.field.status).toBe("not_locked");
    for (const entry of [...contest.field.declared, ...contest.field.floated]) {
      if (entry.party === "Green Party" || entry.party === "Restore Britain") {
        expect(entry.candidate).toBeNull();
      }
    }
  });

  it("sources every claim with a URL", () => {
    expect(contest.sources.length).toBeGreaterThanOrEqual(5);
    for (const s of contest.sources) {
      expect(s.label).toBeTruthy();
      expect(s.url).toMatch(/^https:\/\//);
    }
  });

  // House style: no em-dashes on any user-visible surface, this JSON included.
  it("carries no em-dashes or dash entities", () => {
    const raw = readFileSync(FILE, "utf8");
    expect(raw).not.toMatch(/—|–/);
    expect(raw).not.toMatch(/&mdash;|&ndash;|&#8212;|&#8211;|&#x2014;|&#x2013;/i);
  });
});
