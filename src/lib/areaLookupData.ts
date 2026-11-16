import lookupCodes from "../../data/identity/parliament-lookup-codes.json";
import { loadGePredictions, loadIdentity } from "./predictions";
import type { DistrictEntry, LookupEntry, NationalRow, UpcomingContest } from "./electionLookup";
import { allCouncilRecords, CALENDAR, councilNextElection } from "./nextElections";
import { dayLabel } from "./voterJourney";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

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

// "Is there an election where I live?": upcoming council by-elections by ward
// code, each council's next dated election, and the sourced national calendar.
export function loadAreaAnswerData(buildDay = new Date().toISOString().slice(0, 10)) {
  const contestDir = path.join(process.cwd(), "data/contests/local-byelections");
  const byElections: UpcomingContest[] = existsSync(contestDir)
    ? readdirSync(contestDir)
        .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
        .map((f) => JSON.parse(readFileSync(path.join(contestDir, f), "utf8")))
        .filter((d) => d.contest?.ward_gss && d.contest?.polling_day >= buildDay && !d.result?.declared)
        .map((d) => ({
          ward_code: d.contest.ward_gss,
          ward: d.contest.ward_name,
          council: d.contest.council_name,
          date_iso: d.contest.polling_day,
          date_label: dayLabel(d.contest.polling_day),
          href: `/by-elections/local/${d.slug}/`,
        }))
    : [];
  const districtDates: Record<string, string | null> = {};
  for (const record of allCouncilRecords()) {
    if (record.lad24cd) districtDates[record.lad24cd] = councilNextElection(record.slug).date_iso;
  }
  const national: Record<string, NationalRow> = {};
  for (const row of CALENDAR) {
    if (["general-election", "senedd", "holyrood", "ni-assembly", "london-2028"].includes(row.id)) {
      national[row.id] = { body: row.body, date_iso: row.date_iso, date_label: row.date_label, date_kind: row.date_kind, href: row.href };
    }
  }
  return { byElections, districtDates, national };
}
