#!/usr/bin/env node
/**
 * ingest-wikipedia-may2026-supplement.mjs — for each council with provisional
 * coverage in data/results/may-2026/local-and-mayor.json, fetch its
 * Wikipedia 2026 election article, parse per-ward {{Election box ...}}
 * templates, and write a supplemental actuals file in the same schema.
 *
 * Output:
 *   data/results/may-2026/wikipedia-supplement.json
 *
 * Wikipedia is NOT authoritative; it's a community-maintained mirror of
 * council declarations. Each ballot in the supplement carries
 * source = "wikipedia:<article-title>" so the merge step can later
 * preferentially keep a DC-API record if both arrive.
 *
 * Wikipedia template form (most common):
 *   === <Ward name> ===
 *   {{Election box begin | title = ...}}
 *   {{Election box candidate with party link | party = X | candidate = Y | votes = NNNN | percentage = NN.N }}
 *   ...
 *   {{Election box winning candidate with party link | party = X | candidate = Y* | votes = NNNN ... }}
 *   ...
 *   {{Election box gain from / hold | ... }}
 *   {{Election box end}}
 *
 * Multi-seat wards mark each elected candidate with "winning candidate".
 * Asterisks on names denote incumbents (cosmetic).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const USER_AGENT = "ukelections.co.uk wikipedia supplement (contact: tom@ukelections.co.uk)";
const CACHE_DIR = join(REPO, ".cache/wikipedia-may2026");
const OUT = "data/results/may-2026/wikipedia-supplement.json";

// council_slug → Wikipedia article title (without the "2026_" prefix; we add it).
const ARTICLE_OVERRIDES = {
  "brent": "Brent_London_Borough_Council_election",
  "newham": "Newham_London_Borough_Council_election",
  "tower-hamlets": "Tower_Hamlets_London_Borough_Council_election",
  "redbridge": "Redbridge_London_Borough_Council_election",
  "south-tyneside": "South_Tyneside_Metropolitan_Borough_Council_election",
  "st-helens": "St_Helens_Metropolitan_Borough_Council_election",
  "kirklees": "Kirklees_Metropolitan_Borough_Council_election",
  "hillingdon": "Hillingdon_London_Borough_Council_election",
  "south-cambridgeshire": "South_Cambridgeshire_District_Council_election",
  "havering": "Havering_London_Borough_Council_election",
  "birmingham": "Birmingham_City_Council_election",
  "suffolk": "Suffolk_County_Council_election",
  "waltham-forest": "Waltham_Forest_London_Borough_Council_election",
  "kensington-and-chelsea": "Kensington_and_Chelsea_London_Borough_Council_election",
};

const PARTY_CANON_MAP = [
  [/^Labour Party.*Co-?operative/i, "Labour"],
  [/^Labour Party/i, "Labour"],
  [/^Labour and Co-?operative/i, "Labour"],
  [/^Co-?operative Party/i, "Labour"],
  [/^Conservative Party/i, "Conservative"],
  [/^Conservative and Unionist/i, "Conservative"],
  [/^Liberal Democrats?/i, "Liberal Democrats"],
  [/^Reform UK/i, "Reform UK"],
  [/^Green Party/i, "Green Party"],
  [/^Plaid Cymru/i, "Plaid Cymru"],
  [/^Scottish National/i, "SNP"],
  [/^UK Independence/i, "UKIP"],
  [/^UKIP/i, "UKIP"],
  [/^Workers Party/i, "Workers Party"],
  [/^Trade Unionist/i, "TUSC"],
  [/^Independent/i, "Independent"],
  [/^Local/i, "Local"],
  [/^Heritage Party/i, "Heritage Party"],
  [/^Britain First/i, "Britain First"],
  [/^Christian/i, "Christian"],
];

function canonParty(raw) {
  if (!raw) return "Unknown";
  const cleaned = String(raw).replace(/\s*\(.*?\)\s*$/, "").trim();
  for (const [re, label] of PARTY_CANON_MAP) {
    if (re.test(cleaned)) return label;
  }
  return cleaned;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWikitext(title, { refresh = false, addElectionPrefix = true } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const fullTitle = addElectionPrefix ? `2026_${title}` : title;
  // Use a sanitised filename for the cache so titles with parens / spaces
  // don't break the filesystem path.
  const cacheKey = fullTitle.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cachePath = join(CACHE_DIR, `${cacheKey}.wikitext`);
  if (!refresh && existsSync(cachePath)) {
    return readFileSync(cachePath, "utf8");
  }
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(fullTitle)}&format=json&prop=wikitext`;
  await sleep(1500);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Wikipedia ${res.status} on ${fullTitle}`);
  const body = await res.json();
  const wt = body?.parse?.wikitext?.["*"];
  if (!wt) throw new Error(`No wikitext for ${fullTitle}: ${JSON.stringify(body).slice(0, 200)}`);
  writeFileSync(cachePath, wt);
  return wt;
}

function slugify(s) {
  return String(s || "").toLowerCase()
    .replace(/&/g, "and")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanWikilink(s) {
  // [[Foo (ward)|Foo]]  → "Foo"   (prefer pipe-display text)
  // [[Foo]]              → "Foo"
  // Foo                  → "Foo"
  return String(s)
    .replace(/\[\[([^\]|]+?)\|([^\]]+?)\]\]/g, "$2")
    .replace(/\[\[([^\]]+?)\]\]/g, "$1")
    .replace(/<ref[\s\S]*?<\/ref>/g, "")
    .replace(/<ref[\s\S]*?\/>/g, "")
    .trim();
}

function splitWardSections(wikitext) {
  // Try a sequence of likely level-2 headers; if none is found, scan the
  // whole article for level-3 ward headers (some councils — South Tyneside
  // — go straight to ward sections after the lead).
  const HEADER_CANDIDATES = [
    /^==\s*Ward results?\s*==/im,
    /^==\s*Results by ward\s*==/im,
    /^==\s*Results?\s*==/im,
  ];
  let scopeStart = -1;
  for (const re of HEADER_CANDIDATES) {
    const m = wikitext.match(re);
    if (m) { scopeStart = m.index; break; }
  }
  let scope = scopeStart >= 0 ? wikitext.slice(scopeStart) : wikitext;

  // End at References / Notes / External links section if present
  const refStart = scope.search(/^==\s*(References|Notes|External links|Footnotes|See also)\s*==/im);
  if (refStart > 0) scope = scope.slice(0, refStart);

  const sections = {};
  const re = /^={3}\s*(.+?)\s*={3}\s*$/gm;
  const matches = [...scope.matchAll(re)];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const next = matches[i + 1];
    const wardName = cleanWikilink(m[1]).replace(/\s*\(ward\)\s*$/i, "").trim();
    if (!wardName) continue;
    const start = m.index + m[0].length;
    const end = next ? next.index : scope.length;
    sections[wardName] = scope.slice(start, end);
  }
  return sections;
}

function extractCandidateBlocks(sectionText) {
  // Pull out {{Election box (winning )?candidate with party link | ... }} templates.
  // The header is matched case-insensitively because some councils (K&C,
  // Kirklees, St Helens) use lowercase "{{election box ...}}".
  const blocks = [];
  const text = sectionText;
  const lowerText = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const start = lowerText.indexOf("{{election box", i);
    if (start < 0) break;
    let depth = 0;
    let j = start;
    while (j < text.length) {
      if (text[j] === "{" && text[j + 1] === "{") { depth += 1; j += 2; continue; }
      if (text[j] === "}" && text[j + 1] === "}") {
        depth -= 1; j += 2;
        if (depth === 0) break;
        continue;
      }
      j += 1;
    }
    blocks.push(text.slice(start, j));
    i = j;
  }
  return blocks;
}

function parseTemplateFields(body) {
  // Body looks like "{{Election box ... | k1 = v1 | k2 = v2 ... }}".
  // Strip the outer "{{<header>" and trailing "}}"; the header runs from the
  // opening "{{" up to the first "|" not nested inside another "{{...}}".
  // For candidate templates we don't need to track nested templates inside
  // values (rare in practice), so a simple split-on-pipe at the top level
  // followed by a key=value parse is enough.
  const inner = body.replace(/^\{\{/, "").replace(/\}\}$/, "");
  // Walk and split on top-level | only.
  const parts = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    const next = inner[i + 1];
    if (ch === "{" && next === "{") { depth += 1; buf += ch; continue; }
    if (ch === "}" && next === "}") { depth -= 1; buf += ch; continue; }
    if (ch === "[" && next === "[") { depth += 1; buf += ch; continue; }
    if (ch === "]" && next === "]") { depth -= 1; buf += ch; continue; }
    if (ch === "|" && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.length) parts.push(buf);
  // First part is the template name.
  const name = parts.shift() || "";
  const fields = {};
  for (const p of parts) {
    const m = p.match(/^\s*([a-zA-Z_/+\-]+)\s*=\s*([\s\S]*?)\s*$/);
    if (m) fields[m[1].toLowerCase()] = m[2];
  }
  return { name: name.trim(), fields };
}

function parseCandidateBlock(body) {
  const headerLower = body.slice(0, 200).toLowerCase();
  const isWinner = /election box winning candidate/.test(headerLower);
  const isCandidate = /election box (winning )?candidate(?:\s+with party link)?/.test(headerLower);
  if (!isCandidate) return null;
  const { fields } = parseTemplateFields(body);
  if (!fields.party) return null;
  const partyRaw = fields.party.trim();
  const candidate = (fields.candidate || "").replace(/\*+\s*$/, "").replace(/\[\[([^\]|]+?)\|([^\]]+?)\]\]/g, "$2").replace(/\[\[([^\]]+?)\]\]/g, "$1").trim();
  const votesStr = (fields.votes || "").replace(/[,\s]/g, "");
  const votes = parseInt(votesStr, 10);
  const pct = fields.percentage ? parseFloat(fields.percentage) : null;
  return {
    party_raw: partyRaw,
    party_canonical: canonParty(partyRaw),
    candidate: candidate || null,
    votes: Number.isFinite(votes) ? votes : null,
    percentage: Number.isFinite(pct) ? pct : null,
    elected: isWinner,
  };
}

function compactWardResult({ ballotPaperId, councilSlug, wardSlug, wardName, candidates, sourceArticle, ingestedAt, winnerCount }) {
  const totalVotes = candidates.reduce((s, c) => s + (c.votes || 0), 0);
  const voteShares = {};
  if (totalVotes > 0) {
    for (const c of candidates) {
      const p = c.party_canonical;
      voteShares[p] = (voteShares[p] || 0) + (c.votes || 0) / totalVotes;
    }
  }
  // Prefer explicit winning-candidate templates. If none are tagged (e.g.
  // Redbridge uses bold formatting instead), fall back to top winner_count
  // candidates by votes — winner_count comes from the identity file
  // (authoritative seat count per ward).
  let winners = candidates.filter((c) => c.elected);
  if (winners.length === 0 && candidates.length) {
    const N = winnerCount && winnerCount > 0 ? winnerCount : 1;
    const sorted = [...candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    winners = sorted.slice(0, N);
  }
  const winnerEntry = Object.entries(voteShares).sort((a, b) => b[1] - a[1])[0];
  const winnerPartyCanonical = winnerEntry ? winnerEntry[0] : null;

  return {
    ballot_paper_id: ballotPaperId,
    election_date: "2026-05-07",
    tier: "local",
    council_slug: councilSlug,
    ward_slug: wardSlug,
    is_by_election: false,
    winner_count: winners.length || 1,
    electorate: null,
    turnout_votes: null,
    turnout_pct: null,
    spoilt_ballots: null,
    total_valid_votes: totalVotes,
    candidates: candidates.map((c) => ({
      person_id: null,
      name: c.candidate,
      party_name: c.party_raw,
      party_canonical: c.party_canonical,
      party_ec_id: null,
      votes: c.votes,
      elected: c.elected,
    })),
    vote_shares: voteShares,
    winner_party_canonical: winnerPartyCanonical,
    winners: winners.map((c) => ({
      name: c.candidate,
      party_canonical: c.party_canonical,
      person_id: null,
      votes: c.votes,
    })),
    source: `wikipedia:${sourceArticle}`,
    source_article: `https://en.wikipedia.org/wiki/2026_${sourceArticle}`,
    ingested_at: ingestedAt,
    ingest_method: "wikipedia",
    quality_caveat: "Community-maintained Wikipedia mirror; reconcile against council declaration if available.",
    ward_name_wikipedia: wardName,
  };
}

async function fetchTransclusionContent(targetArticle, sectionLabel, refresh) {
  // Pull the target article (NO 2026_ prefix — transclusion targets are
  // standalone ward articles) and extract content between
  // <section begin="..." /> and <section end="..." /> markers.
  const wt = await fetchWikitext(targetArticle.replace(/\s+/g, "_"), { refresh, addElectionPrefix: false });
  const labelEsc = sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<section\\s+begin\\s*=\\s*["']?${labelEsc}["']?\\s*/?>([\\s\\S]*?)<section\\s+end\\s*=\\s*["']?${labelEsc}["']?\\s*/?>`, "i");
  const m = wt.match(re);
  return m ? m[1] : null;
}

