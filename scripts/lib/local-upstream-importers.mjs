import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildSourceSnapshot } from "./source-fetcher.mjs";
import { compileAreaFeatureSnapshot } from "./area-feature-compiler.mjs";

const DEFAULT_SOURCE_URL = "https://ukelections.co.uk/sources";
const UNKNOWN_LICENCE = "Inherited upstream licence; confirm before public release";

function slug(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stableId(prefix, parts) {
  const seed = JSON.stringify(parts);
  return `${prefix}-${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`;
}

function toDate(value, fallback = "1900-01-01") {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value.slice(0, 10);
  }
  return fallback;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function integerOrUndefined(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function pctToShare(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) return undefined;
  return numeric > 1 ? numeric / 100 : numeric;
}

function turnoutShare(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) return undefined;
  if (numeric >= 0 && numeric <= 1) return numeric;
  if (numeric > 1 && numeric <= 100) return numeric / 100;
  return undefined;
}

function wardEntries(wards) {
  if (Array.isArray(wards)) {
    return wards.map((ward, index) => [ward.name || ward.ward || `ward-${index + 1}`, ward]);
  }
  return Object.entries(wards || {});
}

function partyId(partyName) {
  return slug(partyName || "independent");
}

function normaliseName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bward\b/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function codeFromNameMap(map, name) {
  return map?.get(normaliseName(name)) || null;
}

function mapElectionType(type, councilTier) {
  const text = String(type || "").toLowerCase();
  if (text.includes("parliament") || text.includes("westminster")) return "westminster";
  if (text.includes("senedd")) return "senedd";
  if (text.includes("scottish")) return "scottish_parliament";
  if (text.includes("county") || councilTier === "county") return "county";
  if (text.includes("unitary") || councilTier === "unitary") return "unitary";
  return "borough";
}

function mapModelFamily(electionType, councilTier) {
  if (electionType === "county" || councilTier === "county") return "local_fptp_county";
  if (electionType === "unitary" || councilTier === "unitary") return "local_fptp_unitary";
  return "local_fptp_borough";
}

function mapAreaType(councilTier) {
  if (councilTier === "county") return "county_division";
  return "ward";
}

function earliestHistoryDate(ward) {
  const dates = (ward.history || [])
    .map((row) => toDate(row.date, null))
    .filter(Boolean)
    .sort();
  return dates[0] || "1900-01-01";
}

function candidateVoteRows(candidates) {
  const filtered = (candidates || [])
    .filter((candidate) => Number.isFinite(Number(candidate.votes)))
    .map((candidate) => ({
      candidate,
      votes: Math.max(0, Math.round(Number(candidate.votes)))
    }))
    .sort((left, right) => right.votes - left.votes);

  const hasElected = filtered.some(({ candidate }) => candidate.elected === true);
  const voteTotal = filtered.reduce((sum, row) => sum + row.votes, 0);

  return filtered.map(({ candidate, votes }, index) => ({
    candidate_or_party_name: candidate.name || candidate.party || "Unknown",
    party_name: candidate.party || "Independent",
    votes,
    vote_share: voteTotal > 0 ? votes / voteTotal : 0,
    rank: index + 1,
    elected: Boolean(candidate.elected) || (!hasElected && index === 0),
    incumbent: Boolean(candidate.incumbent)
  }));
}

