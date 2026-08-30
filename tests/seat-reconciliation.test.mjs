import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const read = (p) => JSON.parse(readFileSync(resolve(REPO, p), "utf8"));

const control = read("data/results/may-2026/council-control.json");
const registry = read("data/identity/council-seat-counts.json");

const seatSum = (byParty) => Object.values(byParty).reduce((s, v) => s + v, 0);

/**
 * The reconciliation rule the build enforces, lifted out so the test can run
 * it against a fixture built to break it. A check that has never been shown
 * to fail is decoration: the OCD-only build reported nothing wrong while 44
 * councils disagreed with their own chamber size, because nothing compared
 * the two.
 */
function reconcile(council) {
  const sum = seatSum(council.post_may7.by_party);
  const chamber = council.cycle.total_seats;
  const allowedShort =
    (council.may7_wins.undeclared_seats || 0) + (council.may7_wins.vacant_seats || 0);
  if (sum > chamber) return { ok: false, reason: "overflows the chamber" };
  if (sum < chamber - allowedShort) return { ok: false, reason: "leaves unexplained empty seats" };
  return { ok: true };
}

describe("the reconciliation rule can fail", () => {
  it("rejects a composition that overflows its chamber", () => {
    // Calderdale as it shipped: 54 councillors filed into a 51-seat council.
    const broken = {
      cycle: { total_seats: 51 },
      post_may7: { by_party: { lab: 8, ld: 2, green: 7, ref: 34, other: 3 } },
      may7_wins: { undeclared_seats: 0, vacant_seats: 0 },
    };
    expect(seatSum(broken.post_may7.by_party)).toBe(54);
    expect(reconcile(broken).ok).toBe(false);
  });

  it("rejects a composition that leaves seats unexplained", () => {
    // Burnley as it shipped: rounding lost a seat, and nothing noticed
    // because the page rendered percentage bars, which stretch to any total.
    const broken = {
      cycle: { total_seats: 45 },
      post_may7: { by_party: { con: 5, lab: 9, ld: 6, green: 3, ref: 11, other: 10 } },
      may7_wins: { undeclared_seats: 0, vacant_seats: 0 },
    };
    expect(seatSum(broken.post_may7.by_party)).toBe(44);
    expect(reconcile(broken).ok).toBe(false);
  });

  it("accepts a short composition when the missing seats are accounted for", () => {
    // Essex: one poll cancelled on a candidate death, so 77 of 78 are filled
    // and the empty seat has a reason.
    const ok = {
      cycle: { total_seats: 78 },
      post_may7: { by_party: { con: 30, lab: 20, ld: 15, ref: 12 } },
      may7_wins: { undeclared_seats: 0, vacant_seats: 1 },
    };
    expect(seatSum(ok.post_may7.by_party)).toBe(77);
    expect(reconcile(ok).ok).toBe(true);
  });
});

describe("every published council reconciles", () => {
  it("fills its chamber exactly, or explains the gap", () => {
    const failures = control.councils
      .map((c) => ({ slug: c.council_slug, ...reconcile(c) }))
      .filter((r) => !r.ok);
    expect(failures).toEqual([]);
  });

  it("never computes a majority threshold from an empty chamber", () => {
    for (const c of control.councils) {
      expect(c.cycle.total_seats).toBeGreaterThan(0);
      expect(c.control.threshold).toBe(Math.floor(c.cycle.total_seats / 2) + 1);
    }
  });
});

describe("control verdicts are decidable", () => {
  it("withholds control wherever the undeclared seats could still change it", () => {
    for (const c of control.councils) {
      const undeclared = c.may7_wins.undeclared_seats || 0;
      if (!undeclared) continue;
      const leader = Math.max(...Object.values(c.post_may7.by_party));
      if (leader < c.control.threshold && leader + undeclared >= c.control.threshold) {
        expect(c.control.status).toBe("undetermined");
        expect(c.control.controlling_party).toBeNull();
        expect(c.control.plurality_party).toBeNull();
      }
    }
  });

  it("never names a largest party the outstanding seats could overturn", () => {
    for (const c of control.councils) {
      if (!c.control.plurality_party) continue;
      const undeclared = c.may7_wins.undeclared_seats || 0;
      expect(c.control.plurality_seats).toBeGreaterThanOrEqual(
        (c.control.second_party_seats || 0) + undeclared,
      );
    }
  });
});

describe("the seat registry resolves every council", () => {
  it("leaves nothing needing manual review", () => {
    const review = Object.entries(registry.councils).filter(([, c]) => c.needs_review);
    expect(review.map(([s]) => s)).toEqual([]);
  });

  it("agrees with AI DOGE's roster within one seat wherever both exist", () => {
    // The roster is live occupancy: a resignation reads one short, a
    // co-option one long. A gap wider than that means the two sources are
    // counting different things and the registry rule needs revisiting.
    const wide = [];
    for (const [slug, c] of Object.entries(registry.councils)) {
      const options = c.sources.aidoge_roster_options || [];
      if (!options.length || c.statutory_seats == null) continue;
      const closest = Math.min(...options.map((r) => Math.abs(r - c.statutory_seats)));
      if (closest > 1) {
        wide.push(`${slug}: statutory ${c.statutory_seats}, roster ${options.join(" or ")}`);
      }
    }
    expect(wide).toEqual([]);
  });
});
