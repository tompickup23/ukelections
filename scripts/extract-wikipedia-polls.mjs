#!/usr/bin/env node
/**
 * extract-wikipedia-polls.mjs: pull GB and UK-wide Westminster voting
 * intention polls out of a saved Wikipedia "Opinion polling for ..." page, for
 * a fieldwork-end window, keeping each poll's pollster, fieldwork dates, area
 * and sample. Used for the poll windows the hold-out protocols name where
 * data/polling/timeseries.json has no polls (2022, and February 2025 to
 * January 2026). See docs/local-engine-holdout-2026-11.md.
 *
 * Offline: it reads wikitext saved from
 *   https://en.wikipedia.org/w/index.php?title=<page>&oldid=<revid>&action=raw
 * so a run is reproducible from the revision id.
 *
 * Usage:
 *   node scripts/extract-wikipedia-polls.mjs --wikitext=<file> --page=<title>
 *     --revid=<id> --from=YYYY-MM-DD --to=YYYY-MM-DD [--out=<path>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const HEADER_PARTY = [
  [/\|Con\]\]/, "Conservative"],
  [/\|Lab\]\]/, "Labour"],
  [/\|LD\]\]/, "Liberal Democrats"],
  [/\|Ref\]\]/, "Reform UK"],
  [/\|Grn\]\]/, "Green Party"],
  [/\|SNP\]\]/, "SNP"],
  [/\|PC\]\]/, "Plaid Cymru"],
];

const pad = (n) => String(n).padStart(2, "0");

// {{opdrts|start day|end day|Mon|Year}}; the start day may be blank (one-day
// fieldwork) or belong to the previous month. Months are names or numbers.
export function fieldworkEnd(cell) {
  const m = cell.match(/\{\{opdrts\|([^}]*)\}\}/);
  if (!m) return null;
  const parts = m[1].split("|");
  // Some rows carry a trailing flag ("...|2026|year"); the year is the last four-digit part.
  while (parts.length && !/^\d{4}$/.test(parts[parts.length - 1])) parts.pop();
  const year = Number(parts[parts.length - 1]);
  const monRaw = parts[parts.length - 2];
  const mon = MONTHS[String(monRaw).slice(0, 3)] || Number(monRaw);
  const day = Number(parts[parts.length - 3]);
  if (!year || !mon || !day) return null;
  return `${year}-${pad(mon)}-${pad(day)}`;
}

function cellValue(raw) {
  let v = raw.trim();
  // Leading attribute blocks: style="..."|value, data-sort-value="..."|value.
  for (;;) {
    const a = v.match(/^(?:style|class|data-sort-value|colspan|rowspan|align)\s*=\s*("[^"]*"|\S+)(?:\s+(?:style|class|data-sort-value|colspan|rowspan|align)\s*=\s*("[^"]*"|\S+))*\s*\|(.*)$/s);
    if (!a) break;
    v = a[3].trim();
  }
  return v;
}

function plainText(v) {
  return v
    .replace(/\{\{(?:Webarchive|efn)[^}]*\}\}/gi, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[\S+\s+([^\]]+)\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function pct(v) {
  const t = plainText(v.replace(/\{\{(?:sdash|ndash|mdash|n\/a|na)\}\}/gi, "")).replace(/,/g, "");
  const m = t.match(/^(<)?\s*([0-9]+(?:\.[0-9]+)?)\s*%$/);
  if (!m) return t === "\u2013" || t === "\u2014" || t === "-" || t === "" ? null : undefined;
  return m[1] ? 0 : Number(m[2]) / 100;
}

export function extractPolls(wikitext, { from, to, section = null }) {
  let source = wikitext;
  // A sub-national section, such as "==== London ====", up to the next heading of the same depth.
  if (section) {
    const start = source.search(new RegExp(`^====\\s*${section}\\s*====\\s*$`, "m"));
    if (start < 0) throw new Error(`section ${section} not found`);
    const rest = source.slice(start).split("\n");
    const end = rest.slice(1).findIndex((l) => /^={2,4}[^=]/.test(l));
    source = (end < 0 ? rest : rest.slice(0, end + 1)).join("\n");
  }
  const text = source.replace(/<ref[^>/]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  const polls = [];
  const chunks = text.split(/\n\{\|/);
  // Tables sit under "=== YYYY ===" headings. A row whose template year
  // disagrees with its section (a typo on the page, such as "31|2|Feb|2025"
  // in the 2026 table) takes the section year and is flagged.
  const headingYear = (s) => { const all = [...s.matchAll(/^===\s*(\d{4})\s*===\s*$/gm)]; return all.length ? Number(all[all.length - 1][1]) : null; };
  let sectionYear = headingYear(chunks[0]);
  for (const table of chunks.slice(1)) {
    const tableYear = sectionYear;
    const tail = table.split(/\n\|\}/).slice(1).join("\n|}");
    sectionYear = headingYear(tail) ?? sectionYear;
    const body = table.split(/\n\|\}/)[0];
    const rows = body.split(/\n\|-[^\n]*/);
    const header = rows[0];
    const cols = [];
    for (const line of header.split("\n")) {
      if (!line.startsWith("!")) continue;
      const hit = HEADER_PARTY.find(([re]) => re.test(line));
      if (hit) cols.push(hit[1]);
    }
    if (!cols.length || !/Pollster/.test(header)) continue;
    // National tables carry an Area column before the sample size; sub-national ones do not.
    const hasArea = /\|\s*Area\s*$/m.test(header);
    const offset = hasArea ? 5 : 4;
    for (const row of rows.slice(1)) {
      const cells = row.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("|}")).map((l) => l.slice(1));
      if (cells.length < offset + cols.length) continue;
      let end = fieldworkEnd(cells[0]);
      let yearCorrected = false;
      if (end && tableYear && Number(end.slice(0, 4)) !== tableYear) { end = `${tableYear}${end.slice(4)}`; yearCorrected = true; }
      if (!end || end < from || end > to) continue;
      const area = hasArea ? plainText(cellValue(cells[3])) : section;
      if (hasArea && area !== "GB" && area !== "UK") continue;
      const shares = {};
      let ok = true;
      cols.forEach((p, i) => {
        const v = pct(cellValue(cells[offset + i]));
        if (v === undefined) ok = false;
        else if (v != null) shares[p] = v;
      });
      if (!ok) continue;
      const startDay = cells[0].match(/\{\{opdrts\|([^}]*)\}\}/)[1].split("|")[0];
      polls.push({
        fieldwork_end: end,
        fieldwork_cell: plainText(cells[0].replace(/\{\{opdrts\|([^}]*)\}\}/, (_, x) => x.split("|").filter((t) => t && t !== "year").join(" "))),
        fieldwork_start_day: startDay || null,
        pollster: plainText(cellValue(cells[1])),
        client: plainText(cellValue(cells[2])),
        area,
        sample: Number(plainText(cellValue(cells[offset - 1])).replace(/[^0-9]/g, "")) || null,
        shares,
        ...(yearCorrected ? { year_corrected_from_section: true } : {}),
      });
    }
  }
  return polls.sort((a, b) => (a.fieldwork_end < b.fieldwork_end ? -1 : a.fieldwork_end > b.fieldwork_end ? 1 : a.pollster.localeCompare(b.pollster)));
}

