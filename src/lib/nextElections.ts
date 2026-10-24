import calendarData from "../../data/identity/next-elections.json";
import councilData from "../../data/identity/council-next-elections.json";

/**
 * Next-election dates, each tied to the primary source it was read from.
 *
 * Two files feed this module:
 * - next-elections.json: one row per body (general election, mayors,
 *   devolved parliaments, councils as a group), for the calendar page.
 * - council-next-elections.json: one record per principal council in Great
 *   Britain, covered or not, with the year of its next ordinary election and
 *   the electoral change order or council page that establishes it.
 *
 * A council record only yields a date when its status is "verified". The
 * stored cycle arithmetic in council-cycles.json is never used for a date:
 * it put Sunderland in 2030 when SI 2025/564 retires a third of its
 * councillors in 2027, and Birmingham in 2027 when it elects all out in 2030.
 */

export interface Source {
  label: string;
  url: string;
  quote?: string;
}

export interface CalendarRow {
  id: string;
  body: string;
  date_iso: string | null;
  date_label: string;
  date_kind: string;
  coverage: string;
  coverage_label: string;
  href: string | null;
  summary: string;
  sources: Source[];
}

export interface CouncilNextRecord {
  name: string;
  lad24cd: string | null;
  nation: "E" | "W" | "S";
  next_year: number | null;
  pattern: string;
  status: "verified" | "unverified" | "abolished";
  source_label: string | null;
  source_url: string | null;
  quote: string | null;
  notes: string | null;
  /** Set only where the poll is not on the ordinary May day (the City of London votes in March). */
  date_label?: string;
}

export interface NextElectionLabel {
  label: string;
  date_iso: string | null;
  is_tbc: boolean;
  reason: string;
  status: string;
  checked_at: string | null;
  sources: Array<{ label: string; url: string }>;
}

export const NEXT_ELECTIONS_CHECKED_AT: string = calendarData.checked_at;
export const CALENDAR: CalendarRow[] = calendarData.calendar as CalendarRow[];
export const NOT_COVERED: Array<{ body: string; note: string }> = calendarData.not_covered;

const COUNCILS = councilData.councils as Record<string, CouncilNextRecord>;
const COUNCILS_CHECKED_AT: string = councilData.checked_at;
const checkedLabel = (): string => longDate(COUNCILS_CHECKED_AT);

/** Ordinary local elections in England, Wales and Scotland fall on the first Thursday in May. */
export function firstThursdayInMay(year: number): string {
  const may1 = new Date(Date.UTC(year, 4, 1)).getUTCDay();
  const day = 1 + ((4 - may1 + 7) % 7);
  return `${year}-05-${String(day).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Thursday 6 May 2027". Built by hand: ICU puts a comma after the weekday in some runtimes. */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const ORDINARY_DAY_SOURCE: Record<CouncilNextRecord["nation"], { label: string; url: string }> = {
  E: { label: "Representation of the People Act 1983, s.37", url: "https://www.legislation.gov.uk/ukpga/1983/2/section/37" },
  W: { label: "Representation of the People Act 1983, s.37ZA", url: "https://www.legislation.gov.uk/ukpga/1983/2/section/37ZA" },
  S: { label: "Representation of the People Act 1983, s.43", url: "https://www.legislation.gov.uk/ukpga/1983/2/section/43" },
};

const PATTERN_TEXT: Record<string, string> = {
  thirds: "The council elects a third of its seats in three years out of four.",
  halves: "The council elects half of its seats every two years.",
  whole: "The council elects all of its seats at once.",
};

export function councilNextRecord(slug: string | null | undefined): CouncilNextRecord | null {
  return (slug && COUNCILS[slug]) || null;
}

export function councilNextElection(slug: string | null | undefined): NextElectionLabel {
  const record = councilNextRecord(slug);
  const source = record?.source_url ? [{ label: record.source_label || record.source_url, url: record.source_url }] : [];

  if (record?.status === "abolished") {
    return {
      label: "None: council being abolished",
      date_iso: null,
      is_tbc: true,
      status: "abolished",
      checked_at: checkedLabel(),
      sources: source,
      reason: record.notes || "This council is being abolished under a structural changes order.",
    };
  }

  if (record?.status === "verified" && record.next_year && record.date_label) {
    return {
      label: record.date_label,
      date_iso: null,
      is_tbc: false,
      status: "scheduled",
      checked_at: checkedLabel(),
      sources: source,
      reason: [record.notes, `Source: ${record.source_label}.`].filter(Boolean).join(" "),
    };
  }

  if (record?.status === "verified" && record.next_year) {
    const iso = firstThursdayInMay(record.next_year);
    return {
      label: longDate(iso),
      date_iso: iso,
      is_tbc: false,
      status: "scheduled",
      checked_at: checkedLabel(),
      sources: [...source, ORDINARY_DAY_SOURCE[record.nation]],
      reason: [
        PATTERN_TEXT[record.pattern],
        `The year is set by ${record.source_label}; polling day is the statutory first Thursday in May.`,
        "Check the council's notice of election nearer the time.",
      ].filter(Boolean).join(" "),
    };
  }

  return {
    label: "Not verified",
    date_iso: null,
    is_tbc: true,
    status: "unknown",
    checked_at: record ? checkedLabel() : null,
    sources: [],
    reason: "We have not confirmed this council's next election from an electoral change order or the council's own notices, so we give no date. Check the council's election pages.",
  };
}

/** Principal councils with a next-election record but no results page on this site. */
export function uncoveredCouncils(coveredSlugs: Set<string>): Array<{ slug: string } & CouncilNextRecord> {
  return Object.entries(COUNCILS)
    .filter(([slug, record]) => !coveredSlugs.has(slug) && record.lad24cd)
    .map(([slug, record]) => ({ slug, ...record }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

/** Every council record whose verified next election is in the given year. */
export function councilsVotingIn(year: number): Array<{ slug: string } & CouncilNextRecord> {
  return Object.entries(COUNCILS)
    .filter(([, record]) => record.status === "verified" && record.next_year === year)
    .map(([slug, record]) => ({ slug, ...record }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

export function allCouncilRecords(): Array<{ slug: string } & CouncilNextRecord> {
  return Object.entries(COUNCILS)
    .map(([slug, record]) => ({ slug, ...record }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}
