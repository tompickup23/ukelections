/**
 * Extract asylum grant rates by nationality from Home Office Asy_D02.
 *
 * The transform pipeline currently sums across all nationalities.
 * This script extracts the nationality dimension to build:
 * 1. Grant rate league table by nationality
 * 2. Top claiming nationalities with volumes
 * 3. Time series for major nationalities
 *
 * Source: asylum-claims-datasets-dec-2025.xlsx, sheet Data_Asy_D02
 * Columns: Year, Quarter, Nationality, Region, Case outcome group,
 *          Case outcome, Age, Sex, Applicant type, UASC, Decisions
 *
 * Output: src/data/live/grant-rates-nationality.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import xlsx from "xlsx";

const SOURCE = path.resolve("data/raw/uk_routes/asylum-claims-datasets-dec-2025.xlsx");
const OUTPUT = path.resolve("src/data/live/grant-rates-nationality.json");

console.log("Reading Asy_D02 (asylum initial decisions by nationality)...");
const wb = xlsx.readFile(SOURCE, { raw: false });
const ws = wb.Sheets["Data_Asy_D02"];
const rows = xlsx.utils.sheet_to_json(ws, { range: 1, raw: false, defval: "" });
console.log(`  ${rows.length} rows`);

function safeInt(v) {
  const n = parseInt(String(v).replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

// Aggregate by nationality: grants, refusals, total decisions
// Use recent data only (2020-2025) for current grant rates
// Use full history for volume rankings
const byNationality = {};  // nationality → { grants, refusals, withdrawn, admin, total, region }
const byNationalityRecent = {};  // Same but 2020-2025 only
const byNationalityYear = {};  // nationality → year → { grants, refusals, total }
const byYearAll = {};  // year → { grants, refusals, total }

for (const row of rows) {
  const year = parseInt(row.Year);
  const nationality = String(row.Nationality || "").trim();
  const region = String(row.Region || "").trim();
  const outcomeGroup = String(row["Case outcome group"] || "").trim();
  const applicantType = String(row["Applicant type"] || "").trim();
  const age = String(row.Age || "").trim();
  const sex = String(row.Sex || "").trim();
  const decisions = safeInt(row.Decisions);

  if (!nationality || !year || decisions === 0) continue;
  // Pre-2009 data has "Total" rows; post-2009 is fully disaggregated.
  // For pre-2009: use Total rows only (to avoid double-counting).
  // For post-2009: sum all disaggregated rows.
  if (year < 2009) {
    if (age !== "Total (pre-2009)") continue;
    if (sex !== "Total (pre-2009)") continue;
  }
  // Skip aggregate nationality rows
  if (nationality === "Total" || nationality.startsWith("Total ") || nationality === "Other") continue;
  if (nationality.includes("(excluding")) continue;
  // "Refugee" is a status, not a nationality — these are re-decisions for already-recognized refugees
  if (nationality === "Refugee" || nationality === "Stateless" || nationality === "Stateless person") continue;

  const isGrant = outcomeGroup === "Grant of Protection" || outcomeGroup === "Grant of Other Leave";
  const isRefusal = outcomeGroup === "Refused";
  const isWithdrawn = outcomeGroup === "Withdrawn";
  const isAdmin = outcomeGroup === "Administrative Outcome";

  // All-time
  if (!byNationality[nationality]) {
    byNationality[nationality] = { grants: 0, refusals: 0, withdrawn: 0, admin: 0, total: 0, region };
  }
  const nat = byNationality[nationality];
  nat.total += decisions;
  if (isGrant) nat.grants += decisions;
  if (isRefusal) nat.refusals += decisions;
  if (isWithdrawn) nat.withdrawn += decisions;
  if (isAdmin) nat.admin += decisions;

  // Recent (2020-2025)
  if (year >= 2020) {
    if (!byNationalityRecent[nationality]) {
      byNationalityRecent[nationality] = { grants: 0, refusals: 0, withdrawn: 0, admin: 0, total: 0, region };
    }
    const r = byNationalityRecent[nationality];
    r.total += decisions;
    if (isGrant) r.grants += decisions;
    if (isRefusal) r.refusals += decisions;
    if (isWithdrawn) r.withdrawn += decisions;
    if (isAdmin) r.admin += decisions;
  }

  // By year (for time series)
  if (year >= 2015) {
    const yk = `${nationality}|${year}`;
    if (!byNationalityYear[yk]) byNationalityYear[yk] = { grants: 0, refusals: 0, total: 0 };
    const ny = byNationalityYear[yk];
    ny.total += decisions;
    if (isGrant) ny.grants += decisions;
    if (isRefusal) ny.refusals += decisions;

    if (!byYearAll[year]) byYearAll[year] = { grants: 0, refusals: 0, total: 0 };
    byYearAll[year].total += decisions;
    if (isGrant) byYearAll[year].grants += decisions;
    if (isRefusal) byYearAll[year].refusals += decisions;
  }
}

// Build league table: grant rate = grants / (grants + refusals) × 100
// Only include nationalities with 50+ substantive decisions (recent period)
const leagueTable = [];
for (const [nat, data] of Object.entries(byNationalityRecent)) {
  const substantive = data.grants + data.refusals;
  if (substantive < 50) continue;

  const grantRate = Math.round(data.grants / substantive * 1000) / 10;
  leagueTable.push({
    nationality: nat,
    region: data.region,
    grantRatePct: grantRate,
    grants: data.grants,
    refusals: data.refusals,
    substantiveDecisions: substantive,
    totalDecisions: data.total,
    withdrawn: data.withdrawn,
    administrativeOutcomes: data.admin
  });
}

leagueTable.sort((a, b) => b.grantRatePct - a.grantRatePct);

// Top claimants by volume (all-time)
const volumeRanking = Object.entries(byNationality)
  .map(([nat, d]) => ({
    nationality: nat,
    region: d.region,
    totalDecisions: d.total,
    grants: d.grants,
    refusals: d.refusals,
    grantRatePct: (d.grants + d.refusals) > 0
      ? Math.round(d.grants / (d.grants + d.refusals) * 1000) / 10
      : null
  }))
  .filter(d => d.totalDecisions >= 100)
  .sort((a, b) => b.totalDecisions - a.totalDecisions);

// Time series for top 15 nationalities by recent volume
const topNationalities = volumeRanking
  .filter(d => byNationalityRecent[d.nationality]?.total >= 200)
  .slice(0, 15)
  .map(d => d.nationality);

const timeSeries = {};
for (const nat of topNationalities) {
  timeSeries[nat] = {};
  for (let y = 2015; y <= 2025; y++) {
    const yk = `${nat}|${y}`;
    const d = byNationalityYear[yk];
    if (d && d.total > 0) {
      const sub = d.grants + d.refusals;
      timeSeries[nat][y] = {
        total: d.total,
        grants: d.grants,
        refusals: d.refusals,
        grantRatePct: sub > 0 ? Math.round(d.grants / sub * 1000) / 10 : null
      };
    }
  }
}

// Overall annual grant rates
const annualOverall = {};
for (const [y, d] of Object.entries(byYearAll)) {
  const sub = d.grants + d.refusals;
  annualOverall[y] = {
    total: d.total,
    grants: d.grants,
    refusals: d.refusals,
    grantRatePct: sub > 0 ? Math.round(d.grants / sub * 1000) / 10 : null
  };
}

// Summary stats
const highest = leagueTable[0];
const lowest = leagueTable[leagueTable.length - 1];
const genuineRefugees = leagueTable.filter(d => d.grantRatePct >= 75);
const likelyEconomic = leagueTable.filter(d => d.grantRatePct < 25);

const output = {
  generatedAt: new Date().toISOString(),
  source: "Home Office Immigration Statistics: Asylum initial decisions (Asy_D02), Dec 2025 release",
  methodology: "Grant rate = (grants of protection + grants of other leave) / (grants + refusals) × 100. Excludes withdrawn cases and administrative outcomes from denominator (substantive decisions only). Recent period = 2020-2025. Minimum 50 substantive decisions for league table inclusion. 'Refugee' and 'Stateless person' status entries excluded as they are not nationalities.",
  caveats: [
    "These are INITIAL decision grant rates only. Many refusals are overturned on appeal — the true grant rate (after appeals) is significantly higher for some nationalities. For example, Iranian initial grant rate ~72% rises to ~85% after successful appeals.",
    "Grant rate measures what proportion of substantive decisions are positive. It does not account for withdrawn cases or administrative outcomes, which can represent a large share of total decisions for some nationalities.",
    "Post-2009 data is fully disaggregated by age, sex, applicant type, and UASC status. All rows are summed to produce totals — there are no subtotal rows in the source data.",
    "Dependant applicants are included alongside main applicants. Dependants generally receive the same outcome as the main applicant."
  ],
  summary: {
    nationalitiesInLeagueTable: leagueTable.length,
    highestGrantRate: { nationality: highest?.nationality, rate: highest?.grantRatePct, decisions: highest?.substantiveDecisions },
    lowestGrantRate: { nationality: lowest?.nationality, rate: lowest?.grantRatePct, decisions: lowest?.substantiveDecisions },
    genuineRefugeeNationalities: genuineRefugees.length,
    likelyEconomicMigrationNationalities: likelyEconomic.length,
    topClaimantAllTime: volumeRanking[0]?.nationality,
    topClaimantRecentVolume: leagueTable.sort((a, b) => b.substantiveDecisions - a.substantiveDecisions)[0]?.nationality
  },
  leagueTable: leagueTable.sort((a, b) => b.grantRatePct - a.grantRatePct),
  volumeRanking: volumeRanking.slice(0, 50),
  timeSeries,
  annualOverall
};

// ── ASY_D04: Outcome Analysis — Initial + Appeal (True Grant Rate) ──
const OUTCOME_SOURCE = path.resolve("data/raw/uk_routes/outcome-analysis-asylum-claims-datasets-dec-2025.xlsx");
console.log("\n\n=== OUTCOME ANALYSIS (Asy_D04): True Grant Rates ===");
console.log(`Reading ${OUTCOME_SOURCE}...`);

try {
  const wbOutcome = xlsx.readFile(OUTCOME_SOURCE, { raw: false });
  const wsOutcome = wbOutcome.Sheets["Data_Asy_D04"];
  const outcomeRows = xlsx.utils.sheet_to_json(wsOutcome, { header: 1, raw: false, defval: "" });
  console.log(`  ${outcomeRows.length} rows`);

  // Row 0 is title, row 1 is headers
  // Columns: Year of Claim, Region, Nationality, Claims,
  //   Initial Decisions, Initial: Grants of Protection, Initial: Grants of Other Leave,
  //   Initial: Refusals, Initial: Withdrawals, Initial: Administrative Outcomes, Initial: Not yet known,
  //   Enforced Returns, Voluntary Returns, ...,
  //   Latest: Grants of Protection, Latest: Grants of Other Leave,
  //   Latest: Refusals, Latest: Withdrawals, Latest: Administrative Outcomes, Latest: Not yet known

  // Aggregate by nationality (recent claim years 2020-2024 for stable latest outcomes)
  const outcomeByNat = {};
  for (let i = 2; i < outcomeRows.length; i++) {
    const row = outcomeRows[i];
    const year = parseInt(row[0]);
    const nationality = String(row[2] || "").trim();
    if (!year || !nationality) continue;
    if (nationality === "Total" || nationality.startsWith("Total ") || nationality === "Other" || nationality === "Refugee" || nationality === "Stateless person") continue;
    if (nationality.includes("(excluding")) continue;

    // Use claims from 2015-2023 (older claims have more settled outcomes)
    if (year < 2015 || year > 2023) continue;

    const claims = safeInt(row[3]);
    const initialDecisions = safeInt(row[4]);
    const initialGrantsProt = safeInt(row[5]);
    const initialGrantsOther = safeInt(row[6]);
    const initialRefusals = safeInt(row[7]);
    const initialWithdrawn = safeInt(row[8]);
    const latestGrantsProt = safeInt(row[16]);
    const latestGrantsOther = safeInt(row[17]);
    const latestRefusals = safeInt(row[18]);
    const latestWithdrawn = safeInt(row[19]);
    const latestAdmin = safeInt(row[20]);
    const latestNotYetKnown = safeInt(row[21]);

    if (!outcomeByNat[nationality]) {
      outcomeByNat[nationality] = {
        claims: 0, initialDecisions: 0,
        initialGrants: 0, initialRefusals: 0, initialWithdrawn: 0,
        latestGrants: 0, latestRefusals: 0, latestWithdrawn: 0,
        latestNotYetKnown: 0
      };
    }
    const d = outcomeByNat[nationality];
    d.claims += claims;
    d.initialDecisions += initialDecisions;
    d.initialGrants += initialGrantsProt + initialGrantsOther;
    d.initialRefusals += initialRefusals;
    d.initialWithdrawn += initialWithdrawn;
    d.latestGrants += latestGrantsProt + latestGrantsOther;
    d.latestRefusals += latestRefusals;
    d.latestWithdrawn += latestWithdrawn;
    d.latestNotYetKnown += latestNotYetKnown;
  }

  // Compute true grant rates and merge into league table
  const trueGrantRates = {};
  for (const [nat, d] of Object.entries(outcomeByNat)) {
    const initialSub = d.initialGrants + d.initialRefusals;
    const latestSub = d.latestGrants + d.latestRefusals;
    if (latestSub < 50) continue;

    const initialRate = initialSub > 0 ? Math.round(d.initialGrants / initialSub * 1000) / 10 : null;
    const latestRate = Math.round(d.latestGrants / latestSub * 1000) / 10;
    const appealUplift = (initialRate !== null) ? Math.round((latestRate - initialRate) * 10) / 10 : null;

    trueGrantRates[nat] = {
      claims: d.claims,
      initialGrantRatePct: initialRate,
      trueGrantRatePct: latestRate,
      appealUpliftPp: appealUplift,
      latestGrants: d.latestGrants,
      latestRefusals: d.latestRefusals,
      latestSubstantive: latestSub,
      latestNotYetKnown: d.latestNotYetKnown,
      pctResolved: Math.round((1 - d.latestNotYetKnown / Math.max(d.claims, 1)) * 1000) / 10
    };
  }

  // Merge true grant rates into league table entries
  for (const entry of output.leagueTable) {
    const tgr = trueGrantRates[entry.nationality];
    if (tgr) {
      entry.trueGrantRatePct = tgr.trueGrantRatePct;
      entry.appealUpliftPp = tgr.appealUpliftPp;
      entry.latestGrants = tgr.latestGrants;
      entry.latestRefusals = tgr.latestRefusals;
      entry.latestSubstantive = tgr.latestSubstantive;
      entry.pctResolved = tgr.pctResolved;
    }
  }

  // Add outcome analysis metadata to output
  output.outcomeAnalysis = {
    source: "Home Office Immigration Statistics: Outcome analysis (Asy_D04), Dec 2025 release",
    claimYears: "2015-2023",
    methodology: "True grant rate = (latest grants of protection + other leave) / (latest grants + latest refusals) × 100. 'Latest' outcome includes appeal results and all subsequent decisions. Claim years 2015-2023 used so most cases have settled outcomes.",
    nationalitiesWithTrueRate: Object.keys(trueGrantRates).length,
    trueGrantRates
  };

  // Print biggest appeal uplifts
  const bigUplift = Object.entries(trueGrantRates)
    .filter(([, d]) => d.appealUpliftPp !== null && d.latestSubstantive >= 200)
    .sort(([, a], [, b]) => b.appealUpliftPp - a.appealUpliftPp);

  console.log(`\nTrue grant rates computed for ${Object.keys(trueGrantRates).length} nationalities`);
  console.log(`\nBiggest appeal uplifts (≥200 decisions):`);
  for (const [nat, d] of bigUplift.slice(0, 15)) {
    console.log(`  ${nat}: ${d.initialGrantRatePct}% → ${d.trueGrantRatePct}% (+${d.appealUpliftPp}pp)`);
  }

  // Summary stats
  const withUplift = bigUplift.filter(([, d]) => d.appealUpliftPp > 0);
  const avgUplift = withUplift.length > 0
    ? Math.round(withUplift.reduce((s, [, d]) => s + d.appealUpliftPp, 0) / withUplift.length * 10) / 10
    : 0;
  console.log(`\n${withUplift.length} nationalities see appeal uplift (avg +${avgUplift}pp)`);

  output.summary.avgAppealUpliftPp = avgUplift;
  output.summary.nationalitiesWithAppealData = Object.keys(trueGrantRates).length;

} catch (err) {
  console.log(`  Warning: Could not read outcome analysis file: ${err.message}`);
  console.log("  Continuing without true grant rates.");
}

writeFileSync(OUTPUT, JSON.stringify(output, null, 2), "utf8");

// Print summary
console.log(`\nGrant Rate League Table (2020-2025)`);
console.log(`====================================`);
console.log(`Nationalities with 50+ decisions: ${leagueTable.length}`);
console.log(`\nHighest grant rates (genuine refugees):`);
for (const d of leagueTable.sort((a, b) => b.grantRatePct - a.grantRatePct).slice(0, 15)) {
  console.log(`  ${d.nationality}: ${d.grantRatePct}% (${d.grants}/${d.substantiveDecisions})`);
}
console.log(`\nLowest grant rates (likely economic migration):`);
for (const d of leagueTable.sort((a, b) => a.grantRatePct - b.grantRatePct).slice(0, 15)) {
  console.log(`  ${d.nationality}: ${d.grantRatePct}% (${d.grants}/${d.substantiveDecisions})`);
}
console.log(`\nTop claimants by volume (all-time):`);
for (const d of volumeRanking.slice(0, 10)) {
  console.log(`  ${d.nationality}: ${d.totalDecisions.toLocaleString()} decisions (${d.grantRatePct}% granted)`);
}
console.log(`\n${genuineRefugees.length} nationalities with 75%+ grant rate (genuine refugees)`);
console.log(`${likelyEconomic.length} nationalities with <25% grant rate (likely economic migration)`);
console.log(`\nOutput: ${OUTPUT}`);
