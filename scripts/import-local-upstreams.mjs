#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSourceSnapshot } from "./lib/source-fetcher.mjs";
import {
  buildAidogeFeatureSnapshots,
  buildLocalFileSourceSnapshot,
  importAidogeConstituencyProfiles,
  importAidogeElectionData,
  importAidogePollAggregate
} from "./lib/local-upstream-importers.mjs";
import { importCommonsLibraryWestminsterResults } from "./lib/commons-library-results-importer.mjs";
import { importDcleapilSupplementalHistory } from "./lib/dcleapil-supplemental-history.mjs";
import { importHomeOfficeLocalAuthorityAsylum } from "./lib/home-office-local-authority-asylum-importer.mjs";
import { importOfficialHistoryRecords } from "./lib/official-history-importer.mjs";
import { validateSourceSnapshots, summariseSourceQuality } from "./lib/source-quality.mjs";
import { validateHistoryBundle } from "./lib/history-quality.mjs";
import { validateModelInputs } from "./lib/model-input-quality.mjs";
import { validateCandidateRosters } from "./lib/candidate-quality.mjs";
import { validateBoundaryMappings } from "./lib/boundary-mapping-quality.mjs";
import { buildBoundaryLineageMappings } from "./lib/boundary-lineage-builder.mjs";

const DEFAULTS = {
  aiDogeRoot: "/Users/tompickup/clawd/burnley-council/data",
  asylumModelRoot: "/Users/tompickup/asylumstats/data/model",
  localAsylumPath: "/Users/tompickup/asylumstats/data/marts/uk_routes/local-route-latest.json",
  homeOfficeLocalAuthorityDataPath: "/Users/tompickup/asylumstats/data/raw/uk_routes/regional-and-local-authority-dataset-dec-2025.ods",
  homeOfficeLocalAuthorityDataUrl: "https://assets.publishing.service.gov.uk/media/69959e60a58a315dbe72bf10/regional-and-local-authority-dataset-dec-2025.ods",
  pconLadCrosswalkPath: "data/ons-pcon24-lad25-postcode-crosswalk.json",
  constituencyAsylumPath: "/Users/tompickup/clawd/labour-tracker/constituency_asylum.json",
  constituencyProfilesPath: "/Users/tompickup/clawd/burnley-council/data/shared/constituencies.json",
  commonsResultsDbPath: "/tmp/psephology.db",
  commonsResultsDbUrl: "https://raw.githubusercontent.com/ukparliament/psephology-datasette/main/psephology.db?raw=true",
  dcleapilPath: "/Users/tompickup/clawd/burnley-council/scripts/election_data_cache/dcleapil_results.csv",
  officialHistoryPath: "data/lancaster-official-election-history.json",
  candidateSourceManifestPath: "data/lancashire-2026-sopn-sources.json",
  output: "/tmp/ukelections-local-upstreams",
  sourceUrl: "https://ukelections.co.uk/sources",
  licence: "Inherited upstream licence; confirm before public release"
};

