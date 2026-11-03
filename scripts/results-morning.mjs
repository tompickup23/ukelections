#!/usr/bin/env node
// Results morning: read each council's own declaration of result for the
// by-elections that polled on a given day, and write a hand_verified_declaration
// row into data/history/byelection-appends.json only when the counts reconcile.
//
// Usage:
//   node scripts/results-morning.mjs                          # yesterday, dry run
//   node scripts/results-morning.mjs --date=2026-11-12        # one polling day
//   node scripts/results-morning.mjs --date=2026-11-12 --write
//   node scripts/results-morning.mjs --date=2026-10-29 --fixtures=tests/fixtures/results-morning
//
// Dry run is the default: it prints what it read and what it would write.
// --write merges the reconciled rows into the sidecar and reruns the
// finaliser for that day, so the contest files carry them before the build.
//
// What it will not do, by design (docs/results-morning.md):
// - fetch a path that robots.txt disallows, or retry past a bot check (Halton
//   and Wychavon have both put one in front of declarations);
// - fetch from a council more than once an hour, or between 21:00 and 06:00
//   UK time on the night of a poll, when counts are running;
// - overwrite a hand-verified row, or write a row whose counts do not
//   reconcile. Those contests are listed as pending with the reason.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (rel) => path.join(ROOT, rel);
const CONTEST_DIR = "data/contests/local-byelections";
const SIDECAR = "data/history/byelection-appends.json";
const SOURCES = "data/results/declaration-sources.json";
const STATE_FILE = ".cache/results-morning/last-fetch.json";
const USER_AGENT = "ukelections-results-morning/0.1 (+https://ukelections.co.uk/about/)";
const MIN_GAP_MS = 60 * 60 * 1000;
const DC_BALLOTS = "https://candidates.democracyclub.org.uk/api/next/ballots/";

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/** Plain text from a council HTML page, one block per line. */
export function htmlToText(html) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'" };
  return String(html)
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/tr|\/li|\/h\d|\/div|\/td|\/th|\/dt|\/dd)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => entities[n.toLowerCase()] ?? m)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Layout text from a PDF, through poppler's pdftotext. Null when it is not installed. */
export function pdfToText(file) {
  const run = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  if (run.error || run.status !== 0) return null;
  return run.stdout;
}

// ---------------------------------------------------------------------------
// Parsing a declaration
// ---------------------------------------------------------------------------

