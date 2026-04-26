#!/usr/bin/env node
/**
 * ingest-leap.mjs — turn the Andrew Teale LEAP archive into ward-GSS-keyed
 * historic election rows that slot into the same shape as DC results.
 *
 * Source: ~/ukelections/.cache/leap/unpacked/<year>/leap-YYYY-MM-DD.csv
 * Output: data/history/leap-history.json — { gss_code: [historyRow,...] }
 *
 * History row shape matches dcResultToHistoryRow output (see
 * src/lib/adaptDcToWardData.js): { date, year, type, seats_contested,
 * turnout_votes, turnout, electorate (null), candidates:[{name,party,
 * party_dc,votes,pct,elected,rank}], majority, majority_pct, source,
 * ballot_paper_id }.
 *
 * Only rows with a real ward GSS (E05/W05/S13/N09/N08) are kept; pre-GSS
 * "NULL" / legacy ONS codes are dropped because they cannot be joined to
 * the 2026 ward identity table.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const LEAP_ROOT = process.env.LEAP_ROOT || join(homedir(), "ukelections/.cache/leap/unpacked");
const OUT_PATH = join(REPO_ROOT, "data/history/leap-history.json");

function parseLine(line) {
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

const PARTY_MAP = {
  C: "Conservative",
  Con: "Conservative",
  CON: "Conservative",
  Cons: "Conservative",
  Lab: "Labour",
  L: "Labour",
  LAB: "Labour",
  "Lab Co-op": "Labour",
  LabCoop: "Labour",
  "Lab/Co-op": "Labour",
  LD: "Liberal Democrats",
  LDM: "Liberal Democrats",
  Lib: "Liberal Democrats",
  LibDem: "Liberal Democrats",
  Grn: "Green Party",
  GP: "Green Party",
  Green: "Green Party",
  G: "Green Party",
  UKIP: "Reform UK",
  UK: "Reform UK",
  Reform: "Reform UK",
  ReformUK: "Reform UK",
  Brexit: "Brexit Party",
  TBP: "Brexit Party",
  SNP: "SNP",
  PC: "Plaid Cymru",
  Plaid: "Plaid Cymru",
  Ind: "Independent",
  IND: "Independent",
  Independent: "Independent",
  DInd: "Independent",
  BNP: "BNP",
  EDP: "English Democrats",
  ED: "English Democrats",
  CPA: "Christian Peoples Alliance",
  Respect: "Respect",
  TUSC: "TUSC",
  SocLab: "Socialist Labour",
  SocAlt: "Socialist Alternative",
  WPB: "Workers Party",
  NF: "National Front",
  Loony: "Monster Raving Loony",
  Liberal: "Liberal Party",
  SDP: "SDP",
  CA: "Community Action",
  MK: "Mebyon Kernow",
};

function canonParty(code) {
  if (!code) return "Unknown";
  const trimmed = String(code).trim();
  if (PARTY_MAP[trimmed]) return PARTY_MAP[trimmed];
  // Suffix variants like "Lab " or "C " or "Lab Co-op"
  const stripped = trimmed.replace(/\s+/g, "");
  if (PARTY_MAP[stripped]) return PARTY_MAP[stripped];
  return trimmed;
}

const VALID_GSS = /^[EWSN](05|13|09|08)\d{6}$/;

function ingestFile(path, electionDate) {
  const text = readFileSync(path, "utf8");
  const year = Number(electionDate.slice(0, 4));
  const contests = new Map(); // GSS -> { council, ward, gss, candidates:[] }
  const lines = text.split(/\r?\n/);
  let dropped = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = parseLine(line);
    if (fields.length < 8) { dropped++; continue; }
    const [council, councilGss, ward, wardGss, name, partyCode, votesStr, electedStr] = fields;
    if (!VALID_GSS.test(wardGss)) { dropped++; continue; }
    const votes = Number(votesStr);
    if (!Number.isFinite(votes)) { dropped++; continue; }
    const elected = electedStr === "1" || electedStr === "1\r" || electedStr === "1\n";
    const c = contests.get(wardGss) || {
      council: council.trim(),
      ward: ward.trim(),
      gss: wardGss,
      candidates: [],
    };
    c.candidates.push({
      name: name.trim(),
      party: canonParty(partyCode),
      party_dc: partyCode.trim(),
      votes,
      elected,
    });
    contests.set(wardGss, c);
  }
  const rows = [];
  for (const c of contests.values()) {
    const total = c.candidates.reduce((s, x) => s + x.votes, 0);
    if (total <= 0) continue;
    const ranked = [...c.candidates].sort((a, b) => b.votes - a.votes);
    const seatsContested = c.candidates.filter((x) => x.elected).length || 1;
    const candidatesOut = ranked.map((cand, i) => ({
      name: cand.name,
      party: cand.party,
      party_dc: cand.party_dc,
      votes: cand.votes,
      pct: total > 0 ? cand.votes / total : null,
      elected: cand.elected,
      rank: i + 1,
    }));
    const majPct = candidatesOut[0] && candidatesOut[1]
      ? (candidatesOut[0].pct ?? 0) - (candidatesOut[1].pct ?? 0)
      : null;
    const majAbs = candidatesOut[0] && candidatesOut[1]
      ? (candidatesOut[0].votes ?? 0) - (candidatesOut[1].votes ?? 0)
      : null;
    rows.push({
      gss_code: c.gss,
      council_name: c.council,
      ward_name: c.ward,
      date: electionDate,
      year,
      type: "borough",
      seats_contested: seatsContested,
      turnout_votes: total,
      turnout: null,
      electorate: null,
      candidates: candidatesOut,
      majority: majAbs,
      majority_pct: majPct,
      source: "leap-archive",
      ballot_paper_id: `leap.${c.gss}.${electionDate}`,
    });
  }
  return { rows, dropped };
}

function main() {
  if (!existsSync(LEAP_ROOT)) {
    console.error(`LEAP_ROOT not found: ${LEAP_ROOT}`);
    process.exit(1);
  }
  const dirs = readdirSync(LEAP_ROOT).filter((d) => /^\d{4}|leap-\d{4}/i.test(d));
  const byGss = {};
  let totalRows = 0;
  let totalDropped = 0;
  const filesProcessed = [];
  for (const d of dirs) {
    const dir = join(LEAP_ROOT, d);
    let csvName = null;
    try {
      const inside = readdirSync(dir);
      csvName = inside.find((f) => /^leap-\d{4}-\d{2}-\d{2}\.csv$/.test(f));
    } catch {
      continue;
    }
    if (!csvName) continue;
    const electionDate = csvName.replace(/^leap-/, "").replace(/\.csv$/, "");
    const { rows, dropped } = ingestFile(join(dir, csvName), electionDate);
    totalRows += rows.length;
    totalDropped += dropped;
    filesProcessed.push({ file: csvName, contests: rows.length, dropped });
    for (const row of rows) {
      const key = row.gss_code;
      if (!byGss[key]) byGss[key] = [];
      byGss[key].push(row);
    }
  }
  for (const arr of Object.values(byGss)) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }
  const out = {
    snapshot: {
      snapshot_id: `leap-archive-${new Date().toISOString().slice(0, 10)}`,
      source: "Andrew Teale LEAP via Wayback Machine",
      retrieved_via: "https://web.archive.org/web/2025/https://www.andrewteale.me.uk/leap/downloads",
      generated_at: new Date().toISOString(),
      licence: "CC BY-SA 3.0 (LEAP) / GFDL 1.3+",
    },
    totals: {
      contests: totalRows,
      gss_wards: Object.keys(byGss).length,
      raw_rows_dropped_no_gss: totalDropped,
      files_processed: filesProcessed,
    },
    by_gss: byGss,
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_PATH}: ${totalRows} contests across ${Object.keys(byGss).length} unique ward GSS codes (dropped ${totalDropped} rows lacking a GSS).`);
  for (const f of filesProcessed) console.log(`  ${f.file}: ${f.contests} contests`);
}

main();
