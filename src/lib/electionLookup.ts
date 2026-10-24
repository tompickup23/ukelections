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