const NUMBER = /(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d.%])|(?<![\d.,])\d+(?![\d.,%])/g;
const toInt = (s) => (s == null ? null : Number(String(s).replace(/,/g, "")));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normWard = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[‘’`]/g, "'").replace(/\s+/g, " ").trim();

/** The surname a declaration will print: the last word of Democracy Club's name. */
export function surnameOf(name) {
  const words = String(name).trim().split(/\s+/);
  return words[words.length - 1];
}

/**
 * Word and some PDF producers set each digit of a figure as its own glyph run,
 * so "315" arrives as "3 1 5". Join runs of two or more single digits that
 * share a line. The reconciliation below is what catches a wrong join.
 */
function joinSplitDigits(text) {
  return text.replace(/(?<![\d,])\d(?: \d)+(?![\d,])/g, (run) => run.replace(/ /g, ""));
}

/**
 * Read the counts for the given candidates out of a declaration's text.
 * Returns what it found and a list of problems; it never guesses a figure.
 */
export function parseDeclaration(rawText, contest) {
  const problems = [];
  const text = joinSplitDigits(String(rawText).replace(/ /g, " "));
  const lower = text.toLowerCase();
  const field = contest.field.candidates;
  const surnames = field.map((c) => surnameOf(c.name));
  if (new Set(surnames.map((s) => s.toLowerCase())).size !== surnames.length) {
    problems.push("two candidates share a surname, so the counts cannot be matched by name");
    return { candidates: [], problems };
  }

  // Start at the ward, then at the first candidate printed after it, so a page
  // that lists several contests is read for this one only.
  const wardAt = Math.max(0, normWard(text).indexOf(normWard(contest.contest.ward_name)));
  const wardOffset = wardAt > 0 ? mapNormIndex(text, wardAt) : 0;
  const found = field.map((c, i) => {
    const re = new RegExp(`(?<![A-Za-z])${escape(surnames[i])}(?![A-Za-z])`, "i");
    const m = re.exec(text.slice(wardOffset));
    return { candidate: c, at: m ? wardOffset + m.index : -1 };
  });
  const missing = found.filter((f) => f.at < 0).map((f) => f.candidate.name);
  if (missing.length) {
    problems.push(`not found on the declaration: ${missing.join(", ")}`);
    return { candidates: [], problems };
  }
  const blockStart = Math.min(...found.map((f) => f.at));
  const endMatch = /ballot papers rejected|rejected ballot papers|number of ballot papers rejected|spoilt papers|rejected papers/i.exec(
    text.slice(blockStart),
  );
  const blockEnd = endMatch ? blockStart + endMatch.index : text.length;
  const ordered = [...found].sort((a, b) => a.at - b.at);

  const candidates = ordered.map((f, i) => {
    const segment = text.slice(f.at, i + 1 < ordered.length ? ordered[i + 1].at : blockEnd);
    const first = segment.match(NUMBER);
    const cleaned = segment.replace(/^.*(if elected|word ['’]?elected).*$/gim, "");
    return {
      name: f.candidate.name,
      party_name: f.candidate.party_name,
      votes: first ? toInt(first[0]) : null,
      elected_mark: /(?<![a-z])elected(?![a-z])/i.test(cleaned.replace(/duly elected[\s\S]*/i, "")),
    };
  });
  const figuresInBlock = (text.slice(blockStart, blockEnd).match(NUMBER) || []).length;

  // Who the returning officer declares elected, by the sentence where there is
  // one; the "Elected" mark against a count is the fallback.
  let electedName = null;
  const sentence = /declare that([\s\S]{0,160}?)(?:is|has been|was)\s+(?:duly\s+)?elected/i.exec(text);
  if (sentence) {
    const hits = candidates.filter((c) => new RegExp(`(?<![A-Za-z])${escape(surnameOf(c.name))}(?![A-Za-z])`, "i").test(sentence[1]));
    if (hits.length === 1) electedName = hits[0].name;
    else problems.push("the declaration sentence does not name exactly one candidate");
  } else {
    const marked = candidates.filter((c) => c.elected_mark);
    if (marked.length === 1) electedName = marked[0].name;
    else problems.push(marked.length ? "more than one candidate is marked elected" : "no candidate is declared elected");
  }

  const after = text.slice(blockEnd);
  const grab = (re, from = text) => {
    const m = re.exec(from);
    return m ? toInt(m[1]) : null;
  };
  const rejected =
    grab(/Total(?:\s+Number\s+of\s+Rejected\s+Ballot\s+Papers)?\s*:?\s*(\d[\d,]*)(?![\d.%])/i, after) ??
    grab(/Spoilt\s+Papers\s*:?\s*(\d[\d,]*)/i, after);
  const turnoutMatch = /turnout[^\d\n]{0,240}(\d+(?:\.\d+)?)\s*%/i.exec(text);
  return {
    candidates,
    figures_in_block: figuresInBlock,
    elected: electedName,
    rejected,
    papers_issued: grab(/ballot\s+papers\s+(?:issued|counted|verified)[^\d\n]{0,240}(\d[\d,]*)/i),
    electorate: grab(/electorate[^\d\n]{0,240}(\d[\d,]*)/i),
    turnout_printed: turnoutMatch ? Number(turnoutMatch[1]) : null,
    turnout_decimals: turnoutMatch ? (turnoutMatch[1].split(".")[1] || "").length : null,
    majority_printed: grab(/majority[^\d\n]{0,240}?(\d[\d,]*)(?![\d.%])/i, after),
    problems,
  };
}

/** Map an index in normWard(text) back to text. Both differ only by "&" and spacing. */
function mapNormIndex(text, normIndex) {
  for (let i = 0; i < text.length; i += 1) {
    if (normWard(text.slice(0, i)).length >= normIndex) return i;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Decide whether the parsed counts are fit to publish as a declaration row.
 * Every structural check must pass and at least one arithmetic cross-check
 * must agree, with none disagreeing. dc is Democracy Club's ballot, if read.
 */
export function reconcile(parsed, contest, dc = null) {
  const reasons = [...parsed.problems];
  const checks = [];
  const c = parsed.candidates;
  if (reasons.length) return { ok: false, reasons, checks };
  if (contest.contest.voting_system !== "FPTP") reasons.push("not first past the post: STV declarations are entered by hand");
  if ((contest.contest.seats_contested ?? 1) !== 1) reasons.push("more than one seat: read by hand");
  if (c.some((x) => !Number.isInteger(x.votes))) reasons.push("a candidate has no count");
  if (parsed.figures_in_block !== c.length) {
    reasons.push(`the candidate table carries ${parsed.figures_in_block} figures for ${c.length} candidates`);
  }
  const sorted = [...c].sort((a, b) => b.votes - a.votes);
  if (sorted.length > 1 && sorted[0].votes === sorted[1].votes) reasons.push("a tie at the top: read by hand");
  if (parsed.elected && sorted[0] && parsed.elected !== sorted[0].name) {
    reasons.push(`declared winner ${parsed.elected} is not the top count (${sorted[0].name})`);
  }
  if (!parsed.elected) reasons.push("no declared winner");
  if (reasons.length) return { ok: false, reasons, checks };

  const valid = c.reduce((n, x) => n + x.votes, 0);
  const counted = parsed.rejected === null ? null : valid + parsed.rejected;
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  if (parsed.papers_issued !== null) {
    if (counted === null) add("ballot papers", false, `issued ${parsed.papers_issued}, but no rejected total to reconcile with`);
    else add("ballot papers", counted === parsed.papers_issued, `${valid} valid + ${parsed.rejected} rejected = ${counted}; issued ${parsed.papers_issued}`);
  }
  if (parsed.turnout_printed !== null && parsed.electorate && counted !== null) {
    const pct = (100 * counted) / parsed.electorate;
    const tolerance = 0.5 * 10 ** -parsed.turnout_decimals + 1e-9;
    add("turnout", Math.abs(pct - parsed.turnout_printed) <= tolerance, `${counted} of ${parsed.electorate} is ${pct.toFixed(2)}%; printed ${parsed.turnout_printed}%`);
  }
  if (parsed.majority_printed !== null && sorted.length > 1) {
    const majority = sorted[0].votes - sorted[1].votes;
    add("majority", majority === parsed.majority_printed, `${sorted[0].votes} less ${sorted[1].votes} is ${majority}; printed ${parsed.majority_printed}`);
  }
  const dcDiffs = [];
  if (dc?.candidacies?.length) {
    const dcVotes = new Map(dc.candidacies.map((x) => [surnameOf(x.name).toLowerCase(), x.num_ballots]));
    const complete = c.every((x) => Number.isInteger(dcVotes.get(surnameOf(x.name).toLowerCase())));
    for (const x of c) {
      const theirs = dcVotes.get(surnameOf(x.name).toLowerCase());
      if (Number.isInteger(theirs) && theirs !== x.votes) dcDiffs.push(`${x.name} ${x.votes} (Democracy Club ${theirs})`);
    }
    // Agreement with a second transcription is corroboration. Disagreement is
    // reported, never applied: the declaration is the primary source, and the
    // arithmetic checks above decide whether it reads cleanly.
    if (complete && !dcDiffs.length) add("Democracy Club", true, "every count identical");
  }
  const failed = checks.filter((x) => !x.pass);
  if (failed.length) reasons.push(...failed.map((x) => `${x.name} does not reconcile: ${x.detail}`));
  if (!checks.some((x) => x.pass)) reasons.push("no cross-check is possible: the declaration prints no ballot paper total, turnout with electorate, or majority, and Democracy Club has no complete counts to compare");
  return { ok: reasons.length === 0, reasons, checks, dcDiffs, valid, counted };
}

/** The sidecar row, in the shape the hand-entered declaration rows use. */
export function buildRow(contest, parsed, result, { source, accessedAt }) {
  const { contest: k } = contest;
  const turnoutPct =
    result.counted !== null && parsed.electorate
      ? Math.round((10000 * result.counted) / parsed.electorate) / 10000
      : parsed.turnout_printed !== null
        ? Math.round(parsed.turnout_printed * 100) / 10000
        : null;
  const checks = result.checks.filter((x) => x.pass).map((x) => `${x.name}: ${x.detail}`);
  return {
    ballot_paper_id: k.ballot_paper_id,
    election_date: k.polling_day,
    year: Number(k.polling_day.slice(0, 4)),
    tier: "local",
    council_slug: k.council_slug,
    ward_slug: k.ward_slug,
    is_by_election: true,
    turnout_votes: result.counted,
    turnout_pct: turnoutPct,
    spoilt_ballots: parsed.rejected,
    electorate: parsed.electorate,
    source,
    review_status: "hand_verified_declaration",
    candidates: parsed.candidates.map((x) => ({
      name: x.name,
      party_name: x.party_name,
      votes: x.votes,
      elected: x.name === parsed.elected,
      source,
      accessed_at: accessedAt,
    })),
    reviewed_at: accessedAt,
    accessed_at: accessedAt,
    verified_by: "scripts/results-morning.mjs",
    verification_note:
      `${k.council_name} declaration of result, read by scripts/results-morning.mjs on ${accessedAt}: ` +
      `${parsed.candidates.length} candidate counts total ${result.valid.toLocaleString("en-GB")} valid votes` +
      (parsed.rejected !== null ? `; ${parsed.rejected} rejected papers make ${result.counted.toLocaleString("en-GB")}` : "") +
      `. Reconciled on ${checks.join("; ")}.` +
      (result.dcDiffs?.length ? ` Democracy Club differs on ${result.dcDiffs.join(", ")} and is not used.` : ""),
  };
}

// ---------------------------------------------------------------------------
// Fetching, politely
// ---------------------------------------------------------------------------

const robotsCache = new Map();

/** True when robots.txt lets us fetch this URL. A robots file we cannot read is not a yes. */
export function robotsAllows(robotsText, url) {
  const { pathname, search } = new URL(url);
  const target = pathname + search;
  const groups = [];
  let current = null;
  for (const raw of String(robotsText).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(m[2].toLowerCase());
    } else if (current && (key === "disallow" || key === "allow")) {
      current.rules.push({ allow: key === "allow", path: m[2] });
    }
  }
  const ours = groups.filter((g) => g.agents.some((a) => a !== "*" && "ukelections-results-morning".startsWith(a)));
  const rules = (ours.length ? ours : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best = null;
  for (const rule of rules) {
    if (!rule.path) continue;
    const pattern = new RegExp(`^${escape(rule.path).replace(/\\\*/g, ".*").replace(/\\\$$/, "$")}`);
    if (pattern.test(target) && (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow))) best = rule;
  }
  return !best || best.allow;
}

function loadState() {
  const previous = existsSync(p(STATE_FILE)) ? JSON.parse(readFileSync(p(STATE_FILE), "utf8")) : {};
  return { previous, hosts: { ...previous } };
}

function saveState(state) {
  mkdirSync(path.dirname(p(STATE_FILE)), { recursive: true });
  writeFileSync(p(STATE_FILE), `${JSON.stringify(state.hosts, null, 2)}\n`);
}

/** Hours in UK local time, so the count-night guard follows BST and GMT. */
function ukHour(date) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(date));
}

export function duringCountNight(now, pollingDay) {
  const ukDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
  const hour = ukHour(now);
  const nextDay = new Date(`${pollingDay}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return (ukDay === pollingDay && hour >= 21) || (ukDay === nextDay.toISOString().slice(0, 10) && hour < 6);
}

