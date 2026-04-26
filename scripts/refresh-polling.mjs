#!/usr/bin/env node
// refresh-polling.mjs — fetch the UK Westminster, Welsh and Scottish polling
// averages from Wikipedia (most defensible single-source aggregator) and
// write a runtime override at data/polling/override.json that
// nationalPolling.js loads at module-init time.
//
// Why Wikipedia: transparent methodology, every poll cited to its primary
// source, updated within hours of publication, public-domain.
//
// Stages:
//   1. Fetch wikitext via the MediaWiki API for each polling page.
//   2. Parse the polling table (first wikitable on the page) into rows.
//   3. Take all polls within the last 14 days, share-weighted average per
//      party, write to data/polling/override.json.
//   4. If parse fails, surface an error and keep the prior override (do
//      NOT overwrite a known-good override with a parse failure).
//
// Usage:
//   node scripts/refresh-polling.mjs              # update override
//   node scripts/refresh-polling.mjs --dry-run    # parse + report, no write
//
// Designed to run weekly via vps-main cron — see ops/cron.d/ukelections.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OVERRIDE = path.join(ROOT, "data/polling/override.json");
const LEDGER = path.join(ROOT, "data/polling/ledger.json");
const LATEST = path.join(ROOT, "data/polling/latest.json");
const USER_AGENT = "ukelections.co.uk polling-refresh (contact: tom@ukelections.co.uk)";

const DRY_RUN = process.argv.includes("--dry-run");
const WINDOW_DAYS = 14;

// Each source maps a Wikipedia page → the column-order Wikipedia uses for
// shares in its first wikitable, plus the canonical party labels we want
// to write. Column counts include the date / pollster / client / area /
// sample preamble so the parser can skip them; only the share columns
// matter for averaging.
// Each source needs:
//   preamble: number of cells before the first share column (date / pollster
//             / client / [area] / sample varies per page)
//   columns:  ordered share-column labels (matching Wikipedia table order;
//             we discard "Lead" trailing column by only reading N share cols)
//   filter_area: true → require GB/UK in the area cell (only the UK page has
//             this column; Welsh/Scottish pages don't and shouldn't be filtered)
const SOURCES = {
  uk_westminster: {
    page: "Opinion_polling_for_the_next_United_Kingdom_general_election",
    constant: "UK_WESTMINSTER_2026_APRIL_AVERAGE",
    preamble: 5,
    filter_area: true,
    columns: [
      "Labour", "Conservative", "Reform UK",
      "Liberal Democrats", "Green Party", "SNP", "Plaid Cymru", "Other",
    ],
    label: "UK Westminster",
  },
  welsh: {
    page: "Opinion_polling_for_the_2026_Senedd_election",
    constant: "WELSH_2026_APRIL_AVERAGE",
    preamble: 4,
    filter_area: false,
    columns: [
      "Labour", "Conservative", "Plaid Cymru",
      "Green Party", "Liberal Democrats", "Reform UK", "Other",
    ],
    label: "Welsh Senedd",
  },
  scottish: {
    page: "Opinion_polling_for_the_2026_Scottish_Parliament_election",
    constant: "SCOTTISH_2026_APRIL_AVERAGE",
    preamble: 4,
    filter_area: false,
    // Scottish page has an Alba column between Greens and Reform — we
    // ingest it as "Other Scottish" so the share is preserved without
    // needing a top-level Alba constant.
    columns: [
      "SNP", "Conservative", "Labour", "Liberal Democrats",
      "Green Party", "Alba", "Reform UK", "Other",
    ],
    label: "Scottish Parliament",
  },
};

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function parseOpdrts(s) {
  // {{opdrts|22|24|Apr|2026}} → mid-date 23 Apr 2026 (UTC). Variants:
  //   {{opdrts|D|Mon|YYYY}}        — single-day poll
  //   {{opdrts|D1|D2|Mon|YYYY}}    — two-day fieldwork window
  //   {{opdrts|D1|D2|Mon|YYYY|year}} — formatted-year flag, ignore extra args
  const m = s.match(/\{\{opdrts\|([^}]+)\}\}/i);
  if (!m) return null;
  const parts = m[1].split("|").map((p) => p.trim()).filter(Boolean);
  // Find the year (4 digits)
  const yearIdx = parts.findIndex((p) => /^\d{4}$/.test(p));
  if (yearIdx < 0) return null;
  const year = parseInt(parts[yearIdx], 10);
  // Find the month
  const monthIdx = parts.findIndex((p) => MONTHS[p.toLowerCase()] != null);
  if (monthIdx < 0) return null;
  const month = MONTHS[parts[monthIdx].toLowerCase()];
  // Day(s) are the numeric parts that aren't the year
  const dayParts = parts.filter((p, i) => i !== yearIdx && i !== monthIdx && /^\d{1,2}$/.test(p));
  if (dayParts.length === 0) return null;
  // Use the latest day (poll completion)
  const day = Math.max(...dayParts.map((p) => parseInt(p, 10)));
  return new Date(Date.UTC(year, month, day));
}

