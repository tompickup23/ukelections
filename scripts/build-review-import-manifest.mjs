#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildReviewImportManifest } from "./lib/review-import-manifest.mjs";

function parseArgs(argv) {
  const args = {
    evidence: "/tmp/ukelections-local-upstreams/review-workflow-evidence.json",
    output: "/tmp/ukelections-local-upstreams/review-import-manifest.json",
    markdownOutput: "/tmp/ukelections-local-upstreams/review-import-manifest.md"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--evidence") args.evidence = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--markdown-output") args.markdownOutput = argv[++index];
    else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function asTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(column.value(row) ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function markdown(manifest) {
  const summaryRows = Object.entries(manifest.by_import_status || {}).map(([status, count]) => ({ status, count }));
  const routeRows = Object.entries(manifest.by_primary_import_route || {}).map(([route, count]) => ({ route, count }));
  const areaRows = (manifest.areas || []).map((area) => ({
    priority: area.priority,
    workflow: area.workflow_code,
    council: (area.council_names || []).join(", "),
    area: `${area.area_name} (${area.area_code})`,
    status: area.import_status,
    route: area.primary_import_route,
    matched: area.matched_source_count,
    source: area.primary_source?.source_url || "",
    blockers: area.remaining_blockers.join(", ")
  }));
  return [
    "# Review Import Manifest",
    "",
    `Generated at: ${manifest.generated_at}`,
    "",
    `Areas: ${manifest.total_areas}`,
    `Ready for row transformation: ${manifest.ready_for_row_transformation}`,
    `Needs OCR before transcription: ${manifest.needs_ocr_before_transcription}`,
    `Needs source acquisition: ${manifest.needs_source_acquisition}`,
    "",
    "## Import Status",
    "",
    asTable(summaryRows, [
      { label: "Status", value: (row) => row.status },
      { label: "Areas", value: (row) => row.count }
    ]),
    "",
    "## Primary Routes",
    "",
    asTable(routeRows, [
      { label: "Route", value: (row) => row.route },
      { label: "Areas", value: (row) => row.count }
    ]),
    "",
    "## Area Worklist",
    "",
    asTable(areaRows, [
      { label: "Priority", value: (row) => row.priority },
      { label: "Workflow", value: (row) => row.workflow },
      { label: "Council", value: (row) => row.council },
      { label: "Area", value: (row) => row.area },
      { label: "Import status", value: (row) => row.status },
      { label: "Route", value: (row) => row.route },
      { label: "Matched sources", value: (row) => row.matched },
      { label: "Primary source", value: (row) => row.source },
      { label: "Remaining blockers", value: (row) => row.blockers }
    ]),
    ""
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Build the row-level import manifest from review evidence.

Usage:
  node scripts/build-review-import-manifest.mjs --evidence /tmp/ukelections-local-upstreams/review-workflow-evidence.json --output /tmp/ukelections-local-upstreams/review-import-manifest.json --markdown-output /tmp/ukelections-local-upstreams/review-import-manifest.md
`);
  process.exit(0);
}

const evidence = JSON.parse(readFileSync(args.evidence, "utf8"));
const manifest = buildReviewImportManifest({ evidence });
mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
if (args.markdownOutput) {
  mkdirSync(path.dirname(args.markdownOutput), { recursive: true });
  writeFileSync(args.markdownOutput, markdown(manifest), "utf8");
}

console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  markdown_output: args.markdownOutput ? path.resolve(args.markdownOutput) : null,
  total_areas: manifest.total_areas,
  ready_for_row_transformation: manifest.ready_for_row_transformation,
  needs_ocr_before_transcription: manifest.needs_ocr_before_transcription,
  needs_source_acquisition: manifest.needs_source_acquisition,
  by_import_status: manifest.by_import_status,
  by_primary_import_route: manifest.by_primary_import_route
}, null, 2));
