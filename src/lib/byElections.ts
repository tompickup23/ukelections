/** Shared presentation of recorded contests; never changes a forecast or count. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { shortPartyLabel } from "./siteData";
import { placeResultTitle } from "./seo";

export const prettyElectionDate = (iso: string) => iso
  ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "Date to be confirmed";
const load = (dir: string) => existsSync(dir) ? readdirSync(dir)
  .filter(f => f.endsWith(".json") && !f.startsWith("_") && !f.endsWith(".analysis.json"))
  .map(f => ({ ...JSON.parse(readFileSync(path.join(dir, f), "utf8")), fileSlug: f.replace(/(?:-\d{4}-\d{2}-\d{2})?\.json$/, "") })) : [];
export const loadLocalContests = () => load(path.join(process.cwd(), "data/contests/local-byelections"));
export const loadParliamentContests = () => load(path.join(process.cwd(), "data/predictions/by-elections"));
export const isDeclared = (d: any) => Boolean(d.result?.declared || d.declaration?.declared || (d.status === "concluded" && d.result));
export function localStatus(d: any, today = new Date().toISOString().slice(0, 10)) {
  if (isDeclared(d)) return d.contest.voting_system === "STV" ? "STV result declared" : "Result declared";
  return d.contest.polling_day < today || d.status === "polls_closed" ? "Result awaited" : "Upcoming";
}
export function localMetadata(d: any, today?: string) {
  const c = d.contest;
  const status = localStatus(d, today);
  const declared = isDeclared(d);
  const result = d.result || d.declaration;
  const date = prettyElectionDate(c.polling_day);
  // Answer first, in the form ward pages use: "Huncoat, Hyndburn. By-election
  // result, 12 November 2026", shortened to 60 characters where the names allow.
  const label = declared ? "By-election result" : status === "Result awaited" ? "By-election result awaited" : "By-election candidates";
  const title = placeResultTitle({ place: c.ward_name, council: c.council_name, label, date: c.polling_day, fit: true });
  const winner = result?.winner_candidate;
  const party = result?.winner_party;
  // Every description names the ward, the council and the polling day, so a
  // title shortened to fit still has the council beside it in the snippet.
  const where = `${c.ward_name}, ${c.council_name}`;
  const fit = (...parts: string[]) => {
    for (let n = parts.length; n > 1; n -= 1) {
      const text = parts.slice(0, n).join(" ");
      if (text.length <= 155) return text;
    }
    return parts[0];
  };
  const description = declared
    ? fit(`${where}, ${date}: ${winner ? `${winner} (${shortPartyLabel(party)})` : shortPartyLabel(party)} elected${c.voting_system === "STV" ? " under STV" : Number.isFinite(result?.majority_votes) ? ` with a majority of ${result.majority_votes.toLocaleString("en-GB")}` : ""}.`, "Results and official sources.")
    : status === "Result awaited"
      ? fit(`${where}, ${date}: polls have closed and the result is awaited.`, "Candidates, sources and the pre-election record.")
      : fit(`${where}: by-election on ${date}.`, `Candidates, previous results${d.forecast ? " and the published forecast" : "; no forecast published"}.`);
  return { title, description, status };
}

/**
 * The line under "Candidates". The field can only be described as still open
 * while nominations are: once they have closed, or the contest has polled or
 * declared, it says so, and it never gives a date already past as a limit
 * still to come. The overnight feed does not always mark a field as locked
 * after polling day, so the dates decide, not the lock alone.
 */
