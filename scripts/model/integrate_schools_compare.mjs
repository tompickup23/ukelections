/**
 * Integrate DfE school ethnicity + build compare tool data + impact modelling
 *
 * 5: DfE School Census 2024/25 ethnicity by LA — observed annual data
 * 6: Compare data structure — pre-computed comparison metrics
 * 8: Impact modelling — school place demand, housing demand projections
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DFE_CSV = "/tmp/data/spc_pupils_ethnicity_and_language.csv";
const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");
const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

// ============================================================
// 5: DfE SCHOOL ETHNICITY
// ============================================================
console.log("5: Parsing DfE school ethnicity...");
const csv = readFileSync(DFE_CSV, "utf8");
const lines = csv.split("\n").filter(l => l.trim());

const ethMap = {
  "White - White British": "White British",
  "White - Irish": "White Other",
  "White - Gypsy/Roma": "White Other",
  "White - Traveller of Irish heritage": "White Other",
  "White - Any other White background": "White Other",
  "Asian - Bangladeshi": "Asian", "Asian - Indian": "Asian",
  "Asian - Pakistani": "Asian", "Asian - Chinese": "Asian",
  "Asian - Any other Asian background": "Asian",
  "Black - Black African": "Black", "Black - Black Caribbean": "Black",
  "Black - Any other Black background": "Black",
  "Mixed - White and Asian": "Mixed", "Mixed - White and Black African": "Mixed",
  "Mixed - White and Black Caribbean": "Mixed", "Mixed - Any other Mixed background": "Mixed",
  "Any other ethnic group": "Other"
};

const schoolData = {};
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(",");
  if (cols[0] !== "202425" || cols[2] !== "Local authority") continue;
  if (cols[10] !== "Total") continue;

  const laCode = cols[9];
  const ethnicity = cols[11];
  const headcount = parseInt(cols[13]) || 0;
  const group = ethMap[ethnicity];
  if (!group || !laCode.startsWith("E")) continue;

  if (!schoolData[laCode]) schoolData[laCode] = { total: 0, groups: {} };
  schoolData[laCode].groups[group] = (schoolData[laCode].groups[group] || 0) + headcount;
  schoolData[laCode].total += headcount;
}

let schoolCount = 0;
for (const [code, area] of Object.entries(existing.areas)) {
  const school = schoolData[code];
  if (!school || school.total < 100) continue;

  area.schoolEthnicity = {
    year: "2024/25",
    totalPupils: school.total,
    groups: {}
  };
  for (const [g, c] of Object.entries(school.groups)) {
    area.schoolEthnicity.groups[g] = Math.round(c / school.total * 1000) / 10;
  }

  // Compare school vs general population WBI %
  const schoolWBI = area.schoolEthnicity.groups["White British"] || 0;
  const popWBI = area.current?.groups?.white_british || 0;
  area.schoolEthnicity.wbiGap = Math.round((popWBI - schoolWBI) * 10) / 10;
  area.schoolEthnicity.insight = schoolWBI < popWBI - 5
    ? `Schools are ${Math.round(popWBI - schoolWBI)}pp more diverse than the general population — schools show the future.`
    : `School and population ethnic composition are closely aligned.`;

  schoolCount++;
}

// National summary
let natPupils = 0, natWBI = 0;
for (const d of Object.values(schoolData)) {
  natPupils += d.total;
  natWBI += d.groups["White British"] || 0;
}
console.log(`  ${schoolCount} areas with school ethnicity`);
console.log(`  National: ${natPupils.toLocaleString()} pupils, ${(natWBI/natPupils*100).toFixed(1)}% White British`);

// ============================================================
// 8: IMPACT MODELLING
// ============================================================
console.log("\n8: Impact modelling...");

for (const [code, area] of Object.entries(existing.areas)) {
  if (!area.projections?.["2041"] || !area.current) continue;

  const pop2021 = area.current.total_population || 0;
  const wb2021 = area.current.groups?.white_british || 0;
  const wb2041 = area.projections["2041"]?.white_british || wb2021;
  const wb2051 = area.projections["2051"]?.white_british || wb2021;

  // School place demand: if school-age cohort is more diverse than general pop,
  // future school demand will require more EAL support, interpreter services
  const schoolWBI = area.schoolEthnicity?.groups?.["White British"] || wb2021;
  const ealDemandGrowth = Math.max(0, (100 - schoolWBI) - (100 - wb2021));

  // Housing demand: faster-growing minority populations need more housing
  const popGrowthPct = area.nativity?.[2051]
    ? (area.nativity[2051].foreignBornPct - (area.nativity[2021]?.foreignBornPct || 0))
    : 0;

  // Interpreter demand: based on English proficiency gap
  const nonEnglishPct = area.englishProficiency
    ? (100 - area.englishProficiency.mainLanguageEnglishPct)
    : 0;

  area.impactProjections = {
    schoolDiversity: {
      currentMinorityPupilsPct: Math.round((100 - schoolWBI) * 10) / 10,
      projectedMinorityPupils2041Pct: Math.round((100 - (wb2041 * 0.9)) * 10) / 10, // Schools diversify faster
      ealDemandGrowthPp: Math.round(ealDemandGrowth * 10) / 10,
      implication: ealDemandGrowth > 10
        ? "Significant additional EAL (English as Additional Language) support likely needed."
        : "EAL demand growth is moderate."
    },
    housingDemand: {
      foreignBornGrowthPp: Math.round(popGrowthPct * 10) / 10,
      implication: popGrowthPct > 15
        ? "High foreign-born population growth will drive additional housing demand, particularly in the private rented sector."
        : "Housing demand growth from demographic change is moderate."
    },
    interpreterDemand: {
      currentNonEnglishPct: Math.round(nonEnglishPct * 10) / 10,
      implication: nonEnglishPct > 15
        ? "NHS and council services will need increased interpreter/translation provision."
        : "Interpreter demand is manageable at current levels."
    }
  };
}
console.log("  Impact projections computed for all areas");

// ============================================================
// 6: COMPARE DATA (pre-computed rankings for compare tool)
// ============================================================
console.log("\n6: Building compare data...");

const rankings = {
  fastestWBDecline: [],
  highestMuslimGrowth: [],
  lowestSchoolWBI: [],
  highestForeignBorn: [],
  mostDiverse: [],
  highestPressure: []
};

for (const [code, area] of Object.entries(existing.areas)) {
  if (!area.current?.groups || !area.projections?.["2051"]) continue;

  const wbDecline = (area.current.groups.white_british || 0) - (area.projections["2051"]?.white_british || 0);
  const muslim2021 = area.religion?.[2021]?.Muslim || 0;
  const muslim2051 = area.religion?.[2051]?.Muslim || 0;
  const schoolWBI = area.schoolEthnicity?.groups?.["White British"] || 100;
  const foreignBorn = area.nativity?.[2021]?.foreignBornPct || 0;
  const entropy = area.diversityIndex?.entropy || 0;

  rankings.fastestWBDecline.push({ code, name: area.areaName, value: Math.round(wbDecline * 10) / 10 });
  rankings.highestMuslimGrowth.push({ code, name: area.areaName, value: Math.round((muslim2051 - muslim2021) * 10) / 10 });
  rankings.lowestSchoolWBI.push({ code, name: area.areaName, value: Math.round(schoolWBI * 10) / 10 });
  rankings.highestForeignBorn.push({ code, name: area.areaName, value: Math.round(foreignBorn * 10) / 10 });
  rankings.mostDiverse.push({ code, name: area.areaName, value: Math.round(entropy * 100) / 100 });
}

for (const key of Object.keys(rankings)) {
  if (key === "lowestSchoolWBI") {
    rankings[key] = rankings[key].sort((a, b) => a.value - b.value).slice(0, 20);
  } else {
    rankings[key] = rankings[key].sort((a, b) => b.value - a.value).slice(0, 20);
  }
}

// Store rankings in a separate compare data structure
existing.compareRankings = rankings;

// Update model version
existing.modelVersion = "7.0-full-platform";
existing.lastUpdated = new Date().toISOString().slice(0, 10);

writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");

// Spot checks
console.log("\nBurnley school ethnicity:");
const b = existing.areas["E07000117"];
if (b?.schoolEthnicity) {
  console.log(`  Total pupils: ${b.schoolEthnicity.totalPupils}`);
  console.log(`  WBI: ${b.schoolEthnicity.groups["White British"]}%`);
  console.log(`  Gap vs population: ${b.schoolEthnicity.wbiGap}pp`);
  console.log(`  ${b.schoolEthnicity.insight}`);
}
if (b?.impactProjections) {
  console.log(`  School minority 2041: ${b.impactProjections.schoolDiversity.projectedMinorityPupils2041Pct}%`);
}

console.log("\nTop 5 fastest WBI decline:");
for (const r of rankings.fastestWBDecline.slice(0, 5)) {
  console.log(`  ${r.name}: -${r.value}pp`);
}

console.log("\nDone.");