function normaliseShares(shares = {}) {
  const entries = Object.entries(shares)
    .map(([party, value]) => [party, Number(value)])
    .filter(([, value]) => Number.isFinite(value) && value >= 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return {};
  return Object.fromEntries(entries.map(([party, value]) => [party, value / total]));
}

function pollSourceUrl(poll, fallback) {
  const source = String(poll.source_url || poll.source || "").trim();
  if (/^https?:\/\//.test(source)) return source;
  return fallback;
}

function isLancashireCouncilId(councilId) {
  return new Set([
    "blackburn",
    "blackpool",
    "burnley",
    "chorley",
    "fylde",
    "hyndburn",
    "lancashire_cc",
    "lancaster",
    "pendle",
    "preston",
    "ribble_valley",
    "rossendale",
    "south_ribble",
    "west_lancashire",
    "wyre"
  ]).has(councilId);
}

function candidateSourceForArea(candidateSourceManifest = [], councilId, areaName) {
  const source = candidateSourceManifest.find((row) => row.council_id === councilId);
  if (!source) return null;
  const wardUrl = source.ward_sources?.[areaName];
  return {
    ...source,
    official_url: wardUrl || source.official_url || source.official_page_url
  };
}

function latestProjectionYear(projections, targetYear) {
  const years = Object.keys(projections || {})
    .filter((year) => /^\d{4}$/.test(year))
    .map(Number)
    .sort((left, right) => left - right);
  if (years.length === 0) return null;
  return years.find((year) => year >= targetYear) || years[years.length - 1];
}

function projectionFeatureFromWard({ wardProjection, demographics, targetYear, ukdAreaAvailable, limitations = [] }) {
  const projectionYear = latestProjectionYear(wardProjection?.ethnicity, targetYear);
  const projection = projectionYear ? wardProjection.ethnicity[String(projectionYear)] : null;
  const totalPopulation = projection?._total || demographics?.population || demographics?.total_population;
  const hpBacked = Boolean(wardProjection && ukdAreaAvailable);

  if (projection) {
    return {
      base_year: 2021,
      projection_year: projectionYear,
      scenario: "central",
      method: hpBacked ? "census_2021_rebased_component" : "ons_snpp_constrained",
      quality_level: hpBacked ? "rebased_partial" : "ons_total_only",
      source_depth: "ethnicity_total_only",
      geography_fit: "exact_area",
      confidence: hpBacked ? "medium" : "low",
      limitations: [
        "AI DOGE ward projection imported from local upstream and remains quarantined until source review.",
        "Ward-level projection is modelled; check boundary year and source table before publication.",
        ...limitations
      ],
      total_population: integerOrUndefined(totalPopulation),
      white_pct: pctToShare(projection.White?.pct),
      white_british_pct: pctToShare(projection["White: English, Welsh, Scottish, Northern Irish or British"]?.pct),
      asian_pct: pctToShare(projection["Asian, Asian British or Asian Welsh"]?.pct),
      pakistani_pct: pctToShare(projection["Asian, Asian British or Asian Welsh: Pakistani"]?.pct),
      black_pct: pctToShare(projection["Black, Black British, Black Welsh, Caribbean or African"]?.pct),
      mixed_pct: pctToShare(projection["Mixed or Multiple ethnic groups"]?.pct),
      other_pct: pctToShare(projection["Other ethnic group"]?.pct)
    };
  }

  return {
    base_year: 2021,
    projection_year: 2021,
    scenario: "census_baseline",
    method: "census_static",
    quality_level: "census_baseline_only",
    source_depth: "ethnicity_total_only",
    geography_fit: demographics ? "exact_area" : "local_authority_proxy",
    confidence: "low",
    limitations: [
      "No ward projection found in the local upstream; use as static Census 2021 context only.",
      ...limitations
    ],
    total_population: integerOrUndefined(totalPopulation)
  };
}

function constituencyAsylumContext(councilName, constituencyAsylum = {}) {
  if (!constituencyAsylum) return null;
  const constituencies = constituencyAsylum.constituencies || {};
  const exact = constituencies[councilName];
  if (!exact) return null;
  return {
    supported_asylum_stock: integerOrUndefined(exact.asylum_seekers) || 0,
    rate_per_10000_population: numberOrNull(exact.asylum_rate_per_10k) || 0,
    population: integerOrUndefined(exact.population),
    white_british_pct: pctToShare(exact.white_british_pct),
    unit: "quarter_end_stock",
    route_scope: "asylum_support",
    precision: "constituency_context"
  };
}

export function buildLocalFileSourceSnapshot({
  filePath,
  sourceName,
  sourceUrl = DEFAULT_SOURCE_URL,
  licence = UNKNOWN_LICENCE,
  retrievedAt
}) {
  const absolutePath = path.resolve(filePath);
  const content = readFileSync(absolutePath, "utf8");
  return buildSourceSnapshot({
    sourceName,
    sourceUrl,
    licence,
    rawFilePath: absolutePath,
    content,
    contentType: absolutePath.endsWith(".json") ? "application/json" : "",
    retrievedAt
  });
}

export function importAidogeElectionData({
  electionData,
  sourceSnapshot,
  sourceUrl = sourceSnapshot.source_url,
  candidateSourceManifest = [],
  candidateSourceSnapshot = null,
  areaCodeByName = new Map()
}) {
  const meta = electionData.meta || {};
  const councilId = meta.council_id || "unknown-council";
  const councilTier = meta.council_tier || (councilId.endsWith("_cc") ? "county" : "district");
  const areaType = mapAreaType(councilTier);
  const boundaries = [];
  const history = [];
  const candidateRosters = [];
  const boundaryByAreaCode = new Map();

  for (const [wardName, ward] of wardEntries(electionData.wards)) {
    const areaName = ward.name || wardName;
    const areaCode = ward.gss_code || codeFromNameMap(areaCodeByName, areaName) || `local:${councilId}:${slug(areaName)}`;
    const validFrom = earliestHistoryDate(ward);
    const boundaryVersionId = `ai-doge.${slug(councilId)}.${slug(areaCode)}.${validFrom}`;
    const electionType = mapElectionType(meta.next_election?.type || ward.history?.[0]?.type, councilTier);
    const modelFamily = mapModelFamily(electionType, councilTier);

    const boundary = {
      boundary_version_id: boundaryVersionId,
      area_type: areaType,
      area_code: areaCode,
      area_name: areaName,
      valid_from: validFrom,
      valid_to: null,
      predecessor_boundary_version_ids: [],
      successor_boundary_version_ids: [],
      source_snapshot_id: sourceSnapshot.snapshot_id,
      source_url: sourceUrl,
      review_status: "quarantined",
      upstream: {
        system: "AI DOGE",
        council_id: councilId,
        council_name: meta.council_name || councilId,
        model_family: modelFamily,
        boundary_note: "Current upstream ward span. Historical boundary-change audit is still required before public claims."
      }
    };
    boundaries.push(boundary);
    boundaryByAreaCode.set(areaCode, boundary);

    (ward.history || []).forEach((contest, index) => {
      const resultRows = candidateVoteRows(contest.candidates);
      if (resultRows.length === 0) return;
      const electionDate = toDate(contest.date);
      const voteTotal = resultRows.reduce((sum, row) => sum + row.votes, 0);
      history.push({
        history_id: `ai-doge.${slug(councilId)}.${slug(areaCode)}.${electionDate}.${index + 1}`,
        contest_id: `local.${slug(councilId)}.${slug(areaCode)}.${electionDate}`,
        area_id: boundaryVersionId,
        area_code: areaCode,
        area_name: areaName,
        boundary_version_id: boundaryVersionId,
        election_date: electionDate,
        election_type: mapElectionType(contest.type, councilTier),
        voting_system: "fptp",
        source_snapshot_id: sourceSnapshot.snapshot_id,
        source_url: sourceUrl,
        electorate: integerOrUndefined(contest.electorate ?? ward.electorate),
        turnout_votes: voteTotal,
        reported_turnout_votes: integerOrUndefined(contest.turnout_votes),
        turnout: turnoutShare(contest.turnout),
        seats_contested: integerOrUndefined(contest.seats_contested),
        review_status: "quarantined",
        result_rows: resultRows
      });
    });

    const candidates = (ward.candidates_2026 || []).filter((candidate) => candidate.name && candidate.party);
    if (candidates.length >= 2 && meta.next_election?.date) {
      const defenders = meta.next_election?.defenders || {};
      const defender = defenders[areaName];
      const currentHolders = new Set((ward.current_holders || []).map((holder) => normaliseName(holder.name)));
      let defendingAssigned = false;
      const statementSource = candidateSourceForArea(candidateSourceManifest, councilId, areaName);
      const statementDerived = Boolean(statementSource) || isLancashireCouncilId(councilId);
      const rosterSourceSnapshot = candidateSourceSnapshot || sourceSnapshot;
      const rosterSourceUrl = statementSource?.official_url || sourceUrl;
      candidateRosters.push({
        roster_id: `ai-doge-roster.${slug(councilId)}.${slug(areaCode)}.${toDate(meta.next_election.date)}`,
        contest_id: `local.${slug(councilId)}.${slug(areaCode)}.${toDate(meta.next_election.date)}`,
        area_code: areaCode,
        election_date: toDate(meta.next_election.date),
        source_snapshot_id: rosterSourceSnapshot.snapshot_id,
        statement_of_persons_nominated_url: rosterSourceUrl,
        source_basis: statementDerived ? "statement_of_persons_nominated" : "upstream_candidate_list",
        source_review_notes: statementDerived
          ? "AI DOGE Lancashire candidate rows are statement-of-persons-nominated derived and linked to the official notice source manifest."
          : "Candidate row source basis is not confirmed as a statement of persons nominated.",
        official_page_url: statementSource?.official_page_url,
        direct_statement_url_attached: Boolean(statementSource?.official_url),
        review_status: "quarantined",
        candidates: candidates.map((candidate, index) => {
          const normalised = normaliseName(candidate.name);
          const incumbent = currentHolders.has(normalised) || normaliseName(defender?.name) === normalised;
          const defendingSeat = !defendingAssigned && normaliseName(defender?.name) === normalised;
          if (defendingSeat) defendingAssigned = true;
          return {
            candidate_id: stableId("ai-doge-candidate", [councilId, areaCode, meta.next_election.date, candidate.name, candidate.party, index]),
            person_name: candidate.name,
            party_name: candidate.party,
            party_id: partyId(candidate.party),
            incumbent,
            defending_seat: defendingSeat,
            status: "standing",
            name_as_printed: candidate.name_as_printed,
            party_as_printed: candidate.party_as_printed
          };
        })
      });
    }
  }

  return { boundaries, history, candidateRosters, boundaryByAreaCode };
}

export function importAidogePollAggregate({
  pollingData = {},
  referenceData = {},
  sourceSnapshot,
  generatedAt
}) {
  const aggregateShares = normaliseShares(
    pollingData.aggregate || referenceData.national_polling?.parties || {}
  );
  const sourceUrl = sourceSnapshot.source_url;
  const polls = (pollingData.individual_polls || [])
    .filter((poll) => poll.pollster && poll.start_date && poll.end_date && poll.sample_size && poll.parties)
    .map((poll, index) => ({
      poll_id: stableId("poll", [poll.pollster, poll.start_date, poll.end_date, poll.sample_size, index]),
      pollster: poll.pollster,
      fieldwork_start: toDate(poll.start_date),
      fieldwork_end: toDate(poll.end_date),
      sample_size: Math.max(1, Math.round(Number(poll.sample_size))),
      source_url: pollSourceUrl(poll, sourceUrl),
      party_shares: normaliseShares(poll.parties),
      upstream_weight: numberOrNull(poll.weight)
    }));

  return {
    poll_aggregate_id: stableId("ai-doge-gb-poll-aggregate", [generatedAt || pollingData.meta?.generated || referenceData.meta?.generated, aggregateShares]),
    generated_at: generatedAt || pollingData.meta?.generated || referenceData.meta?.generated || new Date().toISOString(),
    geography: "GB",
    population: "adults_18_plus",
    method: "weighted_poll_average",
    half_life_days: integerOrUndefined(pollingData.meta?.half_life_days) || 21,
    poll_count: polls.length,
    aggregate_party_shares: aggregateShares,
    polls,
    review_status: "quarantined",
    provenance: {
      source_snapshot_id: sourceSnapshot.snapshot_id,
      source_url: sourceUrl,
      notes: "Imported from AI DOGE shared polling output. Pollster-level sources must be reviewed before public forecast claims."
    }
  };
}

export function buildAidogeFeatureSnapshots({
  electionData,
  boundaries,
  history,
  pollAggregate = null,
  demographicsData = null,
  projectionData = null,
  ukdBasePopulation = null,
  constituencyAsylum = null,
  sourceSnapshots,
  asOf,
  areaCodeByName = new Map()
}) {
  const meta = electionData.meta || {};
  const councilId = meta.council_id || "unknown-council";
  const councilTier = meta.council_tier || (councilId.endsWith("_cc") ? "county" : "district");
  const electionType = mapElectionType(meta.next_election?.type, councilTier);
  const modelFamily = mapModelFamily(electionType, councilTier);
  const asOfDate = toDate(asOf || meta.generated || new Date().toISOString());
  const targetYear = Number(asOfDate.slice(0, 4));
  const boundaryByAreaCode = new Map(boundaries.map((boundary) => [boundary.area_code, boundary]));
  const wardProjectionByCode = projectionData?.ward_projections || {};
  const demographicWardByCode = new Map();
  const ukdAreaAvailable = Boolean(demographicsData?.meta?.ons_code && ukdBasePopulation?.areas?.[demographicsData.meta.ons_code]);
  const asylumContext = constituencyAsylumContext(meta.council_name || councilId, constituencyAsylum);

  for (const [wardName, ward] of wardEntries(demographicsData?.wards || {})) {
    const areaCode = ward.gss_code || ward.code || `local:${councilId}:${slug(ward.name || wardName)}`;
    demographicWardByCode.set(areaCode, ward);
  }

  return wardEntries(electionData.wards).map(([wardName, ward]) => {
    const areaName = ward.name || wardName;
    const areaCode = ward.gss_code || codeFromNameMap(areaCodeByName, areaName) || `local:${councilId}:${slug(areaName)}`;
    const boundary = boundaryByAreaCode.get(areaCode);
    const wardProjection = wardProjectionByCode[areaCode] || wardProjectionByCode[areaName];
    const demographics = demographicWardByCode.get(areaCode);
    const populationProjection = projectionFeatureFromWard({
      wardProjection,
      demographics,
      targetYear,
      ukdAreaAvailable,
      limitations: [
        ukdAreaAvailable
          ? `UKD authority base population exists for ${demographicsData.meta.ons_code}; ward projection still needs boundary fit review.`
          : "No matching UKD authority base population found for this council in the current local model bundle."
      ]
    });

    const provenance = [
      sourceSnapshots.elections && {
        field: "features.electoral_history",
        source_snapshot_id: sourceSnapshots.elections.snapshot_id,
        source_url: sourceSnapshots.elections.source_url,
        notes: "AI DOGE ward election history import; boundary continuity requires review."
      },
      pollAggregate && sourceSnapshots.polling && {
        field: "features.poll_context",
        source_snapshot_id: sourceSnapshots.polling.snapshot_id,
        source_url: sourceSnapshots.polling.source_url,
        notes: "AI DOGE shared polling aggregate."
      },
      (sourceSnapshots.projections || sourceSnapshots.demographics) && {
        field: "features.population_projection",
        source_snapshot_id: (sourceSnapshots.projections || sourceSnapshots.demographics).snapshot_id,
        source_url: (sourceSnapshots.projections || sourceSnapshots.demographics).source_url,
        notes: ukdAreaAvailable
          ? "AI DOGE ward projection with UKD authority base population present."
          : "AI DOGE ward or census demographic context; lower confidence until UKD area match is confirmed."
      },
      asylumContext && sourceSnapshots.constituencyAsylum && {
        field: "features.asylum_context",
        source_snapshot_id: sourceSnapshots.constituencyAsylum.snapshot_id,
        source_url: sourceSnapshots.constituencyAsylum.source_url,
        notes: "Labour tracker constituency asylum stock; used as contextual area proxy, not ward-level claims."
      }
    ].filter(Boolean);

    const snapshot = compileAreaFeatureSnapshot({
      area: { area_code: areaCode, area_name: areaName },
      modelFamily,
      boundaryVersion: boundary,
      asOf: asOfDate,
      historyRecords: history,
      pollAggregate,
      asylumContext,
      populationProjection,
      provenance
    });
    const wardsUp = new Set(meta.next_election?.wards_up || []);
    return {
      ...snapshot,
      review_status: "quarantined",
      features: {
        ...snapshot.features,
        election_context: {
          next_election_date: meta.next_election?.date || null,
          election_cycle: meta.election_cycle || null,
          seats_per_ward: meta.seats_per_ward ?? null,
          contested_at_next_election: Boolean(meta.next_election?.date && (wardsUp.has(areaName) || (ward.candidates_2026 || []).length > 0)),
          candidacy_source: meta.next_election?.candidacy_data?.source || null
        }
      }
    };
  });
}
