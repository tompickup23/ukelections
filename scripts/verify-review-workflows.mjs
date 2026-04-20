#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchSourceSnapshot } from "./lib/source-fetcher.mjs";
import {
  buildReviewEvidenceVerification,
  decodeHtmlEntities,
  extractTextFromRawFile,
  normaliseForEvidenceSearch,
  stripHtml
} from "./lib/review-evidence-verifier.mjs";

function parseArgs(argv) {
  const args = {
    workflows: "/tmp/ukelections-local-upstreams/review-workflows.json",
    execution: "/tmp/ukelections-local-upstreams/review-workflow-execution.json",
    output: "/tmp/ukelections-local-upstreams/review-workflow-evidence.json",
    markdownOutput: "/tmp/ukelections-local-upstreams/review-workflow-evidence.md",
    linkedRawDir: "/tmp/ukelections-local-upstreams/raw-review-linked-sources",
    crawlLinkedSources: false,
    maxDepth: 3,
    maxLinkedFetches: 150,
    timeoutMs: 20000,
    licence: "Review required before public reuse"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workflows") args.workflows = argv[++index];
    else if (arg === "--execution") args.execution = argv[++index];
    else if (arg === "--output") args.output = argv[++index];
    else if (arg === "--markdown-output") args.markdownOutput = argv[++index];
    else if (arg === "--linked-raw-dir") args.linkedRawDir = argv[++index];
    else if (arg === "--crawl-linked-sources") args.crawlLinkedSources = true;
    else if (arg === "--max-depth") args.maxDepth = Number(argv[++index]);
    else if (arg === "--max-linked-fetches") args.maxLinkedFetches = Number(argv[++index]);
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (arg === "--licence") args.licence = argv[++index];
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
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function extensionForUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const extension = pathname.match(/\.([a-z0-9]{2,5})$/)?.[1];
    if (extension) return extension;
  } catch {
    return "html";
  }
  return "html";
}

function htmlFromFile(filePath) {
  if (!filePath) return "";
  const raw = readFileSync(filePath, "utf8");
  return /<\/?[a-z][\s\S]*>/i.test(raw) ? raw : "";
}

function extractLinks(html, baseUrl) {
  const links = [];
  const anchorPattern = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    const attrs = match[1];
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    try {
      const url = new URL(decodeHtmlEntities(href), baseUrl).toString();
      links.push({
        url,
        text: stripHtml(match[2]),
        title: decodeHtmlEntities(attrs.match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1] || "")
      });
    } catch {
      // Ignore malformed site-local links.
    }
  }
  return links;
}

function sourceTargetById(workflows) {
  return new Map((workflows.source_targets || []).map((target) => [target.target_id, target]));
}

function areasByTarget(workflows) {
  const mapping = new Map();
  for (const area of workflows.areas || []) {
    for (const targetId of area.source_targets || []) {
      if (!mapping.has(targetId)) mapping.set(targetId, []);
      mapping.get(targetId).push(area);
    }
  }
  return mapping;
}

function hasAreaTerm(link, areas) {
  const haystack = normaliseForEvidenceSearch(`${link.text} ${link.title} ${link.url}`);
  return areas.some((area) => {
    const name = normaliseForEvidenceSearch(area.area_name.replace(/\bWard$/i, ""));
    return name.length >= 4 && haystack.includes(name);
  });
}

function linkPriority(link, areas) {
  const haystack = normaliseForEvidenceSearch(`${link.text} ${link.title} ${link.url}`);
  const pathname = (() => {
    try {
      return new URL(link.url).pathname;
    } catch {
      return "";
    }
  })();
  if (hasAreaTerm(link, areas)) return 0;
  if (/mgElectionAreaResults/i.test(pathname)) return 1;
  if (/mgElectionElectionAreaResults/i.test(pathname)) return 2;
  if (/mgElectionResults/i.test(pathname)) return 3;
  if (/mgManageElectionResults/i.test(pathname)) return 4;
  if (/\bdeclaration|result|ward|borough election|local election/.test(haystack)) return 5;
  return 9;
}

function isNonResultUtilityLink(link) {
  const url = link.url || "";
  return /mgFindMember|mgMember|mgCalendar|mgListCommittees|mgPlansHome|mgEPetition|mgRegister|mgParishCouncilDetails|ieDoc|ecCatDisplay/i.test(url);
}