/** Per-pollster mean first, then the pollsters averaged equally. */
export function pollsterBalancedMean(polls, parties) {
  const byPollster = new Map();
  for (const p of polls) {
    const key = p.pollster.replace(/\s+/g, " ").trim();
    if (!byPollster.has(key)) byPollster.set(key, []);
    byPollster.get(key).push(p);
  }
  const out = {};
  for (const party of parties) {
    const means = [];
    for (const list of byPollster.values()) {
      const vals = list.map((p) => p.shares[party]).filter((v) => v != null);
      if (vals.length) means.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    out[party] = means.length ? means.reduce((a, b) => a + b, 0) / means.length : null;
  }
  return { shares: out, pollsters: [...byPollster.keys()].sort(), polls: polls.length };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  for (const k of ["wikitext", "page", "revid", "from", "to"]) if (!args[k]) throw new Error(`--${k} is required`);
  const polls = extractPolls(readFileSync(args.wikitext, "utf8"), { from: args.from, to: args.to, section: args.section || null });
  const out = {
    source: {
      publisher: "Wikipedia",
      page: args.page,
      revision_id: Number(args.revid),
      url: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(args.page.replace(/ /g, "_"))}&oldid=${args.revid}`,
      licence: "CC BY-SA 4.0; each row names the pollster, whose published tables are the primary source",
    },
    window: { fieldwork_end_from: args.from, fieldwork_end_to: args.to, ...(args.section ? { section: args.section } : {}) },
    extracted_by: "scripts/extract-wikipedia-polls.mjs",
    mean: pollsterBalancedMean(polls, ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"]),
    polls,
  };
  const json = JSON.stringify(out, null, 2) + "\n";
  if (args.out) writeFileSync(path.resolve(args.out), json);
  else process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
