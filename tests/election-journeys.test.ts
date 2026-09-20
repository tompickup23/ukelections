import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolvePostcodeDestinations,
  type LookupEntry,
} from "../src/lib/electionLookup";
import {
  buildLocalContestJourneyLinks,
  buildParliamentaryJourneyLinks,
  type LocalContestJourneyRecord,
} from "../src/lib/electionJourneys";

const ROOT = process.cwd();
const ge = JSON.parse(
  readFileSync(path.join(ROOT, "data/predictions/ge-next/constituencies.json"), "utf8"),
);
const seatRecords = Object.values(ge.predictions || {}) as any[];
const contestDir = path.join(ROOT, "data/contests/local-byelections");
const contests = readdirSync(contestDir)
  .filter((file) => file.endsWith(".json") && !file.startsWith("_"))
  .map((file) => JSON.parse(readFileSync(path.join(contestDir, file), "utf8")));
const identity = JSON.parse(
  readFileSync(path.join(ROOT, "data/identity/wards-may-2026.json"), "utf8"),
);

describe("postcode election lookup", () => {
  const holborn = ge.predictions["holborn-and-st-pancras"];
  const constituency: LookupEntry = {
    kind: "constituency",
    name: holborn.name,
    secondary: "Parliamentary constituency",
    href: `/seats/parliament/${holborn.slug}/`,
    code: holborn.pcon24cd,
  };
  const walkleyWard = identity.wards.find((ward: any) => ward.gss_code === "E05010882");
  const ward: LookupEntry = {
    kind: "ward",
    name: walkleyWard.ward_name,
    secondary: `${walkleyWard.council_name} ward`,
    href: `/seats/${walkleyWard.council_slug}/${walkleyWard.ward_slug}/`,
    code: walkleyWard.gss_code,
  };

  it("resolves both parliamentary and ward pages from authoritative GSS codes", () => {
    const matches = resolvePostcodeDestinations(
      {
        parliamentary_constituency: "A display name that is not used as a key",
        admin_ward: "Another display name",
        codes: {
          parliamentary_constituency: holborn.pcon24cd,
          admin_ward: walkleyWard.gss_code,
        },
      },
      { constituencies: [constituency], wards: [ward] },
    );

    expect(matches.map((entry) => entry.href)).toEqual([
      "/seats/parliament/holborn-and-st-pancras/",
      "/seats/sheffield/walkley/",
    ]);
  });

  it("does not silently fall back to a name match when the code is absent or wrong", () => {
    expect(
      resolvePostcodeDestinations(
        {
          parliamentary_constituency: holborn.name,
          admin_ward: walkleyWard.ward_name,
          codes: { parliamentary_constituency: "E14009999", admin_ward: "E05009999" },
        },
        { constituencies: [constituency], wards: [ward] },
      ),
    ).toEqual([]);
  });
});

