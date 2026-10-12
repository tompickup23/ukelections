/** Shared presentation of recorded contests; never changes a forecast or count. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { shortPartyLabel } from "./siteData";

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
  const result = d.result || d.declaration;
  const date = prettyElectionDate(c.polling_day);
  const title = `${c.ward_name} by-election ${isDeclared(d) ? "result" : status === "Result awaited" ? "result awaited" : "candidates"}, ${c.polling_day.slice(0,4)}`;
  const winner = result?.winner_candidate;
  const party = result?.winner_party;
  const description = isDeclared(d)
    ? `${c.council_name}, ${date}: ${winner ? `${winner} (${shortPartyLabel(party)})` : shortPartyLabel(party)} elected${c.voting_system === "STV" ? " under STV" : Number.isFinite(result?.majority_votes) ? ` with a majority of ${result.majority_votes.toLocaleString("en-GB")}` : ""}. Results and official sources.`
    : status === "Result awaited"
      ? `${c.council_name}, ${date}: result awaited for ${c.ward_name}. Candidates, sources and the pre-election record.`
      : `${c.ward_name}, ${c.council_name}: by-election on ${date}. Candidates, previous results${d.forecast ? " and the published forecast" : "; no forecast published"}.`;
  // The council disambiguates repeated ward names without front-loading boilerplate.
  return { title: `${title} | ${c.council_name}`, description, status };
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
