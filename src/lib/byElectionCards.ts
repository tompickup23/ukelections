import { loadLocalContests, loadParliamentContests, isDeclared, prettyElectionDate } from "./byElections";
import { partyColour } from "./predictions";
import { shortPartyLabel } from "./siteData";
import type { OgEntry } from "./ogEntries";

export function resultCard(d: any, local = true): OgEntry {
  const r = d.result || d.declaration;
  const c = d.contest;
  const stv = c.voting_system === "STV";
  const party = r.winner_party || r.winner;
  const ranked = Object.entries((!stv && r.shares) || {}).filter(([,v])=>typeof v === "number" && v > 0).sort((a,b)=>(b[1] as number)-(a[1] as number));
  const leaders = ranked.slice(0,3);
  const rest = ranked.slice(3).reduce((n,[,v])=>n+(v as number),0);
  const shares = leaders.map(([party,pct])=>({party,partyLabel:shortPartyLabel(party),pct:pct as number,colour:partyColour(party)}));
  if (rest > 0) shares.push({party:"Other",partyLabel:"Remaining candidates",pct:rest,colour:partyColour("Other")});
  const margin = !stv && Number.isFinite(r.majority_votes) ? ` · Majority ${r.majority_votes.toLocaleString("en-GB")}` : "";
  const winner = r.winner_candidate || shortPartyLabel(party);
  return {
    slug: `by-elections/${local ? `local/${d.slug}` : d.fileSlug}`,
    eyebrow: `${stv ? "STV result" : "By-election result"} · ${prettyElectionDate(c.polling_day)}`,
    headline: local ? c.ward_name : c.constituency_name,
    subline: `${winner} elected${stv ? " under STV" : ""}${margin}${local ? ` · ${c.council_name}` : ""}`,
    shares: shares.length ? shares : undefined,
    sharesCaption: shares.length ? `${winner} elected${margin}${local ? ` · ${c.council_name}` : ""}` : undefined,
    accentColour: partyColour(party),
    partyChipLabel: `${shortPartyLabel(party)} elected`,
    partyChipColour: partyColour(party),
  };
}
export function byElectionResultCards(): OgEntry[] {
  return [...loadParliamentContests().filter(isDeclared).map(d=>resultCard(d,false)), ...loadLocalContests().filter(isDeclared).map(d=>resultCard(d))];
}
