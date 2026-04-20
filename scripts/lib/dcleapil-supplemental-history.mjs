import { createReadStream } from "node:fs";
import readline from "node:readline";
import { createHash } from "node:crypto";

function slug(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stableId(prefix, parts) {
  return `${prefix}-${createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12)}`;
}

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inQuotes) {
      if (character === "\"") {
        if (line[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === "\"") {
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      fields.push(field);
      field = "";
      continue;
    }
    field += character;
  }
  fields.push(field);
  return fields;
}

function rowFromLine(headers, line) {
  const values = parseCsvLine(line);
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function integerOrUndefined(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function turnoutShare(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) return undefined;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric > 1 && numeric <= 100) return numeric / 100;
  return undefined;
}

function dateFromRow(row) {
  const ballotDate = String(row.merge_ballot_paper || "").match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (ballotDate) return ballotDate;
  const year = Number(row.year);
  return Number.isInteger(year) ? `${year}-05-01` : "1900-01-01";
}

function normaliseParty(rawName) {
  const name = String(rawName || "").trim();
  const map = {
    "Labour Party": "Labour",
    "Labour and Co-operative Party": "Labour & Co-operative",
    "Conservative and Unionist Party": "Conservative",
    "Conservative Party": "Conservative",
    "Liberal Democrat": "Liberal Democrats",
    "Liberal Democrats": "Liberal Democrats",
    "Green Party": "Green Party",
    "The Green Party": "Green Party",
    "UK Independence Party (UKIP)": "UKIP",
    "UK Independence Party": "UKIP",
    "The Brexit Party": "Brexit Party",
    "British National Party": "BNP",
    "Trade Unionist and Socialist Coalition": "TUSC",
    "Social Democratic Party": "SDP",
    "Workers Party of Britain": "Workers Party",
    "Workers' Party of Britain": "Workers Party"
  };
  if (map[name]) return map[name];
  if (name.toLowerCase().includes("independent") || name === "Ind" || name.startsWith("Ind ")) return "Independent";
  return name || "Independent";
}

function electionTypeForBoundary(boundary) {
  if (boundary?.area_type === "county_division") return "county";
  if (boundary?.area_type === "unitary_ward") return "unitary";
  return "borough";
}

function votingSystemForBoundary() {
  return "fptp";
}

function sourceUrlForContest(contest, fallback) {
  return String(contest.rows.find((row) => row.results_source)?.results_source || "").match(/https?:\/\/\S+/)?.[0] || fallback;
}

function contestRows(candidates) {
  const rows = candidates
    .filter((row) => Number.isFinite(Number(row.votes_cast)))
    .map((row) => ({
      candidate_or_party_name: row.person_name || row.party_name || "Unknown",
      party_name: normaliseParty(row.party_name),
      votes: Math.max(0, Math.round(Number(row.votes_cast))),
      elected: row.elected === "t"
    }))
    .sort((left, right) => right.votes - left.votes);

  const hasElected = rows.some((row) => row.elected);
  return rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    elected: row.elected || (!hasElected && index === 0)
  }));
}

function buildRecord({ key, contest, boundary, sourceSnapshot, sourceUrl }) {
  const resultRows = contestRows(contest.rows);
  const turnoutVotes = resultRows.reduce((sum, row) => sum + row.votes, 0);
  return {
    history_id: stableId("dcleapil-history", [key, boundary.boundary_version_id]),
    contest_id: `dcleapil.${slug(contest.council)}.${slug(boundary.area_code)}.${contest.electionDate}`,
    area_id: boundary.boundary_version_id,
    area_code: boundary.area_code,
    area_name: boundary.area_name,
    boundary_version_id: boundary.boundary_version_id,
    election_date: contest.electionDate,
    election_type: electionTypeForBoundary(boundary),
    voting_system: votingSystemForBoundary(boundary),
    source_snapshot_id: sourceSnapshot.snapshot_id,
    source_url: sourceUrlForContest(contest, sourceUrl),
    electorate: integerOrUndefined(contest.rows.find((row) => row.electorate)?.electorate),
    turnout_votes: turnoutVotes,
    turnout: turnoutShare(contest.rows.find((row) => row.turnout_percentage)?.turnout_percentage),
    seats_contested: integerOrUndefined(contest.rows.find((row) => row.seats_contested_calc)?.seats_contested_calc),
    review_status: turnoutVotes > 0 && resultRows.length > 1 ? "reviewed_with_warnings" : "quarantined",
    upstream: {
      system: "DCLEAPIL",
      council: contest.council,
      ward: contest.ward,
      exact_gss_match: true,
      note: "Supplemental exact-GSS history from DCLEAPIL/LEAP cache; use only where boundary-code continuity is confirmed by source GSS."
    },
    result_rows: resultRows
  };
}

export async function importDcleapilSupplementalHistory({
  dcleapilPath,
  sourceSnapshot,
  boundaries = [],
  existingHistory = [],
  sourceUrl = sourceSnapshot?.source_url
}) {
  if (!dcleapilPath || !sourceSnapshot) return [];
  const boundaryByCode = new Map(boundaries
    .filter((boundary) => /^[EWSN]\d{8}$/.test(boundary.area_code))
    .map((boundary) => [boundary.area_code, boundary]));
  const existingContestKeys = new Set(existingHistory
    .filter((record) => record.review_status !== "quarantined")
    .map((record) => `${record.area_code}::${record.election_date}`));
  const contests = new Map();
  let headers = null;

  const stream = readline.createInterface({
    input: createReadStream(dcleapilPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of stream) {
    if (!headers) {
      headers = parseCsvLine(line).map((header) => header.replace(/^\uFEFF/, "").trim());
      continue;
    }
    if (!line.trim()) continue;
    const row = rowFromLine(headers, line);
    const boundary = boundaryByCode.get(row.GSS);
    if (!boundary) continue;
    const electionDate = dateFromRow(row);
    if (existingContestKeys.has(`${row.GSS}::${electionDate}`)) continue;
    const key = `${row.GSS}::${electionDate}::${row.council}::${row.ward}`;
    const contest = contests.get(key) || {
      areaCode: row.GSS,
      council: row.council,
      ward: row.LEAP_post_label || row.ward,
      electionDate,
      rows: []
    };
    contest.rows.push(row);
    contests.set(key, contest);
  }

  return [...contests.entries()]
    .map(([key, contest]) => buildRecord({
      key,
      contest,
      boundary: boundaryByCode.get(contest.areaCode),
      sourceSnapshot,
      sourceUrl
    }))
    .filter((record) => record.result_rows.length > 0 && record.turnout_votes > 0)
    .sort((left, right) => `${left.area_code}:${left.election_date}`.localeCompare(`${right.area_code}:${right.election_date}`));
}
