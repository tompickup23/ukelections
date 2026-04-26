#!/usr/bin/env node
/**
 * ingest-ge-notional-2019.mjs — parse the Rallings/Thrasher notional 2019
 * results-on-2024-boundaries CSV (downloaded from
 * electionresults.parliament.uk/general-elections/5) and emit a per-PCON
 * baseline keyed by 2024 PCON GSS + slug.
 *
 * Output: data/history/ge-notional-2019.json
 *   {
 *     snapshot: { ... },
 *     by_gss: { "E14001118": { name, slug, country, results: [{party,pct,votes,elected}] } },
 *     by_slug: { "burnley": { ... same payload ... } }
 *   }
 *
 * Why: 211 of 650 PCONs got new boundaries in 2024, so the actual GE2019
 * results don't map cleanly. This dataset reconstitutes 2019 vote counts
 * onto the new boundaries using ward-level apportionment, giving us a clean
 * "what 2019 would have looked like under current boundaries" comparator.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const SRC = process.env.NOTIONAL_2019_CSV || join(homedir(), "ukelections/.cache/notional-2019/candidate-level-results-notional-general-election-12-12-2019.csv");
const OUT = "data/history/ge-notional-2019.json";

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

function parseCsvLine(line) {
  const fields = [];
  let buf = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { buf += '"'; i++; } else { inQ = false; }
      } else { buf += c; }
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ",") { fields.push(buf); buf = ""; continue; }
    buf += c;
  }
  fields.push(buf);
  return fields;
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function canonParty(name, abbrev) {
  // Use both the full name + abbreviation to canonicalise.
  if (/Labour/i.test(name) || abbrev === "Lab" || abbrev === "Lab/Co-op") return "Labour";
  if (/Conservative/i.test(name) || abbrev === "Con") return "Conservative";
  if (/Liberal Democrat/i.test(name) || abbrev === "LD") return "Liberal Democrats";
  if (/Reform UK/i.test(name)) return "Reform UK";
  if (/Brexit Party/i.test(name)) return "Reform UK";
  if (/UK Independence/i.test(name) || abbrev === "UKIP") return "Reform UK";
  if (/Green Party/i.test(name) || abbrev === "Grn") return "Green Party";
  if (/Plaid Cymru/i.test(name) || abbrev === "PC") return "Plaid Cymru";
  if (/Scottish National/i.test(name) || abbrev === "SNP") return "SNP";
  if (/Sinn F/i.test(name) || abbrev === "SF") return "Sinn Féin";
  if (/Democratic Unionist/i.test(name) || abbrev === "DUP") return "DUP";
  if (/Alliance/i.test(name) || abbrev === "APNI") return "Alliance";
  if (/SDLP|Social Democratic & Labour/i.test(name)) return "SDLP";
  if (/Ulster Unionist/i.test(name) || abbrev === "UUP") return "UUP";
  if (/Speaker/i.test(name)) return "Speaker";
  if (/independent/i.test(name)) return "Independent";
  return name || abbrev || "Other";
}

function inferCountry(gss) {
  if (gss?.startsWith("S14")) return "scotland";
  if (gss?.startsWith("W07")) return "wales";
  if (gss?.startsWith("N06")) return "northern_ireland";
  return "england";
}

function main() {
  const text = readFileSync(SRC, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0].replace(/^\uFEFF/, ""));
  const idx = (name) => header.indexOf(name);
  const COL = {
    cName: idx("Constituency name"),
    cGss: idx("Constituency geographic code"),
    cCountry: idx("Country name"),
    cElectorate: idx("Electorate"),
    cTotalValid: idx("Election valid vote count"),
    cFamilyName: idx("Candidate family name"),
    cGivenName: idx("Candidate given name"),
    cPartyName: idx("Main party name"),
    cPartyAbbr: idx("Main party abbreviation"),
    cVotes: idx("Candidate vote count"),
    cShare: idx("Candidate vote share"),
    cPosition: idx("Candidate result position"),
    cIsAggregate: idx("Candidate is notional political party aggregate"),
  };
  if (Object.values(COL).some((v) => v < 0)) {
    console.error("CSV header missing expected columns:", COL);
    process.exit(1);
  }

  const byGss = new Map();
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const gss = f[COL.cGss]?.trim();
    if (!gss) continue;
    // Skip aggregate rows (some CSVs include party-aggregate roll-ups)
    const isAggregate = String(f[COL.cIsAggregate]).toLowerCase() === "true";
    if (isAggregate) continue;
    const partyName = f[COL.cPartyName] || "";
    const partyAbbr = f[COL.cPartyAbbr] || "";
    const votes = Number(f[COL.cVotes]) || 0;
    const share = Number(f[COL.cShare]) || 0;
    const position = Number(f[COL.cPosition]) || 0;
    const family = f[COL.cFamilyName] || "";
    const given = f[COL.cGivenName] || "";
    const party = canonParty(partyName, partyAbbr);
    const candidate = {
      name: [given, family].filter(Boolean).join(" "),
      party,
      party_abbr: partyAbbr,
      party_dc: partyName,
      votes,
      pct: share,
      elected: position === 1,
      position,
    };
    const rec = byGss.get(gss) || {
      gss,
      name: f[COL.cName],
      slug: slugify(f[COL.cName]),
      country: inferCountry(gss),
      electorate: Number(f[COL.cElectorate]) || null,
      total_valid: Number(f[COL.cTotalValid]) || null,
      candidates: [],
    };
    rec.candidates.push(candidate);
    byGss.set(gss, rec);
  }

  // Sort each PCON's candidates by position (winner first), populate winner shares
  for (const rec of byGss.values()) {
    rec.candidates.sort((a, b) => (a.position || 99) - (b.position || 99));
    rec.winner_party = rec.candidates[0]?.party || null;
    rec.runner_up_party = rec.candidates[1]?.party || null;
    rec.majority = rec.candidates[0] && rec.candidates[1] ? rec.candidates[0].votes - rec.candidates[1].votes : null;
    rec.majority_pct = rec.candidates[0] && rec.candidates[1] ? (rec.candidates[0].pct || 0) - (rec.candidates[1].pct || 0) : null;
  }

  // Build by_slug index too
  const bySlug = {};
  for (const rec of byGss.values()) {
    bySlug[rec.slug] = rec;
  }

  const out = {
    snapshot: {
      snapshot_id: `ge-notional-2019-${new Date().toISOString().slice(0, 10)}`,
      generated_at: new Date().toISOString(),
      source_url: "https://electionresults.parliament.uk/general-elections/5",
      source_path: SRC,
      method: "Rallings & Thrasher 2024 — ward-level apportionment of 2019 vote counts onto 2024 boundaries.",
      coverage: {
        total_pcons: byGss.size,
        by_country: Object.fromEntries(
          [...byGss.values()].reduce((acc, r) => {
            acc.set(r.country, (acc.get(r.country) || 0) + 1);
            return acc;
          }, new Map()),
        ),
      },
      licence: "UK Parliament Open Data (Open Parliament Licence)",
    },
    by_gss: Object.fromEntries(byGss.entries()),
    by_slug: bySlug,
  };

  mkdirSync(dirname(join(REPO, OUT)), { recursive: true });
  writeFileSync(join(REPO, OUT), JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT}: ${byGss.size} PCONs (${out.snapshot.coverage.by_country ? JSON.stringify(out.snapshot.coverage.by_country) : ''})`);
}

main();
