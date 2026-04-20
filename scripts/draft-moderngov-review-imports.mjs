#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildModernGovReviewDraft,
  readLinkedSources
} from "./lib/moderngov-review-results.mjs";

function parseArgs(argv) {
  const args = {
    manifest: "/tmp/ukelections-local-upstreams/review-import-manifest.json",
    linkedRawDir: "/tmp/ukelections-audit/raw-review-linked-sources",
    output: "/tmp/ukelections-local-upstreams/moderngov-review-official-history.draft.json",
    markdownOutput: "/tmp/ukelections-local-upstreams/moderngov-review-official-history.draft.md"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") args.manifest = argv[++index];
    else if (arg === "--linked-raw-dir") args.linkedRawDir = argv[++index];
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

function markdown(draft) {
  const lines = [
    "# Draft ModernGov Review Imports",
    "",
    `Generated at: ${draft.generated_at}`,
    "",
    `Areas attempted: ${draft.total_areas}`,
    `Drafted records: ${draft.drafted_records}`,
    `Failed records: ${draft.failed_records}`,
    "",
    "These rows are transcribed from cached linked ModernGov result pages, but remain draft-only until manual review checks candidate names, party labels, elected flags, totals, source URLs, source snapshots, and boundary versions.",
    "",
    "## Draft Records",
    "",
    asTable(draft.records.map((record) => ({
      area: `${record.area_name} (${record.area_code})`,
      candidates: record.result_rows.length,
      votes: record.turnout_votes,
      declaredTotal: record.draft_review.declared_total_votes,
      totalCheck: record.draft_review.declared_total_matches_candidate_votes,
      source: record.source_url
    })), [
      { label: "Area", value: (row) => row.area },
      { label: "Candidates", value: (row) => row.candidates },
      { label: "Candidate votes", value: (row) => row.votes },
      { label: "Declared total", value: (row) => row.declaredTotal },
      { label: "Total check", value: (row) => row.totalCheck },
      { label: "Source", value: (row) => row.source }
    ])
  ];
  if (draft.failures.length) {
    lines.push(
      "",
      "## Failures",
      "",
      asTable(draft.failures, [
        { label: "Area", value: (row) => `${row.area_name} (${row.area_code})` },
        { label: "Error", value: (row) => row.error },
        { label: "Source", value: (row) => row.source_url || "" }
      ])
    );
  }
  lines.push("");
  return lines.join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Draft official-history rows from cached linked ModernGov result pages.

Usage:
  node scripts/draft-moderngov-review-imports.mjs --manifest /tmp/ukelections-local-upstreams/review-import-manifest.json --linked-raw-dir /tmp/ukelections-audit/raw-review-linked-sources --output /tmp/ukelections-local-upstreams/moderngov-review-official-history.draft.json
`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
const linkedSources = readLinkedSources(args.linkedRawDir);
const draft = buildModernGovReviewDraft({
  manifest,
  linkedSources,
  sourceReader: (filePath) => readFileSync(filePath, "utf8")
});

mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
if (args.markdownOutput) {
  mkdirSync(path.dirname(args.markdownOutput), { recursive: true });
  writeFileSync(args.markdownOutput, markdown(draft), "utf8");
}

console.log(JSON.stringify({
  ok: draft.drafted_records > 0,
  output: path.resolve(args.output),
  markdown_output: args.markdownOutput ? path.resolve(args.markdownOutput) : null,
  total_areas: draft.total_areas,
  drafted_records: draft.drafted_records,
  failed_records: draft.failed_records,
  draft_import_gate: draft.draft_import_gate
}, null, 2));

if (draft.drafted_records === 0) process.exit(1);
