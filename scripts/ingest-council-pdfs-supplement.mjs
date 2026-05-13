#!/usr/bin/env node
/**
 * ingest-council-pdfs-supplement.mjs — for councils whose 2026-05-07
 * results were not (yet) on Democracy Club's API, download the official
 * Declaration of Result PDFs published by the council itself, run
 * pdftotext, parse candidate / votes / elected, and write a supplemental
 * actuals file in the same schema as the DC ingest output.
 *
 * Each PDF is a deputy / returning officer's signed declaration —
 * legally authoritative, higher trust tier than Wikipedia.
 *
 * Two PDF families are handled:
 *
 *   1. PER_WARD_PDFS — one PDF per ward / division. Suffolk districts
 *      (Babergh, Mid Suffolk, Ipswich) and Kirklees publish in this form.
 *      Layout: candidate name on its own line, then (party + votes [Elected])
 *      on a subsequent indented line. We discard names and just key off
 *      the (party, votes) tuple.
 *
 *   2. COMBINED_PDFS — one PDF for the whole council, with each ward
 *      as a sub-section. Havering publishes in this form. Layout:
 *      "Ward Name" header line, then a table with one row per
 *      candidate, columns separated by ≥2 spaces, ending in [votes,
 *      "Elected"?]. We split on ward headers and parse each row.
 *
 * Output:
 *   data/results/may-2026/council-pdf-supplement.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const USER_AGENT = "ukelections.co.uk council pdf supplement (contact: tom@ukelections.co.uk)";
const CACHE_DIR = join(REPO, ".cache/council-pdfs-may2026");
const OUT = "data/results/may-2026/council-pdf-supplement.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =================== Per-ward PDFs ===================
const PER_WARD_PDFS = [
  // Suffolk County — Babergh district (9 divisions)
  ...[
    "brook", "constable", "cornard-sudbury-east", "cosford", "hadleigh",
    "melford", "peninsula", "stour-valley", "sudbury-west",
  ].map((slug) => ({
    council_slug: "suffolk", ward_slug: slug,
    url: `https://www.babergh.gov.uk/documents/d/babergh/declaration-of-result-${slug}`,
  })),
  // Suffolk County — Mid Suffolk district (10 divisions)
  ...[
    "bosmere", "gipping-valley", "hartismere", "hoxne-eye", "stowmarket-east",
    "stowmarket-west", "thedwastre-north", "thedwastre-south", "thredling", "upper-gipping",
  ].map((slug) => ({
    council_slug: "suffolk", ward_slug: slug,
    url: `https://www.midsuffolk.gov.uk/documents/d/mid-suffolk/declaration-of-result-${slug}`,
  })),
  // Suffolk County — Ipswich Borough (12 divisions)
  ...[
    ["belstead-hills", "Belstead%20Hills"], ["bixley", "Bixley"], ["bridge", "Bridge"],
    ["gainsborough", "Gainsborough"], ["gipping", "Gipping"], ["priory-heath", "Priory%20Heath"],
    ["rushmere", "Rushmere"], ["st-clements", "St%20Clement%27s"],
    ["st-margarets", "St%20Margaret%27s"], ["westbourne", "Westbourne"],
    ["westgate", "Westgate"], ["whitton", "Whitton"],
  ].map(([slug, fname]) => ({
    council_slug: "suffolk", ward_slug: slug,
    url: `https://www.ipswich.gov.uk/sites/ipswich/files/2026-05/Declaration%20of%20results_${fname}.pdf`,
  })),
  // Kirklees Metropolitan Borough Council (23 wards)
  ...[
    "almondbury", "ashbrow", "batley-east", "batley-west", "birstall-birkenshaw",
    "cleckheaton", "colne-valley-east", "colne-valley-west", "crosland-moor", "dalton",
    "denby-dale", "dewsbury-east", "dewsbury-south", "dewsbury-west", "greenhead",
    "heckmondwike", "holme-valley-north", "holme-valley-south", "kirkburton", "lindley",
    "liversedge-gomersal", "mirfield", "netherton-newsome",
  ].map((slug) => ({
    council_slug: "kirklees", ward_slug: slug,
    // Kirklees uses lowercase 'kirkburton' on disk except for the actual file...
    // Almondbury / ashbrow etc are all lowercase; only "Kirkburton" is capitalised.
    url: `https://www.kirklees.gov.uk/beta/voting-and-elections/pdf/${slug === "kirkburton" ? "Kirkburton" : slug}-results-2026.pdf`,
  })),
];

// =================== Combined PDFs (one PDF, many wards) ===================
const COMBINED_PDFS = [
  {
    council_slug: "havering",
    url: "https://www.havering.gov.uk/downloads/file/7412/havering-local-election-results-7-may-2026",
    cache_name: "havering-combined-2026.pdf",
    parser: "havering",
  },
];

const PARTY_CANON = [
  [/labour and co-?op|labour party|^labour$/i, "Labour"],
  [/local conservatives|conservative party|^conservative$/i, "Conservative"],
  [/liberal democrats?/i, "Liberal Democrats"],
  [/reform.?uk|reformuk|^reform uk$/i, "Reform UK"],
  [/green party/i, "Green Party"],
  [/upminster.*residents|havering residents|residents association/i, "Local"],
  [/independent/i, "Independent"],
  [/ukip/i, "UKIP"],
  [/heritage party/i, "Heritage Party"],
  [/workers party/i, "Workers Party"],
];

function canonParty(raw) {
  if (!raw) return "Unknown";
  for (const [re, label] of PARTY_CANON) {
    if (re.test(raw)) return label;
  }
  return raw.trim();
}

async function downloadPdf(url, cachePath) {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(cachePath) && statSync(cachePath).size > 0) return cachePath;
  await sleep(800);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/pdf,*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(cachePath, buf);
  return cachePath;
}

function pdfToText(pdfPath) {
  const txtPath = pdfPath.replace(/\.pdf$/, ".txt");
  if (!existsSync(txtPath)) {
    execFileSync("pdftotext", ["-layout", pdfPath, txtPath]);
  }
  return readFileSync(txtPath, "utf8");
}

// ==== Per-ward declaration parser (Suffolk / Kirklees format) ====
function parseDeclaration(text) {
  const eMatch = text.match(/Electorate:\s*([0-9,]+)/i);
  const tMatch = text.match(/Turnout:\s*([0-9.]+)\s*%/i);
  const bMatch = text.match(/Ballot Papers Issued:\s*([0-9,]+)/i);

  const candidates = [];
  const lines = text.split(/\r?\n/);
  let startIdx = -1;
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (/Number of\s*$/.test(lines[i]) && /Votes/.test(lines[i + 1] || "")) { startIdx = i + 2; break; }
    if (/Name of\s*$/.test(lines[i]) && /Candidate/.test(lines[i + 1] || "")) { startIdx = i + 2; }
  }
  for (let i = (startIdx >= 0 ? startIdx : 0); i < lines.length; i += 1) {
    if (/^\s*\*\s*If elected/.test(lines[i]) || /^The number of ballot papers rejected/.test(lines[i])) { endIdx = i; break; }
  }
  if (startIdx < 0) return null;
  for (let i = startIdx; i < endIdx; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(.+?[A-Za-z\)])\s{2,}([0-9,]+)\s*(Elected)?\s*$/);
    if (!m) continue;
    const partyRaw = m[1].trim();
    if (/^Number of/i.test(partyRaw)) continue;
    if (/Description.*Number of Votes/i.test(partyRaw)) continue;
    const votes = parseInt(m[2].replace(/,/g, ""), 10);
    const elected = !!m[3];
    if (!Number.isFinite(votes)) continue;
    candidates.push({ name: null, party_raw: partyRaw, party_canonical: canonParty(partyRaw), votes, elected });
  }
  if (!candidates.length) return null;
  return {
    candidates,
    electorate: eMatch ? parseInt(eMatch[1].replace(/,/g, ""), 10) : null,
    turnout_pct: tMatch ? parseFloat(tMatch[1]) / 100 : null,
    ballot_papers_issued: bMatch ? parseInt(bMatch[1].replace(/,/g, ""), 10) : null,
  };
}

// ==== Havering combined-PDF parser ====
//
// Layout (per ward section):
//   <Ward Name>
//   Candidate                Commonly known as     Party                 Total votes
//   SURNAME Forenames                              Party Name            NNN [Elected]
//   ...
//   • Turnout: NN.NN per cent
//
// Wards are separated by their own header line. We detect a ward header
// as a non-empty line that matches one of the known Havering ward names.
function parseHaveringCombined(text, wardSlugBySlugifiedName) {
  const wardSections = {};
  const lines = text.split(/\r?\n/);
  let currentSlug = null;
  let buffer = [];
  function flush() {
    if (currentSlug) {
      wardSections[currentSlug] = (wardSections[currentSlug] || []).concat(buffer);
    }
    buffer = [];
  }
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (currentSlug) buffer.push(line);
      continue;
    }
    // Is this line a ward header? Slugify and check.
    const slug = t.toLowerCase().replace(/&/g, "and").replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (wardSlugBySlugifiedName[slug] && t.length < 60) {
      flush();
      currentSlug = wardSlugBySlugifiedName[slug];
      continue;
    }
    if (currentSlug) buffer.push(line);
  }
  flush();

  const out = {};
  for (const [slug, secLines] of Object.entries(wardSections)) {
    const candidates = [];
    let inTable = false;
    for (const line of secLines) {
      if (/^\s*Candidate\b/i.test(line) && /Total votes/i.test(line)) {
        inTable = true; continue;
      }
      if (/^\s*[••]/.test(line)) { inTable = false; continue; } // bullet footer
      if (!inTable) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Split on 2+ whitespace into fields.
      const fields = trimmed.split(/\s{2,}/).filter((s) => s.length);
      if (fields.length < 2) continue;
      let last = fields[fields.length - 1];
      let elected = false;
      const electedMatch = last.match(/^([0-9,]+)\s+Elected$/);
      if (electedMatch) {
        elected = true;
        last = electedMatch[1];
      }
      const votes = parseInt(last.replace(/,/g, ""), 10);
      if (!Number.isFinite(votes)) continue;
      // Party is one of the middle fields. Heuristic: the last field that
      // contains alphabetic characters before the votes column. With the
      // table columns being [Candidate, Commonly known as, Party, Total votes],
      // the "Commonly known as" field is usually empty, so after splitting
      // on 2+ spaces we get either [name, party, votes] or [name, party, votes Elected].
      const partyRaw = fields.length >= 3 ? fields[fields.length - 2] : null;
      if (!partyRaw) continue;
      // Skip header rows.
      if (/^Total votes$/i.test(partyRaw)) continue;
      candidates.push({
        name: fields[0] || null,
        party_raw: partyRaw,
        party_canonical: canonParty(partyRaw),
        votes,
        elected,
      });
    }
    // Capture turnout if visible
    const tMatch = secLines.join("\n").match(/Turnout:\s*([0-9.]+)\s*per cent/i);
    if (candidates.length) {
      out[slug] = {
        candidates,
        electorate: null,
        turnout_pct: tMatch ? parseFloat(tMatch[1]) / 100 : null,
        ballot_papers_issued: null,
      };
    }
  }
  return out;
}

function compactRecord({ ward, parsed, sourceUrl, ingestedAt }) {
  const totalVotes = parsed.candidates.reduce((s, c) => s + c.votes, 0);
  const voteShares = {};
  for (const c of parsed.candidates) {
    const p = c.party_canonical;
    voteShares[p] = (voteShares[p] || 0) + c.votes / Math.max(totalVotes, 1);
  }
  let winners = parsed.candidates.filter((c) => c.elected);
  if (winners.length === 0 && parsed.candidates.length) {
    const N = ward.winner_count || 1;
    const sorted = [...parsed.candidates].sort((a, b) => b.votes - a.votes);
    winners = sorted.slice(0, N);
  }
  const winnerEntry = Object.entries(voteShares).sort((a, b) => b[1] - a[1])[0];
  return {
    ballot_paper_id: ward.ballot_paper_id,
    election_date: "2026-05-07",
    tier: "local",
    council_slug: ward.council_slug,
    ward_slug: ward.ward_slug,
    is_by_election: false,
    winner_count: winners.length || 1,
    electorate: parsed.electorate,
    turnout_votes: parsed.ballot_papers_issued,
    turnout_pct: parsed.turnout_pct,
    spoilt_ballots: null,
    total_valid_votes: totalVotes,
    candidates: parsed.candidates.map((c) => ({
      person_id: null, name: c.name, party_name: c.party_raw,
      party_canonical: c.party_canonical, party_ec_id: null, votes: c.votes, elected: c.elected,
    })),
    vote_shares: voteShares,
    winner_party_canonical: winnerEntry?.[0] || null,
    winners: winners.map((c) => ({
      name: c.name, party_canonical: c.party_canonical, person_id: null, votes: c.votes,
    })),
    source: sourceUrl,
    ingested_at: ingestedAt,
    ingest_method: "council-pdf-declaration",
    quality_caveat: "Authoritative — official deputy/returning officer's declaration of result, parsed via pdftotext.",
  };
}

async function main() {
  const identity = JSON.parse(readFileSync(join(REPO, "data/identity/wards-may-2026.json"), "utf8"));
  const wardIndex = {};
  for (const w of identity.wards) {
    if (w.cancelled) continue;
    if (w.tier !== "local") continue;
    wardIndex[`${w.council_slug}::${w.ward_slug}`] = w;
  }

  const ingestedAt = new Date().toISOString();
  const results = [];
  const report = [];

  // Per-ward PDFs
  for (const entry of PER_WARD_PDFS) {
    const ward = wardIndex[`${entry.council_slug}::${entry.ward_slug}`];
    if (!ward) {
      report.push({ council: entry.council_slug, ward: entry.ward_slug, status: "no_identity_match" });
      continue;
    }
    try {
      const pdfPath = join(CACHE_DIR, `${entry.council_slug}-${entry.ward_slug}.pdf`);
      await downloadPdf(entry.url, pdfPath);
      const text = pdfToText(pdfPath);
      const parsed = parseDeclaration(text);
      if (!parsed || !parsed.candidates.length) {
        report.push({ council: entry.council_slug, ward: entry.ward_slug, status: "no_candidates_parsed" });
        continue;
      }
      results.push(compactRecord({ ward, parsed, sourceUrl: entry.url, ingestedAt }));
      report.push({ council: entry.council_slug, ward: entry.ward_slug, status: "ok", candidates: parsed.candidates.length });
    } catch (e) {
      report.push({ council: entry.council_slug, ward: entry.ward_slug, status: "error", error: e.message });
      console.error(`  ${entry.council_slug}/${entry.ward_slug}: ${e.message}`);
    }
  }

  // Combined PDFs
  for (const combo of COMBINED_PDFS) {
    const wardsForCouncil = identity.wards.filter((w) => w.council_slug === combo.council_slug && w.tier === "local" && !w.cancelled);
    const slugIndex = {};
    function slugifyWardName(n) {
      return n.toLowerCase().replace(/&/g, "and").replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
    for (const w of wardsForCouncil) {
      slugIndex[slugifyWardName(w.ward_name)] = w.ward_slug;
    }
    try {
      const pdfPath = join(CACHE_DIR, combo.cache_name);
      await downloadPdf(combo.url, pdfPath);
      const text = pdfToText(pdfPath);
      let parsedByWard;
      if (combo.parser === "havering") {
        parsedByWard = parseHaveringCombined(text, slugIndex);
      } else {
        throw new Error(`Unknown combined parser: ${combo.parser}`);
      }
      for (const w of wardsForCouncil) {
        const parsed = parsedByWard[w.ward_slug];
        if (!parsed) {
          report.push({ council: combo.council_slug, ward: w.ward_slug, status: "not_in_combined_pdf" });
          continue;
        }
        results.push(compactRecord({ ward: w, parsed, sourceUrl: combo.url, ingestedAt }));
        report.push({ council: combo.council_slug, ward: w.ward_slug, status: "ok", candidates: parsed.candidates.length });
      }
    } catch (e) {
      report.push({ council: combo.council_slug, status: "error", error: e.message });
      console.error(`  ${combo.council_slug} combined: ${e.message}`);
    }
  }

  const sha = createHash("sha256").update(JSON.stringify(results)).digest("hex");
  const out = {
    snapshot: {
      snapshot_id: `council-pdf-supplement-${sha.slice(0, 12)}`,
      source_name: "Council deputy/returning-officer Declarations of Result (PDFs)",
      ingested_at: ingestedAt,
      sha256: sha,
      licence: "Public records under RPA 1983 + Local Elections (Principal Areas) Rules 2006.",
      ingest_method: "council-pdf-declaration → pdftotext",
    },
    per_ward_report: report,
    results,
    by_ballot: Object.fromEntries(results.map((r) => [r.ballot_paper_id, r])),
  };
  mkdirSync(dirname(join(REPO, OUT)), { recursive: true });
  writeFileSync(join(REPO, OUT), JSON.stringify(out, null, 2));

  // Per-council summary
  const byCouncil = {};
  for (const r of report) {
    byCouncil[r.council] = byCouncil[r.council] || { ok: 0, fail: 0 };
    if (r.status === "ok") byCouncil[r.council].ok += 1;
    else byCouncil[r.council].fail += 1;
  }
  console.log(`\nWrote ${OUT} — ${results.length} ballots from PDF declarations`);
  console.log(`Per council:`);
  for (const [c, s] of Object.entries(byCouncil)) {
    console.log(`  ${c}: ${s.ok} ok, ${s.fail} failed`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