describe("parliamentary onward journeys", () => {
  it("generates only real internal destinations and never links to itself", () => {
    const slugs = new Set(seatRecords.map((record) => record.slug));
    for (const record of seatRecords) {
      const links = buildParliamentaryJourneyLinks(record, seatRecords);
      expect(links.length).toBeGreaterThanOrEqual(4);
      expect(links.length).toBeLessThanOrEqual(6);
      expect(new Set(links.map((link) => link.href)).size).toBe(links.length);
      expect(links.map((link) => link.href)).not.toContain(`/seats/parliament/${record.slug}/`);
      for (const link of links) {
        if (/^\/seats\/parliament\/[^#]+\/$/.test(link.href)) {
          const slug = link.href.split("/").filter(Boolean).at(-1);
          expect(slugs.has(slug), link.href).toBe(true);
        } else if (link.href.startsWith("/seats/parliament/#region-")) {
          expect(
            existsSync(path.join(ROOT, "src/pages/seats/parliament/index.astro")),
          ).toBe(true);
        } else {
          const page = link.href === "/polling/"
            ? "src/pages/polling/index.astro"
            : link.href === "/forecasts/general-election/"
              ? "src/pages/forecasts/general-election/index.astro"
              : "src/pages/methodology/general-election/index.astro";
          expect(existsSync(path.join(ROOT, page)), link.href).toBe(true);
        }
      }
    }
  });

  it("adds regional close contests only when the current seat is genuinely marginal", () => {
    const marginal = seatRecords.find(
      (record) => typeof record.majority_pct === "number" && Math.abs(record.majority_pct) <= 0.05,
    );
    const safe = seatRecords.find(
      (record) => typeof record.majority_pct === "number" && Math.abs(record.majority_pct) > 0.05,
    );
    expect(buildParliamentaryJourneyLinks(marginal, seatRecords).some(
      (link) => link.trackingId === "seat-to-regional-marginal",
    )).toBe(true);
    expect(buildParliamentaryJourneyLinks(safe, seatRecords).some(
      (link) => link.trackingId === "seat-to-regional-marginal",
    )).toBe(false);
  });
});

describe("local by-election onward journeys", () => {
  const today = "2026-09-20";
  const contestSlugs = new Set(contests.map((contest) => contest.slug));
  const wardHrefs = new Set(
    identity.wards
      .filter((ward: any) => ward.council_slug && ward.ward_slug)
      .map((ward: any) => `/seats/${ward.council_slug}/${ward.ward_slug}/`),
  );

  it("derives valid links from the real corpus without self-links or duplicates", () => {
    for (const contest of contests) {
      const matchingWard = identity.wards.find(
        (ward: any) => ward.gss_code && ward.gss_code === contest.contest.ward_gss,
      );
      const wardHref = matchingWard
        ? `/seats/${matchingWard.council_slug}/${matchingWard.ward_slug}/`
        : null;
      const links = buildLocalContestJourneyLinks(contest, contests, today, wardHref);
      expect(new Set(links.map((link) => link.href)).size).toBe(links.length);
      expect(links.map((link) => link.href)).not.toContain(`/by-elections/local/${contest.slug}/`);
      for (const link of links) {
        if (link.href.startsWith("/by-elections/local/") && link.href !== "/by-elections/local/") {
          expect(contestSlugs.has(link.href.split("/").filter(Boolean).at(-1)), link.href).toBe(true);
        } else if (link.href.startsWith("/seats/")) {
          expect(wardHrefs.has(link.href), link.href).toBe(true);
        } else {
          expect([
            "/by-elections/local/",
            "/methodology/local-by-elections/",
          ]).toContain(link.href);
        }
      }
    }
  });

  it("handles a one-contest corpus with useful index links", () => {
    const only: LocalContestJourneyRecord = {
      slug: "test-council-test-ward-2026-10-01",
      contest: {
        polling_day: "2026-10-01",
        council_slug: "test-council",
        council_name: "Test Council",
        ward_name: "Test Ward",
      },
    };
    expect(buildLocalContestJourneyLinks(only, [only], today)).toEqual([
      expect.objectContaining({ href: "/by-elections/local/" }),
      expect.objectContaining({ href: "/methodology/local-by-elections/" }),
    ]);
  });

  it("deduplicates one contest that qualifies for several relationships", () => {
    const current: LocalContestJourneyRecord = {
      slug: "test-council-first-2026-10-01",
      contest: {
        polling_day: "2026-10-01",
        council_slug: "test-council",
        council_name: "Test Council",
        ward_name: "First",
      },
    };
    const other: LocalContestJourneyRecord = {
      slug: "test-council-second-2026-10-01",
      contest: {
        polling_day: "2026-10-01",
        council_slug: "test-council",
        council_name: "Test Council",
        ward_name: "Second",
      },
    };
    const hrefs = buildLocalContestJourneyLinks(current, [current, other], today).map(
      (link) => link.href,
    );
    expect(hrefs.filter((href) => href === "/by-elections/local/test-council-second-2026-10-01/")).toHaveLength(1);
  });
});

describe("representative templates", () => {
  it("renders crawlable onward journeys on parliamentary and local by-election pages", () => {
    const parliament = readFileSync(
      path.join(ROOT, "src/pages/seats/parliament/[constituency]/index.astro"),
      "utf8",
    );
    const local = readFileSync(
      path.join(ROOT, "src/pages/by-elections/local/[slug].astro"),
      "utf8",
    );
    expect(parliament).toContain("<ExploreNext");
    expect(local).toContain("<ExploreNext");
  });

  it("puts a constituency lookup action before and after the forecast data", () => {
    const forecast = readFileSync(
      path.join(ROOT, "src/pages/forecasts/general-election/index.astro"),
      "utf8",
    );
    expect(forecast.match(/data-journey="ge-[^"]+-to-constituency-lookup"/g)).toHaveLength(2);
    expect(forecast).toContain("Find my constituency");
  });
});