async function politeFetch(url, state) {
  const host = new URL(url).host;
  if (!robotsCache.has(host)) {
    const res = await fetch(`https://${host}/robots.txt`, { headers: { "user-agent": USER_AGENT } }).catch(() => null);
    // No robots file at all (404) is permission; a robots file we could not read is not.
    robotsCache.set(host, res?.ok ? await res.text() : res?.status === 404 ? "" : null);
  }
  const robots = robotsCache.get(host);
  if (robots === null) return { blocked: "robots.txt could not be read, so nothing was fetched" };
  if (!robotsAllows(robots, url)) return { blocked: "robots.txt disallows this path: a stop, not a workaround" };
  // The hourly gap is between runs. Inside one run a council gets at most
  // three requests: its elections page, a second listing, the declaration.
  state.thisRun ??= {};
  const last = state.previous?.[host] ? Date.parse(state.previous[host]) : 0;
  if (Date.now() - last < MIN_GAP_MS) return { blocked: `${host} was read by a run less than an hour ago` };
  if ((state.thisRun[host] = (state.thisRun[host] || 0) + 1) > 3) return { blocked: `three requests to ${host} already this run` };
  state.hosts[host] = new Date().toISOString();
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
  const type = res.headers.get("content-type") || "";
  const body = Buffer.from(await res.arrayBuffer());
  if (!res.ok) return { blocked: `HTTP ${res.status}` };
  if (/text\/html/.test(type) && body.length < 4000 && /redirect|challenge|captcha|verify you are human/i.test(body.toString("utf8"))) {
    return { blocked: "a bot check answered instead of the page: not retried" };
  }
  return { type, body, url: res.url };
}

