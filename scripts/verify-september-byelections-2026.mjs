#!/usr/bin/env node
// Primary-source upgrades for the 10 and 15 September 2026 by-elections whose
// returning officers have published full results. North East Derbyshire is not
// included: its official councillor register confirms the winner, but an
// accessible returning-officer declaration has not been located for the count.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PATHS = [
  "data/history/byelection-appends.json",
  "data/history/dc-historic-results.json",
].filter(existsSync);

const ROWS = [
  {
    ballot_paper_id: "local.bassetlaw.east-markham.by.2026-09-15",
    election_date: "2026-09-15", year: 2026, tier: "local",
    council_slug: "bassetlaw", ward_slug: "east-markham", is_by_election: true,
    turnout_votes: 880, turnout_pct: 0.4213, spoilt_ballots: 1, electorate: 2089,
    source: "https://www.bassetlaw.gov.uk/council-and-democracy/elections-in-bassetlaw/elections-2026/east-markham-by-election/declaration-of-result-of-poll/",
    review_status: "hand_verified_declaration",
    verification: "Primary declaration: 880 ballot papers issued from an electorate of 2,089, 42.13% turnout and one rejected paper.",
    candidates: [
      { name: "Matthew Stephen Evans", party_name: "Reform UK", votes: 436, elected: true },
      { name: "James Robert Purle", party_name: "Conservative and Unionist Party", votes: 250, elected: false },
      { name: "Colette Maureen Roberts", party_name: "Labour Party", votes: 151, elected: false },
      { name: "David Andrew Bean", party_name: "Green Party", votes: 42, elected: false },
    ],
  },
  {
    ballot_paper_id: "local.manchester.burnage.by.2026-09-10",
    election_date: "2026-09-10", year: 2026, tier: "local",
    council_slug: "manchester", ward_slug: "burnage", is_by_election: true,
    turnout_votes: 3254, turnout_pct: 0.2355, spoilt_ballots: 13, electorate: 13815,
    source: "https://www.manchester.gov.uk/online-directories/the-council-and-democracy-directories/elections-and-voting-directories/elections-directories/election-results/local-elections/local-by-elections/burnage-ward-local-by-election-10-september-2026",
    review_status: "hand_verified_declaration",
    verification: "Primary council result: 3,241 valid candidate votes plus 13 rejected papers from an electorate of 13,815, reported turnout 23.55%.",
    candidates: [
      { name: "Carl Jason Austin-Behan", party_name: "Labour Party", votes: 1365, elected: true },
      { name: "Daoud Nawaz", party_name: "Green Party", votes: 1037, elected: false },
      { name: "Gaz Ranjha", party_name: "Workers Party of Britain", votes: 466, elected: false },
      { name: "Heather McDonagh", party_name: "Reform UK", votes: 315, elected: false },
      { name: "Abdullah Vavdiwala", party_name: "Liberal Democrats", votes: 31, elected: false },
      { name: "Bhupinder Kumar", party_name: "Conservative and Unionist Party", votes: 27, elected: false },
    ],
  },
  {
    ballot_paper_id: "local.north-somerset.hutton-locking.by.2026-09-10",
    election_date: "2026-09-10", year: 2026, tier: "local",
    council_slug: "north-somerset", ward_slug: "hutton-locking", is_by_election: true,
    turnout_votes: 1838, turnout_pct: 0.2631, spoilt_ballots: 2, electorate: null,
    source: "https://n-somerset.gov.uk/news/hutton-locking-ward-election-results",
    review_status: "hand_verified_declaration",
    verification: "Primary council result: 1,836 valid candidate votes, two rejected papers and reported turnout of 26.31%. The electorate was not published and is left null.",
    candidates: [
      { name: "William Jones", party_name: "Reform UK", votes: 706, elected: true },
      { name: "Georgina Barry", party_name: "Liberal Democrats", votes: 612, elected: false },
      { name: "John Edward Standfield", party_name: "Conservative and Unionist Party", votes: 281, elected: false },
      { name: "Yue He Parkinson", party_name: "Labour Party", votes: 133, elected: false },
      { name: "James Gavin Willis-Boden", party_name: "Green Party", votes: 104, elected: false },
    ],
  },
  {
    ballot_paper_id: "local.west-suffolk.haverhill-west.by.2026-09-10",
    election_date: "2026-09-10", year: 2026, tier: "local",
    council_slug: "west-suffolk", ward_slug: "haverhill-west", is_by_election: true,
    turnout_votes: 1033, turnout_pct: 0.2449, spoilt_ballots: 0, electorate: 4218,
    source: "https://haverhill-tc.gov.uk/wp-content/uploads/Declaration-of-results-Haverhill-West-10-September-2026.pdf",
    review_status: "hand_verified_declaration",
    verification: "Returning-officer declaration republished by Haverhill Town Council: 1,033 ballot papers issued from an electorate of 4,218, 24.49% turnout and no rejected papers.",
    candidates: [
      { name: "Graham David Cone", party_name: "Conservative and Unionist Party", votes: 530, elected: true },
      { name: "Heike Sowa", party_name: "Reform UK", votes: 267, elected: false },
      { name: "Quinn Ryan Cox", party_name: "Labour Party", votes: 146, elected: false },
      { name: "Clare Carlyon Higson", party_name: "Green Party", votes: 60, elected: false },
      { name: "James William Porter", party_name: "Liberal Democrats", votes: 30, elected: false },
    ],
  },
];

for (const file of PATHS) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const index = new Map(doc.results.map((row, i) => [row.ballot_paper_id, i]));
  for (const row of ROWS) {
    const at = index.get(row.ballot_paper_id);
    if (at === undefined) doc.results.push(row);
    else doc.results[at] = row;
  }
  doc.results.sort((a, b) =>
    a.election_date === b.election_date
      ? a.ballot_paper_id.localeCompare(b.ballot_paper_id)
      : a.election_date.localeCompare(b.election_date),
  );
  writeFileSync(file, JSON.stringify(doc, null, 1));
  console.log(`upserted ${ROWS.length} primary-source rows in ${file}`);
}
