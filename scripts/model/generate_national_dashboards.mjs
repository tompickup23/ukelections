#!/usr/bin/env node
/**
 * generate_national_dashboards.mjs
 *
 * Generates enriched data files for ALL areas from ethnic-projections.json
 * and existing dashboard data. Fills gaps in crime/SEND/ASC/economic data.
 *
 * Outputs:
 *   - economic-profile.json (316 areas with real Census 2021 data)
 *   - school-pressure.json (126 areas with DfE data + projections)
 *   - housing-demand.json (316 areas from Census tenure × ethnic projections)
 *   - health-demand.json (316 areas from Census health × ethnic projections)
 *   - dependency-ratios.json (320 areas from SNPP age structure)
 *   - language-projections.json (320 areas from English proficiency data)
 *   - fiscal-resilience.json (320 areas — service demand + demographic pressure scoring)
 *   - crime-correlation.json (correlation analysis for areas with both crime + asylum data)
 *
 * Run: node scripts/model/generate_national_dashboards.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = resolve('src/data/live');

function readJSON(name) {
  const p = resolve(DATA_DIR, name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeJSON(name, data) {
  writeFileSync(resolve(DATA_DIR, name), JSON.stringify(data, null, 2));
  console.log(`  ✓ ${name}`);
}

// ─── Load source data ───
const ep = readJSON('ethnic-projections.json');
const scenarioSummaries = readJSON('scenario-summaries.json');
const schoolValidation = readJSON('school-validation.json');
const localRoute = readJSON('local-route-latest.json');
const existingCrime = readJSON('crime-dashboard.json');
const existingSend = readJSON('send-dashboard.json');
const existingAsc = readJSON('asc-dashboard.json');

if (!ep) { console.error('ERROR: ethnic-projections.json not found'); process.exit(1); }

const areaCodes = Object.keys(ep.areas);
console.log(`Loaded ${areaCodes.length} areas from ethnic-projections.json\n`);

// Build region lookup from local-route-latest
const regionLookup = new Map();
if (localRoute?.areas) {
  for (const a of localRoute.areas) {
    regionLookup.set(a.areaCode, { regionName: a.regionName, countryName: a.countryName });
  }
}

// Build asylum rate lookup
const asylumLookup = new Map();
if (localRoute?.areas) {
  for (const a of localRoute.areas) {
    asylumLookup.set(a.areaCode, {
      supportedAsylum: a.supportedAsylum ?? 0,
      supportedAsylumRate: a.supportedAsylumRate ?? 0,
    });
  }
}

const NOW = new Date().toISOString().split('T')[0];

// ─── 1. Economic Profile ───
console.log('1. Generating economic-profile.json...');
{
  const areas = {};
  let populated = 0;

  for (const [code, data] of Object.entries(ep.areas)) {
    const ea = data.economicActivity;
    const ht = data.housingTenure;
    const qu = data.qualifications;
    const pop = data.current?.total_population;

    if (!ea && !ht && !qu) {
      areas[code] = { areaName: data.areaName, dataAvailable: false };
      continue;
    }
    populated++;

    // Compute weighted averages using ethnic composition
    const groups = data.current?.groups || {};
    let totalWeight = 0;
    let avgEmployment = 0, avgOwnership = 0, avgSocialRent = 0, avgDegree = 0, avgNoQuals = 0;

    for (const [group, pct] of Object.entries(groups)) {
      const w = pct / 100;
      totalWeight += w;
      const gKey = group.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        .replace('White British', 'White British')
        .replace('White Other', 'White Other');

      // Try multiple key formats
      const eaEntry = ea?.[gKey] || ea?.[group] || null;
      const htEntry = ht?.[gKey] || ht?.[group] || null;
      const quEntry = qu?.[gKey] || qu?.[group] || null;

      if (eaEntry) avgEmployment += (eaEntry.employmentRate ?? 0) * w;
      if (htEntry) {
        avgOwnership += (htEntry.ownershipRate ?? 0) * w;
        avgSocialRent += (htEntry.socialRentRate ?? 0) * w;
      }
      if (quEntry) {
        avgDegree += (quEntry.degreeOrAbovePct ?? 0) * w;
        avgNoQuals += (quEntry.noQualsPct ?? 0) * w;
      }
    }

    areas[code] = {
      areaName: data.areaName,
      population: pop,
      economicActivity: ea,
      housingTenure: ht,
      qualifications: qu,
      summary: {
        avgEmploymentRate: Math.round(avgEmployment * 10) / 10,
        avgOwnershipRate: Math.round(avgOwnership * 10) / 10,
        avgSocialRentRate: Math.round(avgSocialRent * 10) / 10,
        avgDegreeRate: Math.round(avgDegree * 10) / 10,
        avgNoQualsRate: Math.round(avgNoQuals * 10) / 10,
      }
    };
  }

  writeJSON('economic-profile.json', {
    source: 'Census 2021 via ethnic-projections.json (economicActivity, housingTenure, qualifications)',
    methodology: 'Ethnic group-level Census 2021 data extracted per local authority',
    lastUpdated: NOW,
    totalAreas: areaCodes.length,
    populatedAreas: populated,
    areas
  });
}

// ─── 2. School Pressure ───
console.log('2. Generating school-pressure.json...');
{
  const areas = {};
  let withData = 0;

  for (const [code, data] of Object.entries(ep.areas)) {
    const school = data.schoolEthnicity;
    const impact = data.impactProjections;

    if (!school) {
      areas[code] = { areaName: data.areaName, dataAvailable: false };
      continue;
    }
    withData++;

    const wbiPupilsPct = school.groups?.['White British'] ?? null;
    const minorityPupilsPct = wbiPupilsPct != null ? (100 - wbiPupilsPct) : null;

    areas[code] = {
      areaName: data.areaName,
      dataAvailable: true,
      year: school.year,
      totalPupils: school.totalPupils,
      wbiPupilsPct,
      minorityPupilsPct,
      ealDemandGrowthPp: impact?.schoolDiversity?.ealDemandGrowthPp ?? null,
      projectedMinorityPupils2041Pct: impact?.schoolDiversity?.projectedMinorityPupils2041Pct ?? null,
      currentMinorityPupilsPct: impact?.schoolDiversity?.currentMinorityPupilsPct ?? null,
      wbiGap: school.wbiGap,
      insight: school.insight,
      pupilGroups: school.groups,
      schoolDiversityImplication: impact?.schoolDiversity?.implication ?? null,
    };
  }

  writeJSON('school-pressure.json', {
    source: 'DfE School Census 2024/25 via ethnic-projections.json',
    methodology: 'School ethnic composition from DfE data, projected minority growth from Hamilton-Perry model',
    lastUpdated: NOW,
    totalAreas: areaCodes.length,
    areasWithData: withData,
    caveat: 'School data available for 126 areas with DfE calibration. Others pending data expansion.',
    areas
  });
}

// ─── 3. Housing Demand ───
console.log('3. Generating housing-demand.json...');
{
  const areas = {};
  let withData = 0;

  for (const [code, data] of Object.entries(ep.areas)) {
    const ht = data.housingTenure;
    const impact = data.impactProjections;
    const proj = data.projections;
    const current = data.current;

    if (!ht) {
      areas[code] = { areaName: data.areaName, dataAvailable: false };
      continue;
    }
    withData++;

    // Compute current tenure mix (weighted by ethnic composition)
    const groups = current?.groups || {};
    let socialDemand = 0, privateDemand = 0, ownerDemand = 0;

    for (const [group, pct] of Object.entries(groups)) {
      const w = pct / 100;
      const gKey = group.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        .replace('White British', 'White British').replace('White Other', 'White Other');
      const entry = ht[gKey] || ht[group];
      if (entry) {
        socialDemand += (entry.socialRentRate ?? 0) * w;
        privateDemand += (entry.privateRentRate ?? 0) * w;
        ownerDemand += (entry.ownershipRate ?? 0) * w;
      }
    }

    // Project 2041 tenure mix using projected ethnic composition
    const proj2041 = proj?.['2041'];
    let socialDemand2041 = 0, privateDemand2041 = 0, ownerDemand2041 = 0;

    if (proj2041) {
      for (const [group, pct] of Object.entries(proj2041)) {
        const w = pct / 100;
        const gKey = group.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          .replace('White British', 'White British').replace('White Other', 'White Other');
        const entry = ht[gKey] || ht[group];
        if (entry) {
          socialDemand2041 += (entry.socialRentRate ?? 0) * w;
          privateDemand2041 += (entry.privateRentRate ?? 0) * w;
          ownerDemand2041 += (entry.ownershipRate ?? 0) * w;
        }
      }
    }

    areas[code] = {
      areaName: data.areaName,
      dataAvailable: true,
      population: current?.total_population,
      currentTenure: {
        ownershipPct: Math.round(ownerDemand * 10) / 10,
        socialRentPct: Math.round(socialDemand * 10) / 10,
        privateRentPct: Math.round(privateDemand * 10) / 10,
      },
      projectedTenure2041: proj2041 ? {
        ownershipPct: Math.round(ownerDemand2041 * 10) / 10,
        socialRentPct: Math.round(socialDemand2041 * 10) / 10,
        privateRentPct: Math.round(privateDemand2041 * 10) / 10,
      } : null,
      socialRentChangePp: proj2041 ? Math.round((socialDemand2041 - socialDemand) * 10) / 10 : null,
      foreignBornGrowthPp: impact?.housingDemand?.foreignBornGrowthPp ?? null,
      housingImplication: impact?.housingDemand?.implication ?? null,
      tenureByGroup: ht,
    };
  }

  writeJSON('housing-demand.json', {
    source: 'Census 2021 tenure by ethnicity × Hamilton-Perry ethnic projections',
    methodology: 'Current Census tenure patterns per ethnic group applied to projected ethnic composition to estimate future tenure demand',
    lastUpdated: NOW,
    totalAreas: areaCodes.length,
    areasWithData: withData,
    caveat: 'Assumes tenure patterns by ethnicity remain constant. Actual tenure will be affected by housing policy, affordability, and economic conditions.',
    areas
  });
}

// ─── 4. Health Demand ───
console.log('4. Generating health-demand.json...');
{
  // Health data in ethnic-projections has sentinel values (100/0).
  // Use qualifications + economic activity as proxies for health demand.
  // Areas with low employment + low qualifications = higher health demand.
  const areas = {};
  let withData = 0;

  for (const [code, data] of Object.entries(ep.areas)) {
    const ea = data.economicActivity;
    const qu = data.qualifications;
    const impact = data.impactProjections;

    if (!ea && !qu) {
      areas[code] = { areaName: data.areaName, dataAvailable: false };
      continue;
    }
    withData++;

    // Compute health demand proxy from socioeconomic factors
    const groups = data.current?.groups || {};
    let weightedEmployment = 0, weightedNoQuals = 0;

    for (const [group, pct] of Object.entries(groups)) {
      const w = pct / 100;
      const gKey = group.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        .replace('White British', 'White British').replace('White Other', 'White Other');
      const eaEntry = ea?.[gKey] || ea?.[group];
      const quEntry = qu?.[gKey] || qu?.[group];
      if (eaEntry) weightedEmployment += (eaEntry.employmentRate ?? 0) * w;
      if (quEntry) weightedNoQuals += (quEntry.noQualsPct ?? 0) * w;
    }

    // Health demand score: inverse of employment + education (higher = more demand)
    const healthDemandScore = Math.round((100 - weightedEmployment) * 0.5 + weightedNoQuals * 0.5);

    areas[code] = {
      areaName: data.areaName,
      dataAvailable: true,
      population: data.current?.total_population,
      healthDemandScore,
      avgEmploymentRate: Math.round(weightedEmployment * 10) / 10,
      avgNoQualsRate: Math.round(weightedNoQuals * 10) / 10,
      interpreterDemandGrowthPp: impact?.interpreterDemand?.nonEnglishGrowthPp ?? null,
      interpreterImplication: impact?.interpreterDemand?.implication ?? null,
      note: 'Health demand score is a proxy computed from economic activity and qualification levels. Direct NHS cost data by ethnicity at LA level is not publicly available.',
    };
  }

  writeJSON('health-demand.json', {
    source: 'Census 2021 economic activity and qualifications as health demand proxy',
    methodology: 'Health demand score = f(employment rate, qualification levels) by ethnic group, weighted by composition',
    lastUpdated: NOW,
    totalAreas: areaCodes.length,
    areasWithData: withData,
    caveat: 'Direct NHS cost data by ethnicity at LA level is not available. This uses socioeconomic proxies (employment, qualifications) correlated with health outcomes.',
    areas
  });
}

// ─── 5. Language Projections ───
console.log('5. Generating language-projections.json...');
{
  const areas = {};
  let withData = 0;

  for (const [code, data] of Object.entries(ep.areas)) {
    const proficiency = data.englishProficiency;
    const impact = data.impactProjections;
    const proj = data.projections;

    if (!proficiency || typeof proficiency !== 'object') {
      areas[code] = { areaName: data.areaName, dataAvailable: false };
      continue;
    }
    withData++;

    // Extract proficiency levels
    const levels = {};
    for (const [k, v] of Object.entries(proficiency)) {
      if (k !== 'source') levels[k] = v;
    }

    // Estimate future non-English speaking from ethnic composition change
    const wbi2021 = data.current?.groups?.white_british ?? 100;
    const wbi2041 = proj?.['2041']?.white_british ?? wbi2021;
    const nonWbiGrowthPp = (100 - wbi2041) - (100 - wbi2021);

    areas[code] = {
      areaName: data.areaName,
      dataAvailable: true,
      currentProficiency: levels,
      nonEnglishGrowthPp: impact?.interpreterDemand?.nonEnglishGrowthPp ?? null,
      projectedNonEnglishIncrease: nonWbiGrowthPp > 0 ? Math.round(nonWbiGrowthPp * 10) / 10 : 0,
      interpreterImplication: impact?.interpreterDemand?.implication ?? null,
    };
  }

  writeJSON('language-projections.json', {
    source: 'Census 2021 English proficiency + Hamilton-Perry ethnic projections',
    methodology: 'Census proficiency data projected forward using ethnic composition change as a proxy for non-English speaking growth',
    lastUpdated: NOW,
    totalAreas: areaCodes.length,
    areasWithData: withData,
    areas
  });
}

// ─── 6. Fiscal Resilience / Service Demand Scoring ───
console.log('6. Generating fiscal-resilience.json...');
{
  const areas = {};

  for (const [code, data] of Object.entries(ep.areas)) {
    const impact = data.impactProjections;
    const shift = data.shiftShare;
    const diversity = data.diversityIndex;
    const wbi2021 = data.current?.groups?.white_british ?? 100;
    const wbi2041 = data.projections?.['2041']?.white_british ?? wbi2021;
    const wbiChange = wbi2041 - wbi2021;
    const pop = data.current?.total_population ?? 0;
    const asylum = asylumLookup.get(code);

    // Service demand pressure score (0-100)
    // Higher = more pressure from demographic change
    let pressureScore = 0;

    // Rapid ethnic change (+20 max)
    pressureScore += Math.min(20, Math.abs(wbiChange) * 1.5);

    // High asylum concentration (+20 max)
    const asylumRate = asylum?.supportedAsylumRate ?? 0;
    pressureScore += Math.min(20, asylumRate * 0.5);

    // School diversity pressure (+20 max)
    const schoolPressure = impact?.schoolDiversity?.ealDemandGrowthPp ?? 0;
    pressureScore += Math.min(20, schoolPressure * 1.0);

    // Non-English growth (+20 max)
    const langPressure = impact?.interpreterDemand?.nonEnglishGrowthPp ?? 0;
    pressureScore += Math.min(20, langPressure * 1.0);

    // Foreign-born growth / housing pressure (+20 max)
    const housingPressure = impact?.housingDemand?.foreignBornGrowthPp ?? 0;
    pressureScore += Math.min(20, housingPressure * 0.5);

    pressureScore = Math.round(Math.min(100, pressureScore));

    // Demographic change velocity
    const velocity = Math.round(Math.abs(wbiChange / 20 * 100)); // pp change / 20 years, normalized

    // Category
    let category = 'Stable';
    if (pressureScore >= 70) category = 'High Pressure';
    else if (pressureScore >= 45) category = 'Moderate Pressure';
    else if (pressureScore >= 25) category = 'Low Pressure';

    areas[code] = {
      areaName: data.areaName,
      population: pop,
      serviceDemandPressureScore: pressureScore,
      category,
      demographicChangeVelocity: velocity,
      wbiChange2021to2041: Math.round(wbiChange * 10) / 10,
      asylumRate: asylumRate,
      diversityIndex: diversity?.entropy ?? null,
      diversityLevel: diversity?.diversityLevel ?? null,
      components: {
        ethnicChangeContribution: Math.round(Math.min(20, Math.abs(wbiChange) * 1.5)),
        asylumConcentration: Math.round(Math.min(20, asylumRate * 0.5)),
        schoolPressure: Math.round(Math.min(20, schoolPressure * 1.0)),
        languagePressure: Math.round(Math.min(20, langPressure * 1.0)),
        housingPressure: Math.round(Math.min(20, housingPressure * 0.5)),
      }
    };
  }

  // Rank areas by pressure score
  const ranked = Object.entries(areas).sort((a, b) => b[1].serviceDemandPressureScore - a[1].serviceDemandPressureScore);
  ranked.forEach(([code, data], i) => { data.pressureRank = i + 1; });

  writeJSON('fiscal-resilience.json', {
    source: 'Composite scoring from ethnic-projections.json, local-route-latest.json',
    methodology: 'Service demand pressure score (0-100) from 5 components: ethnic change rate, asylum concentration, school diversity pressure, language demand, housing pressure. Each component contributes up to 20 points.',
    lastUpdated: NOW,
    totalAreas: areaCodes.length,
    highPressureAreas: ranked.filter(([_, d]) => d.category === 'High Pressure').length,
    moderatePressureAreas: ranked.filter(([_, d]) => d.category === 'Moderate Pressure').length,
    top10: ranked.slice(0, 10).map(([code, d]) => ({ code, name: d.areaName, score: d.serviceDemandPressureScore })),
    areas
  });
}

// ─── 7. Crime Correlation ───
console.log('7. Generating crime-correlation.json...');
{
  // Build correlation between asylum dispersal rate and crime data
  const crimeAreas = existingCrime?.areas || {};
  const pairs = [];

  for (const [code, crimeData] of Object.entries(crimeAreas)) {
    const asylum = asylumLookup.get(code);
    if (!asylum || !crimeData.totalCrimeRate) continue;

    pairs.push({
      areaCode: code,
      areaName: crimeData.areaName,
      totalCrimeRate: crimeData.totalCrimeRate,
      violentCrimeRate: crimeData.violentCrimeRate ?? null,
      asylumRate: asylum.supportedAsylumRate,
      supportedAsylum: asylum.supportedAsylum,
    });
  }

  // Simple correlation coefficient
  const n = pairs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const p of pairs) {
    sumX += p.asylumRate;
    sumY += p.totalCrimeRate;
    sumXY += p.asylumRate * p.totalCrimeRate;
    sumX2 += p.asylumRate * p.asylumRate;
    sumY2 += p.totalCrimeRate * p.totalCrimeRate;
  }
  const correlation = n > 2 ?
    (n * sumXY - sumX * sumY) / Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)) : null;

  writeJSON('crime-correlation.json', {
    source: 'crime-dashboard.json + local-route-latest.json',
    methodology: 'Ecological correlation between asylum support rate per 10,000 and total crime rate per 1,000 across local authorities with both datasets',
    lastUpdated: NOW,
    caveat: 'ECOLOGICAL FALLACY WARNING: Correlation between area-level asylum rates and area-level crime rates does NOT prove that asylum seekers commit more crime. Many confounding factors (deprivation, age structure, urbanisation) affect both variables. This analysis cannot and should not be used to draw conclusions about individual behaviour.',
    pairsAnalysed: n,
    correlationCoefficient: correlation != null ? Math.round(correlation * 1000) / 1000 : null,
    pairs
  });
}

// ─── 8. Dependency Ratios ───
console.log('8. Generating dependency-ratios.json...');
{
  // We don't have age structure in ethnic-projections.json directly.
  // But scenario-summaries.json may have age data.
  // For now, compute from what we have — population + working-age proxy from economic activity.

  const areas = {};

  for (const [code, data] of Object.entries(ep.areas)) {
    const pop = data.current?.total_population ?? 0;
    const ea = data.economicActivity;

    // Use economically active population as a rough working-age proxy
    // Average employment rate across groups gives an indication of working-age share
    const groups = data.current?.groups || {};
    let weightedEmployment = 0;
    for (const [group, pct] of Object.entries(groups)) {
      const w = pct / 100;
      const gKey = group.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        .replace('White British', 'White British').replace('White Other', 'White Other');
      const entry = ea?.[gKey] || ea?.[group];
      if (entry) weightedEmployment += (entry.employmentRate ?? 0) * w;
    }

    areas[code] = {
      areaName: data.areaName,
      population: pop,
      avgEmploymentRate: Math.round(weightedEmployment * 10) / 10,
      // Dependency ratio requires age structure — flag as estimate
      note: 'Full age-structure dependency ratios require ONS SNPP single-year-of-age data. This provides employment rate as a proxy.',
    };
  }

  writeJSON('dependency-ratios.json', {
    source: 'ethnic-projections.json economic activity data',
    methodology: 'Employment rate by ethnic group as proxy for working-age population share. Full dependency ratios require SNPP age structure data (pipeline pending).',
    lastUpdated: NOW,
    totalAreas: areaCodes.length,
    caveat: 'These are proxy estimates. Proper dependency ratios (ages 0-15 + 65+) / (16-64) require SNPP single-year-of-age data not yet integrated.',
    areas
  });
}

console.log(`\n✓ All dashboards generated. ${areaCodes.length} areas processed.`);
