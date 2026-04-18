/**
 * Fetch economic profile data for UK local authorities.
 * Sources:
 *   - NOMIS API: Economic activity, qualifications, employment by LA
 *   - DWP Stat-Xplore: Universal Credit claimants (via published tables)
 *
 * Output: src/data/live/economic-profile.json
 *
 * Usage: node scripts/fetch/fetch-economic-data.mjs
 */

import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../../src/data/live/economic-profile.json");
const AREAS_PATH = join(__dirname, "../../src/data/live/local-route-latest.json");

// NOMIS API base
const NOMIS_BASE = "https://www.nomisweb.co.uk/api/v01";

// Dataset IDs
// NM_17_5 = Annual Population Survey - Employment and economic activity
// NM_207_1 = DWP benefits (Alternative Claimant Count)
// NM_142_1 = Census 2021 qualifications

/**
 * Fetch labour market data from NOMIS APS
 * Table NM_17_5: model-based estimates of economic activity
 */
async function fetchLabourMarketData(areaCodes) {
  const results = {};

  // NOMIS model-based estimates by LA
  // geography type 464 = local authority districts (post-2023)
  const url = `${NOMIS_BASE}/dataset/NM_17_5.data.json?geography=TYPE464&variable=45,18,117,720&measures=20100&select=geography_code,variable_name,obs_value&time=latest`;

  console.log("Fetching NOMIS labour market data...");

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.warn(`NOMIS returned ${res.status}, using fallback`);
      return results;
    }
    const data = await res.json();

    for (const obs of data.obs ?? []) {
      const code = obs.geography?.geogcode;
      const varName = obs.variable?.description ?? "";
      const value = parseFloat(obs.obs_value?.value);

      if (!code || isNaN(value)) continue;

      if (!results[code]) {
        results[code] = {};
      }

      if (varName.includes("Employment rate")) {
        results[code].employmentRate = value;
      } else if (varName.includes("Economic inactivity rate")) {
        results[code].economicInactivityRate = value;
      } else if (varName.includes("Unemployment rate")) {
        results[code].unemploymentRate = value;
      } else if (varName.includes("Workless")) {
        results[code].worklessnessRate = value;
      }
    }

    console.log(`Fetched labour data for ${Object.keys(results).length} areas`);
  } catch (err) {
    console.warn("NOMIS fetch failed, generating empty profiles:", err.message);
  }

  return results;
}

/**
 * Build economic profiles from available data.
 * For areas without NOMIS data, we create empty profiles that can be enriched later.
 */
function buildProfiles(areaCodes, labourData) {
  const profiles = {};

  for (const code of areaCodes) {
    const labour = labourData[code] ?? {};

    profiles[code] = {
      areaCode: code,
      employment: {
        employmentRate: labour.employmentRate ?? null,
        economicInactivityRate: labour.economicInactivityRate ?? null,
        unemploymentRate: labour.unemploymentRate ?? null,
      },
      worklessness: {
        total: labour.worklessnessRate ?? null,
      },
      benefits: {
        ucClaimantRate: null, // Requires DWP Stat-Xplore auth
      },
      education: {
        nvq4PlusPct: null, // Requires NOMIS qualifications dataset
        noQualificationsPct: null,
      },
      deprivation: {
        imdRank: null,
        imdDecile: null,
      },
    };
  }

  return profiles;
}

async function main() {
  // Load area codes from local-route-latest
  const areasData = JSON.parse(readFileSync(AREAS_PATH, "utf8"));
  const areaCodes = areasData.areas.map((a) => a.areaCode);

  console.log(`Building economic profiles for ${areaCodes.length} areas`);

  const labourData = await fetchLabourMarketData(areaCodes);

  const profiles = buildProfiles(areaCodes, labourData);
  const populatedCount = Object.values(profiles).filter(
    (p) => p.employment.employmentRate !== null
  ).length;

  const output = {
    source: "NOMIS (ONS Annual Population Survey)",
    lastUpdated: new Date().toISOString().split("T")[0],
    methodology: "Model-based estimates from the Annual Population Survey. Employment, economic inactivity, and unemployment rates by local authority.",
    totalAreas: areaCodes.length,
    populatedAreas: populatedCount,
    profiles,
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${areaCodes.length} profiles (${populatedCount} with data) to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
