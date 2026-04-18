/**
 * Integrate asylum nationality data with ethnic projections.
 *
 * Uses the nationality-to-ethnicity mapping (from TS022) to estimate
 * how asylum seeker inflows affect the ethnic composition of each LA.
 *
 * For each LA with asylum seekers on support:
 * 1. Get nationality breakdown of claimants (from HO data, national proportions)
 * 2. Map each nationality to Census ethnic groups using TS022 lookup
 * 3. Estimate the ethnic composition of the asylum population in that LA
 * 4. Compare with total population ethnic composition
 * 5. Compute the marginal effect on WBI% and other groups
 *
 * METHODOLOGY NOTE:
 * The HO publishes asylum support at LA level but NOT by nationality at LA level.
 * Nationality data is national-level only. We apply national nationality proportions
 * to each LA's asylum support count. This is a first-order approximation —
 * in reality, some nationalities are concentrated in specific dispersal areas.
 * The estimate is therefore indicative, not precise at individual LA level.
 *
 * Output: adds asylumEthnicImpact to ethnic-projections.json per area
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROJECTIONS_PATH = path.resolve("src/data/live/ethnic-projections.json");
const LOCAL_ROUTE_PATH = path.resolve("src/data/live/local-route-latest.json");
const NAT_ETH_PATH = path.resolve("data/model/nationality_ethnicity_lookup.json");
const GRANT_RATES_PATH = path.resolve("src/data/live/grant-rates-nationality.json");

const projections = JSON.parse(readFileSync(PROJECTIONS_PATH, "utf8"));
const localRoute = JSON.parse(readFileSync(LOCAL_ROUTE_PATH, "utf8"));
const natEthLookup = JSON.parse(readFileSync(NAT_ETH_PATH, "utf8"));
const grantRates = JSON.parse(readFileSync(GRANT_RATES_PATH, "utf8"));

// Build national nationality distribution from grant rate volume data
// Use recent claims by volume to approximate current nationality mix
const topNationalities = grantRates.volumeRanking
  .filter(d => d.totalDecisions > 500)
  .slice(0, 30);

const totalVolume = topNationalities.reduce((s, d) => s + d.totalDecisions, 0);
const nationalityDistribution = {};
for (const d of topNationalities) {
  nationalityDistribution[d.nationality] = {
    share: d.totalDecisions / totalVolume,
    grantRatePct: d.grantRatePct,
    volume: d.totalDecisions
  };
}

console.log(`Nationality distribution: ${Object.keys(nationalityDistribution).length} nationalities`);

// Map nationality mix to ethnic composition
const asylumEthnicMix = {};
for (const [nat, info] of Object.entries(nationalityDistribution)) {
  const ethLookup = natEthLookup[nat];
  if (!ethLookup) continue;

  for (const [group, pct] of Object.entries(ethLookup.distribution)) {
    asylumEthnicMix[group] = (asylumEthnicMix[group] || 0) + info.share * pct / 100;
  }
}

// Normalize to 100%
const mixTotal = Object.values(asylumEthnicMix).reduce((s, v) => s + v, 0);
for (const g of Object.keys(asylumEthnicMix)) {
  asylumEthnicMix[g] = Math.round(asylumEthnicMix[g] / mixTotal * 1000) / 10;
}

console.log("Estimated ethnic composition of asylum population:");
for (const [g, pct] of Object.entries(asylumEthnicMix).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${g}: ${pct}%`);
}

// For each LA with asylum seekers, compute the marginal ethnic impact
let updatedAreas = 0;
for (const area of localRoute.areas) {
  const code = area.areaCode;
  const proj = projections.areas[code];
  if (!proj || !area.supportedAsylum || area.supportedAsylum < 10) continue;

  const totalPop = proj.current?.total_population || area.population || 0;
  if (totalPop < 1000) continue;

  const asylumCount = area.supportedAsylum;
  const asylumSharePct = Math.round(asylumCount / totalPop * 10000) / 100;

  // Estimate ethnic composition of asylum seekers in this LA
  // Using national proportions (limitation noted in methodology)
  const asylumEthInLA = {};
  for (const [group, pct] of Object.entries(asylumEthnicMix)) {
    asylumEthInLA[group] = Math.round(asylumCount * pct / 100);
  }

  // Compute marginal WBI% impact
  // If asylum seekers are X% of population, and 0% are WBI,
  // then WBI% is diluted by: currentWBI * (1 - asylumShare/100)
  const currentWBI = proj.current?.groups?.white_british || 0;
  const wbiWithoutAsylum = currentWBI * totalPop / (totalPop - asylumCount);
  const wbiDilution = Math.round((currentWBI - wbiWithoutAsylum) * 100) / 100;

  // Compute which ethnic groups asylum seekers disproportionately add to
  const groupImpact = {};
  const currentGroups = proj.current?.groups || {};
  for (const [group, asylumPct] of Object.entries(asylumEthnicMix)) {
    const currentPct = currentGroups[group] || 0;
    const asylumContribution = asylumPct * asylumSharePct / 100;
    groupImpact[group] = {
      asylumCompositionPct: asylumPct,
      marginalContributionPp: Math.round(asylumContribution * 100) / 100,
      currentPopPct: currentPct,
      overRepresentationFactor: currentPct > 0
        ? Math.round(asylumPct / currentPct * 100) / 100
        : null
    };
  }

  proj.asylumEthnicImpact = {
    supportedAsylum: asylumCount,
    asylumShareOfPopPct: asylumSharePct,
    estimatedAsylumEthnicMix: asylumEthnicMix,
    wbiDilutionPp: wbiDilution,
    groupImpact,
    methodology: "National asylum nationality proportions applied to local asylum support count. Nationality mapped to Census ethnic groups via TS022. Indicative only — nationality×LA breakdown not published by Home Office."
  };

  updatedAreas++;
}

console.log(`\nUpdated ${updatedAreas} areas with asylum ethnic impact data`);

// Top 10 areas by WBI dilution from asylum
const topDilution = Object.entries(projections.areas)
  .filter(([c, a]) => a.asylumEthnicImpact)
  .map(([c, a]) => ({ name: a.areaName, code: c, ...a.asylumEthnicImpact }))
  .sort((a, b) => a.wbiDilutionPp - b.wbiDilutionPp)
  .slice(0, 15);

console.log("\nTop 15 areas by WBI dilution from asylum:");
for (const a of topDilution) {
  console.log(`  ${a.name}: ${a.wbiDilutionPp}pp WBI dilution (${a.supportedAsylum} on support, ${a.asylumShareOfPopPct}% of pop)`);
}

writeFileSync(PROJECTIONS_PATH, JSON.stringify(projections, null, 2), "utf8");
console.log("\nUpdated ethnic-projections.json");