function parseArgs(argv) {
  const args = { councils: [], maxCouncils: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ai-doge-root") args.aiDogeRoot = argv[++index];
    else if (arg === "--asylum-model-root") args.asylumModelRoot = argv[++index];
    else if (arg === "--local-asylum") args.localAsylumPath = argv[++index];
    else if (arg === "--home-office-local-authority-data") args.homeOfficeLocalAuthorityDataPath = argv[++index];
    else if (arg === "--home-office-local-authority-data-url") args.homeOfficeLocalAuthorityDataUrl = argv[++index];
    else if (arg === "--pcon-lad-crosswalk") args.pconLadCrosswalkPath = argv[++index];
    else if (arg === "--constituency-asylum") args.constituencyAsylumPath = argv[++index];
    else if (arg === "--constituency-profiles") args.constituencyProfilesPath = argv[++index];
    else if (arg === "--commons-results-db") args.commonsResultsDbPath = argv[++index];
    else if (arg === "--commons-results-db-url") args.commonsResultsDbUrl = argv[++index];
    else if (arg === "--dcleapil") args.dcleapilPath = argv[++index];
    else if (arg === "--official-history") args.officialHistoryPath = argv[++index];
    else if (arg === "--candidate-source-manifest") args.candidateSourceManifestPath = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--source-url") args.sourceUrl = argv[++index];
    else if (arg === "--licence") args.licence = argv[++index];
    else if (arg === "--max-councils") args.maxCouncils = Number(argv[++index]);
    else if (arg === "--council") args.councils.push(argv[++index]);
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { ...DEFAULTS, ...args };
}

function printHelp() {
  console.log(`Import local upstream model inputs.

Usage:
  node scripts/import-local-upstreams.mjs [options]

Options:
  --output <path>                Output directory. Defaults to /tmp/ukelections-local-upstreams
  --ai-doge-root <path>          AI DOGE data root containing council folders
  --asylum-model-root <path>     asylumstats/UKD model root
  --local-asylum <path>          asylumstats local route latest JSON
  --home-office-local-authority-data <path>
                                 Home Office regional/local authority ODS workbook
  --home-office-local-authority-data-url <url>
                                 Source URL for the Home Office local authority workbook
  --pcon-lad-crosswalk <path>    ONSPD-derived PCON24/LAD25 postcode-count crosswalk JSON
  --constituency-asylum <path>   Labour tracker constituency asylum JSON
  --constituency-profiles <path> AI DOGE Westminster constituency profile JSON
  --commons-results-db <path>    House of Commons Library psephology SQLite database
  --commons-results-db-url <url> URL used to fetch the Commons Library database when missing
  --dcleapil <path>              DCLEAPIL/LEAP local election results CSV cache
  --official-history <path>      Manual official ward-result supplement JSON
  --candidate-source-manifest <path>
                                 Lancashire SoPN source URL manifest
  --council <id>                 Import only one council id. Repeatable
  --max-councils <n>             Limit council count for smoke tests
  --source-url <url>             Public audit URL recorded in source snapshots
  --licence <text>               Licence string recorded in source snapshots
`);
}

function readJsonIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function discoverCouncilDirs(root, councilFilter) {
  if (!existsSync(root)) return [];
  const filter = new Set(councilFilter || []);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => existsSync(path.join(dir, "elections.json")))
    .filter((dir) => filter.size === 0 || filter.has(path.basename(dir)))
    .sort();
}

function snapshotFor(filePath, sourceName, options) {
  const acceptedFamilies = /AI DOGE|DCLEAPIL|UKD\/asylumstats|Labour tracker|Official|ONS Postcode Directory|ONS Open Geography|statements of persons nominated/i;
  return buildLocalFileSourceSnapshot({
    filePath,
    sourceName,
    sourceUrl: options.sourceUrl,
    licence: options.licence,
    qualityStatus: acceptedFamilies.test(sourceName) ? "accepted_with_warnings" : "quarantined",
    reviewNotes: acceptedFamilies.test(sourceName)
      ? "Local source snapshot is accepted for internal modelling with warnings; licence, upstream semantics, and public-release wording still need final review."
      : "Fetched automatically. Review licence, row semantics, and transformation notes before accepting."
  });
}

async function ensureDownloadedFile(filePath, sourceUrl) {
  if (existsSync(filePath) || !sourceUrl) return existsSync(filePath) ? filePath : null;
  mkdirSync(path.dirname(filePath), { recursive: true });
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": "UK Elections local upstream importer"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
  }
  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
  return filePath;
}

function binarySnapshotFor(filePath, sourceName, options, contentType = "application/octet-stream", sourceUrl = options.sourceUrl) {
  const absolutePath = path.resolve(filePath);
  const content = readFileSync(absolutePath);
  return {
    ...buildSourceSnapshot({
      sourceName,
      sourceUrl,
      licence: options.licence,
      rawFilePath: absolutePath,
      content,
      contentType
    }),
    quality_status: "accepted_with_warnings",
    review_notes: "Official binary source snapshot is accepted for internal modelling. Keep transformation queries and publication wording under review."
  };
}

function sourceSnapshotPush(target, snapshot) {
  if (!target.some((existing) => existing.snapshot_id === snapshot.snapshot_id)) {
    target.push(snapshot);
  }
  return snapshot;
}

