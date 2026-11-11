// Calendar file of one contest's deadlines for one way of voting. PROTOTYPE.
// Dates are the Democracy Club timetable; nothing is computed. Timed events
// are written in UTC, which every calendar client converts.
import type { APIRoute } from "astro";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildJourney, LANES, stepDeadline, type Lane } from "../../../../lib/voterJourney";

const DIR = path.join(process.cwd(), "data/contests/local-byelections");
const SIDECAR = path.join(process.cwd(), "data/contests/local-byelection-timetables.json");

function load() {
  const sidecar = existsSync(SIDECAR) ? JSON.parse(readFileSync(SIDECAR, "utf8")) : { timetables: {} };
  const today = new Date().toISOString().slice(0, 10);
  const contests = readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")))
    .filter((d) => d.contest?.polling_day >= today && !d.result?.declared
      && (d.contest.timetable || sidecar.timetables[d.contest.ballot_paper_id]?.timetable));
  return { sidecar, contests };
}

export function getStaticPaths() {
  const { sidecar, contests } = load();
  return contests.flatMap((d) =>
    LANES.map((lane) => ({
      params: { slug: d.slug, lane: lane.id },
      props: {
        contest: d,
        timetable: d.contest.timetable ?? sidecar.timetables[d.contest.ballot_paper_id]?.timetable,
        requiresVoterId: d.contest.requires_voter_id ?? sidecar.timetables[d.contest.ballot_paper_id]?.requires_voter_id ?? null,
        fetchedAt: d.contest.timetable ? d.generated_at : sidecar.fetched_at,
      },
    })),
  );
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
// RFC 5545 lines fold at 75 octets.
const fold = (line: string) => {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(line.slice(i, i + 74));
  return parts.join("\r\n ");
};

export const GET: APIRoute = ({ params, props }) => {
  const c = props.contest.contest;
  const lane = params.lane as Lane;
  const steps = buildJourney({
    pollingDay: c.polling_day,
    territory: c.territory,
    councilName: c.council_name,
    wardName: c.ward_name,
    requiresVoterId: props.requiresVoterId,
    timetable: props.timetable,
  }).filter((s) => s.action && s.lanes.includes(lane) && stepDeadline(s) !== null);

  const dtstamp = stamp(Date.parse(props.fetchedAt));
  const url = `https://ukelections.co.uk/by-elections/local/${props.contest.slug}/#your-vote`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UK Elections//Voter journey//EN", "CALSCALE:GREGORIAN"];
  for (const s of steps) {
    const end = stepDeadline(s)!;
    const start = s.id === "poll" ? end - 15 * 3600 * 1000 : end - 3600 * 1000;
    const summary = s.id === "poll" ? `Polling day: ${c.ward_name} by-election` : `Deadline: ${s.action!.toLowerCase()} (${c.ward_name} by-election)`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${c.ballot_paper_id}.${s.id}.${lane}@ukelections.co.uk`,
      `DTSTAMP:${dtstamp}`,
      // A deadline whose hour is not printed on the page is an all-day event.
      ...(s.hideTime
        ? [`DTSTART;VALUE=DATE:${s.date!.replace(/-/g, "")}`]
        : [`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`]),
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(`${s.body} ${s.official ? s.official.url + " " : ""}Dates from Democracy Club. Check ${url} in case a date has changed.`)}`,
      `URL:${url}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
};
