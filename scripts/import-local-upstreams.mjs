#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildAidogeFeatureSnapshots,
  buildLocalFileSourceSnapshot,
  importAidogeElectionData,
  importAidogePollAggregate
} from "./lib/local-upstream-importers.mjs";
import { validateSourceSnapshots, summariseSourceQuality } from "./lib/source-quality.mjs";
import { validateHistoryBundle } from "./lib/history-quality.mjs";
import { validateModelInputs } from "./lib/model-input-quality.mjs";
import { validateCandidateRosters } from "./lib/candidate-quality.mjs";

const DEFAULTS = {
  aiDogeRoot: "/Users/tompickup/clawd/burnley-council/data",
  asylumModelRoot: "/Users/tompickup/asylumstats/data/model",
  constituencyAsylumPath: "/Users/tompickup/clawd/labour-tracker/constituency_asylum.json",
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
    else if (arg === "--constituency-asylum") args.constituencyAsylumPath = argv[++index];
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
  --constituency-asylum <path>   Labour tracker constituency asylum JSON
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

function validateOutputs({ sourceSnapshots, boundaries, history, pollAggregates, featureSnapshots, candidateRosters }) {
  const sourceSummary = summariseSourceQuality(validateSourceSnapshots(sourceSnapshots));
  const historySummary = validateHistoryBundle({ boundaries, history });
  const modelSummary = validateModelInputs({ pollAggregates, featureSnapshots });
  const candidateSummary = candidateRosters.length > 0
    ? validateCandidateRosters(candidateRosters)
    : { ok: true, results: [], errors: [] };
  return {
    ok: sourceSummary.failed === 0 && historySummary.ok && modelSummary.ok && candidateSummary.ok,
    sourceSummary,
    history: {
      ok: historySummary.ok,
      boundaries: historySummary.boundaryResults.length,
      records: historySummary.historyResults.length,
      errors: historySummary.errors
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

for (const councilDir of councilDirs) {
  const councilId = path.basename(councilDir);
  const electionsPath = path.join(councilDir, "elections.json");
  const demographicsPath = path.join(councilDir, "demographics.json");
  const projectionsPath = path.join(councilDir, "composition_projections.json");

  try {
    const electionData = JSON.parse(readFileSync(electionsPath, "utf8"));
    const electionSnapshot = sourceSnapshotPush(sourceSnapshots, snapshotFor(
      electionsPath,
      `AI DOGE ${electionData.meta?.council_name || councilId} election history`,
      options
    ));
    const imported = importAidogeElectionData({
      electionData,
      sourceSnapshot: electionSnapshot,
      candidateSourceManifest,
      candidateSourceSnapshot
    });

    boundaries.push(...imported.boundaries);
    history.push(...imported.history);
    candidateRosters.push(...imported.candidateRosters);

    const demographicsData = readJsonIfExists(demographicsPath);
    const projectionData = readJsonIfExists(projectionsPath);
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
      constituencyAsylum,
      sourceSnapshots: {
        elections: electionSnapshot,
        demographics: demographicsSnapshot,
        projections: projectionSnapshot,
        polling: pollingSnapshot,
        ukdBase: ukdBaseSnapshot,
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

const validation = validateOutputs({
  sourceSnapshots,
  boundaries,
  history,
  pollAggregates,
  featureSnapshots,
  candidateRosters
});

mkdirSync(options.output, { recursive: true });
writeJson(path.join(options.output, "source-snapshots.json"), sourceSnapshots);
writeJson(path.join(options.output, "boundary-versions.json"), boundaries);
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
    constituency_asylum_path: options.constituencyAsylumPath,
    candidate_source_manifest_path: options.candidateSourceManifestPath
  },
  counts: {
    source_snapshots: sourceSnapshots.length,
    councils: importedCouncils.length,
    skipped_councils: skippedCouncils.length,
    boundaries: boundaries.length,
    history_records: history.length,
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
    history_records: history.length,
    candidate_rosters: candidateRosters.length,
    poll_aggregates: pollAggregates.length,
    feature_snapshots: featureSnapshots.length
  },
  validation
}, null, 2));

if (!validation.ok) {
  process.exit(1);
}