function alignBoundaryValidFromWithHistory(boundaries, history) {
  const earliestByBoundaryId = new Map();
  for (const record of history) {
    const current = earliestByBoundaryId.get(record.boundary_version_id);
    if (!current || record.election_date < current) {
      earliestByBoundaryId.set(record.boundary_version_id, record.election_date);
    }
  }
  for (const boundary of boundaries) {
    const earliest = earliestByBoundaryId.get(boundary.boundary_version_id);
    if (earliest && (!boundary.valid_from || earliest < boundary.valid_from)) {
      boundary.valid_from = earliest;
    }
  }
}

function normaliseAreaName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bward\b/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactAreaName(value) {
  return normaliseAreaName(value)
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAreaCodeByName({ boundaryData, demographicsData, projectionData }) {
  const map = new Map();
  const add = (name, code) => {
    if (name && /^[EWSN]\d{8}$/.test(String(code))) {
      const normalised = normaliseAreaName(name);
      const compact = compactAreaName(name);
      if (!map.has(normalised)) map.set(normalised, code);
      if (!map.has(compact)) map.set(compact, code);
    }
  };

  for (const feature of boundaryData?.features || []) {
    add(feature.properties?.name, feature.properties?.ons_code);
  }
  const demographicWards = demographicsData?.wards || {};
  for (const [code, ward] of Object.entries(demographicWards)) {
    add(ward?.name || ward?.ward_name, code);
  }
  for (const [code, ward] of Object.entries(projectionData?.ward_projections || {})) {
    add(ward?.name, code);
  }
  return map;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let index = 0, prev = ring.length - 1; index < ring.length; prev = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[prev];
    const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!polygon?.length || !pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function pointInGeometry(point, geometry) {
  if (!point || !geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  return false;
}

function buildLocalAuthorityCodeByAreaCode(aiDogeRoot) {
  const districtFeatures = [];
  for (const districtDir of discoverCouncilDirs(aiDogeRoot, [])) {
    const councilId = path.basename(districtDir);
    if (councilId.endsWith("_cc")) continue;
    const boundaryData = readJsonIfExists(path.join(districtDir, "ward_boundaries.json"));
    const authorityCode = boundaryData?.meta?.ons_code;
    if (!authorityCode) continue;
    for (const feature of boundaryData.features || []) {
      districtFeatures.push({ authorityCode, feature });
    }
  }

  const map = new Map();
  for (const countyDir of discoverCouncilDirs(aiDogeRoot, []).filter((dir) => path.basename(dir).endsWith("_cc"))) {
    const countyBoundaries = readJsonIfExists(path.join(countyDir, "ward_boundaries.json"));
    for (const feature of countyBoundaries?.features || []) {
      const areaCode = feature.properties?.ons_code;
      const centroid = feature.properties?.centroid;
      const match = districtFeatures.find((candidate) => pointInGeometry(centroid, candidate.feature.geometry));
      if (areaCode && match) {
        map.set(areaCode, match.authorityCode);
      }
    }
  }
  return map;
}

function validateOutputs({ sourceSnapshots, boundaries, history, boundaryMappings, pollAggregates, featureSnapshots, candidateRosters }) {
  const sourceSummary = summariseSourceQuality(validateSourceSnapshots(sourceSnapshots));
  const historySummary = validateHistoryBundle({ boundaries, history });
  const boundaryMappingSummary = validateBoundaryMappings(boundaryMappings);
  const modelSummary = validateModelInputs({ pollAggregates, featureSnapshots });
  const candidateSummary = candidateRosters.length > 0
    ? validateCandidateRosters(candidateRosters)
    : { ok: true, results: [], errors: [] };
  return {
    ok: sourceSummary.failed === 0 && historySummary.ok && boundaryMappingSummary.ok && modelSummary.ok && candidateSummary.ok,
    sourceSummary,
    history: {
      ok: historySummary.ok,
      boundaries: historySummary.boundaryResults.length,
      records: historySummary.historyResults.length,
      errors: historySummary.errors
    },
    boundaryMappings: {
      ok: boundaryMappingSummary.ok,
      mappings: boundaryMappingSummary.results.filter((row) => row.index >= 0).length,
      errors: boundaryMappingSummary.errors
    },
    modelInputs: {
      ok: modelSummary.ok,
      pollAggregates: modelSummary.pollResults.length,
      featureSnapshots: modelSummary.featureResults.length,
      errors: modelSummary.errors
    },
    candidates: {
      ok: candidateSummary.ok,
      rosters: candidateSummary.results.length,
      errors: candidateSummary.errors
    }
  };
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const sourceSnapshots = [];
const boundaries = [];
const history = [];
const candidateRosters = [];
const featureSnapshots = [];
const pollAggregates = [];
const importedCouncils = [];
const skippedCouncils = [];

const pollingPath = path.join(options.aiDogeRoot, "shared", "polling.json");
const referencePath = path.join(options.aiDogeRoot, "shared", "elections_reference.json");
const pollingData = readJsonIfExists(pollingPath);
const referenceData = readJsonIfExists(referencePath);
let pollingSnapshot = null;

if (pollingData || referenceData) {
  const snapshotPath = pollingData ? pollingPath : referencePath;
  pollingSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(snapshotPath, "AI DOGE shared polling and model parameters", options));
  pollAggregates.push(importAidogePollAggregate({
    pollingData: pollingData || {},
    referenceData: referenceData || {},
    sourceSnapshot: pollingSnapshot
  }));
}

const ukdBasePath = path.join(options.asylumModelRoot, "base_population_2021.json");
const ukdBasePopulation = readJsonIfExists(ukdBasePath);
let ukdBaseSnapshot = null;
if (ukdBasePopulation) {
  ukdBaseSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(ukdBasePath, "UKD/asylumstats 2021 base population model", options));
}

const ukdMigrationPath = path.join(options.asylumModelRoot, "migration_matrix.json");
if (existsSync(ukdMigrationPath)) {
  sourceSnapshotPush(sourceSnapshots, snapshotFor(ukdMigrationPath, "UKD/asylumstats migration matrix", options));
}

const constituencyAsylum = readJsonIfExists(options.constituencyAsylumPath);
let constituencyAsylumSnapshot = null;
if (constituencyAsylum) {
  constituencyAsylumSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(options.constituencyAsylumPath, "Labour tracker constituency asylum context", options));
}

const constituencyProfiles = readJsonIfExists(options.constituencyProfilesPath);
let constituencyProfilesSnapshot = null;
if (constituencyProfiles) {
  constituencyProfilesSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(options.constituencyProfilesPath, "AI DOGE Westminster constituency profiles", options));
  constituencyProfilesSnapshot.upstream_data_sources = constituencyProfiles.meta?.data_sources || [];
  constituencyProfilesSnapshot.upstream_generated = constituencyProfiles.meta?.generated || null;
}

