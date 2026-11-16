import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { GET } from "../src/pages/search-index.json";
import { loadAreaLookup } from "../src/lib/areaLookupData";
import { getPublicSearchEntries } from "../src/lib/site";
import { resolvePostcodeDestinations, type LookupIndex } from "../src/lib/electionLookup";

// The real lookup uses the gitignored historical corpus, available in local builds.
it.skipIf(!existsSync("data/history/dc-historic-results.json"))("serves the complete postcode lookup while retaining existing public search entries", async () => {
  const response = await GET({} as Parameters<typeof GET>[0]);
  const entries = await response.json();
  for (const existing of getPublicSearchEntries()) expect(entries.find((entry: any) => entry.href === existing.href)).toMatchObject(existing);
  const index: LookupIndex = {
    constituencies: entries.flatMap((e: any) => e.lookup?.kind === "constituency" ? [e.lookup] : []),
    wards: entries.flatMap((e: any) => e.lookup?.kind === "ward" ? [e.lookup] : []),
    councils: entries.flatMap((e: any) => e.lookup?.kind === "council" ? [e.lookup] : []),
    districts: entries.flatMap((e: any) => e.district ? [e.district] : []),
  };
  const expected = loadAreaLookup();
  for (const key of ["constituencies", "wards", "councils", "districts"] as const) {
    expect(index[key]?.length).toBe(expected[key].length);
    const byHref = (a: { href: string }, b: { href: string }) => a.href.localeCompare(b.href);
    expect([...(index[key] ?? [])].sort(byHref)).toEqual([...expected[key]].sort(byHref));
  }
  const constituency = expected.constituencies.find(entry => entry.code)!;
  const ward = expected.wards.find(entry => entry.code)!;
  expect(resolvePostcodeDestinations({ codes: { parliamentary_constituency: constituency.code, admin_ward: ward.code } }, index)).toEqual([constituency, ward]);
});
