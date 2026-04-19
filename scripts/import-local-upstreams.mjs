#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildAidogeFeatureSnapshots,
  buildLocalFileSourceSnapshot,
  importAidogeElectionData,
  importAidogePollAggregate
} from "./lib/local-upstream-importers.mjs";
import { importDcleapilSupplementalHistory } from "./lib/dcleapil-supplemental-history.mjs";
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
  constituencyAsylumPath: "/Users/tompickup/clawd/labour-tracker/constituency_asylum.json",
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
    else if (arg === "--constituency-asylum") args.constituencyAsylumPath = argv[++index];
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
  --constituency-asylum <path>   Labour tracker constituency asylum JSON
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
  return buildLocalFileSourceSnapshot({
    filePath,
    sourceName,
    sourceUrl: options.sourceUrl,
    licence: options.licence
  });
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
      map.set(normaliseAreaName(name), code);
      map.set(compactAreaName(name), code);
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

const localAsylum = readJsonIfExists(options.localAsylumPath);
let localAsylumSnapshot = null;
if (localAsylum) {
  localAsylumSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(options.localAsylumPath, "UKD/asylumstats local asylum route context", options));
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
    constituency_asylum_path: options.constituencyAsylumPath,
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
  imported_councils: importedCouncils,
  skipped_councils: skippedCouncils,
  validation,
  publication_gate: "All imported data remains quarantined until source licences, ward boundary spans, and area-specific methods are reviewed."
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
    candidate_rosters: candidateRosters.length,
    poll_aggregates: pollAggregates.length,
    feature_snapshots: featureSnapshots.length
  },
  validation
}, null, 2));

if (!validation.ok) {
  process.exit(1);
}