function stripWikiMarkup(cell) {
  // Strip the leading "style=..."| if present, refs, bold, hidden templates.
  let s = cell;
  s = s.replace(/^\s*style="[^"]*"\s*\|\s*/, "");
  s = s.replace(/^\s*\|\s*/, "");
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  s = s.replace(/<ref[^/]*\/>/g, "");
  s = s.replace(/'''/g, "");
  // Hidden templates: {{Hidden|VISIBLE|...}} → keep VISIBLE
  s = s.replace(/\{\{Hidden\|([^|}]+)\|[^}]*\}\}/gi, "$1");
  return s.trim();
}

function parsePercent(cell) {
  const stripped = stripWikiMarkup(cell);
  const m = stripped.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  return parseFloat(m[1]) / 100;
}

async function fetchWikitext(page) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`;
  const r = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${page}`);
  const d = await r.json();
  if (!d.parse?.wikitext) throw new Error(`no wikitext in response for ${page}`);
  return d.parse.wikitext;
}

function extractFirstTable(wt) {
  const start = wt.indexOf('{| class="wikitable');
  if (start < 0) throw new Error("no wikitable found");
  const after = wt.slice(start);
  const end = after.indexOf("\n|}");
  if (end < 0) throw new Error("unterminated wikitable");
  return after.slice(0, end);
}

function parseRows(tableBody) {
  // Header rows are everything before the first "|-" data separator that
  // follows the header "!" lines. We split on "\n|-" and skip rows that
  // don't have a date template at the start.
  const chunks = tableBody.split(/\n\|-/);
  const rows = [];
  for (const chunk of chunks) {
    if (!/\{\{opdrts/i.test(chunk)) continue;
    const cells = [];
    // Cells in MediaWiki row syntax can be on separate lines starting with `|`,
    // or pipe-separated on one line. Normalise to one cell per `|` boundary.
    const lines = chunk.split(/\n/);
    let buf = "";
    for (const line of lines) {
      if (!line.trim()) continue;
      if (line.startsWith("|")) {
        if (buf.trim()) cells.push(buf);
        buf = line.slice(1);
      } else {
        buf += "\n" + line;
      }
    }
    if (buf.trim()) cells.push(buf);
    rows.push(cells);
  }
  return rows;
}

function averageRecentPolls(rows, spec, windowDays) {
  const { preamble, filter_area, columns: columnLabels } = spec;
  const cutoff = Date.now() - windowDays * 86400 * 1000;
  const sums = {};
  const counts = {};
  let used = 0;
  let earliest = null;
  let latest = null;

  for (const cells of rows) {
    if (cells.length < preamble + columnLabels.length) continue;
    const date = parseOpdrts(cells[0]);
    if (!date) continue;
    if (date.getTime() < cutoff) continue;
    if (date.getTime() > Date.now() + 86400 * 1000) continue;
    if (filter_area) {
      const area = stripWikiMarkup(cells[3] || "").toUpperCase();
      if (!/(GB|UK|GREAT BRITAIN|UNITED KINGDOM)/.test(area)) continue;
    }

    const shareCells = cells.slice(preamble, preamble + columnLabels.length);
    const parsed = shareCells.map(parsePercent);
    // Allow up to one missing column (Alba/Plaid sometimes blank in early polls).
    const missing = parsed.filter((v) => v == null).length;
    if (missing > 1) continue;
    const filled = parsed.map((v) => v == null ? 0 : v);

    const sum = filled.reduce((s, v) => s + v, 0);
    if (sum < 0.85 || sum > 1.15) continue;

    for (let i = 0; i < columnLabels.length; i++) {
      const label = columnLabels[i];
      sums[label] = (sums[label] || 0) + filled[i];
      counts[label] = (counts[label] || 0) + 1;
    }
    used += 1;
    if (!earliest || date.getTime() < earliest.getTime()) earliest = date;
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }

  if (used === 0) return null;
  const shares = {};
  for (const label of columnLabels) {
    shares[label] = counts[label] ? sums[label] / counts[label] : 0;
  }
  // Re-normalise (averaging doesn't preserve sum-to-1 strictly).
  const total = Object.values(shares).reduce((s, v) => s + v, 0);
  if (total > 0) for (const k of Object.keys(shares)) shares[k] = shares[k] / total;

  return {
    shares,
    polls_used: used,
    fieldwork_window: {
      earliest: earliest ? earliest.toISOString().slice(0, 10) : null,
      latest: latest ? latest.toISOString().slice(0, 10) : null,
    },
  };
}

function loadExistingOverride() {
  if (!existsSync(OVERRIDE)) return null;
  try { return JSON.parse(readFileSync(OVERRIDE, "utf8")); } catch { return null; }
}

async function main() {
  mkdirSync(path.dirname(OVERRIDE), { recursive: true });
  const now = new Date().toISOString();
  const result = { generated_at: now, sources: {} };
  const errors = [];

  for (const [key, spec] of Object.entries(SOURCES)) {
    try {
      const wt = await fetchWikitext(spec.page);
      const sha = createHash("sha256").update(wt).digest("hex");
      const tableBody = extractFirstTable(wt);
      const rows = parseRows(tableBody);
      const avg = averageRecentPolls(rows, spec, WINDOW_DAYS);
      if (!avg) throw new Error(`no valid polls in last ${WINDOW_DAYS} days`);
      result.sources[key] = {
        constant: spec.constant,
        label: spec.label,
        page: spec.page,
        url: `https://en.wikipedia.org/wiki/${spec.page}`,
        shares: avg.shares,
        polls_used: avg.polls_used,
        fieldwork_window: avg.fieldwork_window,
        wikitext_sha256: sha,
        retrieved_at: now,
        review_status: "auto_parsed",
      };
      process.stdout.write(`✓ ${spec.label}: averaged ${avg.polls_used} polls from ${avg.fieldwork_window.earliest} to ${avg.fieldwork_window.latest}\n`);
      for (const [p, v] of Object.entries(avg.shares)) {
        process.stdout.write(`    ${p.padEnd(20)} ${(v * 100).toFixed(1)}%\n`);
      }
    } catch (err) {
      const msg = String(err.message || err);
      errors.push({ source: key, error: msg });
      result.sources[key] = { constant: spec.constant, error: msg, retrieved_at: now, review_status: "parse_failed" };
      process.stderr.write(`✗ ${spec.label}: ${msg}\n`);
    }
  }

  if (DRY_RUN) {
    process.stdout.write(`\n[dry-run] not writing override\n`);
    return;
  }

  // Refuse to overwrite a working override with an all-failing run.
  const allFailed = Object.values(result.sources).every((v) => v.review_status === "parse_failed");
  if (allFailed) {
    const prior = loadExistingOverride();
    process.stderr.write(`\nAll sources failed — keeping prior override (if any).\n`);
    writeFileSync(LATEST, JSON.stringify(result, null, 2));
    process.exit(1);
  }

  // Merge: any source that failed this run keeps its prior values; new
  // successful runs overwrite. This makes the cron resilient against
  // single-source Wikipedia outages.
  const prior = loadExistingOverride();
  if (prior?.sources) {
    for (const [k, v] of Object.entries(prior.sources)) {
      if (result.sources[k]?.review_status === "parse_failed" && v.review_status === "auto_parsed") {
        result.sources[k] = { ...v, retained_from: v.retrieved_at };
        process.stdout.write(`  (retained prior ${k} from ${v.retrieved_at})\n`);
      }
    }
  }

  writeFileSync(OVERRIDE, JSON.stringify(result, null, 2));
  writeFileSync(LATEST, JSON.stringify(result, null, 2));

  // Append to ledger
  let ledger = [];
  if (existsSync(LEDGER)) {
    try { ledger = JSON.parse(readFileSync(LEDGER, "utf8")); } catch { ledger = []; }
  }
  ledger.push({
    generated_at: now,
    sources: Object.fromEntries(Object.entries(result.sources).map(([k, v]) => [k, {
      review_status: v.review_status,
      polls_used: v.polls_used,
      shares: v.shares,
      error: v.error,
    }])),
  });
  ledger = ledger.slice(-90);
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));

  process.stdout.write(`\nWrote ${OVERRIDE} (${Object.keys(result.sources).length} sources).\n`);
  process.stdout.write(`nationalPolling.js will load this override at module init.\n`);
  // Partial failures are non-fatal: prior values were retained for any
  // source that failed this run. Only an all-fail aborts above.
  if (errors.length) process.stdout.write(`(${errors.length} source(s) failed; prior values retained)\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
