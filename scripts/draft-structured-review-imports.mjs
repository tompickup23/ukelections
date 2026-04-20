#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildStructuredReviewDraft } from "./lib/structured-review-results.mjs";

function parseArgs(argv) {
  const args = {
    manifest: "/tmp/ukelections-local-upstreams/review-import-manifest.json",
    output: "/tmp/ukelections-local-upstreams/structured-review-official-history.draft.json",
    markdownOutput: "/tmp/ukelections-local-upstreams/structured-review-official-history.draft.md",
    electionDate: "2024-05-02"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") args.manifest = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--markdown-output") args.markdownOutput = argv[++index];
    else if (arg === "--election-date") args.electionDate = argv[++index];
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
  return [
    "# Draft Structured Review Imports",
    "",
    `Generated at: ${draft.generated_at}`,
    "",
    `Areas attempted: ${draft.total_areas}`,
    `Drafted records: ${draft.drafted_records}`,
    `Failed records: ${draft.failed_records}`,
    "",
    "These rows are transcribed from official structured HTML tables, but remain draft-only until a human review checks candidate names, party labels, elected flags, source snapshots, boundary alignment, and declared totals.",
    "",
    "## Draft Records",
    "",
    asTable(draft.records.map((record) => ({
      area: `${record.area_name} (${record.area_code})`,
      source: record.source_url,
      candidates: record.result_rows.length,
      turnoutVotes: record.turnout_votes,
      spoilt: record.draft_review.spoilt_ballots,
      declaredTotal: record.draft_review.declared_total_votes_cast,
      totalCheck: record.draft_review.declared_total_matches_candidate_votes_plus_spoilt
    })), [
      { label: "Area", value: (row) => row.area },
      { label: "Candidates", value: (row) => row.candidates },
      { label: "Candidate votes", value: (row) => row.turnoutVotes },
      { label: "Spoilt", value: (row) => row.spoilt },
      { label: "Declared total", value: (row) => row.declaredTotal },
      { label: "Total check", value: (row) => row.totalCheck },
      { label: "Source", value: (row) => row.source }
    ]),
    draft.failures.length ? "" : "",
    draft.failures.length ? "## Failures" : "",
    draft.failures.length ? "" : "",
    draft.failures.length ? asTable(draft.failures, [
      { label: "Area", value: (row) => `${row.area_name} (${row.area_code})` },
      { label: "Error", value: (row) => row.error }
    ]) : "",
    ""
  ].filter((line) => line !== null).join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Draft official-history rows from structured HTML review sources.

Usage:
  node scripts/draft-structured-review-imports.mjs --manifest /tmp/ukelections-local-upstreams/review-import-manifest.json --output /tmp/ukelections-local-upstreams/structured-review-official-history.draft.json
`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
const draft = buildStructuredReviewDraft({
  manifest,
  electionDate: args.electionDate,
  sourceReader: (filePath) => readFileSync(filePath, "utf8")
});

mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
if (args.markdownOutput) {
  mkdirSync(path.dirname(args.markdownOutput), { recursive: true });
  writeFileSync(args.markdownOutput, markdown(draft), "utf8");
}

console.log(JSON.stringify({
  ok: draft.failed_records === 0,
  output: path.resolve(args.output),
  markdown_output: args.markdownOutput ? path.resolve(args.markdownOutput) : null,
  total_areas: draft.total_areas,
  drafted_records: draft.drafted_records,
  failed_records: draft.failed_records,
  draft_import_gate: draft.draft_import_gate
}, null, 2));

if (draft.failed_records > 0) process.exit(1);