await ensureDownloadedFile(options.commonsResultsDbPath, options.commonsResultsDbUrl);
let commonsResultsSnapshot = null;
if (existsSync(options.commonsResultsDbPath)) {
  commonsResultsSnapshot = sourceSnapshotPush(sourceSnapshots, binarySnapshotFor(
    options.commonsResultsDbPath,
    "House of Commons Library election results database",
    options,
    "application/vnd.sqlite3",
    options.commonsResultsDbUrl || "https://electionresults.parliament.uk/"
  ));
  commonsResultsSnapshot.upstream_data_sources = [
    "House of Commons Library election results",
    "UK Parliament electionresults.parliament.uk",
    "Official Results"
  ];
}

let localAsylum = readJsonIfExists(options.localAsylumPath);
let localAsylumSnapshot = null;
if (existsSync(options.homeOfficeLocalAuthorityDataPath)) {
  localAsylum = importHomeOfficeLocalAuthorityAsylum({
    odsPath: options.homeOfficeLocalAuthorityDataPath,
    sourceUrl: options.homeOfficeLocalAuthorityDataUrl
  });
  localAsylumSnapshot = sourceSnapshotPush(sourceSnapshots, binarySnapshotFor(
    options.homeOfficeLocalAuthorityDataPath,
    "Home Office regional and local authority immigration dataset",
    {
      ...options,
      sourceUrl: options.homeOfficeLocalAuthorityDataUrl
    },
    "application/vnd.oasis.opendocument.spreadsheet",
    options.homeOfficeLocalAuthorityDataUrl
  ));
  localAsylumSnapshot.upstream_data_sources = [
    "Home Office immigration system statistics",
    "Regional and local authority immigration data",
    "Official asylum support local authority data"
  ];
} else if (localAsylum) {
  localAsylumSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(options.localAsylumPath, "UKD/asylumstats local asylum route context", options));
}