function shouldFollowLink({ link, target, areas, depth }) {
  let parsed;
  try {
    parsed = new URL(link.url);
  } catch {
    return false;
  }
  if (isNonResultUtilityLink(link)) return false;
  const urlText = normaliseForEvidenceSearch(link.url);
  const linkText = normaliseForEvidenceSearch(`${link.text} ${link.title}`);
  const sourceUrl = target?.url ? new URL(target.url) : null;
  const sameOrigin = sourceUrl && parsed.origin === sourceUrl.origin;
  const hasElectionTerm = /\belection|result|ward|borough|local|declaration|download|directory|mgelection/.test(`${urlText} ${linkText}`);
  if (hasAreaTerm(link, areas)) return true;
  if (!hasElectionTerm) return false;

  if (target?.target_id === "west-lancashire-election-results-archive") {
    return parsed.hostname === "democracy.westlancs.gov.uk" && (
      parsed.pathname.includes("mgElection")
      || parsed.pathname.includes("mgManageElectionResults")
    );
  }

  if (target?.target_id === "rossendale-2024-borough-results") {
    return sameOrigin && (
      parsed.pathname.includes("/elections-voting/election-results")
      || parsed.pathname.includes("/downloads/")
    );
  }

  if (target?.target_id === "pendle-election-results") {
    return sameOrigin && (
      parsed.pathname.includes("/directory/36/election_results")
      || parsed.pathname.includes("/directory_record/")
    );
  }

  if (target?.target_id === "ribble-valley-2023-borough-results") {
    return sameOrigin && (
      parsed.pathname.includes("/borough-elections/borough-elections-2023-results")
      || parsed.pathname.includes("/election-results-1/")
      || parsed.pathname.includes("/elections-voting/borough-elections-2019-results")
      || parsed.pathname.includes("/downloads/download/132/")
      || parsed.pathname.includes("/downloads/file/")
    );
  }

  if (target?.target_id === "lancaster-2023-ward-results") {
    return sameOrigin && parsed.pathname.includes("mgElection");
  }

  if (depth === 0 && sameOrigin) return true;
  return false;
}

