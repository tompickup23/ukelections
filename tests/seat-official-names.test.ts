import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadGePredictions, loadGeBacktest, loadGeIdentity } from "../src/lib/predictions";

const lookup = JSON.parse(readFileSync("data/identity/parliament-lookup-codes.json", "utf8")).entries as Record<string, { official_name: string }>;

describe("seat names", () => {
  it("uses the official name for every seat, including those without an ONS code", () => {
    const preds = loadGePredictions().predictions as Record<string, { name: string }>;
    const wrong = Object.entries(preds).filter(([slug, r]) => lookup[slug] && r.name !== lookup[slug].official_name);
    expect(wrong.map(([slug, r]) => `${slug}: ${r.name}`)).toEqual([]);
    expect(preds["na-h-eileanan-an-iar"].name).toBe("Na h-Eileanan an Iar");
    expect(preds["ynys-mon"].name).toBe("Ynys Môn");
    expect(preds["argyll-bute-and-south-lochaber"].name).toBe("Argyll, Bute and South Lochaber");
  });

  it("applies the same names to the backtest rows and the identity file", () => {
    for (const row of loadGeBacktest().rows as { slug: string; name: string }[]) {
      if (lookup[row.slug]) expect(row.name).toBe(lookup[row.slug].official_name);
    }
    for (const row of loadGeIdentity().pcons as { slug: string; name: string }[]) {
      expect(row.name).toBe(lookup[row.slug].official_name);
    }
  });

  it("keeps the committed identity file correct on its own, so the nightly model writes the right names", () => {
    const raw = JSON.parse(readFileSync("data/identity/pcons-ge-next.json", "utf8")).pcons as { slug: string; name: string }[];
    expect(raw.filter((r) => r.name !== lookup[r.slug]?.official_name)).toEqual([]);
  });
});
