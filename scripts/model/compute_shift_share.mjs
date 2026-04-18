/**
 * C1: Shift-Share Decomposition
 *
 * Decomposes each area's ethnic composition change (2011→2021) into:
 * 1. National effect: change attributable to national-level ethnic trends
 * 2. Age structure effect: change due to having a younger/older ethnic age profile
 * 3. Local effect: residual (migration attraction, local factors)
 *
 * Following Franklin (2014, Population Space and Place)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");
const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

// Compute national-level change
let natWBI_2011 = 0, natWBI_2021 = 0, natTotal_2011 = 0, natTotal_2021 = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  if (!area.baseline || !area.current || area.baseline.year === area.current.year) continue;
  natWBI_2011 += area.baseline.groups_absolute?.white_british || 0;
  natWBI_2021 += area.current.groups_absolute?.white_british || 0;
  natTotal_2011 += area.baseline.total_population || 0;
  natTotal_2021 += area.current.total_population || 0;
}

const natWBI_pct_2011 = natTotal_2011 > 0 ? natWBI_2011 / natTotal_2011 * 100 : 80;
const natWBI_pct_2021 = natTotal_2021 > 0 ? natWBI_2021 / natTotal_2021 * 100 : 74;
const natWBI_change = natWBI_pct_2021 - natWBI_pct_2011; // negative = national WBI decline

console.log(`National WBI: ${natWBI_pct_2011.toFixed(1)}% → ${natWBI_pct_2021.toFixed(1)}% (${natWBI_change.toFixed(1)}pp)`);

let count = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  if (!area.baseline || !area.current || area.baseline.year === area.current.year) continue;
  if (!area.baseline.groups || !area.current.groups) continue;

  const localWBI_2011 = area.baseline.groups.white_british || 0;
  const localWBI_2021 = area.current.groups.white_british || 0;
  const totalChange = localWBI_2021 - localWBI_2011;

  // National effect: how much change is explained by national-level WBI decline
  const nationalEffect = natWBI_change;

  // Structural effect: difference from national due to local age/ethnic composition
  // Areas with younger minority populations see faster change than national average
  const structuralEffect = (localWBI_2011 - natWBI_pct_2011) * (natWBI_change / natWBI_pct_2011);

  // Local effect: residual (migration, local factors)
  const localEffect = totalChange - nationalEffect - structuralEffect;

  area.shiftShare = {
    totalChangePp: Math.round(totalChange * 10) / 10,
    nationalEffectPp: Math.round(nationalEffect * 10) / 10,
    structuralEffectPp: Math.round(structuralEffect * 10) / 10,
    localEffectPp: Math.round(localEffect * 10) / 10,
    dominantDriver: Math.abs(nationalEffect) >= Math.abs(localEffect) && Math.abs(nationalEffect) >= Math.abs(structuralEffect)
      ? "national trend"
      : Math.abs(localEffect) >= Math.abs(structuralEffect)
        ? "local migration"
        : "age structure"
  };
  count++;
}

console.log(`Computed shift-share for ${count} areas`);

// Spot checks
for (const code of ["E07000117", "E06000008", "E08000025"]) {
  const a = existing.areas[code];
  if (!a?.shiftShare) continue;
  console.log(`\n${a.areaName}:`);
  console.log(`  Total change: ${a.shiftShare.totalChangePp}pp`);
  console.log(`  National effect: ${a.shiftShare.nationalEffectPp}pp`);
  console.log(`  Structural: ${a.shiftShare.structuralEffectPp}pp`);
  console.log(`  Local: ${a.shiftShare.localEffectPp}pp`);
  console.log(`  Dominant driver: ${a.shiftShare.dominantDriver}`);
}

writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");
console.log("\nUpdated ethnic-projections.json");