const pconLadCrosswalk = readJsonIfExists(options.pconLadCrosswalkPath);
let pconLadCrosswalkSnapshot = null;
if (pconLadCrosswalk) {
  pconLadCrosswalkSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(
    options.pconLadCrosswalkPath,
    "ONS Postcode Directory PCON24-LAD25 live-postcode crosswalk",
    {
      ...options,
      sourceUrl: pconLadCrosswalk.source?.source_url || "https://open-geography-portalx-ons.hub.arcgis.com/"
    }
  ));
  pconLadCrosswalkSnapshot.upstream_data_sources = [
    "ONS Open Geography",
    "Online ONS Postcode Directory Live",
    "PCON24CD",
    "LAD25CD"
  ];
}

const officialHistoryData = readJsonIfExists(options.officialHistoryPath);
let officialHistorySnapshot = null;
if (officialHistoryData) {
  officialHistorySnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(
    options.officialHistoryPath,
    officialHistoryData.source_name || "Official ward election history supplement",
    {
      ...options,
      sourceUrl: officialHistoryData.source_url || options.sourceUrl,
      licence: officialHistoryData.licence || options.licence
    }
  ));
  officialHistorySnapshot.upstream_data_sources = [
    "Official Results",
    officialHistoryData.source_name || "Official ward election history supplement"
  ];
}

let dcleapilSnapshot = null;
if (existsSync(options.dcleapilPath)) {
  dcleapilSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(
    options.dcleapilPath,
    "DCLEAPIL local election results cache",
    options
  ));
  dcleapilSnapshot.upstream_data_sources = [
    "Local Elections Archive Project",
    "Andrew Teale LEAP",
    "Democracy Club identifiers where supplied"
  ];
}

const candidateSourceManifest = readJsonIfExists(options.candidateSourceManifestPath) || [];
let candidateSourceSnapshot = null;
if (candidateSourceManifest.length > 0) {
  candidateSourceSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(
    options.candidateSourceManifestPath,
    "Lancashire 2026 statements of persons nominated source manifest",
    options
  ));
}

let councilDirs = discoverCouncilDirs(options.aiDogeRoot, options.councils);
if (Number.isInteger(options.maxCouncils) && options.maxCouncils >= 0) {
  councilDirs = councilDirs.slice(0, options.maxCouncils);
}
const localAuthorityCodeByAreaCode = buildLocalAuthorityCodeByAreaCode(options.aiDogeRoot);

