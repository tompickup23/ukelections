#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "/tmp/ukelections-local-upstreams/data-audit.json",
    output: "/tmp/ukelections-local-upstreams/review-workflows.json",
    markdownOutput: "/tmp/ukelections-local-upstreams/review-workflows.md",
    sourceTargets: "data/local-review-source-targets.example.json"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") args.input = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--markdown-output") args.markdownOutput = argv[++index];
    else if (arg === "--source-targets") args.sourceTargets = argv[++index];
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

function workflowMarkdown(workflows, audit) {
  const areas = workflows.areas || [];
  const summaryRows = Object.entries(workflows.by_workflow_code || {}).map(([workflowCode, count]) => ({
    workflowCode,
    count
  }));
  const priorityRows = Object.entries(workflows.by_priority || {}).map(([priority, count]) => ({
    priority,
    count
  }));
  const areaRows = areas.map((area) => ({
    priority: area.priority,
    workflow: area.workflow_code,
    action: area.action_code,
    family: area.model_family,
    council: (area.source_context?.council_names || []).join(", ") || "unknown",
    area: `${area.area_name} (${area.area_code})`,
    history: `${area.history_records}/${area.raw_history_records}`,
    passReason: area.pass_reason,
    mae: area.metrics?.mean_absolute_error === null || area.metrics?.mean_absolute_error === undefined
      ? ""
      : Number(area.metrics.mean_absolute_error).toFixed(3),
    electedHit: area.metrics?.elected_party_hit_rate === null || area.metrics?.elected_party_hit_rate === undefined
      ? ""
      : Number(area.metrics.elected_party_hit_rate).toFixed(3),
    promotionGate: area.promotion_gate
  }));
  const sourceTargetRows = (workflows.source_targets || []).map((target) => ({
    council: target.council_name,
    sourceName: target.source_name,
    workflowCodes: (target.applies_to_workflow_codes || []).join(", "),
    sourceClasses: (target.source_classes || []).join(", "),
    url: target.url
  }));

  return [
    "# Local Review Workflows",
    "",
    `Generated at: ${audit.generated_at || "unknown"}`,
    "",
    `Outstanding review areas: ${workflows.total || 0}`,
    "",
    "## Workflow Counts",
    "",
    asTable(summaryRows, [
      { label: "Workflow", value: (row) => row.workflowCode },
      { label: "Areas", value: (row) => row.count }
    ]),
    "",
    "## Priority Counts",
    "",
    asTable(priorityRows, [
      { label: "Priority", value: (row) => row.priority },
      { label: "Areas", value: (row) => row.count }
    ]),
    "",
    "## Source Targets",
    "",
    asTable(sourceTargetRows, [
      { label: "Council", value: (row) => row.council },
      { label: "Source", value: (row) => row.sourceName },
      { label: "Workflow codes", value: (row) => row.workflowCodes },
      { label: "Source classes", value: (row) => row.sourceClasses },
      { label: "URL", value: (row) => row.url }
    ]),
    "",
    "## Area Worklist",
    "",
    asTable(areaRows, [
      { label: "Priority", value: (row) => row.priority },
      { label: "Workflow", value: (row) => row.workflow },
      { label: "Action", value: (row) => row.action },
      { label: "Family", value: (row) => row.family },
      { label: "Council", value: (row) => row.council },
      { label: "Area", value: (row) => row.area },
      { label: "Usable/raw history", value: (row) => row.history },
      { label: "Pass reason", value: (row) => row.passReason },
      { label: "MAE", value: (row) => row.mae },
      { label: "Elected hit", value: (row) => row.electedHit },
      { label: "Promotion gate", value: (row) => row.promotionGate }
    ]),
    ""
  ].join("\n");
}

function readJsonIfExists(filePath, fallback) {
  if (!filePath) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function sourceTargetsForArea(area, sourceTargets) {
  const councilNames = new Set(area.source_context?.council_names || []);
  return sourceTargets.filter((target) => {
    const councilMatches = target.council_name === "*" || councilNames.has(target.council_name);
    const workflowMatches = !target.applies_to_workflow_codes?.length || target.applies_to_workflow_codes.includes(area.workflow_code);
    return councilMatches && workflowMatches;
  });
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Build review workflow outputs from data-audit.json.

Usage:
  node scripts/build-review-workflows.mjs --input /tmp/ukelections-local-upstreams/data-audit.json --output /tmp/ukelections-local-upstreams/review-workflows.json --markdown-output /tmp/ukelections-local-upstreams/review-workflows.md --source-targets data/local-review-source-targets.example.json
`);
  process.exit(0);
}

const audit = JSON.parse(readFileSync(args.input, "utf8"));
const sourceTargets = readJsonIfExists(args.sourceTargets, []);
const workflows = audit.review_workflows ? { ...audit.review_workflows } : {
  total: audit.review_actions?.total || 0,
  by_workflow_code: {},
  by_priority: {},
  by_council: {},
  areas: audit.review_actions?.areas || []
};
workflows.areas = (workflows.areas || []).map((area) => ({
  ...area,
  source_targets: sourceTargetsForArea(area, sourceTargets).map((target) => target.target_id)
}));
workflows.source_targets = sourceTargets.filter((target) =>
  workflows.areas.some((area) => area.source_targets.includes(target.target_id))
);

mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(workflows, null, 2)}\n`, "utf8");
if (args.markdownOutput) {
  mkdirSync(path.dirname(args.markdownOutput), { recursive: true });
  writeFileSync(args.markdownOutput, workflowMarkdown(workflows, audit), "utf8");
}

console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  markdown_output: args.markdownOutput ? path.resolve(args.markdownOutput) : null,
  total: workflows.total,
  by_workflow_code: workflows.by_workflow_code,
  by_priority: workflows.by_priority,
  by_council: workflows.by_council,
  source_targets: workflows.source_targets.length
}, null, 2));
