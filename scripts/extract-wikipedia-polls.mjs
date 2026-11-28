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
 * Two date styles are read. Pages with {{opdrts}} rows (the 2024 and next
 * general election pages) take the original path below, whose output is
 * locked by tests/wikipedia-polls-plain-dates.test.mjs. Pages with no
 * {{opdrts}} rows at all (the 2017 and 2019 general election pages) take
 * extractPlainPolls, which reads plain-text dates, keeps UKIP, Brexit Party
 * and Change UK as their own keys, and adds a "counts" block saying how many
 * rows were found, kept and dropped, and why.
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

export function extractPolls(wikitext, { from, to, section = null, stats = null }) {
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
  // Pages with no {{opdrts}} rows at all (the 2017 and 2019 general election
  // pages) write their dates as plain text and are read by extractPlainPolls.
  // The choice is made for the whole page, so a page with {{opdrts}} rows, such
  // as the 2024 page, never reaches the plain-text path.
  if (!/\{\{opdrts\|/.test(text)) return extractPlainPolls(text, { from, to, section, stats });
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

// ---------------------------------------------------------------------------
// Plain-text date pages: "Opinion polling for the 2017 United Kingdom general
// election" and "Opinion polling for the 2019 United Kingdom general election".
// Their rows write fieldwork as text ("10–11 Dec", "27 Nov – 10 Dec") with the
// year taken from the "=== 2019 ===" heading above the table, combine pollster
// and client in one cell ("BMG/''The Independent''"), merge cells across
// parties (colspan) and across the rows of one poll (rowspan), and carry UKIP,
// Brexit Party and Change UK columns. Each of those is its own key here; any
// mapping onto a later party is a modelling decision made elsewhere.

const PLAIN_HEADER_PARTY = [
  ...HEADER_PARTY,
  [/\|UKIP\]\]/, "UKIP"],
  [/\|Brx\]\]/, "Brexit Party"],
  [/\|Chg\]\]/, "Change UK"],
];

const MONTH_RE = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DASH_RE = "\\s*(?:\u2013|\u2014|-|\\{\\{(?:ndash|snd|spaced ndash|mdash)\\}\\}|&ndash;|to)\\s*";
const DATE_FORMS = [
  // 12 Dec 2019, or 6 Nov under a year heading
  { re: new RegExp(`^(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?$`, "i"), parts: (m) => ({ d1: m[1], m1: m[2], y1: m[3], d2: m[1], m2: m[2], y2: m[3] }) },
  // 10–11 Dec, a range within one month
  { re: new RegExp(`^(\\d{1,2})${DASH_RE}(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?$`, "i"), parts: (m) => ({ d1: m[1], m1: m[3], y1: m[4], d2: m[2], m2: m[3], y2: m[4] }) },
  // 27 Nov – 10 Dec, or 21 Dec 2018 – 4 Jan 2019, a range across months or a year end
  { re: new RegExp(`^(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?${DASH_RE}(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?$`, "i"), parts: (m) => ({ d1: m[1], m1: m[2], y1: m[3], d2: m[4], m2: m[5], y2: m[6] }) },
];

const monthNumber = (s) => MONTHS[s.slice(0, 1).toUpperCase() + s.slice(1, 3).toLowerCase()];
const isoDate = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/**
 * Fieldwork dates from a plain-text cell. The end year is the cell's own year
 * if it gives one, otherwise the year of the heading the table sits under; a
 * start month later than the end month belongs to the year before. Returns
 * null for anything that is not one of the three forms above.
 */
export function plainFieldwork(cell, sectionYear = null) {
  const text = plainText(String(cell)).replace(/&nbsp;|\u00a0/g, " ").replace(/\s+/g, " ").trim();
  for (const form of DATE_FORMS) {
    const m = text.match(form.re);
    if (!m) continue;
    const p = form.parts(m);
    const m1 = monthNumber(p.m1);
    const m2 = monthNumber(p.m2);
    const y2 = p.y2 ? Number(p.y2) : sectionYear;
    if (!y2) return null;
    const y1 = p.y1 ? Number(p.y1) : m1 > m2 ? y2 - 1 : y2;
    const start = isoDate(y1, m1, Number(p.d1));
    const end = isoDate(y2, m2, Number(p.d2));
    if (!start || !end || start > end) return null;
    return { start, end };
  }
  return null;
}

