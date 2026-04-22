import { spawnSync } from "node:child_process";
import { compileAreaFeatureSnapshot } from "./area-feature-compiler.mjs";

function slug(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function integerOrUndefined(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pctToShare(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) return undefined;
  return numeric > 1 ? numeric / 100 : numeric;
}

function normaliseName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function partyName(row) {
  const names = String(row.party_names || "").split(" + ").filter(Boolean);
  if (names.some((name) => /^Labour$/i.test(name)) && names.some((name) => /^Co-operative Party$/i.test(name))) {
    return "Labour (Co-op)";
  }
  if (names.length > 0) return names.join(" + ");
  if (Number(row.is_standing_as_independent) === 1) return "Independent";
  return "Unknown";
}

function constituencyAsylumContext(areaName, constituencyAsylum = {}) {
  const constituencies = constituencyAsylum?.constituencies || {};
  const normalisedName = normaliseName(areaName);
  const [matchedName, row] = Object.entries(constituencies).find(([name, value]) =>
    normaliseName(name) === normalisedName || normaliseName(value?.area_name) === normalisedName
  ) || [];
  if (!row) return null;
  return {
    supported_asylum_stock: integerOrUndefined(row.asylum_seekers) || 0,
    rate_per_10000_population: numberOrNull(row.asylum_rate_per_10k) || 0,
    population: integerOrUndefined(row.population),
    white_british_pct: pctToShare(row.white_british_pct),
    unit: "quarter_end_stock",
    route_scope: "asylum_support",
    precision: "constituency_context",
    matched_area_name: row.area_name || matchedName,
    matched_constituency_names: [matchedName].filter(Boolean)
  };
}

function officialConstituencyAsylumContext(areaCode, localAsylum = {}, crosswalk = {}) {
  const areas = Array.isArray(localAsylum?.areas) ? localAsylum.areas : [];
  const areaByCode = new Map(areas.map((area) => [area.areaCode, area]));
  const links = (crosswalk?.rows || []).filter((row) => row.pcon24cd === areaCode);
  if (links.length === 0) return null;

  let supportedAsylum = 0;
  let population = 0;
  const localAuthorities = [];
  const accommodation = {
    initial: 0,
    dispersal: 0,
    contingency: 0,
    other: 0,
    subsistenceOnly: 0
  };
  for (const link of links) {
    const localAuthority = areaByCode.get(link.lad25cd);
    if (!localAuthority) continue;
    const weight = Math.max(0, numberOrNull(link.lad_postcode_share) || 0);
    if (weight <= 0) continue;
    supportedAsylum += (Number(localAuthority.supportedAsylum) || 0) * weight;
    population += (Number(localAuthority.population) || 0) * weight;
    for (const key of Object.keys(accommodation)) {
      accommodation[key] += (Number(localAuthority.asylumAccommodationBreakdown?.[key]) || 0) * weight;
    }
    localAuthorities.push({
      area_code: localAuthority.areaCode,
      area_name: localAuthority.areaName,
      postcode_weight: weight,
      pcon_postcode_share: numberOrNull(link.pcon_postcode_share),
      postcode_count: integerOrUndefined(link.postcode_count)
    });
  }
  if (localAuthorities.length === 0) return null;
  const roundedSupportedAsylum = Math.round(supportedAsylum);
  const roundedPopulation = Math.round(population);
  return {
    supported_asylum_stock: roundedSupportedAsylum,
    rate_per_10000_population: roundedPopulation > 0 ? (roundedSupportedAsylum / roundedPopulation) * 10000 : 0,
    population: roundedPopulation || undefined,
    unit: "quarter_end_stock",
    route_scope: "asylum_support",
    precision: "constituency_estimate",
    snapshot_date: localAsylum.snapshotDate || null,
    apportionment_method: "ons_postcode_directory_pcon24_lad25_live_postcode_weighted",
    apportionment_basis: crosswalk.method?.apportionment_basis || "live_postcode_count",
    matched_local_authorities: localAuthorities.sort((left, right) => left.area_code.localeCompare(right.area_code)),
    accommodation_breakdown_estimate: Object.fromEntries(Object.entries(accommodation).map(([key, value]) => [key, Math.round(value)])),
    limitations: [
      "Home Office asylum support stock is published by local authority, not Westminster constituency.",
      "This constituency estimate apportions local-authority stock with ONSPD live-postcode counts. It is documented and reproducible, but not a resident, elector, household, or accommodation-location weighted allocation."
    ]
  };
}

function populationProjection(asylumContext) {
  if (asylumContext?.precision === "constituency_estimate") {
    return {
      base_year: 2025,
      projection_year: 2026,
      scenario: "official_local_authority_context_apportioned_to_constituency",
      method: "area_proxy",
      quality_level: "ons_total_only",
      source_depth: "total_population_only",
      geography_fit: "constituency_proxy",
      confidence: "low",
      limitations: [
        "Population total is apportioned from Home Office local-authority population denominators using the same ONSPD live-postcode crosswalk as the asylum context.",
        "Use as constituency context until a population-weighted PCON24 method is imported."
      ],
      total_population: integerOrUndefined(asylumContext.population)
    };
  }
  return {
    base_year: 2021,
    projection_year: 2026,
    scenario: "constituency_context",
    method: "manual_context",
    quality_level: "proxy",
    source_depth: "proxy_context",
    geography_fit: "constituency_proxy",
    confidence: "low",
    limitations: [
      "Commons Library election database supplies official electoral history, not a constituency component population projection.",
      "Population context is a Labour tracker/UKD proxy where matched; otherwise the model keeps population readiness at proxy-context level."
    ],
    total_population: integerOrUndefined(asylumContext?.population)
  };
}

function queryRows(dbPath) {
  const query = `
WITH party_labels AS (
  SELECT
    cert.candidacy_id,
    group_concat(pp.name, ' + ') AS party_names,
    group_concat(pp.abbreviation, ' + ') AS party_abbreviations
  FROM certifications cert
  JOIN political_parties pp ON pp.id = cert.political_party_id
  GROUP BY cert.candidacy_id
)
SELECT
  ge.id AS general_election_id,
  ge.polling_on AS polling_on,
  ge.is_notional AS general_election_is_notional,
  e.id AS election_id,
  e.valid_vote_count AS valid_vote_count,
  e.invalid_vote_count AS invalid_vote_count,
  e.majority AS majority,
  e.is_verified AS is_verified,
  elect.population_count AS electorate,
  ca.name AS area_name,
  ca.geographic_code AS area_code,
  bs.start_on AS boundary_start_on,
  bs.description AS boundary_description,
  c.id AS candidacy_id,
  trim(coalesce(c.candidate_given_name, '') || ' ' || coalesce(c.candidate_family_name, '')) AS candidate_name,
  c.is_standing_as_independent AS is_standing_as_independent,
  c.is_notional AS candidacy_is_notional,
  c.result_position AS result_position,
  c.is_winning_candidacy AS is_winning_candidacy,
  c.vote_count AS vote_count,
  c.vote_share AS vote_share,
  pl.party_names AS party_names,
  pl.party_abbreviations AS party_abbreviations
FROM general_elections ge
JOIN elections e ON e.general_election_id = ge.id
JOIN constituency_groups cg ON cg.id = e.constituency_group_id
JOIN constituency_areas ca ON ca.id = cg.constituency_area_id
LEFT JOIN boundary_sets bs ON bs.id = ca.boundary_set_id
LEFT JOIN electorates elect ON elect.id = e.electorate_id
JOIN candidacies c ON c.election_id = e.id
LEFT JOIN party_labels pl ON pl.candidacy_id = c.id
WHERE ge.id IN (5, 6)
  AND ca.geographic_code IS NOT NULL
ORDER BY ca.geographic_code, ge.polling_on, c.result_position;
`;
  const result = spawnSync("sqlite3", ["-json", dbPath, query], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`sqlite3 failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout || "[]");
}

function queryOverlapRows(dbPath) {
  const query = `
WITH party_labels AS (
  SELECT
    cert.candidacy_id,
    group_concat(pp.name, ' + ') AS party_names,
    group_concat(pp.abbreviation, ' + ') AS party_abbreviations
  FROM certifications cert
  JOIN political_parties pp ON pp.id = cert.political_party_id
  GROUP BY cert.candidacy_id
),
current_constituencies AS (
  SELECT DISTINCT ca.id, ca.name, ca.geographic_code
  FROM general_elections ge
  JOIN elections e ON e.general_election_id = ge.id
  JOIN constituency_groups cg ON cg.id = e.constituency_group_id
  JOIN constituency_areas ca ON ca.id = cg.constituency_area_id
  WHERE ge.id = 6
)
SELECT
  ge.id AS general_election_id,
  ge.polling_on AS polling_on,
  e.id AS source_election_id,
  e.valid_vote_count AS valid_vote_count,
  elect.population_count AS electorate,
  old_ca.name AS source_area_name,
  old_ca.geographic_code AS source_area_code,
  current_constituencies.name AS area_name,
  current_constituencies.geographic_code AS area_code,
  o.from_constituency_population AS overlap_weight,
  o.formed_from_whole_of AS formed_from_whole_of,
  c.id AS candidacy_id,
  trim(coalesce(c.candidate_given_name, '') || ' ' || coalesce(c.candidate_family_name, '')) AS candidate_name,
  c.is_standing_as_independent AS is_standing_as_independent,
  c.vote_count AS vote_count,
  pl.party_names AS party_names,
  pl.party_abbreviations AS party_abbreviations
FROM constituency_area_overlaps o
JOIN constituency_areas old_ca ON old_ca.id = o.from_constituency_area_id
JOIN current_constituencies ON current_constituencies.id = o.to_constituency_area_id
JOIN constituency_groups cg ON cg.constituency_area_id = old_ca.id
JOIN elections e ON e.constituency_group_id = cg.id
JOIN general_elections ge ON ge.id = e.general_election_id
LEFT JOIN electorates elect ON elect.id = e.electorate_id
JOIN candidacies c ON c.election_id = e.id
LEFT JOIN party_labels pl ON pl.candidacy_id = c.id
WHERE ge.id IN (1, 2, 3)
  AND current_constituencies.geographic_code IS NOT NULL
ORDER BY current_constituencies.geographic_code, ge.polling_on, source_area_code;
`;
  const result = spawnSync("sqlite3", ["-json", dbPath, query], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`sqlite3 failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout || "[]");
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = keyFn(row);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return groups;
}

function buildResultRows(rows) {
  return rows
    .filter((row) => Number.isFinite(Number(row.vote_count)))
    .sort((left, right) => Number(left.result_position) - Number(right.result_position))
    .map((row, index) => ({
      candidate_or_party_name: row.candidate_name || partyName(row),
      party_name: partyName(row),
      votes: Math.max(0, Math.round(Number(row.vote_count))),
      vote_share: numberOrNull(row.vote_share) ?? 0,
      rank: integerOrUndefined(row.result_position) || index + 1,
      elected: Number(row.is_winning_candidacy) === 1,
      incumbent: false
    }));
}

function buildOverlapHistoryRows(overlapRows, sourceSnapshot, sourceUrl) {
  const history = [];
  const rowsByAreaElection = groupBy(overlapRows, (row) => `${row.area_code}::${row.polling_on}`);
  for (const rows of rowsByAreaElection.values()) {
    const first = rows[0];
    const partyVotes = new Map();
    const sourceAreaCodes = new Set();
    let weightedElectorate = 0;
    let weightedValidVotes = 0;
    for (const row of rows) {
      const weight = Math.max(0, numberOrNull(row.overlap_weight) || 0);
      if (weight <= 0) continue;
      const party = partyName(row);
      partyVotes.set(party, (partyVotes.get(party) || 0) + Math.max(0, Number(row.vote_count) || 0) * weight);
      sourceAreaCodes.add(row.source_area_code);
      weightedElectorate += (Number(row.electorate) || 0) * weight;
      weightedValidVotes += (Number(row.valid_vote_count) || 0) * weight;
    }
    const totalVotes = [...partyVotes.values()].reduce((sum, value) => sum + value, 0);
    if (totalVotes <= 0) continue;
    const resultRows = [...partyVotes.entries()]
      .map(([party, votes]) => ({ party, votes: Math.round(votes) }))
      .filter((row) => row.votes > 0)
      .sort((left, right) => right.votes - left.votes)
      .map((row, index, allRows) => {
        const roundedTotal = allRows.reduce((sum, item) => sum + item.votes, 0);
        return {
          candidate_or_party_name: row.party,
          party_name: row.party,
          votes: row.votes,
          vote_share: roundedTotal > 0 ? row.votes / roundedTotal : 0,
          rank: index + 1,
          elected: index === 0,
          incumbent: false
        };
      });
    const turnoutVotes = resultRows.reduce((sum, row) => sum + row.votes, 0);
    history.push({
      history_id: `commons-library.westminster.${slug(first.area_code)}.${first.polling_on}.overlap-weighted`,
      contest_id: `westminster.${slug(first.area_code)}.${first.polling_on}.overlap-weighted`,
      area_id: `commons-library.westminster.${slug(first.area_code)}.2024`,
      area_code: first.area_code,
      area_name: first.area_name,
      boundary_version_id: `commons-library.westminster.${slug(first.area_code)}.2024`,
      election_date: first.polling_on,
      election_type: "westminster",
      voting_system: "fptp",
      source_snapshot_id: sourceSnapshot.snapshot_id,
      source_url: sourceUrl,
      electorate: Math.round(weightedElectorate),
      turnout_votes: turnoutVotes,
      reported_turnout_votes: Math.round(weightedValidVotes),
      seats_contested: 1,
      review_status: "reviewed_with_warnings",
      upstream: {
        system: "House of Commons Library",
        synthetic_current_boundary_history: true,
        overlap_method: "from_constituency_population_weighted_party_votes",
        source_area_codes: [...sourceAreaCodes].sort(),
        source_warning: "Synthetic current-boundary party history derived from Commons Library official results and constituency-area overlap weights. It is suitable for model calibration review, not a substitute for official notional candidate declarations."
      },
      result_rows: resultRows
    });
  }
  return history.sort((left, right) => `${left.area_code}:${left.election_date}`.localeCompare(`${right.area_code}:${right.election_date}`));
}

export function importCommonsLibraryWestminsterResults({
  dbPath,
  sourceSnapshot,
  pollAggregate = null,
  constituencyAsylum = null,
  constituencyAsylumSnapshot = null,
  localAsylum = null,
  localAsylumSnapshot = null,
  constituencyLocalAuthorityCrosswalk = null,
  constituencyLocalAuthorityCrosswalkSnapshot = null,
  asOf
}) {
  const rows = queryRows(dbPath);
  const overlapRows = queryOverlapRows(dbPath);
  const sourceUrl = sourceSnapshot.source_url;
  const boundaries = [];
  const history = buildOverlapHistoryRows(overlapRows, sourceSnapshot, sourceUrl);
  const featureSnapshots = [];
  const rowsByElection = groupBy(rows, (row) => row.election_id);
  const rowsByArea = groupBy(rows, (row) => row.area_code);
  const overlapRowsByArea = groupBy(overlapRows, (row) => row.area_code);
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);

  for (const [areaCode, areaRows] of rowsByArea.entries()) {
    const currentRows = areaRows.find((row) => Number(row.general_election_id) === 6) ? areaRows : [];
    const current = currentRows.find((row) => Number(row.general_election_id) === 6) || areaRows[0];
    const earliestPollingDate = [
      ...areaRows.map((row) => row.polling_on),
      ...(overlapRowsByArea.get(areaCode) || []).map((row) => row.polling_on)
    ].filter(Boolean).sort()[0] || current.boundary_start_on || "2024-05-30";
    const boundaryVersionId = `commons-library.westminster.${slug(areaCode)}.2024`;
    boundaries.push({
      boundary_version_id: boundaryVersionId,
      area_type: "westminster_constituency",
      area_code: areaCode,
      area_name: current.area_name,
      valid_from: earliestPollingDate,
      valid_to: null,
      predecessor_boundary_version_ids: [],
      successor_boundary_version_ids: [],
      source_snapshot_id: sourceSnapshot.snapshot_id,
      source_url: sourceUrl,
      review_status: "reviewed",
      upstream: {
        system: "House of Commons Library",
        model_family: "westminster_fptp",
        boundary_revision: "2024",
        area_code_method: "commons_library_ons_code",
        boundary_description: current.boundary_description || null
      }
    });
  }

  for (const [electionId, electionRows] of rowsByElection.entries()) {
    const first = electionRows[0];
    const boundaryVersionId = `commons-library.westminster.${slug(first.area_code)}.2024`;
    const resultRows = buildResultRows(electionRows);
    const voteTotal = resultRows.reduce((sum, row) => sum + row.votes, 0);
    if (resultRows.length === 0 || voteTotal <= 0) continue;
    history.push({
      history_id: `commons-library.westminster.${slug(first.area_code)}.${first.polling_on}.${first.general_election_is_notional ? "notional" : "actual"}`,
      contest_id: `westminster.${slug(first.area_code)}.${first.polling_on}.${first.general_election_is_notional ? "notional" : "actual"}`,
      area_id: boundaryVersionId,
      area_code: first.area_code,
      area_name: first.area_name,
      boundary_version_id: boundaryVersionId,
      election_date: first.polling_on,
      election_type: "westminster",
      voting_system: "fptp",
      source_snapshot_id: sourceSnapshot.snapshot_id,
      source_url: sourceUrl,
      electorate: integerOrUndefined(first.electorate),
      turnout_votes: voteTotal,
      seats_contested: 1,
      review_status: Number(first.general_election_is_notional) === 1 ? "reviewed_with_warnings" : "reviewed",
      upstream: {
        system: "House of Commons Library",
        general_election_id: first.general_election_id,
        election_id: electionId,
        notional: Number(first.general_election_is_notional) === 1,
        valid_vote_count: integerOrUndefined(first.valid_vote_count),
        invalid_vote_count: integerOrUndefined(first.invalid_vote_count),
        majority: integerOrUndefined(first.majority),
        is_verified: Number(first.is_verified) === 1
      },
      result_rows: resultRows
    });
  }

  const boundaryByAreaCode = new Map(boundaries.map((boundary) => [boundary.area_code, boundary]));
  for (const [areaCode, areaRows] of rowsByArea.entries()) {
    const current = areaRows.find((row) => Number(row.general_election_id) === 6) || areaRows[0];
    const boundary = boundaryByAreaCode.get(areaCode);
    const officialAsylumContext = officialConstituencyAsylumContext(areaCode, localAsylum, constituencyLocalAuthorityCrosswalk);
    const trackerAsylumContext = constituencyAsylumContext(current.area_name, constituencyAsylum);
    const asylumContext = officialAsylumContext || trackerAsylumContext;
    const populationSnapshot = officialAsylumContext
      ? (localAsylumSnapshot || constituencyLocalAuthorityCrosswalkSnapshot || sourceSnapshot)
      : (constituencyAsylumSnapshot || sourceSnapshot);
    const provenance = [
      {
        field: "features.electoral_history",
        source_snapshot_id: sourceSnapshot.snapshot_id,
        source_url: sourceUrl,
        notes: "House of Commons Library election database: 2024 actual and 2019 notional Westminster results on 2024 boundaries."
      },
      pollAggregate && {
        field: "features.poll_context",
        source_snapshot_id: sourceSnapshot.snapshot_id,
        source_url: sourceUrl,
        notes: "GB poll aggregate attached as contextual Westminster baseline input."
      },
      {
        field: "features.population_projection",
        source_snapshot_id: populationSnapshot.snapshot_id,
        source_url: populationSnapshot.source_url || sourceUrl,
        notes: officialAsylumContext
          ? "Home Office local-authority population denominator apportioned to constituency using ONSPD PCON24-LAD25 live-postcode crosswalk."
          : asylumContext
          ? "Labour tracker/UKD constituency asylum file supplies proxy population context."
          : "No matched constituency population projection was found; model is held at proxy-context readiness."
      },
      officialAsylumContext && localAsylumSnapshot && {
        field: "features.asylum_context",
        source_snapshot_id: localAsylumSnapshot.snapshot_id,
        source_url: localAsylumSnapshot.source_url,
        notes: "Official Home Office local-authority asylum support stock apportioned to Westminster constituency using ONSPD PCON24-LAD25 live-postcode weights."
      },
      officialAsylumContext && constituencyLocalAuthorityCrosswalkSnapshot && {
        field: "features.asylum_context",
        source_snapshot_id: constituencyLocalAuthorityCrosswalkSnapshot.snapshot_id,
        source_url: constituencyLocalAuthorityCrosswalkSnapshot.source_url,
        notes: "ONS Open Geography ONSPD Live crosswalk between PCON24 and LAD25 geographies."
      },
      !officialAsylumContext && asylumContext && constituencyAsylumSnapshot && {
        field: "features.asylum_context",
        source_snapshot_id: constituencyAsylumSnapshot.snapshot_id,
        source_url: constituencyAsylumSnapshot.source_url,
        notes: "Labour tracker constituency asylum support stock; used as constituency-level context."
      }
    ].filter(Boolean);
    const snapshot = compileAreaFeatureSnapshot({
      area: { area_code: areaCode, area_name: current.area_name },
      modelFamily: "westminster_fptp",
      boundaryVersion: boundary,
      historyRecords: history,
      pollAggregate,
      asylumContext,
      populationProjection: populationProjection(asylumContext),
      provenance,
      asOf: asOfDate
    });
    featureSnapshots.push({
      ...snapshot,
      review_status: "reviewed_with_warnings",
      features: {
        ...snapshot.features,
        election_context: {
          latest_election_date: "2024-07-04",
          election_cycle: "uk_general_election",
          contested_at_next_election: false,
          candidacy_source: null
        }
      }
    });
  }

  return { boundaries, history, featureSnapshots };
}
