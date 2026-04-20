#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchSourceSnapshot } from "./lib/source-fetcher.mjs";
import { buildReviewWorkflowExecution } from "./lib/review-workflow-executor.mjs";

function parseArgs(argv) {
  const args = {
    workflows: "/tmp/ukelections-local-upstreams/review-workflows.json",
    output: "/tmp/ukelections-local-upstreams/review-workflow-execution.json",
    markdownOutput: "/tmp/ukelections-local-upstreams/review-workflow-execution.md",
    rawDir: "/tmp/ukelections-local-upstreams/raw-review-sources",
    licence: "Review required before public reuse",
    timeoutMs: 30000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workflows") args.workflows = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--markdown-output") args.markdownOutput = argv[++index];
    else if (arg === "--raw-dir") args.rawDir = argv[++index];
    else if (arg === "--licence") args.licence = argv[++index];
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function slug(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extensionForTarget(target) {
  try {
    const pathname = new URL(target.url).pathname.toLowerCase();
    const extension = pathname.match(/\.([a-z0-9]{2,5})$/)?.[1];
    if (extension) return extension;
  } catch {
    return "html";
  }
  return "html";
}

function markdown(execution) {
  const targetRows = execution.fetch_results.map((result) => `| ${result.target_id} | ${result.ok ? "fetched" : "failed"} | ${result.snapshot_id || ""} | ${result.error || ""} |`);
  const areaRows = execution.areas.map((area) => `| ${area.priority} | ${area.workflow_code} | ${area.area_name} (${area.area_code}) | ${area.source_evidence_status} | ${area.fetched_source_targets}/${area.source_target_count} | ${area.promotion_status} |`);
  return [
    "# Review Workflow Execution",
    "",
    `Generated at: ${execution.generated_at}`,
    "",
    `Areas: ${execution.total_areas}`,
    `Source targets: ${execution.total_source_targets}`,
    `Fetched targets: ${execution.fetched_source_targets}`,
    `Failed targets: ${execution.failed_source_targets}`,
    "",
    "## Target Fetches",
    "",
    "| Target | Status | Snapshot | Error |",
    "| --- | --- | --- | --- |",
    ...targetRows,
    "",
    "## Area Status",
    "",
    "| Priority | Workflow | Area | Source evidence | Targets | Promotion |",
    "| --- | --- | --- | --- | --- | --- |",
    ...areaRows,
    ""
  ].join("\n");
}

async function fetchWithTimeout(target, args) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const outputPath = path.join(args.rawDir, `${slug(target.target_id)}.${extensionForTarget(target)}`);
    const snapshot = await fetchSourceSnapshot({
      sourceName: target.source_name,
      sourceUrl: target.url,
      licence: target.licence || args.licence,
      outputPath,
      signal: controller.signal
    });
    return {
      ok: true,
      target_id: target.target_id,
      snapshot_id: snapshot.snapshot_id,
      snapshot: {
        ...snapshot,
        target_id: target.target_id,
        source_classes: target.source_classes || [],
        applies_to_workflow_codes: target.applies_to_workflow_codes || [],
        council_name: target.council_name
      }
    };
  } catch (error) {
    return {
      ok: false,
      target_id: target.target_id,
      error: error.name === "AbortError" ? `Fetch timed out after ${args.timeoutMs}ms` : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Fetch and snapshot all source targets attached to review workflows.

Usage:
  node scripts/execute-review-workflows.mjs --workflows /tmp/ukelections-local-upstreams/review-workflows.json --output /tmp/ukelections-local-upstreams/review-workflow-execution.json --markdown-output /tmp/ukelections-local-upstreams/review-workflow-execution.md --raw-dir /tmp/ukelections-local-upstreams/raw-review-sources
`);
  process.exit(0);
}

const workflows = JSON.parse(readFileSync(args.workflows, "utf8"));
mkdirSync(args.rawDir, { recursive: true });
const fetchResults = [];
const sourceSnapshots = [];
for (const target of workflows.source_targets || []) {
  const result = await fetchWithTimeout(target, args);
  fetchResults.push({
    ok: result.ok,
    target_id: result.target_id,
    snapshot_id: result.snapshot_id || null,
    error: result.error || null
  });
  if (result.snapshot) sourceSnapshots.push(result.snapshot);
}

const execution = buildReviewWorkflowExecution({
  workflows,
  sourceSnapshots,
  fetchResults
});

mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(execution, null, 2)}\n`, "utf8");
if (args.markdownOutput) {
  mkdirSync(path.dirname(args.markdownOutput), { recursive: true });
  writeFileSync(args.markdownOutput, markdown(execution), "utf8");
}

console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  markdown_output: args.markdownOutput ? path.resolve(args.markdownOutput) : null,
  total_areas: execution.total_areas,
  total_source_targets: execution.total_source_targets,
  fetched_source_targets: execution.fetched_source_targets,
  failed_source_targets: execution.failed_source_targets,
  by_area_source_evidence_status: execution.by_area_source_evidence_status
}, null, 2));
