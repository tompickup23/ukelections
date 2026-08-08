#!/usr/bin/env node
// One-shot append of the two verified Lancashire by-elections (21 May 2026)
// to data/history/dc-historic-results.json. Both results were read from the
// returning officers' Declaration of Result PDFs and cross-checked against
// Democracy Club (agent verification, 8 Aug 2026). Idempotent by ballot id.
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "data/history/dc-historic-results.json";
const doc = JSON.parse(readFileSync(PATH, "utf8"));

const ROWS = [
  {
    ballot_paper_id: "local.fylde.kirkham.by.2026-05-21",
    election_date: "2026-05-21", year: 2026, tier: "local",
    council_slug: "fylde", ward_slug: "kirkham", is_by_election: true,
    turnout_votes: 1963, turnout_pct: 34.03, spoilt_ballots: 8, electorate: 5768,
    source: "https://new.fylde.gov.uk/wp-content/uploads/2026/05/Declartion-of-Result.pdf",
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
    turnout_votes: 1211, turnout_pct: 24.75, spoilt_ballots: 3, electorate: 4893,
    source: "https://www.lancaster.gov.uk/assets/attach/17981/Castle-Ward-Declaration-of-result.pdf",
    candidates: [
      { name: "William Arthur Edward Farley", party_name: "Green Party", votes: 845, elected: true },
      { name: "William David Evans", party_name: "Labour Party", votes: 190, elected: false },
      { name: "Marco Wright", party_name: "Reform UK", votes: 132, elected: false },
      { name: "Malcolm Allan Martin", party_name: "Liberal Democrats", votes: 41, elected: false },
    ],
  },
];

const have = new Set(doc.results.map((r) => r.ballot_paper_id));
let added = 0;
for (const row of ROWS) {
  if (have.has(row.ballot_paper_id)) continue;
  doc.results.push(row);
  added += 1;
}
writeFileSync(PATH, JSON.stringify(doc, null, 1));
console.log(`appended ${added} by-election rows (${ROWS.length - added} already present)`);
