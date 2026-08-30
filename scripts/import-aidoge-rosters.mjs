#!/usr/bin/env node
/**
 * import-aidoge-rosters.mjs — snapshot AI DOGE's per-council councillor
 * rosters into this repo as a committed source file.
 *
 * AI DOGE (../clawd/burnley-council/data/<council>/councillors.json) holds a
 * moderngov scrape of who currently sits on each council. That is a LIVE
 * OCCUPANCY figure, not the statutory size of the chamber:
 *
 *   - a resignation leaves a vacancy, so the roster reads one SHORT
 *   - a co-option or a late scrape can leave it one LONG
 *   - defections move councillors between parties without changing the count
 *
 * So the roster is used here for exactly one job: an independent second
 * opinion on how many seats a council has. It is never a source for party
 * composition on election night, which is what the results bundle is for.
 *
 * The snapshot is committed so the site build stays hermetic. CI never reads
 * the sibling repo; this script is a local refresh step, run when the rosters
 * are known to have been re-scraped.
 *
 * Usage:  node scripts/import-aidoge-rosters.mjs [--doge-root <path>]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const OUT = join(REPO, "data/sources/aidoge-councillor-rosters.json");

const argIdx = process.argv.indexOf("--doge-root");
const DOGE_ROOT = argIdx > -1
  ? resolve(process.argv[argIdx + 1])
  : resolve(REPO, "../clawd/burnley-council/data");

function main() {
  if (!existsSync(DOGE_ROOT)) {
    console.error(`AI DOGE data directory not found: ${DOGE_ROOT}`);
    console.error("Pass --doge-root <path>, or run this from a machine that has the sibling repo.");
    process.exit(1);
  }

  const councils = {};
  let scanned = 0;
  for (const dir of readdirSync(DOGE_ROOT)) {
    const p = join(DOGE_ROOT, dir, "councillors.json");
    if (!existsSync(p)) continue;
    scanned += 1;
    let roster;
    try {
      roster = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      console.warn(`  skipped ${dir}: councillors.json did not parse`);
      continue;
    }
    if (!Array.isArray(roster) || roster.length === 0) continue;

    // Some entries carry no ward. Two different things produce that and they
    // cannot be told apart from the row alone: a directly elected mayor, who
    // sits on the council without representing a division (Croydon, Lewisham,
    // North Tyneside, Doncaster, Mansfield each show exactly one), and a
    // scrape gap (Hackney has five real councillors whose ward simply did not
    // parse). Guessing wrong shifts the count in opposite directions, so no
    // guess is made here: both totals are recorded and the registry keeps
    // whichever one reconciles against the other sources.
    const hasWard = (c) => {
      const w = String(c.ward ?? "").trim().toLowerCase();
      return w !== "" && !["not specified", "n/a", "none", "unknown", "-"].includes(w);
    };
    const seated = roster.filter(hasWard);

    // Party mix is recorded for context only. It is a snapshot of today,
    // after any defections and by-elections since the last ordinary
    // election, so it must never be read back as an election result.
    const byParty = {};
    for (const c of seated) {
      const party = (c.party || "Unknown").trim();
      byParty[party] = (byParty[party] || 0) + 1;
    }
    const wards = new Set(seated.map((c) => c.ward));

    councils[dir] = {
      roster_seats_all: roster.length,
      roster_seats_with_ward: seated.length,
      without_ward: roster.length - seated.length,
      distinct_wards: wards.size,
      by_party_today: byParty,
    };
  }

  const payload = {
    snapshot: {
      source_name: "AI DOGE per-council councillor rosters (moderngov scrape)",
      source_path: "burnley-council/data/<council>/councillors.json",
      retrieved_at: new Date().toISOString(),
      councils_scanned: scanned,
      councils_recorded: Object.keys(councils).length,
      caveat:
        "roster counts are live occupancy, not statutory chamber size. A vacancy " +
        "reads one short; a co-option reads one long. by_party_today reflects " +
        "defections and by-elections since the last ordinary election and is " +
        "NOT an election result.",
    },
    councils,
  };
  payload.snapshot.sha256 = createHash("sha256")
    .update(JSON.stringify(councils))
    .digest("hex")
    .slice(0, 16);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${OUT}\n  ${payload.snapshot.councils_recorded} rosters from ${scanned} council directories`,
  );
}

main();
