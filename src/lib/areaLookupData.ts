import lookupCodes from "../../data/identity/parliament-lookup-codes.json";
import { loadGePredictions, loadIdentity } from "./predictions";
import type { DistrictEntry, LookupEntry } from "./electionLookup";
import { allCouncilRecords, councilNextElection } from "./nextElections";

export function loadAreaLookup() {
  const identity = loadIdentity();
  const ge = loadGePredictions();
  type CouncilEntry = LookupEntry & { council_slug: string; tier: string };
  const wardIndex: LookupEntry[] = [];
  const councils = new Map<string, CouncilEntry>();
  for (const w of identity.wards) {
    if (w.tier !== "local" && w.tier !== "mayor") continue;
    if (!w.ward_slug) continue;
    wardIndex.push({
      kind: "ward",
      name: w.ward_name || w.ward_slug,
      secondary: `${w.council_name} ward`,
      href: `/seats/${w.council_slug}/${w.ward_slug}/`,
      code: w.gss_code,
    });
    if (!councils.has(w.council_slug)) {
      councils.set(w.council_slug, {
        kind: "council",
        name: w.council_name,
        secondary: w.tier === "mayor" ? "Mayoralty" : "Local council",
        council_slug: w.council_slug,
        tier: w.tier,
        href: `/seats/${w.council_slug}/`,
      });
    }
  }
  // Councils with no 7 May 2026 contest have a placeholder page; list them so a
  // name search or a postcode in (say) Ribble Valley says what happens next.
  const districtIndex: DistrictEntry[] = [];
  for (const record of allCouncilRecords()) {
    const next = councilNextElection(record.slug);
    const covered = councils.has(record.slug);
    if (record.lad24cd) {
      districtIndex.push({
        code: record.lad24cd,
        name: record.name,
        href: `/seats/${record.slug}/`,
        covered,
        status: next.status,
        next_label: next.label,
      });
    }
    if (!covered && record.lad24cd) {
      councils.set(record.slug, {
        kind: "council",
        name: record.name,
        secondary: "Council · no forecast yet",
        council_slug: record.slug,
        tier: "none",
        href: `/seats/${record.slug}/`,
      });
    }
  }
  const councilIndex = [...councils.values()].sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  // Missing boundary codes prevent postcode resolution, not discovery by name.
  const constituencyIndex: LookupEntry[] = Object.values(ge.predictions || {})
    .filter((record: any) => Boolean(record?.prediction && record?.slug))
    .map((record: any) => ({
      kind: "constituency" as const,
      name: record.name,
      secondary: "Parliamentary constituency",
      href: `/seats/parliament/${record.slug}/`,
      code: lookupCodes.entries[record.slug as keyof typeof lookupCodes.entries]?.code ?? record.pcon24cd,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));

  return { constituencies: constituencyIndex, wards: wardIndex, councils: councilIndex, districts: districtIndex };
}
