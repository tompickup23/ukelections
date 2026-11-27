import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyCouncilResults } from "../scripts/apply-council-results.mjs";

// The 19 November 2026 round was part declared on 20 November: five councils
// had published and four had not. The script used to throw on the first
// pending contest, so it could not be used until every council had declared.
// It now applies the declared ones and lists the rest. The tests run against
// a copy of the contest folder, so the committed files are never rewritten;
// the sidecar and the other inputs are only read.
//
// On 26 November Conwy's Bryn declaration was read by hand, so it now applies.
// Risca East, Portchester Wicor and Letchworth North carry
// hand_verified_two_sources rows (press reports of declarations this script
// may not fetch); it leaves those to the finaliser, so they stay pending here.

const DIR = "data/contests/local-byelections";
const DAY = "2026-11-19";
const PENDING = [
  "local.caerphilly.risca-east.by.2026-11-19",
  "local.fareham.portchester-wicor.by.2026-11-19",
  "local.hertfordshire.letchworth-north.by.2026-11-19",
];
const present = existsSync(DIR) && readdirSync(DIR).some((f) => f.endsWith(`${DAY}.json`));

function copyRound(filter = () => true) {
  const dir = mkdtempSync(path.join(tmpdir(), "apply-council-results-"));
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(`${DAY}.json`) || f === "_meta.json")) {
    if (file === "_meta.json" || filter(JSON.parse(readFileSync(path.join(DIR, file), "utf8")))) {
      copyFileSync(path.join(DIR, file), path.join(dir, file));
    }
  }
  return dir;
}

describe.skipIf(!present)("apply-council-results on a part-declared round", () => {
  it("applies the declared contests, lists the pending ones and does not throw", () => {
    const dir = copyRound();
    try {
      const lines = [];
      const { applied, pending } = applyCouncilResults(DAY, { directory: dir, log: (line) => lines.push(line) });
      expect(applied).toHaveLength(6);
      expect(pending.map((item) => item.id).sort()).toEqual(PENDING);
      for (const id of PENDING) expect(lines.some((line) => line.includes(`pending ${id}`))).toBe(true);
      for (const file of readdirSync(dir).filter((f) => f.endsWith(`${DAY}.json`))) {
        const doc = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
        const original = JSON.parse(readFileSync(path.join(DIR, file), "utf8"));
        if (PENDING.includes(doc.contest.ballot_paper_id)) expect(doc).toEqual(original);
        else expect(doc.status).toBe("concluded");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing when no council has declared yet", () => {
    const dir = copyRound((doc) => PENDING.includes(doc.contest.ballot_paper_id));
    try {
      const before = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
      const { applied, pending } = applyCouncilResults(DAY, { directory: dir, log: () => {} });
      expect(applied).toEqual([]);
      expect(pending).toHaveLength(PENDING.length);
      for (const [file, text] of Object.entries(before)) expect(readFileSync(path.join(dir, file), "utf8")).toBe(text);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still refuses a date with no contests", () => {
    const dir = copyRound(() => false);
    try {
      expect(() => applyCouncilResults(DAY, { directory: dir, log: () => {} })).toThrow("No contests for that date");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
