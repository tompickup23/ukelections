#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildCoverageStatus } from "./lib/coverage-status.mjs";

function parseArgs(argv) {
  const args = {
    input: "/tmp/ukelections-local-upstreams",
    output: "/tmp/ukelections-local-upstreams/coverage-status.json",
    markdownOutput: "/tmp/ukelections-local-upstreams/coverage-status.md"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") args.input = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--markdown-output") args.markdownOutput = argv[++index];
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function readJson(filePath, fallback = null) {
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : fallback;
}

function asTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(column.value(row) ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function markdown(status) {
  return [
    "# Coverage Status",
    "",
    `Generated at: ${status.generated_at}`,
    "",
    "## Definition",
    "",
    `Completed model area: ${status.completion_definition.completed_model_area}`,
    `Completed council: ${status.completion_definition.completed_council}`,
    `Draft rows: ${status.completion_definition.draft_rows}`,
    "",
    "## Model Areas",
    "",
    `Completed: ${status.model_area_coverage.completed_model_areas}/${status.model_area_coverage.total_model_areas}`,
    `Remaining: ${status.model_area_coverage.remaining_model_areas}`,
    "",
    "## Councils",
    "",
    `Completed councils: ${status.council_coverage.completed_councils}/${status.council_coverage.total_councils}`,
    `Remaining councils: ${status.council_coverage.remaining_councils}`,
    "",
    asTable(status.council_coverage.councils, [
      { label: "Council", value: (row) => row.council_name },
      { label: "Completed", value: (row) => row.completed ? "yes" : "no" },
      { label: "Areas", value: (row) => row.total_model_areas },
      { label: "Completed areas", value: (row) => row.completed_model_areas },
      { label: "Remaining areas", value: (row) => row.remaining_model_areas }
    ]),
    "",
    "## Constituencies",
    "",
    `Loaded constituency model areas: ${status.constituency_coverage.total_constituency_model_areas_loaded}`,
    `Completed loaded constituency model areas: ${status.constituency_coverage.completed_constituency_model_areas}`,
    `Remaining loaded constituency model areas: ${status.constituency_coverage.remaining_constituency_model_areas_loaded}`,
    status.constituency_coverage.note || "",
    "",
    "## Draft Review Transcriptions",
    "",
    `Drafted records: ${status.draft_review_transcriptions.total_drafted_records}`,
    `Failed draft rows/pages: ${status.draft_review_transcriptions.total_failed_records}`,
    "",
    asTable(status.draft_review_transcriptions.routes, [
      { label: "Route", value: (row) => row.route },
      { label: "Areas attempted", value: (row) => row.total_areas },
      { label: "Drafted records", value: (row) => row.drafted_records },
      { label: "Failed", value: (row) => row.failed_records }
    ]),
    ""
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Summarise imported model coverage by council and constituency.

Usage:
  node scripts/summarise-coverage-status.mjs --input /tmp/ukelections-local-upstreams --output /tmp/ukelections-local-upstreams/coverage-status.json --markdown-output /tmp/ukelections-local-upstreams/coverage-status.md
`);
  process.exit(0);
}

const readiness = readJson(path.join(args.input, "model-readiness.json"), []);
const boundaries = readJson(path.join(args.input, "boundary-versions.json"), []);
const drafts = {
  structured_html: readJson(path.join(args.input, "structured-review-official-history.draft.json")),
  modern_gov: readJson(path.join(args.input, "moderngov-review-official-history.draft.json")),
  council_html: readJson(path.join(args.input, "council-html-review-official-history.draft.json"))
};

const status = buildCoverageStatus({ readiness, boundaries, drafts });
mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(status, null, 2)}\n`, "utf8");
if (args.markdownOutput) {
  mkdirSync(path.dirname(args.markdownOutput), { recursive: true });
  writeFileSync(args.markdownOutput, markdown(status), "utf8");
}

console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  markdown_output: args.markdownOutput ? path.resolve(args.markdownOutput) : null,
  completed_model_areas: status.model_area_coverage.completed_model_areas,
  total_model_areas: status.model_area_coverage.total_model_areas,
  completed_councils: status.council_coverage.completed_councils,
  total_councils: status.council_coverage.total_councils,
  completed_constituency_model_areas: status.constituency_coverage.completed_constituency_model_areas,
  total_constituency_model_areas_loaded: status.constituency_coverage.total_constituency_model_areas_loaded,
  draft_review_records: status.draft_review_transcriptions.total_drafted_records
}, null, 2));