export function candidateFieldNote(d: any, today = new Date().toISOString().slice(0, 10)): string {
  const c = d.contest;
  const f = d.field || {};
  const n: number = f.candidate_count ?? 0;
  const close: string | null = c.nominations_close || null;
  const polled = isDeclared(d) || d.status === "polls_closed" || d.status === "concluded" || c.polling_day < today;
  const closed = Boolean(f.locked) || polled || Boolean(close && close < today);
  const candidates = `${n} candidate${n === 1 ? "" : "s"}`;
  if (!closed) {
    return n === 0
      ? `No candidates have been published yet${close ? `; nominations close on ${prettyElectionDate(close)}` : ""}. This page fills in as they are.`
      : `${candidates} ${n === 1 ? "is" : "are"} known so far and the field can still change${close ? `, up to ${prettyElectionDate(close)}` : " until nominations close"}.`;
  }
  const closedLine = `Nominations closed${close && close <= today ? ` on ${prettyElectionDate(close)}` : ""}.`;
  if (n === 0) return polled ? `${closedLine} We hold no candidate list for this contest.` : `${closedLine} The candidates have not been published here yet.`;
  if (polled) return `${closedLine} ${candidates} stood.`;
  return f.locked
    ? `${closedLine} ${candidates} standing.`
    : `${closedLine} ${candidates} ${n === 1 ? "is" : "are"} listed here so far; the statement of persons nominated is the official list.`;
}
const placeKey = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/&/g, "and").replace(/\b(city|borough|district|county|london|council|bc|dc|lbc)\b/g, "").replace(/[^a-z0-9]/g, "");
export function roundupHref(date: string, row: any, contests: any[]) {
  const matches = contests.filter(d => d.contest.polling_day === date &&
    placeKey(d.contest.council_name) === placeKey(row.council) && placeKey(d.contest.ward_name) === placeKey(row.ward));
  return matches.length === 1 ? `/by-elections/local/${matches[0].slug}/` : null;
}
/** Every party represented, with changes measured within the stated coverage window. */
export function partyScorecard(rows: any[]) {
  const parties = [...new Set(rows.flatMap(c => [c.winner, c.previous]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"en-GB"));
  return parties.map(party => {
    const won = rows.filter(c => c.winner === party);
    const holds = won.filter(c => c.previous === party).length;
    const gains = won.length - holds;
    const losses = rows.filter(c => c.previous === party && c.winner !== party).length;
    return { party, wins: won.length, holds, gains, losses, net: gains - losses };
  });
}
export function archiveYears(today = new Date().toISOString().slice(0, 10)) {
  const roundup = JSON.parse(readFileSync("data/results/local-byelections.json", "utf8"));
  return [...new Set([...loadParliamentContests(), ...loadLocalContests()].map(d => d.contest.polling_day)
    .concat(roundup.dates.map((d: any) => d.date)).filter((d: string) => d && d < today).map((d: string) => d.slice(0,4)))].sort().reverse() as string[];
}
const shiftDay = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/**
 * The week a reader means by "council by-election results this week": contests
 * that polled in the seven days to today, and those polling in the seven after.
 */
export function councilByElectionWeek(contests: any[], today = new Date().toISOString().slice(0, 10)) {
  const from = shiftDay(today, -6);
  const until = shiftDay(today, 7);
  const byDay = (a: any, b: any) => a.contest.polling_day.localeCompare(b.contest.polling_day)
    || a.contest.council_name.localeCompare(b.contest.council_name, "en-GB");
  return {
    from,
    today,
    until,
    held: contests.filter(d => d.contest.polling_day >= from && d.contest.polling_day <= today).sort(byDay),
    next: contests.filter(d => d.contest.polling_day > today && d.contest.polling_day <= until).sort(byDay),
  };
}

/** Both council hubs use the same refresh stamp, result window and next poll. */
export function localContestGroups(contests: any[], today = new Date().toISOString().slice(0, 10)) {
  const ordered = [...contests].sort((a, b) => a.contest.polling_day.localeCompare(b.contest.polling_day)
    || a.slug.localeCompare(b.slug));
  const upcoming = ordered.filter(c => !isDeclared(c) && c.contest.polling_day >= today);
  const held = ordered.filter(c => isDeclared(c) || c.contest.polling_day < today).reverse();
  const recentDates = [...new Set(held.map(c => c.contest.polling_day))].slice(0, 2);
  return {
    contests: ordered, upcoming, held,
    latest: held.filter(c => recentDates.includes(c.contest.polling_day)),
    earlier: held.filter(c => !recentDates.includes(c.contest.polling_day)),
    nextDay: upcoming[0]?.contest.polling_day ?? null,
  };
}
export function loadLocalHub() {
  const metaPath = path.join(process.cwd(), "data/contests/local-byelections/_meta.json");
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : null;
  return { ...localContestGroups(loadLocalContests()), meta, updatedAt: meta?.generated_at?.slice(0, 10) ?? null };
}
