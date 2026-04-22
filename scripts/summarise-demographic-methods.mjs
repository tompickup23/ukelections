#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "/tmp/ukelections-local-upstreams",
    output: "/tmp/ukelections-local-upstreams/demographic-methods.json",
    markdownOutput: "/tmp/ukelections-local-upstreams/demographic-methods.md"
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

function countBy(rows, keyFn) {
  return Object.fromEntries(Object.entries(rows.reduce((counts, row) => {
    const key = keyFn(row) || "missing";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right)));
}

function sourceById(sourceSnapshots) {
  return new Map((sourceSnapshots || []).map((snapshot) => [snapshot.snapshot_id, snapshot]));
}

function sourceNamesForField(feature, snapshots, fieldName) {
  return (feature.provenance || [])
    .filter((row) => row.field === fieldName)
    .map((row) => snapshots.get(row.source_snapshot_id)?.source_name || row.source_snapshot_id)
    .filter(Boolean);
}

function buildSummary({ featureSnapshots, sourceSnapshots }) {
  const snapshots = sourceById(sourceSnapshots);
  const rows = featureSnapshots.map((feature) => {
    const asylum = feature.features?.asylum_context || null;
    const population = feature.features?.population_projection || null;
    return {
      area_code: feature.area_code,
      area_name: feature.area_name,
      model_family: feature.model_family,
      asylum_precision: asylum?.precision || "missing",
      asylum_route_scope: asylum?.route_scope || "missing",
      asylum_source_names: sourceNamesForField(feature, snapshots, "features.asylum_context"),
      asylum_snapshot_date: asylum?.snapshot_date || null,
      matched_area_code: asylum?.matched_area_code || null,
      matched_area_name: asylum?.matched_area_name || null,
      population_method: population?.method || "missing",
      population_quality_level: population?.quality_level || "missing",
      population_geography_fit: population?.geography_fit || "missing",
      population_confidence: population?.confidence || "missing",
      population_source_names: sourceNamesForField(feature, snapshots, "features.population_projection")
    };
  });
  return {
    generated_at: new Date().toISOString(),
    total_areas: rows.length,
    by_model_family: countBy(rows, (row) => row.model_family),
    asylum_precision_by_family: Object.fromEntries(Object.entries(countBy(rows, (row) => row.model_family)).map(([family]) => [
      family,
      countBy(rows.filter((row) => row.model_family === family), (row) => row.asylum_precision)
    ])),
    asylum_source_by_family: Object.fromEntries(Object.entries(countBy(rows, (row) => row.model_family)).map(([family]) => [
      family,
      countBy(rows.filter((row) => row.model_family === family), (row) => row.asylum_source_names.join(" + ") || "missing")
    ])),
    population_method_by_family: Object.fromEntries(Object.entries(countBy(rows, (row) => row.model_family)).map(([family]) => [
      family,
      countBy(rows.filter((row) => row.model_family === family), (row) => `${row.population_method}:${row.population_quality_level}:${row.population_geography_fit}:${row.population_confidence}`)
    ])),
    areas_needing_asylum_context: rows.filter((row) => row.asylum_precision === "missing" || row.asylum_precision === "constituency_context"),
    rows
  };
}

function asTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(column.value(row) ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function markdown(summary) {
  const precisionRows = Object.entries(summary.asylum_precision_by_family).flatMap(([family, counts]) =>
    Object.entries(counts).map(([precision, count]) => ({ family, precision, count }))
  );
  const sourceRows = Object.entries(summary.asylum_source_by_family).flatMap(([family, counts]) =>
    Object.entries(counts).map(([source, count]) => ({ family, source, count }))
  );
  const populationRows = Object.entries(summary.population_method_by_family).flatMap(([family, counts]) =>
    Object.entries(counts).map(([method, count]) => ({ family, method, count }))
  );
  return [
    "# Demographic Method Audit",
    "",
    `Generated at: ${summary.generated_at}`,
    "",
    `Model areas: ${summary.total_areas}`,
    `Areas needing direct/apportioned asylum context: ${summary.areas_needing_asylum_context.length}`,
    "",
    "## Asylum Precision",
    "",
    asTable(precisionRows, [
      { label: "Family", value: (row) => row.family },
      { label: "Precision", value: (row) => row.precision },
      { label: "Areas", value: (row) => row.count }
    ]),
    "",
    "## Asylum Source",
    "",
    asTable(sourceRows, [
      { label: "Family", value: (row) => row.family },
      { label: "Source", value: (row) => row.source },
      { label: "Areas", value: (row) => row.count }
    ]),
    "",
    "## Population Method",
    "",
    asTable(populationRows, [
      { label: "Family", value: (row) => row.family },
      { label: "Method", value: (row) => row.method },
      { label: "Areas", value: (row) => row.count }
    ]),
    ""
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Summarise demographic/asylum methods in an imported local-upstream bundle.

Usage:
  node scripts/summarise-demographic-methods.mjs --input /tmp/ukelections-local-upstreams --output /tmp/ukelections-local-upstreams/demographic-methods.json --markdown-output /tmp/ukelections-local-upstreams/demographic-methods.md
`);
  process.exit(0);
}

const summary = buildSummary({
  featureSnapshots: readJson(path.join(args.input, "model-features.json"), []),
  sourceSnapshots: readJson(path.join(args.input, "source-snapshots.json"), [])
});

mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
if (args.markdownOutput) {
  mkdirSync(path.dirname(args.markdownOutput), { recursive: true });
  writeFileSync(args.markdownOutput, markdown(summary), "utf8");
}

console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  markdown_output: args.markdownOutput ? path.resolve(args.markdownOutput) : null,
  total_areas: summary.total_areas,
  areas_needing_asylum_context: summary.areas_needing_asylum_context.length,
  asylum_precision_by_family: summary.asylum_precision_by_family
}, null, 2));
