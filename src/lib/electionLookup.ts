export type LookupKind = "constituency" | "ward" | "council";

export interface LookupEntry {
  kind: LookupKind;
  name: string;
  secondary: string;
  href: string;
  code?: string | null;
}

export interface LookupIndex {
  constituencies: LookupEntry[];
  wards: LookupEntry[];
  councils: LookupEntry[];
  districts?: DistrictEntry[];
}

/** A principal council keyed by its ONS district code, covered by the site or not. */
export interface DistrictEntry {
  code: string;
  name: string;
  href: string;
  covered: boolean;
  /** "scheduled" (date verified), "abolished", or "unknown". */
  status: string;
  next_label: string;
}

export interface PostcodeResult {
  parliamentary_constituency?: string | null;
  admin_ward?: string | null;
  admin_district?: string | null;
  codes?: {
    parliamentary_constituency?: string | null;
    admin_ward?: string | null;
    admin_district?: string | null;
  } | null;
}

const cleanCode = (value: string | null | undefined) =>
  String(value || "").trim().toUpperCase();

/**
 * Resolve a Postcodes.io response only through the ONS/GSS identifiers shared
 * with the project corpus. Names are useful display labels, but they are not a
 * routing key: boundary and punctuation changes make even exact name matching
 * too fragile for an automatic redirect.
 */
export function resolvePostcodeDestinations(
  result: PostcodeResult,
  index: Pick<LookupIndex, "constituencies" | "wards">,
): LookupEntry[] {
  const pconCode = cleanCode(result.codes?.parliamentary_constituency);
  const wardCode = cleanCode(result.codes?.admin_ward);
  const matches: LookupEntry[] = [];

  if (pconCode) {
    const constituency = index.constituencies.find(
      (entry) => cleanCode(entry.code) === pconCode,
    );
    if (constituency) matches.push(constituency);
  }

  if (wardCode) {
    const ward = index.wards.find((entry) => cleanCode(entry.code) === wardCode);
    if (ward) matches.push(ward);
  }

  return matches.filter(
    (entry, position, all) =>
      all.findIndex((candidate) => candidate.href === entry.href) === position,
  );
}

/**
 * What the voter's council is doing next, from the postcode's district code.
 * Without this a postcode in a council we do not cover returned only the
 * constituency, with no word on the council at all.
 */
export function councilNoticeForPostcode(
  result: PostcodeResult,
  districts: DistrictEntry[] | undefined,
): { entry: LookupEntry; message: string } | null {
  const code = cleanCode(result.codes?.admin_district);
  if (!code) return null;
  if (code.startsWith("N")) {
    return null;
  }
  const district = (districts || []).find((d) => cleanCode(d.code) === code);
  if (!district) return null;

  const forecast = district.covered
    ? "Its 7 May 2026 results and forecast record are on its page."
    : "We have not published a forecast for it yet.";
  let message: string;
  if (district.status === "abolished") {
    message = `Your council, ${district.name}, is being abolished, so it has no further elections. ${district.covered ? "" : "We publish no forecast for it."}`.trim();
  } else if (district.status === "scheduled") {
    message = `Your council, ${district.name}, next votes on ${district.next_label}. ${forecast}`;
  } else {
    message = `Your council is ${district.name}. We have not verified its next election date. ${forecast}`;
  }
  return {
    entry: {
      kind: "council",
      name: district.name,
      secondary: district.status === "scheduled" ? `Council · next election ${district.next_label}` : "Council · next election not verified",
      href: district.href,
      code: district.code,
    },
    message,
  };
}