function textFrom(type, body, where) {
  if (/pdf/.test(type)) {
    mkdirSync(p(".cache/results-morning"), { recursive: true });
    const file = p(`.cache/results-morning/${where}.pdf`);
    writeFileSync(file, body);
    const text = pdfToText(file);
    return text ?? { unreadable: "PDF, and pdftotext is not installed (poppler-utils)" };
  }
  if (/wordprocessingml|msword/.test(type)) return { unreadable: "Word document: read by hand" };
  return htmlToText(body.toString("utf8"));
}

/**
 * Links on a council's elections page that look like this ward's declaration.
 * The label is the anchor text, the href, and the text just before the link,
 * because some councils (Hyndburn) print the title beside a bare "Download".
 * A council's entry in declaration-sources.json can narrow it: `exclude` drops
 * an older declaration for the same ward (Mid Suffolk lists Bosmere's May 2026
 * result on the page the November one will join).
 */
export function declarationLinks(html, baseUrl, wardName, { exclude = null } = {}) {
  const ward = normWard(wardName).split(" ").filter((w) => w.length > 2 && w !== "and" && w !== "ward");
  const links = [];
  const source = String(html);
  let previousEnd = 0;
  for (const m of source.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    // Only the text since the previous link, so one link's title never labels the next.
    const before = htmlToText(source.slice(Math.max(previousEnd, m.index - 400), m.index)).split("\n").slice(-2).join(" ");
    previousEnd = m.index + m[0].length;
    let href = m[1];
    try {
      href = decodeURIComponent(href.replace(/\+/g, " "));
    } catch {
      // A malformed escape is still a usable label.
    }
    const label = normWard(`${before} ${htmlToText(m[2])} ${href}`);
    if (!/declaration|result/.test(label) || /notice of (election|poll)|persons nominated|polling station/.test(label)) continue;
    if (!ward.every((w) => label.includes(w))) continue;
    if (exclude && new RegExp(exclude, "i").test(label)) continue;
    links.push(new URL(m[1].replace(/&amp;/g, "&"), baseUrl).href);
  }
  return [...new Set(links)];
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function args() {
  return Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    }),
  );
}

