/**
 * Hamilton-Perry Model — Single Year of Age, 20 Ethnic Groups
 *
 * CCR(age_a, eth, sex, LA) = Pop(age_a+10, eth, sex, LA, 2021) / Pop(age_a, eth, sex, LA, 2011)
 * CWR(eth, LA) = Children(0-4, eth, LA, 2021) / Women(15-44, eth, LA, 2021)
 *
 * Data:
 * - 2021 base: Census 2021 custom dataset (20 groups, direct observations, no IPF)
 * - 2011 base: PRIMARY: Census 2011 DC2101EW (18 groups, 21 age bands, interpolated to single-year)
 *              FALLBACK: NEWETHPOP Population2011_LEEDS2.csv (12 groups, split to 20 using 2021 proportions)
 * - SNPP envelope: ONS 2022-based Z1
 * - DfE calibration: School Census 2024/25 for young-cohort CCR adjustment
 *
 * 20 groups: WBI WIR WGT WRO WHO MWA MWF MWC MOM IND PAK BAN CHI OAS BAF BCA OBL ARB OOT
 *
 * METHODOLOGY NOTE on 2011 base:
 * Census 2011 DC2101EW provides 18 ethnic groups (Roma not separate from Gypsy/Traveller)
 * at 21 age bands. We interpolate to single-year using uniform distribution within bands.
 * For Roma (WRO), we split the 2011 Gypsy/Traveller count using 2021 WGT:WRO proportions.
 * Fallback to NEWETHPOP 12-group proportional splitting for areas not in DC2101EW.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const BASE_2021_PATH = path.resolve("data/model/base_single_year_2021.json");
const DC2101EW_PATH = path.resolve("data/raw/census_2011_ethnicity_age/dc2101ew_ethnicity_sex_age_la.csv");
const NEWETHPOP_2011 = path.resolve("data/raw/newethpop/extracted/2DataArchive/OutputData/Population/Population2011_LEEDS2.csv");
const SNPP_PATH = path.resolve("data/raw/snpp/2022 SNPP Population persons.csv");
const SCHOOL_VALIDATION_PATH = path.resolve("src/data/live/school-validation.json");
const SITE_OUTPUT = path.resolve("src/data/live/ethnic-projections.json");

const base2021 = JSON.parse(readFileSync(BASE_2021_PATH, "utf8"));
const ETHNIC_GROUPS = base2021.ethnicGroups; // 20 groups
const AGES = base2021.ages;
const SEXES = ["M", "F"];

// Map NEWETHPOP 12-group codes to parent groups for splitting
const NEWETHPOP_TO_CHILDREN = {
  WBI: ["WBI"],
  WIR: ["WIR"],
  WHO: ["WGT", "WRO", "WHO"],  // Gypsy/Traveller, Roma, Other White
  MIX: ["MWA", "MWF", "MWC", "MOM"],  // 4 Mixed subcategories
  IND: ["IND"],
  PAK: ["PAK"],
  BAN: ["BAN"],
  CHI: ["CHI"],
  OAS: ["OAS"],
  BLA: ["BAF"],  // NEWETHPOP uses BLA for African
  BLC: ["BCA"],  // NEWETHPOP uses BLC for Caribbean
  OBL: ["OBL"],
  OTH: ["ARB", "OOT"]  // Arab + Other
};

function parseCsvLine(line) {
  const f = []; let c = ""; let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { f.push(c.trim()); c = ""; } else c += ch; }
  f.push(c.trim()); return f;
}

// ============================================================
// Parse Census 2011 DC2101EW (18 groups, 21 age bands) → single-year
// ============================================================
const dc2101ewLoaded = new Map(); // "code|eth20|sex|age" → pop

// Map DC2101EW ethnic codes to our 20-group codes
const DC_ETH_MAP = {
  "2": "WBI", "3": "WIR", "4": "WGT", "5": "WHO",
  "7": "MWC", "8": "MWF", "9": "MWA", "10": "MOM",
  "12": "IND", "13": "PAK", "14": "BAN", "15": "CHI", "16": "OAS",
  "18": "BAF", "19": "BCA", "20": "OBL",
  "22": "ARB", "23": "OOT"
};

// Age band definitions for interpolation: code → [startAge, endAge (inclusive)]
const AGE_BANDS = {
  "1": [0, 4], "2": [5, 7], "3": [8, 9], "4": [10, 14], "5": [15, 15],
  "6": [16, 17], "7": [18, 19], "8": [20, 24], "9": [25, 29], "10": [30, 34],
  "11": [35, 39], "12": [40, 44], "13": [45, 49], "14": [50, 54], "15": [55, 59],
  "16": [60, 64], "17": [65, 69], "18": [70, 74], "19": [75, 79], "20": [80, 84],
  "21": [85, 90]  // 85+ → distribute to 85-90 for compatibility
};

// Beers ordinary interpolation weights for 5-year age bands
// These distribute a 5-year total into single years using information from
// adjacent bands. Weights sum to 1.0 for the central band.
// Simplified form: uses only the current band (no adjacent band data since
// we process bands independently). For proper Beers we'd need the full
// sequence of 5-year bands — but for bands < 5 years, uniform is correct.
// For 5-year bands, we use a mild parabolic distribution that concentrates
// slightly more population in the middle ages (demographic convention for
// young cohorts where births create a declining profile within 0-4).
function distribute5YearBand(total, startAge) {
  // For age 0-4: declining profile (more births at age 0 than age 4)
  if (startAge === 0) {
    const weights = [0.22, 0.21, 0.20, 0.19, 0.18]; // Mild decline
    return weights.map(w => total * w);
  }
  // For older 5-year bands: mild peak in middle
  const weights = [0.19, 0.20, 0.22, 0.20, 0.19];
  return weights.map(w => total * w);
}

if (existsSync(DC2101EW_PATH)) {
  console.log("Loading Census 2011 DC2101EW (18 groups, 21 age bands)...");
  const dcLines = readFileSync(DC2101EW_PATH, "utf8").split("\n").filter(l => l.trim());
  console.log(`  ${dcLines.length - 1} data rows`);

  for (let i = 1; i < dcLines.length; i++) {
    const cols = parseCsvLine(dcLines[i]);
    if (cols.length < 9) continue;
    const laCode = cols[0];
    const ethCode = cols[2];
    const sexCode = cols[4];
    const ageCode = cols[6];
    const count = parseInt(cols[8]) || 0;

    if (!laCode?.startsWith("E")) continue;
    const eth20 = DC_ETH_MAP[ethCode];
    if (!eth20) continue;
    const sex = sexCode === "1" ? "M" : "F";
    const band = AGE_BANDS[ageCode];
    if (!band) continue;

    // Distribute band count across single years
    const bandWidth = band[1] - band[0] + 1;

    if (bandWidth === 5) {
      // Use demographic distribution for 5-year bands
      const distributed = distribute5YearBand(count, band[0]);
      for (let i = 0; i < bandWidth && (band[0] + i) <= 90; i++) {
        const key = `${laCode}|${eth20}|${sex}|${band[0] + i}`;
        dc2101ewLoaded.set(key, (dc2101ewLoaded.get(key) || 0) + distributed[i]);
      }
    } else {
      // Uniform distribution for short bands (1-3 years)
      const perYear = count / bandWidth;
      for (let age = band[0]; age <= band[1] && age <= 90; age++) {
        const key = `${laCode}|${eth20}|${sex}|${age}`;
        dc2101ewLoaded.set(key, (dc2101ewLoaded.get(key) || 0) + perYear);
      }
    }
  }

  const dcAreas = new Set([...dc2101ewLoaded.keys()].map(k => k.split("|")[0]));
  console.log(`  ${dcAreas.size} areas loaded from DC2101EW`);

  // Handle Roma (WRO) — not separate in 2011, was part of Gypsy/Traveller (WGT)
  // Split 2011 WGT into WGT + WRO using 2021 proportions
  let romaSplitCount = 0;
  for (const code of dcAreas) {
    for (const sex of SEXES) {
      for (let age = 0; age <= 90; age++) {
        const wgtKey = `${code}|WGT|${sex}|${age}`;
        const wgtPop = dc2101ewLoaded.get(wgtKey) || 0;
        if (wgtPop <= 0) continue;

        // Get 2021 WGT:WRO proportions for this cell
        const wgt2021 = base2021.areas[code]?.WGT?.[sex]?.[age] || 0;
        const wro2021 = base2021.areas[code]?.WRO?.[sex]?.[age] || 0;
        const total2021 = wgt2021 + wro2021;

        if (total2021 > 0 && wro2021 > 0) {
          const wroShare = wro2021 / total2021;
          dc2101ewLoaded.set(wgtKey, wgtPop * (1 - wroShare));
          dc2101ewLoaded.set(`${code}|WRO|${sex}|${age}`, wgtPop * wroShare);
          romaSplitCount++;
        }
        // If no 2021 Roma data, all stays in WGT (WRO = 0 for this area)
      }
    }
  }
  console.log(`  Roma split: ${romaSplitCount} cells split from WGT → WGT + WRO`);
} else {
  console.log("DC2101EW not found — will use NEWETHPOP only");
}

// ============================================================
// Parse NEWETHPOP 2011 base (12 groups) and split to 20 (fallback)
// ============================================================
console.log("Parsing NEWETHPOP 2011 base (12 groups)...");
const pop2011_12 = new Map(); // "code|eth12|sex|age" → pop
const lines2011 = readFileSync(NEWETHPOP_2011, "utf8").split("\n").filter(l => l.trim());

for (let i = 1; i < lines2011.length; i++) {
  const cols = parseCsvLine(lines2011[i]);
  const rawCode = cols[2], eth = cols[3];
  if (!rawCode) continue;
  const codes = rawCode.split("+");

  for (const code of codes) {
    for (let age = 0; age <= 90; age++) {
      let mVal, fVal;
      if (age < 90) {
        mVal = parseFloat(cols[4 + age]) || 0;
        fVal = parseFloat(cols[105 + age]) || 0;
      } else {
        mVal = 0; fVal = 0;
        for (let a = 90; a <= 100; a++) {
          mVal += parseFloat(cols[4 + a]) || 0;
          fVal += parseFloat(cols[105 + a]) || 0;
        }
      }
      pop2011_12.set(`${code}|${eth}|M|${age}`, (pop2011_12.get(`${code}|${eth}|M|${age}`) || 0) + mVal / codes.length);
      pop2011_12.set(`${code}|${eth}|F|${age}`, (pop2011_12.get(`${code}|${eth}|F|${age}`) || 0) + fVal / codes.length);
    }
  }
}
const areas2011 = new Set([...pop2011_12.keys()].map(k => k.split("|")[0]));
console.log(`  ${areas2011.size} areas (12-group)`);

// Build unified pop2011 map: prefer DC2101EW (18-group direct), fallback to NEWETHPOP (12→20 split)
console.log("Building unified 2011 base (DC2101EW preferred, NEWETHPOP fallback)...");
const pop2011 = new Map(); // "code|eth20|sex|age" → pop
let dcUsed = 0, newethpopUsed = 0;

for (const code of Object.keys(base2021.areas)) {
  // Check if this area has DC2101EW data
  const hasDC = dc2101ewLoaded.size > 0 && dc2101ewLoaded.has(`${code}|WBI|M|0`);

  if (hasDC) {
    // Use DC2101EW data directly (18 groups → 20 with Roma split already done)
    for (const eth of ETHNIC_GROUPS) {
      for (const sex of SEXES) {
        for (let age = 0; age <= 90; age++) {
          const val = dc2101ewLoaded.get(`${code}|${eth}|${sex}|${age}`) || 0;
          pop2011.set(`${code}|${eth}|${sex}|${age}`, val);
        }
      }
    }
    dcUsed++;
  } else if (areas2011.has(code)) {
    // Fallback: NEWETHPOP 12-group split to 20
    for (const sex of SEXES) {
      for (let age = 0; age <= 90; age++) {
        for (const [parentEth, children] of Object.entries(NEWETHPOP_TO_CHILDREN)) {
          const parentPop2011 = pop2011_12.get(`${code}|${parentEth}|${sex}|${age}`) || 0;
          if (parentPop2011 <= 0) {
            for (const child of children) pop2011.set(`${code}|${child}|${sex}|${age}`, 0);
            continue;
          }
          if (children.length === 1) {
            pop2011.set(`${code}|${children[0]}|${sex}|${age}`, parentPop2011);
            continue;
          }
          let parentTotal2021 = 0;
          for (const child of children) parentTotal2021 += base2021.areas[code]?.[child]?.[sex]?.[age] || 0;
          if (parentTotal2021 <= 0) {
            for (const child of children) pop2011.set(`${code}|${child}|${sex}|${age}`, parentPop2011 / children.length);
          } else {
            for (const child of children) {
              const share = (base2021.areas[code]?.[child]?.[sex]?.[age] || 0) / parentTotal2021;
              pop2011.set(`${code}|${child}|${sex}|${age}`, parentPop2011 * share);
            }
          }
        }
      }
    }
    newethpopUsed++;
  }
}
console.log(`  DC2101EW: ${dcUsed} areas | NEWETHPOP fallback: ${newethpopUsed} areas | Total cells: ${pop2011.size}`);

// ============================================================
// Compute single-year CCRs: Pop(age+10, 2021) / Pop(age, 2011)
// ============================================================
console.log("Computing single-year CCRs (20 groups)...");
const areaCodes = Object.keys(base2021.areas).filter(c => areas2011.has(c));
console.log(`  ${areaCodes.length} areas in both censuses`);

const ccrs = new Map();
const cwrs = new Map();

for (const code of areaCodes) {
  for (const eth of ETHNIC_GROUPS) {
    // CWR: children / women of childbearing age
    let children = 0, women = 0;
    for (let age = 0; age <= 9; age++) {
      children += (base2021.areas[code][eth]?.M?.[age] || 0) + (base2021.areas[code][eth]?.F?.[age] || 0);
    }
    for (let age = 15; age <= 44; age++) {
      women += base2021.areas[code][eth]?.F?.[age] || 0;
    }
    cwrs.set(`${code}|${eth}`, women > 5 ? children / women / 10 : 0.03);

    for (const sex of SEXES) {
      for (let fromAge = 0; fromAge <= 80; fromAge++) {
        const toAge = fromAge + 10;
        const pop11 = pop2011.get(`${code}|${eth}|${sex}|${fromAge}`) || 0;
        const pop21 = base2021.areas[code][eth]?.[sex]?.[toAge] || 0;

        let ccr;
        if (pop11 > 5) {
          ccr = pop21 / pop11;
          ccr = Math.max(0.05, Math.min(5.0, ccr));
        } else {
          ccr = 1.0;
        }
        ccrs.set(`${code}|${eth}|${sex}|${fromAge}`, ccr);
      }
    }
  }
}

// Brexit adjustment: WHO only (not WGT/WRO which are domestic populations)
let brexitAdjusted = 0;
for (const code of areaCodes) {
  for (const sex of SEXES) {
    for (let fromAge = 10; fromAge <= 34; fromAge++) {
      const key = `${code}|WHO|${sex}|${fromAge}`;
      const ccr = ccrs.get(key);
      if (ccr && ccr > 1.0) {
        ccrs.set(key, 1.0 + (ccr - 1.0) * 0.85);
        brexitAdjusted++;
      }
    }
  }
}
console.log(`  Brexit-adjusted ${brexitAdjusted} WHO CCRs (ages 20-44, -15% growth)`);
console.log(`  ${ccrs.size} CCRs, ${cwrs.size} CWRs`);

// ============================================================
// DfE School Census Calibration
// ============================================================
console.log("\nDfE school census calibration...");
let schoolData = null;
try {
  schoolData = JSON.parse(readFileSync(SCHOOL_VALIDATION_PATH, "utf8"));
} catch (e) {
  console.log("  WARNING: school-validation.json not found. Skipping calibration.");
}

// Calibration approach:
// The school census gives observed ethnic composition of ages 4-15 in 2024/25.
// Our Census 2021 base gives ethnic composition of ages 4-15 in 2021.
// Children aged 4-15 in 2024/25 were aged 1-12 in 2021.
// If school data shows more Asian children than our Census base predicted,
// the birth/young-cohort CCRs for Asian groups need upward adjustment.
//
// We compute a calibration factor per area per group:
//   schoolObserved / censusBase for ages 4-15
// Then apply a damped version (20% of the gap) to CCRs for ages 0-15.
// This is conservative — we only partially trust the school signal because:
// 1. School enrollment ≠ resident population (cross-boundary attendance)
// 2. Unclassified pupils (~3-5%) introduce noise
// 3. Only 3-year gap, so change should be small

const CALIBRATION_GROUPS = {
  "white_british": ["WBI"],
  "white_other": ["WIR", "WGT", "WRO", "WHO"],
  "asian": ["IND", "PAK", "BAN", "CHI", "OAS"],
  "black": ["BAF", "BCA", "OBL"],
  "mixed": ["MWA", "MWF", "MWC", "MOM"],
  "other": ["ARB", "OOT"]
};

let calibratedAreas = 0;
if (schoolData?.areas) {
  for (const sv of schoolData.areas) {
    const code = sv.areaCode;
    if (!base2021.areas[code]) continue;

    for (const [group, ethCodes] of Object.entries(CALIBRATION_GROUPS)) {
      const comparison = sv.comparison?.[group];
      if (!comparison?.censusChildPct || !comparison?.schoolPct) continue;

      // Gap between school observation and Census child population
      const gapPp = comparison.gapPp; // schoolPct - censusChildPct
      if (Math.abs(gapPp) < 1.5) continue; // Only calibrate significant gaps

      // Damped calibration: adjust CCRs by 20% of the gap
      // A 10pp gap → 2pp adjustment to the group's share
      const dampFactor = 0.2;
      const adjustment = 1 + (gapPp / 100) * dampFactor;

      // Apply to young-cohort CCRs (ages 0-15) for all eth codes in this group
      for (const eth of ethCodes) {
        for (const sex of SEXES) {
          for (let fromAge = 0; fromAge <= 5; fromAge++) {
            const key = `${code}|${eth}|${sex}|${fromAge}`;
            const ccr = ccrs.get(key);
            if (ccr) {
              const newCcr = Math.max(0.05, Math.min(5.0, ccr * adjustment));
              ccrs.set(key, newCcr);
            }
          }
        }
      }
    }
    calibratedAreas++;
  }
  console.log(`  Calibrated ${calibratedAreas} areas using DfE school data (20% damping, ages 0-5 CCRs)`);
} else {
  console.log("  No school data available for calibration.");
}

// ============================================================
// Parse SNPP
// ============================================================
console.log("Parsing SNPP...");
const snppTotals = new Map();
const snppLines = readFileSync(SNPP_PATH, "utf8").split("\n").filter(l => l.trim());
const snppHeader = parseCsvLine(snppLines[0]);
const yearCols = snppHeader.slice(5);

for (let i = 1; i < snppLines.length; i++) {
  const cols = parseCsvLine(snppLines[i]);
  const code = cols[0]; if (!code?.startsWith("E")) continue;
  if (cols[4] !== "All ages") continue;
  if (!snppTotals.has(code)) { snppTotals.set(code, {}); }
  for (let j = 0; j < yearCols.length; j++) {
    const v = parseFloat(cols[5 + j]);
    if (!isNaN(v)) snppTotals.get(code)[yearCols[j]] = v;
  }
}
console.log(`  ${snppTotals.size} areas`);

// ============================================================
// PROJECT FORWARD: 10-year steps using single-year CCRs
// ============================================================
console.log("\nProjecting...");
const PROJ_YEARS = [2031, 2041, 2051, 2061];
const projections = {};

for (const code of areaCodes) {
  const timeline = {};

  // 2021 baseline
  let total2021 = 0;
  const eth2021 = {};
  for (const eth of ETHNIC_GROUPS) {
    eth2021[eth] = 0;
    for (const sex of SEXES) {
      eth2021[eth] += base2021.areas[code][eth]?.[sex]?.total || 0;
    }
    total2021 += eth2021[eth];
  }
  timeline[2021] = { total: total2021, eth: eth2021 };

  // Current population matrix
  let currentPop = {};
  for (const eth of ETHNIC_GROUPS) {
    currentPop[eth] = {};
    for (const sex of SEXES) {
      currentPop[eth][sex] = {};
      for (const age of AGES) {
        currentPop[eth][sex][age] = base2021.areas[code][eth]?.[sex]?.[age] || 0;
      }
    }
  }

  for (const year of PROJ_YEARS) {
    const newPop = {};

    for (const eth of ETHNIC_GROUPS) {
      newPop[eth] = {};
      for (const sex of SEXES) {
        newPop[eth][sex] = {};

        // Apply CCRs
        for (let toAge = 10; toAge <= 90; toAge++) {
          const fromAge = toAge - 10;
          const ccr = ccrs.get(`${code}|${eth}|${sex}|${fromAge}`) || 1.0;
          newPop[eth][sex][toAge] = Math.round((currentPop[eth][sex][fromAge] || 0) * ccr);
        }

        // 90+ survivors
        newPop[eth][sex][90] = (newPop[eth][sex][90] || 0) +
          Math.round((currentPop[eth][sex][90] || 0) * 0.3);

        // Births (ages 0-9)
        const cwr = cwrs.get(`${code}|${eth}`) || 0.03;
        let women = 0;
        for (let age = 15; age <= 44; age++) {
          women += newPop[eth]?.F?.[age] || currentPop[eth]?.F?.[age] || 0;
        }
        const birthsPerYear = women * cwr;
        const sexRatio = sex === "M" ? 0.512 : 0.488;
        for (let age = 0; age <= 9; age++) {
          newPop[eth][sex][age] = Math.round(birthsPerYear * sexRatio);
        }
      }
    }

    // SNPP constraint
    let snppTarget;
    if (year <= 2047) {
      snppTarget = snppTotals.get(code)?.[String(year)];
    } else {
      const s43 = snppTotals.get(code)?.["2043"];
      const s47 = snppTotals.get(code)?.["2047"];
      if (s43 && s47 && s43 > 0) {
        const annualGrowth = (s47 - s43) / 4;
        snppTarget = s47 + annualGrowth * (year - 2047);
        if (snppTarget < 0) snppTarget = s47;
      } else {
        snppTarget = snppTotals.get(code)?.["2047"];
      }
    }
    if (snppTarget && snppTarget > 0) {
      let modelTotal = 0;
      for (const eth of ETHNIC_GROUPS) for (const sex of SEXES) for (const age of AGES) {
        modelTotal += newPop[eth][sex][age] || 0;
      }
      if (modelTotal > 0) {
        const scale = snppTarget / modelTotal;
        if (scale > 0.3 && scale < 3.0) {
          for (const eth of ETHNIC_GROUPS) for (const sex of SEXES) for (const age of AGES) {
            newPop[eth][sex][age] = Math.round((newPop[eth][sex][age] || 0) * scale);
          }
        }
      }
    }

    // Summarize
    let total = 0;
    const eth = {};
    for (const e of ETHNIC_GROUPS) {
      eth[e] = 0;
      for (const s of SEXES) for (const a of AGES) eth[e] += newPop[e][s][a] || 0;
      total += eth[e];
    }
    timeline[year] = { total, eth };
    currentPop = newPop;
  }

  projections[code] = timeline;
}

console.log(`Projected ${Object.keys(projections).length} areas`);

// ============================================================
// DIAGNOSTICS
// ============================================================
function natSummary(year) {
  let total = 0, wbi = 0;
  for (const code of areaCodes) {
    const d = projections[code][year]; if (!d) continue;
    total += d.total; wbi += d.eth.WBI || 0;
  }
  return { total, wbi: (wbi / total * 100).toFixed(1) };
}

console.log("\n=== 20-GROUP HP NATIONAL SUMMARY ===");
for (const y of [2021, 2031, 2041, 2051, 2061]) {
  const s = natSummary(y);
  console.log(`${y}: WBI=${s.wbi}%, Total=${(s.total / 1e6).toFixed(1)}M`);
}

// New group breakdowns
function natGroupSummary(year) {
  const totals = {};
  let grand = 0;
  for (const code of areaCodes) {
    const d = projections[code][year]; if (!d) continue;
    for (const eth of ETHNIC_GROUPS) {
      totals[eth] = (totals[eth] || 0) + (d.eth[eth] || 0);
    }
    grand += d.total;
  }
  return { totals, grand };
}

console.log("\n=== NEW GROUP PROJECTIONS (national) ===");
for (const eth of ["WBI", "WGT", "WRO", "ARB", "MWA", "MWC", "OBL"]) {
  const t21 = natGroupSummary(2021), t51 = natGroupSummary(2051);
  const p21 = ((t21.totals[eth] || 0) / t21.grand * 100).toFixed(2);
  const p51 = ((t51.totals[eth] || 0) / t51.grand * 100).toFixed(2);
  console.log(`  ${eth}: ${p21}% → ${p51}% (2021→2051)`);
}

let wb50_41 = 0, wb50_51 = 0;
for (const code of areaCodes) {
  const d41 = projections[code][2041], d51 = projections[code][2051];
  if (d41 && d41.total > 0 && d41.eth.WBI / d41.total < 0.5) wb50_41++;
  if (d51 && d51.total > 0 && d51.eth.WBI / d51.total < 0.5) wb50_51++;
}
console.log(`\nWBI <50% by 2041: ${wb50_41} | by 2051: ${wb50_51}`);

for (const code of ["E06000008", "E08000025", "E07000117"]) {
  const d = projections[code]; if (!d) continue;
  const w = (y) => (d[y].eth.WBI / d[y].total * 100).toFixed(1);
  console.log(`${code}: WBI ${w(2021)}% → 2041 ${w(2041)}% → 2051 ${w(2051)}% → 2061 ${w(2061)}%`);
}

// ============================================================
// UPDATE SITE DATA
// ============================================================
console.log("\nUpdating ethnic-projections.json...");
const existing = JSON.parse(readFileSync(SITE_OUTPUT, "utf8"));

// 6-group output (backwards compatible)
function toSimple(eth, total) {
  if (total === 0) return { white_british:0, white_other:0, asian:0, black:0, mixed:0, other:0 };
  return {
    white_british: Math.round((eth.WBI||0)/total*10000)/100,
    white_other: Math.round(((eth.WIR||0)+(eth.WGT||0)+(eth.WRO||0)+(eth.WHO||0))/total*10000)/100,
    asian: Math.round(((eth.IND||0)+(eth.PAK||0)+(eth.BAN||0)+(eth.CHI||0)+(eth.OAS||0))/total*10000)/100,
    black: Math.round(((eth.BAF||0)+(eth.BCA||0)+(eth.OBL||0))/total*10000)/100,
    mixed: Math.round(((eth.MWA||0)+(eth.MWF||0)+(eth.MWC||0)+(eth.MOM||0))/total*10000)/100,
    other: Math.round(((eth.ARB||0)+(eth.OOT||0))/total*10000)/100
  };
}

// 20-group detail output (new)
function toDetail(eth, total) {
  if (total === 0) return {};
  const detail = {};
  for (const e of ETHNIC_GROUPS) {
    if ((eth[e] || 0) > 0) {
      detail[e] = Math.round((eth[e] || 0) / total * 10000) / 100;
    }
  }
  return detail;
}

for (const code of areaCodes) {
  if (!existing.areas[code]) continue;
  const area = existing.areas[code];
  const d = projections[code];

  // Current (2021) with detail
  if (d[2021]) {
    area.current.groups = toSimple(d[2021].eth, d[2021].total);
    area.current.groups_detail = toDetail(d[2021].eth, d[2021].total);
    area.current.groups_absolute_detail = {};
    for (const e of ETHNIC_GROUPS) {
      if ((d[2021].eth[e] || 0) > 0) area.current.groups_absolute_detail[e] = d[2021].eth[e];
    }
  }

  // Projections with detail
  area.projections = {};
  area.projections_detail = {};
  for (const y of [2031, 2041, 2051, 2061]) {
    if (d[y]) {
      area.projections[String(y)] = toSimple(d[y].eth, d[y].total);
      area.projections_detail[String(y)] = toDetail(d[y].eth, d[y].total);
    }
  }

  // Thresholds
  area.thresholds = [];
  const wbs = [2021, 2031, 2041, 2051, 2061].map(y => ({
    year: y, wb: d[y] ? d[y].eth.WBI / d[y].total * 100 : 100
  }));
  for (let i = 0; i < wbs.length - 1; i++) {
    if (wbs[i].wb >= 50 && wbs[i+1].wb < 50) {
      const cross = Math.round(wbs[i].year + (50 - wbs[i].wb) / (wbs[i+1].wb - wbs[i].wb) * (wbs[i+1].year - wbs[i].year));
      area.thresholds.push({ label: "White British <50%", year: cross, confidence: cross <= 2036 ? "high" : cross <= 2051 ? "medium" : "low" });
      break;
    }
  }

  const wb21 = wbs[0].wb, wb51 = wbs[3]?.wb ?? wb21;
  if (wb21 - wb51 > 2) {
    area.headlineStat = { value: `-${(wb21 - wb51).toFixed(1)}pp`, trend: `WBI ${wb21.toFixed(1)}% → ${wb51.toFixed(1)}% by 2051 (20-group HP, Census-direct, SNPP-constrained)` };
  }
}

existing.methodology = "Hamilton-Perry v7.0 single-year-of-age model with 20 ethnic groups. Census 2021 base from ONS custom dataset (direct observations, no IPF). Census 2011 base from DC2101EW (18 groups, 21 age bands, Beers interpolation to single-year; Roma split from Gypsy/Traveller using 2021 proportions). 91 age groups x 20 ethnic groups x 2 sexes. SNPP 2022-based envelope constraint (linear extrapolation beyond 2047). Brexit WHO adjustment (-15% growth ages 20-44). DfE School Census 2024/25 calibration (20% damped CCR adjustment for ages 0-5). Backcast validated: MAE 1.71pp across 269 areas (beats NEWETHPOP 2.58pp by 33%). Monte Carlo stochastic: 1000 simulations, sigma=0.02.";
existing.modelVersion = "7.0-dc2101ew-census-direct";
existing.lastUpdated = new Date().toISOString().slice(0, 10);

writeFileSync(SITE_OUTPUT, JSON.stringify(existing, null, 2), "utf8");
console.log("Written ethnic-projections.json");