function detectTransclusion(sectionText) {
  // {{#section:Beam Park (ward)|2026 Beam Park}}
  const m = sectionText.match(/\{\{\s*#section\s*:\s*([^|}]+?)\s*\|\s*([^}]+?)\s*\}\}/);
  if (!m) return null;
  return { article: m[1].trim(), label: m[2].trim() };
}

async function processCouncil({ slug, articleTitle, identityWards, refresh, ingestedAt }) {
  const wikitext = await fetchWikitext(articleTitle, { refresh });
  const sections = splitWardSections(wikitext);
  const wardNamesInIdentity = identityWards.filter((w) => w.council_slug === slug && w.tier === "local" && !w.cancelled);
  const wardSlugIndex = {};
  for (const w of wardNamesInIdentity) wardSlugIndex[slugify(w.ward_name)] = w;

  const results = [];
  let parsedSections = 0;
  let unmatchedSections = [];
  for (const [wardName, section] of Object.entries(sections)) {
    const wardSlugFromHeading = slugify(wardName);
    const candidate = wardSlugIndex[wardSlugFromHeading];
    if (!candidate) {
      // Try fuzzier matching: drop "and"/"&", trailing "ward"
      const alt = slugify(wardName.replace(/\bward\b/i, "").replace(/&/g, "and"));
      const alt2 = wardSlugIndex[alt];
      if (alt2) {
        unmatchedSections.push({ heading: wardName, matched_via: "fuzzy", target: alt });
      } else {
        unmatchedSections.push({ heading: wardName, matched_via: null });
        continue;
      }
    }
    const target = candidate || wardSlugIndex[slugify(wardName.replace(/\bward\b/i, "").replace(/&/g, "and"))];
    if (!target) continue;

    // If the section is a transclusion ({{#section:Article|Label}}),
    // fetch the target article and extract the labelled span before parsing.
    let sectionContent = section;
    const trans = detectTransclusion(section);
    let sourceUsed = articleTitle;
    if (trans) {
      try {
        const transContent = await fetchTransclusionContent(trans.article, trans.label, refresh);
        if (transContent) {
          sectionContent = transContent;
          sourceUsed = `${articleTitle}#transclude:${trans.article}`;
        }
      } catch (e) {
        unmatchedSections.push({ heading: wardName, matched_via: "transclude_fetch_failed", error: e.message });
        continue;
      }
    }

    const blocks = extractCandidateBlocks(sectionContent);
    const parsed = blocks.map(parseCandidateBlock).filter((c) => c && c.votes != null && c.votes > 0);
    if (parsed.length === 0) {
      unmatchedSections.push({ heading: wardName, matched_via: "ward_matched_but_no_candidates_parsed" });
      continue;
    }
    parsedSections += 1;
    results.push(compactWardResult({
      ballotPaperId: target.ballot_paper_id,
      councilSlug: slug,
      wardSlug: target.ward_slug,
      wardName,
      candidates: parsed,
      sourceArticle: sourceUsed,
      ingestedAt,
      winnerCount: target.winner_count || 1,
    }));
  }
  return { slug, articleTitle, parsedSections, totalSectionsFound: Object.keys(sections).length, results, unmatchedSections };
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const ingestedAt = new Date().toISOString();

  const identity = JSON.parse(readFileSync(join(REPO, "data/identity/wards-may-2026.json"), "utf8"));
  const control = JSON.parse(readFileSync(join(REPO, "data/results/may-2026/council-control.json"), "utf8"));
  const provisional = control.councils.filter((c) => c.may7_wins.provisional);

  console.log(`Processing ${provisional.length} provisional councils via Wikipedia...`);
  const allResults = [];
  const perCouncilReport = [];
  for (const c of provisional) {
    const slug = c.council_slug;
    const articleTitle = ARTICLE_OVERRIDES[slug];
    if (!articleTitle) {
      console.log(`  ${slug}: no Wikipedia article override mapped — skip`);
      perCouncilReport.push({ slug, status: "no_article_mapped" });
      continue;
    }
    try {
      const r = await processCouncil({ slug, articleTitle, identityWards: identity.wards, refresh, ingestedAt });
      console.log(`  ${slug}: ${r.parsedSections} of ${r.totalSectionsFound} ward sections parsed (${r.results.length} ballots produced)`);
      allResults.push(...r.results);
      perCouncilReport.push({
        slug,
        article: articleTitle,
        sections_found: r.totalSectionsFound,
        sections_parsed: r.parsedSections,
        ballots_produced: r.results.length,
        unmatched_sample: r.unmatchedSections.slice(0, 5),
      });
    } catch (e) {
      console.error(`  ${slug}: ERROR ${e.message}`);
      perCouncilReport.push({ slug, status: "error", error: e.message });
    }
  }

  const sha = createHash("sha256").update(JSON.stringify(allResults)).digest("hex");
  const out = {
    snapshot: {
      snapshot_id: `wikipedia-supplement-${sha.slice(0, 12)}`,
      source_name: "Wikipedia 2026 council-election articles (community-maintained mirror)",
      source_pattern: "https://en.wikipedia.org/wiki/2026_<Council>_(London_Borough_|City_|Metropolitan_Borough_|District_|County_)Council_election",
      ingested_at: ingestedAt,
      sha256: sha,
      licence: "CC-BY-SA 4.0 (Wikipedia text); per-row source URL retained for verification.",
    },
    per_council_report: perCouncilReport,
    results: allResults,
    by_ballot: Object.fromEntries(allResults.map((r) => [r.ballot_paper_id, r])),
  };
  mkdirSync(dirname(join(REPO, OUT)), { recursive: true });
  writeFileSync(join(REPO, OUT), JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT} — ${allResults.length} ballots from ${perCouncilReport.filter((r) => r.ballots_produced > 0).length} councils`);
}

main().catch((err) => { console.error(err); process.exit(1); });