function readJson(rel) {
  return JSON.parse(readFileSync(p(rel), "utf8"));
}

export function contestsPolledOn(date) {
  return readdirSync(p(CONTEST_DIR))
    .filter((f) => f.endsWith(`-${date}.json`))
    .map((f) => readJson(`${CONTEST_DIR}/${f}`))
    .filter((d) => d.contest?.polling_day === date);
}

/** Read one contest from saved files: <slug>.txt, .html or .pdf, and <slug>.dc.json. */
export function fromFixtures(dir, contest) {
  const base = path.join(dir, contest.slug);
  const dc = existsSync(`${base}.dc.json`) ? JSON.parse(readFileSync(`${base}.dc.json`, "utf8")) : null;
  if (existsSync(`${base}.txt`)) return { text: readFileSync(`${base}.txt`, "utf8"), dc };
  if (existsSync(`${base}.html`)) return { text: htmlToText(readFileSync(`${base}.html`, "utf8")), dc };
  if (existsSync(`${base}.pdf`)) return { text: pdfToText(`${base}.pdf`) ?? { unreadable: "pdftotext is not installed" }, dc };
  return { text: null, dc };
}

async function readLive(contest, sources, state) {
  const id = contest.contest.ballot_paper_id;
  const known = sources.contests?.[id]?.url;
  const council = sources.councils?.[contest.contest.council_slug];
  let dc = null;
  try {
    const res = await fetch(`${DC_BALLOTS}${id}/`, { headers: { "user-agent": USER_AGENT } });
    if (res.ok) {
      const ballot = await res.json();
      dc = { candidacies: (ballot.candidacies || []).map((c) => ({ name: c.person?.name, num_ballots: c.result?.num_ballots ?? null })) };
    }
  } catch {
    dc = null;
  }
  let target = known;
  const indexes = [council?.index_url, ...(council?.also_check || [])].filter(Boolean);
  for (const indexUrl of target ? [] : indexes) {
    const index = await politeFetch(indexUrl, state);
    if (index.blocked) {
      console.log(`      ${indexUrl}: ${index.blocked}`);
      continue;
    }
    const html = index.body.toString("utf8");
    // Some councils (Dudley, Leeds) print the result on the page itself.
    const onPage = htmlToText(html);
    const parsed = parseDeclaration(onPage, contest);
    if (!parsed.problems.length && reconcile(parsed, contest, dc).ok) return { text: onPage, source: indexUrl, dc };
    [target] = declarationLinks(html, index.url, contest.contest.ward_name, { exclude: council.exclude });
    if (target) break;
  }
  if (!target && indexes.length) return { blocked: "no declaration link on the council's elections pages yet", dc };
  if (!target) return { blocked: "no declaration source recorded for this council", dc };
  const doc = await politeFetch(target, state);
  if (doc.blocked) return { blocked: `${target}: ${doc.blocked}`, dc };
  const text = textFrom(doc.type, doc.body, contest.slug);
  return { text, source: target, dc };
}