async function fetchLinkedSnapshot({ link, target, args, index }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  const sourceName = `${target.source_name} linked evidence ${index}`;
  const outputPath = path.join(args.linkedRawDir, `${slug(target.target_id)}-${String(index).padStart(3, "0")}-${slug(link.text || link.title || link.url)}.${extensionForUrl(link.url)}`);
  try {
    const snapshot = await fetchSourceSnapshot({
      sourceName,
      sourceUrl: link.url,
      licence: target.licence || args.licence,
      outputPath,
      signal: controller.signal
    });
    return {
      ok: true,
      snapshot: {
        ...snapshot,
        target_id: target.target_id,
        source_classes: target.source_classes || [],
        linked_source: true,
        parent_target_id: target.target_id,
        link_text: link.text,
        link_title: link.title
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error.name === "AbortError" ? `Fetch timed out after ${args.timeoutMs}ms` : error.message,
      url: link.url
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sourceRecordFromLinkedSnapshot(snapshot) {
  const extraction = extractTextFromRawFile(snapshot.raw_file_path);
  return {
    target_id: snapshot.target_id,
    snapshot_id: snapshot.snapshot_id,
    source_name: snapshot.source_name,
    source_url: snapshot.source_url,
    raw_file_path: snapshot.raw_file_path,
    source_classes: snapshot.source_classes || [],
    extraction_method: extraction.method,
    extraction_error: extraction.error || null,
    searchable_text: normaliseForEvidenceSearch(extraction.text),
    text_length: extraction.text.length,
    linked_source: true
  };
}

async function crawlLinkedSources({ workflows, execution, args }) {
  const targetById = sourceTargetById(workflows);
  const areaMap = areasByTarget(workflows);
  const queue = [];
  const seen = new Set();
  const sourceRecords = [];
  const fetchErrors = [];

  for (const snapshot of execution.source_snapshots || []) {
    const target = targetById.get(snapshot.target_id);
    if (!target || target.council_name === "*" || target.target_id.includes("fallback")) continue;
    const html = htmlFromFile(snapshot.raw_file_path);
    if (!html) continue;
    for (const link of extractLinks(html, snapshot.source_url)) {
      if (shouldFollowLink({ link, target, areas: areaMap.get(snapshot.target_id) || [], depth: 0 })) {
        queue.push({ link, target, depth: 1, priority: linkPriority(link, areaMap.get(snapshot.target_id) || []) });
      }
    }
  }

  let index = 1;
  while (queue.length > 0 && sourceRecords.length < args.maxLinkedFetches) {
    queue.sort((left, right) => left.priority - right.priority);
    const item = queue.shift();
    const normalizedUrl = item.link.url.replace(/#.*$/, "");
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);

    const result = await fetchLinkedSnapshot({
      link: item.link,
      target: item.target,
      args,
      index
    });
    index += 1;
    if (!result.ok) {
      fetchErrors.push({
        target_id: item.target.target_id,
        url: item.link.url,
        error: result.error
      });
      continue;
    }

    const record = sourceRecordFromLinkedSnapshot(result.snapshot);
    sourceRecords.push(record);

    if (item.depth >= args.maxDepth) continue;
    const html = htmlFromFile(result.snapshot.raw_file_path);
    if (!html) continue;
    for (const link of extractLinks(html, result.snapshot.source_url)) {
      if (shouldFollowLink({
        link,
        target: item.target,
        areas: areaMap.get(item.target.target_id) || [],
        depth: item.depth
      })) {
        queue.push({
          link,
          target: item.target,
          depth: item.depth + 1,
          priority: linkPriority(link, areaMap.get(item.target.target_id) || []) + item.depth
        });
      }
    }
  }

  return {
    sourceRecords,
    fetchErrors
  };
}

function markdown(verification) {
  const summaryRows = Object.entries(verification.by_source_evidence_status || {})
    .map(([status, count]) => `| ${status} | ${count} |`);
  const boundaryRows = Object.entries(verification.by_boundary_evidence_status || {})
    .map(([status, count]) => `| ${status} | ${count} |`);
  const areaRows = (verification.areas || []).map((area) => {
    const matched = area.matched_sources.map((source) => source.source_name || source.target_id).join("; ");
    const blocker = area.promotion_blockers[0] || "";
    return `| ${area.priority} | ${area.workflow_code} | ${area.area_name} (${area.area_code}) | ${area.source_evidence_status} | ${area.boundary_evidence_status} | ${matched} | ${area.promotion_status} | ${blocker.replace(/\|/g, "\\|")} |`;
  });
  const linkedRows = (verification.linked_sources || []).map((source) =>
    `| ${source.target_id} | ${source.source_name} | ${source.extraction_method} | ${source.text_length} | ${source.source_url} |`
  );

  return [
    "# Review Workflow Evidence Verification",
    "",
    `Generated at: ${verification.generated_at}`,
    "",
    `Areas: ${verification.total_areas}`,
    `Area names confirmed in source text: ${verification.area_name_confirmed}`,
    `Areas still needing a more specific source: ${verification.areas_still_needing_specific_source}`,
    `Linked source records fetched: ${verification.linked_source_records}`,
    "",
    "## Area Evidence Counts",
    "",
    "| Status | Areas |",
    "| --- | --- |",
    ...summaryRows,
    "",
    "## Boundary Evidence Counts",
    "",
    "| Status | Areas |",
    "| --- | --- |",
    ...boundaryRows,
    "",
    "## Linked Sources",
    "",
    "| Target | Source | Extraction | Text length | URL |",
    "| --- | --- | --- | --- | --- |",
    ...linkedRows,
    "",
    "## Area Status",
    "",
    "| Priority | Workflow | Area | Source evidence | Boundary evidence | Matched sources | Promotion | First blocker |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...areaRows,
    ""
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Verify fetched review-workflow evidence against all review areas.

Usage:
  node scripts/verify-review-workflows.mjs --workflows /tmp/ukelections-local-upstreams/review-workflows.json --execution /tmp/ukelections-local-upstreams/review-workflow-execution.json --output /tmp/ukelections-local-upstreams/review-workflow-evidence.json --markdown-output /tmp/ukelections-local-upstreams/review-workflow-evidence.md --crawl-linked-sources
`);
  process.exit(0);
}

const workflows = JSON.parse(readFileSync(args.workflows, "utf8"));
const execution = JSON.parse(readFileSync(args.execution, "utf8"));
mkdirSync(args.linkedRawDir, { recursive: true });
const linked = args.crawlLinkedSources
  ? await crawlLinkedSources({ workflows, execution, args })
  : { sourceRecords: [], fetchErrors: [] };
const verification = buildReviewEvidenceVerification({
  workflows,
  execution,
  extraSourceRecords: linked.sourceRecords
});
verification.linked_fetch_errors = linked.fetchErrors;
verification.run_hash = createHash("sha256")
  .update(JSON.stringify({
    workflows: workflows.generated_at || workflows.total,
    execution: execution.generated_at,
    linkedSources: verification.linked_sources.map((source) => source.source_url)
  }))
  .digest("hex")
  .slice(0, 12);

mkdirSync(path.dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(verification, null, 2)}\n`, "utf8");
if (args.markdownOutput) {
  mkdirSync(path.dirname(args.markdownOutput), { recursive: true });
  writeFileSync(args.markdownOutput, markdown(verification), "utf8");
}

console.log(JSON.stringify({
  ok: true,
  output: path.resolve(args.output),
  markdown_output: args.markdownOutput ? path.resolve(args.markdownOutput) : null,
  total_areas: verification.total_areas,
  area_name_confirmed: verification.area_name_confirmed,
  areas_still_needing_specific_source: verification.areas_still_needing_specific_source,
  linked_source_records: verification.linked_source_records,
  linked_fetch_errors: linked.fetchErrors.length,
  by_source_evidence_status: verification.by_source_evidence_status,
  by_boundary_evidence_status: verification.by_boundary_evidence_status,
  run_hash: verification.run_hash
}, null, 2));
