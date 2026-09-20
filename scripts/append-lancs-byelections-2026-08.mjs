#!/usr/bin/env node
// One-shot append of the two verified Lancashire by-elections (21 May 2026)
// to data/history/dc-historic-results.json. Both results were read from the
// returning officers' Declaration of Result PDFs and cross-checked against
// Democracy Club (agent verification, 8 Aug 2026). Idempotently upserts by
// ballot id so this script also repairs an earlier percentage-point unit error.
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "data/history/dc-historic-results.json";
const doc = JSON.parse(readFileSync(PATH, "utf8"));

const ROWS = [
  {
    ballot_paper_id: "local.fylde.kirkham.by.2026-05-21",
    election_date: "2026-05-21", year: 2026, tier: "local",
    council_slug: "fylde", ward_slug: "kirkham", is_by_election: true,
    turnout_votes: 1963, turnout_pct: 0.3403, spoilt_ballots: 8, electorate: 5768,
    source: "https://new.fylde.gov.uk/wp-content/uploads/2026/05/Declartion-of-Result.pdf",
    review_status: "hand_verified_declaration",
    verification: "Primary declaration: 1,963 ballot papers issued from an electorate of 5,768, giving 34.03% turnout. Candidate votes total 1,955 and eight papers were rejected.",
    candidates: [
      { name: "Adam Jake Brierley", party_name: "Conservative and Unionist Party", votes: 1185, elected: true },
      { name: "Joshua Connor Roberts", party_name: "Reform UK", votes: 534, elected: false },
      { name: "Oliver Mark Mills", party_name: "Labour Party", votes: 129, elected: false },
      { name: "Philip James Morgan", party_name: "Liberal Democrats", votes: 107, elected: false },
    ],
  },
  {
    ballot_paper_id: "local.lancaster.castle.by.2026-05-21",
    election_date: "2026-05-21", year: 2026, tier: "local",
    council_slug: "lancaster", ward_slug: "castle", is_by_election: true,
    turnout_votes: 1211, turnout_pct: 0.2475, spoilt_ballots: 3, electorate: 4893,
    source: "https://www.lancaster.gov.uk/assets/attach/17981/Castle-Ward-Declaration-of-result.pdf",
    review_status: "hand_verified_declaration",
    verification: "Primary declaration: 1,211 ballot papers issued from an electorate of 4,893, giving 24.75% turnout. Candidate votes total 1,208 and three papers were rejected.",
    candidates: [
      { name: "William Arthur Edward Farley", party_name: "Green Party", votes: 845, elected: true },
      { name: "William David Evans", party_name: "Labour Party", votes: 190, elected: false },
      { name: "Marco Wright", party_name: "Reform UK", votes: 132, elected: false },
      { name: "Malcolm Allan Martin", party_name: "Liberal Democrats", votes: 41, elected: false },
    ],
  },
];

const index = new Map(doc.results.map((r, i) => [r.ballot_paper_id, i]));
let added = 0;
let updated = 0;
for (const row of ROWS) {
  const at = index.get(row.ballot_paper_id);
  if (at === undefined) {
    doc.results.push(row);
    added += 1;
  } else {
    doc.results[at] = row;
    updated += 1;
  }
}
writeFileSync(PATH, JSON.stringify(doc, null, 1));
console.log(`upserted ${ROWS.length} by-election rows (${added} added, ${updated} updated)`);