export function mergeRows(sidecar, rows) {
  const results = sidecar.results;
  const written = [];
  const kept = [];
  for (const row of rows) {
    const at = results.findIndex((r) => r.ballot_paper_id === row.ballot_paper_id);
    if (at >= 0 && String(results[at].review_status || "").startsWith("hand_verified")) {
      kept.push(row.ballot_paper_id);
      continue;
    }
    if (at >= 0) results[at] = row;
    else results.push(row);
    written.push(row.ballot_paper_id);
  }
  return { written, kept };
}

async function main() {
  const a = args();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const date = a.date || yesterday;
  const accessedAt = a["accessed-at"] || now.toISOString().slice(0, 10);
  const offline = Boolean(a.fixtures);
  const contests = contestsPolledOn(date);
  console.log(`Results morning for ${date}: ${contests.length} contest(s)${offline ? `, offline from ${a.fixtures}` : ""}`);
  if (!contests.length) return;
  if (!offline && duringCountNight(now, date) && !a["allow-count-night"]) {
    console.log("  stopped: it is count night (21:00 to 06:00 UK time after the poll). Run it in the morning.");
    return;
  }
  const sources = existsSync(p(SOURCES)) ? readJson(SOURCES) : { councils: {}, contests: {} };
  const state = offline ? { previous: {}, hosts: {} } : loadState();
  const rows = [];
  const pending = [];
  for (const contest of contests) {
    const label = `${contest.contest.council_name}, ${contest.contest.ward_name}`;
    const read = offline ? { ...fromFixtures(a.fixtures, contest), source: contest.result?.source ?? null } : await readLive(contest, sources, state);
    if (read.blocked || !read.text || read.text.unreadable) {
      pending.push({ label, why: read.blocked || read.text?.unreadable || "no saved declaration" });
      continue;
    }
    const parsed = parseDeclaration(read.text, contest);
    const result = reconcile(parsed, contest, read.dc);
    if (!result.ok) {
      pending.push({ label, why: result.reasons.join("; ") });
      continue;
    }
    rows.push(buildRow(contest, parsed, result, { source: read.source, accessedAt }));
    console.log(`  + ${label}: ${parsed.candidates.map((x) => `${surnameOf(x.name)} ${x.votes}`).join(", ")}`);
    for (const check of result.checks) console.log(`      ${check.pass ? "ok" : "NO"} ${check.name}: ${check.detail}`);
    if (result.dcDiffs?.length) console.log(`      ! Democracy Club differs: ${result.dcDiffs.join(", ")}`);
  }
  if (!offline) saveState(state);
  for (const item of pending) console.log(`  . pending ${item.label}: ${item.why}`);
  console.log(`  ${rows.length} reconciled, ${pending.length} pending`);
  if (a.report) writeFileSync(a.report, `${JSON.stringify({ date, rows, pending }, null, 2)}\n`);
  if (!a.write || !rows.length) {
    if (rows.length) console.log("  dry run: nothing written. Add --write to merge these rows.");
    return;
  }
  const sidecar = readJson(SIDECAR);
  const { written, kept } = mergeRows(sidecar, rows);
  writeFileSync(p(SIDECAR), `${JSON.stringify(sidecar, null, 1)}\n`);
  for (const id of kept) console.log(`  = kept the existing hand-verified row for ${id}`);
  console.log(`  wrote ${written.length} row(s) to ${SIDECAR}`);
  if (written.length) {
    const fin = spawnSync("node", ["scripts/finalise-october-byelection-results.mjs", date], { cwd: ROOT, stdio: "inherit" });
    if (fin.status !== 0) process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