export function searchElectionLookup(query: string, index: LookupIndex): LookupEntry[] {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  if (needle.length < 2) return [];

  const all = [...index.constituencies, ...index.wards, ...index.councils];
  return all
    .filter((entry) =>
      `${entry.name} ${entry.secondary}`.toLocaleLowerCase("en-GB").includes(needle),
    )
    .filter(
      (entry, position, entries) =>
        entries.findIndex((candidate) => candidate.href === entry.href) === position,
    )
    .sort((a, b) => {
      const aExact = a.name.toLocaleLowerCase("en-GB") === needle ? 0 : 1;
      const bExact = b.name.toLocaleLowerCase("en-GB") === needle ? 0 : 1;
      const aStarts = a.name.toLocaleLowerCase("en-GB").startsWith(needle) ? 0 : 1;
      const bStarts = b.name.toLocaleLowerCase("en-GB").startsWith(needle) ? 0 : 1;
      return aExact - bExact || aStarts - bStarts || a.name.localeCompare(b.name, "en-GB");
    });
}

/** Route common voter questions before broad full-text results. No query leaves the browser. */
export function voterIntentLinks(query: string): Array<{ name: string; secondary: string; href: string }> {
  const text = query.trim().toLocaleLowerCase('en-GB');
  if (/\bnext\b/.test(text) && /\b(election|elections|vote|poll)\b/.test(text)) {
    return [{name:'When is the next election?',secondary:'Every body we track, with the source for each date',href:'/elections/'}];
  }
  if (/\b2027\b/.test(text) && /election|vote|poll|when|^2027$/.test(text)) {
    return [{name:'Who votes on 6 May 2027',secondary:'Councils, mayors and sources; no 2027 council forecasts yet',href:'/elections/2027/'}];
  }
  if (/\b(my|who|find)\b/.test(text) && /\b(mp|councillors?|mayor|representatives?)\b/.test(text)) {
    return [{name:'Find your MP, councillors and mayor',secondary:'Official representative directories',href:'/your-area/#representatives'}];
  }
  return [];
}

// ---- "Is there an election where I live?" (prototype) ---------------------
//
// One answer for a postcode: whether anything is under way, and every body the
// address votes for with the next date we can stand behind. Dates come from
// the contest files and the sourced calendar; an unverified council gets no
// date. Nothing about the reader leaves the browser beyond the existing
// Postcodes.io lookup.

export interface UpcomingContest {
  ward_code: string;
  ward: string;
  council: string;
  date_iso: string;
  date_label: string;
  href: string;
}

export interface NationalRow {
  body: string;
  date_iso: string | null;
  date_label: string;
  /** "fixed", "latest" or "month", as in the calendar file. */
  date_kind: string;
  href: string | null;
}

export interface AreaIndex extends Pick<LookupIndex, "constituencies" | "wards" | "districts"> {
  byElections?: UpcomingContest[];
  national?: Record<string, NationalRow>;
  districtDates?: Record<string, string | null>;
}

export type DateCertainty = "fixed" | "latest" | "unverified" | "none";

export interface BallotRow {
  body: string;
  when: string;
  date_iso: string | null;
  certainty: DateCertainty;
  href: string | null;
  note?: string;
}

export interface AreaAnswer {
  /** "now": a contest is under way. "later": nothing under way, a date is known. "unknown": no date we can give. */
  tone: "now" | "later" | "unknown";
  headline: string;
  detail: string;
  action: { label: string; href: string } | null;
  rows: BallotRow[];
}

export const CERTAINTY_WORD: Record<DateCertainty, string> = {
  fixed: "Date set",
  latest: "Latest possible date",
  unverified: "Date not verified",
  none: "No further elections",
};

/** Whole days from one ISO date to another. */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((ms(toIso) - ms(fromIso)) / 86400000);
}