for (const councilDir of councilDirs) {
  const councilId = path.basename(councilDir);
  const electionsPath = path.join(councilDir, "elections.json");
  const boundariesPath = path.join(councilDir, "ward_boundaries.json");
  const demographicsPath = path.join(councilDir, "demographics.json");
  const projectionsPath = path.join(councilDir, "composition_projections.json");

  try {
    const electionData = JSON.parse(readFileSync(electionsPath, "utf8"));
    const boundaryData = readJsonIfExists(boundariesPath);
    const demographicsData = readJsonIfExists(demographicsPath);
    const projectionData = readJsonIfExists(projectionsPath);
    const areaCodeByName = buildAreaCodeByName({ boundaryData, demographicsData, projectionData });
    const electionSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(
      electionsPath,
      `AI DOGE ${electionData.meta?.council_name || councilId} election history`,
      options
    ));
    electionSnapshot.upstream_data_sources = electionData.meta?.data_sources || [];
    electionSnapshot.upstream_generated = electionData.meta?.generated || null;
    const imported = importAidogeElectionData({
      electionData,
      sourceSnapshot: electionSnapshot,
      candidateSourceManifest,
      candidateSourceSnapshot,
      areaCodeByName
    });

    boundaries.push(...imported.boundaries);
    history.push(...imported.history);
    candidateRosters.push(...imported.candidateRosters);

    const demographicsSnapshot = demographicsData
      ? sourceSnapshotPush(sourceSnapshots, snapshotFor(demographicsPath, `AI DOGE ${electionData.meta?.council_name || councilId} demographics`, options))
      : null;
    const projectionSnapshot = projectionData
      ? sourceSnapshotPush(sourceSnapshots, snapshotFor(projectionsPath, `AI DOGE ${electionData.meta?.council_name || councilId} composition projections`, options))
      : null;

    featureSnapshots.push(...buildAidogeFeatureSnapshots({
      electionData,
      boundaries: imported.boundaries,
      history: imported.history,
      pollAggregate: pollAggregates[0] || null,
      demographicsData,
      projectionData,
      ukdBasePopulation,
      localAsylum,
      constituencyAsylum,
      localAuthorityCodeByAreaCode,
      areaCodeByName,
      sourceSnapshots: {
        elections: electionSnapshot,
        demographics: demographicsSnapshot,
        projections: projectionSnapshot,
        polling: pollingSnapshot,
        ukdBase: ukdBaseSnapshot,
        localAsylum: localAsylumSnapshot,
        constituencyAsylum: constituencyAsylumSnapshot
      }
    }));

    const councilSummary = {
      council_id: councilId,
      council_name: electionData.meta?.council_name || councilId,
      boundaries: imported.boundaries.length,
      history: imported.history.length,
      candidate_rosters: imported.candidateRosters.length,
      feature_snapshots: imported.boundaries.length,
      has_demographics: Boolean(demographicsData),
      has_composition_projections: Boolean(projectionData),
      has_ukd_authority_base: Boolean(demographicsData?.meta?.ons_code && ukdBasePopulation?.areas?.[demographicsData.meta.ons_code])
    };
    if (imported.boundaries.length === 0 && imported.history.length === 0) {
      skippedCouncils.push({ ...councilSummary, error: "No ward or division election rows found in upstream elections.json" });
    } else {
      importedCouncils.push(councilSummary);
    }
  } catch (error) {
    skippedCouncils.push({ council_id: councilId, error: error.message });
  }
}

let commonsConstituencyImport = { boundaries: [], history: [], featureSnapshots: [] };
if (commonsResultsSnapshot) {
  commonsConstituencyImport = importCommonsLibraryWestminsterResults({
    dbPath: options.commonsResultsDbPath,
    sourceSnapshot: commonsResultsSnapshot,
    pollAggregate: pollAggregates[0] || null,
    constituencyAsylum,
    constituencyAsylumSnapshot,
    localAsylum,
    localAsylumSnapshot,
    constituencyLocalAuthorityCrosswalk: pconLadCrosswalk,
    constituencyLocalAuthorityCrosswalkSnapshot: pconLadCrosswalkSnapshot
  });
  boundaries.push(...commonsConstituencyImport.boundaries);
  history.push(...commonsConstituencyImport.history);
  featureSnapshots.push(...commonsConstituencyImport.featureSnapshots);
}

let aidogeConstituencyImport = { boundaries: [], history: [], featureSnapshots: [] };
if (!commonsResultsSnapshot && constituencyProfilesSnapshot && constituencyProfiles) {
  aidogeConstituencyImport = importAidogeConstituencyProfiles({
    constituencyData: constituencyProfiles,
    sourceSnapshot: constituencyProfilesSnapshot,
    pollAggregate: pollAggregates[0] || null,
    constituencyAsylum,
    constituencyAsylumSnapshot
  });
  boundaries.push(...aidogeConstituencyImport.boundaries);
  history.push(...aidogeConstituencyImport.history);
  featureSnapshots.push(...aidogeConstituencyImport.featureSnapshots);
}

const supplementalHistory = dcleapilSnapshot
  ? await importDcleapilSupplementalHistory({
    dcleapilPath: options.dcleapilPath,
    sourceSnapshot: dcleapilSnapshot,
    boundaries,
    existingHistory: history,
    sourceUrl: options.sourceUrl
  })
  : [];
history.push(...supplementalHistory);
const officialHistory = officialHistorySnapshot
  ? importOfficialHistoryRecords({
    officialHistoryData,
    sourceSnapshot: officialHistorySnapshot,
    boundaries,
    existingHistory: history
  })
  : [];
history.push(...officialHistory);
alignBoundaryValidFromWithHistory(boundaries, history);

const boundaryMappings = buildBoundaryLineageMappings(boundaries);
const validation = validateOutputs({
  sourceSnapshots,
  boundaries,
  history,
  boundaryMappings,
  pollAggregates,
  featureSnapshots,
  candidateRosters
});