// A pipe whose left side holds no link or template separates attributes from
// the value, as MediaWiki reads it: "|8%" on a "||" continuation line, or a
// stray "[ |[https://... Pollster]" typo.
function looseValue(v) {
  const i = v.indexOf("|");
  if (i < 0 || v[i + 1] === "|" || /\[\[|\{\{/.test(v.slice(0, i))) return v;
  return v.slice(i + 1).trim();
}

// Templates in a pollster cell: an archive template's title= is the link text
// ({{Deprecated archive|url=...|title=Ipsos MORI}}); any other ({{Dead link}},
// {{Webarchive}}) is maintenance and dropped.
const dropTemplates = (v) => v
  .replace(/\{\{[^{}]*?\|\s*title\s*=\s*([^|{}]*)[^{}]*\}\}/gi, "$1")
  .replace(/\{\{[^{}]*\}\}/g, "");

// A cell's attributes (rowspan, colspan, data-sort-value) and its value.
function splitCell(raw) {
  const value = looseValue(cellValue(raw));
  const trimmed = raw.trim();
  const head = trimmed.slice(0, Math.max(0, trimmed.length - value.length));
  const num = (name) => Number(head.match(new RegExp(`${name}\\s*=\\s*"?(\\d+)`))?.[1] || 1);
  return { value, rowspan: num("rowspan"), colspan: num("colspan"), sortValue: head.match(/data-sort-value\s*=\s*"([^"]*)"/)?.[1] ?? null };
}

// Data cells of one row: "|" lines, inline "||" separators, and continuation lines.
function rowCells(row) {
  const cells = [];
  for (const line of row.split("\n")) {
    if (line.startsWith("!")) return null;
    if (line.startsWith("|}") || line.startsWith("|+")) continue;
    if (line.startsWith("|")) cells.push(...line.slice(1).split("||"));
    else if (cells.length) cells[cells.length - 1] += `\n${line}`;
  }
  return cells;
}

function plainShare(raw) {
  const t = plainText(raw.replace(/\{\{(?:sdash|ndash|mdash|n\/a|na)\}\}/gi, "")).replace(/,/g, "").replace(/&nbsp;|\u00a0/g, " ").trim();
  if (t === "" || /^[\u2013\u2014-]$/.test(t) || /^n\/a$/i.test(t)) return { kind: "none" };
  const m = t.match(/^([0-9]+(?:\.[0-9]+)?)\s*%$/);
  if (m) return { kind: "value", value: Number(m[1]) / 100 };
  if (/^<\s*1\s*%$/.test(t)) return { kind: "below_one" };
  return { kind: "bad", text: t };
}

function headerColumns(headerRow) {
  const cols = [];
  for (const line of headerRow.split("\n")) {
    if (!line.startsWith("!")) continue;
    for (const raw of line.slice(1).split("!!")) {
      const colspan = Number(raw.match(/colspan\s*=\s*"?(\d+)/)?.[1] || 1);
      const party = PLAIN_HEADER_PARTY.find(([re]) => re.test(raw))?.[1] ?? null;
      // The label is the text after the last attribute separator.
      const t = plainText(raw.replace(/<br\s*\/?>/gi, " "));
      const label = party ?? t.slice(t.lastIndexOf("|") + 1).trim();
      for (let j = 0; j < colspan; j++) cols.push({ label, party });
    }
  }
  return cols;
}

const EXAMPLES = 12;
const note = (list, item) => { if (list.length < EXAMPLES) list.push(item); };

export function newPlainStats() {
  return {
    date_format: "plain text",
    tables_read: 0,
    tables_skipped_outside_year_sections: 0,
    rows_seen: 0,
    event_rows: 0,
    election_result_rows: 0,
    date_unparsed: { count: 0, examples: [] },
    outside_window: 0,
    found_in_window: 0,
    kept: 0,
    dropped: {
      short_row: { count: 0, examples: [] },
      area_not_gb_or_uk: { count: 0, areas: {} },
      share_unparsed: { count: 0, examples: [] },
    },
    rows_sharing_a_poll_with_another_row: 0,
    rows_with_merged_party_cells: 0,
    rows_with_less_than_one_percent: 0,
    sort_value_disagrees_with_text: { count: 0, examples: [] },
  };
}

/**
 * Plain-text date pages. Only tables under a "=== YYYY ===" heading are read:
 * those are the national tables. Sub-national and constituency tables sit
 * under place headings and are skipped. A row is dropped, and counted, if its
 * date, area or any party cell cannot be read; nothing is guessed.
 */
export function extractPlainPolls(text, { from, to, section = null, stats = null }) {
  if (section) throw new Error("--section is not supported for plain-text date pages");
  const s = newPlainStats();
  const polls = [];
  const chunks = text.split(/\n\{\|/);
  const lastHeading = (str) => { const all = [...str.matchAll(/^(={2,6})\s*(.*?)\s*\1\s*$/gm)]; return all.length ? all[all.length - 1][2] : undefined; };
  let heading = lastHeading(chunks[0]);
  for (const table of chunks.slice(1)) {
    const tableHeading = heading;
    const tail = table.split(/\n\|\}/).slice(1).join("\n|}");
    heading = lastHeading(tail) ?? heading;
    const sectionYear = /^\d{4}$/.test(tableHeading ?? "") ? Number(tableHeading) : null;
    const rows = table.split(/\n\|\}/)[0].split(/\n\|-[^\n]*/);
    const headerIndex = rows.findIndex((r) => /^!/m.test(r) && /Pollster|Polling organisation/i.test(r));
    if (headerIndex < 0) continue;
    const cols = headerColumns(rows[headerIndex]);
    const partyIdx = cols.map((c, i) => (c.party ? i : -1)).filter((i) => i >= 0);
    if (!partyIdx.length) continue;
    if (!sectionYear) { s.tables_skipped_outside_year_sections++; continue; }
    s.tables_read++;
    const find = (re) => cols.findIndex((c) => !c.party && re.test(c.label));
    const pollIdx = find(/Pollster|Polling organisation/i);
    const clientIdx = find(/^Client/i);
    const areaIdx = find(/^Area$/i);
    const sampleIdx = find(/^Sample/i);
    const carry = [];
    let group = null;
    for (const row of rows.slice(headerIndex + 1)) {
      const raw = rowCells(row);
      if (!raw || !raw.length) continue;
      const parsed = raw.map(splitCell);
      if (parsed.some((c) => c.colspan >= 6)) { s.event_rows++; continue; }
      s.rows_seen++;
      // Expand merged cells: a rowspan cell fills the same column in the rows below.
      const grid = [];
      const carried = new Set();
      let k = 0;
      for (let col = 0; k < parsed.length || carry[col]?.left > 0; ) {
        if (carry[col]?.left > 0) { grid[col] = carry[col].cell; carry[col].left--; carried.add(col); col++; continue; }
        const c = parsed[k++];
        for (let j = 0; j < c.colspan; j++) {
          grid[col + j] = { ...c, spanStart: col };
          if (c.rowspan > 1) carry[col + j] = { cell: grid[col + j], left: c.rowspan - 1 };
        }
        col += c.colspan;
      }
      if (grid[0]?.rowspan > 1 && !carried.has(0)) group = { row: 1, of: grid[0].rowspan };
      else if (carried.has(0) && group) group = { ...group, row: group.row + 1 };
      else group = null;
      const pollText = plainText(dropTemplates(grid[pollIdx]?.value ?? "")).replace(/\s+/g, " ");
      if (/general election/i.test(pollText)) { s.election_result_rows++; continue; }
      // Page dashes in a date range are written as "to" (house style); the parser reads either.
      const dateText = plainText(grid[0]?.value ?? "").replace(/\s*[\u2013\u2014]\s*/g, " to ").replace(/\s+/g, " ");
      const dates = plainFieldwork(dateText, sectionYear);
      if (!dates) { s.date_unparsed.count++; note(s.date_unparsed.examples, { section: sectionYear, cell: dateText }); continue; }
      if (dates.end < from || dates.end > to) { s.outside_window++; continue; }
      s.found_in_window++;
      const needed = Math.max(pollIdx, clientIdx, areaIdx, sampleIdx, ...partyIdx);
      if (grid.length <= needed || grid.slice(0, needed + 1).some((c) => !c)) {
        s.dropped.short_row.count++;
        note(s.dropped.short_row.examples, { fieldwork: dateText, pollster: pollText, cells: grid.length, needed: needed + 1 });
        continue;
      }
      const area = areaIdx >= 0 ? plainText(cellValue(grid[areaIdx].value)) : null;
      if (areaIdx >= 0 && area !== "GB" && area !== "UK") {
        s.dropped.area_not_gb_or_uk.count++;
        s.dropped.area_not_gb_or_uk.areas[area] = (s.dropped.area_not_gb_or_uk.areas[area] || 0) + 1;
        continue;
      }
      const shares = {};
      const combined = {};
      const belowOne = [];
      let bad = null;
      for (const i of partyIdx) {
        const cell = grid[i];
        const span = cols.slice(cell.spanStart, cell.spanStart + cell.colspan);
        const v = plainShare(cell.value);
        if (v.kind === "bad") { bad = { party: cols[i].party, text: v.text }; break; }
        if (cell.colspan > 1) {
          // One figure printed across several parties: kept as the combined figure, never split.
          if (i === cell.spanStart && v.kind === "value") combined[span.map((c) => c.party ?? c.label).join(" + ")] = v.value;
          continue;
        }
        if (v.kind === "value") shares[cols[i].party] = v.value;
        else if (v.kind === "below_one") belowOne.push(cols[i].party);
      }
      if (bad) {
        s.dropped.share_unparsed.count++;
        note(s.dropped.share_unparsed.examples, { fieldwork: dateText, pollster: pollText, ...bad });
        continue;
      }
      let pollster = pollText;
      let client = clientIdx >= 0 ? plainText(dropTemplates(grid[clientIdx].value)) : null;
      if (clientIdx < 0) {
        const slash = pollText.indexOf("/");
        if (slash > 0) { pollster = pollText.slice(0, slash).trim(); client = pollText.slice(slash + 1).trim() || null; }
      }
      const sortEnd = grid[0].sortValue;
      const sortDisagrees = sortEnd && /^\d{4}-\d{2}-\d{2}$/.test(sortEnd) && sortEnd !== dates.end;
      if (sortDisagrees) { s.sort_value_disagrees_with_text.count++; note(s.sort_value_disagrees_with_text.examples, { cell: dateText, read_as: dates.end, sort_value: sortEnd, pollster }); }
      if (group) s.rows_sharing_a_poll_with_another_row++;
      if (Object.keys(combined).length) s.rows_with_merged_party_cells++;
      if (belowOne.length) s.rows_with_less_than_one_percent++;
      s.kept++;
      polls.push({
        fieldwork_start: dates.start,
        fieldwork_end: dates.end,
        fieldwork_cell: dateText,
        pollster,
        client,
        area,
        sample: Number(plainText(cellValue(grid[sampleIdx]?.value ?? "")).replace(/[^0-9]/g, "")) || null,
        shares,
        ...(Object.keys(combined).length ? { combined_shares: combined } : {}),
        ...(belowOne.length ? { less_than_one_percent: belowOne } : {}),
        ...(group ? { row_of_multi_row_poll: { row: group.row, of: group.of } } : {}),
        ...(sortDisagrees ? { sort_value_end: sortEnd } : {}),
      });
    }
  }
  if (stats) Object.assign(stats, s);
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

// Parties in the summary mean. Plain-text pages (2017, 2019) list theirs alphabetically.
const MEAN_PARTIES = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"];
const PLAIN_MEAN_PARTIES = ["Brexit Party", "Change UK", "Conservative", "Green Party", "Labour", "Liberal Democrats", "UKIP"];

/**
 * The whole output file as an object. Pages read by the plain-text path also
 * get a "counts" block (rows found, kept and dropped, and why); {{opdrts}}
 * pages get exactly the shape they always had.
 */
export function buildExtract(wikitext, { page, revid, from, to, section = null }) {
  const stats = {};
  const polls = extractPolls(wikitext, { from, to, section, stats });
  const plain = stats.date_format === "plain text";
  return {
    source: {
      publisher: "Wikipedia",
      page,
      revision_id: Number(revid),
      url: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(page.replace(/ /g, "_"))}&oldid=${revid}`,
      licence: "CC BY-SA 4.0; each row names the pollster, whose published tables are the primary source",
    },
    window: { fieldwork_end_from: from, fieldwork_end_to: to, ...(section ? { section } : {}) },
    extracted_by: "scripts/extract-wikipedia-polls.mjs",
    mean: pollsterBalancedMean(polls, plain ? PLAIN_MEAN_PARTIES : MEAN_PARTIES),
    ...(plain ? { counts: stats } : {}),
    polls,
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  for (const k of ["wikitext", "page", "revid", "from", "to"]) if (!args[k]) throw new Error(`--${k} is required`);
  const out = buildExtract(readFileSync(args.wikitext, "utf8"), { page: args.page, revid: args.revid, from: args.from, to: args.to, section: args.section || null });
  const json = JSON.stringify(out, null, 2) + "\n";
  if (args.out) writeFileSync(path.resolve(args.out), json);
  else process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