export function inDays(n: number): string {
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

export function areaAnswer(
  result: PostcodeResult & { country?: string | null; region?: string | null },
  index: AreaIndex,
  todayIso: string,
): AreaAnswer {
  const wardCode = cleanCode(result.codes?.admin_ward);
  const districtCode = cleanCode(result.codes?.admin_district);
  const pconCode = cleanCode(result.codes?.parliamentary_constituency);
  const country = String(result.country || "");
  const national = index.national || {};
  const rows: BallotRow[] = [];

  // 1. A by-election in this ward that has not polled yet.
  const contest = (index.byElections || [])
    .filter((b) => cleanCode(b.ward_code) === wardCode && b.date_iso >= todayIso)
    .sort((a, b) => a.date_iso.localeCompare(b.date_iso))[0] ?? null;
  if (contest) {
    rows.push({
      body: `${contest.ward} by-election, ${contest.council}`,
      when: contest.date_label,
      date_iso: contest.date_iso,
      certainty: "fixed",
      href: contest.href,
    });
  }

  // 2. The council's next ordinary election.
  const northernIreland = districtCode.startsWith("N") || country === "Northern Ireland";
  const district = (index.districts || []).find((d) => cleanCode(d.code) === districtCode) ?? null;
  if (district) {
    const iso = index.districtDates?.[district.code] ?? null;
    rows.push(
      district.status === "abolished"
        ? { body: `${district.name} council`, when: "Being abolished", date_iso: null, certainty: "none", href: district.href, note: "A successor council will hold its own elections." }
        : district.status === "scheduled"
          ? { body: `${district.name} council`, when: district.next_label, date_iso: iso, certainty: "fixed", href: district.href }
          : { body: `${district.name} council`, when: "We have not confirmed the date", date_iso: null, certainty: "unverified", href: district.href, note: "Check the council's own election pages." },
    );
  }

  // 3. The devolved parliament, by nation.
  const devolved = country === "Scotland" ? national.holyrood : country === "Wales" ? national.senedd : northernIreland ? national["ni-assembly"] : null;
  if (devolved) {
    rows.push({ body: devolved.body, when: devolved.date_label, date_iso: devolved.date_iso, certainty: "fixed", href: devolved.href });
  }

  // 3b. London votes for a mayor and assembly as well as its borough.
  const london = result.region === "London" ? national["london-2028"] : null;
  if (london) {
    rows.push({ body: london.body, when: london.date_label, date_iso: london.date_iso, certainty: "fixed", href: london.href });
  }

  // 4. Westminster.
  const seat = pconCode ? index.constituencies.find((e) => cleanCode(e.code) === pconCode) ?? null : null;
  const ge = national["general-election"];
  if (ge) {
    rows.push({
      body: seat ? `UK Parliament, ${seat.name}` : "UK Parliament",
      when: ge.date_label,
      date_iso: ge.date_iso,
      certainty: "latest",
      href: seat?.href ?? ge.href,
      note: "No date is set. An election can be called earlier.",
    });
  }

  rows.sort((a, b) => (a.date_iso ?? "9999").localeCompare(b.date_iso ?? "9999"));

  if (contest) {
    return {
      tone: "now",
      headline: `Yes. ${contest.ward} has a council by-election on ${contest.date_label}.`,
      detail: `That is ${inDays(daysBetween(todayIso, contest.date_iso))}.`,
      action: { label: "See every deadline and what you can still do", href: `${contest.href}#your-vote` },
      rows,
    };
  }
  // The next date we can stand behind. A latest-possible date is not one.
  const next = rows.find((r) => r.date_iso && r.certainty === "fixed" && r.date_iso >= todayIso) ?? null;
  if (next) {
    // A general election has no date, but it has a last possible one. Where
    // that falls first, say so: "the next is 2030" would be untrue.
    const geFirst = ge?.date_iso && next.date_iso && ge.date_iso < next.date_iso;
    return {
      tone: "later",
      headline: "No election is under way where you live.",
      detail: (geFirst
        ? `A general election has no date yet but must be held ${ge!.date_label.replace(/^No later than/, "by")}. The next one with a date is ${next.body}, on ${next.when}.`
        : `The next one with a date is ${next.body}, on ${next.when}.`)
        + (northernIreland ? " This site does not cover council elections in Northern Ireland." : ""),
      action: null,
      rows,
    };
  }
  return {
    tone: "unknown",
    headline: "No election is under way that we know of.",
    detail: northernIreland
      ? "This site does not cover council elections in Northern Ireland. The Electoral Office for Northern Ireland has them."
      : "We have not confirmed when this area next votes, so we give no date.",
    action: northernIreland ? { label: "Electoral Office for Northern Ireland", href: "https://www.eoni.org.uk/" } : null,
    rows,
  };
}