mkdirSync(options.output, { recursive: true });
writeJson(path.join(options.output, "source-snapshots.json"), sourceSnapshots);
writeJson(path.join(options.output, "boundary-versions.json"), boundaries);
writeJson(path.join(options.output, "boundary-mappings.json"), boundaryMappings);
writeJson(path.join(options.output, "election-history.json"), history);
writeJson(path.join(options.output, "candidate-rosters.json"), candidateRosters);
writeJson(path.join(options.output, "poll-aggregate.json"), pollAggregates);
writeJson(path.join(options.output, "model-features.json"), featureSnapshots);
writeJson(path.join(options.output, "import-summary.json"), {
  generated_at: new Date().toISOString(),
  output: path.resolve(options.output),
  upstreams: {
    ai_doge_root: options.aiDogeRoot,
    asylum_model_root: options.asylumModelRoot,
    local_asylum_path: options.localAsylumPath,
    home_office_local_authority_data_path: options.homeOfficeLocalAuthorityDataPath,
    home_office_local_authority_data_url: options.homeOfficeLocalAuthorityDataUrl,
    pcon_lad_crosswalk_path: options.pconLadCrosswalkPath,
    constituency_asylum_path: options.constituencyAsylumPath,
    constituency_profiles_path: options.constituencyProfilesPath,
    commons_results_db_path: options.commonsResultsDbPath,
    commons_results_db_url: options.commonsResultsDbUrl,
    dcleapil_path: options.dcleapilPath,
    official_history_path: options.officialHistoryPath,
    candidate_source_manifest_path: options.candidateSourceManifestPath
  },
  counts: {
    source_snapshots: sourceSnapshots.length,
    councils: importedCouncils.length,
    skipped_councils: skippedCouncils.length,
    boundaries: boundaries.length,
    boundary_mappings: boundaryMappings.length,
    history_records: history.length,
    supplemental_history_records: supplementalHistory.length,
    official_history_records: officialHistory.length,
    candidate_rosters: candidateRosters.length,
    poll_aggregates: pollAggregates.length,
    feature_snapshots: featureSnapshots.length
  },
  imported_constituencies: {
    primary_source_path: commonsResultsSnapshot ? options.commonsResultsDbPath : options.constituencyProfilesPath,
    primary_source: commonsResultsSnapshot ? "house_of_commons_library" : "ai_doge_constituency_profiles",
    commons_boundaries: commonsConstituencyImport.boundaries.length,
    commons_history_records: commonsConstituencyImport.history.length,
    commons_feature_snapshots: commonsConstituencyImport.featureSnapshots.length,
    ai_doge_fallback_boundaries: aidogeConstituencyImport.boundaries.length,
    ai_doge_fallback_history_records: aidogeConstituencyImport.history.length,
    ai_doge_fallback_feature_snapshots: aidogeConstituencyImport.featureSnapshots.length
  },
  imported_councils: importedCouncils,
  skipped_councils: skippedCouncils,
  validation,
  publication_gate: "Imported source snapshots are accepted with warnings for internal modelling where provenance is known. Boundary-remapped history, official-result spot checks, licences, and area-specific methods still require review before strong public claims."
});

console.log(JSON.stringify({
  ok: validation.ok,
  output: path.resolve(options.output),
  counts: {
    source_snapshots: sourceSnapshots.length,
    councils: importedCouncils.length,
    skipped_councils: skippedCouncils.length,
    boundaries: boundaries.length,
    boundary_mappings: boundaryMappings.length,
    history_records: history.length,
    supplemental_history_records: supplementalHistory.length,
    official_history_records: officialHistory.length,
    constituency_boundaries: commonsConstituencyImport.boundaries.length + aidogeConstituencyImport.boundaries.length,
    constituency_history_records: commonsConstituencyImport.history.length + aidogeConstituencyImport.history.length,
    constituency_feature_snapshots: commonsConstituencyImport.featureSnapshots.length + aidogeConstituencyImport.featureSnapshots.length,
    candidate_rosters: candidateRosters.length,
    poll_aggregates: pollAggregates.length,
    feature_snapshots: featureSnapshots.length
  },
  validation
}, null, 2));

if (!validation.ok) {
  process.exit(1);
}
